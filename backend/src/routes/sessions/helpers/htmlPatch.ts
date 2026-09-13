import { parse as parseHtml } from "node-html-parser";

/**
 * 从 HTML 字符串中去除所有 el-selected class，防止前端选中态被持久化到数据库。
 * 处理三种情况：
 *   class="el-selected"          → class=""  (再去掉空 class)
 *   class="foo el-selected bar"  → class="foo bar"
 *   class="el-selected foo"      → class="foo"
 */
export function stripElSelected(html: string): string {
	return html
		.replace(/\bel-selected-cell\b\s*/g, "")
		.replace(/\s+el-selected-cell\b/g, "")
		.replace(/\bel-selected\b\s*/g, "")
		.replace(/\s+el-selected\b/g, "")
		.replace(/class="\s+/g, 'class="')
		.replace(/\s+"/g, '"')
		.replace(/class=""/g, "");
}

export type TableElementPath =
	| { kind: "row"; tableIndex: number; rowIndex: number }
	| { kind: "cell"; tableIndex: number; rowIndex: number; cellIndex: number }
	| {
			kind: "cells";
			tableIndex: number;
			rowIndex: number;
			cellIndices: number[];
	  };

/**
 * 从 section HTML 中提取指定序号的 table 的 outerHTML，用于给 LLM 提供表格结构上下文。
 * tableIndex 默认为 0（第一张表），支持功能清单拆分多张表的场景。
 */
export function extractParentTableHtml(
	sectionHtml: string,
	tableIndex = 0,
): string | null {
	const root = parseHtml(sectionHtml);
	const tables = root.querySelectorAll("table");
	const table = tables[tableIndex];
	return table ? table.outerHTML : null;
}

/**
 * 按 DOM 坐标精确替换 table 中的 tr / td / th。
 * 在 patchElementInHtml 三层策略之前调用；失败返回 null，调用方降级。
 */
export function patchTableElementByPath(
	sectionHtml: string,
	path: TableElementPath,
	newElementHtml: string,
): string | null {
	const root = parseHtml(sectionHtml);
	const tables = root.querySelectorAll("table");
	const table = tables[path.tableIndex ?? 0];
	if (!table) return null;

	const rows = table.querySelectorAll("tr");
	const row = rows[path.rowIndex];
	if (!row) return null;

	if (path.kind === "row") {
		row.replaceWith(parseHtml(newElementHtml).firstChild!);
		return root.toString();
	}

	if (path.kind === "cell") {
		const cells = row.querySelectorAll("td, th");
		const cell = cells[path.cellIndex];
		if (!cell) return null;
		cell.replaceWith(parseHtml(newElementHtml).firstChild!);
		return root.toString();
	}

	// kind === "cells"：newElementHtml 是多个 td/th 的 HTML 拼接，按序逐一替换
	if (path.kind === "cells") {
		const cells = row.querySelectorAll("td, th");
		const newNodes = parseHtml(`<table><tr>${newElementHtml}</tr></table>`);
		const newCells = newNodes.querySelectorAll("td, th");

		path.cellIndices.forEach((cellIdx, i) => {
			const target = cells[cellIdx];
			const replacement = newCells[i];
			if (target && replacement) {
				target.replaceWith(replacement);
			}
		});
		return root.toString();
	}

	return null;
}

/**
 * 将 sectionHtml 中与 oldElementHtml 匹配的节点替换为 newElementHtml。
 * 采用三层降级策略：
 *   1. 精确字符串替换（最快，原始 outerHTML 与存储内容完全一致时命中）
 *   2. 归一化空白后字符串替换（应对浏览器微调属性顺序或空格的情况）
 *   3. node-html-parser DOM 比对（按 tagName + 文本内容模糊匹配）
 * 全部失败时返回 null，调用方应 fallback 到全模块重写。
 */
export function patchElementInHtml(
	sectionHtml: string,
	oldElementHtml: string,
	newElementHtml: string,
): string | null {
	// 策略 1：精确字符串替换
	if (sectionHtml.includes(oldElementHtml)) {
		// 只替换第一次出现（防止重复替换同一个模板行）
		return sectionHtml.replace(oldElementHtml, newElementHtml);
	}

	// 策略 2：归一化空白后替换
	function normalizeWs(s: string) {
		return s.replace(/\s+/g, " ").trim();
	}
	const normSection = normalizeWs(sectionHtml);
	const normOld = normalizeWs(oldElementHtml);
	if (normSection.includes(normOld)) {
		// 在原始 HTML 上做同等归一化后替换，再还原整体格式
		return sectionHtml.replace(
			new RegExp(normOld.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
			newElementHtml,
		);
	}

	// 策略 3：DOM 节点比对
	try {
		const sectionRoot = parseHtml(sectionHtml);
		const oldRoot = parseHtml(oldElementHtml);
		const oldNode = oldRoot.firstChild;
		if (!oldNode || !("rawTagName" in oldNode)) return null;

		const tagName = (oldNode as { rawTagName: string }).rawTagName;
		const oldText = oldNode.text?.trim() ?? "";
		const candidates = sectionRoot.querySelectorAll(tagName);

		for (const candidate of candidates) {
			if (candidate.text?.trim() === oldText) {
				candidate.replaceWith(parseHtml(newElementHtml).firstChild!);
				return sectionRoot.toString();
			}
		}
		return null;
	} catch {
		return null;
	}
}
