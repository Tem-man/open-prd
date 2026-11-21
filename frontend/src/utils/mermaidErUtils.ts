import { editorMessages } from "@open-pencil/vue";

/**
 * mermaidErUtils — Mermaid ER 源码解析 / 分段回写工具函数
 *
 * 所有函数均为纯函数（无副作用），可独立测试。
 * 核心数据结构：MermaidErZone 区分三种点击区域，驱动分段编辑逻辑。
 */

/** 点击区域类型 */
export type MermaidErZone = "entity" | "relation" | "diagram";

// ── 源码解析 ──────────────────────────────────────────────────────────────────

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 从完整 Mermaid ER 源码中提取指定实体的完整块（含大括号）。
 * 返回原始缩进，方便回写时保持格式一致。
 */
export function extractEntityBlock(source: string, entityName: string): string {
	const re = new RegExp(
		`[ \\t]*${escapeRegExp(entityName)}\\s*\\{[^}]*\\}`,
		"ms",
	);
	const m = source.match(re);
	return m ? m[0].trim() : "";
}

/**
 * 从完整 Mermaid ER 源码中提取所有关系行（含 `||` 的行）。
 * 保留原始缩进，去掉首尾空行。
 */
export function extractRelationLines(source: string): string {
	return source
		.split("\n")
		.filter((l) => /\|\|/.test(l))
		.join("\n")
		.trim();
}

// ── 源码回写 ──────────────────────────────────────────────────────────────────

/**
 * 将编辑后的实体块回写到完整源码中（原位替换同名实体块）。
 * newBlock 为用户编辑后的纯块内容，如 `USER {\n  int id PK\n}`.
 */
export function replaceEntityBlock(
	source: string,
	entityName: string,
	newBlock: string,
): string {
	const re = new RegExp(
		`[ \\t]*${escapeRegExp(entityName)}\\s*\\{[^}]*\\}`,
		"ms",
	);
	return source.replace(re, () => newBlock);
}

/**
 * 将编辑后的关系行回写到完整源码中。
 * 策略：删除所有原关系行，把新关系行插入到第一个实体块之前。
 */
export function replaceRelationLines(
	source: string,
	newRelations: string,
): string {
	const lines = source.split("\n");
	const withoutRelations = lines.filter((l) => !/\|\|/.test(l));

	const firstEntityIdx = withoutRelations.findIndex((l) =>
		/^\s*\w+\s*\{/.test(l),
	);
	const insertAt =
		firstEntityIdx >= 0 ? firstEntityIdx : withoutRelations.length;

	const newRelationLines = newRelations
		.split("\n")
		.filter((l) => l.trim().length > 0);

	withoutRelations.splice(insertAt, 0, ...newRelationLines);
	return withoutRelations.join("\n");
}

// ── SVG 连线识别 ──────────────────────────────────────────────────────────────

/**
 * 判断 SVG 点击目标是否为 Mermaid ER 关系连线（path / line / 标签文字）。
 * Mermaid v10 渲染的连线 class 通常含 "relationshipLine" 或 "er"。
 */
export function isMermaidRelationEl(el: Element): boolean {
	// 向上最多遍历 5 层，避免遍历整个 SVG 树
	let cur: Element | null = el;
	for (let i = 0; i < 5 && cur; i++) {
		const tag = cur.tagName.toLowerCase();
		const cls =
			typeof (cur as SVGElement).className === "object"
				? ((cur as SVGElement).className as SVGAnimatedString).baseVal
				: ((cur as HTMLElement).className ?? "");

		if ((tag === "path" || tag === "line") && /relation|er\b/i.test(cls))
			return true;

		// 关系标签文字（<text class="er ...">）
		if (tag === "text" && /\ber\b/i.test(cls)) return true;

		// 关系 marker（箭头 <marker>）
		if (tag === "marker") return true;

		cur = cur.parentElement;
	}
	return false;
}

// ── Zone 提示文字 ─────────────────────────────────────────────────────────────

/** 根据 zone + entityName 生成编辑器顶部提示文字 */
export function zoneHintText(zone: MermaidErZone, entityName?: string): string {
	if (zone === "entity" && entityName) return editorMessages.get().editEntity({ name: entityName });
	if (zone === "relation") return editorMessages.get().editRelation;
	return editorMessages.get().editFullEr;
}
