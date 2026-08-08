import { Router, type IRouter, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/client.js";
import type { PrototypeRow } from "../db/schema.js";
import {
	deletePrototypeFile,
	ensurePrototypesDir,
	figFileNameForId,
	readPrototypeFile,
	writePrototypeFileAtomic,
} from "../services/prototypeStore.js";

const router: IRouter = Router();

ensurePrototypesDir();

function rowToJson(row: PrototypeRow) {
	return {
		id: row.id,
		sessionId: row.session_id,
		title: row.title,
		fileName: row.file_name,
		fileSize: row.file_size,
		thumbnail: row.thumbnail,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/** GET /api/prototypes — list index rows only (no .fig reads). */
router.get("/", (_req: Request, res: Response) => {
	const db = getDb();
	const rows = db
		.prepare("SELECT * FROM prototypes ORDER BY updated_at DESC")
		.all() as PrototypeRow[];
	res.json(rows.map(rowToJson));
});

/**
 * POST /api/prototypes — create index row + empty placeholder .fig.
 * Body: { title?: string, sessionId?: string | null }
 */
router.post("/", (req: Request, res: Response) => {
	const db = getDb();
	const id = uuidv4();
	const now = Date.now();
	const title =
		typeof req.body?.title === "string" ? req.body.title.trim() : "";
	const sessionId =
		typeof req.body?.sessionId === "string" && req.body.sessionId
			? req.body.sessionId
			: null;
	const fileName = figFileNameForId(id);

	writePrototypeFileAtomic(fileName, Buffer.alloc(0));

	db.prepare(
		`INSERT INTO prototypes
      (id, session_id, title, file_name, file_size, thumbnail, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, NULL, ?, ?)`,
	).run(id, sessionId, title || "未命名原型", fileName, now, now);

	const row = db
		.prepare("SELECT * FROM prototypes WHERE id = ?")
		.get(id) as PrototypeRow;
	res.status(201).json(rowToJson(row));
});

/** GET /api/prototypes/:id/meta — metadata without binary. */
router.get("/:id/meta", (req: Request, res: Response) => {
	const db = getDb();
	const row = db
		.prepare("SELECT * FROM prototypes WHERE id = ?")
		.get(req.params.id) as PrototypeRow | undefined;
	if (!row) {
		res.status(404).json({ error: "原型不存在" });
		return;
	}
	res.json(rowToJson(row));
});

/**
 * GET /api/prototypes/:id — stream .fig bytes.
 * Missing file → 404 (index/file desync), not 500.
 */
router.get("/:id", (req: Request, res: Response) => {
	const db = getDb();
	const row = db
		.prepare("SELECT * FROM prototypes WHERE id = ?")
		.get(req.params.id) as PrototypeRow | undefined;
	if (!row) {
		res.status(404).json({ error: "原型不存在" });
		return;
	}
	const data = readPrototypeFile(row.file_name);
	if (!data) {
		res.status(404).json({ error: "原型文件缺失" });
		return;
	}
	res.setHeader("Content-Type", "application/octet-stream");
	res.setHeader(
		"Content-Disposition",
		`attachment; filename="${row.file_name}"`,
	);
	res.setHeader("X-Prototype-Title", encodeURIComponent(row.title));
	res.setHeader("X-Prototype-Updated-At", String(row.updated_at));
	res.send(data);
});

/**
 * PUT /api/prototypes/:id — atomic overwrite of .fig + update size/updated_at.
 * Mounted in `index.ts` with `express.raw` before the JSON parser.
 */
export function putPrototypeFig(req: Request, res: Response): void {
	const db = getDb();
	const row = db
		.prepare("SELECT * FROM prototypes WHERE id = ?")
		.get(req.params.id) as PrototypeRow | undefined;
	if (!row) {
		res.status(404).json({ error: "原型不存在" });
		return;
	}

	const body = Buffer.isBuffer(req.body)
		? req.body
		: Buffer.from(req.body ?? new Uint8Array());

	const fileSize = writePrototypeFileAtomic(row.file_name, body);
	const now = Date.now();
	db.prepare(
		"UPDATE prototypes SET file_size = ?, updated_at = ? WHERE id = ?",
	).run(fileSize, now, row.id);

	const updated = db
		.prepare("SELECT * FROM prototypes WHERE id = ?")
		.get(row.id) as PrototypeRow;
	res.json(rowToJson(updated));
}

/**
 * PATCH /api/prototypes/:id — title / thumbnail only (SQLite).
 * Body: { title?: string, thumbnail?: string | null }
 */
router.patch("/:id", (req: Request, res: Response) => {
	const db = getDb();
	const row = db
		.prepare("SELECT * FROM prototypes WHERE id = ?")
		.get(req.params.id) as PrototypeRow | undefined;
	if (!row) {
		res.status(404).json({ error: "原型不存在" });
		return;
	}

	let title = row.title;
	let thumbnail = row.thumbnail;
	if (typeof req.body?.title === "string") {
		title = req.body.title.trim() || title;
	}
	if (req.body?.thumbnail === null) {
		thumbnail = null;
	} else if (typeof req.body?.thumbnail === "string") {
		thumbnail = req.body.thumbnail;
	}

	const now = Date.now();
	db.prepare(
		"UPDATE prototypes SET title = ?, thumbnail = ?, updated_at = ? WHERE id = ?",
	).run(title, thumbnail, now, row.id);

	const updated = db
		.prepare("SELECT * FROM prototypes WHERE id = ?")
		.get(row.id) as PrototypeRow;
	res.json(rowToJson(updated));
});

/**
 * DELETE /api/prototypes/:id — delete index first, then file (tolerate missing file).
 */
router.delete("/:id", (req: Request, res: Response) => {
	const db = getDb();
	const row = db
		.prepare("SELECT * FROM prototypes WHERE id = ?")
		.get(req.params.id) as PrototypeRow | undefined;
	if (!row) {
		res.status(404).json({ error: "原型不存在" });
		return;
	}

	db.prepare("DELETE FROM prototypes WHERE id = ?").run(row.id);
	deletePrototypeFile(row.file_name);
	res.status(204).end();
});

export default router;
