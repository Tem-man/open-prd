<script setup lang="ts">
	import { onMounted, onUnmounted } from "vue";
	import { useRoute } from "vue-router";
	import { useSessionsStore } from "@/stores/sessions";
	import { useMessagesStore } from "@/stores/messages";
	import SessionSidebar from "./components/SessionSidebar.vue";
	import PrdPanel from "./components/PrdPanel.vue";

	const route = useRoute();
	const sessionsStore = useSessionsStore();
	const messagesStore = useMessagesStore();

	const sessionId = route.params.id as string;

	onMounted(async () => {
		messagesStore.reset();

		// 并行加载：会话详情 + 已有 PRD（若存在）
		const [data, prdRes] = await Promise.all([
			sessionsStore.fetchSession(sessionId),
			fetch(`/api/sessions/${sessionId}/prd`),
		]);

		if (data?.messages) {
			messagesStore.loadMessages(data.messages);
		}

		// 根据会话已选模块初始化进度步骤
		messagesStore.initWorkflowSteps(data?.selectedModules);

		// 若该会话已有生成的 PRD，直接恢复展示
		if (prdRes.ok) {
			const prd = await prdRes.json();
			if (prd?.id && prd?.html) {
				messagesStore.setPrdReady(prd.id);
				messagesStore.setPrdHtml(prd.html);
			}
		}

		// 恢复 pipeline 状态（中断态、PRD 进度等），供 ProgressSteps 展示继续按钮
		// 注意：已有完整 PRD 时不需要展示重试提示
		if (data?.pipelineState && data.pipelineState.phase !== "done") {
			messagesStore.applyPipelineState(data.pipelineState);
		}
	});

	onUnmounted(() => {
		messagesStore.reset();
	});
</script>

<template>
	<div class="session-view">
		<SessionSidebar :session-id="sessionId" />
		<PrdPanel />
	</div>
</template>

<style lang="scss" scoped>
	.session-view {
		display: flex;
		height: calc(100vh - 52px);
		overflow: hidden;
		background: var(--color-bg-primary);
	}
</style>
