<script setup lang="ts">
	/**
	 * PrdSectionItem — 单个 PRD 模块编辑功能实现
	 *
	 * 编辑模式有两个子模式：
	 *   select  默认，单击选中块级元素 → 出现 ElementFloatPanel
	 *   text    双击后进入，contenteditable 文本光标编辑
	 *
	 * 编辑模式切换：
	 *   点击编辑按钮 → 进入 select 模式
	 *   双击文本 → 进入 text 模式
	 *
	 * AI 重写指令 / 保存文案 / 撤回 / 取消 已迁移至左侧 SessionSidebar
	 */
	import {
		ref,
		watch,
		nextTick,
		onMounted,
		computed,
		onBeforeUnmount,
	} from "vue";
	import { usePrdEditStore } from "@/stores/prdEdit";
	import { useSectionActions } from "@/composables/useSectionActions";
	import ElementFloatPanel from "@/components/ElementFloatPanel.vue";
	import ConfirmDialog from "@/views/home/components/ConfirmDialog.vue";
	import {
		type MermaidErZone,
		extractEntityBlock,
		extractRelationLines,
		replaceEntityBlock,
		replaceRelationLines,
		isMermaidRelationEl,
		zoneHintText,
	} from "@/utils/mermaidErUtils";
	import { useMermaidZoom } from "@/composables/useMermaidZoom";

	const props = defineProps<{
		sessionId: string;
		sectionId: string;
		title: string;
		html: string;
		version: number;
		editable: boolean;
		isActive?: boolean; // 当前 Tab 是否可见，用于控制 Mermaid 渲染时机
		renderType?: string; // 自定义模块的渲染类型，用于按需加载 CDN
	}>();

	const prdEditStore = usePrdEditStore();

	const isEditing = computed(
		() => prdEditStore.editingSection === props.sectionId,
	);

	const { initZoom, destroyAll: destroyZoom } = useMermaidZoom();

	/**
	 * 各 sectionId 对应的画布最大高度（px）。
	 * 有后续内容的模块（如数据模型下方有实体说明表）需要限高，避免把内容挤出视口。
	 * 产品架构、业务流程独占画面，不传 maxHeight（undefined = 不截断）。
	 */
	const SECTION_ZOOM_MAX_HEIGHT: Record<string, number> = {
		dataModel: 430,
	};
	const zoomMaxHeight = computed<number | undefined>(
		() => SECTION_ZOOM_MAX_HEIGHT[props.sectionId],
	);
	const isAiEditing = computed(
		() => prdEditStore.aiEditingSection === props.sectionId,
	);
	const hovered = ref(false);

	// 内容区 DOM ref
	const contentRef = ref<HTMLDivElement | null>(null);

	const { saveSection } = useSectionActions();

	// ── 编辑子模式 ──────────────────────────────────────────────────────────────
	type EditSubMode = "select" | "text";
	const editSubMode = ref<EditSubMode>("select");
	const selectedEl = ref<HTMLElement | null>(null);
	/** 选中的 Mermaid SVG 实体名（如 "ROLE"），仅在选中 ER 图实体时非空 */
	const selectedEntityName = ref<string>("");
	/** 当前选中实体所在的 .mermaid div（用于提取/更新源码） */
	const selectedMermaidDiv = ref<HTMLElement | null>(null);
	/** 选中的属性行索引（-1 表示点到实体标题区域，未选中具体属性） */
	const selectedAttrIndex = ref(-1);
	/** 当前点击的 Mermaid 区域类型，驱动分段编辑 */
	const selectedMermaidZone = ref<MermaidErZone | "">("");

	/** 可识别为有意义块的 CSS 选择器（不含 SVG 内部子元素，表格内部元素由 TABLE_TAGS 单独处理） */
	const BLOCK_SELECTORS = [
		"h2",
		"h3",
		"h4",
		"h5",
		"p",
		"table",
		"li",
		".scenario-card",
		".prd-subsection",
		".mermaid",
		".markmap-wrap",
		".module-header",
		"blockquote",
		"pre",
	].join(", ");

	/** 表格相关标签，点击时走两级选择逻辑，不走 BLOCK_SELECTORS */
	const TABLE_TAGS = new Set(["TABLE", "TR", "TD", "TH"]);

	/** 记录第一级选中的 table 元素，用于判断是否可进入第二级 */
	const selectedTable = ref<HTMLElement | null>(null);

	/** 多选的单元格集合（Ctrl+click 或拖拽横扫填充，限同一行） */
	const selectedCells = ref<HTMLElement[]>([]);
	/** 是否正在拖拽多选中 */
	const isDragging = ref(false);
	/** 拖拽多选的起始行（同行限制依据） */
	const dragAnchorRow = ref<HTMLElement | null>(null);
	/** mousedown 时记录的 td（用于区分 click 和 drag） */
	let pointerDownTd: HTMLElement | null = null;
	/** 是否发生了实际拖动（阻止 click 事件重复处理） */
	let hasDragged = false;
	/** 短暂提示文字（例如跨行警告） */
	const toastMsg = ref("");
	let toastTimer: ReturnType<typeof setTimeout> | null = null;

	function showLocalToast(msg: string) {
		toastMsg.value = msg;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => {
			toastMsg.value = "";
		}, 2000);
	}

	// ── Mermaid / markmap 渲染 ──────────────────────────────────────────────────

	/**
	 * 等待 n 个浏览器渲染帧。
	 * Mermaid ER 图在 SVG 挂载后需要浏览器完成 layout 才能调 getBBox()，
	 * nextTick() 只等 Vue diff，不足以保证浏览器排版完成，需额外等帧。
	 */
	function waitFrames(n: number): Promise<void> {
		return new Promise((resolve) => {
			const step = (remaining: number) => {
				if (remaining <= 0) resolve();
				else requestAnimationFrame(() => step(remaining - 1));
			};
			step(n);
		});
	}

	/** 动态加载外部脚本（幂等，已存在则跳过） */
	function loadScript(src: string): Promise<void> {
		return new Promise((resolve, reject) => {
			if (document.querySelector(`script[src="${src}"]`)) {
				resolve();
				return;
			}
			const s = document.createElement("script");
			s.src = src;
			s.onload = () => resolve();
			s.onerror = () => reject(new Error(`脚本加载失败: ${src}`));
			document.head.appendChild(s);
		});
	}

	/** 根据模块 renderType 或 HTML 内容特征，按需加载 Mermaid / Markmap CDN */
	async function ensureDiagramCdn() {
		const win = window as unknown as {
			mermaid?: unknown;
			markmap?: unknown;
		};
		const needsMermaid =
			props.renderType === "mermaid" ||
			contentRef.value?.querySelector(".mermaid") !== null;
		const needsMarkmap =
			props.renderType === "markmap" ||
			contentRef.value?.querySelector("#markmap-svg") !== null;

		if (needsMermaid && !win.mermaid) {
			try {
				await loadScript(
					"https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js",
				);
				(
					win as unknown as {
						mermaid: { initialize: (o: object) => void };
					}
				).mermaid.initialize({
					startOnLoad: false,
					theme: "default",
					securityLevel: "loose",
				});
			} catch (e) {
				console.warn("[PrdSectionItem] Mermaid CDN 加载失败", e);
			}
		}

		if (needsMarkmap && !win.markmap) {
			try {
				await loadScript("https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js");
				await loadScript(
					"https://cdn.jsdelivr.net/npm/markmap-lib/dist/browser/index.js",
				);
				await loadScript(
					"https://cdn.jsdelivr.net/npm/markmap-view/dist/browser/index.js",
				);
			} catch (e) {
				console.warn("[PrdSectionItem] Markmap CDN 加载失败", e);
			}
		}
	}

	type MermaidRuntime = {
		mermaid?: { run: (o: object) => Promise<void> | void };
	};

	async function runMermaidNodes(
		nodes: HTMLElement[],
		showError = false,
	): Promise<boolean> {
		const win = window as unknown as MermaidRuntime;
		if (!win.mermaid || nodes.length === 0) return true;
		try {
			await Promise.resolve(win.mermaid.run({ nodes }));
			return true;
		} catch (error) {
			console.warn("[mermaid] 渲染失败", error);
			if (showError) showLocalToast("Mermaid 语法错误，已恢复原内容");
			return false;
		}
	}

	async function runDiagrams() {
		if (!contentRef.value) return;
		await nextTick();

		// 自定义图表模块可能没有内置 CDN，先确保 CDN 已加载
		await ensureDiagramCdn();

		type W = MermaidRuntime & { markmap?: unknown };
		const win = window as unknown as W;

		// Mermaid：渲染后等待 2 帧 layout 完成，再初始化缩放/拖拽
		if (win.mermaid) {
			const nodes = Array.from(
				contentRef.value!.querySelectorAll(".mermaid:not([data-processed])"),
			) as HTMLElement[];
			if (nodes.length > 0) {
				await runMermaidNodes(nodes);
				await waitFrames(2);
			}
			// 无论是否有新节点渲染，都初始化缩放。
			// destroyZoom 后已有 data-processed 的节点（如 applyMermaidSource 产生的 freshDiv）
			// 同样需要补充初始化，否则编辑后缩放失效。
			if (contentRef.value) initZoom(contentRef.value, zoomMaxHeight.value);
		}

		// Markmap
		if (!contentRef.value) return;
		const dataEl = contentRef.value.querySelector("#markmap-data");
		const svgEl = contentRef.value.querySelector("#markmap-svg");
		if (dataEl && svgEl && win.markmap) {
			try {
				// 清空 SVG，防止多次调用 create() 时思维导图叠加
				svgEl.innerHTML = "";
				const { Transformer, Markmap } = win.markmap as {
					Transformer: new () => {
						transform: (md: string) => { root: unknown };
					};
					Markmap: {
						create: (el: Element, o: null, r: unknown) => { fit: () => void };
					};
				};
				const { root } = new Transformer().transform(
					JSON.parse((dataEl as HTMLElement).textContent ?? '""') as string,
				);
				const mm = Markmap.create(svgEl, null, root);
				requestAnimationFrame(() => mm.fit());
			} catch (e) {
				console.warn("[markmap] 渲染失败", e);
			}
		}
	}

	onMounted(() => {
		// 只在面板可见时才渲染图表，避免 display:none 容器导致 Mermaid 计算出 NaN
		if (props.isActive !== false) void runDiagrams();
	});

	// Tab 切换为可见时补触发渲染（以及 html 内容更新后）
	watch(
		() => props.html,
		() => {
			if (!isEditing.value) {
				nextTick(() => {
					destroyZoom(); // 先销毁旧 zoom，再重置 DOM
					if (contentRef.value) contentRef.value.innerHTML = props.html;
					if (props.isActive !== false) void runDiagrams();
				});
			}
		},
	);

	// 当 Tab 切换为可见时，重新渲染图表
	watch(
		() => props.isActive,
		(active) => {
			if (active) void runDiagrams();
		},
	);

	// ── 编辑态管理 ──────────────────────────────────────────────────────────────
	function startEdit() {
		if (!props.editable) return;
		prdEditStore.startEdit(props.sectionId);
		prdEditStore.registerHtmlGetter(getContentHtml);
		editSubMode.value = "select";
		selectedEl.value = null;
	}

	function cancelEdit() {
		leaveTextMode(false); // 取消：不保存 Mermaid 源码编辑
		selectedEl.value = null;
		selectedTable.value = null;
		destroyZoom(); // 先销毁旧 zoom 实例，避免重置 innerHTML 后残留 document 级监听
		if (contentRef.value) contentRef.value.innerHTML = props.html;
		prdEditStore.cancelEdit();
		if (props.isActive !== false) void runDiagrams();
	}

	// ── 元素高亮 ─────────────────────────────────────────────────────────────────
	/**
	 * 清除视觉高亮。
	 * @param resetEntityName 是否同时清空 selectedEntityName（默认 true）。
	 *   highlightSvgEntity 内部调用时传 false，因为调用后会立即重新设置 entityName。
	 */
	function clearHighlight(resetEntityName = true) {
		contentRef.value?.querySelectorAll(".el-selected").forEach((el) => {
			el.classList.remove("el-selected");
		});
		// 同时清理多选高亮
		contentRef.value?.querySelectorAll(".el-selected-cell").forEach((el) => {
			el.classList.remove("el-selected-cell");
		});
		selectedCells.value = [];
		// 同时恢复 SVG 实体 rect 描边和填充
		contentRef.value
			?.querySelectorAll(".mermaid [data-orig-stroke]")
			.forEach((el) => {
				const rect = el as SVGRectElement;
				rect.setAttribute("stroke", rect.dataset["origStroke"] ?? "");
				rect.setAttribute(
					"stroke-width",
					rect.dataset["origStrokeWidth"] ?? "1",
				);
				if (rect.dataset["origFill"] !== undefined) {
					rect.setAttribute("fill", rect.dataset["origFill"]);
					delete rect.dataset["origFill"];
				}
				delete rect.dataset["origStroke"];
				delete rect.dataset["origStrokeWidth"];
			});
		if (resetEntityName) {
			selectedEntityName.value = "";
			selectedMermaidZone.value = "";
			selectedMermaidDiv.value = null;
		}
	}

	function highlightEl(el: HTMLElement) {
		console.log("highlightEl", el);
		// 清除高亮
		clearHighlight();
		// 高亮元素
		el.classList.add("el-selected");
	}

	// ── 多选逻辑 ─────────────────────────────────────────────────────────────────

	/**
	 * Ctrl+单击 td/th 时的多选切换逻辑。
	 * 返回 true 表示已处理，调用方直接 return；
	 * 返回 false 表示不满足多选条件，调用方继续走普通单选。
	 */
	function handleCtrlClickCell(td: HTMLElement): boolean {
		const row = td.closest("tr") as HTMLElement | null;
		if (!row) return false;

		// ── Case A：已有多选 → 切换该格 ──────────────────────────────────────
		if (selectedCells.value.length > 0) {
			const anchorRow = selectedCells.value[0].closest("tr");
			if (row !== anchorRow) {
				showLocalToast("多选仅限同行");
				clearHighlight();
				selectedEl.value = null;
				selectedTable.value = null;
				return true;
			}
			const idx = selectedCells.value.indexOf(td);
			if (idx >= 0) {
				td.classList.remove("el-selected-cell");
				selectedCells.value.splice(idx, 1);
			} else {
				td.classList.add("el-selected-cell");
				selectedCells.value.push(td);
			}
			// 退化到单选
			if (selectedCells.value.length === 0) {
				selectedEl.value = null;
			} else if (selectedCells.value.length === 1) {
				const sole = selectedCells.value[0];
				sole.classList.remove("el-selected-cell");
				selectedCells.value = [];
				clearHighlight();
				highlightEl(sole);
				selectedEl.value = sole;
			} else {
				selectedEl.value = row;
			}
			return true;
		}

		// ── Case B：当前已单选一个 td/th → 扩展为多选 ────────────────────────
		if (
			selectedEl.value &&
			(selectedEl.value.tagName === "TD" || selectedEl.value.tagName === "TH")
		) {
			const existingRow = selectedEl.value.closest("tr");
			if (row !== existingRow) {
				showLocalToast("多选仅限同行");
				return true;
			}
			clearHighlight(); // 清除 el-selected，selectedCells 置空
			selectedEl.value.classList.add("el-selected-cell");
			td.classList.add("el-selected-cell");
			selectedCells.value = [selectedEl.value, td];
			selectedEl.value = row;
			selectedTable.value = null;
			return true;
		}

		// 其他情况（第一级 / 普通元素）：不处理多选，继续走普通逻辑
		return false;
	}

	// ── 拖拽多选：mousedown / mousemove ──────────────────────────────────────────

	function onContentMousedown(e: MouseEvent) {
		if (!isEditing.value || editSubMode.value !== "select") return;
		if (e.button !== 0) return;

		const tdTarget = (e.target as Element).closest(
			"td, th",
		) as HTMLElement | null;
		if (!tdTarget || !contentRef.value?.contains(tdTarget)) return;

		const parentTable = tdTarget.closest("table") as HTMLElement | null;
		if (!parentTable) return;

		// 只在"已选中这张表（第一级）"或"已在这张表内有选中元素/多选"时开始追踪
		const isTableFirstLevel = selectedTable.value === parentTable;
		const hasCellInTable =
			selectedEl.value?.closest("table") === parentTable ||
			(selectedCells.value[0]?.closest("table") ?? null) === parentTable;
		if (!isTableFirstLevel && !hasCellInTable) return;

		pointerDownTd = tdTarget;
		hasDragged = false;
	}

	function onContentMousemove(e: MouseEvent) {
		if (!pointerDownTd || (e.buttons & 1) === 0) return;

		const tdTarget = (e.target as Element).closest(
			"td, th",
		) as HTMLElement | null;
		if (!tdTarget || tdTarget === pointerDownTd) return;
		if (!contentRef.value?.contains(tdTarget)) return;

		const anchorRow = pointerDownTd.closest("tr");
		const targetRow = tdTarget.closest("tr");
		if (anchorRow !== targetRow) return; // 跨行，忽略

		if (!hasDragged) {
			// 首次跨格移动：进入拖拽模式
			hasDragged = true;
			isDragging.value = true;
			dragAnchorRow.value = anchorRow as HTMLElement;
			clearHighlight();
			selectedTable.value = null;
			pointerDownTd.classList.add("el-selected-cell");
			selectedCells.value = [pointerDownTd];
			selectedEl.value = pointerDownTd;
		}

		if (!selectedCells.value.includes(tdTarget)) {
			tdTarget.classList.add("el-selected-cell");
			selectedCells.value.push(tdTarget);
			if (selectedCells.value.length >= 2) {
				selectedEl.value = dragAnchorRow.value!;
			}
		}
	}

	function onDocMouseup() {
		if (!isDragging.value) {
			pointerDownTd = null;
			return;
		}
		isDragging.value = false;
		dragAnchorRow.value = null;

		// 只拖过一格：退化为普通单选
		if (selectedCells.value.length === 1) {
			const sole = selectedCells.value[0];
			sole.classList.remove("el-selected-cell");
			selectedCells.value = [];
			clearHighlight();
			highlightEl(sole);
			selectedEl.value = sole;
		}
		// 2+ cells：保持多选，selectedEl 已是首格

		pointerDownTd = null;
		// 注意：不在此处重置 hasDragged。
		// 浏览器事件顺序：mouseup → click → setTimeout(0)
		// 让 onContentClick 先消费 hasDragged（拦截拖拽结束的那次 click，
		// 防止它覆盖多选状态）；setTimeout(0) 作为安全兜底，
		// 应对拖拽在内容区外结束、click 不触发的情况。
		setTimeout(() => {
			hasDragged = false;
		}, 0);
	}

	/** 高亮 Mermaid SVG 中的实体节点（整张实体表） */
	function highlightSvgEntity(g: Element) {
		clearHighlight(false);

		g.querySelectorAll<SVGRectElement>("rect").forEach((rect, i) => {
			rect.dataset["origStroke"] = rect.getAttribute("stroke") ?? "";
			rect.dataset["origStrokeWidth"] =
				rect.getAttribute("stroke-width") ?? "1";
			rect.dataset["origFill"] = rect.getAttribute("fill") ?? "";

			if (i === 0) {
				// 标题栏：深紫色粗描边 + 蓝紫背景
				rect.setAttribute("stroke", "#3730a3");
				rect.setAttribute("stroke-width", "5");
				rect.setAttribute("fill", "#c7d2fe");
			} else {
				// 属性行：同色描边稍细 + 浅蓝填充
				rect.setAttribute("stroke", "#4f46e5");
				rect.setAttribute("stroke-width", "3");
				rect.setAttribute("fill", "#eef2ff");
			}
		});
	}

	/**
	 * 从 Mermaid 渲染出的 SVG <g id="entity-NAME-uuid"> 提取实体名。
	 * ID 格式：entity-{NAME}-{8位hex}-{4位hex}-{4位hex}-{4位hex}-{12位hex}
	 */
	function extractEntityName(id: string): string {
		const m = id.match(
			/^entity-(.+?)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		);
		return m?.[1] ?? "";
	}

	// ── 选择子模式：点击 → 识别块 → 高亮 + 浮层 ────────────────────────────────
	function onContentClick(e: MouseEvent) {
		if (!isEditing.value) return;

		// 文本模式：让浏览器正常处理光标，不干预
		if (editSubMode.value === "text") return;

		e.preventDefault();
		e.stopPropagation();

		// 拖拽结束后的 click 事件：拦截，不重复处理
		if (hasDragged) {
			hasDragged = false;
			pointerDownTd = null;
			return;
		}

		const clickedEl = e.target as Element;

		// Ctrl+单击（Windows/Linux）或 ⌘+单击（Mac）→ 多选逻辑（仅限 td/th）
		if (e.ctrlKey || e.metaKey) {
			const tdTarget = clickedEl.closest("td, th") as HTMLElement | null;
			if (tdTarget && contentRef.value?.contains(tdTarget)) {
				handleCtrlClickCell(tdTarget);
				return;
			}
		}

		// ① 优先检查是否点在 Mermaid SVG 实体上
		const mermaidDiv = clickedEl.closest(".mermaid") as HTMLElement | null;
		if (mermaidDiv && contentRef.value!.contains(mermaidDiv)) {
			// 正在编辑源码时，点击 textarea 不触发选区逻辑
			if (mermaidDiv.classList.contains("is-source-editing")) return;
			// 从点击元素往上找 <g id="entity-*"> 节点
			let svgEl: Element | null = clickedEl;
			let entityGroup: Element | null = null;
			while (svgEl && svgEl !== mermaidDiv) {
				if (
					svgEl.tagName.toLowerCase() === "g" &&
					/^entity-/i.test(svgEl.id ?? "")
				) {
					entityGroup = svgEl;
					break;
				}
				svgEl = svgEl.parentElement;
			}

			if (entityGroup) {
				// ── 区域：实体 ──
				highlightSvgEntity(entityGroup);
				selectedEntityName.value = extractEntityName(entityGroup.id);
				selectedMermaidDiv.value = mermaidDiv;
				selectedMermaidZone.value = "entity";

				// 用点击坐标命中检测，找到所在属性行的 rect 作为精确锚点
				const attrRects = Array.from(
					entityGroup.querySelectorAll<SVGRectElement>(
						'rect[class*="attributeBox"]',
					),
				);
				const hitAttrIdx = attrRects.findIndex((rect) => {
					const r = rect.getBoundingClientRect();
					return (
						e.clientX >= r.left &&
						e.clientX <= r.right &&
						e.clientY >= r.top &&
						e.clientY <= r.bottom
					);
				});
				selectedAttrIndex.value = hitAttrIdx;
				selectedEl.value = (hitAttrIdx >= 0
					? attrRects[hitAttrIdx]
					: entityGroup) as unknown as HTMLElement;
				return;
			}

			// ── 区域：关系连线 ──
			if (isMermaidRelationEl(clickedEl)) {
				clearHighlight(false);
				selectedEntityName.value = "";
				selectedMermaidZone.value = "relation";
				selectedMermaidDiv.value = mermaidDiv;
				highlightEl(mermaidDiv);
				selectedEl.value = mermaidDiv;
				return;
			}

			// ── 区域：整图空白 ──
			clearHighlight(false);
			selectedEntityName.value = "";
			selectedMermaidZone.value = "diagram";
			selectedMermaidDiv.value = mermaidDiv;
			highlightEl(mermaidDiv);
			selectedEl.value = mermaidDiv;
			return;
		}

		// ② 表格元素两级选择（table → tr/td/th）
		const tableTarget = clickedEl.closest(
			"table, tr, td, th",
		) as HTMLElement | null;
		if (tableTarget && contentRef.value!.contains(tableTarget)) {
			const parentTable = tableTarget.closest("table") as HTMLElement | null;
			if (!parentTable || !contentRef.value!.contains(parentTable)) {
				clearHighlight();
				selectedEl.value = null;
				return;
			}

			if (tableTarget.tagName === "TABLE") {
				// 直接点到 table 本身（边框或空白区域）
				selectedEntityName.value = "";
				highlightEl(parentTable);
				selectedTable.value = parentTable; // 必须在 highlightEl 之后赋值
				selectedEl.value = parentTable;
				return;
			}

			// 已选中这张表（第一级），再次单击内部 tr/td/th → 进入第二级
			if (selectedTable.value === parentTable) {
				selectedEntityName.value = "";
				highlightEl(tableTarget);
				selectedTable.value = null; // 进入第二级后清除，使下次点击重新进第一级
				selectedEl.value = tableTarget;
				return;
			}

			// 已在第二级选中某 tr，再次点击该行内 td/th → 直接更新第二级选中
			if (
				selectedEl.value?.tagName === "TR" &&
				tableTarget.closest("tr") === selectedEl.value
			) {
				selectedEntityName.value = "";
				highlightEl(tableTarget);
				selectedEl.value = tableTarget;
				return;
			}

			// 第一级：尚未选中任何表，选整表
			selectedEntityName.value = "";
			highlightEl(parentTable);
			selectedTable.value = parentTable; // 必须在 highlightEl 之后赋值
			selectedEl.value = parentTable;
			return;
		}

		// ③ 普通 HTML 块选中
		selectedTable.value = null;
		let target = clickedEl.closest(BLOCK_SELECTORS) as HTMLElement | null;
		if (!target || !contentRef.value!.contains(target)) {
			clearHighlight();
			selectedEl.value = null;
			return;
		}

		selectedEntityName.value = "";
		highlightEl(target);
		selectedEl.value = target;
	}

	// ── 选择子模式：双击 → 进入文本模式 ─────────────────────────────────────────
	function onContentDblClick(e: MouseEvent) {
		if (!isEditing.value) return;
		e.preventDefault();
		enterTextMode(e.target as HTMLElement);
	}

	function enterTextMode(clickedEl?: HTMLElement) {
		editSubMode.value = "text";
		clearHighlight();
		selectedEl.value = null;

		nextTick(() => {
			if (!contentRef.value) return;
			contentRef.value.setAttribute("contenteditable", "true");
			// 将光标定位到双击位置的元素
			if (clickedEl && contentRef.value.contains(clickedEl)) {
				const range = document.createRange();
				range.selectNodeContents(clickedEl);
				range.collapse(true);
				const sel = window.getSelection();
				sel?.removeAllRanges();
				sel?.addRange(range);
			}
			contentRef.value.focus();
		});
	}

	function leaveTextMode(_save = true) {
		if (contentRef.value) {
			contentRef.value.removeAttribute("contenteditable");
			// 清理 Tab 键导航监听（新增行进入文字模式时绑定）
			if (tabNavHandler) {
				contentRef.value.removeEventListener("keydown", tabNavHandler);
				tabNavHandler = null;
			}
			// 清理失焦自动保存监听
			if (blurSaveHandler) {
				contentRef.value.removeEventListener("focusout", blurSaveHandler);
				blurSaveHandler = null;
			}
		}
		editSubMode.value = "select";
	}

	// ── 从浮层触发"进入文本模式" ────────────────────────────────────────────────
	function handleEnterTextMode(el: HTMLElement) {
		selectedEl.value = null;
		enterTextMode(el);
	}

	// ── AI 重写进行中：实时把 buffer 刷到 DOM ───────────────────────────────────
	// Element Patch 模式 buffer 全程为空字符串，加 buf.length > 0 避免错误清空内容区
	watch(
		() => (isAiEditing.value ? prdEditStore.aiStreamBuffer : null),
		(buf) => {
			if (buf !== null && buf.length > 0 && contentRef.value) {
				contentRef.value.innerHTML = buf;
			}
		},
	);

	// AI 完成后重新渲染图表
	watch(isEditing, (val) => {
		if (!val && contentRef.value) {
			contentRef.value.removeAttribute("contenteditable");
			editSubMode.value = "select";
			// 编辑结束（AI 完成、外部取消等）时清除所有高亮，防止 el-selected 残留在 DOM 上
			clearHighlight();
			selectedEl.value = null;
			selectedTable.value = null;
			destroyZoom(); // 编辑态可能替换过 mermaid div，统一先销毁旧实例
			if (props.isActive !== false) void runDiagrams();
		}
	});

	// ESC 键：文本模式 → 选择模式；第二级选中 → 退回整表（第一级）；第一级 → 退出编辑
	function onKeydown(e: KeyboardEvent) {
		if (!isEditing.value) return;
		if (e.key === "Escape") {
			if (editSubMode.value === "text") {
				e.preventDefault();
				leaveTextMode();
				selectedEl.value = null;
			} else if (
				selectedEl.value &&
				TABLE_TAGS.has(selectedEl.value.tagName) &&
				selectedEl.value.tagName !== "TABLE"
			) {
				// 第二级（tr/td/th 已选中）→ 退回第一级（选整表）
				e.preventDefault();
				const parentTable = selectedEl.value.closest(
					"table",
				) as HTMLElement | null;
				if (parentTable && contentRef.value!.contains(parentTable)) {
					selectedTable.value = parentTable;
					highlightEl(parentTable);
					selectedEl.value = parentTable;
				} else {
					clearHighlight();
					selectedEl.value = null;
				}
			} else {
				selectedTable.value = null;
				cancelEdit();
			}
		}
	}
	onMounted(() => {
		document.addEventListener("keydown", onKeydown);
		document.addEventListener("mouseup", onDocMouseup);
	});
	onBeforeUnmount(() => {
		document.removeEventListener("keydown", onKeydown);
		document.removeEventListener("mouseup", onDocMouseup);
		if (toastTimer) clearTimeout(toastTimer);
		destroyZoom();
	});

	// ── 保存文案 ─────────────────────────────────────────────────────────────────
	function getContentHtml() {
		if (!contentRef.value) return props.html;
		// 提取前清除所有选中态 class 和新行标记，防止被持久化到数据库
		contentRef.value
			.querySelectorAll(".el-selected")
			.forEach((el) => el.classList.remove("el-selected"));
		contentRef.value
			.querySelectorAll(".el-selected-cell")
			.forEach((el) => el.classList.remove("el-selected-cell"));
		contentRef.value
			.querySelectorAll(".prd-new-row")
			.forEach((el) => el.classList.remove("prd-new-row"));
		selectedCells.value = [];

		// Mermaid 渲染后 .mermaid div 内容为 SVG，需从 props.html 取回原始源码保存，
		// 防止将 SVG 写入数据库导致下次加载无法重渲染
		const clone = contentRef.value.cloneNode(true) as HTMLElement;
		const origTemp = document.createElement("div");
		origTemp.innerHTML = props.html;
		const origMermaidDivs = origTemp.querySelectorAll(".mermaid");
		clone.querySelectorAll(".mermaid").forEach((div, i) => {
			const origDiv = origMermaidDivs[i];
			if (!origDiv) return;
			const src = origDiv.textContent?.trim() ?? "";
			// 只有当原始是 Mermaid 源码（非 SVG）时才恢复，避免原本就是 SVG 的情况
			if (src && !src.startsWith("<")) {
				div.removeAttribute("data-processed");
				div.textContent = src;
			}
		});

		return clone.innerHTML;
	}
	function handleSaveContent() {
		void saveSection(props.sessionId, props.sectionId, getContentHtml);
	}

	// 关闭浮层
	function closeFloatPanel() {
		clearHighlight();
		selectedEl.value = null;
		selectedTable.value = null;
		selectedMermaidDiv.value = null;
		selectedAttrIndex.value = -1;
	}

	// ── Mermaid ER 源码操作 ───────────────────────────────────────────────────────

	/** 获取 mermaidDiv 在 DOM 中的索引，用于映射回 props.html 里的原始源码 */
	function getMermaidDivIndex(mermaidDiv: HTMLElement): number {
		return Array.from(
			contentRef.value!.querySelectorAll<HTMLElement>(".mermaid"),
		).indexOf(mermaidDiv);
	}

	/** 从 props.html（原始存储，含 Mermaid 源码文本）提取对应 div 的源码。
	 *  若取到 SVG（说明之前错误地保存了渲染结果）返回空串并提示用户。 */
	function getMermaidSourceByDiv(mermaidDiv: HTMLElement): string {
		const idx = getMermaidDivIndex(mermaidDiv);
		if (idx < 0) return "";
		const temp = document.createElement("div");
		temp.innerHTML = props.html;
		const src =
			temp.querySelectorAll(".mermaid")[idx]?.textContent?.trim() ?? "";
		if (!src || src.startsWith("<")) {
			showLocalToast("无法读取 Mermaid 源码，请重新生成此模块");
			return "";
		}
		return src;
	}

	/** 将修改后的 Mermaid 源码注入 props.html 副本，返回新的 HTML 字符串（用于保存） */
	function applyMermaidSourceToStoredHtml(
		idx: number,
		newSource: string,
	): string {
		const temp = document.createElement("div");
		temp.innerHTML = props.html;
		const divs = temp.querySelectorAll(".mermaid");
		if (divs[idx]) divs[idx].textContent = newSource;
		return temp.innerHTML;
	}

	/**
	 * 用全新 div 替换旧 mermaidDiv 并触发重渲染。
	 * 必须替换节点而非复用，否则 Mermaid 内部 ID 查询得到 null 导致 getBBox 崩溃。
	 * 成功时返回已渲染的新 div（data-processed="true"），失败时返回 null。
	 */
	async function applyMermaidSource(
		mermaidDiv: HTMLElement,
		newSource: string,
		fallbackSource?: string,
	): Promise<HTMLElement | null> {
		const parent = mermaidDiv.parentElement;
		if (!parent) return null;

		const makeDiv = (src: string): HTMLElement => {
			const d = document.createElement("div");
			d.className = "mermaid";
			d.textContent = src;
			return d;
		};

		// 用全新节点替换，避免 Mermaid 残留旧 SVG 的 ID 引用
		const freshDiv = makeDiv(newSource);
		parent.replaceChild(freshDiv, mermaidDiv);

		// nextTick 等 Vue diff，再等 3 帧让浏览器完成 layout，避免 getBBox() 拿到 null
		await nextTick();
		await waitFrames(3);
		const ok = await runMermaidNodes([freshDiv], true);
		if (ok) return freshDiv;

		// 渲染失败：用 fallback 源码再替换一次
		if (fallbackSource) {
			const fallbackDiv = makeDiv(fallbackSource);
			parent.replaceChild(fallbackDiv, freshDiv);
			await nextTick();
			await waitFrames(3);
			await runMermaidNodes([fallbackDiv]);
		}
		return null;
	}

	// ── Mermaid ER 源码编辑器 ────────────────────────────────────────────────────

	/** 当前处于编辑状态的 Mermaid 源码编辑器状态 */
	const mermaidEditorState = ref<{
		div: HTMLElement;
		textarea: HTMLTextAreaElement;
		/** 整张 ER 图的完整源码（用于回写和 fallback） */
		originalSource: string;
		idx: number;
		/** 当前编辑区域类型 */
		zone: MermaidErZone;
		/** zone === 'entity' 时对应的实体名 */
		entityName: string;
	} | null>(null);

	/** 键盘事件句柄（存引用以便销毁时移除） */
	let mermaidKeydownHandler: ((e: KeyboardEvent) => void) | null = null;

	/**
	 * 打开 Mermaid 源码编辑器。
	 * 根据 selectedMermaidZone 决定 textarea 初始内容：
	 *   entity   → 仅该实体块
	 *   relation → 仅关系行
	 *   diagram  → 完整源码
	 * 编辑完成后 Ctrl+Enter / 「保存」按钮触发 saveMermaidSource。
	 */
	/**
	 * 接受来自浮层的显式 zone 参数（用户主动选择编辑范围）。
	 * 当 zone 为 'entity' 但 selectedEntityName 为空时（点到连线/空白后再点编辑实体），
	 * 自动回退到 'diagram' 模式。
	 */
	function handleMermaidEditSource(zone?: MermaidErZone) {
		const mermaidDiv = selectedMermaidDiv.value;
		if (!mermaidDiv) return;
		const fullSource = getMermaidSourceByDiv(mermaidDiv);
		if (!fullSource) return;

		const resolvedZone: MermaidErZone =
			zone ?? (selectedMermaidZone.value as MermaidErZone) ?? "diagram";
		const entityName = selectedEntityName.value;
		const idx = getMermaidDivIndex(mermaidDiv);
		closeFloatPanel();

		// 根据区域类型提取编辑内容（entity 无实体名时退化为 diagram）
		const effectiveZone: MermaidErZone =
			resolvedZone === "entity" && !entityName ? "diagram" : resolvedZone;

		let editSource: string;
		if (effectiveZone === "entity") {
			editSource = extractEntityBlock(fullSource, entityName);
		} else if (effectiveZone === "relation") {
			editSource = extractRelationLines(fullSource);
		} else {
			editSource = fullSource;
		}

		// 创建等宽字体 textarea
		const textarea = document.createElement("textarea");
		textarea.value = editSource;
		textarea.className = "mermaid-source-editor";
		textarea.spellcheck = false;

		// 工具栏：左侧 zone 提示 + 右侧保存按钮
		const toolbar = document.createElement("div");
		toolbar.className = "mermaid-source-toolbar";

		const hint = document.createElement("span");
		hint.className = "mermaid-source-hint";
		hint.textContent = zoneHintText(effectiveZone, entityName);
		toolbar.appendChild(hint);

		const btnGroup = document.createElement("div");
		btnGroup.className = "mermaid-source-btn-group";

		const cancelBtn = document.createElement("button");
		cancelBtn.type = "button";
		cancelBtn.className = "mermaid-source-cancel-btn";
		cancelBtn.textContent = "取消";
		cancelBtn.title = "取消编辑（Esc）";
		cancelBtn.addEventListener("click", () => void cancelMermaidSource());
		btnGroup.appendChild(cancelBtn);

		const saveBtn = document.createElement("button");
		saveBtn.type = "button";
		saveBtn.className = "mermaid-source-save-btn";
		saveBtn.textContent = "保存";
		saveBtn.title = "保存（Ctrl+Enter）";
		saveBtn.addEventListener("click", () => void saveMermaidSource());
		btnGroup.appendChild(saveBtn);

		toolbar.appendChild(btnGroup);

		// 统一容器（带虚线边框）
		const wrapper = document.createElement("div");
		wrapper.className = "mermaid-source-wrapper";
		wrapper.appendChild(toolbar);
		wrapper.appendChild(textarea);

		// 替换 div 内容（保留 .mermaid 类供 getMermaidDivIndex 定位）
		mermaidDiv.removeAttribute("data-processed");
		mermaidDiv.innerHTML = "";
		mermaidDiv.appendChild(wrapper);
		mermaidDiv.classList.add("is-source-editing");

		mermaidEditorState.value = {
			div: mermaidDiv,
			textarea,
			originalSource: fullSource,
			idx,
			zone: effectiveZone,
			entityName,
		};

		// 自动撑高
		const autoResize = () => {
			textarea.style.height = "auto";
			textarea.style.height = `${textarea.scrollHeight}px`;
		};
		textarea.addEventListener("input", autoResize);

		nextTick(() => {
			autoResize();
			textarea.focus();
			textarea.select();
		});

		// Ctrl/Cmd+Enter 保存，Esc 取消
		mermaidKeydownHandler = (e: KeyboardEvent) => {
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				void saveMermaidSource();
			} else if (e.key === "Escape") {
				e.preventDefault();
				void cancelMermaidSource();
			}
		};
		textarea.addEventListener("keydown", mermaidKeydownHandler);
	}

	/** 保存 Mermaid 源码并重渲染图表（支持分段回写） */
	async function saveMermaidSource() {
		const state = mermaidEditorState.value;
		if (!state) return;
		const { div, textarea, originalSource, idx, zone, entityName } = state;
		cleanupMermaidEditor(div);

		const editedText = textarea.value.trim();
		if (!editedText) return;

		// 根据编辑区域类型将片段回写到完整源码
		let newFullSource: string;
		if (zone === "entity" && entityName) {
			newFullSource = replaceEntityBlock(
				originalSource,
				entityName,
				editedText,
			);
		} else if (zone === "relation") {
			newFullSource = replaceRelationLines(originalSource, editedText);
		} else {
			newFullSource = editedText;
		}

		const newHtml = applyMermaidSourceToStoredHtml(idx, newFullSource);
		const resultDiv = await applyMermaidSource(
			div,
			newFullSource,
			originalSource,
		);
		// 新 div 已替换旧 div，为其初始化缩放（编辑态下 handlers 内部会跳过实际响应）
		if (contentRef.value) initZoom(contentRef.value, zoomMaxHeight.value);
		if (resultDiv?.getAttribute("data-processed")) {
			void saveSection(props.sessionId, props.sectionId, () => newHtml);
		}
	}

	/** 取消编辑，恢复原始图表 */
	async function cancelMermaidSource() {
		const state = mermaidEditorState.value;
		if (!state) return;
		const { div, originalSource } = state;
		cleanupMermaidEditor(div);
		await applyMermaidSource(div, originalSource);
		// 恢复后为新 div 初始化缩放
		if (contentRef.value) initZoom(contentRef.value, zoomMaxHeight.value);
	}

	/** 清理编辑器事件句柄和 DOM 状态 */
	function cleanupMermaidEditor(div: HTMLElement) {
		if (mermaidKeydownHandler) {
			const ta = mermaidEditorState.value?.textarea;
			ta?.removeEventListener("keydown", mermaidKeydownHandler);
			mermaidKeydownHandler = null;
		}
		div.classList.remove("is-source-editing");
		mermaidEditorState.value = null;
	}

	// ── 新增行 / 删除行 ──────────────────────────────────────────────────────────

	/** 判断新增行所有单元格是否均为空（用于决定是删除还是保存） */
	function isRowEmpty(tr: HTMLTableRowElement): boolean {
		return Array.from(tr.cells).every((td) => td.textContent?.trim() === "");
	}

	/** Tab 键导航清理句柄 */
	let tabNavHandler: ((e: KeyboardEvent) => void) | null = null;
	/** 新行失焦自动保存句柄 */
	let blurSaveHandler: ((e: FocusEvent) => void) | null = null;

	/**
	 * 进入文字模式，并为新行绑定 Tab 键在单元格间跳转。
	 * 用于插入/追加新行后自动聚焦编辑。
	 */
	function enterTextModeWithTabNav(tr: HTMLTableRowElement) {
		editSubMode.value = "text";
		clearHighlight();
		selectedEl.value = null;

		nextTick(() => {
			if (!contentRef.value) return;
			contentRef.value.setAttribute("contenteditable", "true");

			// 空单元格需要一个文本节点才能放置光标
			Array.from(tr.cells).forEach((td) => {
				if (!td.childNodes.length) {
					td.appendChild(document.createTextNode(""));
				}
			});

			// 光标定位到新行首格
			const firstCell = tr.cells[0] as HTMLElement | undefined;
			if (firstCell && contentRef.value.contains(firstCell)) {
				const range = document.createRange();
				const textNode = firstCell.firstChild ?? firstCell;
				range.setStart(textNode, 0);
				range.collapse(true);
				const sel = window.getSelection();
				sel?.removeAllRanges();
				sel?.addRange(range);
			}
			contentRef.value.focus();

			// Tab / Shift+Tab 在行内单元格间跳转；Enter/ESC 保存或删空行；Shift+Enter 换行
			tabNavHandler = (e: KeyboardEvent) => {
				if ((e.key === "Enter" && !e.shiftKey) || e.key === "Escape") {
					e.preventDefault();
					e.stopPropagation(); // 阻止 ESC 冒泡到全局 cancelEdit
					if (isRowEmpty(tr)) {
						tr.remove(); // 空行直接删除，不保存
						leaveTextMode();
					} else {
						leaveTextMode();
						nextTick(() => handleSaveContent());
					}
					return;
				}
				if (e.key !== "Tab") return;
				e.preventDefault();
				const cells = Array.from(tr.cells) as HTMLElement[];
				const active = document.activeElement;
				const idx = cells.findIndex(
					(td) => td === active || td.contains(active as Node),
				);
				const next = e.shiftKey ? cells[idx - 1] : cells[idx + 1];
				if (next) {
					const range = document.createRange();
					range.selectNodeContents(next);
					range.collapse(true);
					const sel = window.getSelection();
					sel?.removeAllRanges();
					sel?.addRange(range);
				} else if (!e.shiftKey) {
					// 最后一格按 Tab → 空行删除，有内容则保存
					if (isRowEmpty(tr)) {
						tr.remove();
						leaveTextMode();
					} else {
						leaveTextMode();
						nextTick(() => handleSaveContent());
					}
				}
			};
			contentRef.value.addEventListener("keydown", tabNavHandler);

			// focusout → 焦点移出整个内容区时：空行删除，有内容则保存
			blurSaveHandler = (e: FocusEvent) => {
				const related = e.relatedTarget as Node | null;
				if (contentRef.value && !contentRef.value.contains(related)) {
					if (isRowEmpty(tr)) {
						tr.remove();
						leaveTextMode();
					} else {
						leaveTextMode();
						nextTick(() => handleSaveContent());
					}
				}
			};
			contentRef.value.addEventListener("focusout", blurSaveHandler);
		});
	}

	/**
	 * 在 refTr 下方插入一行空行，并进入文字编辑模式。
	 */
	function addRowAfter(refTr: HTMLTableRowElement) {
		const table = refTr.closest("table") as HTMLTableElement | null;
		if (!table) return;

		const tbodyRows = Array.from(
			table.querySelectorAll<HTMLTableRowElement>("tbody tr"),
		);
		const colCount =
			tbodyRows.length > 0
				? Math.max(...tbodyRows.map((r) => r.cells.length))
				: 1;

		const newTr = document.createElement("tr");
		newTr.classList.add("prd-new-row");
		for (let i = 0; i < colCount; i++) {
			newTr.appendChild(document.createElement("td"));
		}
		refTr.after(newTr);

		nextTick(() => enterTextModeWithTabNav(newTr));
	}

	/**
	 * 在 table tbody 末尾追加一行空行，并进入文字编辑模式。
	 */
	function appendRowToTable(table: HTMLTableElement) {
		const tbody = table.querySelector("tbody") ?? table;
		const tbodyRows = Array.from(tbody.querySelectorAll("tr"));
		if (tbodyRows.length === 0) return;

		const colCount = Math.max(...tbodyRows.map((r) => r.cells.length));
		const newTr = document.createElement("tr");
		newTr.classList.add("prd-new-row");
		for (let i = 0; i < colCount; i++) {
			newTr.appendChild(document.createElement("td"));
		}
		tbody.appendChild(newTr);

		nextTick(() => enterTextModeWithTabNav(newTr));
	}

	/**
	 * 在选中元素所在行下方插入新行（由 ElementFloatPanel 触发）。
	 */
	function handleInsertRow() {
		if (!selectedEl.value) return;
		const tr = selectedEl.value.closest("tr") as HTMLTableRowElement | null;
		if (!tr) return;
		closeFloatPanel();
		addRowAfter(tr);
	}

	/**
	 * 在选中元素所在表格末尾追加新行（由 ElementFloatPanel 触发）。
	 */
	function handleAppendRow() {
		if (!selectedEl.value) return;
		const table = selectedEl.value.closest("table") as HTMLTableElement | null;
		if (!table) return;
		closeFloatPanel();
		appendRowToTable(table);
	}

	/** 确认删除弹窗状态 */
	const showDeleteConfirm = ref(false);
	const rowToDelete = ref<HTMLElement | null>(null);

	/**
	 * 删除选中的 tr（来自 ElementFloatPanel 的 delete-row 事件）。
	 * 弹出自定义确认对话框，确认后删除并自动保存。
	 */
	function handleDeleteRow(tr: HTMLElement) {
		const tbody = tr.closest("tbody");
		const dataRows = tbody
			? tbody.querySelectorAll("tr")
			: tr.closest("table")?.querySelectorAll("tbody tr");
		if (dataRows && dataRows.length <= 1) {
			showLocalToast("至少保留一行数据");
			return;
		}
		rowToDelete.value = tr;
		showDeleteConfirm.value = true;
	}

	async function confirmDeleteRow() {
		if (rowToDelete.value) {
			rowToDelete.value.remove();
			rowToDelete.value = null;
			showDeleteConfirm.value = false;
			closeFloatPanel();
			nextTick(() => handleSaveContent());
		} else {
			showDeleteConfirm.value = false;
		}
	}

	function cancelDeleteRow() {
		rowToDelete.value = null;
		showDeleteConfirm.value = false;
	}
</script>

<template>
	<div
		class="section-item"
		:class="{
			'is-editing': isEditing,
			'is-ai-editing': isAiEditing,
			'is-select-mode': isEditing && editSubMode === 'select',
			'is-text-mode': isEditing && editSubMode === 'text',
		}"
		@mouseenter="hovered = true"
		@mouseleave="hovered = false"
	>
		<!-- 编辑按钮（hover 时浮现，编辑中隐藏） -->
		<button
			v-if="editable && hovered && !isEditing"
			class="edit-trigger"
			@click.stop="startEdit"
			title="编辑此模块"
		>
			✏ 编辑
		</button>

		<!-- 编辑模式徽章（显示当前子模式） -->
		<div v-if="isEditing" class="mode-badge">
			<span v-if="editSubMode === 'select'" class="mode-tag mode-tag--select">
				← 单击选元素 · Ctrl/⌘+单击多选格 · 双击编文字
			</span>
			<span v-else class="mode-tag mode-tag--text">
				✎ 文字编辑模式 · ESC 返回
			</span>
			<!-- 跨行多选警告 toast -->
			<span v-if="toastMsg" class="mode-tag mode-tag--warn">
				⚠ {{ toastMsg }}
			</span>
			<button class="mode-close" @click.stop="cancelEdit">×</button>
		</div>

		<!-- AI 重写中的遮罩 -->
		<div v-if="isAiEditing" class="ai-overlay">
			<span class="ai-overlay-dot" />
			AI 正在重写…
		</div>

		<!-- 内容区 -->
		<!-- eslint-disable-next-line vue/no-v-html -->
		<div
			ref="contentRef"
			class="prd-section-body"
			:class="{ 'select-cursor': isEditing && editSubMode === 'select' }"
			v-html="html"
			@click="onContentClick"
			@dblclick="onContentDblClick"
			@mousedown="onContentMousedown"
			@mousemove="onContentMousemove"
		/>

		<!-- 元素级 AI 浮层 -->
		<ElementFloatPanel
			:session-id="sessionId"
			:section-id="sectionId"
			:selected-el="selectedEl"
			:entity-name="selectedEntityName"
			:mermaid-zone="selectedMermaidZone || undefined"
			:selected-cells="selectedCells.length >= 2 ? selectedCells : undefined"
			@close="closeFloatPanel"
			@enter-text-mode="handleEnterTextMode"
			@delete-row="handleDeleteRow"
			@insert-row="handleInsertRow"
			@append-row="handleAppendRow"
			@mermaid-edit-source-zone="handleMermaidEditSource"
		/>

		<!-- ── 删除行/属性确认弹窗 ── -->
		<ConfirmDialog
			:visible="showDeleteConfirm"
			title="确认删除该行？"
			confirm-text="确认删除"
			cancel-text="取消"
			@confirm="confirmDeleteRow"
			@cancel="cancelDeleteRow"
		>
			删除后将立即保存，此操作不可撤销。
		</ConfirmDialog>
	</div>
</template>

<style lang="scss" scoped>
	.section-item {
		position: relative;
		border: 1.5px solid transparent;
		border-radius: 8px;
		transition: border-color 0.15s;

		&:hover:not(.is-editing) {
			border-color: #e2e8f0;
		}

		&.is-editing {
			border-color: #4f46e5;
			box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.08);
		}
	}

	.edit-trigger {
		position: absolute;
		top: 10px;
		right: 10px;
		padding: 3px 10px;
		background: #4f46e5;
		color: #fff;
		border: none;
		border-radius: 5px;
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
		z-index: 2;
		opacity: 0.9;
		transition: opacity 0.15s;

		&:hover {
			opacity: 1;
		}
	}

	/* ── 模式徽章 ── */
	.mode-badge {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 12px;
		background: #eef2ff;
		border-bottom: 1px solid #e0e7ff;
		border-radius: 8px 8px 0 0;
	}

	.mode-tag {
		flex: 1;
		font-size: 11px;
		font-weight: 500;

		&--select {
			color: #4f46e5;
		}
		&--text {
			color: #0369a1;
		}
	}

	.mode-close {
		width: 18px;
		height: 18px;
		border: none;
		background: transparent;
		border-radius: 3px;
		cursor: pointer;
		color: #94a3b8;
		font-size: 14px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;

		&:hover {
			background: #e0e7ff;
			color: #4f46e5;
		}
	}

	/* ── AI 遮罩 ── */
	.ai-overlay {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 14px;
		background: rgba(238, 242, 255, 0.92);
		border-radius: 8px 8px 0 0;
		font-size: 12px;
		color: #4f46e5;
		font-weight: 500;
		z-index: 3;
	}

	.ai-overlay-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #4f46e5;
		animation: pulse 1s ease-in-out infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.5;
			transform: scale(0.8);
		}
	}

	/* ── 内容区 ── */
	.prd-section-body {
		padding: 24px 28px;
		outline: none;
		min-height: 60px;

		&[contenteditable="true"] {
			background: #fffdf5;
			cursor: text;
		}
		/* 选中模式下，鼠标悬停时出现虚线框 */
		&.select-cursor {
			cursor: default;

			/* 鼠标悬停时提示可点击 */
			:deep(h2),
			:deep(h3),
			:deep(h4),
			:deep(h5),
			:deep(p),
			:deep(li),
			:deep(table),
			:deep(.scenario-card),
			:deep(.prd-subsection),
			:deep(.mermaid:not(.is-source-editing)),
			:deep(.markmap-wrap) {
				&:hover {
					outline: 1.5px dashed #a5b4fc;
					outline-offset: 2px;
					border-radius: 3px;
					cursor: pointer;
				}
			}
		}
	}

	.mode-tag--warn {
		color: #b45309;
		font-weight: 600;
		animation: fadeIn 0.2s ease;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	/* 以下高亮规则全部限定在 .prd-section-body 内，防止非编辑状态下残留 el-selected 误触发 */
	.prd-section-body {
		/* 被选中元素的高亮框（通过 JS 添加 .el-selected） */
		:deep(.el-selected) {
			outline: 2px solid #4f46e5 !important;
			outline-offset: 2px;
			border-radius: 3px;
		}

		/* 多选单元格高亮：浅蓝填充 + 实线内框 */
		:deep(td.el-selected-cell),
		:deep(th.el-selected-cell) {
			background-color: rgba(79, 70, 229, 0.1) !important;
			box-shadow: inset 0 0 0 2px #4f46e5 !important;
		}

		/* tr 选中：outline 在 tr 上浏览器不渲染，改为给行内所有 td/th 加背景 + 顶底边线 */
		:deep(tr.el-selected) {
			td,
			th {
				background-color: rgba(79, 70, 229, 0.06) !important;
				box-shadow:
					inset 0 2px 0 #4f46e5,
					inset 0 -2px 0 #4f46e5;
			}
		}

		/* 以下 hover 效果只在 select 模式下生效 */
		&.select-cursor {
			/* 整表被选中时，内部 tr/td/th 悬停给出细粒度提示 */
			:deep(table.el-selected) {
				tr:hover td,
				tr:hover th {
					background-color: rgba(165, 180, 252, 0.15);
					cursor: pointer;
				}

				/* td/th 直接 hover 优先级更高 */
				td:hover,
				th:hover {
					outline: 1.5px dashed #818cf8;
					outline-offset: -1px;
					background-color: rgba(129, 140, 248, 0.12) !important;
					cursor: pointer;
				}
			}

			/* tr 被选中时，内部 td/th 悬停提示 */
			:deep(tr.el-selected) {
				td:hover,
				th:hover {
					outline: 1.5px dashed #818cf8;
					outline-offset: -1px;
					cursor: pointer;
				}
			}
		}
	}

	/* ── 新插入 / 追加的空行：让输入框更明显，光标垂直居中 ── */
	:deep(tr.prd-new-row) {
		td {
			height: 44px;
			min-height: 44px;
			vertical-align: middle;
			line-height: 44px;
			padding: 0 10px;
			background-color: #f8faff;
			border: 1.5px dashed #a5b4fc !important;
			border-radius: 2px;
			transition: background 0.15s;

			&:focus,
			&:focus-within {
				background-color: #eef2ff;
				border-color: #6366f1 !important;
				outline: none;
			}
		}
	}

	/* ── Mermaid ER 源码编辑器 ── */
	:deep(.mermaid.is-source-editing) {
		/* 去掉自身边框，边框统一由 wrapper 提供 */
		border: none;
		background: transparent;
		padding: 0;
	}

	:deep(.mermaid-source-wrapper) {
		border: 1.5px dashed #a5b4fc;
		border-radius: 6px;
		background: #f8faff;
		overflow: hidden;
	}

	:deep(.mermaid-source-toolbar) {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 6px 8px 4px;
		background: #eef2ff;
		border-bottom: 1px solid #c7d2fe;
	}

	:deep(.mermaid-source-hint) {
		font-size: 11px;
		color: #6366f1;
		font-weight: 500;
		letter-spacing: 0.02em;
		opacity: 0.8;
	}

	:deep(.mermaid-source-btn-group) {
		display: flex;
		gap: 6px;
		align-items: center;
	}

	:deep(.mermaid-source-cancel-btn) {
		padding: 3px 12px;
		font-size: 12px;
		font-weight: 500;
		color: #64748b;
		background: transparent;
		border: 1px solid #cbd5e1;
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.15s;

		&:hover {
			background: #f1f5f9;
			color: #1e293b;
			border-color: #94a3b8;
		}
	}

	:deep(.mermaid-source-save-btn) {
		padding: 3px 14px;
		font-size: 12px;
		font-weight: 600;
		color: #fff;
		background: #4f46e5;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		transition: background 0.15s;

		&:hover {
			background: #4338ca;
		}

		&:active {
			background: #3730a3;
		}
	}

	:deep(.mermaid-source-editor) {
		display: block;
		width: 100%;
		box-sizing: border-box;
		min-height: 120px;
		padding: 12px 14px;
		font-family: "JetBrains Mono", "Fira Code", "Consolas", monospace;
		font-size: 13px;
		line-height: 1.6;
		color: #1e293b;
		background: #f8faff;
		border: none;
		border-radius: 0;
		resize: none;
		outline: none;
		overflow: hidden;

		&:focus {
			background: #f0f4ff;
		}
	}
</style>
