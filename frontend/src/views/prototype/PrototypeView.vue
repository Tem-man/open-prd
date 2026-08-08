<script setup lang="ts">
	import { computed, defineAsyncComponent, h } from "vue";
	import { useRoute } from "vue-router";

	// The editor pulls in CanvasKit/Yoga WASM and the whole engine, so it must stay out of the
	// main chunk and only load when this route is actually opened.
	//
	// Deliberately not wrapped in <Suspense>: Suspense flushes `mounted` hooks before the
	// pre-flush watchers that populate template refs, and the canvas surface initialises in
	// `onMounted` off such a ref, so it would never see the <canvas> element.
	const PencilEditor = defineAsyncComponent({
		loader: () => import("@/pencil/PencilEditor.vue"),
		loadingComponent: () =>
			h("div", { class: "placeholder" }, [h("p", "正在加载设计画布…")]),
		delay: 0,
	});

	const route = useRoute();
	const prototypeId = computed(() => String(route.params.id ?? ""));
</script>

<template>
	<div class="prototype-page">
		<PencilEditor
			v-if="prototypeId"
			:prototype-id="prototypeId"
			:key="prototypeId"
		/>
		<div v-else class="placeholder">
			<p>缺少原型 ID</p>
		</div>
	</div>
</template>

<style lang="scss" scoped>
	.prototype-page {
		display: flex;
		flex-direction: column;
		height: 100vh;
		overflow: hidden;
		background: var(--color-bg-secondary);
	}

	.placeholder {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);

		p {
			margin: 0;
			font-size: 14px;
		}
	}
</style>
