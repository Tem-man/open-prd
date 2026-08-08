<script setup lang="ts">
	/**
	 * PrdPanel — PRD 面板
	 * 显示 PRD 内容
	 * 支持 iframe 和原生 DOM 渲染
	 * 支持导出 PRD
	 * 支持编辑 PRD
	 * 支持导出 PRD
	 */
	import { computed, watch } from "vue";
	import { useMessagesStore } from "@/stores/messages";
	import { useSessionsStore } from "@/stores/sessions";
	import { usePrdEditStore } from "@/stores/prdEdit";
	import PrdSectionList from "./PrdSectionList.vue";
	import ProgressSteps from "./ProgressSteps.vue";

	const messagesStore = useMessagesStore();
	const sessionsStore = useSessionsStore();
	const prdEditStore = usePrdEditStore();

	const currentSession = computed(() => sessionsStore.currentSession);
	const hasPrd = computed(
		() => !!messagesStore.prdReady && !!messagesStore.prdHtml,
	);
	const hasEditableSections = computed(() => prdEditStore.sections.length > 0);
	const sessionId = computed(() => currentSession.value?.id ?? "");

	// PRD 就绪后拉取 sections（prdReady 变化时触发）
	watch(
		() => messagesStore.prdReady,
		async (prdId) => {
			if (!prdId || !sessionId.value) return;
			prdEditStore.reset();
			try {
				const res = await fetch(
					`/api/sessions/${sessionId.value}/prd/sections`,
				);
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
				if (data.sections.length > 0) {
					prdEditStore.setSections(data.sections);
				}
			} catch {
				// 静默失败，降级展示 iframe
			}
		},
		{ immediate: true },
	);
</script>

<template>
	<div class="prd-panel">
		<div class="panel-content">
			<!-- PRD 已生成：优先用可编辑模块列表，存量 PRD 降级到 iframe -->
			<template v-if="hasPrd">
				<PrdSectionList v-if="hasEditableSections" :session-id="sessionId" />
				<iframe
					v-else
					class="prd-iframe"
					:srcdoc="messagesStore.prdHtml!"
					sandbox="allow-scripts allow-same-origin"
				/>
			</template>

			<!-- 空状态 -->
			<template v-else>
				<div class="empty-state">
					<div class="empty-icon">
						<svg viewBox="0 0 48 48" fill="none">
							<rect
								x="8"
								y="6"
								width="32"
								height="36"
								rx="3"
								stroke="#c7d2fe"
								stroke-width="2"
							/>
							<path
								d="M15 16h18M15 22h18M15 28h12"
								stroke="#a5b4fc"
								stroke-width="2"
								stroke-linecap="round"
							/>
							<circle
								cx="36"
								cy="36"
								r="8"
								fill="#eef2ff"
								stroke="#c7d2fe"
								stroke-width="1.5"
							/>
							<path
								d="M33 36h6M36 33v6"
								stroke="#818cf8"
								stroke-width="1.5"
								stroke-linecap="round"
							/>
						</svg>
					</div>
				<p class="empty-title">PRD 内容将在此实时生成</p>
				<p class="empty-sub">
					在左侧对话区描述你的产品需求，我将自动构建结构化的<br />PRD
					文档。支持多轮对话逐步细化。
				</p>
				<div class="progress-wrap">
					<ProgressSteps :steps="messagesStore.workflowSteps" />
				</div>
			</div>
			</template>
		</div>
	</div>
</template>

<style lang="scss" scoped>
	.prd-panel {
		flex: 1;
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
		background: var(--color-bg-primary);
	}

	/* ── Tab Nav ── */
	.tab-nav {
		display: flex;
		padding: 0 24px;
		border-bottom: 1px solid var(--color-border);
		gap: 0;
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
		color: var(--color-text-muted);
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		white-space: nowrap;
		transition: all 0.15s;
		&:hover {
			color: var(--color-text-primary);
		}
		&.active {
			color: var(--color-primary);
			border-bottom-color: var(--color-primary);
			font-weight: 500;
		}
	}

	/* ── Content ── */
	.panel-content {
		flex: 1;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.prd-iframe {
		width: 100%;
		height: 100%;
		border: none;
		flex: 1;
	}

	.outline-wrap {
		flex: 1;
		overflow-y: auto;
		padding: 16px 24px;
	}

	/* ── Empty State ── */
	.empty-state {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 40px;
	}
	.empty-icon {
		margin-bottom: 20px;
		svg {
			width: 64px;
			height: 64px;
		}
	}
	.empty-title {
		font-size: 16px;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 8px;
	}
	.empty-sub {
		font-size: 13px;
		color: var(--color-text-muted);
		line-height: 1.7;
		margin: 0 0 16px;
	}
	.progress-wrap {
		margin-top: 24px;
		width: 100%;
		max-width: 680px;
	}
	.link-btn {
		background: none;
		border: none;
		color: var(--color-primary);
		font-size: 13px;
		cursor: pointer;
		text-decoration: underline;
		padding: 0;
		&:hover {
			color: var(--color-primary-hover);
		}
	}

	/* ── Export Modal ── */
	.modal-mask {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}
	.modal-card {
		background: var(--color-bg-primary);
		border-radius: 12px;
		width: 380px;
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.18);
		padding: 24px;
	}
	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
	}
	.modal-title {
		font-size: 16px;
		font-weight: 600;
		color: var(--color-text-primary);
	}
	.modal-close {
		width: 28px;
		height: 28px;
		border: none;
		background: transparent;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 6px;
		color: var(--color-text-muted);
		&:hover {
			background: var(--color-bg-tertiary);
		}
		svg {
			width: 14px;
			height: 14px;
		}
	}
	.modal-desc {
		font-size: 13px;
		color: var(--color-text-secondary);
		margin: 0 0 16px;
	}

	.format-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.format-item {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-card);
		cursor: pointer;
		transition: all 0.15s;

		input[type="radio"] {
			display: none;
		}

		&.active {
			border-color: var(--color-primary);
			background: #eef2ff;
		}
		&:hover:not(.active) {
			background: var(--color-bg-secondary);
		}
	}
	.format-icon {
		font-size: 20px;
		flex-shrink: 0;
	}
	.format-info {
		flex: 1;
		strong {
			display: block;
			font-size: 13px;
			color: var(--color-text-primary);
			margin-bottom: 2px;
		}
		span {
			font-size: 12px;
			color: var(--color-text-muted);
		}
	}
	.format-radio {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 1.5px solid var(--color-border);
		flex-shrink: 0;
		transition: all 0.15s;
		&.checked {
			border-color: var(--color-primary);
			background: var(--color-primary);
			box-shadow: inset 0 0 0 3px #fff;
		}
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		margin-top: 20px;
	}
	.btn-cancel {
		padding: 7px 16px;
		border: none;
		background: transparent;
		font-size: 14px;
		cursor: pointer;
		color: var(--color-text-secondary);
		border-radius: var(--radius-btn-sm);
		&:hover {
			background: var(--color-bg-tertiary);
		}
	}
	.btn-confirm {
		padding: 7px 20px;
		background: var(--color-primary);
		color: #fff;
		border: none;
		border-radius: var(--radius-btn-sm);
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		&:hover {
			background: var(--color-primary-hover);
		}
	}
</style>
