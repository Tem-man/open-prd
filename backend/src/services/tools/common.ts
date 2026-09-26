import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { parse as parseHtml } from "node-html-parser";
import { getDb } from "../../db/client.js";
import { getSessionModules } from "../prdOutline.js";
import type { SelectedModule } from "../prompts.js";
import type { OrchestratorContext, OrchestratorEvent } from "../agent/types.js";

export type Emit = (evt: OrchestratorEvent) => void;

/** 优先走 LangGraph custom 流（与模型 token 同队列、保持顺序），测试环境回落到 ctx.emit */
export function emitterFor(ctx: OrchestratorContext, config: unknown): Emit {
	const writer = (config as LangGraphRunnableConfig | undefined)?.writer;
	return writer ? (evt) => writer(evt) : ctx.emit;
}

export interface SectionRow {
	section_id: string;
	title: string;
	html_content: string;
	version: number;
}

export function readCurrentSections(prdId: string): SectionRow[] {
	return getDb()
		.prepare(
			"SELECT section_id, title, html_content, version FROM prd_sections WHERE prd_id = ? AND is_current = 1",
		)
		.all(prdId) as SectionRow[];
}

export type ResolvedSection = {
	prdId: string;
	module: SelectedModule;
	row: SectionRow;
};

/** 按 DB 最新模块列表校验 sectionId；失败返回给模型看的错误文本 */
export function resolveSection(
	ctx: OrchestratorContext,
	sectionId: string,
): ResolvedSection | string {
	const modules = getSessionModules(ctx.sessionId);
	const available = modules.map((m) => `${m.id}（${m.name}）`).join("、");
	const module = modules.find((m) => m.id === sectionId);
	if (!module || !ctx.prdId) {
		return `模块 ${sectionId} 不存在，可用模块：${available}`;
	}
	const row = readCurrentSections(ctx.prdId).find((r) => r.section_id === sectionId);
	if (!row) return `模块「${module.name}」尚未生成内容，可用模块：${available}`;
	return { prdId: ctx.prdId, module, row };
}

export function toPlainText(html: string, maxLength: number): string {
	const text = parseHtml(html)
		.structuredText.replace(/[ \t]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/** 从 erDiagram 源码与实体说明表标题中提取实体名 */
export function extractEntityNames(html: string): string[] {
	const names = new Set<string>();
	const root = parseHtml(html);
	for (const block of root.querySelectorAll(".mermaid")) {
		const code = block.text;
		if (!/erDiagram/.test(code)) continue;
		for (const m of code.matchAll(/^\s*([A-Za-z_][\w-]*)\s*\{/gm)) names.add(m[1]);
	}
	for (const title of root.querySelectorAll(".entity-table-title")) {
		const t = title.text.trim();
		if (t) names.add(t);
	}
	return [...names];
}

export function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
