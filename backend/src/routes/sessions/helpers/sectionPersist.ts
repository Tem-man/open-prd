import { v4 as uuidv4 } from "uuid";
import { getDb } from "../../../db/client.js";
import { reassemblePrd } from "../../../services/prd/index.js";

export type CurrentSectionRow = {
	id: string;
	title: string;
	html_content: string;
	version: number;
};

/** 取当前会话最新 PRD 的 id */
export function findLatestPrdId(sessionId: string): string | undefined {
	const db = getDb();
	const prd = db
		.prepare(
			"SELECT id FROM prds WHERE session_id = ? ORDER BY created_at DESC LIMIT 1",
		)
		.get(sessionId) as { id: string } | undefined;
	return prd?.id;
}

export function getCurrentSection(
	prdId: string,
	sectionId: string,
): CurrentSectionRow | undefined {
	const db = getDb();
	return db
		.prepare(
			"SELECT id, title, html_content, version FROM prd_sections WHERE prd_id = ? AND section_id = ? AND is_current = 1",
		)
		.get(prdId, sectionId) as CurrentSectionRow | undefined;
}

/**
 * 将当前 section 标记为历史版本，插入新行，并重新组装整篇 PRD HTML。
 * 供 PATCH 三分支与 PUT content 复用（rollback 不走此路径）。
 */
export async function persistSectionRevision(opts: {
	prdId: string;
	sessionId: string;
	sectionId: string;
	title: string;
	html: string;
	previousVersion: number;
}): Promise<{ version: number; updatedAt: number; assembledHtml: string }> {
	const db = getDb();
	const now = Date.now();
	const version = opts.previousVersion + 1;

	db.prepare(
		"UPDATE prd_sections SET is_current = 0 WHERE prd_id = ? AND section_id = ?",
	).run(opts.prdId, opts.sectionId);
	db.prepare(
		`INSERT INTO prd_sections (id, prd_id, session_id, section_id, title, html_content, version, is_current, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
	).run(
		uuidv4(),
		opts.prdId,
		opts.sessionId,
		opts.sectionId,
		opts.title,
		opts.html,
		version,
		now,
		now,
	);

	const assembledHtml = await reassemblePrd(opts.prdId, opts.sessionId);
	return { version, updatedAt: now, assembledHtml };
}
