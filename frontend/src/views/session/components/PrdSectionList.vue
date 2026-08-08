<script setup lang="ts">
	/**
	 * PrdSectionList — PRD 模块列表
	 * 显示 PRD 模块列表
	 * 支持 tab 切换
	 */
	import { ref, computed, onMounted } from "vue";
	import { usePrdEditStore } from "@/stores/prdEdit";
	import PrdSectionItem from "./PrdSectionItem.vue";

	const props = defineProps<{
		sessionId: string;
	}>();

	const prdEditStore = usePrdEditStore();
	const activeTab = ref(0);

	const sections = computed(() => prdEditStore.sections);
	const hasEditable = computed(() => sections.value.length > 0);

	onMounted(async () => {
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
</script>

<template>
	<div v-if="hasEditable" class="section-list">
		<!-- Tab 导航 -->
		<nav class="tab-nav" role="tablist">
			<button
				v-for="(sec, i) in sections"
				:key="sec.sectionId"
				class="tab-btn"
				:class="{ active: activeTab === i }"
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
		padding: 0 24px;
		display: flex;
		gap: 0;
		overflow-x: auto;
		scrollbar-width: none;
		flex-shrink: 0;

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
