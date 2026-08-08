import type { Plugin } from "vite";

/**
 * Inside the migrated editor shell, rewrite `@/components/...` to `@pencil/components/...`.
 *
 * open-prd already owns the `@/components` prefix (NavBar, ExportModal, …). A plain alias would
 * steal those imports; rewriting only files under `src/pencil/` keeps both trees intact.
 */
export function pencilComponentsPlugin(): Plugin {
	return {
		name: "pencil-components-rewrite",
		enforce: "pre",
		transform(code, id) {
			const normalized = id.replace(/\\/g, "/");
			if (!normalized.includes("/src/pencil/")) return null;
			if (!code.includes("@/components/")) return null;
			return {
				code: code.replace(/(['"])@\/components\//g, "$1@pencil/components/"),
				map: null,
			};
		},
	};
}
