<script setup lang="ts">
	const { size = 24 } = defineProps<{
		size?: number;
	}>();
</script>

<template>
	<button
		type="button"
		class="stop-generate-btn"
		:style="{ width: `${size}px`, height: `${size}px` }"
	>
		<span class="stop-generate-btn__icon" aria-hidden="true" />
	</button>
</template>

<style scoped>
	.stop-generate-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: var(--color-primary);
		cursor: pointer;
		transition: background 0.15s;
	}

	.stop-generate-btn:hover {
		background: var(--color-primary-hover);
	}

	.stop-generate-btn__icon {
		width: 42%;
		height: 42%;
		border-radius: 2px;
		background: #fff;
	}
</style>
