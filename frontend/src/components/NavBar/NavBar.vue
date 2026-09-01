<script setup lang="ts">
	import { ref, computed, nextTick } from "vue";
	import { useRoute, useRouter } from "vue-router";
	import { useSessionsStore } from "@/stores/sessions";
	import { useMessagesStore } from "@/stores/messages";
	import { openSettingsDialog } from "@/app/settings/dialog";

	const emit = defineEmits<{
		openExport: [];
	}>();

	const route = useRoute();
	const router = useRouter();
	const sessionsStore = useSessionsStore();
	const messagesStore = useMessagesStore();

	const isSessionPage = computed(() => route.name === "session");
	const currentSession = computed(() => sessionsStore.currentSession);
	const hasPrd = computed(
		() => !!messagesStore.prdReady && !!messagesStore.prdHtml,
	);

	const editingTitle = ref(false);
	const titleRef = ref<HTMLElement | null>(null);

	function startEditTitle() {
		editingTitle.value = true;
		nextTick(() => titleRef.value?.focus());
	}

	function finishEditTitle() {
		editingTitle.value = false;
		const newTitle = titleRef.value?.innerText?.trim();
		if (newTitle && currentSession.value) {
			sessionsStore.updateTitle(currentSession.value.id, newTitle);
		}
	}
</script>

<template>
	<header class="g-nav">
		<div class="g-nav__left">
			<div class="g-logo" @click="router.push('/')">
				<div class="g-logo-icon">
					<svg viewBox="0 0 20 20" fill="none" width="16" height="16">
						<rect
							x="3"
							y="2"
							width="14"
							height="16"
							rx="2"
							stroke="currentColor"
							stroke-width="1.6"
						/>
						<path
							d="M7 7h6M7 10.5h6M7 14h4"
							stroke="currentColor"
							stroke-width="1.4"
							stroke-linecap="round"
						/>
					</svg>
				</div>
				<span class="g-logo-text">Open PRD</span>
			</div>

			<template v-if="isSessionPage">
				<div class="g-nav-divider"></div>
				<div class="session-nav">
					<button
						class="g-icon-btn btn-back"
						title="返回"
						@click="router.push('/')"
					>
						<svg viewBox="0 0 16 16" fill="none">
							<path
								d="M10 3L5 8l5 5"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</button>
					<div class="session-title-wrap">
						<span
							ref="titleRef"
							class="session-title"
							:contenteditable="editingTitle"
							@blur="finishEditTitle"
							@keydown.enter.prevent="finishEditTitle"
							>{{ currentSession?.title || "未命名 PRD" }}</span
						>
					</div>
					<button class="g-icon-btn" title="编辑标题" @click="startEditTitle">
						<svg viewBox="0 0 16 16" fill="none">
							<path
								d="M11.5 2.5a1.414 1.414 0 012 2L5 13H3v-2L11.5 2.5z"
								stroke="currentColor"
								stroke-width="1.3"
								stroke-linejoin="round"
							/>
						</svg>
					</button>
				</div>
			</template>
		</div>

		<div class="g-nav__right">
			<template v-if="isSessionPage && hasPrd">
				<button class="btn-export" @click="emit('openExport')">
					<svg viewBox="0 0 16 16" fill="none">
						<path
							d="M8 2v8M5 7l3 3 3-3"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
						<path
							d="M3 12h10"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
						/>
					</svg>
					导出 HTML
				</button>
			</template>

			<button class="g-icon-btn" title="设置" @click="openSettingsDialog()">
				<svg viewBox="0 0 24 24" fill="none">
					<path
						d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
					<circle
						cx="12"
						cy="12"
						r="3"
						stroke="currentColor"
						stroke-width="1.5"
					/>
				</svg>
			</button>
		</div>
	</header>
</template>

<style lang="scss" scoped>
	.g-nav {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 52px;
		background: var(--color-bg-primary);
		border-bottom: 1px solid var(--color-border);
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 20px;
		z-index: 200;
		flex-shrink: 0;

		&__left,
		&__right {
			display: flex;
			align-items: center;
			gap: 6px;
		}
	}

	.g-logo {
		display: flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
		user-select: none;
		flex-shrink: 0;

		&-icon {
			width: 28px;
			height: 28px;
			border-radius: 6px;
			background: var(--color-primary);
			color: #fff;
			display: flex;
			align-items: center;
			justify-content: center;
			flex-shrink: 0;
		}

		&-text {
			font-size: 15px;
			font-weight: 600;
			color: var(--color-text-primary);
			letter-spacing: -0.01em;
		}
	}

	.g-nav-divider {
		width: 1px;
		height: 20px;
		background: var(--color-border);
		margin: 0 6px;
		flex-shrink: 0;
	}

	.session-nav {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		max-width: 480px;
	}

	.session-title-wrap {
		min-width: 0;
		overflow: hidden;
	}

	.session-title {
		display: block;
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		border-radius: 4px;
		padding: 2px 6px;
		outline: none;
		cursor: default;
		border: 1px solid transparent;
		transition:
			border-color 0.15s,
			background 0.15s;

		&[contenteditable="true"] {
			background: var(--color-bg-tertiary);
			border-color: var(--color-primary);
			white-space: normal;
			cursor: text;
		}
	}

	.g-icon-btn {
		width: 30px;
		height: 30px;
		border: none;
		background: transparent;
		border-radius: var(--radius-btn-sm);
		cursor: pointer;
		color: var(--color-text-secondary);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.15s;
		flex-shrink: 0;

		&:hover {
			background: var(--color-bg-tertiary);
		}

		svg {
			width: 16px;
			height: 16px;
		}

		&.btn-back svg {
			width: 15px;
			height: 15px;
		}
	}

	.btn-export {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 6px 14px;
		background: var(--color-primary);
		color: #fff;
		border: none;
		border-radius: var(--radius-btn-sm);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s;
		white-space: nowrap;
		flex-shrink: 0;

		&:hover {
			background: var(--color-primary-hover);
		}

		svg {
			width: 14px;
			height: 14px;
		}
	}
</style>
