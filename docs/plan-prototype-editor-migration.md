# 原型设计编辑器迁移计划（open-pencil → open-prd）

> 目标：把 `open-pencil` 的设计编辑器**以源码形式**迁移进 `open-prd` 的 `/prototype` 页面，替换当前的"原型设计工作区"占位符，达到参考图效果（左侧 页面/图层树 + 中间画布 + 右侧 设计/代码/AI 属性面板 + 底部浮动工具条）。
>
> **两条硬约束**
>
> 1. 不删除、不修改 `open-pencil` 原项目代码，它只作为迁出源。
> 2. **迁移的是可编辑的 TypeScript / Vue 源码，不是 dist 打包产物。** 迁移后的编辑器是 open-prd 自己的一等代码，参与正常的 lint / typecheck / HMR，可持续开发迭代。

---

## 一、两侧现状盘点

### 1.1 上游 open-pencil（迁出方）

| 项       | 值                                                                                    |
| -------- | ------------------------------------------------------------------------------------- |
| 形态     | Bun workspaces 单仓多包（monorepo），版本 0.13.2                                      |
| 框架     | Vue 3.5 + TypeScript 5.8 + Vite 8                                                     |
| 渲染     | **CanvasKit / Skia WASM**（非 fabric.js / konva / SVG）                               |
| 布局引擎 | **Yoga WASM**（`@open-pencil/yoga-layout`）                                           |
| 样式     | **Tailwind CSS v4**（`@tailwindcss/vite`）+ tailwind-variants                         |
| 组件基元 | **Reka UI**（Radix 风格 headless）                                                    |
| 状态管理 | 无 Pinia/Vuex，靠 `provide/inject` + 模块级 `shallowRef`                              |
| 图标     | `unplugin-icons` + `@iconify-json/lucide`（自动注册 `<icon-lucide-*>`）               |
| 文档模型 | `SceneGraph` / `SceneNode`（Figma 同构），存 `.fig` 二进制                            |
| AI       | Vercel AI SDK（`ai` + `@ai-sdk/*` 多 Provider）+ ACP（本地 Claude Code / Codex 接管） |

代码体量（决定了"不能重写、只能搬源码"）：

| 模块                                                        |     文件数 |         行数 |
| ----------------------------------------------------------- | ---------: | -----------: |
| `packages/core/src`                                         |        364 |       40,453 |
| `packages/vue/src`                                          |        323 |       20,671 |
| `packages/fig` + `kiwi` + `scene-graph` + `pen` + `dom-css` |        127 |       21,478 |
| `src/components`（有样式的界面外壳）                        |        186 |       14,523 |
| `src/app`（应用层逻辑）                                     |        195 |       14,208 |
| **合计**                                                    | **~1,195** | **~111,000** |

### 1.2 下游 open-prd（迁入方）

| 项               | 值                                                                           |
| ---------------- | ---------------------------------------------------------------------------- |
| 形态             | pnpm workspace（`frontend` / `backend` / `daemon` / `electron`）             |
| 前端             | Vue 3.5.34 + TypeScript 6.0 + Vite 8 + Pinia 3 + vue-router 5                |
| 样式             | **Sass + CSS 变量**（`styles/variables.css`），**无 Tailwind、无 UI 组件库** |
| 后端             | Express 5 + better-sqlite3（`backend/data/prd.db`）                          |
| 目标页面         | `frontend/src/views/prototype/PrototypeView.vue`（当前仅占位符）             |
| 目标路由         | `/prototype`（`frontend/src/router/index.ts`，无 `:id` 参数）                |
| 现有 canvas 使用 | 无（仅 Mermaid SVG 的 CSS transform 缩放）                                   |

关键结构性优势：`App.vue` 已对 `prototype` 路由隐藏全局 NavBar，编辑器可直接全屏接管。

---

## 二、迁移策略选型

| 方案                    | 做法                                                                                                                | 结论                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. npm 安装 SDK         | `pnpm add @open-pencil/core @open-pencil/vue`                                                                       | ❌ **双重否决**。其一，装进来的是 `dist` 打包产物，不可编辑、无法迭代，直接违背目标。其二，npm 上只发布了 `core` 和 `vue`，`@open-pencil/scene-graph`、`fig`、`kiwi`、`pen` 均 404 未发布，而要搬的界面组件大量直接 `import type { SceneNode } from '@open-pencil/scene-graph'`；且 npm 的 0.13.2 依赖清单已落后于本地源码（本地 core 多出 `pptxgenjs`/`unifont`/`ofetch`/`destr` 等），混用会有 API 漂移。 |
| B. 只装 SDK + 自研外壳  | 用 headless 基元自己写面板                                                                                          | ❌ 属性面板、图层树、颜色/渐变/字体选择器共 ~14,500 行界面代码要重写，工作量接近"从零做编辑器"，且做不出参考图效果。                                                                                                                                                                                                                                                                                        |
| **C. 源码迁移（采用）** | 把 `open-pencil/packages/*` 与界面外壳的 **`.ts` / `.vue` 源文件**整体复制进 open-prd，成为 open-prd 自己的一等代码 | ✅ 可编辑、可调试、可迭代；版本自洽；可离线构建。代价是引入约 11 万行代码需要维护。                                                                                                                                                                                                                                                                                                                         |

**采用方案 C。** 迁入后这些代码归 open-prd 所有，**可以随意修改**——这正是需求。为了将来还能参考上游更新，只做一件轻量的事：在 `packages/PENCIL_UPSTREAM.md` 记录迁移基线的 open-pencil commit hash 与日期，日后需要跟进上游改动时按目录 diff、手工 cherry-pick，而不是整体覆盖。

### 2.1 落地形态

```
open-prd/
├── pnpm-workspace.yaml            # 新增 "packages/*"
├── packages/                      # 新增：编辑器引擎（全部为 src 源码，无 dist）
│   ├── PENCIL_UPSTREAM.md         # 记录迁移基线 commit
│   ├── scene-graph/src/           ← open-pencil/packages/scene-graph/src
│   ├── kiwi/src/                  ← …/kiwi/src
│   ├── fig/src/                   ← …/fig/src
│   ├── pen/src/                   ← …/pen/src
│   ├── core/src/                  ← …/core/src
│   ├── core/vendor/canvaskit-webgpu/   ← WASM 运行时资产（见 2.3）
│   ├── dom-css/src/               ← …/dom-css/src
│   └── vue/src/                   ← …/vue/src
└── frontend/src/
    ├── pencil/                    # 新增：编辑器界面外壳（源码，可改）
    │   ├── components/            ← open-pencil/src/components（裁剪）
    │   ├── app/                   ← open-pencil/src/app（裁剪）
    │   ├── theme/                 ← open-pencil/src/theme
    │   └── pencil.css             ← open-pencil/src/app.css（作用域化）
    └── views/prototype/
        └── PrototypeView.vue      # 改造：保留现有 header + 挂载编辑器
```

拆成"`packages/` 引擎 + `frontend/src/pencil/` 界面"两层，是因为引擎包之间用 `@open-pencil/core/text` 这类**跨包子路径说明符**互相引用（package.json 的 `exports` 映射），塞进 `frontend/src` 会破坏这套引用关系；而界面外壳本来就是应用层代码，放 `frontend/src` 才能享受和业务代码一样的别名、lint、HMR 待遇。

### 2.2 源码直连解析（关键：全程不产出 dist）

引擎包**不执行任何 build**，Vite 与 TypeScript 直接读 `.ts` 源文件。这是上游自己的开发模式，照搬即可，做两件事：

1. **Vite 别名** —— 移植 `open-pencil/vite/aliases.ts`，把包名指向源码入口：

```ts
{ find: /^@open-pencil\/core$/,        replacement: resolve(root, 'packages/core/src/index.ts') },
{ find: '@open-pencil/core',           replacement: resolve(root, 'packages/core/src') },
{ find: /^@open-pencil\/scene-graph$/, replacement: resolve(root, 'packages/scene-graph/src/index.ts') },
// …vue / fig / kiwi / pen / dom-css 同理
```

2. **tsconfig paths** —— 镜像 `open-pencil/tsconfig.json` 的 `paths`，且**必须包含包内部的 `#` 说明符**。这点容易漏：`packages/*/src` 里有约 250 个文件在用 `#core/*`、`#vue/*`、`#scene-graph/*`、`#pen/*`、`#dom-css/*` 这类内部导入（如 `packages/vue/src/index.ts` 一个文件就有 114 处），漏配会整片报解析失败。

有了别名后，改 `packages/core/src/canvas/renderer.ts` 一行，前端页面就热更新——这就是"可编辑源码"的验收标准。

### 2.3 唯一不可避免的二进制资产

以下三类文件没有对应源码（都是 Emscripten / Rust 的编译产物，上游本身也是以二进制形式引入的），必须原样带上，这不属于"迁移打包产物"：

| 资产                                              | 来源                                    | 说明                                                                  |
| ------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------- |
| `canvaskit.wasm`（~7MB）                          | `node_modules/canvaskit-wasm/bin/`      | Skia 渲染内核，pnpm 装 `canvaskit-wasm` 时自带                        |
| `canvaskit-webgpu/{canvaskit.wasm, canvaskit.js}` | `open-pencil/packages/core/vendor/`     | 上游自编译的 WebGPU 版 CanvasKit，npm 上没有，必须从 open-pencil 复制 |
| Yoga WASM                                         | `@open-pencil/yoga-layout@3.3.0-grid.3` | 布局引擎，pnpm 装包自带                                               |

---

## 三、模块迁移清单

### 3.1 引擎层源码（`packages/`，整包搬 `src/`）

| 包                         | 源路径                     | 作用                                                                                                |
| -------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------- |
| `@open-pencil/scene-graph` | `packages/scene-graph/src` | 文档模型 `SceneGraph`/`SceneNode`、变量系统、撤销栈、命中测试                                       |
| `@open-pencil/core`        | `packages/core/src`        | `createEditor()`、Skia 渲染管线、Yoga 布局、工具集、IO 注册表、导出、`design-jsx`、prototype 运行时 |
| `@open-pencil/vue`         | `packages/vue/src`         | Vue 绑定层：`provideEditor`、画布挂载与输入管线、图层树/属性/工具条 headless 基元、i18n             |
| `@open-pencil/kiwi`        | `packages/kiwi/src`        | Figma Kiwi 二进制编解码（core 硬依赖）                                                              |
| `@open-pencil/fig`         | `packages/fig/src`         | `.fig` 文件解析与导出（core 硬依赖）                                                                |
| `@open-pencil/pen`         | `packages/pen/src`         | `.pen` 原生格式（core 硬依赖）                                                                      |
| `@open-pencil/dom-css`     | `packages/dom-css/src`     | HTML / CSS / JSX 投影 —— **「代码」标签页必需**                                                     |

每个包的 `package.json` 需要精简：删掉 `build` / `prepack` / `prepublishOnly` 脚本、`publishConfig`、`files`，把 `exports` 从 `./dist/*` 改指 `./src/*`（或干脆只留 `name` + `type: module`，全靠别名解析）。`workspace:*` 依赖关系保留，`pnpm install` 会正确 link。

可选一并迁入：`open-pencil/tests/engine/`（Bun 单测）。若迁，需换成 open-prd 侧的测试运行器；不迁也不影响功能。

### 3.2 界面外壳源码（`frontend/src/pencil/components`）

这部分决定"长得像参考图"，SDK 里只有 headless 基元，不搬就得重写。

| 源路径                                                                                                                                                           | 对应参考图区域                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/components/EditorCanvas.vue`                                                                                                                                | 中间画布（需摘除协作光标）                                                   |
| `src/components/LayersPanel.vue`、`PagesPanel.vue`、`LayerTree/`、`assets-panel/`                                                                                | 左侧 页面 / 图层 / 资源                                                      |
| `src/components/PropertiesPanel.vue`、`DesignPanel.vue`、`properties/`（Fill、Stroke、Layout、Typography、Effects、Constraints、Export、Variables… 60+ 文件）    | 右侧「设计」标签页全部内容                                                   |
| `src/components/CodePanel.vue`                                                                                                                                   | 右侧「代码」标签页                                                           |
| `src/components/ChatPanel.vue`、`chat/`                                                                                                                          | 右侧「AI」标签页                                                             |
| `src/components/Toolbar/`                                                                                                                                        | 底部浮动工具条（选择/画板/矩形/形状/文本/抓手）                              |
| `src/components/ui/`、`inputs/`、`ColorPicker/`、`color-picker-panel/`、`fill-picker/`、`font-picker/`、`FontSettings/`、`variables/`、`editor/ZoomDropdown.vue` | 面板内的输入控件、取色器、渐变编辑器、字体选择器、缩放下拉                   |
| `src/components/canvas/CanvasMenu.vue`                                                                                                                           | 画布右键菜单                                                                 |
| `src/components/Shell/AppToast.vue`                                                                                                                              | 轻提示                                                                       |
| `src/components/prototype/`（`PresentButton`、`PrototypeFrame`、`PrototypeOverlay`、`PrototypeToolbar`）                                                         | 演示放映的入口按钮与放映舞台                                                 |
| `src/components/MobileHud/`、`MobileDrawer.vue`                                                                                                                  | 移动端 HUD 与底部抽屉（抽屉内复用 图层/设计/代码/AI 四个面板）               |
| `src/components/settings/vectorize/VectorizeSettingsSection.vue`                                                                                                 | 位图矢量化的 Provider 与密钥设置                                             |
| `src/theme/`                                                                                                                                                     | tailwind-variants 主题定义（含 `theme/prototype`）                           |
| `src/app.css`                                                                                                                                                    | Tailwind v4 主题令牌（`--color-panel`、`--color-canvas` 等），面板样式全靠它 |
| `src/views/EditorView.vue`                                                                                                                                       | 三栏 Splitter 布局骨架（作为改写参考，不直接用）                             |

### 3.3 应用层源码（`frontend/src/pencil/app`）

已逐文件核查 `src/components/*` 对 `@/app/*` 的依赖，以下为面板正常工作的最小集合：

| 源路径                                                                                                                             | 说明                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/app/editor/active-store/`                                                                                                     | 当前活动编辑器的模块级 `shallowRef` 代理，几乎每个面板组件都 import 它                                       |
| `src/app/editor/session/`                                                                                                          | `createEditorStore()`，把 `createEditor()` 与 IO/导出/矢量编辑组装成 store                                   |
| `src/app/editor/icons.ts`                                                                                                          | 节点类型图标、工具图标映射                                                                                   |
| `src/app/editor/fonts/`                                                                                                            | 字体加载与缓存（画布文字渲染必需）                                                                           |
| `src/app/editor/frame-presets.ts`                                                                                                  | 画板预设尺寸（参考图里的手机画板靠它）                                                                       |
| `src/app/editor/canvas/context-selection.ts`、`canvas/menu/`                                                                       | 画布选区与右键菜单                                                                                           |
| `src/app/editor/clipboard/`                                                                                                        | 复制粘贴（含 Figma 剪贴板互通）                                                                              |
| `src/app/editor/vector-edit/`、`pen/`、`flash/`、`profiler/`                                                                       | 钢笔与矢量编辑会话，被 `session/modules.ts` 直接引用                                                         |
| `src/app/shell/keyboard/`、`shell/menu/shortcut.ts`、`shell/menu/use.ts`、`shell/ui`、`shell/layout-storage.ts`、`shell/markdown/` | 快捷键、快捷键文案、文件对话框、toast、面板宽度记忆、markdown 渲染桩                                         |
| `src/app/prototype/`（`present-mode.ts`、`session.ts`）                                                                            | 演示放映会话状态，见 3.5                                                                                     |
| `src/app/editor/vectorize/`                                                                                                        | 位图转矢量，见 3.5                                                                                           |
| `src/app/document/export/`、`document/io/`（**需改造**，见 3.7）                                                                   | 导出与文档读写                                                                                               |
| `src/constants.ts`                                                                                                                 | 抽屉吸附点、动画弹簧参数等常量，被 `MobileDrawer.vue` 直接引用；同时 re-export `@open-pencil/core/constants` |

> **必须补一个协作桩**：`EditorCanvas.vue` 与 `MobileHud/context.ts` 都 import 了 `@/app/collab/use` 的 `useCollabInjected` / `DEFAULT_COLLAB_STATE`。协作本身不迁（见 3.6），所以要手写一个同名的最小桩模块（返回默认空状态的 no-op），否则这两个组件编译不过，而直接删引用又会侵入式改动组件本体。

### 3.4 AI 与代码标签页（按决策"三个标签都要，AI 沿用 open-pencil 原有实现"）

| 源路径                                                                                                                                        | 处置                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/ai/chat/`、`ai/models/`、`ai/providers/`、`ai/tools/`、`ai/debug/`                                                                   | ✅ 迁移。基于 Vercel AI SDK，通过 `@open-pencil/core/tools` 的 CORE_TOOLS 让模型直接操作画布                                                                                                                              |
| `src/app/ai/acp/`                                                                                                                             | ❌ **裁掉**。ACP（本地 Claude Code / Codex 接管）依赖 `@/app/tauri/command` 起子进程，open-prd 是 Electron，跑不通。若将来要，需用 Electron `child_process` 重写。连带 `components/chat/AcpPermissionDialog.vue` 一并去掉 |
| `src/app/settings/dialog.ts`、`components/settings/SettingsDialog.vue`、`settings/models/`、`settings/provider/`、`settings/provider-select/` | ✅ 迁移。AI 标签页要能配模型，这个设置面板是它的必需依赖                                                                                                                                                                  |
| `src/app/settings/credentials/`（除 `native.ts`）                                                                                             | ✅ 迁移浏览器加密存储那条路径；`native.ts`（Tauri keyring）裁掉                                                                                                                                                           |
| `components/settings/storage/`                                                                                                                | ❌ 裁掉（S3 凭据）                                                                                                                                                                                                        |
| `components/settings/vectorize/`                                                                                                              | ✅ 迁移（位图矢量化纳入范围，见 3.5）                                                                                                                                                                                     |

> 注意：AI 面板与 open-prd 现有的 LangChain Agent 是**两套独立体系**，前者操作画布、后者生成 PRD，互不干扰。代价是前端要额外引入一整套 Vercel AI SDK 依赖（见第五节）。

### 3.5 演示放映 / 移动端 / 位图矢量化

这三块都要迁，但各自有一处必须改造，不是复制了事：

#### 演示放映（原型跳转预览）

引擎侧 `packages/core/src/prototype`（跳转、转场、Overlay 定位）随 core 一起进来，界面侧迁 `views/PresentView.vue` + `app/prototype/` + `components/prototype/`。三处调整：

- **路由**：上游是 `/present`，改为 `/prototype/:id/present`，`app/prototype/present-mode.ts` 里的 `EDITOR_ROUTE` 常量要跟着改成带 id 的编辑器路由。
- **复用活动 store**：`PresentView` 用 `getActiveEditorStoreOrNull()` 复用同一个已加载的文档，直接访问 `/present` 会重定向回编辑器。因为 active-store 是模块级 `shallowRef`、不随组件卸载销毁，这套机制在 open-prd 里照样成立，前提是放映路由和编辑器路由在同一个 SPA 内（是）。
- **`@unhead/vue`**：`PresentView` 用它设置页面标题，而 open-prd 没引入 unhead。两条路：装 `@unhead/vue`，或把这一行换成直接写 `document.title`。倾向后者，少一个依赖。

#### 移动端 HUD

迁 `components/MobileHud/` + `MobileDrawer.vue`，靠 `@open-pencil/vue` 的 `useViewportKind()` 自动切换桌面/移动布局。需要 `motion-v`（抽屉手势与弹簧动画）、`reka-ui` 的 Tabs、以及上面提到的 `src/constants.ts` 和协作桩。抽屉内部直接复用 图层 / 设计 / 代码 / AI 四个面板组件，所以它必须排在 P1 与 P3 之后做。

#### 位图矢量化

迁 `app/editor/vectorize/` + 设置面板。**一处必改**：上游支持 Recraft（`external.api.recraft.ai`）和 fal.ai（`fal.run`）两个 Provider，浏览器分支走裸 `fetch`，桌面分支走 `@/app/tauri/http` 的 `tauriFetch` 绕过 CORS。open-prd 是 Electron，Tauri 那条路没了，而这两家 API 大概率不给浏览器 origin 放 CORS 头。

处置：在 open-prd 后端加一个转发端点 `POST /api/vectorize`，前端只调自己的后端。这同时解决了三件事——绕开 CORS、API Key 留在服务端不暴露给前端、以及内网环境下可统一走出口代理。相应地 `vectorize/credentials.ts` 的密钥存储可以从浏览器加密存储改为后端 `.env`。

### 3.6 明确不迁移

| 模块                              | 源路径                                                                                         | 不迁原因                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 多人协作                          | `src/app/collab/`、`components/CollabPanel/`、`editor/canvas/collaboration-awareness.ts`       | Yjs + trystero P2P，与 open-prd 单机 SQLite 架构不匹配；参考图右上「分享」按钮一并去掉 |
| 自动化 / MCP                      | `src/app/automation/`、`packages/mcp`、`vite/automation.ts`                                    | 硬编码 `ws://127.0.0.1:7600`，仅供上游自身 E2E 与 MCP 客户端                           |
| 多标签页                          | `src/app/tabs/`、`components/TabBar.vue`                                                       | open-prd 用路由 `/prototype/:id` 承载单文档                                            |
| 远端存储                          | `src/app/storage/`、`src/app/integrations/storage/`（S3 + aws4fetch）、`views/StorageView.vue` | 改用 open-prd 的 SQLite REST API                                                       |
| Tauri 桌面层                      | `desktop/`、`src/app/tauri/`、全部 `@tauri-apps/plugin-*`                                      | open-prd 用 Electron；文件对话框、剪贴板、自动更新走 Electron 侧                       |
| ACP 本地 Agent                    | `src/app/ai/acp/`                                                                              | 见 3.4                                                                                 |
| Demo / PWA / 更新器 / Safari 提示 | `src/app/demo/`、`vite/pwa.ts`、`shell/updater`、`components/SafariBanner.vue`                 | 产品无关                                                                               |
| CLI                               | `packages/cli`                                                                                 | Node 端命令行                                                                          |

### 3.7 需要改造（重写适配层，不是复制）

| 事项               | 现状（open-pencil）                                             | 目标（open-prd）                                                                                                  |
| ------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **文档持久化**     | `.fig` 文件 + File System Access API + IndexedDB 缓存 + S3 同步 | **`.fig` 落磁盘文件 + SQLite 只存文件名与索引**，走 `/api/prototypes/:id` REST + 节流自动保存                     |
| **顶部栏**         | `AppMenu`（文件/编辑/视图…）+ 项目名 + 分享                     | 保留 open-prd 现有的「返回首页 / 原型设计」header，右侧加 保存状态 / 导出 / 设置                                  |
| **路由**           | `/`、`/demo`、`/share/:roomId`、`/present`                      | `/prototype/:id` + `/prototype/:id/present`，并把首页「新建原型设计」的项目名输入接上创建流程（该输入目前未接线） |
| **导入 / 导出**    | File System Access 句柄 / Tauri 原生对话框                      | Electron 主进程 `dialog` + IPC，浏览器降级为 `<input type="file">` / `a[download]`，见 4.3                        |
| **凭据存储**       | Tauri keyring / 浏览器加密存储                                  | 走浏览器加密存储分支；Electron 下可选后置改为主进程 safeStorage                                                   |
| **位图矢量化出网** | 浏览器裸 `fetch` / Tauri 原生 fetch 直连 Recraft、fal.ai        | 改为经 open-prd 后端 `POST /api/vectorize` 转发，绕 CORS + 密钥留服务端                                           |
| **协作相关引用**   | `EditorCanvas`、`MobileHud` 依赖 `app/collab/use`               | 手写同名最小桩模块，保持组件本体不动                                                                              |
| **全局样式**       | Tailwind v4 全局接管                                            | 限定在编辑器子树内，见第五节                                                                                      |
| **i18n**           | nanostores 8 语言                                               | SDK 自带，锁定 `zh-cn`，不额外接 vue-i18n                                                                         |

---

## 四、后端与数据模型改动

按决策，原型是**独立资产**，`session_id` 可空（保留"从某个 PRD 会话生成原型"的未来路径）。

### 4.1 存储形态：`.fig` 落磁盘，SQLite 只存索引

文档正文是 Kiwi 编码的二进制，不进数据库。**`.fig` 以真实文件形式存放在磁盘，SQLite 只保存文件名和元数据索引。**

```
<DATA_DIR>/
├── prd.db                      # 现有 SQLite
└── prototypes/                 # 新增：.fig 文件目录
    ├── 0f2c8a1e-….fig
    └── 3b7d5f90-….fig
```

`DATA_DIR` 的解析沿用现有 `db/client.ts` 里 `DB_PATH` 的那套思路：开发态默认 `backend/data/`，Electron 生产态由主进程注入 `app.getPath('userData')`。新增 `backend/src/services/prototypeStore.ts` 统一封装读写、路径拼接与目录初始化，路由层不直接碰 `fs`。

`backend/src/db/schema.ts` + `migrations.ts` 增量迁移新增：

```sql
CREATE TABLE prototypes (
  id         TEXT    PRIMARY KEY,          -- UUID
  session_id TEXT    REFERENCES sessions(id) ON DELETE SET NULL,  -- 可空
  title      TEXT    NOT NULL DEFAULT '',
  file_name  TEXT    NOT NULL,             -- .fig 文件名（相对 prototypes/ 目录）
  file_size  INTEGER NOT NULL DEFAULT 0,   -- 字节数，列表页展示用
  thumbnail  TEXT,                         -- 首页卡片缩略图（PNG base64）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

> `file_name` 存相对名而非绝对路径 —— 绝对路径在开发态和 Electron 生产态不一样，写死会导致换环境后全部失效。

### 4.2 API

新增 `backend/src/routes/prototypes.ts`：

| 方法   | 路径                  | 说明                                                                 |
| ------ | --------------------- | -------------------------------------------------------------------- |
| GET    | `/api/prototypes`     | 列表，只查 SQLite 索引，不读文件                                     |
| POST   | `/api/prototypes`     | 建索引行 + 落一个空白 `.fig`，返回 id                                |
| GET    | `/api/prototypes/:id` | 按索引定位文件并回流 `.fig` 二进制（`application/octet-stream`）     |
| PUT    | `/api/prototypes/:id` | 覆写 `.fig` 文件 + 更新 `file_size`/`updated_at`（自动保存节流调用） |
| PATCH  | `/api/prototypes/:id` | 改标题 / 缩略图，只动 SQLite                                         |
| DELETE | `/api/prototypes/:id` | 删索引行 + 删文件                                                    |

**写入必须是原子的**：自动保存会高频覆写同一个文件，直接 `writeFile` 一旦在中途崩溃就会留下半截文件、文档彻底损坏。做法是先写 `<id>.fig.tmp` 再 `rename` 覆盖——同目录 rename 在主流文件系统上是原子操作。

前端新增 `frontend/src/stores/prototypes.ts`（Pinia，沿用现有 `fetch` 直调风格）。

> 选择「独立表 + 磁盘文件」而非「给 `sessions` 加 `type` 字段 + BLOB 入库」，有三个理由：原型文档与 PRD 会话生命周期不同；`.fig` 动辄几 MB 且自动保存频繁覆写，塞进 SQLite 会让 WAL 快速膨胀、`VACUUM` 成本高；以磁盘文件存放还能直接被用户拿去用 Figma / open-pencil 打开，导入导出退化成一次文件拷贝。

### 4.3 导入 / 导出 `.fig`

主存储由应用托管（4.1），但用户仍需要两个跨出应用边界的动作：**打开一个外部 `.fig`**（从 Figma 导出的、同事发来的），以及**把当前原型另存一份**发给别人。

#### 用 Electron 主进程的 `dialog`，不用 File System Access API

| 方案                                                | 判断                                                                                                                                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron `dialog.showOpenDialog` / `showSaveDialog` | ✅ 采用。返回**真实路径**，Node 侧拿到就能直接读写                                                                                                                                      |
| Web File System Access API（上游浏览器端用的那套）  | ❌ 不用。`FileSystemFileHandle` 是不透明能力令牌，拿不到路径、也存不进 SQLite（只能 structured clone 进 IndexedDB）；且刷新后写权限会失效，重新授权**要求用户手势**，与高频自动保存冲突 |

`electron/src/preload/index.ts` 目前只通过 `contextBridge` 暴露了 `getApiPort`，沿用同一模式再加两个方法即可。

#### 与主存储解耦

- **导入**：读外部文件 → 走 `POST /api/prototypes` 复制成一份新的应用托管文档，**不保留对原文件的引用**。这样导入后的文档和其他文档行为完全一致，不存在"这个文档在外面、那个在里面"的两套生命周期。
- **导出**：从 `<DATA_DIR>/prototypes/` 拷一份到用户选的路径，应用侧状态不变。

#### 纯浏览器环境降级

`pnpm dev` 下前端跑在浏览器里没有 Electron API，导入降级成 `<input type="file">`、导出降级成 `a[download]`。**降级路径同样不引入 FSA**，避免为一个开发态场景把不透明句柄那套复杂度带进来。

上游 `app/document/io/` 里的 `openFigFile` / `saveFigFileAs` 就是这两个动作的入口，改造时把它们的目标从"File System Access 句柄 / Tauri 路径"换成上面这套即可，函数签名和调用点不用动。

### 4.4 位图矢量化转发

新增 `backend/src/routes/vectorize.ts`（见 3.5）：

| 方法 | 路径             | 说明                                                                            |
| ---- | ---------------- | ------------------------------------------------------------------------------- |
| POST | `/api/vectorize` | 接收 PNG 字节，按 `.env` 配置的 Provider（Recraft / fal.ai）转发，回传 SVG 文本 |

### 4.5 环境变量

`backend/.env.example` 新增四项：`DATA_DIR`（数据根目录，`.fig` 存 `<DATA_DIR>/prototypes/`）、`VECTORIZE_PROVIDER`、`RECRAFT_API_KEY`、`FAL_API_KEY`。

Electron 主进程（`electron/src/main/index.ts`）目前已注入 `DB_PATH`，需同步注入 `DATA_DIR = app.getPath('userData')`，否则打包后 `.fig` 会试图写进只读的应用安装目录。

---

## 五、构建与配置改动

### 5.1 新增依赖（一律 `pnpm add`，禁止 npm）

```
引擎运行时：canvaskit-wasm  yoga-layout(npm:@open-pencil/yoga-layout@3.3.0-grid.3)
            culori  fflate  fzstd  opentype.js  nanoevents  es-toolkit  jspdf  svg2pdf.js
            svgpath  sucrase  acorn  diff  expr-eval  twirlwind  destr  js-base64  ofetch
            unifont  pptxgenjs  @chenglou/pretext  @iconify/utils  @xmldom/xmldom  @tauri-apps/api
Vue 层：    reka-ui  @vueuse/core  nanostores  @nanostores/vue  @nanostores/i18n
            @tanstack/vue-table  @atlaskit/pragmatic-drag-and-drop(-hitbox)
界面外壳：  tinykeys  motion-v  idb  dedent  prismjs  vue-stream-markdown  marked
AI 标签页： ai  @ai-sdk/vue  @ai-sdk/openai  @ai-sdk/anthropic  @ai-sdk/google
            @ai-sdk/deepseek  @ai-sdk/valibot  @openrouter/ai-sdk-provider  valibot  zod
构建期：    tailwindcss  @tailwindcss/vite  tailwind-variants  tailwind-merge  tw-animate-css
            unplugin-icons  unplugin-vue-components  @iconify-json/lucide
```

`@tauri-apps/api` 是 `@open-pencil/core` 的直接依赖，即使不用 Tauri 也得装；代码里通过 `IS_TAURI` 常量短路，构建时可 tree-shake。

#### 装在哪：两处，不是一处

open-pencil 是 monorepo，依赖分散在两层，迁过来要对应拆开装：

| 上游位置                                                                                                 | 迁移后位置                         | 处理方式                                                                            |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| `packages/*/package.json` 的 deps（如 `packages/vue` 的 `reka-ui`、`nanostores`、`@tanstack/vue-table`） | `open-prd/packages/*/package.json` | **不用手动装**。package.json 跟着源码一起复制过来，根目录 `pnpm install` 会自动装好 |
| 根 `package.json` 的 deps（界面外壳用的 `motion-v`、`tinykeys`、`idb`、AI SDK 等）                       | `open-prd/frontend/package.json`   | 手动 `pnpm --filter frontend add …`                                                 |

#### 四个安装期的坑

1. **`yoga-layout` 必须用 alias 语法安装。** 上游用的不是 Facebook 官方那个 `yoga-layout`，而是自己 fork 的 grid 分支——`node_modules/yoga-layout/package.json` 里 `name` 实际是 `@open-pencil/yoga-layout`。直接 `pnpm add yoga-layout` 会装成官方版，缺 grid 布局能力且 API 对不上。正确写法：

```bash
pnpm --filter frontend add yoga-layout@npm:@open-pencil/yoga-layout@3.3.0-grid.3
```

2. **版本要对齐上游实测值，别只照抄 semver 范围。** 上游 `package.json` 写的是 `^` 范围，而迁过来的源码是按它锁定的那个版本写的。以下是从 `open-pencil/node_modules` 读到的实际解析版本，安装时以此为准：

| 包                    | 上游实际版本 |
| --------------------- | ------------ |
| `vue`                 | 3.5.39       |
| `reka-ui`             | 2.9.2        |
| `@vueuse/core`        | 14.2.1       |
| `motion-v`            | 2.2.0        |
| `canvaskit-wasm`      | 0.40.0       |
| `tailwindcss`         | 4.2.2        |
| `@tanstack/vue-table` | 8.21.3       |
| `ai`                  | 6.0.174      |
| `tinykeys`            | 3.0.0        |

open-prd 现在是 `vue@^3.5.34`，与上游 3.5.39 同一 minor 线，无需调整。

3. **防止 Vue 出现两份实例。** `packages/vue` 把 `vue` 声明为 peerDependency，pnpm 的严格 node_modules 布局有可能在 `packages/vue/node_modules/` 下再链一份。一旦 `provide/inject` 跨越两个 Vue 实例，`useEditor()` 会直接拿不到编辑器。在 `frontend/vite.config.ts` 加 `resolve.dedupe: ['vue']` 兜底。

4. **被裁功能的包不要装。** `yjs`、`y-protocols`、`y-indexeddb`、`lib0`、`trystero`（协作）、`aws4fetch`（S3）、全部 `@tauri-apps/plugin-*`（桌面层）都不在清单里。装了不仅白白增大体积，还会让本该报错的残留 import 悄悄编译通过，把该删的代码留下来。

### 5.2 `frontend/vite.config.ts` 需补齐 4 件事

1. **别名**：`@open-pencil/*` 与 `#core/*`、`#vue/*`、`#scene-graph/*`、`#pen/*`、`#dom-css/*` 全部指向 `packages/*/src`；另把 `fs`、`path` 指向空模块（core 里有 Node 内建引用需在浏览器侧短路）。
2. **`mermaid` 别名**：上游把裸 `mermaid` 指向一个 `export default undefined` 的空桩，目的是把 mermaid 从 `vue-stream-markdown` 里 tree-shake 掉。已确认 open-prd 全仓没有任何 `import ... from 'mermaid'`（它的 Mermaid 来自 `index.html` 的 CDN 全局），所以**这条别名可以安全照搬，且迁 AI 标签页时是必需的**——否则会平白打包进一份几 MB 的 mermaid。
3. **CanvasKit WASM 插件**：移植 `open-pencil/vite/canvaskit-assets.ts`，把 wasm 拷到 `public/` 并在 dev server 以 `application/wasm` 提供。
4. **Tailwind v4 + 图标插件**：`@tailwindcss/vite`、`Icons({ compiler: 'vue3' })`、`Components({ resolvers: [IconsResolver({ prefix: 'icon' })] })`（面板里大量 `<icon-lucide-*>` 依赖自动注册；resolver 只配 Icons，不开目录自动导入，避免误伤 open-prd 现有组件）。

### 5.3 类型检查与 lint（迁入的是源码，就要能被检查）

open-prd 用 TypeScript 6.0 且开了 `noUnusedLocals`、`noUnusedParameters`、`erasableSyntaxOnly`，而上游按 TS 5.8 编写，直接纳入现有严格配置大概率刷出一批与业务无关的报错。做法是**分级而非排除**：

- 新增 `frontend/tsconfig.pencil.json`，`include` 覆盖 `packages/*/src` 与 `src/pencil/**`，编译选项对齐上游（关掉 `erasableSyntaxOnly`，`noUnusedLocals` 视首轮报错量决定），仍开 `strict`。
- 现有 `tsconfig.app.json` 保持严格，只管业务代码，`paths` 加上 `@open-pencil/*` 以便业务侧引用。
- ESLint 同理：给迁入目录单独一段 config 放宽风格规则，而不是整个 ignore——毕竟这些代码以后要改。

---

## 六、风险与冲突点

| 风险                                   | 影响                                                                                                                                        | 处置                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Tailwind v4 preflight 重置全局样式** | 会冲掉 open-prd 现有 Sass/CSS 变量体系下的首页、会话页外观                                                                                  | 按决策**限定作用域**：关闭 preflight，Tailwind 产物只在 `.pencil-root` 子树内生效，`pencil.css` 作为编辑器独立入口按需 import |
| **Electron 生产环境 WASM 路径**        | 主窗口以 `file://` 加载 `frontend/dist/index.html`，`getCanvasKit()` 默认按 `import.meta.env.BASE_URL` 拼绝对路径 `/canvaskit.wasm`，会 404 | 给 `getCanvasKit({ locateFile })` 传自定义定位函数，或构建时设 `base: './'`                                                   |
| **AI SDK 与后端 Agent 并存**           | 前端多出一整套 Vercel AI SDK + 多 Provider 配置，与 open-prd 后端的 LangChain 是两套模型配置，用户要配两遍                                  | 可后置优化：让 AI 面板读 open-prd 后端 `/api/config` 的模型配置，统一凭据来源                                                 |
| **包体积**                             | CanvasKit wasm ~7MB + Yoga wasm + 引擎代码 + AI SDK，首屏与 Electron 安装包显著变大                                                         | `/prototype` 路由改 `defineAsyncComponent` 懒加载，编辑器不进主 chunk                                                         |
| **TypeScript 6.0 vs 上游 5.8**         | 迁入源码类型检查失败                                                                                                                        | 见 5.3 分级 tsconfig                                                                                                          |
| **`useMermaidZoom` 的 wheel 监听**     | 会话页滚轮缩放与画布缩放可能互相干扰                                                                                                        | 目前只绑在 `.mermaid` 元素上，风险低；编辑器的 `document` 级 `wheel` 阻止默认行为要限定在编辑器路由内注册/卸载                |
| **矢量化 Provider 出网**               | Recraft / fal.ai 大概率不给浏览器 origin 放 CORS 头，上游靠 Tauri 原生 fetch 绕过，Electron 下这条路没了                                    | 走后端 `POST /api/vectorize` 转发（见 3.5）；若部署在无外网的内网，此功能需整体关闭或指向内网替代服务                         |
| **放映依赖活动 store**                 | `/prototype/:id/present` 复用模块级 active-store，若将来把编辑器改成路由级销毁重建，放映会拿到空文档                                        | 保持 active-store 模块级生命周期；直接访问放映路由时按上游逻辑重定向回编辑器                                                  |
| **索引与文件不一致**                   | `.fig` 存磁盘、索引存 SQLite，两者可能失步：删库行时文件没删（孤儿文件）、或文件丢失但列表仍显示                                            | 删除走"先删行后删文件"并容忍文件已不存在；`GET /:id` 读不到文件时返回 404 而非 500；可加一个启动时的孤儿文件清理              |
| **Electron 写入只读目录**              | 打包后应用安装目录不可写，`.fig` 会写失败                                                                                                   | 主进程注入 `DATA_DIR = app.getPath('userData')`，与现有 `DB_PATH` 注入方式一致                                                |
| **上游后续更新**                       | 源码已被我们修改，无法整体覆盖                                                                                                              | `packages/PENCIL_UPSTREAM.md` 记录基线 commit，按需 diff + cherry-pick                                                        |

---

## 七、分阶段实施

| 阶段                                  | 目标                                                                                                                                                      | 交付判定                                                                                                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0 通路验证**（建议先做，1 天量级） | 只迁引擎包源码 + 配好别名/tsconfig paths + 在 `/prototype` 挂一个裸画布（`provideEditor(createEditor())` + `CanvasRoot`/`CanvasSurface`），能画出一个矩形 | ① CanvasKit/Yoga WASM 在 Vite dev 与 Electron 生产都能加载；② Tailwind 未破坏首页样式；③ **改 `packages/core/src` 里一行代码，页面能热更新**（源码可编辑性的硬验收） |
| **P1 界面外壳**                       | 迁 `src/components` + `src/theme` + 必要 `src/app` 子集，摘除协作 / 标签页 / 远端存储的引用                                                               | 三栏布局 + 图层树 + 设计面板 + 底部工具条可用，视觉对齐参考图                                                                                                        |
| **P2 持久化打通** ✅                  | 新增 `prototypes` 索引表 + `prototypeStore` 文件读写 + REST + Pinia store；路由改 `/prototype/:id`；接上自动保存、首页列表与项目名输入                    | 刷新页面文档不丢，首页「原型」标签页能列出、打开、删除；`<DATA_DIR>/prototypes/` 下能看到真实 `.fig` 文件，且可直接用 open-pencil 打开                               |
| **P3 代码与 AI 标签页** ✅            | 迁 `dom-css` + `CodePanel`；迁 `src/app/ai`（去 ACP）+ `ChatPanel` + 模型设置面板                                                                         | 三个标签页齐全，AI 能通过 CORE_TOOLS 操作画布                                                                                                                        |
| **P4 放映与移动端** ✅                | 迁 `app/prototype/` + `components/prototype/` + `PresentView`，加 `/prototype/:id/present` 路由；迁 `MobileHud/` + `MobileDrawer.vue`                     | 画板间点击跳转与转场可放映；窄屏下自动切到 HUD + 抽屉布局。移动端排在 P3 之后，因为抽屉内要复用四个面板                                                              |
| **P5 矢量化与导出**                   | 迁 `app/editor/vectorize/` + 设置面板，后端加 `/api/vectorize` 转发；PNG/SVG/PDF 导出                                                                     | 选中位图能转矢量；导出三种格式可用                                                                                                                                   |

---

## 八、已决策事项

| 决策项                         | 结论                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| 三个标签页                     | 全要。「AI」沿用 open-pencil 原有实现（Vercel AI SDK），但裁掉依赖 Tauri 的 ACP 本地 Agent 接管 |
| Tailwind 范围                  | 严格限定编辑器子树，关闭 preflight                                                              |
| 代码入库                       | 迁入源码全部提交 git，保证可离线构建、CI 可复现                                                 |
| 原型与 PRD 关系                | 完全独立资产，`session_id` 可空                                                                 |
| 迁移形态                       | **源码迁移**，不引入任何 dist 打包产物；引擎包不 build，Vite/TS 直连 `src`                      |
| 演示放映 / 移动端 / 位图矢量化 | 三者均纳入迁移范围（P4、P5）。矢量化的外部 API 调用改为经 open-prd 后端转发                     |

真正砍掉的只剩五类：多人协作、MCP 自动化、多标签页、S3 远端存储、Tauri 桌面层（含 ACP 本地 Agent），外加 Demo / PWA / 更新器 / CLI 这些产品无关件。
