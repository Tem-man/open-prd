import { createRouter, createWebHistory } from "vue-router";
import HomeView from "@/views/home/HomeView.vue";
import SessionView from "@/views/session/SessionView.vue";
import PrototypeView from "@/views/prototype/PrototypeView.vue";

const router = createRouter({
	history: createWebHistory(),
	routes: [
		{
			path: "/",
			name: "home",
			component: HomeView,
		},
		{
			path: "/session/:id",
			name: "session",
			component: SessionView,
		},
		{
			path: "/prototype/:id",
			name: "prototype",
			component: PrototypeView,
			props: true,
		},
		/*
		 * Same PrototypeView instance as the editor route (keyed by id only). PencilEditor stays
		 * mounted across the switch so the active store is reused by PresentView without reloading.
		 */
		{
			path: "/prototype/:id/present",
			name: "prototype-present",
			component: PrototypeView,
			props: true,
		},
		{
			path: "/prototype",
			redirect: { name: "home", query: { tab: "proto" } },
		},
	],
});

export default router;
