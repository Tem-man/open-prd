import { v4 as uuidv4 } from "uuid";
import { getDb } from "../../db/client.js";
import {
	getOutline,
	updateSectionStatus,
	getSessionModules,
	type PrdOutline,
	type SectionId,
	type SectionOutline,
} from "../prdOutline.js";
import { renderPrd, type RendererSection } from "./renderer.js";
import * as background from "./modules/background.js";
import * as userScenario from "./modules/userScenario.js";
import * as featureList from "./modules/featureList.js";
import * as architecture from "./modules/architecture.js";
import * as flowchart from "./modules/flowchart.js";
import * as infoArch from "./modules/infoArch.js";
import * as dataModel from "./modules/dataModel.js";
import * as prototypeBasis from "./modules/prototypeBasis.js";
import * as custom from "./modules/custom.js";

type Generator = { generate: (section: SectionOutline) => Promise<string> };

const BUILTIN_MODULE_MAP: Record<string, Generator> = {
	background,
	userScenario,
	featureList,
	architecture,
	flowchart,
	infoArch,
	dataModel,
	prototypeBasis,
};

function resolveGenerator(sectionId: SectionId): Generator {
	return BUILTIN_MODULE_MAP[sectionId] ?? custom;
}

/**
 * 从 prd_sections 读取已生成模块的 HTML（断点续传用）。
 * 优先用当前会话最新版本；找不到时返回 null，触发重新生成。
 */
function loadCachedSection(sessionId: string, sectionId: SectionId): string | null {
	const db = getDb();
	type Row = { html_content: string };
	const row = db
		.prepare(
			`SELECT ps.html_content FROM prd_sections ps
       INNER JOIN prds p ON p.id = ps.prd_id
       WHERE ps.session_id = ? AND ps.section_id = ? AND ps.is_current = 1
       ORDER BY ps.updated_at DESC LIMIT 1`,
		)
		.get(sessionId, sectionId) as Row | undefined;
	return row?.html_content ?? null;
}

/**
 * 写入/更新 prd_sections 中的单个模块内容（断点写入）。
 */
function upsertPrdSection(
	db: ReturnType<typeof getDb>,
	finalPrdId: string,
	sessionId: string,
	sectionId: SectionId,
	title: string,
	content: string,
): void {
	type Row = { id: string };
	const existing = db
		.prepare(
			"SELECT id FROM prd_sections WHERE prd_id = ? AND section_id = ? AND is_current = 1",
		)
		.get(finalPrdId, sectionId) as Row | undefined;

	const ts = Date.now();
	if (existing) {
		db.prepare(
			"UPDATE prd_sections SET html_content = ?, updated_at = ? WHERE id = ?",
		).run(content, ts, existing.id);
	} else {
		db.prepare(
			`INSERT INTO prd_sections (id, prd_id, session_id, section_id, title, html_content, version, is_current, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
		).run(uuidv4(), finalPrdId, sessionId, sectionId, title, content, ts, ts);
	}
}

/**
 * 将所有已生成模块的结果组装成 HTML，更新 prds 表。
 * 返回 finalPrdId。
 */
function persistResults(
	sessionId: string,
	sessionTitle: string,
	orderedSections: SectionOutline[],
	results: Map<SectionId, string>,
): string {
	const db = getDb();
	const rendererSections: RendererSection[] = orderedSections.map((s) => ({
		id: s.id,
		title: s.title,
		content: results.get(s.id) ?? "",
	}));
	const html = renderPrd(sessionTitle, rendererSections);
	const now = Date.now();

	const existingPrd = db
		.prepare(
			"SELECT id FROM prds WHERE session_id = ? ORDER BY created_at DESC LIMIT 1",
		)
		.get(sessionId) as { id: string } | undefined;

	let finalPrdId: string;
	if (existingPrd) {
		finalPrdId = existingPrd.id;
		db.prepare("UPDATE prds SET html = ?, updated_at = ? WHERE id = ?").run(
			html,
			now,
			finalPrdId,
		);
	} else {
		finalPrdId = uuidv4();
		db.prepare(
			"INSERT INTO prds (id, session_id, html, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
		).run(finalPrdId, sessionId, html, now, now);
	}
	db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, sessionId);

	// 写入各模块独立记录（支持增量 upsert）
	db.transaction(() => {
		for (const s of orderedSections) {
			const content = results.get(s.id);
			if (!content) continue;
			upsertPrdSection(db, finalPrdId, sessionId, s.id, s.title, content);
		}
	})();

	return finalPrdId;
}

export type ProgressCallback = (
	sectionId: SectionId,
	status: Exclude<SectionOutline["status"], "pending">,
) => void;

// ─── 工具：从 prd_sections 重新组装并更新 prds.html ──────────────────────────

/**
 * 从 `prd_sections` 表中读取指定 prd 的所有当前版本模块，
 * 按 session 的 selected_modules 顺序重新组装 HTML，并更新 `prds` 表中的 html 字段。
 */
export async function reassemblePrd(
	prdId: string,
	sessionId: string,
): Promise<string> {
	const db = getDb();

	const titleRow = db
		.prepare("SELECT title FROM sessions WHERE id = ?")
		.get(sessionId) as { title: string } | undefined;
	const sessionTitle = titleRow?.title ?? "未命名 PRD";

	type SectionRow = { section_id: string; title: string; html_content: string };
	const rows = db
		.prepare(
			"SELECT section_id, title, html_content FROM prd_sections WHERE prd_id = ? AND is_current = 1",
		)
		.all(prdId) as SectionRow[];

	// 按 selected_modules 顺序排列
	const selectedModules = getSessionModules(sessionId);
	const ordered: RendererSection[] = selectedModules
		.map((m) => {
			const row = rows.find((r) => r.section_id === m.id);
			if (!row) return null;
			return {
				id: row.section_id as SectionId,
				title: row.title,
				content: row.html_content,
			};
		})
		.filter((s): s is RendererSection => s !== null);

	// 补上 selected_modules 未覆盖但 prd_sections 中存在的模块（容错）
	for (const row of rows) {
		if (!ordered.find((s) => s.id === row.section_id)) {
			ordered.push({
				id: row.section_id as SectionId,
				title: row.title,
				content: row.html_content,
			});
		}
	}

	const html = renderPrd(sessionTitle, ordered);
	const now = Date.now();
	db.prepare("UPDATE prds SET html = ?, updated_at = ? WHERE id = ?").run(
		html,
		now,
		prdId,
	);
	db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(
		now,
		sessionId,
	);

	return html;
}

/** 按 selectedModules 顺序构建有序 section 列表 */
function getOrderedSections(
	sessionId: string,
	outline: PrdOutline,
): SectionOutline[] {
	const selectedModules = getSessionModules(sessionId);
	const ordered = selectedModules
		.map((m) => outline.sections.find((s) => s.id === m.id))
		.filter((s): s is SectionOutline => s !== undefined);
	// 补上 selectedModules 未覆盖的模块（容错）
	for (const s of outline.sections) {
		if (!ordered.find((os) => os.id === s.id)) ordered.push(s);
	}
	return ordered;
}

/**
 * 驱动全部模块依次生成，组装成单文件 HTML，写入 prds 表。
 * 断点续传：status==="done" 且 prd_sections 中有缓存的模块直接跳过。
 *
 * @returns 写入 DB 的 prdId
 */
export async function generateFullPrd(
	sessionId: string,
	onProgress?: ProgressCallback,
): Promise<string> {
	const db = getDb();

	const outline: PrdOutline | null = getOutline(sessionId);
	if (!outline) {
		throw new Error(
			`[prd] 会话 ${sessionId} 尚无 Outline，请先触发对话生成 PRD。`,
		);
	}

	const titleRow = db
		.prepare("SELECT title FROM sessions WHERE id = ?")
		.get(sessionId) as { title: string } | undefined;
	const sessionTitle = titleRow?.title ?? "未命名 PRD";

	const orderedSections = getOrderedSections(sessionId, outline);
	const results = new Map<SectionId, string>();

	for (const section of orderedSections) {
		const sectionId = section.id;

		// 断点续传：已完成且有缓存的模块直接跳过
		if (section.status === "done") {
			const cached = loadCachedSection(sessionId, sectionId);
			if (cached) {
				results.set(sectionId, cached);
				onProgress?.(sectionId, "done");
				continue;
			}
			// 无缓存则重置为 pending 重新生成
			updateSectionStatus(sessionId, sectionId, "pending");
		}

		updateSectionStatus(sessionId, sectionId, "generating");
		onProgress?.(sectionId, "generating");

		try {
			// 读取最新 section 状态（keyPoints 可能在 outline 中更新过）
			const freshOutline = getOutline(sessionId);
			const freshSection =
				freshOutline?.sections.find((s) => s.id === sectionId) ?? section;

			const content = await resolveGenerator(sectionId).generate(freshSection);
			results.set(sectionId, content);
			updateSectionStatus(sessionId, sectionId, "done");
			onProgress?.(sectionId, "done");
		} catch (err) {
			console.error(`[prd] 模块 ${sectionId} 生成失败：`, err);
			updateSectionStatus(sessionId, sectionId, "error");
			onProgress?.(sectionId, "error");
			results.set(
				sectionId,
				`<p class="empty-module">「${sectionId}」模块生成失败：${String(err)}</p>`,
			);
		}
	}

	return persistResults(sessionId, sessionTitle, orderedSections, results);
}

/**
 * 仅重新生成单个模块（retry_section 模式）。
 * 其余已完成模块从缓存加载，完成后重新组装整体 HTML。
 *
 * @returns 写入 DB 的 prdId
 */
export async function generateSingleSection(
	sessionId: string,
	targetSectionId: SectionId,
	onProgress?: ProgressCallback,
): Promise<string> {
	const db = getDb();

	const outline = getOutline(sessionId);
	if (!outline) {
		throw new Error(
			`[prd] 会话 ${sessionId} 尚无 Outline，请先触发对话生成 PRD。`,
		);
	}

	const section = outline.sections.find((s) => s.id === targetSectionId);
	if (!section) {
		throw new Error(`[prd] Outline 中不存在模块 ${targetSectionId}`);
	}

	const titleRow = db
		.prepare("SELECT title FROM sessions WHERE id = ?")
		.get(sessionId) as { title: string } | undefined;
	const sessionTitle = titleRow?.title ?? "未命名 PRD";

	const orderedSections = getOrderedSections(sessionId, outline);
	const results = new Map<SectionId, string>();

	// 先从缓存恢复其他模块
	for (const s of orderedSections) {
		if (s.id === targetSectionId) continue;
		const cached = loadCachedSection(sessionId, s.id);
		if (cached) results.set(s.id, cached);
	}

	// 重新生成目标模块
	updateSectionStatus(sessionId, targetSectionId, "generating");
	onProgress?.(targetSectionId, "generating");

	try {
		const content = await resolveGenerator(targetSectionId).generate(section);
		results.set(targetSectionId, content);
		updateSectionStatus(sessionId, targetSectionId, "done");
		onProgress?.(targetSectionId, "done");
	} catch (err) {
		console.error(`[prd] 模块 ${targetSectionId} 重试失败：`, err);
		updateSectionStatus(sessionId, targetSectionId, "error");
		onProgress?.(targetSectionId, "error");
		results.set(
			targetSectionId,
			`<p class="empty-module">「${targetSectionId}」模块生成失败：${String(err)}</p>`,
		);
	}

	return persistResults(sessionId, sessionTitle, orderedSections, results);
}
