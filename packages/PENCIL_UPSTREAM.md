# OpenPencil 源码迁移基线

`packages/` 下的七个 `@open-pencil/*` 包是从 [open-pencil](https://github.com/open-pencil/open-pencil) 迁移过来的**源码**，
迁移后归本仓库所有，可以自由修改。本文件只用于记录基线，便于日后对照上游改动。

## 基线

| 项 | 值 |
| --- | --- |
| 上游版本 | 0.13.2 |
| 上游 commit | `ff31f90de97338c6033c744f0eb1ef3d182fb57c` |
| commit 日期 | 2026-07-31 |
| commit 说明 | fix(ai): opt into Anthropic direct browser access (#438) |
| 迁移日期 | 2026-08-02 |

## 迁移的包

| 包 | 说明 |
| --- | --- |
| `scene-graph` | 文档模型 `SceneGraph` / `SceneNode`、变量系统、撤销栈、命中测试 |
| `kiwi` | Figma Kiwi 二进制编解码 |
| `fig` | `.fig` 文件解析与导出 |
| `pen` | `.pen` 原生格式 |
| `core` | 编辑器引擎：`createEditor()`、Skia 渲染、Yoga 布局、工具集、IO |
| `dom-css` | HTML / CSS / JSX 投影（「代码」标签页用） |
| `vue` | Vue 绑定层：画布挂载、输入管线、headless UI 基元、i18n |

## 与上游的差异

### 结构

- **不构建 dist**：这些包不执行任何 build，Vite 与 TypeScript 通过别名直接读 `src`。
  各包 `package.json` 已移除 `build` / `prepack` / `prepublishOnly` / `typecheck` 等脚本、
  `publishConfig`、`files`，`exports` / `main` / `types` 从 `./dist/*` 改指 `./src/*`。
- **未迁移的目录**：`dist/`、`tests/`、`scripts/`（构建冒烟测试）、`tsdown.config.ts`、`vue/example/`。
- **未迁移的包**：`cli`、`mcp`、`docs`、`demos`。
- **删除的文件**：`vue/src/**/*.stories.ts`（Storybook 未迁移）。
- 各包原本的 `tsconfig.json` 是 tsdown 的构建配置（`emitDeclarationOnly` + `types: ["bun"]`），
  已全部删除，改由 `packages/tsconfig.json` 统一管理。
- `core/vendor/canvaskit-webgpu/` 在上游仓库中不存在（未入库），因此只使用 npm 的标准 `canvaskit-wasm`。

### 源码改动

| 文件 | 改动 | 原因 |
| --- | --- | --- |
| `core/src/public-asset.ts` | **新增** `publicAssetUrl()` | 运行时按 URL 抓取的资产（wasm、内置字体）需要按 `BASE_URL` 解析。Electron 用 `file://` 加载构建产物，根绝对路径会落到文件系统根目录 |
| `core/src/canvaskit.ts` | 改用 `publicAssetUrl()` | 同上，原本是内联的同样逻辑 |
| `core/src/text/fonts.ts` | `fetchBundledFont` 改用 `publicAssetUrl()` | 原本硬编码 `/Inter-Regular.ttf` 这类根绝对路径 |
| `kiwi/src/schema-runtime/{binary,js,parser}.ts` | 类型导入改为 `import type` | 本仓库开启了 `verbatimModuleSyntax` |
| `fig/src/instance-overrides/index.ts` | 删除未使用的 `overrideCandidates` 导入 | 本仓库开启了 `noUnusedLocals` |
| `vue/src/i18n/messages/{shell,home,session,version,export,module,prd,history,prototype,editor}.ts` | **新增** 10 个应用业务消息域 | OpenPRD 业务界面 + 原型编辑器/PRD 编辑器定制文案的多语言，沿用现有 `@nanostores/i18n` 体系 |
| `vue/src/i18n/locales/zh-cn/{shell,home,session,version,export,module,prd,history,prototype,editor}.json` | **新增** 对应中文译文 | 同上；其余语种回退英文基线（`baseLocale='en'`） |
| `vue/src/i18n/{messages,useI18n,index}.ts`、`vue/src/index.ts` | 补导出新域的消息对象与 composable | 供 OpenPRD 业务组件通过 `useI18n()` 使用 |
| `vue/src/i18n/messages/dialogs.ts`、`locales/zh-cn/dialogs.json` | 新增 `settingsGeneral` / `language` / `languageDescription` | 设置弹层的语言分区 |

### 依赖调整

- `@vueuse/core` 由 `^14.2.1` 锁为 `14.2.1`（对齐上游实测版本）。
- `core` 新增 `ai` / `valibot` / `@ai-sdk/valibot`（`core/src/tools/ai-adapter.ts` 直接 import，
  上游由根 package.json 提供）以及 devDependencies `vite`（`vite/client` 类型）、
  `@figma/plugin-typings`（`core/src/figma-api`）。

## 已知偏差

- `@open-pencil/vue` 的 `CanvasRoot` / `CanvasSurface` 这对封装组件**不可用**：`CanvasSurface`
  通过一个 pre-flush watcher 把 `<canvas>` 元素回传给 `CanvasRoot`，而该 watcher 的执行晚于
  `CanvasRoot` 的 `onMounted`，渲染器初始化时拿到的永远是 `null`。上游自己的
  `src/components/EditorCanvas.vue` 也没用这两个组件，而是在同一个组件里
  `useCanvas(canvasRef, editor)` 配普通 `<canvas ref="canvasRef">`。**请沿用后者。**

## 如何跟进上游更新

不要整体覆盖——源码可能已被本仓库修改。做法是在 open-pencil 仓库执行
`git diff ff31f90..<新 commit> -- packages/<包名>/src`，人工挑选需要的改动。
