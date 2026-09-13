import type { IRouter } from "express";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../../db/client.js";
import { runAgentStream } from "../../services/agent.js";
import { generatePrdOutline } from "../../services/prdOutline.js";
import {
	generateFullPrd,
	generateSingleSection,
} from "../../services/prd/index.js";
import {
	initSse,
	writeDelta,
	writeDone,
	writeError,
	writeForm,
	writePrdProgress,
	writeThinking,
} from "../../services/sse.js";
import {
	appendInterruptMarker,
	getLastUserMessage,
	removeLastInterruptedAssistant,
} from "../../services/pipelineState.js";
import { runWithLlmConfig, type LlmRuntimeConfig } from "../../services/llm.js";
import { readLlmFromBody } from "./helpers/llm.js";
import { extractQuestionForm } from "./helpers/questionForm.js";
import { finalizePrd } from "./helpers/prdFinalize.js";

type RetryMode =
	| "retry_last"
	| "continue_agent"
	| "continue_prd"
	| "retry_section";

const INSERT_MESSAGE_SQL =
	"INSERT INTO messages (id, session_id, role, content, thinking, created_at) VALUES (?, ?, ?, ?, ?, ?)";

export function registerMessages(router: IRouter): void {
	// ─── POST /api/sessions/:id/messages ─────────────────────────────────────
	router.post("/:id/messages", async (req, res) => {
		console.log("req.body:", req.body);
		console.log("res:", res);
		const db = getDb();
		const sessionId = req.params.id;

		const session = db
			.prepare("SELECT id FROM sessions WHERE id = ?")
			.get(sessionId);

		if (!session) {
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

		// ── 正常对话流程 ──────────────────────────────────────────────────────
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

		// 写入用户消息
		const userMsgId = uuidv4();
		const now = Date.now();
		db.prepare(INSERT_MESSAGE_SQL).run(
			userMsgId,
			sessionId,
			"user",
			userContent,
			"",
			now,
		);

		// 自动更新会话标题（首条消息摘要）
		const existingCount = (
			db
				.prepare("SELECT COUNT(*) as cnt FROM messages WHERE session_id = ?")
				.get(sessionId) as { cnt: number }
		).cnt;

		if (existingCount === 1) {
			const title = userContent.slice(0, 60);
			db.prepare(
				"UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?",
			).run(title, now, sessionId);
		} else {
			db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(
				now,
				sessionId,
			);
		}

		// 初始化 SSE，返回停止心跳的清理函数
		const stopHeartbeat = initSse(res);

		// 用于流中断时安全落库
		let partialReply = "";
		let partialThinking = "";
		let streamFinished = false;

		// 客户端提前断开时，保存已累积的部分回复（带中断标记）
		req.on("close", () => {
			if (
				!streamFinished &&
				(partialReply.length > 20 || partialThinking.length > 0)
			) {
				db.prepare(INSERT_MESSAGE_SQL).run(
					uuidv4(),
					sessionId,
					"assistant",
					appendInterruptMarker(partialReply, "connection_lost"),
					partialThinking,
					Date.now(),
				);
			}
		});

		await runWithLlmConfig(llmConfig, () =>
			runAgentStream(
				sessionId,
				userContent,
				(chunk, seq) => {
					partialReply += chunk;
					if (!res.writableEnded) {
						writeDelta(res, chunk, seq);
					}
				},
				(chunk, seq) => {
					partialThinking += chunk;
					if (!res.writableEnded) {
						writeThinking(res, chunk, seq);
					}
				},
				async (reply, shouldGeneratePrd, thinking) => {
					streamFinished = true;

					// 提取问题表单（存在时推送 form 事件；落库保留标记块以便刷新后还原）
					const { formData } = extractQuestionForm(reply);
					if (formData !== null && !res.writableEnded) {
						writeForm(res, formData);
					}

					const assistantMsgId = uuidv4();
					const finishedAt = Date.now();
					db.prepare(INSERT_MESSAGE_SQL).run(
						assistantMsgId,
						sessionId,
						"assistant",
						reply,
						thinking,
						finishedAt,
					);

					db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(
						finishedAt,
						sessionId,
					);

					if (shouldGeneratePrd && !res.writableEnded) {
						try {
							await generatePrdOutline(sessionId);
							const prdId = await generateFullPrd(sessionId, (sid, status) => {
								if (!res.writableEnded) writePrdProgress(res, sid, status);
							});
							await finalizePrd(res, db, sessionId, prdId, stopHeartbeat);
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
					} else if (!res.writableEnded) {
						stopHeartbeat();
						writeDone(res, false);
					}
				},
				(err) => {
					streamFinished = true;
					stopHeartbeat();

					if (partialReply.length > 20 || partialThinking.length > 0) {
						const reason = err.message.includes("idle")
							? "idle_timeout"
							: "agent_error";
						db.prepare(INSERT_MESSAGE_SQL).run(
							uuidv4(),
							sessionId,
							"assistant",
							appendInterruptMarker(partialReply, reason),
							partialThinking,
							Date.now(),
						);
						db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(
							Date.now(),
							sessionId,
						);
					}

					if (!res.writableEnded) {
						const reason = err.message.includes("idle")
							? "idle_timeout"
							: "agent_error";
						writeError(res, err.message, {
							retryable: true,
							reason,
							suggestedMode:
								partialReply.length > 20 ? "continue_agent" : "retry_last",
						});
					}
				},
			),
		);
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

			// 取出并删除带中断标记的 assistant 消息（若有）
			const interrupted = removeLastInterruptedAssistant(sessionId);
			const partialForResume =
				mode === "continue_agent" ? (interrupted?.content ?? undefined) : undefined;

			let partialReply = partialForResume ?? "";
			let partialThinking =
				mode === "continue_agent" ? (interrupted?.thinking ?? "") : "";
			let streamFinished = false;

			req.on("close", () => {
				if (
					!streamFinished &&
					(partialReply.length > 20 || partialThinking.length > 0)
				) {
					db.prepare(INSERT_MESSAGE_SQL).run(
						uuidv4(),
						sessionId,
						"assistant",
						appendInterruptMarker(partialReply, "connection_lost"),
						partialThinking,
						Date.now(),
					);
				}
			});

			await runWithLlmConfig(llmConfig, () =>
				runAgentStream(
					sessionId,
					lastUserMsg,
					(chunk, seq) => {
						partialReply += chunk;
						if (!res.writableEnded) writeDelta(res, chunk, seq);
					},
					(chunk, seq) => {
						partialThinking += chunk;
						if (!res.writableEnded) writeThinking(res, chunk, seq);
					},
					async (reply, shouldGeneratePrd, thinking) => {
						streamFinished = true;
						const { formData } = extractQuestionForm(reply);
						if (formData !== null && !res.writableEnded)
							writeForm(res, formData);

						const savedThinking =
							mode === "continue_agent"
								? (interrupted?.thinking ?? "")
								: "";
						db.prepare(INSERT_MESSAGE_SQL).run(
							uuidv4(),
							sessionId,
							"assistant",
							reply,
							savedThinking + thinking,
							Date.now(),
						);
						db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(
							Date.now(),
							sessionId,
						);

						if (shouldGeneratePrd && !res.writableEnded) {
							try {
								await generatePrdOutline(sessionId);
								const prdId = await generateFullPrd(
									sessionId,
									(sid, status) => {
										if (!res.writableEnded) writePrdProgress(res, sid, status);
									},
								);
								await finalizePrd(res, db, sessionId, prdId, stopHeartbeat);
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
						} else if (!res.writableEnded) {
							stopHeartbeat();
							writeDone(res, false);
						}
					},
					(err) => {
						streamFinished = true;
						stopHeartbeat();
						const reason = err.message.includes("idle")
							? "idle_timeout"
							: "agent_error";
						if (partialReply.length > 20 || partialThinking.length > 0) {
							db.prepare(INSERT_MESSAGE_SQL).run(
								uuidv4(),
								sessionId,
								"assistant",
								appendInterruptMarker(partialReply, reason),
								partialThinking,
								Date.now(),
							);
							db.prepare(
								"UPDATE sessions SET updated_at = ? WHERE id = ?",
							).run(Date.now(), sessionId);
						}
						if (!res.writableEnded) {
							writeError(res, err.message, {
								retryable: true,
								reason,
								suggestedMode:
									partialReply.length > 20 ? "continue_agent" : "retry_last",
							});
						}
					},
					{ partialReply: partialForResume },
				),
			);
			return;
		}

		// ── 模式：continue_prd ───────────────────────────────────────────────
		if (mode === "continue_prd") {
			try {
				await runWithLlmConfig(llmConfig, async () => {
					const prdId = await generateFullPrd(sessionId, (sid, status) => {
						if (!res.writableEnded) writePrdProgress(res, sid, status);
					});
					await finalizePrd(res, db, sessionId, prdId, stopHeartbeat);
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
		if (mode === "retry_section") {
			if (!sectionId) {
				stopHeartbeat();
				writeError(res, "retry_section 需要 sectionId 参数", {
					retryable: false,
				});
				return;
			}
			try {
				await runWithLlmConfig(llmConfig, async () => {
					const prdId = await generateSingleSection(
						sessionId,
						sectionId,
						(sid, status) => {
							if (!res.writableEnded) writePrdProgress(res, sid, status);
						},
					);
					await finalizePrd(res, db, sessionId, prdId, stopHeartbeat);
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
			return;
		}
	});
}
