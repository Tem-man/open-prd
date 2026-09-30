import { tool } from "@langchain/core/tools";
import * as z from "zod";
import { getDb } from "../../db/client.js";
import { getSessionModules } from "../prdOutline.js";
import type { OrchestratorContext } from "../agent/types.js";
import {
	extractEntityNames,
	readCurrentSections,
	resolveSection,
	toPlainText,
} from "./common.js";

export function listSectionsTool(ctx: OrchestratorContext) {
	return tool(
		async () => {
			if (!ctx.prdId) return "当前还没有 PRD 内容。";
			const modules = getSessionModules(ctx.sessionId);
			const rows = readCurrentSections(ctx.prdId);
			const sections = modules.map((m) => {
				const row = rows.find((r) => r.section_id === m.id);
				if (!row) return { id: m.id, title: m.name, generated: false };
				const entities = extractEntityNames(row.html_content);
				return {
					id: m.id,
					title: row.title,
					summary: toPlainText(row.html_content, 150),
					...(entities.length > 0 ? { entities } : {}),
				};
			});
			const selected = new Set(modules.map((m) => m.id));
			const templates = getDb()
				.prepare("SELECT id, name FROM module_templates ORDER BY is_builtin DESC, created_at ASC")
				.all() as { id: string; name: string }[];
			const availableTemplates = templates.filter((t) => !selected.has(t.id));
			return JSON.stringify({ sections, availableTemplates });
		},
		{
			name: "list_sections",
			description:
				"列出当前 PRD 各模块的 id、标题、内容摘要（数据模型附实体名列表），以及模块库中尚未加入本 PRD 的模块。",
			schema: z.object({}),
		},
	);
}

export function getSectionTool(ctx: OrchestratorContext) {
	return tool(
		async ({ sectionId, includeHtml }) => {
			const resolved = resolveSection(ctx, sectionId);
			if (typeof resolved === "string") return resolved;
			const { row } = resolved;
			return JSON.stringify({
				id: row.section_id,
				title: row.title,
				version: row.version,
				text: toPlainText(row.html_content, 4000),
				...(includeHtml
					? {
							html:
								row.html_content.length > 6000
									? `${row.html_content.slice(0, 6000)}…`
									: row.html_content,
						}
					: {}),
			});
		},
		{
			name: "get_section",
			description: "读取某个 PRD 模块的纯文本内容（可选附带截断的 HTML）。",
			schema: z.object({
				sectionId: z
					.string()
					.describe(`PRD 模块 id，当前可选：${ctx.modules.map((m) => m.id).join(" / ")}`),
				includeHtml: z.boolean().optional(),
			}),
		},
	);
}
