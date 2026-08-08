import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import Icons from "unplugin-icons/vite";
import IconsResolver from "unplugin-icons/resolver";
import Components from "unplugin-vue-components/vite";
import path from "node:path";

import { createPencilAliases } from "./vite/aliases";
import { pencilAssetsPlugin } from "./vite/pencil-assets";
import { pencilComponentsPlugin } from "./vite/pencil-components";
import { rawTextAssetsPlugin } from "./vite/raw-markdown";

const repoRoot = path.resolve(__dirname, "..");

export default defineConfig({
	// Electron loads the built index.html over file://, where root-absolute asset URLs resolve
	// against the filesystem root. This also keeps CanvasKit's runtime `/canvaskit.wasm` fetch,
	// which is derived from BASE_URL, pointing next to the document.
	base: "./",
	plugins: [
		rawTextAssetsPlugin(),
		pencilAssetsPlugin(repoRoot),
		pencilComponentsPlugin(),
		tailwindcss(),
		Icons({ compiler: "vue3" }),
		Components({
			// Auto-register editor shell components (`Tip`, panel pieces, …) and `<icon-lucide-*>`.
			// Scoped to `src/pencil/components` so open-prd's own `src/components` stay untouched.
			dirs: ["src/pencil/components"],
			dts: "src/components.d.ts",
			resolvers: [IconsResolver({ prefix: "icon" })],
		}),
		vue(),
	],
	resolve: {
		alias: [
			...createPencilAliases(repoRoot),
			// The migrated editor shell keeps upstream's `@/...` import style under its own prefix,
			// so it does not collide with this app's `@` -> src.
			{ find: "@pencil", replacement: path.resolve(__dirname, "src/pencil") },
			{ find: "@", replacement: path.resolve(__dirname, "src") },
		],
		// The engine packages declare `vue` as a peer dependency; without this pnpm can link a
		// second copy and provide/inject stops working across the editor boundary.
		dedupe: ["vue"],
	},
	server: {
		port: 5173,
		proxy: {
			"/api": {
				target: "http://localhost:3000",
				changeOrigin: true,
			},
		},
	},
});
