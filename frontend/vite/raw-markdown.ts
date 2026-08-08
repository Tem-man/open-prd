import type { Plugin } from "vite";

/**
 * The engine imports `.md` prompt templates and the `.kiwi` schema as plain strings without a
 * `?raw` suffix, which Vite would otherwise try to parse as JavaScript.
 */
export function rawTextAssetsPlugin(): Plugin {
	return {
		name: "pencil-raw-text-assets",
		transform(code: string, id: string) {
			if (id.endsWith(".md") || id.endsWith(".kiwi")) {
				return { code: `export default ${JSON.stringify(code)}`, map: null };
			}
		},
	};
}
