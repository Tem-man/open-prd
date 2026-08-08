<script setup lang="ts">
	/**
	 * HistoryDrawer — 历史会话抽屉
	 * 根据会话列表，显示历史会话记录
	 * 点击会话记录，滚动到对应会话记录
	 */
	import { computed } from "vue";
	import type { Message } from "@/types";

	const props = defineProps<{
		open: boolean;
		messages: Message[];
		currentSessionTitle?: string;
	}>();

	const emit = defineEmits<{
		close: [];
		scrollTo: [msgId: string];
	}>();

	/** 将消息列表按轮次分组：每个 user 消息 + 紧随的 assistant 消息为一轮 */
	interface Round {
		index: number;
		userMsg: Message;
		aiMsg: Message | null;
	}

	const rounds = computed<Round[]>(() => {
		const result: Round[] = [];
		let roundIndex = 0;
		for (let i = 0; i < props.messages.length; i++) {
			const msg = props.messages[i];
			if (msg.role === "user") {
				const next = props.messages[i + 1];
				result.push({
					index: ++roundIndex,
					userMsg: msg,
					aiMsg: next?.role === "assistant" ? next : null,
				});
			}
		}
		return result;
	});

	function truncate(str: string, max = 24) {
		if (!str) return "空消息";
		return str.length > max ? str.slice(0, max) + "…" : str;
	}

	function relativeTime(ts: number) {
		const diff = Date.now() - ts;
		const m = Math.floor(diff / 60000);
		if (m < 1) return "刚刚";
		if (m < 60) return `${m} 分钟前`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h} 小时前`;
		return `${Math.floor(h / 24)} 天前`;
	}
</script>

<template>
	<Teleport to="body">
		<!-- 遮罩 -->
		<Transition name="drawer-mask">
			<div v-if="open" class="drawer-mask" @click="emit('close')"></div>
		</Transition>

		<!-- 抽屉 -->
		<Transition name="drawer-slide">
			<div
				v-if="open"
				class="history-drawer"
				role="dialog"
				aria-label="历史会话"
			>
				<!-- Header -->
				<div class="drawer-header">
					<div class="drawer-header-left">
						<svg class="drawer-icon" viewBox="0 0 16 16" fill="none">
							<path
								d="M2 4h12M2 8h8M2 12h5"
								stroke="currentColor"
								stroke-width="1.4"
								stroke-linecap="round"
							/>
						</svg>
						<div>
							<p class="drawer-title">本轮对话记录</p>
							<p class="drawer-subtitle" v-if="currentSessionTitle">
								{{ currentSessionTitle }}
							</p>
						</div>
					</div>
					<button class="drawer-close" @click="emit('close')">
						<svg viewBox="0 0 16 16" fill="none">
							<path
								d="M4 4l8 8M12 4l-8 8"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
							/>
						</svg>
					</button>
				</div>

				<!-- 空状态 -->
				<div v-if="rounds.length === 0" class="drawer-empty">
					<svg viewBox="0 0 40 40" fill="none">
						<circle cx="20" cy="20" r="18" stroke="#e2e8f0" stroke-width="2" />
						<path
							d="M13 17h14M13 23h8"
							stroke="#cbd5e1"
							stroke-width="2"
							stroke-linecap="round"
						/>
					</svg>
					<p>还没有对话记录</p>
				</div>

				<!-- 轮次列表 -->
				<div class="drawer-list" v-else>
					<div
						v-for="round in rounds"
						:key="round.userMsg.id"
						class="round-item"
						@click="
							emit('scrollTo', round.userMsg.id);
							emit('close');
						"
					>
						<!-- 序号 -->
						<div class="round-index">{{ round.index }}</div>

						<!-- 内容 -->
						<div class="round-body">
							<!-- 用户提问（标题） -->
							<p class="round-user-msg">
								{{ truncate(round.userMsg.content) }}
							</p>
							<!-- AI 回复摘要 -->
							<p class="round-ai-preview" v-if="round.aiMsg">
								<span class="ai-label">AI</span>
								{{
									truncate(
										round.aiMsg.content
											.replace(/[#*`>]/g, "")
											.replace(/\s+/g, " ")
											.trim(),
										28,
									)
								}}
							</p>
							<p class="round-ai-preview pending" v-else>
								<span class="ai-label">AI</span>回复中…
							</p>
						</div>

						<!-- 时间 -->
						<span class="round-time">{{
							relativeTime(round.userMsg.createdAt)
						}}</span>
					</div>
				</div>
			</div>
		</Transition>
	</Teleport>
</template>

<style lang="scss">
	.drawer-mask {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.28);
		z-index: 300;
	}

	.history-drawer {
		position: fixed;
		top: 0;
		right: 0;
		width: 340px;
		height: 100vh;
		background: var(--color-bg-primary);
		box-shadow: -6px 0 32px rgba(0, 0, 0, 0.1);
		z-index: 301;
		display: flex;
		flex-direction: column;
	}

	/* ── Header ── */
	.drawer-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 18px;
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}
	.drawer-header-left {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.drawer-icon {
		width: 18px;
		height: 18px;
		color: var(--color-primary);
		flex-shrink: 0;
	}
	.drawer-title {
		font-size: 14px;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}
	.drawer-subtitle {
		font-size: 11px;
		color: var(--color-text-muted);
		margin: 2px 0 0;
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.drawer-close {
		width: 28px;
		height: 28px;
		border: none;
		background: transparent;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-btn-sm);
		color: var(--color-text-muted);
		transition: background 0.15s;
		flex-shrink: 0;
		&:hover {
			background: var(--color-bg-tertiary);
			color: var(--color-text-primary);
		}
		svg {
			width: 14px;
			height: 14px;
		}
	}

	/* ── Empty ── */
	.drawer-empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		color: var(--color-text-muted);
		font-size: 13px;
		svg {
			width: 48px;
			height: 48px;
		}
	}

	/* ── List ── */
	.drawer-list {
		flex: 1;
		overflow-y: auto;
		padding: 8px 0;
		scrollbar-width: thin;
		scrollbar-color: var(--color-border) transparent;
	}

	.round-item {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 12px 18px;
		cursor: pointer;
		transition: background 0.12s;
		border-bottom: 1px solid var(--color-bg-tertiary);

		&:hover {
			background: var(--color-bg-secondary);
		}
		&:last-child {
			border-bottom: none;
		}
	}

	/* 轮次序号圆圈 */
	.round-index {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--color-bg-tertiary);
		border: 1.5px solid var(--color-border);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 10px;
		font-weight: 600;
		color: var(--color-text-muted);
		flex-shrink: 0;
		margin-top: 1px;
	}

	.round-body {
		flex: 1;
		overflow: hidden;
	}

	.round-user-msg {
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text-primary);
		margin: 0 0 4px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.round-ai-preview {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		color: var(--color-text-muted);
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;

		&.pending {
			font-style: italic;
		}
	}

	.ai-label {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--color-primary);
		color: #fff;
		font-size: 8px;
		font-weight: 700;
		flex-shrink: 0;
	}

	.round-time {
		font-size: 10px;
		color: var(--color-text-muted);
		white-space: nowrap;
		flex-shrink: 0;
		margin-top: 2px;
	}

	/* ── 动画 ── */
	.drawer-slide-enter-active,
	.drawer-slide-leave-active {
		transition: transform 0.24s cubic-bezier(0.4, 0, 0.2, 1);
	}
	.drawer-slide-enter-from,
	.drawer-slide-leave-to {
		transform: translateX(100%);
	}

	.drawer-mask-enter-active,
	.drawer-mask-leave-active {
		transition: opacity 0.24s ease;
	}
	.drawer-mask-enter-from,
	.drawer-mask-leave-to {
		opacity: 0;
	}
</style>
