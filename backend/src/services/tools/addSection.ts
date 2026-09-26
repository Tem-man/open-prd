import { tool } from "@langchain/core/tools";
import * as z from "zod";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../../db/client.js";
import { BUILTIN_MODULES } from "../../db/schema.js";
import { generateSectionHtml } from "../prd/index.js";
import {
	appendSectionOutline,
	getOutline,
	getSessionModules,
	planSectionKeyPoints,
	updateSectionStatus,
} from "../prdOutline.js";
import type { SelectedModule } from "../prompts.js";
import { persistSectionRevision } from "../../routes/sessions/helpers/sectionPersist.js";
import type { OrchestratorContext } from "../agent/types.js";
import { emitterFor, errorMessage } from "./common.js";

type TemplateRow = { id: string; name: string; description: string | null };

function findTemplate(templateId?: string, title?: string): TemplateRow | undefined {
	const db = getDb();
	if (templateId) {
		return db
			.prepare("SELECT id, name, description FROM module_templates WHERE id = ?")
			.get(templateId) as TemplateRow | undefined;
	}
	return db
		.prepare("SELECT id, name, description FROM module_templates WHERE name = ? LIMIT 1")
		.get(title) as TemplateRow | undefined;
}

export function addSectionTool(ctx: OrchestratorContext) {
	return tool(
		async ({ templateId, title, description, afterSectionId, keyPoints }, config) => {
			if (!ctx.prdId) return "当前还没有 PRD 内容。";
			const cleanTitle = title?.trim();
			if (!templateId && !cleanTitle) return "templateId 与 title 至少提供一个。";

			const outline = getOutline(ctx.sessionId);
			if (!outline) {
				return "当前 PRD 缺少大纲（可能来自空白或克隆版本），无法新增章节。";
			}
			if (outline.sections.some((s) => s.status === "generating")) {
				return "PRD 正在生成中，请稍后再新增章节。";
			}

			const modules = getSessionModules(ctx.sessionId);
			if (afterSectionId && !modules.some((m) => m.id === afterSectionId)) {
				return `afterSectionId ${afterSectionId} 不存在，可用模块：${modules.map((m) => m.id).join("、")}`;
			}

			let template = findTemplate(templateId, cleanTitle);
			if (templateId && !template) return `模块库中不存在 id 为 ${templateId} 的模块。`;
			if (template && modules.some((m) => m.id === template!.id)) {
				return `「${template.name}」已在当前 PRD 中，可用 edit_section 修改。`;
			}

			const db = getDb();
			const createdTemplate = !template;
			const entry: SelectedModule = template
				? {
						id: template.id,
						name: template.name,
						...(template.description ? { description: template.description } : {}),
					}
				: {
						id: uuidv4(),
						name: cleanTitle!,
						...(description?.trim() ? { description: description.trim() } : {}),
					};
			if (BUILTIN_MODULES.some((m) => m.id === entry.id)) entry.isBuiltin = true;

			const insertAt = afterSectionId
				? modules.findIndex((m) => m.id === afterSectionId) + 1
				: modules.length;
			const nextModules = [...modules.slice(0, insertAt), entry, ...modules.slice(insertAt)];

			db.transaction(() => {
				if (createdTemplate) {
					db.prepare(
						"INSERT INTO module_templates (id, name, description, is_builtin, created_at) VALUES (?, ?, ?, 0, ?)",
					).run(entry.id, entry.name, entry.description ?? null, Date.now());
				}
				db.prepare(
					"UPDATE sessions SET selected_modules = ?, updated_at = ? WHERE id = ?",
				).run(JSON.stringify(nextModules), Date.now(), ctx.sessionId);
			})();

			const emit = emitterFor(ctx, config);
			emit({ type: "session_modules_updated", selectedModules: nextModules });

			const points =
				keyPoints && keyPoints.length > 0
					? keyPoints
					: await planSectionKeyPoints(ctx.sessionId, entry.name, entry.description);
			appendSectionOutline(
				ctx.sessionId,
				{ id: entry.id, title: entry.name, keyPoints: points },
				afterSectionId,
			);

			updateSectionStatus(ctx.sessionId, entry.id, "generating");
			emit({ type: "prd_progress", sectionId: entry.id, status: "generating" });
			try {
				const html = await generateSectionHtml(ctx.sessionId, entry.id);
				const persisted = await persistSectionRevision({
					prdId: ctx.prdId,
					sessionId: ctx.sessionId,
					sectionId: entry.id,
					title: entry.name,
					html,
					previousVersion: 0,
				});
				updateSectionStatus(ctx.sessionId, entry.id, "done");
				emit({ type: "prd_progress", sectionId: entry.id, status: "done" });
				emit({
					type: "section_edit_done",
					sectionId: entry.id,
					newHtml: html,
					version: persisted.version,
					assembledPrdHtml: persisted.assembledHtml,
				});
				ctx.recorder.edits.push({
					sectionId: entry.id,
					sectionTitle: entry.name,
					resultVersion: persisted.version,
					kind: "add",
				});
				return JSON.stringify({
					sectionId: entry.id,
					title: entry.name,
					version: persisted.version,
					createdTemplate,
				});
			} catch (err) {
				if (ctx.signal.aborted) throw err;
				// 章节已加入模块列表，保持 error 状态以便用户「重试失败模块」
				updateSectionStatus(ctx.sessionId, entry.id, "error");
				emit({ type: "prd_progress", sectionId: entry.id, status: "error" });
				return `新增章节「${entry.name}」生成失败：${errorMessage(err)}`;
			}
		},
		{
			name: "add_section",
			description:
				"为 PRD 新增一个章节（文档结构层面的新章节，如竞品分析、风险评估、里程碑）。优先使用 list_sections 返回的 availableTemplates 中的 templateId；模块库中没有时提供 title 新建。",
			schema: z.object({
				templateId: z.string().optional().describe("模块库中已有模块的 id（优先使用）"),
				title: z.string().min(1).max(30).optional().describe("模块库中没有对应模块时的新章节标题"),
				description: z.string().max(200).optional(),
				afterSectionId: z.string().optional().describe("插入到该模块之后，缺省追加到末尾"),
				keyPoints: z.array(z.string().max(200)).max(8).optional(),
			}),
		},
	);
}
