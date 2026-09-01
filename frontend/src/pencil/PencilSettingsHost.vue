<script setup lang="ts">
	import { defineAsyncComponent } from "vue";

	import { useAppTheme } from "@/app/shell/theme";

	import "./pencil.css";

	// Keep settings styles/theme available outside the prototype route; dialog portals to body.
	useAppTheme();

	const SettingsDialog = defineAsyncComponent(
		() => import("@pencil/components/settings/SettingsDialog.vue"),
	);
</script>

<template>
	<SettingsDialog />
</template>
