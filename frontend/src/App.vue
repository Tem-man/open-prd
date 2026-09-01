<script setup lang="ts">
	import { ref, computed } from "vue";
	import { useRoute } from "vue-router";
	import NavBar from "@/components/NavBar/NavBar.vue";
	import ExportModal from "@/components/ExportModal/ExportModal.vue";
	import PencilSettingsHost from "@/pencil/PencilSettingsHost.vue";

	const showExport = ref(false);
	const route = useRoute();
	const showNavBar = computed(
		() => route.name !== "prototype" && route.name !== "prototype-present",
	);
</script>

<template>
	<div class="app">
		<NavBar v-if="showNavBar" @open-export="showExport = true" />
		<div class="g-body" :class="{ 'no-nav': !showNavBar }">
			<RouterView />
		</div>
		<ExportModal v-model="showExport" />
		<PencilSettingsHost />
	</div>
</template>

<style lang="scss">
	.app {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	.g-body {
		padding-top: 52px;
		flex: 1;
		display: flex;
		flex-direction: column;

		&.no-nav {
			padding-top: 0;
		}
	}
</style>
