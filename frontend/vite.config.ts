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
	// Web 构建保持相对 base（可部署到子路径）。桌面构建由 scripts/build-desktop.mjs
	// 注入 ELECTRON_BUILD=1 切到根路径：页面由主进程内 Express 以
	// http://127.0.0.1:<port>/ 同源托管，`./` 在 SPA 深链刷新时会把 ./assets/*
	// 解析成 /session/assets/* 而白屏；CanvasKit 按 BASE_URL 抓取的
	// /canvaskit.wasm 也只有根路径能命中静态目录。
	base: process.env.ELECTRON_BUILD === "1" ? "/" : "./",
	plugins: [
		rawTextAssetsPlugin(),
		pencilAssetsPlugin(repoRoot),
		pencilComponentsPlugin(),
		tailwindcss(),
		Icons({ compiler: "vue3" }),
		Components({
			// Scan Vue SFCs in the editor shell and the app-level components folder.
			// `<icon-lucide-*>` is resolved by IconsResolver in any .vue file, including
			// `src/components` (ExportModal, NavBar, …).
			dirs: ["src/pencil/components", "src/components"],
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
			// PRD 渲染运行时由后端维护（导出页内联同一份），预览直接复用源文件
			{
				find: "@prd-runtime",
				replacement: path.resolve(repoRoot, "backend/src/services/prd/runtime"),
			},
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
