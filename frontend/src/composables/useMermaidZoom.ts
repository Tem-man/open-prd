interface ZoomState {
	scale: number;
	tx: number;
	ty: number;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
/** 每个滚轮 notch 缩放约 12% */
const ZOOM_STEP = 0.12;

function applyTransform(svg: SVGSVGElement, { scale, tx, ty }: ZoomState) {
	svg.style.transformOrigin = "0 0";
	svg.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
}

/**
 * 为 .mermaid 渲染容器提供画布缩放（滚轮）和拖拽（中键）能力。
 *
 * 使用方式：
 *   const { initZoom, destroyAll } = useMermaidZoom(isEditing)
 *   // Mermaid 渲染完成后：
 *   initZoom(containerEl)
 *   // 重置 innerHTML 前或组件卸载时：
 *   destroyAll()
 */
export function useMermaidZoom() {
	/** 每个已初始化的 .mermaid div 对应一个清理函数 */
	const cleanups: Array<() => void> = [];

	/**
	 * @param div       目标 .mermaid 容器
	 * @param maxHeight 可选的画布视口高度上限（px）。
	 *   传入时：SVG 实际高度超过该值才截断，防止后续内容被挤出视口（适合数据模型）。
	 *   不传时：不截断，图表独占全部自然高度（适合产品架构、业务流程）。
	 */
	function initZoomOnDiv(div: HTMLElement, maxHeight?: number): void {
		// 避免重复初始化
		if (div.dataset["zoomInit"]) return;

		const svg = div.querySelector<SVGSVGElement>(":scope > svg");
		if (!svg) return;

		div.dataset["zoomInit"] = "1";
		// 超出 div 边界的 SVG 内容需要被裁剪，以实现画布效果
		div.style.overflow = "hidden";

		// 仅在调用方指定了 maxHeight 且 SVG 高度超过该值时才截断
		if (maxHeight !== undefined) {
			const svgH = svg.getBoundingClientRect().height;
			if (svgH > maxHeight) {
				div.style.maxHeight = `${maxHeight}px`;
			}
		}

		const state: ZoomState = { scale: 1, tx: 0, ty: 0 };
		let dragging = false;
		let startX = 0;
		let startY = 0;
		let startTx = 0;
		let startTy = 0;

		// ── 滚轮缩放（以鼠标为中心点） ──────────────────────────────────────
		const onWheel = (e: WheelEvent) => {
			if (div.classList.contains("is-source-editing")) return;
			e.preventDefault();
			e.stopPropagation();

			const rect = div.getBoundingClientRect();
			const mx = e.clientX - rect.left;
			const my = e.clientY - rect.top;

			const factor = e.deltaY < 0 ? 1 + ZOOM_STEP : 1 / (1 + ZOOM_STEP);
			const newScale = Math.max(
				MIN_SCALE,
				Math.min(MAX_SCALE, state.scale * factor),
			);
			if (newScale === state.scale) return;

			// 缩放时保持鼠标所指内容不动
			state.tx = mx - (mx - state.tx) * (newScale / state.scale);
			state.ty = my - (my - state.ty) * (newScale / state.scale);
			state.scale = newScale;
			applyTransform(svg, state);
		};

		// ── 中键拖拽（使用 Pointer Capture，无需 document 级别监听） ────────
		const onPointerdown = (e: PointerEvent) => {
			if (e.button !== 1) return;
			if (div.classList.contains("is-source-editing")) return;
			e.preventDefault();
			// 捕获指针，确保鼠标移出 div 后仍能收到 move/up 事件
			div.setPointerCapture(e.pointerId);
			dragging = true;
			startX = e.clientX;
			startY = e.clientY;
			startTx = state.tx;
			startTy = state.ty;
		};

		const onPointermove = (e: PointerEvent) => {
			if (!dragging) return;
			state.tx = startTx + (e.clientX - startX);
			state.ty = startTy + (e.clientY - startY);
			applyTransform(svg, state);
		};

		const onPointerup = (e: PointerEvent) => {
			if (e.button !== 1 || !dragging) return;
			dragging = false;
			if (div.hasPointerCapture(e.pointerId)) {
				div.releasePointerCapture(e.pointerId);
			}
		};

		div.addEventListener("wheel", onWheel, { passive: false });
		div.addEventListener("pointerdown", onPointerdown);
		div.addEventListener("pointermove", onPointermove);
		div.addEventListener("pointerup", onPointerup);
		// pointercancel（如系统打断）同样结束拖拽
		div.addEventListener("pointercancel", onPointerup);

		cleanups.push(() => {
			dragging = false;
			div.removeEventListener("wheel", onWheel);
			div.removeEventListener("pointerdown", onPointerdown);
			div.removeEventListener("pointermove", onPointermove);
			div.removeEventListener("pointerup", onPointerup);
			div.removeEventListener("pointercancel", onPointerup);
			div.style.overflow = "";
			div.style.maxHeight = "";
			delete div.dataset["zoomInit"];
			svg.style.transform = "";
			svg.style.transformOrigin = "";
		});
	}

	/**
	 * 对 container 内所有已完成渲染的 .mermaid[data-processed] 初始化缩放/拖拽。
	 * 安全重入：已初始化的 div 会被跳过。
	 * @param maxHeight 可选，传给 initZoomOnDiv，仅数据模型等有后续内容的模块需要传入。
	 */
	function initZoom(container: HTMLElement, maxHeight?: number): void {
		container
			.querySelectorAll<HTMLElement>(".mermaid[data-processed]")
			.forEach((div) => initZoomOnDiv(div, maxHeight));
	}

	/**
	 * 清理所有已注册的缩放/拖拽监听，重置 SVG transform。
	 * 应在 innerHTML 被重置或组件卸载前调用。
	 */
	function destroyAll(): void {
		cleanups.splice(0).forEach((fn) => fn());
	}

	return { initZoom, destroyAll };
}
