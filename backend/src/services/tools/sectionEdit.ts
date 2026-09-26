import { tool } from "@langchain/core/tools";
import * as z from "zod";
import { generateSectionHtml } from "../prd/index.js";
import { getOutline, saveOutline, updateSectionStatus } from "../prdOutline.js";
import {
	patchElement,
	patchEntity,
	rewriteSection,
	SectionEditError,
	type SectionEditHooks,
	type SectionEditResult,
} from "../sectionEditService.js";
import { persistSectionRevision } from "../../routes/sessions/helpers/sectionPersist.js";
import type { EditRecord, OrchestratorContext } from "../agent/types.js";
import { isElementTarget } from "../agent/types.js";
import {
	emitterFor,
	errorMessage,
	readCurrentSections,
	resolveSection,
	type Emit,
} from "./common.js";

const ENTITY_NAME_RE = /^[\w\u4e00-\u9fa5-]{1,64}$/;
const FEEDBACK_PREFIX = "用户反馈：";

function sectionIdSchema(ctx: OrchestratorContext) {
	return z
		.string()
		.describe(`PRD 模块 id，当前可选：${ctx.modules.map((m) => m.id).join(" / ")}`);
}

function hooksFor(emit: Emit, sectionId: string): SectionEditHooks {
	return {
		onPatchStart: () => emit({ type: "section_patch_start", sectionId }),
		onDelta: (content) => emit({ type: "section_edit_delta", sectionId, content }),
	};
}

function recordDone(
	ctx: OrchestratorContext,
	emit: Emit,
	result: SectionEditResult,
	kind: EditRecord["kind"],
	elementLabel?: string,
): void {
	emit({
		type: "section_edit_done",
		sectionId: result.sectionId,
		newHtml: result.html,
		version: result.version,
		assembledPrdHtml: result.assembledHtml,
	});
	ctx.recorder.edits.push({
		sectionId: result.sectionId,
		sectionTitle: result.title,
		resultVersion: result.version,
		kind,
		...(elementLabel ? { elementLabel } : {}),
	});
}

/** 可预期失败回传模型；中止必须继续抛出以结束本轮 */
function failEdit(
	ctx: OrchestratorContext,
	emit: Emit,
	sectionId: string,
	err: unknown,
): string {
	if (ctx.signal.aborted) throw err;
	const message =
		err instanceof SectionEditError ? err.message : `编辑失败：${errorMessage(err)}`;
	emit({ type: "section_edit_error", sectionId, message });
	return message;
}

/** 元素级编辑的轮次里，禁止再整模块改写 / 重写被选中元素所在的模块 */
function elementScopeViolation(ctx: OrchestratorContext, sectionId: string): string | null {
	const t = ctx.target;
	if (!t || !isElementTarget(t) || t.sectionId !== sectionId) return null;
	const label = t.elementLabel ? `${t.sectionTitle ?? sectionId} · ${t.elementLabel}` : sectionId;
	return `用户只选中了「${label}」，该元素已修改完成。不要再改写这个模块的其他内容；如确有必要，请先询问用户。`;
}

export function editSectionTool(ctx: OrchestratorContext) {
	return tool(
		async ({ sectionId: requestedId, instruction }, config) => {
			const pending = ctx.target && !ctx.recorder.targetConsumed ? ctx.target : null;
			// 元素级目标：无论模型填了哪个 sectionId，都落到用户选中的元素上
			const sectionId =
				pending && isElementTarget(pending) ? pending.sectionId : requestedId;
			if (!pending) {
				const violation = elementScopeViolation(ctx, sectionId);
				if (violation) return violation;
			}
			const resolved = resolveSection(ctx, sectionId);
			if (typeof resolved === "string") return resolved;
			const emit = emitterFor(ctx, config);
			const base = {
				sessionId: ctx.sessionId,
				prdId: resolved.prdId,
				sectionId,
				instruction,
				signal: ctx.signal,
			};
			const hooks = hooksFor(emit, sectionId);
			const target = pending?.sectionId === sectionId ? pending : null;

			try {
				let result: SectionEditResult;
				if (target?.entityName) {
					result = await patchEntity({ ...base, entityName: target.entityName }, hooks);
				} else if (target?.selectedElementHtml) {
					result = await patchElement(
						{
							...base,
							selectedElementHtml: target.selectedElementHtml,
							tablePath: target.tablePath,
						},
						hooks,
					);
				} else {
					result = await rewriteSection(base, hooks);
				}
				if (target) ctx.recorder.targetConsumed = true;
				recordDone(ctx, emit, result, "edit", target?.elementLabel);
				return JSON.stringify({
					sectionId,
					title: result.title,
					version: result.version,
					scope: target?.elementLabel ?? "整个模块",
				});
			} catch (err) {
				return failEdit(ctx, emit, sectionId, err);
			}
		},
		{
			name: "edit_section",
			description:
				"按指令修改一个 PRD 模块（局部修改、补充或删除其中的内容）。instruction 写清楚要改什么、改成什么。",
			schema: z.object({
				sectionId: sectionIdSchema(ctx),
				instruction: z.string().min(1).max(2000),
			}),
		},
	);
}

export function editEntityTool(ctx: OrchestratorContext) {
	return tool(
		async ({ entityName, instruction }, config) => {
			if (!ENTITY_NAME_RE.test(entityName)) {
				return "实体名只能包含字母、数字、下划线、中文或连字符（1–64 个字符）。";
			}
			if (!ctx.prdId) return "当前还没有 PRD 内容。";
			const rows = readCurrentSections(ctx.prdId);
			const row =
				rows.find((r) => r.section_id === "dataModel") ??
				rows.find((r) => r.html_content.includes("erDiagram"));
			if (!row) return "当前 PRD 中没有数据模型模块，无法修改实体。";

			const emit = emitterFor(ctx, config);
			try {
				const result = await patchEntity(
					{
						sessionId: ctx.sessionId,
						prdId: ctx.prdId,
						sectionId: row.section_id,
						instruction,
						entityName,
						signal: ctx.signal,
					},
					hooksFor(emit, row.section_id),
				);
				recordDone(ctx, emit, result, "entity", `${entityName}实体`);
				return JSON.stringify({
					entityName,
					isNew: result.isNew,
					sectionId: row.section_id,
					version: result.version,
				});
			} catch (err) {
				return failEdit(ctx, emit, row.section_id, err);
			}
		},
		{
			name: "edit_entity",
			description:
				"修改数据模型中的一个实体（ER 图实体块 + 实体说明表）。实体不存在时会新建。",
			schema: z.object({
				entityName: z.string().min(1).max(64).describe("实体名，如 USER、ORDER"),
				instruction: z.string().min(1).max(2000),
			}),
		},
	);
}

export function regenerateSectionTool(ctx: OrchestratorContext) {
	return tool(
		async ({ sectionId, reason }, config) => {
			const violation = elementScopeViolation(ctx, sectionId);
			if (violation) return violation;
			const resolved = resolveSection(ctx, sectionId);
			if (typeof resolved === "string") return resolved;
			const outline = getOutline(ctx.sessionId);
			if (!outline?.sections.some((s) => s.id === sectionId)) {
				return "该模块缺少大纲要点，无法整章重新生成，请改用 edit_section。";
			}
			if (reason) {
				saveOutline(ctx.sessionId, {
					...outline,
					sections: outline.sections.map((s) =>
						s.id === sectionId
							? {
									...s,
									keyPoints: [
										...s.keyPoints.filter((p) => !p.startsWith(FEEDBACK_PREFIX)),
										`${FEEDBACK_PREFIX}${reason}`,
									],
								}
							: s,
					),
				});
			}

			const emit = emitterFor(ctx, config);
			emit({ type: "section_patch_start", sectionId });
			emit({ type: "prd_progress", sectionId, status: "generating" });
			try {
				const html = await generateSectionHtml(ctx.sessionId, sectionId);
				const persisted = await persistSectionRevision({
					prdId: resolved.prdId,
					sessionId: ctx.sessionId,
					sectionId,
					title: resolved.row.title,
					html,
					previousVersion: resolved.row.version,
				});
				updateSectionStatus(ctx.sessionId, sectionId, "done");
				emit({ type: "prd_progress", sectionId, status: "done" });
				recordDone(
					ctx,
					emit,
					{
						sectionId,
						title: resolved.row.title,
						html,
						version: persisted.version,
						assembledHtml: persisted.assembledHtml,
					},
					"regenerate",
				);
				return JSON.stringify({ sectionId, version: persisted.version });
			} catch (err) {
				// 生成失败不覆盖原内容，恢复状态
				updateSectionStatus(ctx.sessionId, sectionId, "done");
				emit({ type: "prd_progress", sectionId, status: "done" });
				return failEdit(ctx, emit, sectionId, err);
			}
		},
		{
			name: "regenerate_section",
			description:
				"按大纲整章重新生成一个 PRD 模块（用户不满意、要求重写且没有给出具体改动内容时）。reason 填写用户的不满意点，会作为生成要点。",
			schema: z.object({
				sectionId: sectionIdSchema(ctx),
				reason: z.string().max(500).optional(),
			}),
		},
	);
}
