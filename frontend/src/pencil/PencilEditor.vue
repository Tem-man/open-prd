<script setup lang="ts">
	import { computed, onBeforeUnmount, onMounted, ref } from "vue";
	import { useEventListener, watchDebounced } from "@vueuse/core";
	import { useRoute } from "vue-router";
	import { provideEditor } from "@open-pencil/vue";
	import { readFigFile } from "@open-pencil/core/io/formats/fig";

	import { setActiveEditorStore } from "@/app/editor/active-store";
	import { createEditorStore } from "@/app/editor/session";
	import { beginPrdBasisLoad, clearPrdBasis, loadPrdBasis } from "@/app/ai/prdContext";
	import { applyImportedDocument } from "@/app/document/io/imported-document";
	import {
		applyViewport,
		captureViewport,
		readPrototypeViewport,
		writePrototypeViewport,
	} from "@/app/document/prototype-viewport";
	import { useAppTheme } from "@/app/shell/theme";
	import { OPEN_PRD_PROTOTYPE_PROVIDER } from "@/app/storage/sync/persist";
	import { usePrototypesStore } from "@/stores/prototypes";

	import PencilEditorShell from "./PencilEditorShell.vue";
	import PresentView from "./PresentView.vue";
	import "./pencil.css";

	const props = defineProps<{
		prototypeId: string;
	}>();

	const route = useRoute();
	const presenting = computed(() => route.name === "prototype-present");
	const { theme, resolvedTheme } = useAppTheme();

	// ~1s at 60fps. If the canvas never reports a size something else is broken, and giving up
	// leaves the default camera rather than spinning forever.
	const MAX_VIEWPORT_RESTORE_FRAMES = 60;

	const prototypesStore = usePrototypesStore();
	const loadError = ref<string | null>(null);
	const ready = ref(false);
	let viewportRestored = false;

	const store = createEditorStore();
	setActiveEditorStore(store);
	// Must live in a parent of anything that calls `useEditor()` / `useKeyboard()`.
	provideEditor(store);

	// 同步挂起 PRD 依据的就绪门闩：子组件 ChatPanel 挂载时会立即创建设计代理
	// transport，必须让它等到 bindPrototype 完成依据加载（或确认无关联）之后。
	beginPrdBasisLoad();

	async function bindPrototype(id: string) {
		loadError.value = null;
		ready.value = false;

		const meta = await prototypesStore.fetchMeta(id);
		if (!meta) {
			loadError.value = "原型不存在或已被删除";
			clearPrdBasis(); // 释放就绪门闩，避免 ChatPanel 永远等待
			return;
		}

		// 原型关联了 PRD 会话时，并行拉取「原型设计依据」供设计代理注入使用
		if (meta.sessionId) {
			void loadPrdBasis(meta.sessionId);
		} else {
			clearPrdBasis();
		}

		const bytes = await prototypesStore.fetchFigBytes(id);
		if (bytes.byteLength > 0) {
			const file = new File(
				[bytes],
				meta.fileName || `${meta.title || "Untitled"}.fig`,
			);
			const imported = await readFigFile(file, { populate: "first-page" });
			await applyImportedDocument(store, imported);
		}

		store.state.documentName = meta.title || "未命名原型";
		store.setStorageDocumentSource(
			{ providerId: OPEN_PRD_PROTOTYPE_PROVIDER, documentId: id },
			store.state.documentName,
		);
		store.state.autosaveEnabled = true;
		ready.value = true;

		restoreViewport(id);
	}

	// The canvas reports its size through a ResizeObserver, so on the first paint it is still
	// unmeasured and any pan we compute now would be relative to the window instead. Wait for a
	// real measurement rather than assuming one animation frame is enough.
	function restoreViewport(id: string, attempt = 0) {
		if (!store.getMeasuredViewportSize()) {
			if (attempt >= MAX_VIEWPORT_RESTORE_FRAMES) return;
			requestAnimationFrame(() => restoreViewport(id, attempt + 1));
			return;
		}

		const saved = readPrototypeViewport(id);
		if (saved && applyViewport(store, saved)) {
			store.requestRepaint();
		} else {
			try {
				store.zoomToFit();
			} catch {
				/* empty page: no content to fit */
			}
		}
		viewportRestored = true;
		saveViewport();
	}

	function saveViewport() {
		if (!viewportRestored) return;
		const viewport = captureViewport(store);
		if (viewport) writePrototypeViewport(props.prototypeId, viewport);
	}

	watchDebounced(
		() => [store.state.panX, store.state.panY, store.state.zoom],
		saveViewport,
		{ debounce: 400, maxWait: 2000 },
	);

	useEventListener(window, "beforeunload", saveViewport);

	onMounted(() => {
		void bindPrototype(props.prototypeId).catch((e) => {
			console.error(e);
			loadError.value = e instanceof Error ? e.message : "加载原型失败";
			clearPrdBasis(); // 释放就绪门闩，避免 ChatPanel 永远等待
		});
	});

	onBeforeUnmount(() => {
		saveViewport();
		store.state.autosaveEnabled = false;
		clearPrdBasis();
		store.dispose();
	});
</script>

<template>
	<div
		data-test-id="editor-root"
		class="pencil-root relative flex min-h-0 flex-1 flex-col overflow-hidden"
		:data-theme="resolvedTheme"
		:data-theme-setting="theme"
	>
		<div v-if="loadError" class="prototype-load-error">
			<p>{{ loadError }}</p>
		</div>
		<PresentView v-else-if="presenting && ready" />
		<PencilEditorShell v-else-if="!presenting" />
		<div v-if="!ready && !loadError" class="prototype-load-mask">
			正在打开原型…
		</div>
	</div>
</template>

<style scoped>
	.prototype-load-error,
	.prototype-load-mask {
		position: absolute;
		inset: 0;
		z-index: 20;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-canvas, #1e1e1e);
		color: var(--color-muted, #888);
		font-size: 14px;
	}

	.prototype-load-error {
		color: #f87171;
	}
</style>
