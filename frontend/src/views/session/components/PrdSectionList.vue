<script setup lang="ts">
	/**
	 * PrdSectionList — PRD 模块列表
	 * 显示 PRD 模块列表
	 * 支持 tab 切换
	 */
	import {
		ref,
		computed,
		watch,
		onMounted,
		onUnmounted,
		shallowRef,
		triggerRef,
		markRaw,
	} from "vue";
	import { preloadDiagramLibraries } from "@prd-runtime/prd-runtime.js";
	import { usePrdEditStore } from "@/stores/prdEdit";
	import PrdSectionItem from "./PrdSectionItem.vue";

	/** PrdSectionItem 暴露给 Tab 栏的操作与状态（refs 在父组件模板中自动解包） */
	interface SectionChrome {
		startEdit: () => void;
		cancelEdit: () => void;
		saveContent: () => void;
		saving: boolean;
		editSubMode: "select" | "text";
		toastMsg: string;
	}

	const props = defineProps<{
		sessionId: string;
	}>();

	const prdEditStore = usePrdEditStore();
	const activeTab = ref(0);

	const sections = computed(() => prdEditStore.sections);
	const hasEditable = computed(() => sections.value.length > 0);

	onMounted(async () => {
		void preloadDiagramLibraries();
		if (sections.value.length === 0) {
			await fetchSections();
		}
	});

	async function fetchSections() {
		try {
			const res = await fetch(`/api/sessions/${props.sessionId}/prd/sections`);
			if (!res.ok) return;
			const data = (await res.json()) as {
				prdId: string;
				sections: Array<{
					id: string;
					sectionId: string;
					title: string;
					html: string;
					version: number;
				}>;
			};
			prdEditStore.setSections(data.sections);
		} catch {
			// 静默失败：sections 为空时仍展示 iframe 或空状态
		}
	}

	function switchTab(idx: number) {
		activeTab.value = idx;
	}

	const itemRefs = shallowRef<Record<string, SectionChrome>>({});
	/** 每个模块一个稳定的 ref 回调，避免内联函数每次渲染都把实例卸掉再挂上 */
	const itemBinders = new Map<string, (el: unknown) => void>();

	function bindItem(sectionId: string, el: unknown) {
		const map = itemRefs.value;
		if (el) {
			const chrome = markRaw(el as SectionChrome);
			if (map[sectionId] === chrome) return;
			map[sectionId] = chrome;
		} else if (sectionId in map) {
			delete map[sectionId];
		} else {
			return;
		}
		triggerRef(itemRefs);
	}

	function itemBinder(sectionId: string) {
		let binder = itemBinders.get(sectionId);
		if (!binder) {
			binder = (el: unknown) => bindItem(sectionId, el);
			itemBinders.set(sectionId, binder);
		}
		return binder;
	}

	const activeSectionId = computed(
		() => sections.value[activeTab.value]?.sectionId ?? null,
	);
	const activeItem = computed(() =>
		activeSectionId.value ? (itemRefs.value[activeSectionId.value] ?? null) : null,
	);

	/** 把当前 Tab 的操作同步到顶栏，避免按钮和模块 Tab 抢同一行 */
	watch(
		() => {
			const item = activeItem.value;
			const sectionId = activeSectionId.value;
			if (!item || !sectionId) return null;
			return {
				sectionId,
				editSubMode: item.editSubMode,
				toastMsg: item.toastMsg,
				saving: item.saving,
			};
		},
		(state) => {
			if (!state) {
				prdEditStore.setSectionToolbar(null);
				return;
			}
			const item = itemRefs.value[state.sectionId];
			if (!item) {
				prdEditStore.setSectionToolbar(null);
				return;
			}
			prdEditStore.setSectionToolbar({
				...state,
				startEdit: () => item.startEdit(),
				cancelEdit: () => item.cancelEdit(),
				save: () => item.saveContent(),
			});
		},
		{ immediate: true },
	);

	onUnmounted(() => {
		prdEditStore.setSectionToolbar(null);
	});
</script>

<template>
	<div v-if="hasEditable" class="section-list">
		<nav class="tab-nav" role="tablist">
			<button
				v-for="(sec, i) in sections"
				:key="sec.sectionId"
				class="tab-btn"
				:class="{ active: activeTab === i }"
				role="tab"
				:aria-selected="activeTab === i"
				@click="switchTab(i)"
			>
				{{ sec.title }}
			</button>
		</nav>

		<!-- 各模块内容面板 -->
		<div class="panels-wrap">
			<div
				v-for="(sec, i) in sections"
				:key="sec.sectionId"
				class="tab-panel"
				:class="{ active: activeTab === i }"
			>
				<PrdSectionItem
					:ref="itemBinder(sec.sectionId)"
					:session-id="sessionId"
					:section-id="sec.sectionId"
					:title="sec.title"
					:html="sec.html"
					:version="sec.version"
					:editable="true"
					:is-active="activeTab === i"
				/>
			</div>
		</div>
	</div>
</template>

<style lang="scss" scoped>
	.section-list {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
	}

	.tab-nav {
		background: #fff;
		border-bottom: 1px solid #e2e8f0;
		padding: 0 16px;
		display: flex;
		flex-shrink: 0;
		overflow-x: auto;
		scrollbar-width: none;

		&::-webkit-scrollbar {
			display: none;
		}
	}

	.tab-btn {
		padding: 10px 14px;
		font-size: 13px;
		border: none;
		background: transparent;
		cursor: pointer;
		color: #64748b;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		white-space: nowrap;
		transition: all 0.15s;
		font-family: inherit;

		&:hover {
			color: #1e293b;
		}

		&.active {
			color: #4f46e5;
			border-bottom-color: #4f46e5;
			font-weight: 500;
		}
	}

	.panels-wrap {
		flex: 1;
		overflow-y: auto;
		background: #f8fafc;
	}

	.tab-panel {
		display: none;
		max-width: 960px;
		width: 100%;
		margin: 0 auto;
		padding: 16px 0 32px;

		&.active {
			display: block;
		}
	}
</style>
