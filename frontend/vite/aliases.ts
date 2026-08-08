import { resolve } from 'node:path'

/**
 * Resolve every `@open-pencil/*` package and its internal `#` specifiers straight to
 * TypeScript source. The engine packages are never built, so no `dist` is involved.
 *
 * @param repoRoot absolute path to the repository root (the parent of `packages/`)
 */
export function createPencilAliases(repoRoot: string) {
	const pkg = (relative: string) => resolve(repoRoot, "packages", relative);
	const pencil = (relative: string) => resolve(repoRoot, "frontend/src/pencil", relative);
	const emptyNodeModule = resolve(repoRoot, "frontend/vite/empty-node-module.ts");
	const mermaidStub = resolve(repoRoot, "frontend/src/pencil/app/shell/markdown/index.ts");
	const tauriPluginStub = resolve(repoRoot, "frontend/vite/stubs/tauri-plugin.ts");

	return [
		{ find: /^fs$/, replacement: emptyNodeModule },
		{ find: /^path$/, replacement: emptyNodeModule },

		// document/io still contains dynamic `import('@tauri-apps/plugin-*')` branches that Vite
		// resolves at transform time even though `isTauri()` is always false. Stub them until P2
		// rewrites persistence onto Electron dialogs + the prototypes REST API.
		{ find: /^@tauri-apps\/plugin-.+$/, replacement: tauriPluginStub },

		// Migrated editor shell lives under `src/pencil/`. These must precede the general `@` alias.
		// `@/components/*` is intentionally NOT aliased here — open-prd already owns that prefix
		// (NavBar, ExportModal, …). Dual resolution is handled by `pencilComponentsPlugin`.
		{ find: /^@\/app\//, replacement: `${pencil("app")}/` },
		{ find: /^@\/theme\//, replacement: `${pencil("theme")}/` },
		{ find: /^@\/constants$/, replacement: pencil("constants.ts") },
		{ find: /^@\/constants\//, replacement: `${pencil("constants")}/` },

		// Tree-shake mermaid out of vue-stream-markdown (see plan 5.2).
		{ find: /^mermaid$/, replacement: mermaidStub },
		{ find: /^beautiful-mermaid$/, replacement: mermaidStub },

		// Exact package entries must precede the prefix rules below.
		{ find: /^@open-pencil\/dom-css\/browser$/, replacement: pkg("dom-css/src/browser.ts") },
		{ find: /^@open-pencil\/dom-css\/jsx-runtime$/, replacement: pkg("dom-css/src/jsx/runtime.ts") },
		{
			find: /^@open-pencil\/dom-css\/jsx-dev-runtime$/,
			replacement: pkg("dom-css/src/jsx/dev-runtime.ts"),
		},
		{ find: /^@open-pencil\/dom-css$/, replacement: pkg("dom-css/src/index.ts") },
		{ find: /^@open-pencil\/scene-graph$/, replacement: pkg("scene-graph/src/index.ts") },
		{ find: /^@open-pencil\/pen$/, replacement: pkg("pen/src/index.ts") },
		{ find: /^@open-pencil\/kiwi$/, replacement: pkg("kiwi/src/index.ts") },
		{ find: /^@open-pencil\/fig$/, replacement: pkg("fig/src/index.ts") },
		{ find: /^@open-pencil\/vue$/, replacement: pkg("vue/src/index.ts") },
		{ find: /^@open-pencil\/core$/, replacement: pkg("core/src/index.ts") },

		// Subpath exports (`@open-pencil/core/text`, ...).
		{ find: "@open-pencil/dom-css", replacement: pkg("dom-css/src") },
		{ find: "@open-pencil/scene-graph", replacement: pkg("scene-graph/src") },
		{ find: "@open-pencil/pen", replacement: pkg("pen/src") },
		{ find: "@open-pencil/kiwi", replacement: pkg("kiwi/src") },
		{ find: "@open-pencil/fig", replacement: pkg("fig/src") },
		{ find: "@open-pencil/vue", replacement: pkg("vue/src") },
		{ find: "@open-pencil/core", replacement: pkg("core/src") },

		// Package-internal specifiers declared via each package.json `imports` field.
		{ find: "#scene-graph/", replacement: `${pkg("scene-graph/src")}/` },
		{ find: "#dom-css/", replacement: `${pkg("dom-css/src")}/` },
		{ find: "#core/", replacement: `${pkg("core/src")}/` },
		{ find: "#vue/", replacement: `${pkg("vue/src")}/` },
		{ find: "#pen/", replacement: `${pkg("pen/src")}/` },
		{ find: "#kiwi/", replacement: `${pkg("kiwi/src")}/` },
		{ find: "#fig/", replacement: `${pkg("fig/src")}/` },
	];
}
