/** 打字机效果 - 显示打字机效果 - 支持三个圆点弹跳动画 **/

<template>
	<div class="typing-indicator">
		<span></span>
		<span></span>
		<span></span>
	</div>
</template>

<style scoped>
	.typing-indicator {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 4px 2px;
	}

	.typing-indicator span {
		width: 6px;
		height: 6px;
		background: var(--color-text-muted);
		border-radius: 50%;
		animation: bounce 1.2s infinite ease-in-out;
	}

	.typing-indicator span:nth-child(2) {
		animation-delay: 0.2s;
	}
	.typing-indicator span:nth-child(3) {
		animation-delay: 0.4s;
	}

	@keyframes bounce {
		0%,
		80%,
		100% {
			transform: translateY(0);
			opacity: 0.4;
		}
		40% {
			transform: translateY(-6px);
			opacity: 1;
		}
	}
</style>
