<script setup lang="ts">
	import { nextTick, ref, watch } from "vue";
	import { useI18n } from "@open-pencil/vue";

	const { session: t } = useI18n();

	const props = defineProps<{
		thinking: string;
		streaming?: boolean;
	}>();

	const expanded = ref(false);
	const userToggled = ref(false);
	const bodyRef = ref<HTMLElement | null>(null);

	watch(
		() => props.streaming,
		(streaming) => {
			if (streaming) {
				expanded.value = true;
				userToggled.value = false;
			} else if (!userToggled.value) {
				expanded.value = false;
			}
		},
		{ immediate: true },
	);

	watch(
		() => props.thinking,
		async () => {
			if (!props.streaming || !expanded.value) return;
			await nextTick();
			const el = bodyRef.value;
			if (el) el.scrollTop = el.scrollHeight;
		},
	);

	function toggle() {
		userToggled.value = true;
		expanded.value = !expanded.value;
	}
</script>

<template>
	<div class="thinking-block">
		<button type="button" class="thinking-toggle" @click="toggle">
			<span class="thinking-icon" aria-hidden="true">
				<icon-lucide-loader-circle
					v-if="streaming"
					class="thinking-spinner"
				/>
				<icon-lucide-brain v-else />
			</span>
			<span class="thinking-label">
				{{ streaming ? t.thinking : t.reasoning }}
			</span>
			<icon-lucide-chevron-down
				class="thinking-chevron"
				:class="{ open: expanded }"
			/>
		</button>
		<div v-show="expanded" ref="bodyRef" class="thinking-body">
			{{ thinking }}
		</div>
	</div>
</template>

<style scoped>
	.thinking-block {
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-card);
		overflow: hidden;
	}

	.thinking-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 8px 10px;
		border: none;
		background: transparent;
		cursor: pointer;
		color: var(--color-text-secondary);
		font-size: var(--font-size-small);
		font-family: inherit;
		text-align: left;
	}

	.thinking-toggle:hover {
		background: rgba(79, 70, 229, 0.04);
	}

	.thinking-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		color: var(--color-text-muted);
	}

	.thinking-icon :deep(svg) {
		width: 14px;
		height: 14px;
	}

	.thinking-spinner {
		animation: thinking-spin 0.9s linear infinite;
	}

	.thinking-label {
		flex: 1;
		min-width: 0;
	}

	.thinking-chevron {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		color: var(--color-text-muted);
		transition: transform 0.15s ease;
	}

	.thinking-chevron.open {
		transform: rotate(180deg);
	}

	.thinking-body {
		max-height: 160px;
		overflow-y: auto;
		padding: 0 10px 10px;
		font-size: var(--font-size-small);
		line-height: 1.6;
		color: var(--color-text-muted);
		white-space: pre-wrap;
		word-break: break-word;
	}

	@keyframes thinking-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
