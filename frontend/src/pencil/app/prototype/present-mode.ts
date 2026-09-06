/*
 * Enter / leave the fullscreen prototype presenter.
 *
 * Upstream uses `/present` and `/`. open-prd scopes both under the prototype id so the same
 * PencilEditor workspace instance (keyed only by id) stays mounted across the switch and the
 * active store is reused without reloading the .fig.
 */

/**
 * Stage zoom strategy for the presenter:
 * - `fit`: shrink so the whole frame fits the window (never upscale);
 * - `fill-width`: match the window width and let tall (long-scroll) pages scroll vertically;
 * - `actual`: always 100%, scrolling both ways when the frame exceeds the window.
 */
export type PresentZoomMode = "fit" | "fill-width" | "actual";

export function editorRoute(prototypeId: string): string {
	return `/prototype/${prototypeId}`;
}

export function presentRoute(prototypeId: string): string {
	return `/prototype/${prototypeId}/present`;
}

/** @deprecated Prefer editorRoute(id) — kept for call sites that only need a path prefix. */
export const EDITOR_ROUTE = "/prototype";

/** @deprecated Prefer presentRoute(id). */
export const PRESENT_ROUTE = "/prototype/present";

function isEditorHistoryEntry(back: unknown, prototypeId: string): boolean {
	if (typeof back !== "string") return false;
	const base = editorRoute(prototypeId);
	// Match /prototype/:id with optional query/hash, but not /prototype/:id/present.
	return (
		back === base || back.startsWith(`${base}?`) || back.startsWith(`${base}#`)
	);
}

/**
 * The router is imported lazily because app services initialise before routes, and importing it
 * eagerly from editor action modules would create a cycle through PrototypeView.
 */
export async function enterPresentMode(): Promise<void> {
	const { default: router } = await import("@/router");
	const id = router.currentRoute.value.params.id;
	if (typeof id !== "string" || !id) {
		console.warn(
			"[pencil] enterPresentMode called without a prototype id in the route",
		);
		return;
	}
	await router.push(presentRoute(id));
}

export async function exitPresentMode(): Promise<void> {
	const { default: router } = await import("@/router");
	const id = router.currentRoute.value.params.id;
	if (typeof id !== "string" || !id) {
		await router.replace({ name: "home", query: { tab: "proto" } });
		return;
	}

	// Pop the present entry pushed by enterPresentMode so history stays
	// […, editor?tab=proto] instead of stacking a second editor via replace/push.
	// A further browser Back then leaves the editor (e.g. home prototype list).
	if (isEditorHistoryEntry(window.history.state?.back, id)) {
		router.back();
		return;
	}

	await router.replace({
		name: "prototype",
		params: { id },
		query: { tab: "proto" },
	});
}
