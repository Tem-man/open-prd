import type { IRouter } from "express";
import { getDb } from "../../db/client.js";
import { getSessionModules } from "../../services/prdOutline.js";
import { findLatestPrdId } from "./helpers/sectionPersist.js";

export function registerPrdRead(router: IRouter): void {
	// ─── GET /api/sessions/:id/prd ────────────────────────────────────────────
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

	// ─── GET /api/sessions/:id/prd/sections ───────────────────────────────────
	router.get("/:id/prd/sections", (req, res) => {
		const db = getDb();
		const sessionId = req.params.id;

		const prdId = findLatestPrdId(sessionId);
		if (!prdId) {
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
			.all(prdId) as SectionRow[];

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
			prdId,
			sections: orderedRows.map((r) => ({
				id: r.id,
				sectionId: r.section_id,
				title: r.title,
				html: r.html_content,
				version: r.version,
			})),
		});
	});
}
