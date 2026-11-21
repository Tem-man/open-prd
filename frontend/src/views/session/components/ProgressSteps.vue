<script setup lang="ts">
	import { ref, watch, nextTick } from "vue";
	import type { WorkflowStep } from "@/types";

	const props = defineProps<{ steps: WorkflowStep[] }>();

	const showTooltip = ref(false);
	const scrollContainerRef = ref<HTMLElement | null>(null);

	/**
	 * 用逗号拼接的状态字符串作为 watch 源，确保只在状态真正变化时触发，
	 * 避免 map() 每次返回新数组引用导致的误触发。
	 */
	watch(
		() => props.steps.map((s) => s.status).join(","),
		async () => {
			await nextTick();
			const container = scrollContainerRef.value;
			if (!container) return;

			// 优先定位到 active 步骤，否则定位到最后一个 done 步骤
			let targetIndex = props.steps.findIndex((s) => s.status === "active");
			if (targetIndex < 0) {
				for (let i = props.steps.length - 1; i >= 0; i--) {
					if (props.steps[i].status === "done") {
						targetIndex = i;
						break;
					}
				}
			}
			if (targetIndex < 0) return;

			const stepEls = container.querySelectorAll<HTMLElement>(".step-item");
			const targetEl = stepEls[targetIndex];
			if (!targetEl) return;

			// 用 getBoundingClientRect 计算相对于滚动容器的实际位置，
			// 避免 offsetLeft 依赖 offsetParent 导致的偏差
			const containerRect = container.getBoundingClientRect();
			const targetRect = targetEl.getBoundingClientRect();
			const scrollTo =
				container.scrollLeft +
				targetRect.left -
				containerRect.left -
				container.clientWidth / 2 +
				targetRect.width / 2;
			container.scrollTo({ left: scrollTo, behavior: "smooth" });
		},
	);
</script>

<template>
	<div
		class="progress-steps-wrap"
		@mouseenter="showTooltip = true"
		@mouseleave="showTooltip = false"
	>
		<!-- 横向滚动轨道 -->
		<div class="progress-steps" ref="scrollContainerRef">
			<div
				v-for="(step, i) in steps"
				:key="step.id"
				class="step-item"
				:class="step.status"
			>
				<div
					v-if="i > 0"
					class="step-connector"
					:class="{ done: steps[i - 1].status === 'done' }"
				></div>
				<div class="step-circle">
					<svg v-if="step.status === 'done'" viewBox="0 0 12 12" fill="none">
						<path
							d="M2 6l3 3 5-5"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
					<!-- error 状态显示 × 图标 -->
					<svg
						v-else-if="step.status === 'error'"
						viewBox="0 0 12 12"
						fill="none"
					>
						<path
							d="M3 3l6 6M9 3l-6 6"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
						/>
					</svg>
					<span v-else>{{ i + 1 }}</span>
				</div>
			<span class="step-label">{{ step.label }}</span>
		</div>
		</div>

		<!-- 悬浮全步骤面板 -->
		<!-- <Transition name="tooltip">
			<div class="tooltip" v-show="showTooltip">
				<div class="tooltip-title">进度总览</div>
				<div
					v-for="(step, i) in steps"
					:key="step.id"
					class="tooltip-row"
					:class="step.status"
				>
					<div class="tooltip-circle">
						<svg v-if="step.status === 'done'" viewBox="0 0 12 12" fill="none">
							<path
								d="M2 6l3 3 5-5"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
						<span v-else-if="step.status === 'active'">
							<span class="active-dot"></span>
						</span>
						<span v-else>{{ i + 1 }}</span>
					</div>
					<span class="tooltip-label">{{ step.label }}</span>
					<span class="tooltip-status">
								<template v-if="step.status === 'done'">已完成</template>
								<template v-else-if="step.status === 'active'">进行中</template>
								<template v-else>待开始</template>
					</span>
				</div>
			</div>
		</Transition> -->
	</div>
</template>

<style lang="scss" scoped>
	.progress-steps-wrap {
		position: relative;

		&::before,
		&::after {
			content: "";
			position: absolute;
			top: 0;
			bottom: 6px;
			width: 16px;
			pointer-events: none;
			z-index: 1;
		}
		&::before {
			left: 0;
			background: linear-gradient(
				to right,
				var(--color-bg-primary),
				transparent
			);
		}
		&::after {
			right: 0;
			background: linear-gradient(
				to left,
				var(--color-bg-primary),
				transparent
			);
		}
	}

	.progress-steps {
		position: relative;
		display: flex;
		align-items: center;
		padding: 8px 4px 4px;
		overflow-x: auto;
		scrollbar-width: thin;
		scrollbar-color: var(--color-border) transparent;

		&::-webkit-scrollbar {
			height: 4px;
		}
		&::-webkit-scrollbar-track {
			background: transparent;
		}
		&::-webkit-scrollbar-thumb {
			background: var(--color-border);
			border-radius: 2px;
		}
	}

	.step-item {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}

	.step-connector {
		width: 14px;
		height: 1px;
		background: var(--color-border);
		margin-right: 4px;
		flex-shrink: 0;
		transition: background 0.2s;
		&.done {
			background: var(--color-success);
		}
	}

	.step-circle {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 10px;
		font-weight: 600;
		flex-shrink: 0;
		background: var(--color-bg-tertiary);
		color: var(--color-text-muted);
		border: 1.5px solid var(--color-border);
		transition: all 0.2s;
		svg {
			width: 12px;
			height: 12px;
		}
	}

	.step-label {
		font-size: 11px;
		color: var(--color-text-muted);
		white-space: nowrap;
		transition: color 0.2s;
	}

	.step-item.active {
		.step-circle {
			background: var(--color-primary);
			border-color: var(--color-primary);
			color: #fff;
		}
		.step-label {
			color: var(--color-primary);
			font-weight: 600;
		}
	}
	.step-item.done {
		.step-circle {
			background: var(--color-success);
			border-color: var(--color-success);
			color: #fff;
		}
		.step-label {
			color: var(--color-success);
		}
	}
	.step-item.error {
		.step-circle {
			background: var(--color-error, #ef4444);
			border-color: var(--color-error, #ef4444);
			color: #fff;
		}
		.step-label {
			color: var(--color-error, #ef4444);
		}
	}


	/* ── Tooltip 面板 ── */
	.tooltip {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		right: 0;
		background: var(--color-bg-primary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-card);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
		padding: 10px 12px;
		z-index: 200;
	}

	.tooltip-title {
		font-size: 11px;
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 8px;
	}

	.tooltip-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 0;

		& + & {
			border-top: 1px solid var(--color-bg-tertiary);
		}
	}

	.tooltip-circle {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 9px;
		font-weight: 600;
		flex-shrink: 0;
		background: var(--color-bg-tertiary);
		color: var(--color-text-muted);
		border: 1.5px solid var(--color-border);
		svg {
			width: 10px;
			height: 10px;
		}
	}

	.active-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-primary);
		display: block;
		animation: pulse 1.4s infinite;
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}

	.tooltip-label {
		flex: 1;
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.tooltip-status {
		font-size: 11px;
		color: var(--color-text-muted);
	}

	.tooltip-row.active {
		.tooltip-circle {
			background: var(--color-primary);
			border-color: var(--color-primary);
			color: #fff;
		}
		.tooltip-label {
			color: var(--color-text-primary);
			font-weight: 500;
		}
		.tooltip-status {
			color: var(--color-primary);
		}
	}
	.tooltip-row.done {
		.tooltip-circle {
			background: var(--color-success);
			border-color: var(--color-success);
			color: #fff;
		}
		.tooltip-label {
			color: var(--color-text-muted);
			text-decoration: line-through;
		}
		.tooltip-status {
			color: var(--color-success);
		}
	}

	/* ── 动画 ── */
	.tooltip-enter-active,
	.tooltip-leave-active {
		transition:
			opacity 0.15s ease,
			transform 0.15s ease;
	}
	.tooltip-enter-from,
	.tooltip-leave-to {
		opacity: 0;
		transform: translateY(-4px);
	}
</style>
