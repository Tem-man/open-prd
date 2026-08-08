import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";

import type { Plugin } from "vite";

const WASM_RELATIVE = "node_modules/canvaskit-wasm/bin/canvaskit.wasm";

/** pnpm may place the package under the app or under the engine package that depends on it. */
function findCanvasKitWasm(repoRoot: string): string | null {
	const candidates = [
		resolve(repoRoot, "frontend", WASM_RELATIVE),
		resolve(repoRoot, "packages/core", WASM_RELATIVE),
		resolve(repoRoot, WASM_RELATIVE),
	];
	return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** The engine's bundled Inter / Noto faces, which `FontManager` fetches from the site root. */
function findBundledFonts(repoRoot: string): string[] {
	const dir = resolve(repoRoot, "packages/core/assets");
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => /\.(ttf|otf|woff2?)$/.test(name))
		.map((name) => resolve(dir, name));
}

/**
 * CanvasKit and the font manager fetch their binaries from the site root at runtime instead of
 * importing them, so both have to exist as static assets. Sync them into `public/` from their
 * real sources rather than committing copies, which would silently go stale.
 */
export function pencilAssetsPlugin(repoRoot: string): Plugin {
	const publicDir = resolve(repoRoot, "frontend/public");

	return {
		name: "pencil-assets",
		enforce: "pre",
		// configResolved rather than buildStart: the dev server does not run build hooks.
		configResolved() {
			const wasm = findCanvasKitWasm(repoRoot);
			if (!wasm) console.warn("[pencil-assets] canvaskit.wasm not found; run `pnpm install`");

			const sources = [...(wasm ? [wasm] : []), ...findBundledFonts(repoRoot)];
			mkdirSync(publicDir, { recursive: true });
			for (const source of sources) {
				copyFileSync(source, resolve(publicDir, basename(source)));
			}
		},
	};
}
