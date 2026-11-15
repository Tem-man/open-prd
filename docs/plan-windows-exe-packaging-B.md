# 方案：打包 Windows 桌面端应用（.exe）

> 目标：把 open-prd 打成一个可分发的 **Windows x64 安装包（NSIS Setup .exe）**，双击安装后离线可用；数据（SQLite、原型 .fig、用户 Skill、LLM 配置）全部落在用户目录，升级/卸载不丢。

---

## 一、背景与现状盘点

### 已有基础（`electron/` workspace 包骨架已就位）

| 项 | 现状 | 位置 |
| --- | --- | --- |
| 主进程 | 已内嵌启动 backend：`await import("backend")` → `startServer()` 拿端口后开 `BrowserWindow` | `electron/src/main/index.ts` |
| 预加载 | `contextBridge` 暴露 `getApiPort` IPC（渲染层目前**并未使用**） | `electron/src/preload/index.ts` |
| electron-vite | 仅构建 main + preload（渲染进程由 frontend 独立构建） | `electron/electron.vite.config.ts` |
| electron-builder | `appId com.donjet.open-prd`，win 目标 `nsis x64`，extraResources 已含 frontend/dist、backend/dist、skills | `electron/electron-builder.yml` |
| 数据落盘 | backend 已支持 `DB_PATH` / `DATA_DIR` / `USER_SKILLS_DIR` 环境变量注入，主进程已把 userData 写入这些变量，并有旧版用户 Skill 迁移逻辑 | `backend/src/db/client.ts`、`prototypeStore.ts`、`skillDirs.ts` |
| 前端资源路径 | `vite.config.ts` 已设 `base: "./"`（兼容非根路径加载，canvaskit.wasm 随 dist 提供） | `frontend/vite.config.ts` |

> 版本说明：实际安装的工具链是 `electron ^42` + `electron-vite ^5` + `electron-builder ^26.8`（`electron/package.json`），**高于** AGENTS.md 里写的 Electron 33 / electron-vite 3 / builder 25。本方案以实际版本为准，完成后同步更新 AGENTS.md。

### 关键缺口（打包必然踩坑，本方案逐项解决）

| # | 缺口 | 后果 |
| --- | --- | --- |
| G1 | `electron/package.json` **没有依赖 `backend`**；且 `import("backend")` 用裸包名，打包后 asar 内无 node_modules | 打包后启动即 `Cannot find module 'backend'` |
| G2 | backend 的**生产依赖**（express、@langchain/*、better-sqlite3 等）完全没进包：extraResources 只拷 `backend/dist` | 即使解析到入口，运行时也起不来 |
| G3 | pnpm 的 `node_modules` 是 `.pnpm` 符号链接结构，直接拷贝进安装包不可靠 | 依赖缺失/体积失控 |
| G4 | `better-sqlite3` 是原生模块，必须按 **Electron ABI** 重编译 | `NODE_MODULE_VERSION mismatch` 崩溃 |
| G5 | 前端所有请求是根相对 `fetch('/api/...')`，dev 靠 Vite proxy；打包后 `loadFile(file://)` 下 `/api` 无法解析 | 页面能开、接口全挂 |
| G6 | backend 入口 `import "dotenv/config"` 读 cwd 的 `.env`，打包后不存在；LLM Provider/Key 无来源 | Agent 无法调用模型 |
| G7 | `directories.buildResources: build` 但 `electron/build/` 目录**不存在**（无 icon.ico） | 打包报错或无图标 |
| G8 | 根 `package.json` 无一键打包编排脚本；frontend 版本号 0.0.0 与 electron/backend 0.1.0 不一致 | 构建顺序靠人肉 |

---

## 二、技术选型

### 2.1 渲染进程如何访问 `/api`（核心决策）

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| A. **自定义特权协议 `app://` + `protocol.handle` 转发** | 窗口加载 `app://local/index.html`；静态文件从 frontend/dist 读出返回，`/api/**` 用 `net.fetch` 转发到 `http://127.0.0.1:<port>` | ✅ **选此**：前端零改动（`base:'./'` + 根相对 `/api` 天然匹配 standard scheme）；SSE/大文件上传可透传；无跨域/CSP 问题 |
| B. 前端全局注入 API base（改所有 fetch 为绝对地址） | 需要动 40+ 处 fetch 或包一层 apiBase | ❌ 侵入面大，且 SSE 在 file:// 下问题多 |
| C. `webRequest.onBeforeRequest` 重定向 `/api` → `http://127.0.0.1:port` | 配合 file:// 使用 | ❌ file:// 页面发 http 请求属混合内容，行为不稳定 |

方案 A 前提：`registerSchemesAsPrivileged` 声明 `standard: true, secure: true, supportFetchAPI: true, stream: true`（stream 保证 SSE 逐块到达）。Electron 42 的 `protocol.handle` + `net.fetch` 原生支持流式 Response 与请求体透传（multipart .fig 上传 50MB 亦覆盖）。

> 采用方案 A 后，`preload` 的 `getApiPort` IPC 保留作调试用途，前端不需要感知端口。

### 2.2 backend 如何进包（G1/G2/G3/G4）

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| A. **`pnpm deploy` 产出自包含 backend 运行目录**，作为 extraResources 放在 asar 外 | `pnpm --filter=backend deploy` 会把符号链接结构展开成普通目录 + 生产依赖 node_modules；再对产物跑 electron-rebuild | ✅ **选此**：标准、可靠、backend 构建产物零改动（tsc 输出的相对 import 会向上找到同目录 node_modules） |
| B. esbuild 把 backend 全量 bundle 成单文件（原生模块 external） | 体积更小，但 @langchain 生态动态 import/资源文件多，试错成本高 | ❌ 暂不选，留作后续体积优化 |
| C. backend 作为 electron 的 workspace 依赖进 asar | 需要处理 asar 内原生模块加载与整棵 pnpm 依赖树拷贝 | ❌ 复杂度更高 |

运行目录结构（安装后）：

```
<安装目录>/resources/
├── app.asar                    # 仅 electron 主/preload（out/）
├── frontend/dist/              # 静态渲染层（含 canvaskit.wasm、字体）
├── backend-runtime/            # pnpm deploy 产物 + dist 拷贝
│   ├── package.json
│   ├── dist/                   # backend tsc 构建输出
│   └── node_modules/           # 生产依赖（better-sqlite3 已按 Electron ABI 重编译）
└── skills/                     # 内置 Skill（只读）
```

主进程按**文件路径**而非裸包名加载 backend，dev/prod 分流（解决 G1）：

```ts
// electron/src/main/index.ts（关键改动示意）
import { pathToFileURL } from "node:url";
import { registerSchemesAsPrivileged, protocol, net } from "electron";

const backendEntry = app.isPackaged
  ? pathToFileURL(join(process.resourcesPath, "backend-runtime/dist/index.js")).href
  : "backend"; // dev：走 electron/node_modules 里的 workspace 链接
const { startServer } = await import(backendEntry);
```

dev 分支要成立，需要 `electron/package.json` 增加 `"backend": "workspace:^"` 依赖（仅 dev 需要解析；打包不依赖该链接）。

### 2.3 LLM 配置与 API Key（G6）

分两步走，第一阶段零 UI：

1. **阶段一（本方案范围内）**：主进程在 `import(backendEntry)` **之前**设置
   `process.env.DOTENV_CONFIG_PATH = join(userData, ".env")`
   —— backend 入口的 `import "dotenv/config"` 会从该路径读取，用户把 `backend/.env.example` 的内容拷到 `%APPDATA%/OpenPRD/.env` 即可，格式与开发模式完全一致。
2. **阶段二（后续独立 plan）**：应用内「设置 → 模型服务」表单，`safeStorage` 加密写系统钥匙串，主进程启动时注入 `process.env`。同时透传系统级 `OPENAI_API_KEY` 等环境变量作回退。

> 顺序至关重要：dotenv 在 backend 模块加载时执行，所有 env 注入必须在动态 import 之前完成。

---

## 三、实施步骤

### 阶段 0：依赖与构建基线修复

1. `electron/package.json`：
   - `devDependencies` 增加 `"backend": "workspace:^"`；
   - 脚本调整：`deploy:backend`（见阶段 2）、`rebuild` 改为对 deploy 产物执行（见阶段 2）；
   - `name` 改为 `open-prd-desktop`（当前叫 `electron`，避免与包名混淆）。
2. 版本统一：root / electron / backend / frontend 全部对齐 `0.1.0`。
3. 确认 `pnpm --filter frontend build`、`pnpm --filter backend build`、`pnpm --filter electron build` 三者可独立成功（这是打包前置条件）。

### 阶段 1：`app://` 协议与 `/api` 转发（先在 dev 打通，前端零改动）

1. `registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }])` —— 必须在 app ready **之前**调用。
2. `protocol.handle("app", handler)`：
   - `app://local/api/**` → `net.fetch("http://127.0.0.1:" + port + path, { method, headers, body })` 原样透传（含 SSE 响应流与上传 body）；
   - 其余路径 → 从 `<resources>/frontend/dist`（prod）或磁盘 dev 目录读取文件，按扩展名给 MIME；**无扩展名或未命中 → 返回 index.html**（SPA 深链兜底：session/prototype 路由刷新）；
   - `Range` 请求（字体/wasm 大文件）直接透传磁盘文件流。
3. `createWindow`：生产环境从 `win.loadURL("app://local/index.html")` 加载（替换现有 `loadFile`）；dev 保持 `http://localhost:5173`（Vite proxy 继续 handles `/api`）。
4. 验证点：dev 下 `pnpm --filter electron dev` + 前后端，页面正常；用 `win.loadURL("app://local/index.html")` 走读磁盘 dist 的方式预演生产路径。

### 阶段 2：backend 运行时打包（deploy + 原生模块重编译）

1. 新脚本（electron 包内）：
   ```jsonc
   "deploy:backend": "node scripts/deploy-backend.mjs",
   "rebuild": "electron-rebuild -f -w better-sqlite3 --project-dir .deploy/backend-runtime"
   ```
2. `scripts/deploy-backend.mjs` 流程：
   - `pnpm --filter=backend deploy --prod .deploy/backend-runtime`（在 workspace root 语义下执行，产物为无符号链接的普通目录）；
   - 拷贝 `backend/dist` → `.deploy/backend-runtime/dist`（含 `services/prd/runtime` 静态资源，现有 build 脚本已处理）；
   - 排除 `*.map`、测试文件，控制体积。
3. 原生模块：`pnpm --filter electron rebuild`（electron-rebuild 以 electron 包内安装的 electron 42 ABI 编译 deploy 产物里的 better-sqlite3）。执行顺序固定为 **build → deploy → rebuild**。
4. `electron-builder.yml` 调整：
   ```yaml
   extraResources:
     - from: .deploy/backend-runtime/
       to: backend-runtime/
     - from: ../frontend/dist/
       to: frontend/dist/
     - from: ../skills/
       to: skills/
   ```
   （backend 走 `.deploy` 产物而不是 `../backend/dist`；better-sqlite3 位于 asar 外，无需 asarUnpack。）
5. 主进程 `backendEntry` 改为 `<resources>/backend-runtime/dist/index.js`（见 2.2 代码示意）。

### 阶段 3：配置注入与启动健壮性

1. env 注入顺序（全部在动态 import backend 之前）：
   - `DOTENV_CONFIG_PATH = <userData>/.env`（G6 阶段一方案）；
   - 已有：`DATA_DIR`、`DB_PATH`、`USER_SKILLS_DIR` + 旧 Skill 迁移逻辑（保留不动）；
   - `NODE_ENV=production`。
2. 首次启动体验：检测 `<userData>/.env` 不存在时，拷贝一份模板（含中文注释说明各变量），并在窗口加载后前端可提示（最简：console + 文档说明，不做 UI）。
3. 健壮性：
   - `app.requestSingleInstanceLock()` 单实例（第二实例聚焦已有窗口）；
   - `startServer()` 失败 → 打开错误页窗口（静态 HTML 展示错误信息 + 日志路径），而非静默白屏；
   - 主进程 console 重定向到 `<userData>/logs/main.log`（排障用，简单 fs append 即可，不引 electron-log）；
   - `window-all-closed` 退出前无需手动关 Express（进程随主进程结束）。
4. 窗口细节：`title: "OpenPRD"`、约 1280×800（现状保留）、后续可按需 minSize。

### 阶段 4：图标、NSIS 与一键脚本

1. `electron/build/`（buildResources）：
   - `icon.ico`（256×256 多尺寸，含 32/48/256）；
   - `installerIcon.ico`、`uninstallerIcon.ico`（可复用 icon.ico）；
   - 可选 `installerSidebar.bmp`（164×314）。
   > 图标素材由用户/设计提供，或后续用图片生成工具产出 1024 PNG 再转 ico。
2. NSIS 细节（`electron-builder.yml`）：
   ```yaml
   nsis:
     oneClick: false
     allowToChangeInstallationDirectory: true
     perMachine: false                 # 默认 per-user，免管理员权限
     artifactName: ${productName}-Setup-${version}.${ext}
     shortcutName: ${productName}
     deleteAppDataOnUninstall: false   # 卸载默认保留用户数据（现默认即如此，显式声明）
   ```
3. 根 `package.json` 一键命令：
   ```jsonc
   "dist:win": "pnpm --filter frontend build && pnpm --filter backend build && pnpm --filter electron build && pnpm --filter electron deploy:backend && pnpm --filter electron dist -- --win"
   ```
   （electron 包 `dist` 脚本对 win 而言默认 x64 nsis；产物在 `electron/release/<version>/OpenPRD-Setup-0.1.0.exe`。）
   > 提示：`pnpm deploy` 会重置 `.deploy/backend-runtime`，全流程必须按固定顺序执行，避免旧产物/旧 ABI 混入。
4. 用户要求「格式是 exe」：NSIS 安装器本身即 `.exe`，满足需求；如需免安装绿色版，后续追加 `portable` target 一行即可（本方案不做）。

### 阶段 5：验收（冒烟清单）

- [ ] `pnpm dist:win` 全流程一次成功，产物体积合理（预估 250–400MB，主要是 node_modules 与 wasm/字体）
- [ ] 安装 → 启动 → 首页正常渲染，canvaskit/字体加载无 404（查看 DevTools Network）
- [ ] 新建会话 → 发消息 → PRD 生成（配好 `.env` 后全链路，SSE 流式逐字输出）
- [ ] 模块管理 / Skill 编辑 / 历史会话 / 版本回滚均可用
- [ ] 原型编辑器可打开、画布可编辑、`.fig` 保存后重启仍存在（落 userData）
- [ ] SQLite 落在 `%APPDATA%/OpenPRD/prd.db`；用户 Skill 落 `%APPDATA%/OpenPRD/skills/`
- [ ] 升级安装（覆盖装新版）后数据保留；卸载后 `%APPDATA%/OpenPRD` 保留
- [ ] 单实例：二次启动聚焦已有窗口
- [ ] 无 `.env` 时应用可启动，Agent 调用时给出可读错误（不崩溃）

---

## 四、风险与注意事项

| 风险 | 应对 |
| --- | --- |
| `require`/`import` ESM 兼容：electron-vite 默认把 main 构建为 CJS，`import("backend")` 会被转成 require；backend 是 ESM 包 | Electron 42 内置 Node ≥22.12，`require(esm)` 默认可用；若仍出问题，把 electron 包 `"type": "module"` 让 main 输出 ESM（electron-vite 5 支持），plan 中预留此回退 |
| `pnpm deploy` 在部分 pnpm 版本要求 `inject-workspace-packages` 配置 | backend 无 workspace 内部依赖，直接可用；执行报错时按提示在 `pnpm-workspace.yaml` 打开该开关 |
| `protocol.handle` 的 SSE 透传 | privileges 已加 `stream: true`；冒烟阶段重点验证逐 token 输出与「停止生成」 |
| better-sqlite3 ABI：每次升级 Electron 版本都必须重跑 rebuild | 把 rebuild 固化进 `deploy:backend` 后的流水线，文档化顺序 |
| `.env` 明文存 Key | 阶段一接受（本地个人工具定位），阶段二 safeStorage 收敛；文档注明风险 |
| 体积 | 先不优化；后续可评估 esbuild bundle backend、删 `*.map`、排除未用语言资源 |
| 前端 `@tauri-apps/api` 依赖仍在 frontend/package.json | 与 Electron 方案无关的死依赖，本方案顺手移除（确认无调用后） |

---

## 五、交付物清单

| 文件 | 动作 |
| --- | --- |
| `electron/src/main/index.ts` | 改：app:// 协议、backend 文件路径加载、env 注入、单实例、错误兜底、日志 |
| `electron/electron-builder.yml` | 改：extraResources 指向 deploy 产物、nsis 细节、图标 |
| `electron/package.json` | 改：backend workspace 依赖、deploy/rebuild/dist 脚本、name、版本 |
| `electron/scripts/deploy-backend.mjs` | 新增：pnpm deploy + dist 拷贝 + 清理 |
| `electron/build/icon.ico` 等 | 新增：图标资源 |
| 根 `package.json` | 改：`dist:win` 一键脚本、版本对齐 |
| `AGENTS.md` | 改：Electron 版本记录（42/5/26.8）与打包命令说明 |
| 本文档 | 交付后按实际实现回填差异 |

---

## 六、建议实施顺序（工作量预估）

1. 阶段 0 + 2（打包能出 exe，但页面接口不通）——先验证最硬的 G1–G4
2. 阶段 1（app:// 协议，接口通）——核心体验闭环
3. 阶段 3（配置 + 健壮性）——可用性达标
4. 阶段 4（图标/NSIS/脚本）——分发就绪
5. 阶段 5（冒烟验收）
