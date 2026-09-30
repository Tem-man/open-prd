import { parse as parseHtml, type HTMLElement } from "node-html-parser";
import type { TableElementPath } from "../routes/sessions/helpers/htmlPatch.js";
import type { ComposerTarget } from "./agent/types.js";

export type LocatorKind =
	| "subsection"
	| "group"
	| "scenario"
	| "table"
	| "row"
	| "cell";

export interface CatalogEntry {
	id: string;
	kind: LocatorKind;
	label: string;
	selectedElementHtml: string;
	tablePath?: TableElementPath;
	tableIndex?: number;
	rowIndex?: number;
	cellIndex?: number;
}

export interface SearchHit {
	id: string;
	kind: LocatorKind;
	label: string;
	sectionId: string;
}

export type BindResult =
	| { status: "unique"; entry: CatalogEntry }
	| { status: "ambiguous"; candidates: CatalogEntry[] }
	| { status: "none" };

export const SEARCH_LIMIT = 20;

const KIND_RANK: Record<LocatorKind, number> = {
	cell: 0,
	row: 1,
	scenario: 2,
	group: 2,
	subsection: 2,
	table: 3,
};

const BIND_STOPWORDS = new Set([
	"修改",
	"改成",
	"改一下",
	"补充",
	"删除",
	"删掉",
	"去掉",
	"模块",
	"功能",
	"一个",
	"一下",
	"这个",
	"那个",
	"这些",
	"那些",
	"章节",
	"里面",
	"里边",
	"帮我",
	"请把",
	"以及",
	"加一个",
	"加上",
	"新增",
	"换成",
	"更新",
	"把",
	"将",
	"的",
	"里",
	"中",
	"为",
	"成",
	"和",
	"与",
	"也",
	"再",
	"请",
]);

function normalize(s: string): string {
	return s.replace(/\s+/g, " ").trim();
}

function nodeText(el: HTMLElement): string {
	return normalize(el.text ?? "");
}

function isHtmlElement(node: unknown): node is HTMLElement {
	return !!node && typeof node === "object" && "getAttribute" in node;
}

/** Mermaid / markmap 子树不进索引 */
export function isExcluded(el: HTMLElement): boolean {
	let node: unknown = el;
	while (isHtmlElement(node)) {
		const cls = node.getAttribute("class") ?? "";
		const id = node.getAttribute("id") ?? "";
		if (/(?:^|\s)(?:mermaid|markmap-wrap)(?:\s|$)/.test(cls)) return true;
		if (id === "markmap-svg" || id === "markmap-data") return true;
		node = node.parentNode;
	}
	return false;
}

function tableLabel(table: HTMLElement, index: number): string {
	let parent: unknown = table.parentNode;
	while (isHtmlElement(parent)) {
		if (/(?:^|\s)feature-module-group(?:\s|$)/.test(parent.getAttribute("class") ?? "")) {
			const title = parent.querySelector(".feature-module-title");
			const text = title ? nodeText(title) : "";
			if (text) return text;
			break;
		}
		parent = parent.parentNode;
	}
	let prev: unknown = table.previousSibling;
	while (prev) {
		if (isHtmlElement(prev)) {
			const tag = prev.rawTagName?.toLowerCase();
			if (tag === "h2" || tag === "h3") {
				const text = nodeText(prev);
				if (text) return text;
			}
		}
		prev = isHtmlElement(prev) ? prev.previousSibling : null;
	}
	return `表格${index + 1}`;
}

function headerCells(table: HTMLElement): string[] {
	const thead = table.querySelector("thead");
	const headerRow = thead?.querySelector("tr") ?? null;
	if (!headerRow) return [];
	return headerRow.querySelectorAll("th, td").map((c) => nodeText(c) || "");
}

function isDataRow(tr: HTMLElement, hasTbody: boolean): boolean {
	if (hasTbody) {
		let node: unknown = tr;
		while (isHtmlElement(node)) {
			if (node.rawTagName?.toLowerCase() === "tbody") return true;
			if (node.rawTagName?.toLowerCase() === "thead") return false;
			node = node.parentNode;
		}
		return false;
	}
	let node: unknown = tr;
	while (isHtmlElement(node)) {
		if (node.rawTagName?.toLowerCase() === "thead") return false;
		node = node.parentNode;
	}
	return true;
}

function firstCellText(tr: HTMLElement): string {
	const cell = tr.querySelector("td, th");
	return cell ? nodeText(cell) : nodeText(tr).slice(0, 20);
}

export function buildCatalog(html: string): CatalogEntry[] {
	const root = parseHtml(html);
	const entries: CatalogEntry[] = [];

	root.querySelectorAll(".prd-subsection").forEach((el, i) => {
		if (isExcluded(el)) return;
		const heading = el.querySelector("h2, h3");
		const label = heading ? nodeText(heading) : nodeText(el).slice(0, 20);
		if (!label) return;
		entries.push({
			id: `sub:${i}`,
			kind: "subsection",
			label,
			selectedElementHtml: el.toString(),
		});
	});

	root.querySelectorAll(".feature-module-group").forEach((el, i) => {
		if (isExcluded(el)) return;
		const title = el.querySelector(".feature-module-title");
		const label = title ? nodeText(title) : nodeText(el).slice(0, 20);
		if (!label) return;
		entries.push({
			id: `group:${i}`,
			kind: "group",
			label,
			selectedElementHtml: el.toString(),
		});
	});

	root.querySelectorAll(".scenario-card").forEach((el, i) => {
		if (isExcluded(el)) return;
		const title = el.querySelector(".scenario-title");
		const label = title ? nodeText(title) : nodeText(el).slice(0, 20);
		if (!label) return;
		entries.push({
			id: `scenario:${i}`,
			kind: "scenario",
			label,
			selectedElementHtml: el.toString(),
		});
	});

	const tables = root.querySelectorAll("table");
	tables.forEach((table, t) => {
		if (isExcluded(table)) return;
		const label = tableLabel(table, t);
		entries.push({
			id: `table:${t}`,
			kind: "table",
			label,
			selectedElementHtml: table.toString(),
			tableIndex: t,
		});

		const headers = headerCells(table);
		const hasTbody = !!table.querySelector("tbody");
		const rows = table.querySelectorAll("tr");
		rows.forEach((tr, r) => {
			if (!isDataRow(tr, hasTbody)) return;
			const rowLabel = firstCellText(tr) || `第${r + 1}行`;
			entries.push({
				id: `row:${t}:${r}`,
				kind: "row",
				label: rowLabel,
				selectedElementHtml: tr.toString(),
				tablePath: { kind: "row", tableIndex: t, rowIndex: r },
				tableIndex: t,
				rowIndex: r,
			});

			const cells = tr.querySelectorAll("td, th");
			cells.forEach((cell, c) => {
				const col = headers[c] || `列${c + 1}`;
				entries.push({
					id: `cell:${t}:${r}:${c}`,
					kind: "cell",
					label: `${rowLabel} · ${col}`,
					selectedElementHtml: cell.toString(),
					tablePath: { kind: "cell", tableIndex: t, rowIndex: r, cellIndex: c },
					tableIndex: t,
					rowIndex: r,
					cellIndex: c,
				});
			});
		});
	});

	return entries;
}

export function resolveLocator(html: string, locatorId: string): CatalogEntry | null {
	return buildCatalog(html).find((e) => e.id === locatorId) ?? null;
}

export function filterByQuery(entries: CatalogEntry[], query: string): CatalogEntry[] {
	const q = query.trim().toLowerCase();
	if (!q) return entries;
	return entries.filter((e) => e.label.toLowerCase().includes(q));
}

function covers(finer: CatalogEntry, coarser: CatalogEntry): boolean {
	if (finer.id === coarser.id) return true;
	if (KIND_RANK[finer.kind] >= KIND_RANK[coarser.kind]) return false;
	if (finer.tableIndex === undefined || coarser.tableIndex === undefined) return false;
	if (finer.tableIndex !== coarser.tableIndex) return false;
	if (coarser.kind === "table") return true;
	if (
		coarser.kind === "row" &&
		finer.kind === "cell" &&
		finer.rowIndex === coarser.rowIndex
	) {
		return true;
	}
	return false;
}

/** 同一节点同时命中时保留更细的 kind（cell > row > table） */
export function foldFiner(entries: CatalogEntry[]): CatalogEntry[] {
	const sorted = [...entries].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
	const kept: CatalogEntry[] = [];
	for (const e of sorted) {
		if (kept.some((k) => covers(k, e))) continue;
		kept.push(e);
	}
	return kept;
}

export function searchCatalog(
	sections: Array<{ sectionId: string; html: string }>,
	query: string,
): SearchHit[] {
	const q = query.trim();
	const hits: SearchHit[] = [];
	for (const s of sections) {
		const catalog = buildCatalog(s.html);
		const matched = q ? foldFiner(filterByQuery(catalog, q)) : catalog;
		for (const e of matched) {
			hits.push({ id: e.id, kind: e.kind, label: e.label, sectionId: s.sectionId });
		}
	}
	return hits;
}

function instructionTokens(instruction: string): string[] {
	const runs = instruction.match(/[\u4e00-\u9fffA-Za-z0-9_]{2,}/g) ?? [];
	const out: string[] = [];
	for (const t of runs) {
		if (!BIND_STOPWORDS.has(t)) out.push(t);
		const stripped = t.replace(/^(修改|改成|改|把|将|请)+/, "");
		if (stripped.length >= 2 && stripped !== t && !BIND_STOPWORDS.has(stripped)) {
			out.push(stripped);
		}
	}
	return out;
}

function matchesInstruction(entry: CatalogEntry, instruction: string): boolean {
	const inst = instruction.toLowerCase();
	const label = entry.label.toLowerCase();
	if (label.length < 2) return false;
	if (inst.includes(label)) return true;
	if (entry.kind === "cell") {
		const sep = " · ";
		const idx = entry.label.indexOf(sep);
		if (idx > 0) {
			const rowPart = entry.label.slice(0, idx).toLowerCase();
			const colPart = entry.label.slice(idx + sep.length).toLowerCase();
			if (
				rowPart.length >= 2 &&
				colPart.length >= 2 &&
				inst.includes(rowPart) &&
				inst.includes(colPart)
			) {
				return true;
			}
		}
	}
	const tokens = instructionTokens(instruction).map((t) => t.toLowerCase());
	return tokens.some((t) => t.length >= 2 && label.includes(t));
}

export function bindByInstruction(catalog: CatalogEntry[], instruction: string): BindResult {
	const matched = foldFiner(catalog.filter((e) => matchesInstruction(e, instruction)));
	if (matched.length === 0) return { status: "none" };
	if (matched.length === 1) return { status: "unique", entry: matched[0] };
	return { status: "ambiguous", candidates: matched };
}

export function toPatchTarget(
	entry: CatalogEntry,
	sectionId: string,
	sectionTitle?: string,
): ComposerTarget {
	return {
		sectionId,
		sectionTitle,
		elementLabel: entry.label,
		selectedElementHtml: entry.selectedElementHtml,
		tablePath: entry.tablePath,
	};
}
