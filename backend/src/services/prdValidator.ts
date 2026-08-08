/**
 * PRD HTML 结构轻量校验器
 *
 * 分两级问题：
 *   hardErrors  — 文档根本性缺陷（截断、无面板），应阻止下发并报错
 *   warnings    — 可渲染但效果欠佳的问题（Mermaid 语法异常），随成功事件下发给前端
 */
export interface ValidationResult {
	hardErrors: string[];
	warnings: string[];
}

/** Mermaid 合法起始关键字（宽松匹配） */
const MERMAID_VALID_STARTERS = [
	"graph ",
	"graph\n",
	"flowchart ",
	"flowchart\n",
	"erDiagram",
	"sequenceDiagram",
	"classDiagram",
	"gantt",
	"pie ",
	"pie\n",
	"mindmap",
	"timeline",
	"xychart",
];

/**
 * 对 renderPrd 生成的 HTML 做轻量结构性校验。
 *
 * @param html                生成的完整 HTML 字符串
 * @param expectedSectionCount 预期的模块数（来自 selectedModules.length）
 */
export function validatePrdHtml(
	html: string,
	expectedSectionCount: number,
): ValidationResult {
	const hardErrors: string[] = [];
	const warnings: string[] = [];

	// ── 1. 完整性检查：HTML 必须以 </html> 结尾 ──────────────────────────────
	if (!html.includes("</html>")) {
		hardErrors.push("HTML 文档不完整（缺少 </html> 结束标签，内容可能被截断）");
	}

	// ── 2. Tab 面板数量检查 ───────────────────────────────────────────────────
	const panelCount = (html.match(/<section class="tab-panel/g) ?? []).length;
	if (panelCount === 0) {
		hardErrors.push("PRD 未包含任何内容面板，生成结果为空");
	} else if (expectedSectionCount > 0 && panelCount < expectedSectionCount) {
		hardErrors.push(
			`内容面板数量不足：预期 ${expectedSectionCount} 个模块，实际仅生成 ${panelCount} 个`,
		);
	}

	// ── 3. Mermaid 代码块内容校验 ─────────────────────────────────────────────
	// 匹配 <div class="mermaid">...</div>，非贪婪
	const mermaidDivRegex = /<div class="mermaid">\s*([\s\S]*?)\s*<\/div>/g;
	let m: RegExpExecArray | null;
	let mermaidBlockIndex = 0;

	while ((m = mermaidDivRegex.exec(html)) !== null) {
		mermaidBlockIndex++;
		const content = m[1].trim();

		if (!content) {
			warnings.push(
				`第 ${mermaidBlockIndex} 个图表代码块为空，对应图表将无法渲染`,
			);
			continue;
		}

		// 检测是否被 LLM 错误地包裹了 markdown 代码围栏（```mermaid ... ```）
		if (content.startsWith("```")) {
			warnings.push(
				`第 ${mermaidBlockIndex} 个图表代码块包含 markdown 代码围栏（\`\`\`），` +
					"Mermaid.js 无法解析，图表将渲染失败",
			);
			continue;
		}

		const isValidStart = MERMAID_VALID_STARTERS.some((s) =>
			content.startsWith(s),
		);
		if (!isValidStart) {
			warnings.push(
				`第 ${mermaidBlockIndex} 个图表语法可能有误` +
					`（内容开头：${content.slice(0, 50).replace(/\n/g, "↵")}）`,
			);
		}
	}

	// ── 4. Markmap 数据块内容校验 ─────────────────────────────────────────────
	// infoArch 模块将 Markdown 以 JSON 字符串存入隐藏 script 标签，
	// initMarkmap() 通过 JSON.parse 读取后交给 Transformer 渲染。
	// LLM 返回空串或非 # 开头的内容均会导致思维导图静默空白。
	const markmapDataRegex =
		/<script type="application\/json" id="markmap-data">([\s\S]*?)<\/script>/g;
	let mm: RegExpExecArray | null;

	while ((mm = markmapDataRegex.exec(html)) !== null) {
		const raw = mm[1].trim();
		let mdContent: string;

		try {
			mdContent = JSON.parse(raw) as string;
		} catch {
			warnings.push(
				"信息架构（markmap）数据 JSON 解析失败，思维导图将无法渲染",
			);
			continue;
		}

		if (typeof mdContent !== "string" || !mdContent.trim()) {
			warnings.push(
				"信息架构（markmap）Markdown 内容为空，思维导图将渲染为空白",
			);
			continue;
		}

		if (!mdContent.trimStart().startsWith("#")) {
			warnings.push(
				"信息架构（markmap）Markdown 缺少 # 根节点，思维导图结构可能异常" +
					`（内容开头：${mdContent.slice(0, 40).replace(/\n/g, "↵")}）`,
			);
		}
	}

	return { hardErrors, warnings };
}
