/**
 * PRD 版本管理服务（Figma Page 模型）。
 *
 * 核心语义：每个版本是一份独立文档；prds.html + prd_sections 是"当前工作区"。
 * - 切换/新建版本：先把旧激活版本的工作区内容写回其版本行，再用目标版本重建工作区；
 * - 非激活版本的权威内容存放于其行的 html + sections_json；
 * - 版本仅由用户显式创建（新增/克隆），AI 编辑与手动编辑不产生自动快照。
 *
 * 详见 docs/plan-prd-version-management.md。
 */
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/client.js";
import { BUILTIN_MODULES, type PrdVersionRow } from "../db/schema.js";
import { getSessionModules, getOutline } from "./prdOutline.js";
import type { SelectedModule } from "./prompts.js";

/** 版本内存储的单个模块内容（sections_json 元素） */
export interface VersionSection {
	section_id: string;
	title: string;
	html_content: string;
}

/** 版本内存储的对话消息（messages_json 元素；id 在重建工作区时重新生成） */
export interface VersionMessage {
	role: "user" | "assistant";
	content: string;
	created_at: number;
	thinking?: string;
	meta?: string;
}

export interface PrdVersionMeta {
	id: string;
	version: number;
	label: string;
	source: "snapshot" | "blank" | "clone";
	isActive: boolean;
	createdAt: number;
	updatedAt: number;
}

function rowToMeta(row: PrdVersionRow): PrdVersionMeta {
	return {
		id: row.id,
		version: row.version,
		label: row.label,
		source: row.source,
		isActive: row.is_active === 1,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export function getPrdVersionRow(versionId: string): PrdVersionRow | undefined {
	const db = getDb();
	return db
		.prepare("SELECT * FROM prd_versions WHERE id = ?")
		.get(versionId) as PrdVersionRow | undefined;
}

/**
 * 懒引导：PRD 已有内容但没有任何版本时，把当前工作区物化为 v1（激活）。
 * 保证「工作区总有激活版本」的模型一致性；此后版本仍仅由用户显式创建。
 */
export function ensureVersionBootstrapped(prdId: string, sessionId: string): void {
	const db = getDb();
	const count = db
		.prepare("SELECT COUNT(*) AS c FROM prd_versions WHERE prd_id = ?")
		.get(prdId) as { c: number };
	if (count.c > 0) return;
	const sections = readWorkspaceSections(prdId, sessionId);
	if (sections.length === 0) return;
	const prd = db.prepare("SELECT html FROM prds WHERE id = ?").get(prdId) as
		| { html: string }
		| undefined;
	if (!prd?.html?.trim()) return;
	const messages = readWorkspaceMessages(sessionId);
	const now = Date.now();
	db.prepare(
		`INSERT INTO prd_versions (id, prd_id, session_id, version, label, source, html, sections_json, messages_json, is_active, created_at, updated_at)
		 VALUES (?, ?, ?, 1, '当前内容', 'snapshot', ?, ?, ?, 1, ?, ?)`,
	).run(
		uuidv4(),
		prdId,
		sessionId,
		prd.html,
		JSON.stringify(sections),
		JSON.stringify(messages),
		now,
		now,
	);
}

export function listPrdVersions(
	prdId: string,
	sessionId: string,
): PrdVersionMeta[] {
	ensureVersionBootstrapped(prdId, sessionId);
	const db = getDb();
	const rows = db
		.prepare(
			"SELECT * FROM prd_versions WHERE prd_id = ? ORDER BY version DESC",
		)
		.all(prdId) as PrdVersionRow[];
	return rows.map(rowToMeta);
}

/** 读取当前工作区内容（按 selected_modules 顺序，未覆盖模块追加在末尾） */
function readWorkspaceSections(
	prdId: string,
	sessionId: string,
): VersionSection[] {
	const db = getDb();
	type Row = { section_id: string; title: string; html_content: string };
	const rows = db
		.prepare(
			"SELECT section_id, title, html_content FROM prd_sections WHERE prd_id = ? AND is_current = 1",
		)
		.all(prdId) as Row[];
	const selectedModules = getSessionModules(sessionId);
	const ordered: Row[] = selectedModules
		.map((m) => rows.find((r) => r.section_id === m.id))
		.filter((r): r is Row => r !== undefined);
	for (const r of rows) {
		if (!ordered.find((o) => o.section_id === r.section_id)) ordered.push(r);
	}
	return ordered.map((r) => ({
		section_id: r.section_id,
		title: r.title,
		html_content: r.html_content,
	}));
}

/** 读取当前工作区的对话记录（按时间升序） */
function readWorkspaceMessages(sessionId: string): VersionMessage[] {
	const db = getDb();
	return db
		.prepare(
			"SELECT role, content, thinking, meta, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC",
		)
		.all(sessionId) as VersionMessage[];
}

/** 用版本对话快照重建工作区 messages 表（id 重新生成，避免跨会话主键冲突） */
function writeMessagesIntoWorkspace(
	sessionId: string,
	messages: VersionMessage[],
): void {
	const db = getDb();
	db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
	const insert = db.prepare(
		"INSERT INTO messages (id, session_id, role, content, thinking, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
	);
	for (const m of messages) {
		insert.run(
			uuidv4(),
			sessionId,
			m.role,
			m.content,
			m.thinking ?? "",
			m.meta ?? "{}",
			m.created_at,
		);
	}
}

/** 把当前工作区内容（PRD + 模块 + 对话）写回激活版本行（无激活版本时为空操作） */
function writeBackActiveVersion(prdId: string, sessionId: string): void {
	const db = getDb();
	const active = db
		.prepare("SELECT id FROM prd_versions WHERE prd_id = ? AND is_active = 1")
		.get(prdId) as { id: string } | undefined;
	if (!active) return;
	const prd = db.prepare("SELECT html FROM prds WHERE id = ?").get(prdId) as
		| { html: string }
		| undefined;
	if (!prd) return;
	const sections = readWorkspaceSections(prdId, sessionId);
	const messages = readWorkspaceMessages(sessionId);
	db.prepare(
		"UPDATE prd_versions SET html = ?, sections_json = ?, messages_json = ?, updated_at = ? WHERE id = ?",
	).run(
		prd.html,
		JSON.stringify(sections),
		JSON.stringify(messages),
		Date.now(),
		active.id,
	);
}

/**
 * 保护性自动存档：无激活版本但工作区已有内容时（如最后一个版本被删除后），
 * 在执行会破坏工作区的操作（切走/新建空白）前，先把当前内容存为一个快照版本。
 */
function preserveUnversionedWorkspace(prdId: string, sessionId: string): void {
	const db = getDb();
	const active = db
		.prepare("SELECT id FROM prd_versions WHERE prd_id = ? AND is_active = 1")
		.get(prdId);
	if (active) return;
	const prd = db.prepare("SELECT html FROM prds WHERE id = ?").get(prdId) as
		| { html: string }
		| undefined;
	if (!prd?.html?.trim()) return;
	const sections = readWorkspaceSections(prdId, sessionId);
	if (sections.length === 0) return;
	const messages = readWorkspaceMessages(sessionId);
	const now = Date.now();
	const maxRow = db
		.prepare("SELECT MAX(version) AS maxV FROM prd_versions WHERE prd_id = ?")
		.get(prdId) as { maxV: number | null };
	db.prepare(
		`INSERT INTO prd_versions (id, prd_id, session_id, version, label, source, html, sections_json, messages_json, is_active, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, 'snapshot', ?, ?, ?, 0, ?, ?)`,
	).run(
		uuidv4(),
		prdId,
		sessionId,
		(maxRow.maxV ?? 0) + 1,
		"自动保存",
		prd.html,
		JSON.stringify(sections),
		JSON.stringify(messages),
		now,
		now,
	);
}

/** 由版本内容重建 selected_modules */
function buildSelectedModules(sections: VersionSection[]): SelectedModule[] {
	return sections.map((s) => {
		const builtin = BUILTIN_MODULES.find((m) => m.id === s.section_id);
		return {
			id: s.section_id,
			name: s.title,
			description: builtin?.description,
			isBuiltin: !!builtin,
		};
	});
}

/** 同步大纲模块状态：命中的模块置 done；'all-pending' 表示全部重置 */
function syncOutlineStatus(
	sessionId: string,
	sectionIds: string[] | "all-pending",
): void {
	const outline = getOutline(sessionId);
	if (!outline) return;
	const sections = outline.sections.map((s) => ({
		...s,
		status:
			sectionIds === "all-pending"
				? ("pending" as const)
				: sectionIds.includes(s.id)
					? ("done" as const)
					: s.status,
	}));
	const db = getDb();
	db.prepare(
		"UPDATE sessions SET outline = ?, updated_at = ? WHERE id = ?",
	).run(JSON.stringify({ ...outline, sections }), Date.now(), sessionId);
}

/** 用版本内容重建工作区（prd_sections + messages + selected_modules + outline 状态 + prds.html） */
function loadVersionIntoWorkspace(
	version: PrdVersionRow,
	sessionId: string,
): void {
	const db = getDb();
	const now = Date.now();

	// 清空工作区（section 级撤回历史随版本切换重置，见 plan 风险表）
	db.prepare("DELETE FROM prd_sections WHERE prd_id = ?").run(version.prd_id);

	const sections = JSON.parse(
		version.sections_json || "[]",
	) as VersionSection[];
	for (const s of sections) {
		db.prepare(
			`INSERT INTO prd_sections (id, prd_id, session_id, section_id, title, html_content, version, is_current, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
		).run(
			uuidv4(),
			version.prd_id,
			sessionId,
			s.section_id,
			s.title,
			s.html_content,
			now,
			now,
		);
	}

	// 对话记录随版本走：用版本快照重建 messages 表
	const messages = JSON.parse(
		version.messages_json || "[]",
	) as VersionMessage[];
	writeMessagesIntoWorkspace(sessionId, messages);

	if (sections.length > 0) {
		db.prepare(
			"UPDATE sessions SET selected_modules = ?, updated_at = ? WHERE id = ?",
		).run(JSON.stringify(buildSelectedModules(sections)), now, sessionId);
		syncOutlineStatus(
			sessionId,
			sections.map((s) => s.section_id),
		);
	} else {
		// 空白版本：模块选择保持现状；大纲清空（= 全新会话的待规划状态，
		// 避免全 pending 被 computePipelineState 误判为「生成中断」而弹出重试气泡）
		db.prepare(
			"UPDATE sessions SET outline = NULL, updated_at = ? WHERE id = ?",
		).run(now, sessionId);
	}

	db.prepare("UPDATE prds SET html = ?, updated_at = ? WHERE id = ?").run(
		version.html,
		now,
		version.prd_id,
	);
	db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(
		now,
		sessionId,
	);
}

/** 新增版本：duplicate=复制当前内容；blank=空白版本并切换工作区为空壳 */
export function createPrdVersion(
	prdId: string,
	sessionId: string,
	opts: { label?: string; mode: "duplicate" | "blank" },
): { id: string; version: number; assembledPrdHtml: string } {
	const db = getDb();
	return db.transaction(() => {
		// 空白新建会破坏工作区，先保护未版本化的内容
		if (opts.mode === "blank") preserveUnversionedWorkspace(prdId, sessionId);
		// 写回旧激活版本，保证复制/留存的内容最新
		writeBackActiveVersion(prdId, sessionId);

		const now = Date.now();
		const maxRow = db
			.prepare("SELECT MAX(version) AS maxV FROM prd_versions WHERE prd_id = ?")
			.get(prdId) as { maxV: number | null };
		const nextVersion = (maxRow.maxV ?? 0) + 1;

		let html: string;
		let sections: VersionSection[];
		let messages: VersionMessage[];
		let source: "snapshot" | "blank";
		if (opts.mode === "blank") {
			sections = [];
			messages = [];
			// 空白版本 html 置空串：前端据此呈现「新建 PRD」空状态（含进度步骤），
			// 而不是渲染一个无内容的空壳文档
			html = "";
			source = "blank";
		} else {
			const prd = db
				.prepare("SELECT html FROM prds WHERE id = ?")
				.get(prdId) as {
				html: string;
			};
			html = prd.html;
			sections = readWorkspaceSections(prdId, sessionId);
			messages = readWorkspaceMessages(sessionId);
			source = "snapshot";
		}

		const id = uuidv4();
		db.prepare("UPDATE prd_versions SET is_active = 0 WHERE prd_id = ?").run(
			prdId,
		);
		db.prepare(
			`INSERT INTO prd_versions (id, prd_id, session_id, version, label, source, html, sections_json, messages_json, is_active, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
		).run(
			id,
			prdId,
			sessionId,
			nextVersion,
			opts.label ?? "",
			source,
			html,
			JSON.stringify(sections),
			JSON.stringify(messages),
			now,
			now,
		);

		// 空白版本：工作区切换为空壳
		if (opts.mode === "blank") {
			const row = db
				.prepare("SELECT * FROM prd_versions WHERE id = ?")
				.get(id) as PrdVersionRow;
			loadVersionIntoWorkspace(row, sessionId);
		}

		const prdAfter = db
			.prepare("SELECT html FROM prds WHERE id = ?")
			.get(prdId) as {
			html: string;
		};
		return { id, version: nextVersion, assembledPrdHtml: prdAfter.html };
	})();
}

/** 切换版本：写回旧激活版本 → 用目标版本重建工作区 → 翻转激活标志（幂等） */
export function activatePrdVersion(
	versionId: string,
	sessionId: string,
): { assembledPrdHtml: string; activeVersion: number } {
	const db = getDb();
	return db.transaction(() => {
		const target = getPrdVersionRow(versionId);
		if (!target) throw new Error("Version not found");
		if (target.is_active === 1) {
			const prd = db
				.prepare("SELECT html FROM prds WHERE id = ?")
				.get(target.prd_id) as {
				html: string;
			};
			return { assembledPrdHtml: prd.html, activeVersion: target.version };
		}

		preserveUnversionedWorkspace(target.prd_id, sessionId);
		writeBackActiveVersion(target.prd_id, sessionId);
		loadVersionIntoWorkspace(target, sessionId);

		const now = Date.now();
		db.prepare("UPDATE prd_versions SET is_active = 0 WHERE prd_id = ?").run(
			target.prd_id,
		);
		db.prepare(
			"UPDATE prd_versions SET is_active = 1, updated_at = ? WHERE id = ?",
		).run(now, target.id);
		return { assembledPrdHtml: target.html, activeVersion: target.version };
	})();
}

/** 克隆版本：仅复制 PRD 为当前会话的新版本，不复制对话，创建后切换过去 */
export function clonePrdVersion(
	versionId: string,
	sessionId: string,
): { id: string; version: number; assembledPrdHtml: string } {
	const db = getDb();
	return db.transaction(() => {
		const target = getPrdVersionRow(versionId);
		if (!target) throw new Error("Version not found");

		preserveUnversionedWorkspace(target.prd_id, sessionId);
		writeBackActiveVersion(target.prd_id, sessionId);
		const fresh = getPrdVersionRow(versionId) as PrdVersionRow;

		const now = Date.now();
		const maxRow = db
			.prepare("SELECT MAX(version) AS maxV FROM prd_versions WHERE prd_id = ?")
			.get(fresh.prd_id) as { maxV: number | null };
		const nextVersion = (maxRow.maxV ?? 0) + 1;
		const id = uuidv4();

		db.prepare("UPDATE prd_versions SET is_active = 0 WHERE prd_id = ?").run(
			fresh.prd_id,
		);
		db.prepare(
			`INSERT INTO prd_versions (id, prd_id, session_id, version, label, source, html, sections_json, messages_json, is_active, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, 'clone', ?, ?, '[]', 1, ?, ?)`,
		).run(
			id,
			fresh.prd_id,
			sessionId,
			nextVersion,
			`克隆自 v${fresh.version}`,
			fresh.html,
			fresh.sections_json,
			now,
			now,
		);

		const row = db
			.prepare("SELECT * FROM prd_versions WHERE id = ?")
			.get(id) as PrdVersionRow;
		loadVersionIntoWorkspace(row, sessionId);

		return { id, version: nextVersion, assembledPrdHtml: row.html };
	})();
}

/**
 * 删除版本（物理删除）：
 * - 非激活版本：直接删除；
 * - 激活版本：删除后自动切换到最新剩余版本；最后一个版本删除后工作区内容保留。
 */
export function deletePrdVersion(
	versionId: string,
	sessionId: string,
): { ok: true; activatedVersion?: number | null; assembledPrdHtml?: string } {
	const db = getDb();
	return db.transaction(() => {
		const target = getPrdVersionRow(versionId);
		if (!target) throw new Error("Version not found");

		if (target.is_active !== 1) {
			db.prepare("DELETE FROM prd_versions WHERE id = ?").run(versionId);
			return { ok: true as const };
		}

		// 激活版本：工作区内容随删除丢弃（用户已显式确认），切换到最新剩余版本
		db.prepare("DELETE FROM prd_versions WHERE id = ?").run(versionId);
		const next = db
			.prepare(
				"SELECT * FROM prd_versions WHERE prd_id = ? ORDER BY version DESC LIMIT 1",
			)
			.get(target.prd_id) as PrdVersionRow | undefined;

		if (!next) {
			return { ok: true as const, activatedVersion: null };
		}

		loadVersionIntoWorkspace(next, sessionId);
		db.prepare(
			"UPDATE prd_versions SET is_active = 1, updated_at = ? WHERE id = ?",
		).run(Date.now(), next.id);
		const prd = db
			.prepare("SELECT html FROM prds WHERE id = ?")
			.get(target.prd_id) as {
			html: string;
		};
		return {
			ok: true as const,
			activatedVersion: next.version,
			assembledPrdHtml: prd.html,
		};
	})();
}

/** 重命名版本备注 */
export function renamePrdVersion(versionId: string, label: string): void {
	const db = getDb();
	db.prepare(
		"UPDATE prd_versions SET label = ?, updated_at = ? WHERE id = ?",
	).run(label, Date.now(), versionId);
}
