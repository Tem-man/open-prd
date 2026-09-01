import { Router, type IRouter } from "express";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/client.js";
import { runAgentStream } from "../services/agent.js";
import {
	generatePrdOutline,
	getSessionModules,
} from "../services/prdOutline.js";
import {
	generateFullPrd,
	generateSingleSection,
	reassemblePrd,
} from "../services/prd/index.js";
import {
	initSse,
	writeDelta,
	writeDone,
	writeError,
	writeForm,
	writePrdReady,
	writePrdProgress,
	writeSectionEditDelta,
	writeSectionEditDone,
	writeSectionEditError,
	writeSectionElementPatchStart,
} from "../services/sse.js";
import { QUESTION_FORM_START, QUESTION_FORM_END } from "../services/prompts.js";
import { validatePrdHtml } from "../services/prdValidator.js";
import {
	computePipelineState,
	appendInterruptMarker,
	removeLastInterruptedAssistant,
	getLastUserMessage,
} from "../services/pipelineState.js";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import {
	createChatModel,
	parseLlmRuntimeConfig,
	runWithLlmConfig,
	type LlmRuntimeConfig,
} from "../services/llm.js";
import { parse as parseHtml } from "node-html-parser";
import { loadSkill } from "../services/skillLoader.js";

function readLlmFromBody(body: unknown): LlmRuntimeConfig | undefined {
	const llm = (body as { llm?: unknown } | null | undefined)?.llm;
	return parseLlmRuntimeConfig(llm);
}

// ─── 工具：清除 el-selected ────────────────────────────────────────────────────

/**
 * 从 HTML 字符串中去除所有 el-selected class，防止前端选中态被持久化到数据库。
 * 处理三种情况：
 *   class="el-selected"          → class=""  (再去掉空 class)
 *   class="foo el-selected bar"  → class="foo bar"
 *   class="el-selected foo"      → class="foo"
 */
function stripElSelected(html: string): string {
	return html
		.replace(/\bel-selected-cell\b\s*/g, "")
		.replace(/\s+el-selected-cell\b/g, "")
		.replace(/\bel-selected\b\s*/g, "")
		.replace(/\s+el-selected\b/g, "")
		.replace(/class="\s+/g, 'class="')
		.replace(/\s+"/g, '"')
		.replace(/class=""/g, "");
}

// ─── 工具：表格元素类型 ──────────────────────────────────────────────────────────

type TableElementPath =
	| { kind: "row"; tableIndex: number; rowIndex: number }
	| { kind: "cell"; tableIndex: number; rowIndex: number; cellIndex: number }
	| {
			kind: "cells";
			tableIndex: number;
			rowIndex: number;
			cellIndices: number[];
	  };

/**
 * 从 section HTML 中提取第一张 table 的 outerHTML，用于给 LLM 提供表格结构上下文。
 */
/**
 * 从 section HTML 中提取指定序号的 table 的 outerHTML，用于给 LLM 提供表格结构上下文。
 * tableIndex 默认为 0（第一张表），支持功能清单拆分多张表的场景。
 */
function extractParentTableHtml(
	sectionHtml: string,
	tableIndex = 0,
): string | null {
	const root = parseHtml(sectionHtml);
	const tables = root.querySelectorAll("table");
	const table = tables[tableIndex];
	return table ? table.outerHTML : null;
}

/**
 * 按 DOM 坐标精确替换 table 中的 tr / td / th。
 * 在 patchElementInHtml 三层策略之前调用；失败返回 null，调用方降级。
 */
function patchTableElementByPath(
	sectionHtml: string,
	path: TableElementPath,
	newElementHtml: string,
): string | null {
	const root = parseHtml(sectionHtml);
	const tables = root.querySelectorAll("table");
	const table = tables[path.tableIndex ?? 0];
	if (!table) return null;

	const rows = table.querySelectorAll("tr");
	const row = rows[path.rowIndex];
	if (!row) return null;

	if (path.kind === "row") {
		row.replaceWith(parseHtml(newElementHtml).firstChild!);
		return root.toString();
	}

	if (path.kind === "cell") {
		const cells = row.querySelectorAll("td, th");
		const cell = cells[path.cellIndex];
		if (!cell) return null;
		cell.replaceWith(parseHtml(newElementHtml).firstChild!);
		return root.toString();
	}

	// kind === "cells"：newElementHtml 是多个 td/th 的 HTML 拼接，按序逐一替换
	if (path.kind === "cells") {
		const cells = row.querySelectorAll("td, th");
		const newNodes = parseHtml(`<table><tr>${newElementHtml}</tr></table>`);
		const newCells = newNodes.querySelectorAll("td, th");

		path.cellIndices.forEach((cellIdx, i) => {
			const target = cells[cellIdx];
			const replacement = newCells[i];
			if (target && replacement) {
				target.replaceWith(replacement);
			}
		});
		return root.toString();
	}

	return null;
}

// ─── 工具：元素级 HTML 补丁 ────────────────────────────────────────────────────

/**
 * 将 sectionHtml 中与 oldElementHtml 匹配的节点替换为 newElementHtml。
 * 采用三层降级策略：
 *   1. 精确字符串替换（最快，原始 outerHTML 与存储内容完全一致时命中）
 *   2. 归一化空白后字符串替换（应对浏览器微调属性顺序或空格的情况）
 *   3. node-html-parser DOM 比对（按 tagName + 文本内容模糊匹配）
 * 全部失败时返回 null，调用方应 fallback 到全模块重写。
 */
function patchElementInHtml(
	sectionHtml: string,
	oldElementHtml: string,
	newElementHtml: string,
): string | null {
	// 策略 1：精确字符串替换
	if (sectionHtml.includes(oldElementHtml)) {
		// 只替换第一次出现（防止重复替换同一个模板行）
		return sectionHtml.replace(oldElementHtml, newElementHtml);
	}

	// 策略 2：归一化空白后替换
	function normalizeWs(s: string) {
		return s.replace(/\s+/g, " ").trim();
	}
	const normSection = normalizeWs(sectionHtml);
	const normOld = normalizeWs(oldElementHtml);
	if (normSection.includes(normOld)) {
		// 在原始 HTML 上做同等归一化后替换，再还原整体格式
		return sectionHtml.replace(
			new RegExp(normOld.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
			newElementHtml,
		);
	}

	// 策略 3：DOM 节点比对
	try {
		const sectionRoot = parseHtml(sectionHtml);
		const oldRoot = parseHtml(oldElementHtml);
		const oldNode = oldRoot.firstChild;
		if (!oldNode || !("rawTagName" in oldNode)) return null;

		const tagName = (oldNode as { rawTagName: string }).rawTagName;
		const oldText = oldNode.text?.trim() ?? "";
		const candidates = sectionRoot.querySelectorAll(tagName);

		for (const candidate of candidates) {
			if (candidate.text?.trim() === oldText) {
				candidate.replaceWith(parseHtml(newElementHtml).firstChild!);
				return sectionRoot.toString();
			}
		}
		return null;
	} catch {
		return null;
	}
}

const router: IRouter = Router();

// ── 工具：从 section HTML 中提取 Mermaid 实体块文本 ──────────────────────────

/**
 * 从 <div class="mermaid"> 的文本内容中提取指定实体的 Mermaid 块。
 * 实体块格式：  ENTITY_NAME { \n  ...\n  }
 * 返回原始文本（含首尾空白），未找到时返回空字符串。
 */
function extractEntityBlock(sectionHtml: string, entityName: string): string {
	const mermaidMatch = sectionHtml.match(
		/<div[^>]*class="mermaid"[^>]*>([\s\S]*?)<\/div>/i,
	);
	if (!mermaidMatch) return "";
	const mermaidText = mermaidMatch[1];
	const regex = new RegExp(`\\b${entityName}\\s*\\{[^}]*\\}`, "s");
	return mermaidText.match(regex)?.[0].trim() ?? "";
}

/**
 * 从 section HTML 中提取指定实体的 <div class="entity-section"> outerHTML。
 * 通过 <h4 class="entity-table-title"> 的文本匹配实体名，未找到返回 null。
 */
function extractEntitySection(
	sectionHtml: string,
	entityName: string,
): string | null {
	const root = parseHtml(sectionHtml);
	for (const sec of root.querySelectorAll(".entity-section")) {
		if (sec.querySelector(".entity-table-title")?.text.trim() === entityName) {
			return sec.outerHTML;
		}
	}
	return null;
}

/**
 * 将 AI 返回的新实体块和新 entity-section 缝合回 sectionHtml。
 *
 * - 现有实体：字符串替换实体块 + patchElementInHtml 替换 entity-section
 * - 新建实体：在 erDiagram 末尾追加实体块 + 在最后一个 entity-section 之后插入新 div
 */
function applyEntityPatch(
	sectionHtml: string,
	oldEntityBlock: string,
	newEntityBlock: string,
	oldEntitySection: string | null,
	newEntitySection: string,
): string {
	let result = sectionHtml;

	// ① 更新 Mermaid 实体块
	if (oldEntityBlock && result.includes(oldEntityBlock)) {
		result = result.replace(oldEntityBlock, newEntityBlock);
	} else if (!oldEntityBlock) {
		// 新实体：追加到 erDiagram 最后一个 } 之前（即 mermaid div 闭合前）
		result = result.replace(
			/(<div[^>]*class="mermaid"[^>]*>)([\s\S]*?)(<\/div>)/i,
			(_, open, content, close) =>
				`${open}${content.trimEnd()}\n\n    ${newEntityBlock}\n${close}`,
		);
	}

	// ② 更新 entity-section
	if (oldEntitySection) {
		const patched = patchElementInHtml(
			result,
			oldEntitySection,
			newEntitySection,
		);
		if (patched) result = patched;
	} else {
		// 新实体：插入到最后一个 entity-section 之后
		const root = parseHtml(result);
		const allSections = root.querySelectorAll(".entity-section");
		const anchor =
			allSections.length > 0
				? allSections[allSections.length - 1].outerHTML
				: (root.querySelector(".mermaid")?.outerHTML ?? "");
		if (anchor) {
			const pos = result.lastIndexOf(anchor) + anchor.length;
			result =
				result.slice(0, pos) + "\n" + newEntitySection + result.slice(pos);
		}
	}

	return result;
}

// ─── 内部工具 ─────────────────────────────────────────────────────────────────

interface ModuleRow {
	id: string;
	name: string;
	description: string | null;
	is_builtin: 0 | 1;
}
type SelectedModuleEntry = { id: string; name: string; description?: string };

/** 验证 selectedModules 数组，过滤掉 DB 中不存在的 id，并携带 description */
function validateModuleIds(
	db: ReturnType<typeof getDb>,
	ids: string[],
): SelectedModuleEntry[] {
	const result: SelectedModuleEntry[] = [];
	for (const id of ids) {
		const row = db
			.prepare(
				"SELECT id, name, description FROM module_templates WHERE id = ?",
			)
			.get(id) as ModuleRow | undefined;
		if (row) {
			const entry: SelectedModuleEntry = { id: row.id, name: row.name };
			if (row.description) entry.description = row.description;
			result.push(entry);
		}
	}
	return result;
}

/**
 * 从 AI 回复中提取并剥离 [QUESTION_FORM]...[/QUESTION_FORM] 块。
 * 返回 { cleanReply, formData }：
 *   - cleanReply：去掉标记块后的纯文字部分
 *   - formData：解析成功时为 JSON 对象，解析失败时为 null
 */
function extractQuestionForm(reply: string): {
	cleanReply: string;
	formData: unknown | null;
} {
	const startIdx = reply.indexOf(QUESTION_FORM_START);
	const endIdx = reply.indexOf(QUESTION_FORM_END);
	if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
		return { cleanReply: reply, formData: null };
	}
	const jsonStr = reply
		.slice(startIdx + QUESTION_FORM_START.length, endIdx)
		.trim();
	const cleanReply = (
		reply.slice(0, startIdx) + reply.slice(endIdx + QUESTION_FORM_END.length)
	).trim();
	try {
		const formData = JSON.parse(jsonStr) as unknown;
		return { cleanReply, formData };
	} catch {
		console.warn(
			"[sessions] Failed to parse QUESTION_FORM JSON, falling back to plain text",
		);
		return { cleanReply: reply, formData: null };
	}
}

/**
 * 校验 PRD HTML 并推送 prd_ready / writeDone，
 * 供多个路由复用（原 POST /messages + 新 POST /messages/retry）。
 */
async function finalizePrd(
	res: { writableEnded: boolean },
	db: ReturnType<typeof getDb>,
	sessionId: string,
	prdId: string,
	stopHeartbeat: () => void,
): Promise<void> {
	type PrdRow = { html: string };
	const prdRow = db.prepare("SELECT html FROM prds WHERE id = ?").get(prdId) as
		| PrdRow
		| undefined;

	if (!prdRow?.html) {
		stopHeartbeat();
		writeError(
			res as import("express").Response,
			"PRD 内容写入异常，无法读取生成结果",
			{
				retryable: true,
				reason: "prd_write_error",
				suggestedMode: "continue_prd",
			},
		);
		return;
	}

	type SessionModuleRow = { selected_modules: string | null };
	const sessionRow = db
		.prepare("SELECT selected_modules FROM sessions WHERE id = ?")
		.get(sessionId) as SessionModuleRow | undefined;

	let expectedSectionCount = 0;
	if (sessionRow?.selected_modules) {
		try {
			const mods = JSON.parse(sessionRow.selected_modules) as unknown[];
			expectedSectionCount = mods.length;
		} catch {
			/* ignore */
		}
	}

	const { hardErrors, warnings } = validatePrdHtml(
		prdRow.html,
		expectedSectionCount,
	);

	if (hardErrors.length > 0) {
		stopHeartbeat();
		writeError(
			res as import("express").Response,
			`PRD 结构校验失败：\n• ${hardErrors.join("\n• ")}`,
			{
				retryable: true,
				reason: "prd_validation_failed",
				suggestedMode: "continue_prd",
			},
		);
		return;
	}

	if (!res.writableEnded) {
		stopHeartbeat();
		writePrdReady(
			res as import("express").Response,
			prdId,
			warnings.length > 0 ? warnings : undefined,
		);
		writeDone(res as import("express").Response, true);
	}
}

/** 将 session 行的 selected_modules 字段解析为前端格式 */
function parseSelectedModules(
	raw: string | null,
): SelectedModuleEntry[] | undefined {
	if (!raw) return undefined;
	try {
		return JSON.parse(raw) as SelectedModuleEntry[];
	} catch {
		return undefined;
	}
}

// 创建一个新PRD时调用这个接口
// ─── POST /api/sessions ───────────────────────────────────────────────────────
router.post("/", (req, res) => {
	const db = getDb();
	const id = uuidv4();
	const now = Date.now();
	const title = (req.body?.title as string | undefined) ?? "";
	const rawIds: unknown = req.body?.selectedModules;

	let selectedModulesJson: string | null = null;
	if (Array.isArray(rawIds) && rawIds.length > 0) {
		const valid = validateModuleIds(db, rawIds as string[]);
		if (valid.length > 0) {
			selectedModulesJson = JSON.stringify(valid);
		}
	}

	db.prepare(
		"INSERT INTO sessions (id, title, selected_modules, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
	).run(id, title, selectedModulesJson, now, now);

	const selectedModules = parseSelectedModules(selectedModulesJson);
	res.status(201).json({ id, title, selectedModules, createdAt: now });
});

// ─── GET /api/sessions ────────────────────────────────────────────────────────
router.get("/", (_req, res) => {
	const db = getDb();
	const sessions = db
		.prepare("SELECT * FROM sessions ORDER BY updated_at DESC")
		.all();
	res.json(sessions);
});

// ─── GET /api/sessions/:id ────────────────────────────────────────────────────
router.get("/:id", (req, res) => {
	const db = getDb();
	const session = db
		.prepare("SELECT * FROM sessions WHERE id = ?")
		.get(req.params.id) as Record<string, unknown> | undefined;

	if (!session) {
		res.status(404).json({ error: "Session not found" });
		return;
	}

	const messages = db
		.prepare(
			"SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC",
		)
		.all(req.params.id);

	const selectedModules = parseSelectedModules(
		session.selected_modules as string | null,
	);
	const pipelineState = computePipelineState(req.params.id);
	res.json({ ...session, selectedModules, messages, pipelineState });
});

// ─── POST /api/sessions/:id/messages ─────────────────────────────────────────
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

	// ── 断线重连：客户端携带 Last-Event-ID 时重放最近已完成消息 ──────────────
	const lastEventId = req.headers["last-event-id"];
	if (lastEventId !== undefined && lastEventId !== "") {
		type AssistantRow = { id: string; content: string };
		const latestAssistant = db
			.prepare(
				`SELECT id, content FROM messages
         WHERE session_id = ? AND role = 'assistant'
         ORDER BY created_at DESC LIMIT 1`,
			)
			.get(sessionId) as AssistantRow | undefined;

		if (latestAssistant) {
			initSse(res);
			// 将完整消息拆成若干 chunk 重放，客户端按 messageId 去重即可
			writeDelta(res, latestAssistant.content);
			writeDone(res, false);
			return;
		}
	}

	// ── 正常对话流程 ──────────────────────────────────────────────────────────
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
	db.prepare(
		"INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
	).run(userMsgId, sessionId, "user", userContent, now);

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
	let streamFinished = false;

	// 客户端提前断开时，保存已累积的部分回复（带中断标记）
	req.on("close", () => {
		if (!streamFinished && partialReply.length > 20) {
			db.prepare(
				"INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
			).run(
				uuidv4(),
				sessionId,
				"assistant",
				appendInterruptMarker(partialReply, "connection_lost"),
				Date.now(),
			);
		}
	});

	await runWithLlmConfig(llmConfig, () =>
		runAgentStream(
			sessionId,
			userContent,
			// onDelta
			(chunk, seq) => {
				partialReply += chunk;
				if (!res.writableEnded) {
					writeDelta(res, chunk, seq);
				}
			},
			// onDone
			async (reply, shouldGeneratePrd) => {
				streamFinished = true;

				// 提取问题表单（存在时推送 form 事件；落库保留标记块以便刷新后还原）
				const { formData } = extractQuestionForm(reply);
				if (formData !== null && !res.writableEnded) {
					writeForm(res, formData);
				}

				// 写入完整助手回复（含 QUESTION_FORM 标记块）
				const assistantMsgId = uuidv4();
				const finishedAt = Date.now();
				db.prepare(
					"INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
				).run(assistantMsgId, sessionId, "assistant", reply, finishedAt);

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
			// onError —— idle 超时等异常，保存 partial 并返回 retryable 错误
			(err) => {
				streamFinished = true;
				stopHeartbeat();

				// 保存 partial（带标记，供续写使用）
				if (partialReply.length > 20) {
					const reason = err.message.includes("idle")
						? "idle_timeout"
						: "agent_error";
					db.prepare(
						"INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
					).run(
						uuidv4(),
						sessionId,
						"assistant",
						appendInterruptMarker(partialReply, reason),
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

// ─── POST /api/sessions/:id/messages/retry ────────────────────────────────────
type RetryMode =
	| "retry_last"
	| "continue_agent"
	| "continue_prd"
	| "retry_section";

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

	// ── 模式：retry_last / continue_agent ────────────────────────────────────
	if (mode === "retry_last" || mode === "continue_agent") {
		const lastUserMsg = getLastUserMessage(sessionId);
		if (!lastUserMsg) {
			stopHeartbeat();
			writeError(res, "找不到可重试的用户消息", { retryable: false });
			return;
		}

		// 取出并删除带中断标记的 assistant 消息（若有）
		const partialContent = removeLastInterruptedAssistant(sessionId);
		// retry_last = 丢弃 partial 重来；continue_agent = 续写
		const partialForResume =
			mode === "continue_agent" ? (partialContent ?? undefined) : undefined;

		let partialReply = partialForResume ?? "";
		let streamFinished = false;

		req.on("close", () => {
			if (!streamFinished && partialReply.length > 20) {
				db.prepare(
					"INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
				).run(
					uuidv4(),
					sessionId,
					"assistant",
					appendInterruptMarker(partialReply, "connection_lost"),
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
				async (reply, shouldGeneratePrd) => {
					streamFinished = true;
					const { formData } = extractQuestionForm(reply);
					if (formData !== null && !res.writableEnded) writeForm(res, formData);

					db.prepare(
						"INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
					).run(uuidv4(), sessionId, "assistant", reply, Date.now());
					db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(
						Date.now(),
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
					const reason = err.message.includes("idle")
						? "idle_timeout"
						: "agent_error";
					if (partialReply.length > 20) {
						db.prepare(
							"INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
						).run(
							uuidv4(),
							sessionId,
							"assistant",
							appendInterruptMarker(partialReply, reason),
							Date.now(),
						);
						db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(
							Date.now(),
							sessionId,
						);
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

	// ── 模式：continue_prd ───────────────────────────────────────────────────
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

	// ── 模式：retry_section ──────────────────────────────────────────────────
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

// ─── PATCH /api/sessions/:id/modules ─────────────────────────────────────────
router.patch("/:id/modules", (req, res) => {
	const db = getDb();
	const sessionId = req.params.id;

	const session = db
		.prepare("SELECT id, outline FROM sessions WHERE id = ?")
		.get(sessionId) as { id: string; outline: string | null } | undefined;

	if (!session) {
		res.status(404).json({ error: "Session not found" });
		return;
	}

	// 检查是否正在生成 PRD（防止生成中修改模块配置）
	if (session.outline) {
		try {
			const outline = JSON.parse(session.outline) as {
				sections?: Array<{ status: string }>;
			};
			const generating = outline.sections?.some(
				(s) => s.status === "generating",
			);
			if (generating) {
				res.status(409).json({ error: "PRD 正在生成中，请稍后再修改模块配置" });
				return;
			}
		} catch {
			/* ignore parse errors */
		}
	}

	const rawIds: unknown = req.body?.selectedModules;
	if (!Array.isArray(rawIds) || rawIds.length === 0) {
		res.status(400).json({ error: "至少需选择一个模块" });
		return;
	}

	const valid = validateModuleIds(db, rawIds as string[]);
	if (valid.length === 0) {
		res.status(400).json({ error: "所有模块 id 均无效" });
		return;
	}

	const now = Date.now();
	db.prepare(
		"UPDATE sessions SET selected_modules = ?, outline = NULL, updated_at = ? WHERE id = ?",
	).run(JSON.stringify(valid), now, sessionId);

	res.json({ selectedModules: valid });
});

// ─── DELETE /api/sessions/:id ─────────────────────────────────────────────────
router.delete("/:id", (req, res) => {
	const db = getDb();
	const session = db
		.prepare("SELECT id FROM sessions WHERE id = ?")
		.get(req.params.id);

	if (!session) {
		res.status(404).json({ error: "Session not found" });
		return;
	}

	db.prepare("DELETE FROM sessions WHERE id = ?").run(req.params.id);
	res.status(204).end();
});

// ─── GET /api/sessions/:id/prd ────────────────────────────────────────────────
router.get("/:id/prd", (req, res) => {
	const db = getDb();
	const prd = db
		.prepare(
			"SELECT * FROM prds WHERE session_id = ? ORDER BY created_at DESC LIMIT 1",
		)
		.get(req.params.id);

	if (!prd) {
		res.status(404).json({ error: "PRD not found for this session" });
		return;
	}

	res.json(prd);
});

// ─── GET /api/sessions/:id/prd/sections ───────────────────────────────────────
router.get("/:id/prd/sections", (req, res) => {
	const db = getDb();
	const sessionId = req.params.id;

	const prd = db
		.prepare(
			"SELECT id FROM prds WHERE session_id = ? ORDER BY created_at DESC LIMIT 1",
		)
		.get(sessionId) as { id: string } | undefined;

	if (!prd) {
		res.status(404).json({ error: "PRD not found for this session" });
		return;
	}

	type SectionRow = {
		id: string;
		section_id: string;
		title: string;
		html_content: string;
		version: number;
	};
	const rows = db
		.prepare(
			`SELECT id, section_id, title, html_content, version
       FROM prd_sections
       WHERE prd_id = ? AND is_current = 1`,
		)
		.all(prd.id) as SectionRow[];

	// 按会话选定的模块顺序排序，与 reassemblePrd 保持一致
	const selectedModules = getSessionModules(sessionId);
	const orderedRows: SectionRow[] = selectedModules
		.map((m) => rows.find((r) => r.section_id === m.id))
		.filter((r): r is SectionRow => r !== undefined);
	// 补上 selectedModules 未覆盖但实际存在的模块（容错）
	for (const r of rows) {
		if (!orderedRows.find((o) => o.section_id === r.section_id)) {
			orderedRows.push(r);
		}
	}

	res.json({
		prdId: prd.id,
		sections: orderedRows.map((r) => ({
			id: r.id,
			sectionId: r.section_id,
			title: r.title,
			html: r.html_content,
			version: r.version,
		})),
	});
});

// ─── PATCH /api/sessions/:id/prd/sections/:sectionId ─────────────────────────
// AI 重写指定模块，SSE 流式返回
router.patch("/:id/prd/sections/:sectionId", async (req, res) => {
	const db = getDb();
	const sessionId = req.params.id;
	const sectionId = req.params.sectionId;
	const instruction =
		(req.body?.instruction as string | undefined)?.trim() ?? "";
	const selectedElementHtml =
		(req.body?.selectedElementHtml as string | undefined)?.trim() ?? "";
	const entityName = (req.body?.entityName as string | undefined)?.trim() ?? "";
	const tablePath = req.body?.tablePath as TableElementPath | undefined;

	if (!instruction) {
		res.status(400).json({ error: "instruction is required" });
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

	const prd = db
		.prepare(
			"SELECT id FROM prds WHERE session_id = ? ORDER BY created_at DESC LIMIT 1",
		)
		.get(sessionId) as { id: string } | undefined;

	if (!prd) {
		res.status(404).json({ error: "PRD not found" });
		return;
	}

	type SectionRow = {
		id: string;
		title: string;
		html_content: string;
		version: number;
	};
	const current = db
		.prepare(
			"SELECT id, title, html_content, version FROM prd_sections WHERE prd_id = ? AND section_id = ? AND is_current = 1",
		)
		.get(prd.id, sectionId) as SectionRow | undefined;

	if (!current) {
		res.status(404).json({ error: "Section not found or not editable" });
		return;
	}

	// 读取最近 6 条对话作为上下文背景
	type MsgRow = { role: string; content: string };
	const recentMsgs = db
		.prepare(
			"SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 6",
		)
		.all(sessionId) as MsgRow[];
	const contextSummary = recentMsgs
		.reverse()
		.map((m) => `[${m.role}]: ${m.content.slice(0, 300)}`)
		.join("\n");

	// ── 分支判断 ──────────────────────────────────────────────────────────────
	// entityName 提供    → ER 实体聚焦重写（Section Rewrite，但只改指定实体）
	// selectedElementHtml → Element Patch 模式（只改选中 HTML 元素）
	// 两者均无           → 全模块 Section Rewrite
	const isEntityFocus = entityName.length > 0;
	const isElementPatch = !isEntityFocus && selectedElementHtml.length > 0;

	// ══ ER 实体聚焦 Patch ════════════════════════════════════════════════════════
	// 只更新 erDiagram 中指定实体块 + 对应的 entity-section div，其余内容完全不动
	if (isEntityFocus) {
		const stopHeartbeat = initSse(res);

		// 从当前 section HTML 中提取实体相关内容
		const oldEntityBlock = extractEntityBlock(current.html_content, entityName);
		const oldEntitySection = extractEntitySection(
			current.html_content,
			entityName,
		);
		const isNewEntity = !oldEntityBlock;

		const entitySystemPrompt = `你是一个专业的 PRD 文档编辑助手，负责修改数据模型中的单个实体。

输出规范（严格遵守）：
- 只输出两段内容，用固定分隔符隔开，不要输出任何其他文字或解释
- ---ENTITY_BLOCK--- 之后：修改后的 Mermaid 实体块（仅实体名 + { } 内容，保持 erDiagram 字段格式）
- ---ENTITY_SECTION--- 之后：修改后的 entity-section HTML（<div class="entity-section"> 结构）`;

		const entityUserPrompt = `实体名：${entityName}${isNewEntity ? "（新实体，需从头创建）" : ""}

当前 Mermaid 实体块：
${oldEntityBlock || "（尚不存在，请新建）"}

当前实体说明区块 HTML：
${oldEntitySection || "（尚不存在，请新建）"}

修改指令：${instruction}

请按格式输出：
---ENTITY_BLOCK---
（修改后的 Mermaid 实体块）
---ENTITY_SECTION---
（修改后的 entity-section HTML）`;

		try {
			writeSectionElementPatchStart(res, sectionId);
			const model = runWithLlmConfig(llmConfig, () => createChatModel());
			const response = await model.invoke([
				new SystemMessage(entitySystemPrompt),
				new HumanMessage(entityUserPrompt),
			]);

			let raw =
				typeof response.content === "string"
					? response.content
					: JSON.stringify(response.content);
			raw = raw
				.replace(/^```(?:html|markdown|md)?\s*/im, "")
				.replace(/\s*```$/m, "")
				.trim();

			const blockMarker = "---ENTITY_BLOCK---";
			const sectionMarker = "---ENTITY_SECTION---";
			const blockIdx = raw.indexOf(blockMarker);
			const secIdx = raw.indexOf(sectionMarker);

			if (blockIdx === -1 || secIdx === -1 || blockIdx >= secIdx) {
				writeSectionEditError(res, sectionId, "AI 返回格式异常，请重试");
				stopHeartbeat();
				writeDone(res, false);
				return;
			}

			const newEntityBlock = raw
				.slice(blockIdx + blockMarker.length, secIdx)
				.trim();
			const newEntitySection = raw.slice(secIdx + sectionMarker.length).trim();

			if (!newEntityBlock || !newEntitySection) {
				writeSectionEditError(res, sectionId, "AI 未返回有效内容，请重试");
				stopHeartbeat();
				writeDone(res, false);
				return;
			}

			// 将两段 patch 缝合回 section HTML
			const patchedSectionHtml = applyEntityPatch(
				current.html_content,
				oldEntityBlock,
				newEntityBlock,
				oldEntitySection,
				newEntitySection,
			);

			const now = Date.now();
			db.prepare(
				"UPDATE prd_sections SET is_current = 0 WHERE prd_id = ? AND section_id = ?",
			).run(prd.id, sectionId);
			db.prepare(
				`INSERT INTO prd_sections (id, prd_id, session_id, section_id, title, html_content, version, is_current, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
			).run(
				uuidv4(),
				prd.id,
				sessionId,
				sectionId,
				current.title,
				patchedSectionHtml,
				current.version + 1,
				now,
				now,
			);

			const assembledHtml = await reassemblePrd(prd.id, sessionId);
			stopHeartbeat();
			if (!res.writableEnded) {
				writeSectionEditDone(
					res,
					sectionId,
					patchedSectionHtml,
					current.version + 1,
					assembledHtml,
				);
				writeDone(res, false);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			stopHeartbeat();
			if (!res.writableEnded) {
				writeSectionEditError(res, sectionId, `编辑失败：${msg}`);
				writeDone(res, false);
			}
		}
		return; // entity focus 分支结束
	}

	const stopHeartbeat = initSse(res);

	// ══ Element Patch 模式 ════════════════════════════════════════════════════
	if (isElementPatch) {
		const elementSystemPrompt = `你是一个 PRD 文档编辑助手。用户选中了一个 HTML 元素，需要按指令修改它。

输出规范（严格遵守）：
- 只输出修改后的那一个 HTML 元素，不要输出任何其他内容
- 保留原有的 CSS class 命名（如 prd-table、badge、mermaid 等）
- 不要输出解释文字或 Markdown 代码块标记
- 直接输出 HTML 元素`;

		// 当选中目标为表格内部元素（tr/td/th）时，附带整张表结构作为上下文，
		// 让 LLM 了解列名和行间关系，生成与整表语义一致的内容；
		// 通过 tableIndex 精确找到选中元素所属的那张表（支持功能清单多张表）
		const parentTableHtml = tablePath
			? extractParentTableHtml(current.html_content, tablePath.tableIndex ?? 0)
			: null;

		// 多格选中时：明确告知 LLM 需逐一输出每个格，数量与顺序必须对应
		const isMultiCells = tablePath?.kind === "cells";
		const multiCellCount =
			isMultiCells && tablePath.kind === "cells"
				? tablePath.cellIndices.length
				: 0;

		const elementUserPrompt =
			tablePath && parentTableHtml
				? isMultiCells
					? `以下是 PRD「${current.title}」模块中的一张表格：
<parent_table>
${parentTableHtml}
</parent_table>

用户选中了同一行中的 ${multiCellCount} 个单元格：
<target_cells>
${selectedElementHtml}
</target_cells>

修改指令：${instruction}

请按顺序输出修改后的 ${multiCellCount} 个单元格 HTML（每个单元格占一行，保持原标签类型 td/th），不要输出整张表格或其他内容：`
					: `以下是 PRD「${current.title}」模块中的一张表格：
<parent_table>
${parentTableHtml}
</parent_table>

用户选中了其中这个元素：
<target_element>
${selectedElementHtml}
</target_element>

修改指令：${instruction}

请只输出修改后的 <target_element> 内容（保持原标签类型 td/th/tr），不要输出整张表格：`
				: `以下是需要修改的 HTML 元素：
<target_element>
${selectedElementHtml}
</target_element>

修改指令：${instruction}

请只输出修改后的 HTML 元素：`;

		try {
			// element patch 响应体较小，用非流式调用
			writeSectionElementPatchStart(res, sectionId);

			const model = runWithLlmConfig(llmConfig, () => createChatModel());
			const response = await model.invoke([
				new SystemMessage(elementSystemPrompt),
				new HumanMessage(elementUserPrompt),
			]);

			let newElementHtml =
				typeof response.content === "string"
					? response.content
					: JSON.stringify(response.content);
			newElementHtml = newElementHtml
				.replace(/^```(?:html|markdown|md)?\s*/im, "")
				.replace(/\s*```$/m, "")
				.trim();

			if (!newElementHtml) {
				writeSectionEditError(res, sectionId, "AI 未返回有效内容，请重试");
				stopHeartbeat();
				writeDone(res, false);
				return;
			}

			// selectedElementHtml 来自前端 DOM，可能含 el-selected，先清理以保证匹配成功
			const cleanSelectedHtml = stripElSelected(selectedElementHtml);

			// 策略 0：坐标定位（tr/td/th 专用，最精确）
			let patchedSectionHtml: string | null = null;
			if (tablePath) {
				patchedSectionHtml = patchTableElementByPath(
					current.html_content,
					tablePath,
					newElementHtml,
				);
				if (!patchedSectionHtml) {
					console.warn(
						`[element-patch] 坐标定位失败，降级到字符串匹配 section=${sectionId}`,
					);
				}
			}

			// 策略 1-3：原有三层字符串/DOM 匹配降级
			if (!patchedSectionHtml) {
				patchedSectionHtml = patchElementInHtml(
					current.html_content,
					cleanSelectedHtml,
					newElementHtml,
				);
			}

			if (!patchedSectionHtml) {
				console.warn(
					`[element-patch] 无法定位目标元素，保留原内容 section=${sectionId}`,
				);
				patchedSectionHtml = current.html_content;
			}

			// 最终存入 DB 前再做一次 el-selected 清理（防止 LLM 意外输出该类）
			patchedSectionHtml = stripElSelected(patchedSectionHtml);

			// 写入新版本
			const now = Date.now();
			db.prepare(
				"UPDATE prd_sections SET is_current = 0 WHERE prd_id = ? AND section_id = ?",
			).run(prd.id, sectionId);
			db.prepare(
				`INSERT INTO prd_sections (id, prd_id, session_id, section_id, title, html_content, version, is_current, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
			).run(
				uuidv4(),
				prd.id,
				sessionId,
				sectionId,
				current.title,
				patchedSectionHtml,
				current.version + 1,
				now,
				now,
			);

			const assembledHtml = await reassemblePrd(prd.id, sessionId);
			stopHeartbeat();
			if (!res.writableEnded) {
				writeSectionEditDone(
					res,
					sectionId,
					patchedSectionHtml,
					current.version + 1,
					assembledHtml,
				);
				writeDone(res, false);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			stopHeartbeat();
			if (!res.writableEnded) {
				writeSectionEditError(res, sectionId, `编辑失败：${msg}`);
				writeDone(res, false);
			}
		}
		return; // element patch 分支结束
	}

	// ══ Section Rewrite 模式（原有逻辑） ══════════════════════════════════════

	// 查询该模块是否关联了自定义 Skill，若有则注入规范到 System Prompt
	type ModuleSkillRow = { skill_name: string | null };
	const moduleSkillRow = db
		.prepare("SELECT skill_name FROM module_templates WHERE id = ?")
		.get(sectionId) as ModuleSkillRow | undefined;

	let skillPart = "";
	if (moduleSkillRow?.skill_name) {
		try {
			skillPart = `\n\n该模块的输出格式规范（必须严格遵循）：\n${loadSkill(moduleSkillRow.skill_name)}`;
		} catch {
			// Skill 文件不存在时静默忽略，不影响编辑功能
		}
	}

	const systemPrompt = `你是一个专业的 PRD 文档编辑助手。你的任务是按照用户指令修改 PRD 指定模块的 HTML 内容。

输出规范（严格遵守）：
- 只输出修改后的 HTML 片段，不含 <!DOCTYPE>、<html>、<head>、<body> 等根标签
- 保留原有的 CSS class 命名（如 prd-table、prd-subsection、badge、mermaid 等）
- 不要输出任何解释、注释或 Markdown 代码块标记
- 直接输出 HTML 内容${skillPart}`;

	const userPrompt = `产品背景（最近对话摘要）：
${contextSummary || "（无）"}

以下是「${current.title}」模块当前的 HTML 内容：
<current_html>
${current.html_content}
</current_html>

修改指令：${instruction}

请输出修改后的完整模块 HTML：`;

	let generated = "";
	try {
		const model = runWithLlmConfig(llmConfig, () => createChatModel());
		const stream = await model.stream([
			new SystemMessage(systemPrompt),
			new HumanMessage(userPrompt),
		]);

		for await (const chunk of stream) {
			const text =
				typeof chunk.content === "string"
					? chunk.content
					: Array.isArray(chunk.content)
						? chunk.content
								.map((c) =>
									typeof c === "string"
										? c
										: ((c as { text?: string }).text ?? ""),
								)
								.join("")
						: "";
			if (text && !res.writableEnded) {
				generated += text;
				writeSectionEditDelta(res, sectionId, text);
			}
		}

		// 剥离可能的代码块包裹
		generated = generated
			.replace(/^```(?:html|markdown|md)?\s*/im, "")
			.replace(/\s*```$/m, "")
			.trim();

		if (!generated) {
			writeSectionEditError(res, sectionId, "AI 未返回有效内容，请重试");
			stopHeartbeat();
			writeDone(res, false);
			return;
		}

		// 写入新版本
		const now = Date.now();
		db.prepare(
			"UPDATE prd_sections SET is_current = 0 WHERE prd_id = ? AND section_id = ?",
		).run(prd.id, sectionId);
		db.prepare(
			`INSERT INTO prd_sections (id, prd_id, session_id, section_id, title, html_content, version, is_current, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
		).run(
			uuidv4(),
			prd.id,
			sessionId,
			sectionId,
			current.title,
			generated,
			current.version + 1,
			now,
			now,
		);

		// 重新组装完整 HTML
		const assembledHtml = await reassemblePrd(prd.id, sessionId);

		stopHeartbeat();
		if (!res.writableEnded) {
			writeSectionEditDone(
				res,
				sectionId,
				generated,
				current.version + 1,
				assembledHtml,
			);
			writeDone(res, false);
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		stopHeartbeat();
		if (!res.writableEnded) {
			writeSectionEditError(res, sectionId, `编辑失败：${msg}`);
			writeDone(res, false);
		}
	}
});

// ─── PUT /api/sessions/:id/prd/sections/:sectionId/content ───────────────────
// 直接保存内联编辑内容
router.put("/:id/prd/sections/:sectionId/content", async (req, res) => {
	const db = getDb();
	const sessionId = req.params.id;
	const sectionId = req.params.sectionId;
	const rawHtml = (req.body?.html as string | undefined)?.trim() ?? "";
	const html = stripElSelected(rawHtml);

	if (!html) {
		res.status(400).json({ error: "html is required" });
		return;
	}

	const prd = db
		.prepare(
			"SELECT id FROM prds WHERE session_id = ? ORDER BY created_at DESC LIMIT 1",
		)
		.get(sessionId) as { id: string } | undefined;

	if (!prd) {
		res.status(404).json({ error: "PRD not found" });
		return;
	}

	type SectionRow = { title: string; version: number };
	const current = db
		.prepare(
			"SELECT title, version FROM prd_sections WHERE prd_id = ? AND section_id = ? AND is_current = 1",
		)
		.get(prd.id, sectionId) as SectionRow | undefined;

	if (!current) {
		res.status(404).json({ error: "Section not found or not editable" });
		return;
	}

	const now = Date.now();
	db.prepare(
		"UPDATE prd_sections SET is_current = 0 WHERE prd_id = ? AND section_id = ?",
	).run(prd.id, sectionId);
	db.prepare(
		`INSERT INTO prd_sections (id, prd_id, session_id, section_id, title, html_content, version, is_current, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
	).run(
		uuidv4(),
		prd.id,
		sessionId,
		sectionId,
		current.title,
		html,
		current.version + 1,
		now,
		now,
	);

	await reassemblePrd(prd.id, sessionId);

	res.json({ version: current.version + 1, updatedAt: now });
});

// ─── POST /api/sessions/:id/prd/sections/:sectionId/rollback ─────────────────
router.post("/:id/prd/sections/:sectionId/rollback", async (req, res) => {
	const db = getDb();
	const sessionId = req.params.id;
	const sectionId = req.params.sectionId;

	const prd = db
		.prepare(
			"SELECT id FROM prds WHERE session_id = ? ORDER BY created_at DESC LIMIT 1",
		)
		.get(sessionId) as { id: string } | undefined;

	if (!prd) {
		res.status(404).json({ error: "PRD not found" });
		return;
	}

	type SectionRow = { id: string; version: number; html_content: string };
	const current = db
		.prepare(
			"SELECT id, version, html_content FROM prd_sections WHERE prd_id = ? AND section_id = ? AND is_current = 1",
		)
		.get(prd.id, sectionId) as SectionRow | undefined;

	if (!current || current.version <= 1) {
		res.status(400).json({ error: "No previous version to rollback to" });
		return;
	}

	const prev = db
		.prepare(
			"SELECT id, html_content FROM prd_sections WHERE prd_id = ? AND section_id = ? AND version = ? AND is_current = 0",
		)
		.get(prd.id, sectionId, current.version - 1) as
		| { id: string; html_content: string }
		| undefined;

	if (!prev) {
		res.status(400).json({ error: "Previous version record not found" });
		return;
	}

	const now = Date.now();
	db.prepare("UPDATE prd_sections SET is_current = 0 WHERE id = ?").run(
		current.id,
	);
	db.prepare(
		"UPDATE prd_sections SET is_current = 1, updated_at = ? WHERE id = ?",
	).run(now, prev.id);

	const assembledHtml = await reassemblePrd(prd.id, sessionId);

	res.json({
		restoredVersion: current.version - 1,
		html: prev.html_content,
		assembledPrdHtml: assembledHtml,
	});
});

export default router;
