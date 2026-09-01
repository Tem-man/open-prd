import { useMessagesStore } from "@/stores/messages";
import { usePrdEditStore } from "@/stores/prdEdit";
import type { Message, PipelineState, QuestionForm, RetryMode } from "@/types";
import {
	resolvePrdLlmPayload,
	type PrdLlmPayload,
} from "@/app/ai/models/prd-llm-payload";

/** 表格内部元素的 DOM 坐标，用于后端精确定位 tr / td / th */
export type TableElementPath =
	| { kind: "row"; tableIndex: number; rowIndex: number }
	| { kind: "cell"; tableIndex: number; rowIndex: number; cellIndex: number }
	| {
			kind: "cells";
			tableIndex: number;
			rowIndex: number;
			cellIndices: number[];
	  };

let toastFn: ((msg: string) => void) | null = null;
export function registerToast(fn: (msg: string) => void) {
	toastFn = fn;
}

function showToast(msg: string) {
	if (toastFn) toastFn(msg);
	else console.error("[SSE error]", msg);
}

async function requirePrdLlmPayload(): Promise<PrdLlmPayload | null> {
	try {
		return await resolvePrdLlmPayload();
	} catch (err) {
		showToast(err instanceof Error ? err.message : "模型配置不可用");
		return null;
	}
}

/** SSE 事件格式 */
interface SseEvent {
	type:
		| "delta"
		| "done"
		| "prd_ready"
		| "prd_progress"
		| "error"
		| "section_edit_delta"
		| "section_edit_done"
		| "section_edit_error";
	content?: string;
	prdGenerated?: boolean;
	prdId?: string;
	warnings?: string[];
	sectionId?: string;
	status?: "generating" | "done" | "error";
	message?: string;
	// error 扩展字段
	retryable?: boolean;
	reason?: string;
	suggestedMode?: RetryMode;
	// section edit done
	newHtml?: string;
	version?: number;
	assembledPrdHtml?: string;
}

/** form 事件数据格式 */
interface FormEventData {
	questions: QuestionForm["questions"];
}

/** 当前活跃的 AbortController，用于中止 SSE 流 */
let activeAbortController: AbortController | null = null;

/**
 * 消费一个 SSE 响应流，将 delta/done/prd_ready/error 事件分发给 store。
 * @returns 最后接收到的 SSE event id（用于断线重连）
 */
async function consumeStream(
	res: Response,
	tempId: string,
	sessionId: string,
	messagesStore: ReturnType<typeof useMessagesStore>,
	signal?: AbortSignal,
): Promise<string | null> {
	if (!res.body) return null;

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let lastEventId: string | null = null;
	let currentEventName: string | null = null;

	// 监听 abort 信号，主动取消 reader
	const onAbort = () => {
		reader.cancel().catch(() => {});
	};
	signal?.addEventListener("abort", onAbort);

	try {
		while (true) {
			const { done, value } = await reader.read().catch(() => ({
				done: true,
				value: undefined as Uint8Array | undefined,
			}));
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				// 跳过 SSE 心跳注释行（": heartbeat"）
				if (line.startsWith(":")) continue;

				// 解析 SSE id 字段
				if (line.startsWith("id: ")) {
					lastEventId = line.slice(4).trim();
					continue;
				}

				// 解析 SSE event 名称字段
				if (line.startsWith("event: ")) {
					currentEventName = line.slice(7).trim();
					continue;
				}

				// 空行表示事件边界，重置事件名
				if (line === "") {
					currentEventName = null;
					continue;
				}

				if (!line.startsWith("data: ")) continue;
				const raw = line.slice(6).trim();
				if (!raw) continue;

				// 处理 form 命名事件
				if (currentEventName === "form") {
					try {
						const formData = JSON.parse(raw) as FormEventData;
						if (formData.questions) {
							messagesStore.attachFormToLastMessage({
								questions: formData.questions,
							});
						}
					} catch {
						// 降级处理：解析失败则忽略
					}
					currentEventName = null;
					continue;
				}

				// 处理 done 命名事件
				if (currentEventName === "done") {
					messagesStore.finalizeMessage(tempId);
					currentEventName = null;
					continue;
				}

				let evt: SseEvent;
				try {
					evt = JSON.parse(raw) as SseEvent;
				} catch {
					continue;
				}

				if (evt.type === "delta" && evt.content) {
					messagesStore.appendDelta(tempId, evt.content);
				} else if (evt.type === "prd_progress" && evt.sectionId && evt.status) {
					messagesStore.setPrdSectionStatus(evt.sectionId, evt.status);
				} else if (evt.type === "done") {
					messagesStore.finalizeMessage(tempId);
					if (evt.prdGenerated) {
						fetchPrdHtml(sessionId, messagesStore);
					}
				} else if (evt.type === "prd_ready" && evt.prdId) {
					messagesStore.setPrdReady(evt.prdId);
					messagesStore.clearPipelineState();
					fetchPrdHtml(sessionId, messagesStore);

					// 拼装成功通知消息
					let successMsg = "✅ PRD 已生成完成，点击右侧面板查看";
					if (evt.warnings && evt.warnings.length > 0) {
						successMsg +=
							"\n\n⚠️ 检测到以下潜在问题，部分图表可能无法正常渲染：\n" +
							evt.warnings.map((w) => `• ${w}`).join("\n");
					}
					messagesStore.addStaticAssistantMessage(sessionId, successMsg);
				} else if (evt.type === "error" && evt.message) {
					showToast(evt.message);
					if (evt.retryable) {
						// 保留气泡（不 finalize），标记为中断，展示继续按钮
						messagesStore.markMessageInterrupted(tempId);
						messagesStore.applyPipelineState({
							phase:
								evt.suggestedMode === "continue_prd" ||
								evt.suggestedMode === "retry_section"
									? "prd_partial"
									: "agent_interrupted",
							interruptedMessageId: tempId,
							lastError: {
								reason: evt.reason ?? "unknown",
								retryable: true,
								message: evt.message,
								suggestedMode: evt.suggestedMode,
							},
						} as PipelineState);
					} else {
						messagesStore.finalizeMessage(tempId);
					}
				}
			}
		}
	} finally {
		signal?.removeEventListener("abort", onAbort);
		// 确保 ReadableStream 锁被释放，防止连接泄漏
		reader.releaseLock();
	}

	return lastEventId;
}

async function fetchPrdHtml(
	sessionId: string,
	messagesStore: ReturnType<typeof useMessagesStore>,
) {
	const res = await fetch(`/api/sessions/${sessionId}/prd`);
	if (!res.ok) return;
	const data = (await res.json()) as { html?: string };
	if (data.html) messagesStore.setPrdHtml(data.html);
}

export function useSSE() {
	const messagesStore = useMessagesStore();

	async function sendMessage(sessionId: string, text: string): Promise<void> {
		const llm = await requirePrdLlmPayload();
		if (!llm) return;

		const tempId = `stream-${Date.now()}`;

		// 创建本次请求的 AbortController，注册到模块级变量以便外部中止
		const controller = new AbortController();
		activeAbortController = controller;
		const { signal } = controller;

		const userMsg: Message = {
			id: `user-${Date.now()}`,
			sessionId,
			role: "user",
			content: text,
			createdAt: Date.now(),
		};
		messagesStore.addUserMessage(userMsg);

		const aiMsg: Message = {
			id: tempId,
			sessionId,
			role: "assistant",
			content: "",
			createdAt: Date.now(),
			isStreaming: true,
		};
		messagesStore.startStreamingMessage(aiMsg);

		try {
			// ── 首次请求 ──────────────────────────────────────────────────────────
			let res: Response;
			try {
				res = await fetch(`/api/sessions/${sessionId}/messages`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ content: text, llm }),
					signal,
				});
			} catch (err) {
				if ((err as Error).name === "AbortError") {
					messagesStore.finalizeMessage(tempId);
					return;
				}
				throw err;
			}

			if (!res.ok || !res.body) {
				let detail = `请求失败：${res.status}`;
				try {
					const errBody = (await res.json()) as { error?: string };
					if (errBody.error) detail = errBody.error;
				} catch {
					/* keep status text */
				}
				showToast(detail);
				messagesStore.finalizeMessage(tempId);
				return;
			}

			// 消费流，获取最后的 event id
			let lastEventId = await consumeStream(
				res,
				tempId,
				sessionId,
				messagesStore,
				signal,
			);

			// 用户主动中止：直接结束，不重连
			if (signal.aborted) {
				messagesStore.finalizeMessage(tempId);
				return;
			}

			// ── 断线重连：若流异常结束且未 finalize，携带 Last-Event-ID 重试一次 ──
			const isStillStreaming = messagesStore.messages.some(
				(m) => m.id === tempId && m.isStreaming,
			);

			if (isStillStreaming && lastEventId !== null) {
				try {
					res = await fetch(`/api/sessions/${sessionId}/messages`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"Last-Event-ID": lastEventId,
						},
						body: JSON.stringify({ content: text, llm }),
						signal,
					});
				} catch (err) {
					if ((err as Error).name === "AbortError") {
						messagesStore.finalizeMessage(tempId);
						return;
					}
					throw err;
				}

				if (res.ok && res.body) {
					messagesStore.clearStreamingContent(tempId);
					await consumeStream(res, tempId, sessionId, messagesStore, signal);
				} else {
					messagesStore.finalizeMessage(tempId);
				}
			} else if (isStillStreaming) {
				messagesStore.finalizeMessage(tempId);
			}
		} finally {
			// 清理模块级引用
			if (activeAbortController === controller) {
				activeAbortController = null;
			}
		}
	}

	/**
	 * 继续/重试会话：通过 POST /messages/retry 恢复未完成的业务。
	 *
	 * - retry_last：忽略 partial，用同一条 user 消息重跑 Agent
	 * - continue_agent：携带 partial 作上下文，让 Agent 从断点续写
	 * - continue_prd：继续生成未完成的 PRD 模块
	 * - retry_section：只重试指定模块
	 */
	async function retrySession(
		sessionId: string,
		mode: RetryMode,
		sectionId?: string,
	): Promise<void> {
		const llm = await requirePrdLlmPayload();
		if (!llm) return;

		const isPrdMode = mode === "continue_prd" || mode === "retry_section";

		// 找到中断消息（对话模式），或创建新的临时消息（PRD 模式）
		const interruptedMsg = !isPrdMode
			? [...messagesStore.messages]
					.reverse()
					.find((m) => m.role === "assistant" && m.interrupted)
			: undefined;

		let tempId: string;
		if (interruptedMsg) {
			tempId = interruptedMsg.id;
			// retry_last 时清空内容重来；continue_agent 时保留内容继续追加
			if (mode === "retry_last") messagesStore.clearStreamingContent(tempId);
			messagesStore.resumeStreamingMessage(tempId);
		} else if (!isPrdMode) {
			// 没有中断消息也没有 PRD 模式，创建一个新占位气泡
			tempId = `retry-${Date.now()}`;
			const aiMsg: Message = {
				id: tempId,
				sessionId,
				role: "assistant",
				content: "",
				createdAt: Date.now(),
				isStreaming: true,
			};
			messagesStore.startStreamingMessage(aiMsg);
		} else {
			tempId = `prd-retry-${Date.now()}`;
		}

		const controller = new AbortController();
		activeAbortController = controller;
		const { signal } = controller;

		try {
			let res: Response;
			try {
				res = await fetch(`/api/sessions/${sessionId}/messages/retry`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ mode, sectionId, llm }),
					signal,
				});
			} catch (err) {
				if ((err as Error).name === "AbortError") {
					if (!isPrdMode) messagesStore.finalizeMessage(tempId);
					return;
				}
				throw err;
			}

			if (!res.ok || !res.body) {
				showToast(`重试请求失败：${res.status}`);
				if (!isPrdMode) messagesStore.finalizeMessage(tempId);
				return;
			}

			const lastEventId = await consumeStream(
				res,
				tempId,
				sessionId,
				messagesStore,
				signal,
			);

			if (signal.aborted) {
				if (!isPrdMode) messagesStore.finalizeMessage(tempId);
				return;
			}

			// 网络级断线重连（Last-Event-ID）
			const isStillStreaming = !isPrdMode
				? messagesStore.messages.some((m) => m.id === tempId && m.isStreaming)
				: false;

			if (isStillStreaming && lastEventId !== null) {
				try {
					res = await fetch(`/api/sessions/${sessionId}/messages/retry`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"Last-Event-ID": lastEventId,
						},
						body: JSON.stringify({ mode, sectionId, llm }),
						signal,
					});
				} catch (err) {
					if ((err as Error).name === "AbortError") {
						messagesStore.finalizeMessage(tempId);
						return;
					}
					throw err;
				}
				if (res.ok && res.body) {
					if (mode === "retry_last")
						messagesStore.clearStreamingContent(tempId);
					await consumeStream(res, tempId, sessionId, messagesStore, signal);
				} else {
					messagesStore.finalizeMessage(tempId);
				}
			} else if (isStillStreaming) {
				messagesStore.finalizeMessage(tempId);
			}
		} finally {
			if (activeAbortController === controller) {
				activeAbortController = null;
			}
		}
	}

	function stopGeneration() {
		if (activeAbortController) {
			activeAbortController.abort();
			activeAbortController = null;
		}
	}

	return { sendMessage, retrySession, stopGeneration };
}

/**
 * 单独的 section 编辑 SSE composable（不依赖主对话流，独立开连接）。
 * 调用 editSection() 触发 AI 重写，结果通过 prdEditStore 分发。
 */
export function useSectionEdit() {
	const messagesStore = useMessagesStore();
	const prdEditStore = usePrdEditStore();

	async function editSection(
		sessionId: string,
		sectionId: string,
		instruction: string,
		selectedElementHtml?: string,
		entityName?: string,
		tablePath?: TableElementPath,
	): Promise<void> {
		const llm = await requirePrdLlmPayload();
		if (!llm) return;

		const res = await fetch(
			`/api/sessions/${sessionId}/prd/sections/${sectionId}`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					instruction,
					selectedElementHtml,
					entityName,
					tablePath,
					llm,
				}),
			},
		);

		if (!res.ok || !res.body) {
			showToast(`请求失败：${res.status}`);
			return;
		}

		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					if (line.startsWith(":") || line === "") continue;
					if (!line.startsWith("data: ")) continue;
					const raw = line.slice(6).trim();
					if (!raw) continue;

					let evt: {
						type: string;
						sectionId?: string;
						content?: string;
						newHtml?: string;
						version?: number;
						assembledPrdHtml?: string;
						message?: string;
					};
					try {
						evt = JSON.parse(raw);
					} catch {
						continue;
					}

					if (evt.type === "section_element_patch_start" && evt.sectionId) {
						// Element Patch 模式：只标记 AI 处理中，不更新 section html
						prdEditStore.startAiEditing(evt.sectionId);
					} else if (
						evt.type === "section_edit_delta" &&
						evt.sectionId &&
						evt.content
					) {
						prdEditStore.onAiEditDelta(evt.sectionId, evt.content);
					} else if (
						evt.type === "section_edit_done" &&
						evt.sectionId &&
						evt.newHtml !== undefined &&
						evt.version !== undefined
					) {
						prdEditStore.onAiEditDone(evt.sectionId, evt.newHtml, evt.version);
						if (evt.assembledPrdHtml) {
							messagesStore.updatePrdHtmlAfterEdit(evt.assembledPrdHtml);
						}
					} else if (evt.type === "section_edit_error" && evt.message) {
						showToast(evt.message || "编辑失败，请重试");
						prdEditStore.cancelEdit();
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	return { editSection };
}
