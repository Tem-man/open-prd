import type { IRouter } from "express";
import { getDb } from "../../db/client.js";
import { reassemblePrd } from "../../services/prd/index.js";
import { stripElSelected } from "./helpers/htmlPatch.js";
import {
	findLatestPrdId,
	getCurrentSection,
	persistSectionRevision,
} from "./helpers/sectionPersist.js";

/** 注册 PRD section 变更路由（内容保存、回滚等）。 */
export function registerSectionMutate(router: IRouter): void {
	// ─── PUT /api/sessions/:id/prd/sections/:sectionId/content ───────────────
	// 直接保存内联编辑内容
	router.put("/:id/prd/sections/:sectionId/content", async (req, res) => {
		const sessionId = req.params.id;
		const sectionId = req.params.sectionId;
		const rawHtml = (req.body?.html as string | undefined)?.trim() ?? "";
		const html = stripElSelected(rawHtml);

		if (!html) {
			res.status(400).json({ error: "html is required" });
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

		const persisted = await persistSectionRevision({
			prdId,
			sessionId,
			sectionId,
			title: current.title,
			html,
			previousVersion: current.version,
		});

		res.json({ version: persisted.version, updatedAt: persisted.updatedAt });
	});

	// ─── POST /api/sessions/:id/prd/sections/:sectionId/rollback ─────────────
	router.post("/:id/prd/sections/:sectionId/rollback", async (req, res) => {
		const db = getDb();
		const sessionId = req.params.id;
		const sectionId = req.params.sectionId;

		const prdId = findLatestPrdId(sessionId);
		if (!prdId) {
			res.status(404).json({ error: "PRD not found" });
			return;
		}

		const current = getCurrentSection(prdId, sectionId);
		if (!current || current.version <= 1) {
			res.status(400).json({ error: "No previous version to rollback to" });
			return;
		}

		const prev = db
			.prepare(
				"SELECT id, html_content FROM prd_sections WHERE prd_id = ? AND section_id = ? AND version = ? AND is_current = 0",
			)
			.get(prdId, sectionId, current.version - 1) as
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

		const assembledHtml = await reassemblePrd(prdId, sessionId);

		// 对话式编辑的撤回：在对应助手消息上标记，刷新后撤回栏仍显示「已撤回」
		const messageId = req.body?.messageId;
		if (typeof messageId === "string" && messageId) {
			const row = db
				.prepare("SELECT meta FROM messages WHERE id = ? AND session_id = ?")
				.get(messageId, sessionId) as { meta: string } | undefined;
			if (row) {
				try {
					const meta = JSON.parse(row.meta) as {
						edits?: Array<{ sectionId: string; resultVersion: number; rolledBack?: boolean }>;
					};
					for (const e of meta.edits ?? []) {
						if (e.sectionId === sectionId && e.resultVersion === current.version) {
							e.rolledBack = true;
						}
					}
					db.prepare("UPDATE messages SET meta = ? WHERE id = ?").run(
						JSON.stringify(meta),
						messageId,
					);
				} catch {
					/* meta 损坏时只影响撤回栏展示 */
				}
			}
		}

		res.json({
			restoredVersion: current.version - 1,
			html: prev.html_content,
			assembledPrdHtml: assembledHtml,
		});
	});
}
