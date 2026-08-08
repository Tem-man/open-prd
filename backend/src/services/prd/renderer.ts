import type { SectionId } from "../prdOutline.js";

export interface RendererSection {
	id: SectionId;
	title: string;
	content: string; // HTML fragment（infoArch 含 <script id="markmap-data"> + <svg id="markmap-svg">，由 renderer.ts initMarkmap() 手动渲染）
}

const MERMAID_IDS = new Set(["architecture", "flowchart", "dataModel"]);
const MARKMAP_IDS = new Set(["infoArch"]);

/** 按选定模块动态组装为单文件可交互 PRD HTML */
export function renderPrd(title: string, sections: RendererSection[]): string {
	// sections 由调用方按用户选定顺序传入，直接使用
	const ordered = sections;

	// ── 按需决定是否注入 CDN ─────────────────────────────────────────────────────
	// 内置模块按 ID 判断；自定义模块（ID 为 UUID）按生成的 HTML 内容特征检测
	const needsMermaid = ordered.some(
		(s) => MERMAID_IDS.has(s.id) || s.content.includes('class="mermaid"'),
	);
	const needsMarkmap = ordered.some(
		(s) => MARKMAP_IDS.has(s.id) || s.content.includes('id="markmap-svg"'),
	);

	// ── Tab 导航 ─────────────────────────────────────────────────────────────────
	const tabButtons = ordered
		.map(
			(s, i) =>
				`<button class="tab-btn${i === 0 ? " active" : ""}" data-idx="${i}">${s.title}</button>`,
		)
		.join("\n        ");

	// ── Section 内容面板 ─────────────────────────────────────────────────────────
	const panels = ordered
		.map((s, i) => {
			const inner =
				s.content ||
				'<p class="empty-module">本模块内容生成失败，请重新生成。</p>';
			return `<section class="tab-panel${i === 0 ? " active" : ""}" id="panel-${i}" aria-labelledby="tab-${i}">
        ${inner}
      </section>`;
		})
		.join("\n      ");

	// ── 各功能 Tab 索引 ───────────────────────────────────────────────────────────
	// 同样兼容自定义 markmap 模块（按内容特征）
	const infoArchTabIdx = ordered.findIndex(
		(s) => MARKMAP_IDS.has(s.id) || s.content.includes('id="markmap-svg"'),
	);
	// 数据模型下方有实体说明表，限制 ER 图画布高度；-1 表示本次未包含该模块
	const dataModelTabIdx = ordered.findIndex((s) => s.id === "dataModel");

	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PRD — ${escapeHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: Inter, "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
      font-size: 14px;
      color: #1e293b;
      background: #f8fafc;
      min-height: 100vh;
    }

    /* ── Layout ── */
    .prd-app {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }

    /* ── Tab Nav ── */
    .tab-nav {
      background: #fff;
      border-bottom: 1px solid #e2e8f0;
      padding: 0 32px;
      display: flex;
      gap: 0;
      overflow-x: auto;
      scrollbar-width: none;
      position: sticky;
      top: 0;
      z-index: 99;
    }
    .tab-nav::-webkit-scrollbar { display: none; }
    .tab-btn {
      padding: 12px 16px;
      font-size: 13px;
      font-family: inherit;
      border: none;
      background: transparent;
      cursor: pointer;
      color: #64748b;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      white-space: nowrap;
      transition: all 0.15s;
    }
    .tab-btn:hover { color: #1e293b; }
    .tab-btn.active {
      color: #4f46e5;
      border-bottom-color: #4f46e5;
      font-weight: 500;
    }

    /* ── Content ── */
    .prd-content {
      flex: 1;
      padding: 32px;
      max-width: 960px;
      width: 100%;
      margin: 0 auto;
    }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    /* ── Section Typography ── */
    .tab-panel h2 {
      font-size: 20px; font-weight: 600;
      color: #1e293b; margin: 0 0 12px;
      padding-bottom: 8px;
      border-bottom: 2px solid #e2e8f0;
    }
    .tab-panel h3 {
      font-size: 15px; font-weight: 600;
      color: #334155; margin: 20px 0 8px;
    }
    .tab-panel p { line-height: 1.75; color: #475569; margin: 0 0 10px; }
    .tab-panel ul, .tab-panel ol {
      padding-left: 20px; color: #475569; line-height: 1.75;
      margin: 0 0 12px;
    }
    .tab-panel li { margin-bottom: 4px; }
    .tab-panel strong { color: #1e293b; }

    /* ── prd-subsection ── */
    .prd-subsection {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 20px 24px;
      margin-bottom: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,.06);
    }

    /* ── Feature Module Group（功能清单多表结构） ── */
    .feature-module-group { margin-bottom: 24px; }
    .feature-module-title {
      font-size: 14px;
      font-weight: 700;
      color: #4f46e5;
      background: #eef2ff;
      border-left: 3px solid #4f46e5;
      margin: 0;
      padding: 9px 14px;
      border-radius: 8px 8px 0 0;
    }
    .feature-module-group .prd-table { margin-bottom: 0; border-radius: 0 0 8px 8px; }

    /* ── Tables ── */
    .prd-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      background: #fff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,.08);
      margin-bottom: 20px;
    }
    .prd-table th {
      background: #f1f5f9;
      padding: 10px 14px;
      text-align: left;
      font-weight: 600;
      color: #334155;
      border-bottom: 1px solid #e2e8f0;
    }
    .prd-table td {
      padding: 10px 14px;
      border-bottom: 1px solid #f1f5f9;
      color: #475569;
      vertical-align: top;
    }
    .prd-table tr:last-child td { border-bottom: none; }
    .prd-table tr:hover td { background: #f8fafc; }
    /* 向后兼容旧版单表结构 */
    .module-header td {
      background: #eef2ff !important;
      color: #4f46e5 !important;
      font-weight: 600;
      padding: 8px 14px;
    }

    /* ── Priority Badges ── */
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
    }
    .badge-p0 { background: #fee2e2; color: #b91c1c; }
    .badge-p1 { background: #fef3c7; color: #b45309; }
    .badge-p2 { background: #dcfce7; color: #15803d; }

    /* ── Scenario Cards ── */
    .scenario-card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 12px;
      box-shadow: 0 1px 2px rgba(0,0,0,.05);
    }
    .scenario-title {
      font-size: 14px;
      font-weight: 600;
      color: #4f46e5;
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid #e2e8f0;
    }

    /* ── Mermaid diagrams ── */
    .mermaid {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 20px;
      overflow-x: auto;
      box-shadow: 0 1px 3px rgba(0,0,0,.06);
      margin-bottom: 20px;
    }

    /* ── Markmap ── */
    .markmap-wrap {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,.06);
    }

    /* ── Entity Table ── */
    .entity-section {
      margin-bottom: 20px;
    }
    .entity-table-title {
      margin: 16px 0 8px;
      font-size: 15px;
      font-weight: 600;
      color: #334155;
    }

    /* ── Empty ── */
    .empty-module {
      text-align: center;
      color: #94a3b8;
      padding: 48px;
      background: #f8fafc;
      border-radius: 8px;
    }

    /* ── Print ── */
    @media print {
      .tab-nav { position: static; }
      .tab-panel { display: block !important; page-break-before: always; }
      .tab-panel:first-child { page-break-before: auto; }
    }
  </style>
</head>
<body>
  <div class="prd-app">
    <!-- Tab Nav -->
    <nav class="tab-nav" role="tablist">
      ${tabButtons}
    </nav>

    <!-- Content -->
    <main class="prd-content">
      ${panels}
    </main>
  </div>

  ${needsMermaid ? '<!-- CDN: mermaid -->\n  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"><\/script>' : ""}
  ${needsMarkmap ? '<!-- CDN: markmap -->\n  <script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"><\/script>\n  <script src="https://cdn.jsdelivr.net/npm/markmap-lib/dist/browser/index.js"><\/script>\n  <script src="https://cdn.jsdelivr.net/npm/markmap-view/dist/browser/index.js"><\/script>' : ""}

  <script>
    // ── mermaid：关闭 startOnLoad，改为手动按需渲染 ─────────────────────────────
    ${
			needsMermaid
				? `mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
      fontFamily: 'Inter, "PingFang SC", sans-serif'
    });`
				: ""
		}

    // ── 画布缩放 / 拖拽（滚轮缩放，中键拖动） ───────────────────────────────────
    var ZOOM_STEP = 0.12;
    var MIN_SCALE = 0.1;
    var MAX_SCALE = 8;
    var DATA_MODEL_TAB_IDX = ${dataModelTabIdx};
    var DATA_MODEL_MAX_H   = 430; // 数据模型 ER 图最大高度(px)，留空间给实体说明表

    function _applyTransform(svg, tx, ty, scale) {
      svg.style.transformOrigin = '0 0';
      svg.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) scale(' + scale + ')';
    }

    function _initZoomOnDiv(div, maxHeight) {
      if (div.dataset.zoomInit) return;
      var svg = div.querySelector(':scope > svg');
      if (!svg) return;

      div.dataset.zoomInit = '1';
      div.style.overflow = 'hidden';

      if (maxHeight !== undefined) {
        var svgH = svg.getBoundingClientRect().height;
        if (svgH > maxHeight) div.style.maxHeight = maxHeight + 'px';
      }

      var s = { scale: 1, tx: 0, ty: 0 };
      var dragging = false;
      var startX = 0, startY = 0, startTx = 0, startTy = 0;

      // 滚轮缩放（以鼠标光标为中心）
      div.addEventListener('wheel', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var rect = div.getBoundingClientRect();
        var mx = e.clientX - rect.left;
        var my = e.clientY - rect.top;
        var factor = e.deltaY < 0 ? (1 + ZOOM_STEP) : (1 / (1 + ZOOM_STEP));
        var newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s.scale * factor));
        if (newScale === s.scale) return;
        s.tx = mx - (mx - s.tx) * (newScale / s.scale);
        s.ty = my - (my - s.ty) * (newScale / s.scale);
        s.scale = newScale;
        _applyTransform(svg, s.tx, s.ty, s.scale);
      }, { passive: false });

      // 中键拖拽（Pointer Capture 确保移出 div 后仍响应）
      div.addEventListener('pointerdown', function(e) {
        if (e.button !== 1) return;
        e.preventDefault();
        div.setPointerCapture(e.pointerId);
        dragging = true;
        startX = e.clientX; startY = e.clientY;
        startTx = s.tx; startTy = s.ty;
      });
      div.addEventListener('pointermove', function(e) {
        if (!dragging) return;
        s.tx = startTx + (e.clientX - startX);
        s.ty = startTy + (e.clientY - startY);
        _applyTransform(svg, s.tx, s.ty, s.scale);
      });
      function _endDrag(e) {
        if (e.button !== 1 || !dragging) return;
        dragging = false;
        if (div.hasPointerCapture(e.pointerId)) div.releasePointerCapture(e.pointerId);
      }
      div.addEventListener('pointerup', _endDrag);
      div.addEventListener('pointercancel', _endDrag);
    }

    function _initZoomInPanel(panel, tabIdx) {
      var maxH = (tabIdx === DATA_MODEL_TAB_IDX && DATA_MODEL_TAB_IDX >= 0)
        ? DATA_MODEL_MAX_H
        : undefined;
      panel.querySelectorAll('.mermaid[data-processed]').forEach(function(div) {
        _initZoomOnDiv(div, maxH);
      });
    }

    // ── mermaid 渲染（Promise 化，渲染完成后初始化缩放） ─────────────────────────
    function runMermaidInPanel(panel, tabIdx) {
      ${
				needsMermaid
					? `var nodes = Array.from(panel.querySelectorAll('.mermaid:not([data-processed])'));
      if (typeof mermaid !== 'undefined' && nodes.length) {
        Promise.resolve(mermaid.run({ nodes: nodes })).then(function() {
          // 等 2 帧，让浏览器完成 SVG layout 再读取实际高度
          requestAnimationFrame(function() {
            requestAnimationFrame(function() {
              _initZoomInPanel(panel, tabIdx);
            });
          });
        });
      } else {
        // 已渲染过（Tab 重新切换），直接补初始化缩放
        _initZoomInPanel(panel, tabIdx);
      }`
					: "// mermaid not needed"
			}
    }

    // ── markmap 手动初始化 ────────────────────────────────────────────────────
    // 持有实例，以便每次 Tab 激活后都能调用 fit() 修正居中和缩放
    var _mmInstance = null;

    function initMarkmap() {
      var dataEl = document.getElementById('markmap-data');
      var svgEl  = document.getElementById('markmap-svg');
      if (!dataEl || !svgEl) return;

      try {
        var md = JSON.parse(dataEl.textContent);
        var Transformer = window.markmap.Transformer;
        var Markmap     = window.markmap.Markmap;
        var transformer = new Transformer();
        var root        = transformer.transform(md).root;
        _mmInstance = Markmap.create(svgEl, null, root);
        // 等一帧确保 SVG 已有真实像素尺寸，再居中填满
        requestAnimationFrame(function() {
          if (_mmInstance) _mmInstance.fit();
        });
      } catch(e) {
        console.error('[markmap] 初始化失败', e);
      }
    }

    function fitMarkmap() {
      if (!_mmInstance) {
        initMarkmap();
      } else {
        // 已初始化：Tab 重新可见后重新居中
        requestAnimationFrame(function() {
          _mmInstance.fit();
        });
      }
    }

    // ── Tab 切换 ────────────────────────────────────────────────────────────────
    var tabs   = document.querySelectorAll('.tab-btn');
    var panels = document.querySelectorAll('.tab-panel');
    var INFO_ARCH_IDX = ${infoArchTabIdx};

    tabs.forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(btn.dataset.idx, 10);
        tabs.forEach(function(t) { t.classList.remove('active'); });
        panels.forEach(function(p) { p.classList.remove('active'); });
        btn.classList.add('active');
        panels[idx].classList.add('active');
        runMermaidInPanel(panels[idx], idx);
        // 信息架构 Tab：首次进入初始化，再次进入重新 fit 居中
        if (idx === INFO_ARCH_IDX) fitMarkmap();
      });
    });

    // ── 渲染初始激活 Tab 中的图表 ─────────────────────────────────────────────
    runMermaidInPanel(panels[0], 0);
    if (INFO_ARCH_IDX === 0) fitMarkmap();
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
