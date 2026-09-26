import { parse as parseHtml } from "node-html-parser";
import { patchElementInHtml } from "./htmlPatch.js";

/**
 * 从 <div class="mermaid"> 的文本内容中提取指定实体的 Mermaid 块。
 * 实体块格式：  ENTITY_NAME { \n  ...\n  }
 * 返回原始文本（含首尾空白），未找到时返回空字符串。
 */
export function extractEntityBlock(sectionHtml: string, entityName: string): string {
	const mermaidMatch = sectionHtml.match(
		/<div[^>]*class="mermaid"[^>]*>([\s\S]*?)<\/div>/i,
	);
	if (!mermaidMatch) return "";
	const mermaidText = mermaidMatch[1];
	const escaped = entityName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const regex = new RegExp(`\\b${escaped}\\s*\\{[^}]*\\}`, "s");
	return mermaidText.match(regex)?.[0].trim() ?? "";
}

/**
 * 从 section HTML 中提取指定实体的 <div class="entity-section"> outerHTML。
 * 通过 <h4 class="entity-table-title"> 的文本匹配实体名，未找到返回 null。
 */
export function extractEntitySection(
	sectionHtml: string,
	entityName: string,
): string | null {
	const root = parseHtml(sectionHtml);
	for (const sec of root.querySelectorAll(".entity-section")) {
		if (sec.querySelector(".entity-table-title")?.text.trim() === entityName) {
			return sec.outerHTML;
		}
	}
	return null;
}

/**
 * 将 AI 返回的新实体块和新 entity-section 缝合回 sectionHtml。
 *
 * - 现有实体：字符串替换实体块 + patchElementInHtml 替换 entity-section
 * - 新建实体：在 erDiagram 末尾追加实体块 + 在最后一个 entity-section 之后插入新 div
 */
export function applyEntityPatch(
	sectionHtml: string,
	oldEntityBlock: string,
	newEntityBlock: string,
	oldEntitySection: string | null,
	newEntitySection: string,
): string {
	let result = sectionHtml;

	// ① 更新 Mermaid 实体块
	if (oldEntityBlock && result.includes(oldEntityBlock)) {
		result = result.replace(oldEntityBlock, newEntityBlock);
	} else if (!oldEntityBlock) {
		// 新实体：追加到 erDiagram 最后一个 } 之前（即 mermaid div 闭合前）
		result = result.replace(
			/(<div[^>]*class="mermaid"[^>]*>)([\s\S]*?)(<\/div>)/i,
			(_, open, content, close) =>
				`${open}${content.trimEnd()}\n\n    ${newEntityBlock}\n${close}`,
		);
	}

	// ② 更新 entity-section
	if (oldEntitySection) {
		const patched = patchElementInHtml(
			result,
			oldEntitySection,
			newEntitySection,
		);
		if (patched) result = patched;
	} else {
		// 新实体：插入到最后一个 entity-section 之后
		const root = parseHtml(result);
		const allSections = root.querySelectorAll(".entity-section");
		const anchor =
			allSections.length > 0
				? allSections[allSections.length - 1].outerHTML
				: (root.querySelector(".mermaid")?.outerHTML ?? "");
		if (anchor) {
			const pos = result.lastIndexOf(anchor) + anchor.length;
			result =
				result.slice(0, pos) + "\n" + newEntitySection + result.slice(pos);
		}
	}

	return result;
}
