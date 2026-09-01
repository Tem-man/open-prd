<script setup lang="ts">
	import { useEventListener } from "@vueuse/core";
	import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from "reka-ui";
	import { useViewportKind } from "@open-pencil/vue";

	import { useEditorStore } from "@/app/editor/active-store";
	import {
		loadEditorLayout,
		saveEditorLayout,
	} from "@/app/shell/layout-storage";
	import { useKeyboard } from "@/app/shell/keyboard/use";

	import EditorCanvas from "@pencil/components/EditorCanvas.vue";
	import LayersPanel from "@pencil/components/LayersPanel.vue";
	import MobileDrawer from "@pencil/components/MobileDrawer.vue";
	import MobileHud from "@pencil/components/MobileHud/MobileHud.vue";
	import PresentButton from "@pencil/components/prototype/PresentButton.vue";
	import PropertiesPanel from "@pencil/components/PropertiesPanel.vue";
	import AppToast from "@pencil/components/Shell/AppToast.vue";
	import Toolbar from "@pencil/components/Toolbar/Toolbar.vue";

	// Runs in a child of PencilEditor so `provideEditor` from the parent is injectable.
	useKeyboard();

	const store = useEditorStore();
	const { isMobile } = useViewportKind();
	const initialEditorLayout = loadEditorLayout();

	useEventListener(
		document,
		"wheel",
		(e: WheelEvent) => {
			if (e.ctrlKey || e.metaKey) e.preventDefault();
		},
		{ passive: false },
	);

	// Store lifetime is owned by PencilEditor — this shell unmounts when entering present mode
	// and must not dispose the document PresentView is about to reuse.
</script>

<template>
	<!-- Desktop: three-pane splitter -->
	<SplitterGroup
		v-if="!isMobile && store.state.showUI"
		direction="horizontal"
		class="min-h-0 flex-1 overflow-hidden"
		@layout="saveEditorLayout"
	>
		<SplitterPanel
			id="layers"
			:default-size="initialEditorLayout[0]"
			:min-size="10"
			:max-size="30"
			class="flex"
		>
			<LayersPanel />
		</SplitterPanel>

		<SplitterResizeHandle
			data-test-id="left-splitter-handle"
			class="group relative z-10 -mx-1 w-2 cursor-col-resize"
		>
			<div
				class="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border group-hover:bg-accent group-data-[state=active]:bg-accent"
			/>
		</SplitterResizeHandle>

		<SplitterPanel
			id="canvas"
			:default-size="initialEditorLayout[1]"
			:min-size="30"
			class="flex"
		>
			<div class="relative flex min-w-0 flex-1">
				<EditorCanvas />
				<Toolbar />
			</div>
		</SplitterPanel>

		<SplitterResizeHandle
			class="group relative z-10 -mx-1 w-2 cursor-col-resize"
		>
			<div
				class="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border group-hover:bg-accent group-data-[state=active]:bg-accent"
			/>
		</SplitterResizeHandle>

		<SplitterPanel
			id="properties"
			:default-size="initialEditorLayout[2]"
			:min-size="10"
			:max-size="30"
			class="flex flex-col"
		>
			<!-- Upstream nests PresentButton inside CollabPanel; collab was not migrated, so the
			     present control sits alone in this chrome strip. -->
			<div
				class="flex shrink-0 items-center justify-end gap-2 border-b border-border px-1.5 py-1.5"
			>
				<PresentButton />
			</div>
			<PropertiesPanel />
		</SplitterPanel>
	</SplitterGroup>

	<!-- Mobile: full-bleed canvas + HUD + bottom drawer -->
	<div
		v-else-if="isMobile && store.state.showUI"
		data-test-id="mobile-editor-layout"
		class="relative flex min-h-0 flex-1 overflow-hidden"
	>
		<div class="relative flex min-w-0 flex-1">
			<EditorCanvas />
			<MobileHud />
			<Toolbar />
		</div>
		<MobileDrawer />
	</div>

	<!-- Collapsed UI (showUI=false) — canvas only -->
	<div v-else class="relative flex min-h-0 flex-1 overflow-hidden">
		<div class="relative flex min-w-0 flex-1">
			<EditorCanvas />
			<Toolbar v-if="isMobile" />
		</div>
	</div>

	<AppToast />
</template>
