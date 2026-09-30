import type { SectionId } from "../prdOutline.js";
import {
	collectDiagramScripts,
	DIAGRAM_MAX_HEIGHT,
} from "./runtime/prd-runtime.js";
import {
	PRD_RUNTIME_CSS,
	PRD_RUNTIME_FINGERPRINT,
	PRD_RUNTIME_JS,
} from "./runtimeAssets.js";

export interface RendererSection {
	id: SectionId;
	title: string;
	content: string; // HTML fragment（infoArch 含 <script id="markmap-data"> + <svg id="markmap-svg">，由 runtime/prd-runtime.js 渲染）
}

// 修改下方 HTML 骨架时递增；运行时资产的变化由指纹自动覆盖
const TEMPLATE_REVISION = 3;

export const RENDERER_VERSION = `${TEMPLATE_REVISION}-${PRD_RUNTIME_FINGERPRINT}`;

const VERSION_META = `<meta name="prd-renderer" content="${RENDERER_VERSION}">`;

/** 落库的 HTML 是否由当前渲染器生成（否则应从 prd_sections 重新渲染） */
export function isCurrentRender(html: string): boolean {
	return html.includes(VERSION_META);
}

const EMPTY_SECTION_HTML =
	'<p class="empty-module">本模块内容生成失败，请重新生成。</p>';

/** 按选定模块动态组装为单文件可交互 PRD HTML（sections 已按用户选定顺序排列） */
export function renderPrd(title: string, sections: RendererSection[]): string {
	const tabButtons = sections
		.map((s, i) => {
			const active = i === 0;
			return `<button type="button" role="tab" class="tab-btn${active ? " active" : ""}" id="tab-${i}" aria-controls="panel-${i}" aria-selected="${active}" data-idx="${i}">${escapeHtml(s.title)}</button>`;
		})
		.join("\n      ");

	const panels = sections
		.map((s, i) => {
			const maxHeight = DIAGRAM_MAX_HEIGHT[s.id];
			const maxHeightAttr = maxHeight ? ` data-diagram-max-height="${maxHeight}"` : "";
			return `<section class="tab-panel prd-doc${i === 0 ? " active" : ""}" id="panel-${i}" role="tabpanel" aria-labelledby="tab-${i}"${maxHeightAttr}>
        ${s.content || EMPTY_SECTION_HTML}
      </section>`;
		})
		.join("\n      ");

	const cdnScripts = collectDiagramScripts(sections.map((s) => s.content))
		.map((src) => `<script src="${src}"></script>`)
		.join("\n  ");

	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${VERSION_META}
  <title>PRD — ${escapeHtml(title)}</title>
  <style>
${PRD_RUNTIME_CSS}
  </style>
</head>
<body>
  <div class="prd-app">
    <nav class="tab-nav" role="tablist">
      ${tabButtons}
    </nav>
    <main class="prd-content">
      ${panels}
    </main>
  </div>
  ${cdnScripts}
  <script type="module">
${PRD_RUNTIME_JS}
mountPrdPage();
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
