import type { IRouter } from "express";
import { runWithLlmConfig } from "../../services/llm.js";
import {
	initSse,
	writeDone,
	writeSectionEditDelta,
	writeSectionEditDone,
	writeSectionEditError,
	writeSectionElementPatchStart,
} from "../../services/sse.js";
import {
	patchElement,
	patchEntity,
	rewriteSection,
	SectionEditError,
	type SectionEditHooks,
	type SectionEditResult,
} from "../../services/sectionEditService.js";
import { readLlmFromBody } from "./helpers/llm.js";
import type { TableElementPath } from "./helpers/htmlPatch.js";
import { findLatestPrdId, getCurrentSection } from "./helpers/sectionPersist.js";

/** 注册 PRD section 编辑路由（AI 重写、元素 Patch 等）。 */
export function registerSectionEdit(router: IRouter): void {
	// ─── PATCH /api/sessions/:id/prd/sections/:sectionId ─────────────────────
	router.patch("/:id/prd/sections/:sectionId", async (req, res) => {
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
		if (!getCurrentSection(prdId, sectionId)) {
			res.status(404).json({ error: "Section not found or not editable" });
			return;
		}

		const stopHeartbeat = initSse(res);
		const hooks: SectionEditHooks = {
			onPatchStart: () => writeSectionElementPatchStart(res, sectionId),
			onDelta: (chunk) => {
				if (!res.writableEnded) writeSectionEditDelta(res, sectionId, chunk);
			},
		};
		const target = { sessionId, prdId, sectionId, instruction };

		try {
			const result: SectionEditResult = await runWithLlmConfig(llmConfig, () =>
				entityName
					? patchEntity({ ...target, entityName }, hooks)
					: selectedElementHtml
						? patchElement({ ...target, selectedElementHtml, tablePath }, hooks)
						: rewriteSection(target, hooks),
			);
			stopHeartbeat();
			if (!res.writableEnded) {
				writeSectionEditDone(
					res,
					sectionId,
					result.html,
					result.version,
					result.assembledHtml,
				);
				writeDone(res, false);
			}
		} catch (err) {
			const msg =
				err instanceof SectionEditError
					? err.message
					: `编辑失败：${err instanceof Error ? err.message : String(err)}`;
			stopHeartbeat();
			if (!res.writableEnded) {
				writeSectionEditError(res, sectionId, msg);
				writeDone(res, false);
			}
		}
	});
}
