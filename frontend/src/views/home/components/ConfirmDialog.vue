<script setup lang="ts">
	withDefaults(
		defineProps<{
			visible: boolean;
			title?: string;
			confirmText?: string;
			cancelText?: string;
		}>(),
		{
			title: "确认删除",
			confirmText: "确认删除",
			cancelText: "取消",
		},
	);

	const emit = defineEmits<{
		(e: "confirm"): void;
		(e: "cancel"): void;
	}>();
</script>

<template>
	<Teleport to="body">
		<Transition name="dialog">
			<div v-if="visible" class="dialog-mask" @click.self="emit('cancel')">
				<div class="dialog" role="dialog" aria-modal="true">
					<div class="dialog-icon">
						<svg viewBox="0 0 24 24" fill="none">
							<circle
								cx="12"
								cy="12"
								r="10"
								stroke="#EF4444"
								stroke-width="1.8"
							/>
							<path
								d="M12 7v5M12 16v.5"
								stroke="#EF4444"
								stroke-width="2"
								stroke-linecap="round"
							/>
						</svg>
					</div>
					<h3 class="dialog-title">{{ title }}</h3>
					<div class="dialog-desc">
						<slot />
					</div>
					<div class="dialog-actions">
						<button
							class="dialog-btn dialog-btn--cancel"
							@click="emit('cancel')"
						>
							{{ cancelText }}
						</button>
						<button
							class="dialog-btn dialog-btn--confirm"
							@click="emit('confirm')"
						>
							{{ confirmText }}
						</button>
					</div>
				</div>
			</div>
		</Transition>
	</Teleport>
</template>

<style lang="scss" scoped>
	.dialog-mask {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10001;
	}

	.dialog {
		background: var(--color-bg-primary);
		border-radius: 12px;
		padding: 28px 28px 24px;
		width: 360px;
		text-align: center;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18);
	}

	.dialog-icon {
		margin-bottom: 12px;
		svg {
			width: 44px;
			height: 44px;
		}
	}

	.dialog-title {
		font-size: 17px;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 10px;
	}

	.dialog-desc {
		font-size: 13px;
		color: var(--color-text-secondary);
		line-height: 1.7;
		margin: 0 0 24px;

		:deep(strong) {
			color: var(--color-text-primary);
		}
	}

	.dialog-actions {
		display: flex;
		gap: 10px;
		justify-content: center;
	}

	.dialog-btn {
		flex: 1;
		padding: 9px 0;
		border-radius: var(--radius-btn-lg);
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		border: none;
		transition: background 0.15s;

		&--cancel {
			background: var(--color-bg-tertiary);
			color: var(--color-text-secondary);
			&:hover {
				background: var(--color-border);
			}
		}

		&--confirm {
			background: #ef4444;
			color: #fff;
			&:hover {
				background: #dc2626;
			}
		}
	}

	/* Vue Transition */
	.dialog-enter-active,
	.dialog-leave-active {
		transition: opacity 0.15s ease;
		.dialog {
			transition:
				transform 0.15s ease,
				opacity 0.15s ease;
		}
	}
	.dialog-enter-from,
	.dialog-leave-to {
		opacity: 0;
		.dialog {
			transform: scale(0.92);
			opacity: 0;
		}
	}
</style>
