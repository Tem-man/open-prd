import type { IRouter } from "express";
import { getDb } from "../../db/client.js";
import { createChatModel, runWithLlmConfig } from "../../services/llm.js";
import { loadSkill } from "../../services/skillLoader.js";
import {
	initSse,
	writeDone,
	writeSectionEditDelta,
	writeSectionEditDone,
	writeSectionEditError,
	writeSectionElementPatchStart,
} from "../../services/sse.js";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { readLlmFromBody } from "./helpers/llm.js";
import {
	extractParentTableHtml,
	patchElementInHtml,
	patchTableElementByPath,
	stripElSelected,
	type TableElementPath,
} from "./helpers/htmlPatch.js";
import {
	applyEntityPatch,
	extractEntityBlock,
	extractEntitySection,
} from "./helpers/mermaidEntity.js";
import {
	findLatestPrdId,
	getCurrentSection,
	persistSectionRevision,
} from "./helpers/sectionPersist.js";

/** 注册 PRD section 编辑路由（AI 重写、元素 Patch 等）。 */
export function registerSectionEdit(router: IRouter): void {
	// ─── PATCH /api/sessions/:id/prd/sections/:sectionId ─────────────────────
	// AI 重写指定模块，SSE 流式返回
	router.patch("/:id/prd/sections/:sectionId", async (req, res) => {
		const db = getDb();
		const sessionId = req.params.id;
		const sectionId = req.params.sectionId;
		const instruction =
			(req.body?.instruction as string | undefined)?.trim() ?? "";
		const selectedElementHtml =
			(req.body?.selectedElementHtml as string | undefined)?.trim() ?? "";
		const entityName =
			(req.body?.entityName as string | undefined)?.trim() ?? "";
		const tablePath = req.body?.tablePath as TableElementPath | undefined;

		if (!instruction) {
			res.status(400).json({ error: "instruction is required" });
			return;
		}

		let llmConfig;
		try {
			llmConfig = readLlmFromBody(req.body);
		} catch (err) {
			res.status(400).json({
				error: err instanceof Error ? err.message : String(err),
			});
			return;
		}

		const prdId = findLatestPrdId(sessionId);
		if (!prdId) {
			res.status(404).json({ error: "PRD not found" });
			return;
		}

		const current = getCurrentSection(prdId, sectionId);
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

		// ── 分支判断 ──────────────────────────────────────────────────────────
		// entityName 提供    → ER 实体聚焦重写（Section Rewrite，但只改指定实体）
		// selectedElementHtml → Element Patch 模式（只改选中 HTML 元素）
		// 两者均无           → 全模块 Section Rewrite
		const isEntityFocus = entityName.length > 0;
		const isElementPatch = !isEntityFocus && selectedElementHtml.length > 0;

		// ══ ER 实体聚焦 Patch ════════════════════════════════════════════════════
		// 只更新 erDiagram 中指定实体块 + 对应的 entity-section div，其余内容完全不动
		if (isEntityFocus) {
			const stopHeartbeat = initSse(res);

			// 从当前 section HTML 中提取实体相关内容
			const oldEntityBlock = extractEntityBlock(
				current.html_content,
				entityName,
			);
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
				const newEntitySection = raw
					.slice(secIdx + sectionMarker.length)
					.trim();

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

				const persisted = await persistSectionRevision({
					prdId,
					sessionId,
					sectionId,
					title: current.title,
					html: patchedSectionHtml,
					previousVersion: current.version,
				});
				stopHeartbeat();
				if (!res.writableEnded) {
					writeSectionEditDone(
						res,
						sectionId,
						patchedSectionHtml,
						persisted.version,
						persisted.assembledHtml,
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

		// ══ Element Patch 模式 ════════════════════════════════════════════════
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
				? extractParentTableHtml(
						current.html_content,
						tablePath.tableIndex ?? 0,
					)
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

				const persisted = await persistSectionRevision({
					prdId,
					sessionId,
					sectionId,
					title: current.title,
					html: patchedSectionHtml,
					previousVersion: current.version,
				});
				stopHeartbeat();
				if (!res.writableEnded) {
					writeSectionEditDone(
						res,
						sectionId,
						patchedSectionHtml,
						persisted.version,
						persisted.assembledHtml,
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

		// ══ Section Rewrite 模式（原有逻辑） ══════════════════════════════════

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

			const persisted = await persistSectionRevision({
				prdId,
				sessionId,
				sectionId,
				title: current.title,
				html: generated,
				previousVersion: current.version,
			});

			stopHeartbeat();
			if (!res.writableEnded) {
				writeSectionEditDone(
					res,
					sectionId,
					generated,
					persisted.version,
					persisted.assembledHtml,
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
}
