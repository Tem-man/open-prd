<script setup lang="ts">
	/**
	 * ElementFloatPanel — 元素级 AI 编辑浮层
	 *
	 * 通过 Teleport 挂到 body，根据目标元素的 getBoundingClientRect()
	 * 定位到元素正下方。使用方案 A：单击选元素 → 浮层，双击进文本模式。
	 */
	import {
		ref,
		computed,
		watch,
		onMounted,
		onBeforeUnmount,
		nextTick,
	} from "vue";
	import { usePrdEditStore } from "@/stores/prdEdit";
	import { useMessagesStore } from "@/stores/messages";
	import {
		useSSE,
		type ComposerTarget,
		type TableElementPath,
	} from "@/composables/useSSE";

	const props = defineProps<{
		sessionId: string;
		sectionId: string;
		selectedEl: HTMLElement | null;
		/** Mermaid ER 图实体名（如 "ROLE"），仅在 mermaidZone === 'entity' 时非空 */
		entityName?: string;
		/**
		 * 当前点击的 Mermaid ER 区域类型：
		 *   'entity'  → 显示「编辑实体」按钮
		 *   'relation' → 显示「编辑连线」按钮
		 *   'diagram'  → 显示「编辑所有实体」按钮
		 *   ''（未选）→ 不显示 Mermaid 相关按钮
		 */
		mermaidZone?: "entity" | "relation" | "diagram" | "";
		/** 多选单元格列表（≥2 时启用 cells 路径，只 patch 选中格） */
		selectedCells?: HTMLElement[];
	}>();

	const emit = defineEmits<{
		close: [];
		"enter-text-mode": [el: HTMLElement];
		"delete-row": [tr: HTMLElement];
		/** 在选中行下方插入新行 */
		"insert-row": [];
		/** 在选中表格末尾追加新行 */
		"append-row": [];
		/** Mermaid ER：按指定 zone 打开源码编辑器 */
		"mermaid-edit-source-zone": [zone: "entity" | "relation" | "diagram"];
	}>();

	const prdEditStore = usePrdEditStore();
	const messagesStore = useMessagesStore();
	const { sendMessage } = useSSE();

	const instruction = ref("");
	const panelRef = ref<HTMLDivElement | null>(null);
	const inputRef = ref<HTMLInputElement | null>(null);

	// ── 浮层定位 ─────────────────────────────────────────────────────────────────
	const panelStyle = ref<{ top: string; left: string; width: string }>({
		top: "0px",
		left: "0px",
		width: "300px",
	});

	/** 更新浮层位置 - 根据选中的元素的 getBoundingClientRect() 计算浮层的位置 - 防止浮层超出屏幕 **/
	function updatePosition() {
		if (!props.selectedEl) return;
		const rect = props.selectedEl.getBoundingClientRect();
		const panelWidth = Math.max(320, Math.min(rect.width, 560));
		let left = rect.left;
		// 防止右侧超出屏幕
		if (left + panelWidth > window.innerWidth - 12) {
			left = window.innerWidth - panelWidth - 12;
		}
		left = Math.max(8, left);

		panelStyle.value = {
			top: `${rect.bottom + 6}px`,
			left: `${left}px`,
			width: `${panelWidth}px`,
		};
	}

	// 选中目标变化时：等 Teleport 浮层挂载后再算位置并聚焦输入框；immediate 覆盖初次带选中元素打开的场景
	watch(
		() => props.selectedEl,
		(el) => {
			if (el) {
				nextTick(() => {
					// 更新浮层位置并聚焦输入框
					updatePosition();
					inputRef.value?.focus();
				});
			}
		},
		{ immediate: true },
	);

	/** 窗口滚动和resize事件 - 更新浮层位置 **/
	function onScrollOrResize() {
		updatePosition();
	}

	/** 挂载 - 监听窗口滚动和resize事件 - 更新浮层位置 **/
	onMounted(() => {
		window.addEventListener("scroll", onScrollOrResize, true);
		window.addEventListener("resize", onScrollOrResize);
	});

	/** 卸载 - 移除窗口滚动和resize事件 - 更新浮层位置 **/
	onBeforeUnmount(() => {
		window.removeEventListener("scroll", onScrollOrResize, true);
		window.removeEventListener("resize", onScrollOrResize);
	});

	// ── 元素标签 label ────────────────────────────────────────────────────────────
	const TAG_LABELS: Record<string, string> = {
		H2: "标题",
		H3: "副标题",
		H4: "小标题",
		H5: "小标题",
		P: "段落",
		LI: "列表项",
		TR: "表格行",
		TD: "单元格",
		TH: "表头",
		BLOCKQUOTE: "引用",
		PRE: "代码块",
	};

	/** 元素类型标签 - 场景卡片、内容块、图表、思维导图、分组标题 **/
	const CLASS_LABELS: Array<[string, string]> = [
		["scenario-card", "场景卡片"],
		["prd-subsection", "内容块"],
		["mermaid", "图表"],
		["markmap-wrap", "思维导图"],
		["module-header", "分组标题"],
	];

	/** 是否处于多格选中状态（≥2 个 td/th 被选中） */
	const isMultiCell = computed(
		() => !!props.selectedCells && props.selectedCells.length >= 2,
	);

	/** 根据选中元素类型生成感知粒度的 placeholder 文案 */
	const inputPlaceholder = computed(() => {
		if (props.entityName) return `告诉 AI 如何修改 ${props.entityName} 实体…`;
		if (isMultiCell.value)
			return `告诉 AI 如何修改这 ${props.selectedCells!.length} 个单元格…`;
		const tag = props.selectedEl?.tagName;
		if (tag === "TABLE")
			return "告诉 AI 如何修改整张表格…（再次单击行/单元格可缩小范围）";
		if (tag === "TR") return "告诉 AI 如何修改选中行…";
		if (tag === "TD" || tag === "TH") return "告诉 AI 如何修改选中单元格…";
		return "告诉 AI 如何修改选中元素…";
	});

	/** 计算表格内部元素的 DOM 坐标，用于后端精确定位。
	 *  tableIndex：元素所在表格在 .prd-section-body 内所有 table 中的序号（0-based），
	 *  支持功能清单拆分多张表的场景。
	 *  当 cells 数组有 ≥2 项时，返回 kind:"cells" 以精确 patch 选中格。
	 */
	function getTablePath(
		el: HTMLElement,
		cells?: HTMLElement[],
	): TableElementPath | null {
		const table = el.closest("table") as HTMLTableElement | null;
		if (!table) return null;
		const row = el.closest("tr") as HTMLTableRowElement | null;
		if (!row) return null;
		const rowIndex = Array.from(table.rows).indexOf(row);

		// 定位这是 section body 里的第几张表
		const sectionBody = el.closest(".prd-section-body");
		const tableIndex = sectionBody
			? Array.from(sectionBody.querySelectorAll("table")).indexOf(table)
			: 0;

		// 多选 cells：返回精确的格坐标数组
		if (cells && cells.length >= 2) {
			const cellIndices = cells
				.map((cell) =>
					Array.from(row.cells).indexOf(cell as HTMLTableCellElement),
				)
				.filter((i) => i >= 0);
			return { kind: "cells", tableIndex, rowIndex, cellIndices };
		}

		if (el.tagName === "TR") {
			return { kind: "row", tableIndex, rowIndex };
		}
		const cellIndex = Array.from(row.cells).indexOf(el as HTMLTableCellElement);
		return { kind: "cell", tableIndex, rowIndex, cellIndex };
	}

	/** 元素类型标签 - 场景卡片、内容块、图表、思维导图、分组标题 **/
	const elementLabel = computed(() => {
		if (!props.selectedEl) return "";
		if (props.entityName) return `${props.entityName}实体`;
		// 多选单元格：显示行信息
		if (isMultiCell.value) {
			const row = props.selectedEl as HTMLElement;
			const table = row.closest("table") as HTMLTableElement | null;
			const rowIndex = table
				? Array.from(table.rows).indexOf(row as HTMLTableRowElement) + 1
				: "?";
			return `已选中 ${props.selectedCells!.length} 个单元格（第 ${rowIndex} 行）`;
		}
		const tag = props.selectedEl.tagName;
		for (const [cls, label] of CLASS_LABELS) {
			if (props.selectedEl.classList.contains(cls)) return label;
		}
		return TAG_LABELS[tag] ?? tag.toLowerCase();
	});

	// ── AI 指令提交 ───────────────────────────────────────────────────────────────
	const isAiEditing = computed(
		() => prdEditStore.aiEditingSection === props.sectionId,
	);
	const busy = computed(
		() => isAiEditing.value || messagesStore.messages.some((m) => m.isStreaming),
	);

	function cleanOuterHtml(el: HTMLElement): string {
		const clone = el.cloneNode(true) as HTMLElement;
		clone.classList.remove("el-selected", "el-selected-cell");
		clone.querySelectorAll(".el-selected, .el-selected-cell").forEach((child) => {
			child.classList.remove("el-selected", "el-selected-cell");
		});
		return clone.outerHTML;
	}

	/** 点选产生的精确定位参数随 target 发送，由对话 Agent 的 edit_section 消费 */
	function buildTarget(el: HTMLElement): ComposerTarget {
		const target: ComposerTarget = {
			sectionId: props.sectionId,
			sectionTitle: prdEditStore.sections.find((s) => s.sectionId === props.sectionId)?.title,
			elementLabel: elementLabel.value || undefined,
		};
		if (props.entityName) return { ...target, entityName: props.entityName };
		// Mermaid 区域未识别出实体：整模块改写，绝不发 SVG
		if (el.classList.contains("mermaid")) return { ...target, elementLabel: "图表" };
		if (isMultiCell.value && props.selectedCells) {
			return {
				...target,
				selectedElementHtml: props.selectedCells.map(cleanOuterHtml).join("\n"),
				tablePath: getTablePath(el, props.selectedCells) ?? undefined,
				elementLabel: `${props.selectedCells.length}个单元格`,
			};
		}
		return {
			...target,
			selectedElementHtml: cleanOuterHtml(el),
			tablePath: getTablePath(el) ?? undefined,
		};
	}

	async function handleSubmit() {
		const text = instruction.value.trim();
		if (!text || busy.value || !props.selectedEl) return;
		instruction.value = "";
		const target = buildTarget(props.selectedEl);
		emit("close");
		await sendMessage(props.sessionId, text, { target });
	}

	// ── 进入文本编辑模式 ──────────────────────────────────────────────────────────
	function handleEnterTextMode() {
		if (props.selectedEl) emit("enter-text-mode", props.selectedEl);
	}

	// ── 点击浮层外部关闭 ──────────────────────────────────────────────────────────
	function onDocClick(e: MouseEvent) {
		if (!panelRef.value) return;
		if (!panelRef.value.contains(e.target as Node)) {
			emit("close");
		}
	}
	onMounted(() => {
		// 延迟绑定，避免和触发浮层的那次 click 冲突
		setTimeout(() => document.addEventListener("click", onDocClick), 50);
	});
	onBeforeUnmount(() => {
		document.removeEventListener("click", onDocClick);
	});
</script>

<template>
	<Teleport to="body">
		<div
			v-if="selectedEl"
			ref="panelRef"
			class="element-float-panel"
			:style="panelStyle"
			@click.stop
		>
			<!-- 顶栏：元素类型徽章 + 双击提示 + 删除行 + 关闭 -->
			<div class="panel-header">
				<span class="element-badge">
					<span class="element-tag">{{ elementLabel }}</span>
				</span>
				<!-- 文字模式（仅非 Mermaid 元素） -->
				<button
					v-if="!isMultiCell && !mermaidZone"
					class="text-mode-btn"
					title="双击可直接编辑文本"
					@click="handleEnterTextMode()"
				>
					✎ 文字模式
				</button>
				<!-- Mermaid ER：三个固定按钮，点击任意 Mermaid 区域均显示 -->
				<template v-if="mermaidZone">
					<button
						class="text-mode-btn"
						:class="{ 'btn--active': mermaidZone === 'entity' }"
						title="编辑当前实体字段（Ctrl+Enter 保存，Esc 取消）"
						@click="emit('mermaid-edit-source-zone', 'entity')"
					>
						✎ 编辑实体
					</button>
					<button
						class="text-mode-btn"
						:class="{ 'btn--active': mermaidZone === 'relation' }"
						title="编辑所有关系连线（Ctrl+Enter 保存，Esc 取消）"
						@click="emit('mermaid-edit-source-zone', 'relation')"
					>
						✎ 编辑连线
					</button>
					<button
						class="text-mode-btn"
						:class="{ 'btn--active': mermaidZone === 'diagram' }"
						title="编辑所有实体源码（Ctrl+Enter 保存，Esc 取消）"
						@click="emit('mermaid-edit-source-zone', 'diagram')"
					>
						✎ 编辑所有实体
					</button>
				</template>
				<!-- HTML 表格：插入行、删除行 -->
				<button
					v-if="
						!mermaidZone &&
						!isMultiCell &&
						['TR', 'TD', 'TH'].includes(selectedEl?.tagName ?? '')
					"
					class="insert-row-btn"
					title="在此行下方插入新行"
					@click="emit('insert-row')"
				>
					＋ 插入行
				</button>
				<button
					v-if="
						!mermaidZone &&
						!isMultiCell &&
						['TR', 'TD', 'TH'].includes(selectedEl?.tagName ?? '')
					"
					class="delete-row-btn"
					title="删除此行"
					@click="
						emit(
							'delete-row',
							(selectedEl!.closest('tr') ?? selectedEl!) as HTMLElement,
						)
					"
				>
					🗑 删除行
				</button>
				<!-- HTML 表格：追加行 -->
				<button
					v-if="!mermaidZone && selectedEl?.tagName === 'TABLE'"
					class="insert-row-btn"
					title="在表格末尾追加新行"
					@click="emit('append-row')"
				>
					＋ 追加行
				</button>
				<button class="close-btn" @click="emit('close')">×</button>
			</div>

			<!-- AI 输入区 -->
			<div class="panel-input-row">
				<input
					ref="inputRef"
					v-model="instruction"
					class="panel-input"
					:placeholder="inputPlaceholder"
					:disabled="busy"
					@keydown.enter.exact.prevent="handleSubmit"
					@keydown.escape.prevent="emit('close')"
				/>
				<button
					class="send-btn"
					:disabled="!instruction.trim() || busy"
					@click="handleSubmit"
				>
					<span v-if="busy" class="spinner" />
					<svg v-else viewBox="0 0 16 16" fill="none" width="14" height="14">
						<path
							d="M14 8H2M8 2l6 6-6 6"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</button>
			</div>
		</div>
	</Teleport>
</template>

<style lang="scss" scoped>
	.element-float-panel {
		position: fixed;
		z-index: 9999;
		background: #fff;
		border: 1.5px solid #4f46e5;
		border-radius: 8px;
		box-shadow:
			0 4px 16px rgba(79, 70, 229, 0.15),
			0 2px 6px rgba(0, 0, 0, 0.08);
		overflow: hidden;
		animation: panel-in 0.12s ease-out;
	}

	@keyframes panel-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.panel-header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 8px;
		background: #eef2ff;
		border-bottom: 1px solid #e0e7ff;
	}

	.element-badge {
		display: flex;
		align-items: center;
		gap: 4px;
		flex: 1;
	}

	.element-tag {
		font-size: 11px;
		font-weight: 600;
		color: #4f46e5;
		background: #c7d2fe;
		padding: 1px 7px;
		border-radius: 10px;
		letter-spacing: 0.02em;
	}

	.text-mode-btn {
		font-size: 11px;
		color: #64748b;
		background: transparent;
		border: 1px solid #cbd5e1;
		border-radius: 4px;
		padding: 2px 7px;
		cursor: pointer;
		white-space: nowrap;
		transition: all 0.12s;

		&:hover {
			background: #f1f5f9;
			color: #1e293b;
			border-color: #94a3b8;
		}

		/* 当前激活的 zone 按钮高亮 */
		&.btn--active {
			background: #eef2ff;
			color: #4f46e5;
			border-color: #a5b4fc;
			font-weight: 600;
		}
	}

	.insert-row-btn {
		font-size: 11px;
		color: #4f46e5;
		background: transparent;
		border: 1px solid #a5b4fc;
		border-radius: 4px;
		padding: 2px 7px;
		cursor: pointer;
		white-space: nowrap;
		transition: all 0.12s;

		&:hover {
			background: #eef2ff;
			border-color: #6366f1;
		}
	}

	.delete-row-btn {
		font-size: 11px;
		color: #ef4444;
		background: transparent;
		border: 1px solid #fca5a5;
		border-radius: 4px;
		padding: 2px 7px;
		cursor: pointer;
		white-space: nowrap;
		transition: all 0.12s;

		&:hover {
			background: #fef2f2;
			border-color: #ef4444;
		}
	}

	.close-btn {
		width: 20px;
		height: 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: transparent;
		border-radius: 4px;
		cursor: pointer;
		color: #94a3b8;
		font-size: 14px;
		line-height: 1;
		padding: 0;
		flex-shrink: 0;
		transition: all 0.12s;

		&:hover {
			background: #e0e7ff;
			color: #4f46e5;
		}
	}

	.panel-input-row {
		display: flex;
		align-items: center;
		gap: 0;
	}

	.panel-input {
		flex: 1;
		height: 36px;
		border: none;
		outline: none;
		padding: 0 12px;
		font-size: 13px;
		font-family: inherit;
		background: transparent;

		&::placeholder {
			color: #94a3b8;
		}

		&:disabled {
			opacity: 0.6;
			cursor: not-allowed;
		}
	}

	.send-btn {
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-left: 1px solid #e2e8f0;
		background: transparent;
		cursor: pointer;
		color: #4f46e5;
		flex-shrink: 0;
		transition: background 0.12s;

		&:disabled {
			opacity: 0.35;
			cursor: not-allowed;
		}

		&:not(:disabled):hover {
			background: #eef2ff;
		}
	}

	.spinner {
		width: 12px;
		height: 12px;
		border: 2px solid #c7d2fe;
		border-top-color: #4f46e5;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
