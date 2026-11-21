import type { IRouter, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../../db/client.js";
import { getLocale, type Locale } from "../../i18n/locale.js";
import { getAgentDriver } from "../../services/agent/orchestrator.js";
import {
	createTurnRecorder,
	type ComposerTarget,
	type OrchestratorEvent,
	type TurnRecorder,
} from "../../services/agent/types.js";
import { generateFullPrd, generateSingleSection } from "../../services/prd/index.js";
import { runPrdPipeline } from "../../services/prdPipeline.js";
import {
	CONFIRM_DECISIONS,
	confirmOptionText,
	lookupPendingAction,
	setPendingActionStatus,
	type ConfirmDecision,
} from "../../services/pendingActions.js";
import { createPrdVersion, ensureVersionBootstrapped } from "../../services/prdVersions.js";
import { QUESTION_FORM_END, QUESTION_FORM_START } from "../../services/prompts.js";
import {
	initSse,
	writeDelta,
	writeDone,
	writeError,
	writeForm,
	writePrdProgress,
	writePrdReady,
	writePrdVersionsChanged,
	writeSectionEditDelta,
	writeSectionEditDone,
	writeSectionEditError,
	writeSectionElementPatchStart,
	writeSessionModulesUpdated,
	writeThinking,
} from "../../services/sse.js";
import {
	appendInterruptMarker,
	getLastUserMessage,
	removeLastInterruptedAssistant,
} from "../../services/pipelineState.js";
import { runWithLlmConfig, type LlmRuntimeConfig } from "../../services/llm.js";
import { readLlmFromBody } from "./helpers/llm.js";
import { finalizePrd } from "./helpers/prdFinalize.js";

type RetryMode = "retry_last" | "continue_agent" | "continue_prd" | "retry_section";

const INSERT_MESSAGE_SQL =
	"INSERT INTO messages (id, session_id, role, content, thinking, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)";

const MAX_ELEMENT_HTML = 20_000;

function insertMessage(
	sessionId: string,
	role: "user" | "assistant",
	content: string,
	thinking = "",
	meta: Record<string, unknown> = {},
): string {
	const id = uuidv4();
	const now = Date.now();
	const db = getDb();
	db.prepare(INSERT_MESSAGE_SQL).run(
		id,
		sessionId,
		role,
		content,
		thinking,
		JSON.stringify(meta),
		now,
	);
	db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, sessionId);
	return id;
}

function optionalString(value: unknown, max: number): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

/** 前端 chip 目标；只做形状校验，模块存在性由工具在执行时校验 */
function parseTarget(raw: unknown): ComposerTarget | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	const sectionId = optionalString(r.sectionId, 128);
	if (!sectionId) return null;
	const target: ComposerTarget = { sectionId };
	const sectionTitle = optionalString(r.sectionTitle, 60);
	const elementLabel = optionalString(r.elementLabel, 60);
	const selectedElementHtml = optionalString(r.selectedElementHtml, MAX_ELEMENT_HTML);
	const entityName = optionalString(r.entityName, 64);
	if (sectionTitle) target.sectionTitle = sectionTitle;
	if (elementLabel) target.elementLabel = elementLabel;
	if (selectedElementHtml) target.selectedElementHtml = selectedElementHtml;
	if (entityName && /^[\w\u4e00-\u9fa5-]{1,64}$/.test(entityName)) {
		target.entityName = entityName;
	}
	const tp = r.tablePath as Record<string, unknown> | undefined;
	if (tp && typeof tp === "object" && ["row", "cell", "cells"].includes(String(tp.kind))) {
		target.tablePath = tp as unknown as ComposerTarget["tablePath"];
	}
	return target;
}

function parseConfirmAction(
	raw: unknown,
): { token: string; decision: ConfirmDecision } | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	const token = optionalString(r.token, 64);
	const decision = r.decision as ConfirmDecision;
	if (!token || !CONFIRM_DECISIONS.includes(decision)) return null;
	return { token, decision };
}

function assistantMeta(recorder: TurnRecorder): Record<string, unknown> {
	const meta: Record<string, unknown> = {};
	if (recorder.edits.length > 0) {
		meta.kind = "prd_edit";
		meta.edits = recorder.edits;
	}
	if (recorder.pendingAction) meta.pendingAction = recorder.pendingAction;
	return meta;
}

/** 表单以标记块存入 content，仅用于前端刷新后还原（模型不输出该标记） */
function withFormBlock(content: string, recorder: TurnRecorder): string {
	if (!recorder.form) return content;
	return `${content.trimEnd()}\n\n${QUESTION_FORM_START}${JSON.stringify(recorder.form)}${QUESTION_FORM_END}`.trim();
}

interface AgentTurnOptions {
	sessionId: string;
	userMessage: string;
	target: ComposerTarget | null;
	llmConfig: LlmRuntimeConfig | undefined;
	locale: Locale;
	partialReply?: string;
	priorThinking?: string;
}

/** 运行一轮编排 Agent：事件 → SSE，结束后落库助手消息并收尾。 */
async function streamAgentTurn(
	res: Response,
	stopHeartbeat: () => void,
	opts: AgentTurnOptions,
): Promise<void> {
	const { sessionId } = opts;
	const recorder = createTurnRecorder();
	const controller = new AbortController();
	// res 的 close 才代表连接断开（req 的 close 在请求体读完后就会触发）
	res.on("close", () => {
		if (!res.writableEnded) controller.abort(new Error("connection_lost"));
	});

	let visible = opts.partialReply ?? "";
	let thinking = opts.priorThinking ?? "";
	let seq = 0;

	const onEvent = (evt: OrchestratorEvent) => {
		if (evt.type === "delta") visible += evt.content;
		if (evt.type === "thinking") thinking += evt.content;
		if (evt.type === "form" && evt.data.intro && !visible.trim()) {
			visible += evt.data.intro;
			if (!res.writableEnded) writeDelta(res, evt.data.intro, seq++);
		}
		if (res.writableEnded) return;
		switch (evt.type) {
			case "delta":
				return writeDelta(res, evt.content, seq++);
			case "thinking":
				return writeThinking(res, evt.content, seq++);
			case "form":
				return writeForm(res, evt.data);
			case "prd_progress":
				return writePrdProgress(res, evt.sectionId, evt.status);
			case "section_patch_start":
				return writeSectionElementPatchStart(res, evt.sectionId);
			case "section_edit_delta":
				return writeSectionEditDelta(res, evt.sectionId, evt.content);
			case "section_edit_done":
				return writeSectionEditDone(
					res,
					evt.sectionId,
					evt.newHtml,
					evt.version,
					evt.assembledPrdHtml,
					evt.elementLabel,
				);
			case "section_edit_error":
				return writeSectionEditError(res, evt.sectionId, evt.message);
			case "session_modules_updated":
				return writeSessionModulesUpdated(res, evt.selectedModules);
		}
	};

	try {
		await runWithLlmConfig(opts.llmConfig, () =>
			getAgentDriver().runTurn(
				{
					sessionId,
					userMessage: opts.userMessage,
					target: opts.target,
					locale: opts.locale,
					partialReply: opts.partialReply,
					signal: controller.signal,
					recorder,
				},
				onEvent,
			),
		);

		const assistantId = insertMessage(
			sessionId,
			"assistant",
			withFormBlock(visible, recorder),
			thinking,
			assistantMeta(recorder),
		);
		if (res.writableEnded) return;
		stopHeartbeat();
		const prd = recorder.prd;
		if (prd?.status === "failed") {
			writeError(res, prd.message, {
				retryable: true,
				reason: prd.reason,
				suggestedMode: "continue_prd",
			});
		} else if (prd?.status === "ready") {
			writePrdReady(res, prd.prdId, prd.warnings.length > 0 ? prd.warnings : undefined);
			writeDone(res, true, assistantId);
		} else {
			writeDone(res, false, assistantId);
		}
	} catch (err) {
		stopHeartbeat();
		const message = err instanceof Error ? err.message : String(err);
		const reason = message.includes("idle")
			? "idle_timeout"
			: res.writableEnded || controller.signal.aborted
				? "connection_lost"
				: "agent_error";

		if (visible.length > 20 || thinking.length > 0 || recorder.edits.length > 0) {
			insertMessage(
				sessionId,
				"assistant",
				appendInterruptMarker(visible, reason),
				thinking,
				assistantMeta(recorder),
			);
		}
		if (!res.writableEnded) {
			writeError(res, message, {
				retryable: true,
				reason,
				suggestedMode: recorder.generationStarted
					? "continue_prd"
					: visible.length > 20
						? "continue_agent"
						: "retry_last",
			});
		}
	}
}

/** 确认卡片提交：凭 token 直接执行整份重新生成，不经模型。 */
async function handleConfirmAction(
	res: Response,
	sessionId: string,
	confirm: { token: string; decision: ConfirmDecision },
	llmConfig: LlmRuntimeConfig | undefined,
): Promise<void> {
	const lookup = lookupPendingAction(sessionId, confirm.token);
	if (!lookup.ok) {
		res.status(409).json({ error: lookup.message });
		return;
	}
	const { action, messageId } = lookup;
	setPendingActionStatus(messageId, confirm.decision === "cancel" ? "cancelled" : "consumed");
	insertMessage(sessionId, "user", confirmOptionText(confirm.decision), "", {
		confirmAction: { decision: confirm.decision },
	});

	const stopHeartbeat = initSse(res);
	if (confirm.decision === "cancel") {
		const text = "已取消，PRD 保持不变。";
		insertMessage(sessionId, "assistant", text);
		writeDelta(res, text);
		stopHeartbeat();
		writeDone(res, false);
		return;
	}

	const controller = new AbortController();
	res.on("close", () => {
		if (!res.writableEnded) controller.abort(new Error("connection_lost"));
	});

	let text = "好的，开始整份重新生成 PRD。";
	if (confirm.decision === "save_version_then_regenerate") {
		// 先物化 v1 再复制，否则旧内容只存在于新激活版本、下次写回时会被覆盖
		ensureVersionBootstrapped(action.prdId, sessionId);
		const created = createPrdVersion(action.prdId, sessionId, {
			mode: "duplicate",
			label: "整份重新生成",
		});
		writePrdVersionsChanged(res, created.id, created.version);
		text = `已把原内容保留在上一个版本，并新建 v${created.version} 开始整份重新生成 PRD。`;
	}
	writeDelta(res, text);

	try {
		const outcome = await runWithLlmConfig(llmConfig, () =>
			runPrdPipeline(
				sessionId,
				(sid, status) => {
					if (!res.writableEnded) writePrdProgress(res, sid, status);
				},
				controller.signal,
			),
		);
		insertMessage(sessionId, "assistant", text);
		if (res.writableEnded) return;
		stopHeartbeat();
		if (outcome.status === "ready") {
			writePrdReady(res, outcome.prdId, outcome.warnings.length > 0 ? outcome.warnings : undefined);
			writeDone(res, true);
		} else {
			writeError(res, outcome.message, {
				retryable: true,
				reason: outcome.reason,
				suggestedMode: "continue_prd",
			});
		}
	} catch (err) {
		insertMessage(sessionId, "assistant", text);
		stopHeartbeat();
		if (!res.writableEnded) {
			writeError(res, err instanceof Error ? err.message : String(err), {
				retryable: true,
				reason: "prd_generation_failed",
				suggestedMode: "continue_prd",
			});
		}
	}
}

export function registerMessages(router: IRouter): void {
	// ─── POST /api/sessions/:id/messages ─────────────────────────────────────
	router.post("/:id/messages", async (req, res) => {
		const db = getDb();
		const sessionId = req.params.id;

		if (!db.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId)) {
			res.status(404).json({ error: "Session not found" });
			return;
		}

		// ── 断线重连：客户端携带 Last-Event-ID 时重放最近已完成消息 ──────────
		const lastEventId = req.headers["last-event-id"];
		if (lastEventId !== undefined && lastEventId !== "") {
			type AssistantRow = { id: string; content: string; thinking: string };
			const latestAssistant = db
				.prepare(
					`SELECT id, content, thinking FROM messages
         WHERE session_id = ? AND role = 'assistant'
         ORDER BY created_at DESC LIMIT 1`,
				)
				.get(sessionId) as AssistantRow | undefined;

			if (latestAssistant) {
				initSse(res);
				if (latestAssistant.thinking) {
					writeThinking(res, latestAssistant.thinking);
				}
				writeDelta(res, latestAssistant.content);
				writeDone(res, false);
				return;
			}
		}

		const userContent: string = req.body?.content ?? "";
		if (!userContent.trim()) {
			res.status(400).json({ error: "content is required" });
			return;
		}

		let llmConfig: LlmRuntimeConfig | undefined;
		try {
			llmConfig = readLlmFromBody(req.body);
		} catch (err) {
			res.status(400).json({
				error: err instanceof Error ? err.message : String(err),
			});
			return;
		}

		const confirm = parseConfirmAction(req.body?.confirmAction);
		if (confirm) {
			await handleConfirmAction(res, sessionId, confirm, llmConfig);
			return;
		}

		const target = parseTarget(req.body?.target);
		insertMessage(
			sessionId,
			"user",
			userContent,
			"",
			target
				? {
						citation: {
							sectionId: target.sectionId,
							sectionTitle: target.sectionTitle,
							elementLabel: target.elementLabel,
						},
					}
				: {},
		);

		// 首条消息作为会话标题
		const { cnt } = db
			.prepare("SELECT COUNT(*) as cnt FROM messages WHERE session_id = ?")
			.get(sessionId) as { cnt: number };
		if (cnt === 1) {
			db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(
				userContent.slice(0, 60),
				sessionId,
			);
		}

		const stopHeartbeat = initSse(res);
		await streamAgentTurn(res, stopHeartbeat, {
			sessionId,
			userMessage: userContent,
			target,
			llmConfig,
			locale: getLocale(req),
		});
	});

	// ─── POST /api/sessions/:id/messages/retry ────────────────────────────────
	router.post("/:id/messages/retry", async (req, res) => {
		const db = getDb();
		const sessionId = req.params.id;
		const mode = (req.body?.mode ?? "") as RetryMode;
		const sectionId = req.body?.sectionId as string | undefined;

		if (!db.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId)) {
			res.status(404).json({ error: "Session not found" });
			return;
		}

		const validModes: RetryMode[] = [
			"retry_last",
			"continue_agent",
			"continue_prd",
			"retry_section",
		];
		if (!validModes.includes(mode)) {
			res.status(400).json({ error: `mode 必须是 ${validModes.join(" | ")}` });
			return;
		}

		let llmConfig: LlmRuntimeConfig | undefined;
		try {
			llmConfig = readLlmFromBody(req.body);
		} catch (err) {
			res.status(400).json({
				error: err instanceof Error ? err.message : String(err),
			});
			return;
		}

		const stopHeartbeat = initSse(res);

		// ── 模式：retry_last / continue_agent ────────────────────────────────
		if (mode === "retry_last" || mode === "continue_agent") {
			const lastUserMsg = getLastUserMessage(sessionId);
			if (!lastUserMsg) {
				stopHeartbeat();
				writeError(res, "找不到可重试的用户消息", { retryable: false });
				return;
			}
			const interrupted = removeLastInterruptedAssistant(sessionId);
			const resume = mode === "continue_agent" && interrupted ? interrupted : null;
			await streamAgentTurn(res, stopHeartbeat, {
				sessionId,
				userMessage: lastUserMsg,
				target: null,
				llmConfig,
				locale: getLocale(req),
				partialReply: resume?.content || undefined,
				priorThinking: resume?.thinking || undefined,
			});
			return;
		}

		// ── 模式：continue_prd ───────────────────────────────────────────────
		if (mode === "continue_prd") {
			try {
				await runWithLlmConfig(llmConfig, async () => {
					const prdId = await generateFullPrd(sessionId, (sid, status) => {
						if (!res.writableEnded) writePrdProgress(res, sid, status);
					});
					await finalizePrd(res, sessionId, prdId, stopHeartbeat);
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				if (!res.writableEnded) {
					stopHeartbeat();
					writeError(res, `PRD 生成失败：${msg}`, {
						retryable: true,
						reason: "prd_generation_failed",
						suggestedMode: "continue_prd",
					});
				}
			}
			return;
		}

		// ── 模式：retry_section ──────────────────────────────────────────────
		if (!sectionId) {
			stopHeartbeat();
			writeError(res, "retry_section 需要 sectionId 参数", { retryable: false });
			return;
		}
		try {
			await runWithLlmConfig(llmConfig, async () => {
				const prdId = await generateSingleSection(sessionId, sectionId, (sid, status) => {
					if (!res.writableEnded) writePrdProgress(res, sid, status);
				});
				await finalizePrd(res, sessionId, prdId, stopHeartbeat);
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (!res.writableEnded) {
				stopHeartbeat();
				writeError(res, `模块重试失败：${msg}`, {
					retryable: true,
					reason: "section_retry_failed",
					suggestedMode: "retry_section",
				});
			}
		}
	});
}
