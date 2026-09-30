// @ts-check
// PRD 渲染运行时（单一来源）：导出页内联为 <script type="module">，前端预览经 @prd-runtime 别名 import，
// 后端 import 其中的常量拼 CDN 标签。DOM 只在函数体内访问，保证 Node 端可安全 import。
// 对外 API 的类型声明见同目录 prd-runtime.d.ts，改签名时需同步。

const CDN = "https://cdn.jsdelivr.net/npm";

const ZOOM_STEP = 0.12;
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;

/** @returns {any} CDN 全局可能加载失败，使用前一律判空 */
function win() {
	return window;
}

/**
 * @typedef {object} DiagramLibrary
 * @property {string} name
 * @property {string} selector 浏览器端按 DOM 探测
 * @property {RegExp} htmlPattern 服务端按 HTML 字符串探测
 * @property {readonly string[]} scripts 按加载顺序排列；版本必须锁死，已导出的 PRD 不能因上游发版失效
 * @property {() => boolean} ready
 */

/** @type {readonly DiagramLibrary[]} */
export const DIAGRAM_LIBRARIES = Object.freeze([
	{
		name: "mermaid",
		selector: ".mermaid",
		htmlPattern: /\bclass\s*=\s*["'](?:[^"']*\s)?mermaid(?:\s[^"']*)?["']/,
		scripts: [`${CDN}/mermaid@10.9.8/dist/mermaid.min.js`],
		ready: () => !!win().mermaid,
	},
	{
		name: "markmap",
		selector: "#markmap-svg",
		htmlPattern: /\bid\s*=\s*["']markmap-svg["']/,
		scripts: [
			`${CDN}/d3@7.9.0/dist/d3.min.js`,
			`${CDN}/markmap-view@0.18.12/dist/browser/index.js`,
			`${CDN}/markmap-lib@0.18.12/dist/browser/index.iife.min.js`,
		],
		ready: () => {
			const mm = win().markmap;
			return !!(mm && mm.Transformer && mm.Markmap);
		},
	},
]);

/** 有后续内容的模块限制图表画布高度（数据模型下方有实体说明表） */
export const DIAGRAM_MAX_HEIGHT = Object.freeze({ dataModel: 430 });

export const MERMAID_CONFIG = Object.freeze({
	startOnLoad: false,
	theme: "default",
	securityLevel: "strict",
	fontFamily: 'Inter, "PingFang SC", sans-serif',
});

/**
 * 汇总各模块 HTML 所需的 CDN 脚本（保序）
 * @param {readonly string[]} contents
 * @returns {string[]}
 */
export function collectDiagramScripts(contents) {
	return DIAGRAM_LIBRARIES.filter((lib) =>
		contents.some((html) => lib.htmlPattern.test(html)),
	).flatMap((lib) => [...lib.scripts]);
}

/**
 * Mermaid 挂载 SVG 后需等浏览器完成布局才能读到真实尺寸
 * @param {number} n
 * @returns {Promise<void>}
 */
export function waitFrames(n) {
	return new Promise((resolve) => {
		/** @param {number} left */
		const step = (left) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
		step(n);
	});
}

// ── CDN 按需加载（前端预览用；导出页已静态引入） ─────────────────────────────

/** @type {Map<string, Promise<void>>} */
const scriptLoads = new Map();

/** @param {string} src */
function loadScript(src) {
	let pending = scriptLoads.get(src);
	if (!pending) {
		pending = new Promise((resolve, reject) => {
			const el = document.createElement("script");
			el.src = src;
			el.onload = () => resolve();
			el.onerror = () => reject(new Error(`脚本加载失败: ${src}`));
			document.head.appendChild(el);
		});
		// 失败后允许下次重试
		pending.catch(() => scriptLoads.delete(src));
		scriptLoads.set(src, pending);
	}
	return pending;
}

/** @param {DiagramLibrary} lib */
async function loadLibrary(lib) {
	if (lib.ready()) return;
	try {
		for (const src of lib.scripts) await loadScript(src);
	} catch (err) {
		console.warn(`[prd] ${lib.name} CDN 加载失败`, err);
	}
}

/**
 * @param {ParentNode} root
 * @returns {Promise<void>}
 */
export async function loadDiagramLibraries(root) {
	await Promise.all(
		DIAGRAM_LIBRARIES.filter((lib) => root.querySelector(lib.selector)).map(loadLibrary),
	);
}

/** 预热全部图表库：首次打开图表 Tab 时不必再等 CDN */
export async function preloadDiagramLibraries() {
	await Promise.all(DIAGRAM_LIBRARIES.map(loadLibrary));
}

// ── Mermaid ─────────────────────────────────────────────────────────────────

let mermaidInitialized = false;

/** @returns {any} */
function getMermaid() {
	const mermaid = win().mermaid;
	if (!mermaid) return null;
	if (!mermaidInitialized) {
		try {
			mermaid.initialize({ ...MERMAID_CONFIG });
			mermaidInitialized = true;
		} catch (err) {
			console.error("[prd] mermaid 初始化失败", err);
			return null;
		}
	}
	return mermaid;
}

/**
 * suppressErrors=true 时单张图语法错误显示为错误图，不影响其余图表；
 * 传 false 可拿到失败结果（前端源码编辑据此回滚）。
 * @param {Element[]} nodes
 * @param {{ suppressErrors?: boolean }} [options]
 * @returns {Promise<boolean>}
 */
export async function runMermaid(nodes, options = {}) {
	const mermaid = getMermaid();
	if (!mermaid || nodes.length === 0) return true;
	try {
		await mermaid.run({ nodes, suppressErrors: options.suppressErrors ?? true });
		return true;
	} catch (err) {
		console.warn("[prd] mermaid 渲染失败", err);
		return false;
	}
}

// ── 画布缩放 / 拖拽（滚轮缩放，中键拖动） ───────────────────────────────────

/**
 * @param {HTMLElement} div 已渲染的 .mermaid 容器
 * @param {number} [maxHeight]
 * @returns {(() => void) | null} 清理函数；已初始化或无 SVG 时返回 null
 */
function initZoom(div, maxHeight) {
	if (div.dataset.zoomInit) return null;
	const svg = div.querySelector(":scope > svg");
	if (!(svg instanceof SVGElement)) return null;

	div.dataset.zoomInit = "1";
	div.style.overflow = "hidden";
	if (maxHeight && svg.getBoundingClientRect().height > maxHeight) {
		div.style.maxHeight = `${maxHeight}px`;
	}

	const s = { scale: 1, tx: 0, ty: 0 };
	let dragging = false;
	let startX = 0;
	let startY = 0;
	let startTx = 0;
	let startTy = 0;

	const apply = () => {
		svg.style.transformOrigin = "0 0";
		svg.style.transform = `translate(${s.tx}px, ${s.ty}px) scale(${s.scale})`;
	};
	// 前端编辑 Mermaid 源码时容器带 is-source-editing，暂停画布交互
	const paused = () => div.classList.contains("is-source-editing");

	/** @param {WheelEvent} e */
	const onWheel = (e) => {
		if (paused()) return;
		e.preventDefault();
		e.stopPropagation();
		const rect = div.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;
		const factor = e.deltaY < 0 ? 1 + ZOOM_STEP : 1 / (1 + ZOOM_STEP);
		const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s.scale * factor));
		if (next === s.scale) return;
		s.tx = mx - (mx - s.tx) * (next / s.scale);
		s.ty = my - (my - s.ty) * (next / s.scale);
		s.scale = next;
		apply();
	};
	/** @param {PointerEvent} e */
	const onPointerDown = (e) => {
		if (e.button !== 1 || paused()) return;
		e.preventDefault();
		div.setPointerCapture(e.pointerId);
		dragging = true;
		startX = e.clientX;
		startY = e.clientY;
		startTx = s.tx;
		startTy = s.ty;
	};
	/** @param {PointerEvent} e */
	const onPointerMove = (e) => {
		if (!dragging) return;
		s.tx = startTx + (e.clientX - startX);
		s.ty = startTy + (e.clientY - startY);
		apply();
	};
	/** @param {PointerEvent} e */
	const onPointerEnd = (e) => {
		if (!dragging) return;
		dragging = false;
		if (div.hasPointerCapture(e.pointerId)) div.releasePointerCapture(e.pointerId);
	};

	div.addEventListener("wheel", onWheel, { passive: false });
	div.addEventListener("pointerdown", onPointerDown);
	div.addEventListener("pointermove", onPointerMove);
	div.addEventListener("pointerup", onPointerEnd);
	div.addEventListener("pointercancel", onPointerEnd);

	return () => {
		dragging = false;
		div.removeEventListener("wheel", onWheel);
		div.removeEventListener("pointerdown", onPointerDown);
		div.removeEventListener("pointermove", onPointerMove);
		div.removeEventListener("pointerup", onPointerEnd);
		div.removeEventListener("pointercancel", onPointerEnd);
		div.style.overflow = "";
		div.style.maxHeight = "";
		delete div.dataset.zoomInit;
		svg.style.transform = "";
		svg.style.transformOrigin = "";
	};
}

/**
 * 为容器内已渲染的 .mermaid 初始化缩放（可重入，已初始化的跳过）
 * @param {ParentNode} container
 * @param {number} [maxHeight]
 * @returns {Array<() => void>}
 */
export function initZoomIn(container, maxHeight) {
	/** @type {Array<() => void>} */
	const cleanups = [];
	container.querySelectorAll(".mermaid[data-processed]").forEach((el) => {
		if (!(el instanceof HTMLElement)) return;
		const cleanup = initZoom(el, maxHeight);
		if (cleanup) cleanups.push(cleanup);
	});
	return cleanups;
}

// ── Markmap（每个容器至多一张，实例按 svg 缓存） ───────────────────────────

/** @type {WeakMap<Element, { fit(): void }>} */
const markmaps = new WeakMap();

/** @param {ParentNode} container */
export function renderMarkmapIn(container) {
	const svg = container.querySelector("#markmap-svg");
	if (!svg) return;

	const existing = markmaps.get(svg);
	if (existing) {
		// 容器从隐藏变为可见后需重新居中
		requestAnimationFrame(() => existing.fit());
		return;
	}

	const dataEl = container.querySelector("#markmap-data");
	const lib = win().markmap;
	if (!dataEl || !lib || !lib.Transformer || !lib.Markmap) return;

	try {
		const md = JSON.parse(dataEl.textContent || '""');
		const { root } = new lib.Transformer().transform(md);
		const instance = lib.Markmap.create(svg, null, root);
		markmaps.set(svg, instance);
		requestAnimationFrame(() => instance.fit());
	} catch (err) {
		console.error("[prd] markmap 渲染失败", err);
	}
}

// ── 组合入口 ────────────────────────────────────────────────────────────────

/** @param {Element} el */
function isVisible(el) {
	return el.getClientRects().length > 0;
}

/**
 * 隐藏容器内渲染会抛错，Mermaid 却已打上 data-processed、保留源码文本；清掉标记以便可见时重试
 * @param {ParentNode} container
 */
function resetFailedMermaid(container) {
	container.querySelectorAll(".mermaid[data-processed]").forEach((el) => {
		if (!el.querySelector(":scope > svg") && !el.classList.contains("is-source-editing")) {
			el.removeAttribute("data-processed");
		}
	});
}

// 同一容器的渲染串行执行，避免并发调用重复渲染同一节点
/** @type {WeakMap<HTMLElement, Promise<unknown>>} */
const inflightRenders = new WeakMap();

/**
 * 渲染容器内全部图表；容器不可见时跳过（下次可见时再调用即可补渲染）
 * @param {HTMLElement} container
 * @param {{ maxHeight?: number, loadLibraries?: boolean }} [options]
 * @returns {Promise<Array<() => void>>} 新初始化的缩放清理函数
 */
export function renderDiagrams(container, options = {}) {
	const previous = inflightRenders.get(container) ?? Promise.resolve();
	const current = previous.catch(() => {}).then(() => renderDiagramsNow(container, options));
	inflightRenders.set(container, current);
	return current;
}

/**
 * @param {HTMLElement} container
 * @param {{ maxHeight?: number, loadLibraries?: boolean }} options
 * @returns {Promise<Array<() => void>>}
 */
async function renderDiagramsNow(container, options) {
	if (options.loadLibraries !== false) await loadDiagramLibraries(container);
	// 加载 CDN 或渲染期间用户可能已切走 Tab
	if (!isVisible(container)) return [];

	resetFailedMermaid(container);
	const pending = Array.from(container.querySelectorAll(".mermaid:not([data-processed])"));
	for (const node of pending) {
		if (!isVisible(container)) return [];
		await runMermaid([node]);
	}
	if (pending.length > 0) await waitFrames(2);
	if (!isVisible(container)) return [];

	const cleanups = initZoomIn(container, options.maxHeight);
	renderMarkmapIn(container);
	return cleanups;
}

/** 导出页入口：Tab 切换 + 当前面板图表渲染 */
export function mountPrdPage() {
	// 必须在 window load 前初始化：Mermaid 默认 startOnLoad 会把隐藏面板里的图也渲染成 NaN 尺寸
	getMermaid();

	/** @type {HTMLElement[]} */
	const tabs = Array.from(document.querySelectorAll(".tab-btn"));
	/** @type {HTMLElement[]} */
	const panels = Array.from(document.querySelectorAll(".tab-panel"));

	/** @param {number} idx */
	const activate = (idx) => {
		const panel = panels[idx];
		if (!panel) return;
		tabs.forEach((tab, i) => {
			tab.classList.toggle("active", i === idx);
			tab.setAttribute("aria-selected", String(i === idx));
		});
		panels.forEach((p, i) => p.classList.toggle("active", i === idx));
		const maxHeight = Number(panel.dataset.diagramMaxHeight) || undefined;
		renderDiagrams(panel, { maxHeight, loadLibraries: false }).catch((err) =>
			console.error("[prd] 图表渲染失败", err),
		);
	};

	tabs.forEach((tab, i) => tab.addEventListener("click", () => activate(i)));
	activate(0);
}
