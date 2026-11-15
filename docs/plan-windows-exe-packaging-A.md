# 方案：把 open-prd 打包为 Windows 桌面应用（.exe）

> **目标**：在 Windows x64 上产出可直接分发的 `.exe`（NSIS 安装版 + 免安装便携版），安装后双击启动即可使用完整的 PRD 生成、编辑、版本管理、原型设计与导出能力，无需 Node.js / pnpm / 源码仓库。
>
> **本阶段交付物**：仅本计划文档。**不改动任何代码**，待方案确认后再按阶段实施。
>
> **硬约束**：所有第三方包安装与脚本一律使用 `pnpm`（AGENTS.md），禁止 `npm install`；不改动 `packages/*` 引擎源码；不破坏现有 Web 开发模式（`pnpm dev`）。

---

## 零、结论摘要

项目里 `electron/` workspace 包、`electron.vite.config.ts`、`electron-builder.yml`、主进程 / preload、以及后端的 `DATA_DIR` / `DB_PATH` / `USER_SKILLS_DIR` 注入**都已经写好了**，属于"骨架完成度约 60%"。

但**现在直接执行 `pnpm --filter electron dist` 打出来的 exe，安装后大概率是白屏或全功能不可用**。有 5 个必须先修的硬阻塞：

| # | 阻塞 | 后果 |
| --- | --- | --- |
| B1 | 生产环境用 `win.loadFile()` 以 `file://` 加载前端，而前端 40+ 处请求都是相对路径 `/api/...` | 所有接口请求解析成 `file:///api/...`，会话、PRD、SSE 全部失败 |
| B2 | `createWebHistory()` + `file://` | 路由跳转 / F5 刷新到 `/session/:id`、`/prototype/:id` 直接失效（AGENTS.md 已列为"已知未完成项"） |
| B3 | `electron/package.json` **没有任何 `dependencies`**，`electron/node_modules` 里没有 `backend` 链接；`externalizeDepsPlugin()` 会把 `import("backend")` 当成待打包模块或外部依赖 | 打包后 `Cannot find package 'backend'`，Express 起不来，窗口空白 |
| B4 | `better-sqlite3` 是原生模块，需按 Electron ABI 重编译，且不能进 asar | 首次建库即 `NODE_MODULE_VERSION` 报错或 `.node` 文件读不到 |
| B5 | `win.loadFile(join(__dirname, '../../frontend/dist/index.html'))` 路径错误 | `__dirname` = `out/main`，向上两级是 `electron/`，而前端产物实际被 `extraResources` 放在 `<resources>/frontend/dist/` |

另有 5 个中等问题：固定 3000 端口且监听 `0.0.0.0`、`backend/src/index.ts` 的 `isMain` 自动启动判断可能被主进程误触发、缺 `electron/build/icon.ico`、打包后无 `.env` 导致 API Key 无来源、PRD 图表依赖公网 CDN。

**核心决策**：把渲染层从 `file://` 改为**主进程内 Express 同源 HTTP 托管**（`http://127.0.0.1:<随机端口>/`）。这一处调整同时解决 B1 / B2 / B5，以及 CanvasKit WASM、字体在 `file://` 下的 fetch/CORS 问题，且**前端业务代码零改动**。后端依赖用 `pnpm deploy` 生成自包含目录后作为 `extraResources` 分发，绕开 pnpm workspace 符号链接在 asar 中的解析问题。

---

## 一、现状盘点

### 1.1 已有资产（可直接复用）

| 位置 | 内容 | 状态 |
| --- | --- | --- |
| `electron/src/main/index.ts` | `app.isPackaged` 时注入 `DATA_DIR` / `DB_PATH` / `USER_SKILLS_DIR`，迁移遗留 `skill-custom-*` 到 userData，动态 `import("backend")` 拿端口，`ipcMain.handle('get-api-port')` | ✅ 数据目录与 Skill 迁移逻辑可原样保留 |
| `electron/src/preload/index.ts` | `contextBridge.exposeInMainWorld('electronAPI', { getApiPort })`，`contextIsolation: true` / `nodeIntegration: false` | ✅ 安全配置正确 |
| `electron/electron-builder.yml` | `appId` / `productName: OpenPRD` / NSIS x64 / `extraResources` 已含 `frontend/dist`、`backend/dist`、`skills` | ⚠️ 需重构成"自包含 backend 目录" |
| `backend/src/db/client.ts` | `process.env.DB_PATH` 覆盖数据库路径 | ✅ 无需改 |
| `backend/src/services/prototypeStore.ts` | `getDataDir()` 读 `DATA_DIR`，`.fig` 落 `userData/prototypes/` | ✅ 无需改 |
| `backend/src/services/skillDirs.ts` | `BUILTIN_SKILLS_ROOT = resolve(__dirname, '..','..','..','skills')` | ✅ 与 `<resources>/backend/dist/services` 布局**天然吻合**，无需改 |
| `backend/src/routes/sessions/messages.ts` + `services/llm.ts` | 支持请求体携带 `llmConfig`（`runWithLlmConfig` / `parseLlmRuntimeConfig`），前端已有 `SettingsDialog` | ✅ 打包后用户可在应用内填 API Key，不必依赖 `.env` |
| `frontend/vite/pencil-assets.ts` | 构建期把 `canvaskit.wasm` 与字体同步进 `public/` | ✅ 产物 `frontend/dist/` 已含 7 MB wasm 与字体 |

### 1.2 实测环境

```
Windows (win32)  |  Node v22.22.2  |  pnpm 9.15.0
Electron 42.1.0  |  electron-vite 5.0.0  |  electron-builder 26.8.1  |  @electron/rebuild 4.0.4
frontend/dist 存在（含 index.html / assets / canvaskit.wasm）  |  backend/dist 存在
electron/out、electron/build、electron/release 均不存在  →  从未成功构建 / 打包过
```

> ⚠️ **文档漂移**：`AGENTS.md`、`docs/electron-guide.md` 写的是 Electron 33 / electron-vite 3 / electron-builder 25，实际 lockfile 是 42 / 5 / 26。实施时以 `package.json` + `pnpm-lock.yaml` 为准，并在 P4 阶段同步修订这两份文档，避免后续照着旧文档配错参数。

### 1.3 数据落盘位置（已实现，验证目标）

```
%APPDATA%/OpenPRD/
├── prd.db                 # SQLite（WAL 模式下还有 -wal / -shm）
├── prototypes/*.fig       # 原型设计文档
└── skills/                # 用户自定义 Skill（更新 / 卸载不丢）
```

---

## 二、阻塞项与成因（逐条）

### B1 / B2 / B5：`file://` 加载方案整体不成立

`frontend/src/` 下所有网络请求都是相对路径，没有任何 `baseURL` / `axios` 全局配置（guide 里写的 axios 方案并未落地）：

```
stores/sessions.ts         fetch("/api/sessions")
composables/useSSE.ts      fetch("/api/sessions/:id/messages")   // SSE
stores/prototypes.ts       fetch("/api/prototypes/:id")
pencil/app/ai/prdContext.ts fetch("/api/sessions/:id/prd/sections")
… 共 40+ 处
```

在 `file://.../index.html` 下，`/api/sessions` 会解析成 `file:///api/sessions` → 全部失败。同时 `createWebHistory()` 在 `file://` 下刷新子路由会去读 `file:///session/<uuid>`。`docs/electron-guide.md` 与 `AGENTS.md` 对此已有部分认知，但未给出可落地的统一解法。

### B3：backend 依赖进不了安装包

`electron/package.json` 只有 `devDependencies`。electron-builder 打包时只收集 **production dependencies**，所以 `backend`、`express`、`better-sqlite3`、`@langchain/*` 全都不会进 asar。而 `externalizeDepsPlugin()` 会把出现在 `dependencies` 里的包原样 externalize；`backend` 不在其中，Vite 会尝试从 workspace 源码把它 bundle 进主进程 —— 对 ESM（`backend/package.json` 有 `"type": "module"`）+ 大量 Node 依赖 + 原生模块的后端来说，这条路不可控。

另外 `backend/dist/index.js` 底部的自动启动判断：

```js
const isMain = process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts");
if (isMain) startServer();   // 端口默认 3000
```

主进程入口同样叫 `out/main/index.js`，存在误触发、额外监听 3000 并在错误目录建库的风险，需加显式守卫。

### B4：原生模块 ABI

`better-sqlite3` 的 `better_sqlite3.node` 是针对 Node ABI 编译的，Electron 42 用的是更高 ABI；且 `require()` 无法从 `app.asar` 里加载 `.node`。现有 `pnpm --filter electron rebuild` 指向的是 `electron/node_modules`，而那里根本没有 `better-sqlite3`（实测只有 4 个 devDependency 链接），命令目前是空跑。

### 其他中等项

| # | 问题 | 处理 |
| --- | --- | --- |
| M1 | `startServer()` 默认 `PORT ?? 3000`，且 `app.listen(port)` 监听所有网卡 | 主进程传 `0` 取随机端口；桌面模式绑定 `127.0.0.1`，避免局域网暴露本地数据接口 |
| M2 | 无 `electron/build/` 目录、无 `icon.ico` | 生成 ≥256×256 多尺寸 ico；NSIS / 窗口 / 任务栏图标都要用 |
| M3 | 打包后无 `backend/.env`；`dotenv/config` 会读 `cwd/.env`（安装目录只读且**绝不能**打包带密钥的 `.env`） | 主链路走应用内 `SettingsDialog` → `llmConfig`；系统环境变量兜底；`safeStorage` 加密持久化列为 P2 |
| M4 | PRD 图表脚本来自 `https://cdn.jsdelivr.net/npm`（`prd-runtime.js` 的 `CDN` 常量） | 离线环境图表不渲染。本期**不破坏** AGENTS.md 的"导出单文件 HTML 用 CDN"规范，仅记录为已知限制，本地化另立计划 |
| M5 | 原型编辑器里有 `@tauri-apps/api` 动态 import（字体 / 菜单），Electron 下会走失败分支 | 验收时确认有兜底且不阻塞画布渲染，必要时 P2 补 Electron 分支 |

---

## 三、核心方案选型：渲染层如何加载

| 方案 | 做法 | 评价 |
| --- | --- | --- |
| A. 保留 `file://` + preload 注入 API 基址 | 把 40+ 处 `fetch` 统一改成带 `window.electronAPI.getApiPort()` 前缀 | ❌ 侵入面大；路由 history、`file://` 下 wasm fetch 的 CORS 仍要各自单独处理；后续新增接口容易漏改 |
| B. 注册自定义协议 `app://` | `protocol.handle` 同时分发静态文件与 `/api/*` | ⚠️ 架构干净，但自定义 scheme 下 SSE、CSP、相对路径与 Chromium 的 fetch 行为有较多坑，调试成本高 |
| **C. 本地 HTTP 同源托管（采用）** | Express 在 `127.0.0.1:<随机端口>` 上**同时**提供 `/api/*` 与 `frontend/dist` 静态文件 + SPA fallback；`BrowserWindow.loadURL("http://127.0.0.1:<port>/")` | ✅ 前端业务代码零改动；`/api/...` 自动同源；`createWebHistory` 由 SPA fallback 支撑；CanvasKit `/canvaskit.wasm`、字体、SSE 全部正常；改动集中在 `backend/src/index.ts` + `electron/src/main/index.ts` |

**采用方案 C。** 运行时拓扑：

```
┌─ Electron 主进程 (out/main/index.js, CJS) ────────────────────────┐
│  1. app.isPackaged → 注入 DATA_DIR / DB_PATH / USER_SKILLS_DIR     │
│     / STATIC_DIR / OPENPRD_EMBEDDED=1                              │
│  2. await import(pathToFileURL(<resources>/backend/dist/index.js))  │
│  3. startServer(0) → { port }                                      │
│  4. new BrowserWindow().loadURL(`http://127.0.0.1:${port}/`)       │
└───────────────────────────────────┬───────────────────────────────┘
                                    │ 同一进程内的 Express
        ┌───────────────────────────┴───────────────────────────┐
        │  /health          健康检查                             │
        │  /api/sessions/*  PRD 对话 / SSE / 版本 / 章节编辑      │
        │  /api/modules/*   /api/prototypes/*                    │
        │  /assets/*, /canvaskit.wasm, /favicon.ico  → express.static │
        │  其余 GET (Accept: text/html) → index.html (SPA fallback)│
        └───────────────────────────┬───────────────────────────┘
                                    ▼
                 BrowserWindow 渲染进程（禁用 nodeIntegration）
```

### 3.1 一个必须配套的改动：`vite base`

`frontend/vite.config.ts` 目前是 `base: "./"`，AGENTS.md 明确写着"**`base: "./"` 不能改回 `/`**"，理由是 Electron 用 `file://` 加载时根绝对路径会落到文件系统根目录。**这条约束只对 `file://` 成立**；方案 C 改用 HTTP 后，`"./"` 反而会在 SPA 深链刷新时把 `./assets/...` 解析成 `/session/assets/...` → 404 白屏。

因此增加一个**构建期开关**，而不是改默认值：

```ts
// frontend/vite.config.ts（约 1 行）
base: process.env.ELECTRON_BUILD === "1" ? "/" : "./",
```

- Web 开发 / Web 部署：不设该变量，行为完全不变（`./`）。
- Electron 构建：由 `scripts/build-win-exe.mjs` 设置 `ELECTRON_BUILD=1`，产出 `base: "/"`，深链刷新、CanvasKit 的 `/canvaskit.wasm` 均正确。

> 若后续希望 Web 版也用单一产物，可评估统一改 `/`；本期以"不破坏 Web 模式"为优先，采用开关。

### 3.2 `get-api-port` IPC 的处置

保留 preload 的 `getApiPort()`（无需删），但前端不再依赖它拼接 URL。可作为"桌面模式探测"与日志用途保留；`window.electronAPI` 的类型声明补进 `frontend/src/types/` 或 `frontend/src/pencil/global.d.ts`（当前无声明，TS 严格模式下若使用会报错）。

---

## 四、分阶段实施计划

### P0 · 基线核对与开发态冒烟

**目标**：确认现有骨架在 dev 模式能起窗，锁定版本，建立回滚基线。

- 对齐 `AGENTS.md` / `docs/electron-guide.md` 中 Electron 版本描述与 lockfile（仅记录差异，文档修订放 P4）。
- 跑通 `pnpm --filter frontend dev` + `pnpm --filter backend dev` + `pnpm --filter electron dev`；`pnpm --filter electron typecheck` / `pnpm typecheck` / `pnpm lint` 全绿。
- 在 `package.json` 根脚本区预留 `dist:win` 入口（先不接线）。
- **验收**：Electron 开发窗口能加载首页；记录当前 `process.argv[1]` 实际值，确认 `isMain` 是否误触发。

### P1 · 渲染层同源托管 + 主进程改造

**改动文件**：`backend/src/index.ts`、`frontend/vite.config.ts`、`electron/src/main/index.ts`、`electron/src/preload/index.ts`（可选）

**backend/src/index.ts 要点**

1. `startServer(port?: number)` 增加可选 `host`（默认 `127.0.0.1` 仅当 `OPENPRD_EMBEDDED=1`；Web 模式保持原行为）。
2. `createApp()` 在读 `process.env.STATIC_DIR` 时挂载静态资源，**顺序在全部 `/api` 路由之后**：
   ```
   express.static(staticDir, { index: false })
   → GET + Accept text/html + 非 /api 前缀 → res.sendFile(index.html)
   ```
   避免 fallback 吞掉接口的 404。
3. 自动启动判断改为 `if (isMain && !process.env.OPENPRD_EMBEDDED)`，或更严谨地用 `fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")` 比较；两者叠加最稳。
4. 可选：导出 `stopServer()`，在 `before-quit` 中 `server.close()`，避免退出时留半开连接。

**electron/src/main/index.ts 要点**

1. `app.requestSingleInstanceLock()` 单实例；第二实例 `second-instance` 事件聚焦已有窗口。
2. 注入 `STATIC_DIR = join(process.resourcesPath, "frontend/dist")`、`OPENPRD_EMBEDDED=1`；**保留**现有 `DATA_DIR` / `DB_PATH` / `USER_SKILLS_DIR` 与 Skill 迁移逻辑。
3. backend 用绝对路径动态导入，不再走包解析：
   ```ts
   const entry = app.isPackaged
     ? join(process.resourcesPath, "backend", "dist", "index.js")
     : join(__dirname, "../../backend/dist/index.js");
   const { startServer } = await import(pathToFileURL(entry).href);
   const apiPort = await startServer(0);   // 0 → 系统分配空闲端口
   ```
4. 生产环境 `win.loadURL("http://127.0.0.1:" + apiPort + "/")`；开发环境保留 `loadURL("http://localhost:5173")`。删除错误的 `win.loadFile(...)`。
5. `show: false` + `ready-to-show` 再显示；设置 `minWidth/minHeight`、`title`、`icon`；`did-fail-load` / `unhandledRejection` 写日志到 `userData/logs/main.log`（不新增依赖，用 `node:fs`）。
6. 启动失败要有可见反馈（`dialog.showErrorBox`），不许静默白屏。

**验收**：`pnpm --filter electron build` 后手工用 `electron .` 以非打包态连真实 `backend/dist` 起窗；首页 → 新建会话 → SSE 对话 → PRD 生成 → F5 刷新 `/session/:id` → 打开 `/prototype/:id` 看 CanvasKit 画布，全部通过。

### P2 · 后端自包含部署 + 原生模块 ABI

**目标**：让 `<resources>/backend/` 是一个能独立 `require`/`import` 的目录，彻底绕开 pnpm 符号链接与 asar。

**采用 `pnpm deploy`**（`backend/package.json` 的依赖全是外部包、无 workspace 依赖，deploy 无需额外的 inject 配置）：

```bash
pnpm --filter backend build
pnpm --filter backend deploy --prod .packaging/backend
```

产出：

```
.packaging/backend/
├── dist/                 # backend/dist 全量（含 services/prd/runtime/*.js、*.css）
├── node_modules/         # 真实展开的生产依赖（express、langchain、better-sqlite3 …）
└── package.json
```

**原生模块重编译**：把 `@electron/rebuild` 指向部署目录，而不是 `electron/node_modules`：

```bash
# 用 @electron/rebuild 的 Node API，写在 scripts/build-win-exe.mjs 里
electronRebuild({ buildPath: ".packaging/backend", electronVersion: "42.1.0", arch: "x64", force: true })
```

优先命中 `better-sqlite3` 的 Electron prebuild；若需源码编译，前置条件是 Windows 上装有 VS Build Tools（MSVC）+ Python，且需联网下载 Electron headers。打包配置里设 `npmRebuild: false` / `nodeGypRebuild: false`，禁止 electron-builder 用 Node ABI 又编一遍。

**为什么 `.node` 不用 asarUnpack**：整个 `<resources>/backend/` 都通过 `extraResources` 放在 asar 之外，原生模块天然可读。

**路径自洽性复核**：`skillDirs.ts` 的 `BUILTIN_SKILLS_ROOT` 从 `<resources>/backend/dist/services` 上溯三级得到 `<resources>/skills`，与 `extraResources.to: skills/` 完全一致 —— **无需改后端任何路径逻辑**。

**验收**（打包前先做）：在 `.packaging/backend/` 目录下用 Electron 的 Node 运行时执行 `node -e "import('./dist/index.js').then(...)"`，确认 `better-sqlite3` 能加载、能建表；对比 `process.versions.modules` 与 `.node` 的 ABI。

### P3 · Windows exe 打包配置与资源

**改动文件**：`electron/electron-builder.yml`、`electron/build/icon.ico`（新增）、`.gitignore`

关键配置（在现有文件上改造）：

```yaml
appId: com.donjet.open-prd
productName: OpenPRD
directories:
  buildResources: build
  output: release/${version}
files:
  - out/**/*
  - "!out/**/*.map"
extraResources:
  - from: ../.packaging/backend/     # 自包含后端（含 node_modules）
    to: backend/
  - from: ../frontend/dist/          # ELECTRON_BUILD=1 产物
    to: frontend/dist/
  - from: ../skills/                 # 内置 Skill（只读）
    to: skills/
npmRebuild: false
nodeGypRebuild: false
win:
  icon: build/icon.ico
  target:
    - target: nsis
      arch: [x64]
    - target: portable
      arch: [x64]
  requestedExecutionLevel: asInvoker
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  perMachine: false                  # 用户级安装，不弹 UAC
  createDesktopShortcut: true
  shortcutName: OpenPRD
  deleteAppDataOnUninstall: false    # 关键：卸载保留 %APPDATA%/OpenPRD/prd.db
portable:
  artifactName: OpenPRD-Portable-${version}.exe
publish: null                        # 本期不做自动更新
```

- **图标**：从 `frontend/public/favicon.svg` 生成 ≥256×256 的多尺寸 `icon.ico`（含 16/32/48/64/128/256），放 `electron/build/icon.ico`；electron-builder 对 ico 尺寸有硬性要求，缺文件会直接构建失败。
- **两种 exe**：`nsis` → `OpenPRD Setup <version>.exe`（安装版，默认）；`portable` → `OpenPRD-Portable-<version>.exe`（单文件免安装，数据落 `%APPDATA%` 或临时目录，需实测确认 portable 模式的 userData 路径）。
- **不打包 `.env`**：`extraResources` 严格白名单，构建脚本末尾校验产物中不含 `.env` / `*.db` / `skills/skill-custom-*` 用户数据。
- `.gitignore` 追加 `.packaging/`、`electron/release/`、`electron/build/*.ico`（若图标改为生成物）。
- **代码签名**：本期默认不签；无 EV/OV 证书时 Windows SmartScreen 会提示"未知发布者"，需在交付说明中写明。若后续有证书，加 `win.certificateFile` / `certificatePassword` 与 `signtoolOptions`。

### P4 · 一键构建脚本、验收与文档同步

**新增** `scripts/build-win-exe.mjs`（Node 脚本，内部全部 `spawnSync("pnpm", ...)`，遵守 pnpm only）：

```
1. 环境校验：process.platform === "win32"、pnpm 可用、Node ≥ 20
2. 清理 .packaging/backend 与 electron/release/<version>
3. 并行构建：
     ELECTRON_BUILD=1 pnpm --filter frontend build
     pnpm --filter backend build
     pnpm --filter electron build
   （frontend 的 env 只在本次构建生效，Web 构建不受影响）
4. pnpm --filter backend deploy --prod .packaging/backend
5. electronRebuild 针对 .packaging/backend（Electron 42.1.0 / x64）
6. 清理 .d.ts / .map / 无用 runtime 文件以减小体积（可选）
7. pnpm --filter electron exec electron-builder --win --x64
8. 打印 electron/release/<version>/*.exe 清单 + 体积 + SHA-256，
   并校验产物不含 .env / *.db
```

**根 `package.json`** 新增：

```json
"dist:win": "node scripts/build-win-exe.mjs"
```

**文档同步**：更新 `AGENTS.md` 的「桌面打包」版本表、「已知未完成项」中的 `createWebHistory` 条目、`base: "./"` 约束说明；重写 `docs/electron-guide.md`（当前是旧版骨架说明，且 axios 段落与代码不符）；在 `docs/` 补一份面向使用者的安装 / 首次配置 API Key / 数据备份说明。

---

## 五、改动文件清单

| 文件 | 动作 | 阶段 |
| --- | --- | --- |
| `backend/src/index.ts` | 改：静态托管 + SPA fallback、回环绑定、嵌入态自动启动守卫、可选 `stopServer()` | P1 |
| `frontend/vite.config.ts` | 改：1 行 `ELECTRON_BUILD` base 开关 | P1 |
| `frontend/src/types/*.d.ts`（或 `pencil/global.d.ts`） | 增：`window.electronAPI` 类型声明 | P1（可选） |
| `electron/src/main/index.ts` | 改：env 注入、绝对路径导入 backend、随机端口、`loadURL`、单实例、日志、错误弹窗 | P1 |
| `electron/src/preload/index.ts` | 保留（可补类型） | P1 |
| `electron/package.json` | 改：`dist:win` 脚本、`rebuild` 指向部署目录 | P2 / P4 |
| `electron/electron-builder.yml` | 改：`extraResources` 指向 `.packaging/backend`、Windows 双 target、NSIS、图标、禁用自动 rebuild | P3 |
| `electron/build/icon.ico` | 新增 | P3 |
| `scripts/build-win-exe.mjs` | 新增 | P4 |
| `package.json`（根） | 改：`dist:win` | P4 |
| `.gitignore` | 改：忽略 `.packaging/`、`electron/release/` | P3 |
| `AGENTS.md`、`docs/electron-guide.md` | 改：版本对齐、架构说明、安装说明 | P4 |
| `docs/plan-windows-exe-packaging.md` | 本文档 | — |

**明确不改**：`packages/*`（原型引擎）、`frontend/src/stores|composables|views`（业务请求代码）、`backend/src/db/*` 与 `skillDirs.ts` / `prototypeStore.ts`（路径注入已就绪）。

---

## 六、打包后的目录布局（验收对照）

```
C:\Program Files\OpenPRD\  (或用户选择的安装目录)
├── OpenPRD.exe
├── resources\
│   ├── app.asar                  # out/main + out/preload + electron/package.json
│   ├── backend\
│   │   ├── dist\index.js         # 主进程用 pathToFileURL 动态 import
│   │   ├── dist\services\prd\runtime\…
│   │   └── node_modules\         # 含按 Electron ABI 编译的 better_sqlite3.node
│   ├── frontend\dist\            # index.html + assets + canvaskit.wasm + 字体
│   └── skills\                   # 内置 Skill（只读）
└── locales\ …                    # Electron 运行时

%APPDATA%\OpenPRD\                # 用户数据（卸载 / 覆盖安装不删）
├── prd.db (+ -wal / -shm)
├── prototypes\*.fig
├── skills\skill-custom-*
└── logs\main.log
```

---

## 七、验收清单

### 7.1 构建期

- [ ] `pnpm dist:win` 在**干净的 clone + `pnpm install`** 后一次跑通，退出码 0
- [ ] 产出 2 个 exe：NSIS 安装版 + portable 版；记录体积与 SHA-256
- [ ] `asar list app.asar` 中不含 `.env` / `*.db` / 用户 `skill-custom-*`
- [ ] `.packaging/backend/node_modules/better-sqlite3/build/Release/better_sqlite3.node` 的 ABI 与 Electron 42 一致
- [ ] `pnpm lint` / `pnpm typecheck` 仍全绿；`pnpm dev` Web 模式无回归

### 7.2 全新机器运行期（无 Node / 无 pnpm / 无源码）

- [ ] 安装 exe → 桌面快捷方式 → 启动**无白屏、无黑框**，窗口标题 / 图标正确
- [ ] 首页 → 新建会话 → 打开设置填 API Key → 发送消息 → **SSE 流式输出**正常
- [ ] 生成完整 PRD：8 个 Tab、Mermaid / markmap 图表渲染（联网时）
- [ ] 章节 AI 编辑、版本新建 / 切换 / 复制 / 删除
- [ ] 打开 `/prototype/:id`：CanvasKit 画布加载、图层树、保存并重新打开 `.fig`
- [ ] F5 刷新 `/session/:id` 与 `/prototype/:id` 不白屏（验证 SPA fallback + `base: "/"`）
- [ ] 导出 HTML / Markdown / PDF / DOCX
- [ ] 关闭 → 重启：会话、PRD、原型数据仍在 `%APPDATA%/OpenPRD/prd.db`
- [ ] 覆盖安装升级到新版本：数据不丢；卸载：userData 保留
- [ ] 断网启动：应用可打开（图表提示 CDN 不可用的已知限制，其余功能不依赖外网）
- [ ] 任务管理器：无残留独立 node 进程；同时只运行一个实例
- [ ] `logs/main.log` 无未捕获异常；`process.argv[1]` 未触发 backend 二次启动

---

## 八、风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| `pnpm deploy` 在 pnpm 9.15 对 workspace 有额外要求 | P2 卡住 | backend 无 workspace 依赖，风险低；若提示需 `--legacy` 或 `inject-workspace-packages=true`，按提示加参数并在脚本里固定；兜底方案：写脚本复制 `backend/dist` + `pnpm --filter backend list --prod --json` 解析后复制依赖目录 |
| better-sqlite3 无对应 Electron 42 prebuild，需源码编译 | 构建机需 MSVC + Python + 联网 | 构建脚本前置检测工具链并给出明确报错；备选改用 `prebuild-install --runtime=electron --target=42.1.0`；最坏情况下在 CI 镜像里预置编译产物 |
| Electron 42 / electron-vite 5 / builder 26 与旧文档不符 | 照旧文档配参数出错 | P0 锁定 lockfile 版本，P4 修订文档；升级 Electron 大版本单独评估，不在本期做 |
| `base: "/"` 影响 Web 部署 | Web 版子路径部署失效 | 用 `ELECTRON_BUILD` 开关隔离，Web 默认 `./` 不变；`pnpm build` 或 `pnpm dev` 不设该变量 |
| 端口 / 单实例冲突 | 双开导致 SQLite 争用 | `startServer(0)` 随机端口 + `requestSingleInstanceLock()` + 回环绑定 |
| CDN 离线导致图表空白 | 内网用户看到的 PRD 缺图 | 本期记录为已知限制；后续单独立项：把 mermaid / markmap / d3 打进 `frontend/dist/vendor/`，**导出 HTML 仍用 CDN** 以遵守 AGENTS.md 单文件规范，桌面预览改本地脚本 |
| 无代码签名触发 SmartScreen / 杀软误报 | 首次安装被拦 | 交付说明中提前告知；拿到证书后按 P3 备注接入 |
| NSIS 安装路径含中文 / 空格、node_modules 深层路径过长 | 安装或运行时路径解析失败 | 安装目录默认用户级；实测中文用户名路径；必要时开启 `win.longPaths` 提示 |
| `.env` 密钥被误打进包 | 密钥泄露 | `extraResources` 严格白名单 + 构建脚本末尾扫描产物并 fail-fast |

---

## 九、本期明确不做（Out of Scope）

- macOS / Linux 打包（配置可保留，但不在本期验收）
- 代码签名、自动更新（`electron-updater`）、崩溃上报
- 把 backend 拆成独立子进程 / 引入 PM2（当前与 Web 模式共用同进程 Express 是刻意设计）
- PRD 图表 CDN 本地化、离线全功能
- 前端请求层大规模重构、Vue Router 改 hash 模式
- `packages/*` 原型引擎任何改动

---

## 十、默认假设与待确认项

写计划时按以下假设推进，**若有不同请指出，会影响 P3 配置与验收范围**：

1. 交付形态：**同时产出 NSIS 安装版 + portable 单文件版**（都是 `.exe`）。若只要其中一种，删掉对应 target。
2. 应用名沿用 `OpenPRD`、`appId: com.donjet.open-prd`、版本跟随 `electron/package.json` 的 `0.1.0`。
3. 图标基于 `frontend/public/favicon.svg` 生成；如需正式品牌图标，请提供 `icon.ico` / 高分辨率 PNG。
4. 本期**不要求完全离线可用**（LLM 调用本身就需要网络），图表 CDN 缺失作为已知限制记录。
5. Web 部署能力必须保留，因此 `frontend/vite.config.ts` 采用构建期开关，不直接把 `base` 改成 `/`。
6. 构建在 Windows x64 本机执行；CI 打包（GitHub Actions `windows-latest`）不在本期范围。
