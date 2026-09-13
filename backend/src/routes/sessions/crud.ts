import type { IRouter } from "express";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../../db/client.js";
import { computePipelineState } from "../../services/pipelineState.js";
import {
	parseSelectedModules,
	validateModuleIds,
} from "./helpers/selectedModules.js";

export function registerCrud(router: IRouter): void {
	// 创建一个新PRD时调用这个接口
	// ─── POST /api/sessions ───────────────────────────────────────────────────
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

	// ─── GET /api/sessions ────────────────────────────────────────────────────
	router.get("/", (_req, res) => {
		const db = getDb();
		const sessions = db
			.prepare("SELECT * FROM sessions ORDER BY updated_at DESC")
			.all();
		res.json(sessions);
	});

	// ─── GET /api/sessions/:id ────────────────────────────────────────────────
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

	// ─── PATCH /api/sessions/:id/modules ─────────────────────────────────────
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
					res
						.status(409)
						.json({ error: "PRD 正在生成中，请稍后再修改模块配置" });
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

	// ─── DELETE /api/sessions/:id ─────────────────────────────────────────────
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
}
