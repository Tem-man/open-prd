import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { getDb } from "../db/client.js";
import { createChatModel } from "./llm.js";
import { loadSkill } from "./skillLoader.js";
import {
	extractParentTableHtml,
	patchElementInHtml,
	patchTableElementByPath,
	stripElSelected,
	type TableElementPath,
} from "../routes/sessions/helpers/htmlPatch.js";
import {
	applyEntityPatch,
	extractEntityBlock,
	extractEntitySection,
} from "../routes/sessions/helpers/mermaidEntity.js";
import {
	getCurrentSection,
	persistSectionRevision,
	type CurrentSectionRow,
} from "../routes/sessions/helpers/sectionPersist.js";

/** 可预期的编辑失败（模块不存在、模型输出格式异常等），调用方直接展示 message。 */
export class SectionEditError extends Error {}

export interface SectionEditTarget {
	sessionId: string;
	prdId: string;
	sectionId: string;
	instruction: string;
	signal?: AbortSignal;
}

export interface SectionEditHooks {
	/** 元素 / 实体补丁开始（非流式） */
	onPatchStart?: () => void;
	/** 整模块改写的 HTML 增量 */
	onDelta?: (chunk: string) => void;
}

export interface SectionEditResult {
	sectionId: string;
	title: string;
	html: string;
	version: number;
	assembledHtml: string;
}

function loadSection(target: SectionEditTarget): CurrentSectionRow {
	const current = getCurrentSection(target.prdId, target.sectionId);
	if (!current) throw new SectionEditError("模块不存在或不可编辑");
	return current;
}

function contentToText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((c) =>
				typeof c === "string" ? c : ((c as { text?: string }).text ?? ""),
			)
			.join("");
	}
	return "";
}

function stripCodeFence(raw: string): string {
	return raw
		.replace(/^```(?:html|markdown|md)?\s*/im, "")
		.replace(/\s*```$/m, "")
		.trim();
}

async function persist(
	target: SectionEditTarget,
	current: CurrentSectionRow,
	html: string,
): Promise<SectionEditResult> {
	const persisted = await persistSectionRevision({
		prdId: target.prdId,
		sessionId: target.sessionId,
		sectionId: target.sectionId,
		title: current.title,
		html,
		previousVersion: current.version,
	});
	return {
		sectionId: target.sectionId,
		title: current.title,
		html,
		version: persisted.version,
		assembledHtml: persisted.assembledHtml,
	};
}

/** 最近 6 条对话摘要，作为整模块改写的产品背景 */
export function buildRecentContext(sessionId: string): string {
	const db = getDb();
	const rows = db
		.prepare(
			"SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 6",
		)
		.all(sessionId) as { role: string; content: string }[];
	return rows
		.reverse()
		.map((m) => `[${m.role}]: ${m.content.slice(0, 300)}`)
		.join("\n");
}

// ─── ER 实体聚焦补丁 ─────────────────────────────────────────────────────────

export async function patchEntity(
	target: SectionEditTarget & { entityName: string },
	hooks: SectionEditHooks = {},
): Promise<SectionEditResult & { isNew: boolean }> {
	const current = loadSection(target);
	const { entityName, instruction } = target;

	const oldEntityBlock = extractEntityBlock(current.html_content, entityName);
	const oldEntitySection = extractEntitySection(current.html_content, entityName);
	const isNewEntity = !oldEntityBlock;

	const systemPrompt = `你是一个专业的 PRD 文档编辑助手，负责修改数据模型中的单个实体。

输出规范（严格遵守）：
- 只输出两段内容，用固定分隔符隔开，不要输出任何其他文字或解释
- ---ENTITY_BLOCK--- 之后：修改后的 Mermaid 实体块（仅实体名 + { } 内容，保持 erDiagram 字段格式）
- ---ENTITY_SECTION--- 之后：修改后的 entity-section HTML（<div class="entity-section"> 结构）`;

	const userPrompt = `实体名：${entityName}${isNewEntity ? "（新实体，需从头创建）" : ""}

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

	hooks.onPatchStart?.();
	const response = await createChatModel().invoke(
		[new SystemMessage(systemPrompt), new HumanMessage(userPrompt)],
		{ signal: target.signal },
	);
	const raw = stripCodeFence(contentToText(response.content));

	const blockMarker = "---ENTITY_BLOCK---";
	const sectionMarker = "---ENTITY_SECTION---";
	const blockIdx = raw.indexOf(blockMarker);
	const secIdx = raw.indexOf(sectionMarker);
	if (blockIdx === -1 || secIdx === -1 || blockIdx >= secIdx) {
		throw new SectionEditError("AI 返回格式异常，请重试");
	}
	const newEntityBlock = raw.slice(blockIdx + blockMarker.length, secIdx).trim();
	const newEntitySection = raw.slice(secIdx + sectionMarker.length).trim();
	if (!newEntityBlock || !newEntitySection) {
		throw new SectionEditError("AI 未返回有效内容，请重试");
	}

	const patched = applyEntityPatch(
		current.html_content,
		oldEntityBlock,
		newEntityBlock,
		oldEntitySection,
		newEntitySection,
	);
	return { ...(await persist(target, current, patched)), isNew: isNewEntity };
}

// ─── 元素补丁 ─────────────────────────────────────────────────────────────────

export async function patchElement(
	target: SectionEditTarget & {
		selectedElementHtml: string;
		tablePath?: TableElementPath;
	},
	hooks: SectionEditHooks = {},
): Promise<SectionEditResult> {
	const current = loadSection(target);
	const { selectedElementHtml, tablePath, instruction } = target;

	const systemPrompt = `你是一个 PRD 文档编辑助手。用户选中了一个 HTML 元素，需要按指令修改它。

输出规范（严格遵守）：
- 只输出修改后的那一个 HTML 元素，不要输出任何其他内容
- 保留原有的 CSS class 命名（如 prd-table、badge、mermaid 等）
- 不要输出解释文字或 Markdown 代码块标记
- 直接输出 HTML 元素`;

	// 表格内部元素附带整张表作为上下文，tableIndex 精确定位多表场景
	const parentTableHtml = tablePath
		? extractParentTableHtml(current.html_content, tablePath.tableIndex ?? 0)
		: null;
	const multiCellCount =
		tablePath?.kind === "cells" ? tablePath.cellIndices.length : 0;

	const userPrompt =
		tablePath && parentTableHtml
			? multiCellCount > 0
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

	hooks.onPatchStart?.();
	const response = await createChatModel().invoke(
		[new SystemMessage(systemPrompt), new HumanMessage(userPrompt)],
		{ signal: target.signal },
	);
	const newElementHtml = stripCodeFence(contentToText(response.content));
	if (!newElementHtml) throw new SectionEditError("AI 未返回有效内容，请重试");

	// 前端 DOM 可能带 el-selected，先清理以保证匹配
	const cleanSelectedHtml = stripElSelected(selectedElementHtml);

	let patched: string | null = null;
	if (tablePath) {
		patched = patchTableElementByPath(
			current.html_content,
			tablePath,
			newElementHtml,
		);
		if (!patched) {
			console.warn(
				`[element-patch] 坐标定位失败，降级到字符串匹配 section=${target.sectionId}`,
			);
		}
	}
	if (!patched) {
		patched = patchElementInHtml(
			current.html_content,
			cleanSelectedHtml,
			newElementHtml,
		);
	}
	if (!patched) {
		console.warn(
			`[element-patch] 无法定位目标元素，保留原内容 section=${target.sectionId}`,
		);
		patched = current.html_content;
	}

	return persist(target, current, stripElSelected(patched));
}

// ─── 整模块改写 ───────────────────────────────────────────────────────────────

export async function rewriteSection(
	target: SectionEditTarget,
	hooks: SectionEditHooks = {},
): Promise<SectionEditResult> {
	const current = loadSection(target);
	const db = getDb();

	const moduleSkillRow = db
		.prepare("SELECT skill_name FROM module_templates WHERE id = ?")
		.get(target.sectionId) as { skill_name: string | null } | undefined;

	let skillPart = "";
	if (moduleSkillRow?.skill_name) {
		try {
			skillPart = `\n\n该模块的输出格式规范（必须严格遵循）：\n${loadSkill(moduleSkillRow.skill_name)}`;
		} catch {
			// Skill 文件缺失时不影响编辑
		}
	}

	const systemPrompt = `你是一个专业的 PRD 文档编辑助手。你的任务是按照用户指令修改 PRD 指定模块的 HTML 内容。

输出规范（严格遵守）：
- 只输出修改后的 HTML 片段，不含 <!DOCTYPE>、<html>、<head>、<body> 等根标签
- 保留原有的 CSS class 命名（如 prd-table、prd-subsection、badge、mermaid 等）
- 不要输出任何解释、注释或 Markdown 代码块标记
- 直接输出 HTML 内容${skillPart}`;

	const userPrompt = `产品背景（最近对话摘要）：
${buildRecentContext(target.sessionId) || "（无）"}

以下是「${current.title}」模块当前的 HTML 内容：
<current_html>
${current.html_content}
</current_html>

修改指令：${target.instruction}

请输出修改后的完整模块 HTML：`;

	const stream = await createChatModel().stream(
		[new SystemMessage(systemPrompt), new HumanMessage(userPrompt)],
		{ signal: target.signal },
	);
	let generated = "";
	for await (const chunk of stream) {
		const text = contentToText(chunk.content);
		if (!text) continue;
		generated += text;
		hooks.onDelta?.(text);
	}

	generated = stripCodeFence(generated);
	if (!generated) throw new SectionEditError("AI 未返回有效内容，请重试");
	return persist(target, current, generated);
}
