/**
 * docxExport — 把 PRD 导出为 Word（.docx）
 *
 * 流程（详见 docs/plan-export-docx.md）：
 *   sections 数据源 → 离屏渲染图表（复用 @prd-runtime 运行时，与 PrdSectionItem 同源）
 *   → SVG 光栅化为 PNG data URI（Word 不认 SVG，且 markmap/mermaid 是纯 SVG 图）
 *   → 清洗为 Word 兼容 HTML（去脚本/交互属性，保留内联样式与表格）
 *   → html-docx-js-typescript（MHT/altChunk）打包为 docx Blob → 触发下载
 */

import { asBlob } from "html-docx-js-typescript";
import {
	renderDiagrams,
	waitFrames,
} from "@prd-runtime/prd-runtime.js";
import {
	extractMarkmapMarkdown,
	sanitizeDownloadFilename,
} from "./markmapExport";

/** 供导出的单个 PRD 模块（与 prdEdit store 的 PrdSection 子集字段一致） */
export interface DocxExportSection {
	sectionId: string;
	title: string;
	html: string;
}

export interface ExportPrdDocxOptions {
	/** 文档标题（会话标题），用作文档 H1 与文件名 */
	title: string;
	/** 按顺序导出的模块列表 */
	sections: DocxExportSection[];
}

/** 离屏渲染容器宽度：与预览面板近似，保证 mermaid/markmap 布局尺寸合理 */
const HOST_WIDTH_PX = 900;

/** Word 页面可用内容宽度（px @96dpi，A4 纵向减 2cm 页边距） */
const WORD_CONTENT_WIDTH_PX = 620;

/** 位图光栅化的最小宽度（px）：思维导图等宽内容保证清晰度 */
const MIN_RASTER_WIDTH_PX = 1600;

/** 内容取景时的内边距（px） */
const CONTENT_PAD_PX = 12;

/**
 * markmap 渲染后的等待时长：
 * markmap-view 的进场与 fit() 都是 d3 transition（默认 duration 500ms），
 * 等它完全结束再取 content bbox / 光栅化，否则所有节点仍堆在根部附近，
 * 导出会变成一摊文字叠影（或动画中途的小色块）。
 */
const MARKMAP_SETTLE_MS = 1200;

// ── SVG → PNG 光栅化 ────────────────────────────────────────────────────────

/**
 * 位图缩放系数：总量受画布安全上限约束（单边 ≤ 8000px、总像素 ≤ 16M）。
 * 至少 3x；内容逻辑宽度不足 MIN_RASTER_WIDTH_PX 时进一步提高倍率，
 * 保证位图里文字有足够像素密度，避免 Word 中显示过小。
 */
function rasterScale(width: number, height: number): number {
	const maxByCanvas = Math.min(
		8000 / Math.max(width, height),
		Math.sqrt(16_000_000 / (width * height)),
	);
	const readability = Math.max(3, MIN_RASTER_WIDTH_PX / width);
	return Math.max(1, Math.min(maxByCanvas, readability));
}

/** 把 src 元素的计算样式内联到 dst 对应元素（同构平行遍历），避免 CSS 类在独立 SVG 文档中丢失 */
function inlineComputedStyles(src: Element, dst: Element): void {
	const cs = window.getComputedStyle(src);
	if (typeof cs.cssText === "string" && cs.cssText) {
		dst.setAttribute("style", cs.cssText);
	}
	const srcChildren = src.children;
	const dstChildren = dst.children;
	for (let i = 0; i < srcChildren.length && i < dstChildren.length; i++) {
		inlineComputedStyles(srcChildren[i], dstChildren[i]);
	}
}

/**
 * 光栅化单个 SVG，返回 PNG data URI 与逻辑（未缩放）尺寸。
 * 取景按内容包围盒（getBBox）而非视口矩形：
 * markmap 的 svg 是 width:100%+固定高视口，fit() 只是把树塞进视口，
 * 按视口矩形导出会把窄长树压扁；内容包围盒能拿到树的真实长宽。
 */
async function rasterizeSvgToPng(
	svg: SVGSVGElement,
): Promise<{ dataUrl: string; logicalW: number; logicalH: number } | null> {
	try {
		// 内容取景（克隆上改，不动原 DOM）
		const bbox = svg.getBBox();
		const viewBoxW = Math.max(1, bbox.width + CONTENT_PAD_PX * 2);
		const viewBoxH = Math.max(1, bbox.height + CONTENT_PAD_PX * 2);
		const logicalW = viewBoxW;
		const logicalH = viewBoxH;

		const clone = svg.cloneNode(true) as SVGSVGElement;
		inlineComputedStyles(svg, clone);
		// 根元素的计算样式带着视口尺寸（width:900px / height:560px 等），
		// CSS 会压过 width/height 属性导致内容取景失效，先在根节点剥离
		for (const prop of ["width", "height", "max-width", "min-width"]) {
			clone.style.removeProperty(prop);
		}
		clone.setAttribute("width", String(logicalW));
		clone.setAttribute("height", String(logicalH));
		clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
		clone.setAttribute(
			"viewBox",
			`${bbox.x - CONTENT_PAD_PX} ${bbox.y - CONTENT_PAD_PX} ${viewBoxW} ${viewBoxH}`,
		);

		const serialized = new XMLSerializer().serializeToString(clone);
		const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
		const img = new Image();
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error("SVG 转 Image 加载失败"));
			img.src = url;
		});

		const scale = rasterScale(logicalW, logicalH);
		const canvas = document.createElement("canvas");
		canvas.width = Math.ceil(logicalW * scale);
		canvas.height = Math.ceil(logicalH * scale);
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;
		ctx.setTransform(scale, 0, 0, scale, 0, 0);
		ctx.drawImage(img, 0, 0, logicalW, logicalH);
		return {
			dataUrl: canvas.toDataURL("image/png"),
			logicalW,
			logicalH,
		};
	} catch (err) {
		console.warn("[docx] SVG 光栅化失败", err);
		return null;
	}
}

/**
 * 容器内所有 SVG 光栅化为 <img>；无法光栅化的保留原 SVG 交由调用方降级。
 * img 使用显式像素 width/height 属性（Word 对 max-width/height:auto 等
 * 内联 CSS 支持不稳，回退时会以非预期尺寸渲染）：
 * 宽于页面的图缩放到页面内容宽度，小图保持原始逻辑尺寸不放大。
 */
async function rasterizeAllSvg(root: ParentNode): Promise<void> {
	const svgs = Array.from(root.querySelectorAll("svg"));
	for (const svg of svgs) {
		if (!(svg instanceof SVGSVGElement)) continue;
		const result = await rasterizeSvgToPng(svg);
		if (!result) continue;
		// 思维导图一律整页宽展示；其余图表宽于页面才缩放，窄图保持原始逻辑尺寸
		const isMarkmap = svg.id === "markmap-svg" || svg.closest(".markmap-wrap") != null;
		const displayW = isMarkmap
			? WORD_CONTENT_WIDTH_PX
			: Math.min(WORD_CONTENT_WIDTH_PX, result.logicalW);
		const displayH = Math.round((result.logicalH * displayW) / result.logicalW);
		const img = document.createElement("img");
		img.src = result.dataUrl;
		img.setAttribute("width", String(displayW));
		img.setAttribute("height", String(displayH));
		svg.replaceWith(img);
	}
}

// ── 单模块离屏渲染 ──────────────────────────────────────────────────────────

/** 渲染单个模块：离屏挂载 → 图表渲染 → 光栅化 → 渲染失败图表降级为源码块 */
async function renderSectionBody(sec: DocxExportSection, host: HTMLElement): Promise<HTMLElement> {
	const body = document.createElement("div");
	body.innerHTML = sec.html;

	// 渲染会替换 .mermaid 内容，先按 DOM 顺序留底原始源码用于降级
	const mermaidDivs = Array.from(body.querySelectorAll<HTMLElement>(".mermaid"));
	const mermaidSources = mermaidDivs.map((d) => d.textContent?.trim() ?? "");
	const markmapSvg = body.querySelector("#markmap-svg");
	const markmapMd = markmapSvg ? (extractMarkmapMarkdown(sec.html) ?? "") : "";

	host.appendChild(body);
	const cleanups = await renderDiagrams(body); // 内部按需加载 CDN，与预览同一份运行时
	await waitFrames(6); // markmap fit() 在 rAF 里执行，等布局稳定再量尺寸
	cleanups.splice(0).forEach((fn) => fn()); // 释放 zoom 监听与内联样式残余

	// markmap 的进场/fit 是 ~500ms 的 d3 transition，必须等其完全结束再光栅化
	if (markmapSvg) {
		await new Promise((resolve) => setTimeout(resolve, MARKMAP_SETTLE_MS));
		await waitFrames(2);
	}

	// SVG → PNG（mermaid 图、markmap 思维导图）
	await rasterizeAllSvg(body);

	// 渲染失败降级：.mermaid 仍无位图 → 源码块；markmap 无位图 → Markdown 源码块
	mermaidDivs.forEach((div, i) => {
		if (div.querySelector(":scope > img")) return;
		div.innerHTML = "";
		const pre = document.createElement("pre");
		pre.className = "docx-fallback-code";
		pre.textContent = mermaidSources[i] || "（该图表渲染失败，未能导出）";
		div.appendChild(pre);
	});
	const markmapImg = markmapSvg?.parentElement?.querySelector(":scope > img");
	if (markmapSvg && !markmapImg) {
		const pre = document.createElement("pre");
		pre.className = "docx-fallback-code";
		pre.textContent = markmapMd || "（思维导图渲染失败，未能导出）";
		markmapSvg.replaceWith(pre);
	}

	return body;
}

// ── Word 兼容 HTML 组装 ─────────────────────────────────────────────────────

/** 移除 Word 不认的脚本与交互属性，保留内联样式与 class */
function sanitizeSectionHtml(body: HTMLElement): string {
	const clone = body.cloneNode(true) as HTMLElement;
	clone
		.querySelectorAll("script, style, link, meta, iframe, noscript, button")
		.forEach((el) => el.remove());
	clone.querySelectorAll("*").forEach((el) => {
		for (const attr of Array.from(el.attributes)) {
			const name = attr.name.toLowerCase();
			if (
				name.startsWith("data-") ||
				name === "contenteditable" ||
				name === "draggable" ||
				name === "spellcheck" ||
				name === "tabindex"
			) {
				el.removeAttribute(attr.name);
			}
		}
	});
	return clone.innerHTML;
}

/** 精简版正文样式（altChunk 环境 flex/grid 不可靠，只用文档流 + 表格边框兜底） */
const WORD_CSS = `
body { font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif; font-size: 14px; line-height: 1.7; color: #1e293b; }
h1 { font-size: 22px; margin: 8px 0 6px; }
h2 { font-size: 18px; margin: 22px 0 10px; }
h3 { font-size: 16px; margin: 18px 0 8px; }
p { margin: 8px 0; }
ul, ol { margin: 6px 0; padding-left: 24px; }
li { margin: 3px 0; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; }
td, th { border: 1px solid #94a3b8; padding: 6px 10px; vertical-align: top; }
th { background: #f1f5f9; font-weight: 600; }
pre.docx-fallback-code { font-family: Consolas, monospace; font-size: 12px; background: #f1f5f9; border: 1px solid #cbd5e1; padding: 10px 12px; white-space: pre-wrap; word-break: break-all; }
`;

/** 包一层 Word 认识的完整 HTML 文档（MSO 命名空间 + 打印视图设置） */
function toWordDocument(title: string, bodyHtml: string): string {
	return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
	xmlns:w="urn:schemas-microsoft-com:office:word"
	xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${title.replace(/[<>&]/g, "")}</title>
<!--[if gte mso 9]>
<xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml>
<![endif]-->
<style>${WORD_CSS}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

// ── 对外入口 ────────────────────────────────────────────────────────────────

/** 构建 docx 的完整 Word HTML（独立导出便于测试/复用） */
export async function buildPrdWordHtml(options: ExportPrdDocxOptions): Promise<string> {
	const host = document.createElement("div");
	host.style.cssText = `position:fixed;top:0;left:-99999px;width:${HOST_WIDTH_PX}px;z-index:-1;`;
	document.body.appendChild(host);

	try {
		const parts: string[] = [];
		for (const sec of options.sections) {
			const body = await renderSectionBody(sec, host);
			const heading = document.createElement("h1");
			heading.textContent = sec.title;
			host.appendChild(heading);
			parts.push(heading.outerHTML + sanitizeSectionHtml(body));
			host.removeChild(body); // 已序列化，及时移出避免容器持续膨胀
		}
		return toWordDocument(options.title, parts.join("\n"));
	} finally {
		host.remove();
	}
}

/** 导出 PRD 为 .docx 并触发浏览器下载 */
export async function exportPrdToDocx(options: ExportPrdDocxOptions): Promise<void> {
	const documentHtml = await buildPrdWordHtml(options);
	const blob = await asBlob(documentHtml, {
		orientation: "portrait",
		margins: { top: 1134, right: 1134, bottom: 1134, left: 1134 }, // 2cm（twips）
	});
	if (!(blob instanceof Blob)) {
		throw new Error("Word 文档生成失败（预期浏览器环境返回 Blob）");
	}

	const filename = `${sanitizeDownloadFilename(options.title) || "prd"}.docx`;
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}
