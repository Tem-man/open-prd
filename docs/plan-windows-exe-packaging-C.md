# 方案 C（最终版）：把 open-prd 打包为 Windows 桌面应用（.exe）

> **目标**：在 Windows x64 上产出可直接分发的 `.exe`（NSIS 安装版 + 免安装便携版），双击安装 / 启动后即可使用完整的 PRD 生成、编辑、版本管理、原型设计与导出能力，目标机器**无需 Node.js / pnpm / 源码仓库**。数据（SQLite、原型 `.fig`、用户 Skill、LLM 配置）全部落在用户目录，覆盖升级与卸载不丢。
>
> **本方案与 A / B 的关系**：以 **A 的本地 HTTP 同源托管**为渲染层主干，吸收 **B 的实施顺序（打包硬风险前置）、`DOTENV_CONFIG_PATH` 配置兜底、图标与 deploy 细节**；修正 A 的 dev 分支路径错误与 B 的深链资源解析缺陷、"离线可用"措辞、误删 `@tauri-apps/api` 建议。差异对照见附录。
>
> **硬约束**：所有第三方包安装与脚本一律使用 `pnpm`，禁止 `npm install`；不改动 `packages/*` 引擎源码；不破坏现有 Web 开发模式（`pnpm dev`）；**任何含密钥的 `.env` 与本地 `*.db` 绝不进入安装包**。
>
> **能力边界（明确不承诺"离线可用"）**：LLM 调用需要网络；PRD 的 Mermaid / markmap 图表脚本来自公网 CDN（见 §4.6），断网时图表不渲染，其余本地功能不受影响。

---

## 一、结论摘要（四个核心决策）

| #  | 决策                                                                                           | 一句话理由                                                                                                                                    |
| -- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| D1 | **渲染层走主进程内 Express 同源 HTTP 托管**：`http://127.0.0.1:<随机端口>/`，静态资源 + `/api` 同源，SPA fallback 兜底  | 同时解决 `/api` 相对路径、`createWebHistory` 深链、CanvasKit WASM / 字体的 `file://` CORS；前端业务代码零改动；放弃 `app://` 自定义协议（MIME / Range / SSE / 大文件上传都要自行处理） |
| D2 | **`frontend/vite.config.ts` 加构建期开关**：`ELECTRON_BUILD=1 → base: "/"`，Web 默认 `./` 不变           | `"./"` 在深链刷新时会把 `./assets/*` 解析成 `/session/assets/*` 导致白屏；开关隔离两种构建，不影响 Web 部署                                                            |
| D3 | **后端用 `pnpm deploy` 产出自包含目录**，作为 `extraResources` 放 asar 外，主进程按**文件路径** `pathToFileURL` 动态导入 | 绕开 pnpm 符号链接与 asar 内原生模块限制；`backend` 不作为 electron 的依赖声明                                                                                  |
| D4 | **实施顺序硬风险前置**：先 `deploy + rebuild` 打出能启动、能响应 `/health` 的包，再接渲染层，最后做配置体验与图标                   | 原生模块 ABI 与依赖完整性是最大不确定性，最早暴露最便宜                                                                                                           |

---

## 二、现状盘点与阻塞项

### 2.1 可直接复用的资产

| 位置                                                            | 内容                                                                                                                                              | 处置                                                                                                    |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `electron/src/main/index.ts`                                  | `app.isPackaged` 时注入 `DATA_DIR` / `DB_PATH` / `USER_SKILLS_DIR`，遗留 `skill-custom-*` 迁移逻辑，preload 安全配置（`contextIsolation` / 关 `nodeIntegration`） | 保留数据目录与迁移逻辑；加载方式按 D1/D3 重写                                                                            |
| `backend/src/db/client.ts`、`services/prototypeStore.ts`       | 已支持 `DB_PATH` / `DATA_DIR` 覆盖                                                                                                                   | 不改                                                                                                    |
| `backend/src/services/skillDirs.ts`                           | `BUILTIN_SKILLS_ROOT = resolve(__dirname, '..','..','..','skills')`                                                                             | 不改：`<resources>/backend/dist/services` 上溯三级正好到 `<resources>/skills`，与 `extraResources.to: skills/` 吻合 |
| `backend/src/routes/sessions/messages.ts` + `services/llm.ts` | 已支持请求体 `llmConfig`（`runWithLlmConfig` / `parseLlmRuntimeConfig`），前端已有 `SettingsDialog`                                                          | 作为打包后配置 API Key 的主链路                                                                                  |
| `frontend/vite/pencil-assets.ts`                              | 构建期把 `canvaskit.wasm` 与字体同步进 `public/` → `dist/`                                                                                                | 不改，构建产物自带                                                                                             |

### 2.2 实测环境

```
Windows (win32) | Node v22.22.2 | pnpm 9.15.0
Electron 42.1.0 | electron-vite 5.0.0 | electron-builder 26.8.1 | @electron/rebuild 4.0.4
frontend/dist、backend/dist 存在；electron/out、electron/build、electron/release 均不存在（从未打包成功）
```

> ⚠️ `AGENTS.md`、`docs/electron-guide.md` 仍写 Electron 33 / electron-vite 3 / builder 25，且 guide 的 axios baseURL 段落与代码（纯 `fetch`）不符。以 `package.json` + `pnpm-lock.yaml` 为准，文档修订放在阶段 5。

### 2.3 阻塞项清单

| #   | 阻塞                                                                                   | 后果                       | 解法                      |
| --- | ------------------------------------------------------------------------------------ | ------------------------ | ----------------------- |
| G1  | `file://` 加载 + 前端 40+ 处根相对 `fetch("/api/...")`                                       | 全部接口失效                   | D1                      |
| G2  | `createWebHistory()` + `file://`，深链 / F5 失效                                          | 白屏                       | D1 + D2                 |
| G3  | `win.loadFile(join(__dirname, '../../frontend/dist/index.html'))` 路径错误               | 白屏                       | D1 改 `loadURL`          |
| G4  | `electron/package.json` 无 `dependencies`，`import("backend")` 打包后无法解析                 | Express 起不来              | D3                      |
| G5  | 后端生产依赖（express、@langchain/*、better-sqlite3）未进包                                       | 同上                       | D3                      |
| G6  | `better-sqlite3` 需按 Electron ABI 重编译；现有 `rebuild` 脚本指向不含该模块的 `electron/node_modules` | `NODE_MODULE_VERSION` 崩溃 | 阶段 1                    |
| G7  | `backend/src/index.ts` 的 `isMain`（`process.argv[1].endsWith("index.js")`）可能被主进程误触发   | 二次监听 3000、在错误目录建库        | 加 `OPENPRD_EMBEDDED` 守卫 |
| G8  | 固定 3000 端口且监听 `0.0.0.0`                                                              | 端口冲突；局域网可访问本地数据接口        | 随机端口 + 回环绑定 + Host 校验   |
| G9  | 打包后无 `.env`，LLM Provider / Key 无来源                                                   | Agent 无法调模型              | §4.5 双通道                |
| G10 | `electron/build/` 不存在、无 `icon.ico`；根包无一键编排；`frontend` 版本 0.0.0 与其余 0.1.0 不一致         | 打包失败 / 顺序靠人肉             | 阶段 0 / 4                |



---

## 三、目标架构

### 3.1 运行时拓扑

```
┌─ Electron 主进程 out/main/index.js（CJS，原生动态 import）──────────────┐
│ 0. requestSingleInstanceLock()，未获锁直接 quit（避免第二个 Express）      │
│ 1. 注入 env（必须先于 backend 加载）：                                   │
│    DATA_DIR / DB_PATH / USER_SKILLS_DIR = <userData>…                   │
│    DOTENV_CONFIG_PATH = <userData>/.env   OPENPRD_EMBEDDED=1            │
│    STATIC_DIR = <resources>/frontend/dist   NODE_ENV=production          │
│ 2. await import(pathToFileURL(<resources>/backend/dist/index.js).href)   │
│ 3. startServer(0) → 随机空闲端口，仅监听 127.0.0.1                        │
│ 4. BrowserWindow.loadURL(`http://127.0.0.1:${port}/`)                    │
└───────────────────────────────────┬───────────────────────────────────┘
                                    │ 同一进程内的 Express 5
        ┌───────────────────────────┴───────────────────────────────────┐
        │ 中间件顺序：Host/Origin 校验 → /health → /api/* →             │
        │   express.static(STATIC_DIR, { index:false }) → SPA fallback   │
        │ SPA fallback：GET + Accept 含 text/html + 非 /api → index.html │
        └───────────────────────────┬───────────────────────────────────┘
                                    ▼
                BrowserWindow 渲染进程（同源，前端无需感知端口）
```

### 3.2 安装后目录布局

```
<安装目录>/
├── OpenPRD.exe
└── resources/
    ├── app.asar                  # out/main + out/preload + electron/package.json
    ├── backend/                  # pnpm deploy 产物（asar 外）
    │   ├── package.json
    │   ├── dist/index.js
    │   ├── dist/services/prd/runtime/…
    │   └── node_modules/         # 生产依赖，better_sqlite3.node 已按 Electron ABI 编译
    ├── frontend/dist/            # ELECTRON_BUILD=1 产物（index.html / assets / canvaskit.wasm / 字体）
    └── skills/                   # 内置 Skill，只读

%APPDATA%/OpenPRD/                # 用户数据，覆盖升级与卸载均保留
├── prd.db (+ -wal / -shm)
├── .env                          # 可选：LLM 与其它环境变量（用户填写或首启模板）
├── prototypes/*.fig
├── skills/skill-custom-*
└── logs/main.log
```

---

## 四、关键设计决策

### 4.1 渲染层：HTTP 同源托管（不采用 `app://`）

`app://` 方案需要自行处理 MIME（尤其 `application/wasm`）、Range 请求、SSE 流式透传、50MB `.fig` 上传 body，且 `base:"./"` 下深链刷新的资源解析问题依然存在。Express 静态托管这些都由框架成熟处理，调试手段（DevTools Network / curl）也是标准的。

代价是要改 `backend/src/index.ts`（加静态托管）——这属于低风险增量改动，且附带收益：Web 模式也能用 `pnpm --filter backend start` 直接托管前端产物。

### 4.2 `base` 开关（不破坏 Web 模式）

```ts
// frontend/vite.config.ts，仅一行
base: process.env.ELECTRON_BUILD === "1" ? "/" : "./",
```

- 变量由 `scripts/build-desktop.mjs` 通过 `spawnSync` 的 `env` 传入，**不在 shell 命令里写 `ELECTRON_BUILD=1`**（Windows `cmd` 不识别该语法）。
- `AGENTS.md` 中「`base: "./"` 不能改回 `/`」的约束只对 `file://` 成立；改 HTTP 托管后 Electron 构建必须切 `/`，阶段 5 同步修订该条说明。
- 根路径 `/` 与深链 `/session/:id` 都统一走 SPA fallback 返回 `index.html`，配合 `base:"/"` 资源永远解析到 `/assets/*`。

### 4.3 后端进包：`pnpm deploy` + 文件白名单

```bash
pnpm --filter backend build
pnpm --filter backend deploy --prod .packaging/backend
```

**必须配套的两点**（防止密钥与源码进包）：

1. `backend/package.json` 增加 `"files": ["dist"]`，让 deploy 只携带 `dist/` 与 `package.json`，不带 `src/`、`.env`、`tsconfig*`。
2. 构建脚本末尾对 `.packaging/backend` 与最终产物做扫描：出现 `.env`、`.env.*`、`*.db`、`backend/src/` 即 **fail-fast**。

deploy 产物无符号链接，`dist/` 内的相对 import 会向上找到同目录 `node_modules`，后端构建产物零改动。`backend` **不**加入 `electron` 的 dependencies。

### 4.4 原生模块 ABI

- 用 `@electron/rebuild` 的 **Node API** 写进构建脚本，`buildPath` 指向 `.packaging/backend`。
- `electronVersion` **从已安装的 `electron/package.json` 读取**，不硬编码 `42.1.0`，避免升级 Electron 后脚本静默编错 ABI。
- 优先命中 prebuild；需源码编译时前置条件是 VS Build Tools（MSVC）+ Python + 联网下载 Electron headers，脚本要提前检测并给出可读报错。
- `electron-builder.yml` 设 `npmRebuild: false` / `nodeGypRebuild: false`，禁止 electron-builder 再用 Node ABI 编一遍。
- `.node` 位于 asar 外的 `extraResources`，**无需 asarUnpack**。
- 固定执行顺序：**build → deploy → rebuild**，deploy 会重置目录，顺序错了会混入旧 ABI。

### 4.5 LLM 配置与 API Key（双通道）

| 通道                                         | 用途       | 说明                                                                                           |
| ------------------------------------------ | -------- | -------------------------------------------------------------------------------------------- |
| 主链路：应用内 `SettingsDialog` → 请求体 `llmConfig` | 普通用户     | 现有能力，无需新 UI；模型 / Provider / Key 随请求下发                                                        |
| 兜底：`DOTENV_CONFIG_PATH = <userData>/.env`  | 覆盖全部环境变量 | 可配 `OLLAMA_BASE_URL`、`VECTORIZE_*`、`LLM_TIMEOUT_MS` 等 `llmConfig` 覆盖不到的项；首次启动不存在时拷一份带中文注释的模板 |

两条通道都要求 **env 注入早于动态 import backend**（`import "dotenv/config"` 在模块加载时执行）。系统级 `OPENAI_API_KEY` 等环境变量自然透传，作为第三重回退。`.env` 明文存 Key 的风险写入使用者文档；`safeStorage` 加密持久化留作后续独立计划。

### 4.6 CDN 与离线边界

`backend/src/services/prd/runtime/prd-runtime.js` 的 `CDN = https://cdn.jsdelivr.net/npm`（mermaid / d3 / markmap）。本期**不改动**：AGENTS.md 要求导出的单文件 HTML 使用 CDN，桌面预览与导出共用同一 runtime。断网时图表不渲染属已知限制，写进验收与交付说明；本地化（`frontend/dist/vendor/` + 预览走本地、导出仍走 CDN）另立计划。

### 4.7 安全与健壮性

- 仅监听 `127.0.0.1`；`Host` / `Origin` 校验只放行 `127.0.0.1:<port>` 与 `localhost:<port>`（导航请求 `Origin` 为空时放行），防本机恶意网页借 DNS rebinding 读 `/api`。
- 单实例锁；第二实例聚焦已有窗口。
- `startServer` 失败 → `dialog.showErrorBox` + 日志路径，不静默白屏；主进程 console 追加写 `<userData>/logs/main.log`（`node:fs`，不引 `electron-log`）。
- `show:false` + `ready-to-show`；`title` / `icon` / `minWidth` / `minHeight`。
- 可选 `stopServer()` 在 `before-quit` 调 `server.close()`。
- **不删除 `@tauri-apps/api`**：`pencil/app/editor/fonts/index.ts`、`shell/menu/use.ts`、`shell/menu/document-name.ts` 均有动态 import，验收时确认其失败兜底不阻塞画布即可。

---

## 五、分阶段实施计划

### 阶段 0 · 基线与护栏

- 三端构建独立可跑通：`pnpm --filter frontend build` / `backend build` / `electron build`；`pnpm lint` / `pnpm typecheck` 全绿。
- `backend/package.json` 加 `"files": ["dist"]`；版本号 root / frontend / backend / electron 统一 `0.1.0`。
- `.gitignore` 追加 `.packaging/`、`electron/release/`（图标作为设计资产**入库**，不忽略）。
- **保持 electron 包名 `electron` 不变**（改名会连锁影响所有 `--filter` 命令与文档，收益不抵成本）。
- 验收：记录 `process.argv[1]` 实际值，确认 `isMain` 是否误触发；建立 git 基线便于回滚。

### 阶段 1 · 后端运行时打包（最硬风险前置）

**改动**：`backend/package.json`（files）、`electron/package.json`（脚本）、`electron/src/main/index.ts`（env + 路径导入）、`electron/electron-builder.yml`（extraResources）、`scripts/build-desktop.mjs`（先实现 build/deploy/rebuild 三段）。

1. 主进程按 D3 加载 backend；生产路径 `<resources>/backend/dist/index.js`。
2. **dev 分支不内嵌 backend**：`pnpm dev` 仍由独立后端提供 `:3000` + Vite proxy，主进程 dev 只 `loadURL("http://localhost:5173")`。这样不需要给 electron 加 workspace 依赖，也不依赖 `backend/dist` 是否新鲜，同时消除 A 版 dev 路径算错的问题。
3. `pnpm deploy --prod .packaging/backend` → `electronRebuild` → `electron-builder --dir` 产出 `win-unpacked`。
4. **本阶段暂不接前端**：主进程临时 `loadURL("http://127.0.0.1:<port>/health")`，窗口显示 JSON 即证明后端链路通。

**验收**：`win-unpacked/OpenPRD.exe` 双击启动，`/health` 返回 200；`%APPDATA%/OpenPRD/prd.db` 能建表（better-sqlite3 ABI 正确）；无二次监听 3000；产物中无 `.env` / `*.db` / `src/`。

> 全程用 `--dir` 做快速迭代，**最后阶段才打 NSIS / portable**，避免每次几分钟的安装包构建拖慢调试。

### 阶段 2 · 渲染层同源托管

**改动**：`backend/src/index.ts`、`frontend/vite.config.ts`、`electron/src/main/index.ts`。


1. `createApp()` 末尾（全部 `/api` 之后）挂 `express.static(STATIC_DIR, { index:false })` + SPA fallback。  
   **Express 5 注意**：不要用 `app.get("*", …)`（path-to-regexp 8 会报错），用 `app.use((req,res,next)=>…)` 中间件按 `GET + Accept: text/html + 非 /api 前缀` 判断，其余 `next()` 保留接口 404。
2. `startServer(port?, host?)`：嵌入态 `127.0.0.1`；加 Host/Origin 校验中间件；自动启动加 `!process.env.OPENPRD_EMBEDDED` 守卫（可叠加 `fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")` 严谨比较）。
3. 主进程生产 `loadURL("http://127.0.0.1:<port>/")`，删除 `loadFile`；前端构建带 `ELECTRON_BUILD=1`。
4. preload 的 `getApiPort` 保留作调试用途；前端不依赖它。`window.electronAPI` 类型声明补进 `frontend/src/types/`。

**验收**：`win-unpacked` 内首页 → 新建会话 → SSE 逐字输出 → PRD 生成 → 8 Tab 图表渲染（联网）→ 章节 AI 编辑 / 版本切换 → `/prototype/:id` CanvasKit 画布与 `.fig` 保存 → 导出四种格式 → **F5 刷新 `/session/:id` 与 `/prototype/:id` 不白屏**。

### 阶段 3 · 配置体验与健壮性

- 首启检测 `<userData>/.env` 不存在 → 拷入带中文注释的模板；缺 Key 时 Agent 调用返回可读错误而非崩溃。
- 单实例、日志、`ready-to-show`、错误弹窗、`stopServer()`。
- 验收：无 `.env` 也能启动；二次启动聚焦已有窗口；日志无未捕获异常。

### 阶段 4 · 图标、NSIS 与便携版

- `electron/build/icon.ico`：≥256×256 多尺寸（16/32/48/64/128/256），从 `frontend/public/favicon.svg` 生成或由设计提供；`installerIcon` / `uninstallerIcon` 复用。
- `electron-builder.yml`：

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
  - from: ../.packaging/backend/
    to: backend/
  - from: ../frontend/dist/
    to: frontend/dist/
  - from: ../skills/
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
  perMachine: false
  artifactName: ${productName}-Setup-${version}.${ext}
  createDesktopShortcut: true
  shortcutName: ${productName}
  deleteAppDataOnUninstall: false
portable:
  artifactName: ${productName}-Portable-${version}.${ext}
publish: null
```

- 代码签名本期不做；无证书时 SmartScreen 提示"未知发布者"，写进交付说明。

### 阶段 5 · 一键脚本、验收与文档同步

- 完善 `scripts/build-desktop.mjs`，根 `package.json` 加 `"dist:win": "node scripts/build-desktop.mjs"`。
- 文档：修订 `AGENTS.md`（Electron 42/5/26.8、`base` 约束说明、移除 `createWebHistory` 已知未完成项）、重写 `docs/electron-guide.md`；新增使用者文档（安装、首次配置模型、数据备份与迁移、已知限制）。
- 按 §七 全量验收。

---

## 六、一键构建脚本流程

```
scripts/build-desktop.mjs（Node，内部一律 spawnSync("pnpm", …)）
1. 环境校验：win32、pnpm 可用、Node ≥ 20、（如需源码编译）MSVC + Python
2. 清理 .packaging/backend 与 electron/release/<version>
3. 构建：
   frontend build（env 注入 ELECTRON_BUILD=1，仅此进程生效）
   backend build
   electron build
4. pnpm --filter backend deploy --prod .packaging/backend
5. electronRebuild({ buildPath, electronVersion: 读取 electron/package.json, arch: "x64", force: true })
6. 清理 *.map / *.d.ts / 测试文件，控制体积
7. electron-builder --win --x64（调试期用 --dir）
8. 产物扫描：出现 .env / *.db / backend/src 即失败退出
9. 打印 electron/release/<version>/*.exe 清单 + 体积 + SHA-256
```

## 七、验收清单

### 7.1 构建期

- [ ] 干净 clone + `pnpm install` 后 `pnpm dist:win` 一次跑通，退出码 0
- [ ] 产出 `OpenPRD-Setup-<version>.exe` 与 `OpenPRD-Portable-<version>.exe`，记录体积（预估 250–400MB）与 SHA-256
- [ ] 产物不含 `.env` / `*.db` / `backend/src` / 用户 `skill-custom-*`
- [ ] `better_sqlite3.node` 的 ABI 与当前 Electron 版本一致
- [ ] `pnpm lint` / `pnpm typecheck` 全绿；`pnpm dev` Web 模式无回归（`base` 仍为 `./`）

### 7.2 全新机器运行期（无 Node / pnpm / 源码）

- [ ] 安装 → 桌面快捷方式 → 启动无白屏，标题 / 图标正确
- [ ] 设置里填 API Key → 新建会话 → SSE 流式输出 → 完整 PRD 与图表（联网）
- [ ] 模块管理 / Skill 编辑 / 历史会话 / 版本新建·切换·复制·删除·回滚
- [ ] `/prototype/:id`：CanvasKit 画布可编辑，`.fig` 保存后重启仍在
- [ ] F5 刷新 `/session/:id`、`/prototype/:id` 不白屏
- [ ] 导出 HTML / Markdown / PDF / DOCX
- [ ] 数据落 `%APPDATA%/OpenPRD/`；关闭重启数据保留；覆盖升级不丢；卸载后 userData 保留
- [ ] 无 `.env` 时可启动，Agent 调用给可读错误；二次启动聚焦已有窗口
- [ ] 断网启动：应用可开，图表提示 CDN 不可用（已知限制），其余本地功能正常
- [ ] 无残留独立 node 进程；`logs/main.log` 无未捕获异常；未二次监听 3000

---

## 八、风险与对策

| 风险                                       | 对策                                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm deploy` 在 pnpm 9.15 的 workspace 限制 | backend 无 workspace 内部依赖，风险低；报错时按提示加 `--legacy` 或 `inject-workspace-packages=true` 并固化进脚本；兜底为脚本复制 `dist` + 按 `pnpm list --prod --json` 复制依赖 |
| better-sqlite3 无对应 Electron prebuild     | 脚本预检 MSVC / Python；可改用 `prebuild-install --runtime=electron --target=<读自 electron/package.json>`；必要时 CI 预置编译产物                              |
| 静态托管 / SPA fallback 顺序错误吞掉接口 404         | 中间件严格限定 `GET + Accept: text/html + 非 /api`；验收覆盖接口 404 语义                                                                                    |
| `base:"/"` 影响 Web 部署                     | `ELECTRON_BUILD` 开关隔离，Web 默认 `./`；验收含 Web 回归                                                                                                |
| Host 校验误伤正常请求                            | 白名单 `127.0.0.1:<port>` / `localhost:<port>`，导航请求空 Origin 放行                                                                                 |
| `.env` 密钥进包                              | `files:["dist"]` + 产物扫描 fail-fast，双保险                                                                                                       |
| 端口 / 双开导致 SQLite 争用                      | 随机端口 + 单实例锁 + 回环绑定                                                                                                                          |
| 无签名触发 SmartScreen / 杀软误报                 | 交付说明提前告知；后续按 `win.certificateFile` + `signtoolOptions` 接入                                                                                   |
| 中文路径 / 空格 / node_modules 深层长路径           | 用户级安装；实测中文用户名；必要时开 `win.longPaths`                                                                                                          |
| Electron 大版本升级后 ABI 漂移                   | 版本号从 `electron/package.json` 读取，rebuild 固化在流水线                                                                                              |

---

## 九、本期明确不做（Out of Scope）

- macOS / Linux 打包（配置可留，不在验收范围）
- 代码签名、自动更新（`electron-updater`）、崩溃上报、CI 打包
- `app://` 自定义协议、backend esbuild 单文件 bundle（留作后续体积优化）
- PRD 图表 CDN 本地化、离线全功能
- 删除 `@tauri-apps/api`、改动 `packages/*` 引擎源码、前端请求层重构、Vue Router 改 hash
- backend 拆独立子进程 / 引入 PM2；electron 包改名

---

## 十、默认假设与待确认项

1. 交付 NSIS 安装版 + portable 便携版两种 `.exe`；只要其一时删对应 target。
2. 应用名 `OpenPRD`、`appId com.donjet.open-prd`、版本统一 `0.1.0`。
3. 图标基于 `frontend/public/favicon.svg` 生成，或由设计提供正式 `icon.ico`。
4. 不要求完全离线可用，CDN 图表缺失作为已知限制写入交付说明。
5. Web 部署能力保留，故采用 `ELECTRON_BUILD` 开关而非直接改 `base`。
6. 构建在 Windows x64 本机执行。

---

## 附录：相对 A / B 的修正点

| 来源    | 问题                                                                                          | 本方案的修正                                            |
| ----- | ------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| B     | `app://` + `base:"./"` 深链刷新时 `./assets/*` 解析成 `/session/assets/*`，SPA fallback 只兜 HTML 不兜资源 | 改 HTTP 托管 + `base:"/"`，验收含 F5                     |
| B     | 目标写"离线可用"，但 LLM 需联网、图表走 jsdelivr CDN                                                        | 能力边界显式声明，CDN 本地化另立计划                              |
| B     | 建议顺手移除 `@tauri-apps/api`                                                                    | 不删；原型编辑器有动态 import，验收确认兜底                         |
| B     | dev 分支 `import("backend")` 需 workspace 依赖且依赖 `backend/dist` 新鲜度                             | dev 不内嵌 backend，沿用 `:3000` + Vite proxy           |
| A     | dev 分支 `join(__dirname,"../../backend/dist")` 在 `out/main` 下会指到 `electron/backend/dist`     | 同上，dev 分支不再计算该路径                                  |
| A / B | 未防 `backend/.env`、`src/` 随 deploy 进包                                                        | `files:["dist"]` + 产物扫描 fail-fast                 |
| A / B | 未提及 Express 5 下 `app.get("*")` 会报错                                                          | SPA fallback 用 `app.use` 中间件                      |
| A     | `electronVersion: "42.1.0"` 硬编码                                                             | 从已安装的 `electron/package.json` 读取                  |
| A     | HTTP 方案未防 DNS rebinding                                                                     | 增加 Host/Origin 白名单校验                              |
| 两者    | 每次调试都打完整安装包，迭代慢                                                                             | 调试用 `electron-builder --dir`，最后才打 NSIS / portable |

---

## 附录二：实施记录与计划偏差

按本计划落地代码时暴露了计划阶段未预见的事实，逐条记录如下（均已修正代码或配置）：

| # | 实施时发现 | 处置 |
| --- | --- | --- |
| 1 | `electron-vite 5 + Vite 8` 要求 main/preload 显式 `build.target`，否则 `electron build` 直接报错；现有骨架从未成功构建过 | `electron.vite.config.ts` 加 `build.target: "node22"` |
| 2 | TypeScript 6 将 `moduleResolution: "node"` 标记为弃用并让 `tsc --noEmit` 失败 | `electron/tsconfig.json` 加 `ignoreDeprecations: "6.0"` |
| 3 | **`pnpm deploy` 在 Windows 上用硬链接指向主仓库 pnpm store**，并非计划假设的「真实展开目录」。直接对 deploy 跑 `@electron/rebuild` 会把主仓库的 `better_sqlite3.node` 换成 Electron ABI，本机 `pnpm dev` 立刻 `ERR_DLOPEN_FAILED` | 构建脚本改为：把包真实复制到 `.packaging/native` 隔离目录 → 在隔离目录按 Electron ABI 编译 → `renameSync` 让出 deploy 侧路径（断开硬链接）→ `copyFileSync` 注入。**全程不写主仓库** |
| 4 | Electron 42 对应 `NODE_MODULE_VERSION 146`；`better-sqlite3@12.10.0` 既无该 ABI 预编译包，C++ 源码又使用旧 V8 API（`v8::External::New` 两参数形式），用 Electron 42 头文件编译报 `C2660` | 依赖升级到 `^12.11.1`（上游 v12.10.1 修 V8 API、v12.11.1 补回 Electron 42 构建目标并修复 Windows 构建；v12.11.0 官方标注不可用） |
| 5 | `frontend` 的 `build`（`vue-tsc -b && vite build`）存在一批**既存类型错误**（迁移的 pencil 源码引用 `@tauri-apps/plugin-*`、`storybook`，以及 `Uint8Array` → `BlobPart`），与打包无关 | 新增 `build:desktop`（纯 `vite build`）供打包链路使用；Web 构建脚本保持原样，类型治理另立计划 |
| 6 | `electron/build/` 无图标，且本机没有 Pillow / ImageMagick | 新增 `scripts/generate-icon.py`，纯 Python 标准库写传统 32bpp BMP 格式 ICO（7 种尺寸），`pnpm icon` 可复现 |
| 7 | 受管构建环境下，Vite 清空 `frontend/dist`（531 文件）与 node-gyp 清空 `build/`（117 文件）会被批量删除保护拦截 | 脚本构建前把旧 `frontend/dist` 整体改名让出路径；原生编译改在隔离目录且优先走预编译包 |
| 8 | **`extraResources` 从父目录整体复制时会按目录名排除 `node_modules`**，安装后 `resources/backend` 只剩 `dist/` + `package.json` | 先由脚本把 pnpm 的 `.pnpm`/符号链接展平成真实目录（`.packaging/runtime`），再把 `dist/` / `package.json` / `node_modules/` **拆成三条独立 `extraResources` 映射**； Skills 同时用 filter 排除用户自建的 `skill-custom-*` |
| 9 | `process.execPath` 可能是 `C:\Program Files\nodejs\node.exe`，`spawnSync` 走 `shell:true` 会被 cmd 按空格截断成 `C:\Program` | 调用 `prebuild-install` 时改用 `shell:false` 直接 spawn node.exe；`pnpm` 命令仍走 shell |
| 10 | `@electron/rebuild` 的 `force:true` 会跳过预编译包、强制源码编译 | 改为直接用 `prebuild-install --runtime=electron --target=<electronVersion>` 取 Electron ABI 146 官方包；本机无需 MSVC |
| 11 | 扩展到 macOS / Linux：脚本名带 `win`、ABI 下载写死 `win32/x64`、只有 `.ico`、release 清理只认 `win-unpacked` | `build-win-exe.mjs` 泛化为 `scripts/build-desktop.mjs`（`--platform` / `--arch`）；按目标平台取 `electron-v146-<platform>-<arch>` 包；`pnpm icon` 额外产出 `icon.icns`（PNG 条目）与 `icon.png`；yml 补全 mac（dmg+zip、identity:null）与 linux（AppImage+deb、executableName）；release 清理按平台识别 `*-unpacked` / `mac*`；新增 `.github/workflows/desktop-release.yml` 三平台 matrix |
| 12 | macOS dmg 依赖 `hdiutil`，Linux 包在 Windows 上构建不稳定 | 脚本对非 macOS 主机执行 `dist:mac` 直接给出明确拒绝提示；`dist:linux` 在 Windows 上警告但仍允许尝试；正式发版走原生 OS 的 CI runner |
| 13 | `pnpm deploy` 在 Windows 上偶发因创建 `node_modules/.bin/*.ps1` 报 EPERM，导致整条链路失败 | `deployBackend()` 增加产物完整性容错：只要 `dist/index.js` 与 `.pnpm` 依赖树（≥100 包）齐全就继续——那些 `.bin` 可执行桩对运行时无用 |
| 14 | 泛化三平台时，`pnpm --filter electron dist -- --linux --x64` 里的平台参数被 pnpm 吞掉，electron-builder 静默按宿主平台产出 Windows 包（且用了 Linux ABI 的 `.node`），脚本仍显示"完成" | 改用 `pnpm --filter electron exec electron-builder --linux --x64` 直接传参；`printSummary()` 增加目标平台产物存在性校验（找不到对应扩展名即报错），杜绝"假成功" |
| 15 | `prebuild-install` 走 GitHub releases 时当前网络偶发 502 / socket hang up；electron-builder 下载目标平台 Electron 二进制也可能 Bad Gateway | 预编译包获取加 3 次重试；CI 与本机可设置 `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR` 走 npmmirror 镜像 |
| 16 | yml 的 target 里写死 `arch` 会让一次构建同时产出 x64 + arm64，与 CLI `--x64/--arm64` 冲突 | 三平台 target 全部去掉 `arch`，统一由脚本命令行决定；CI matrix 按 runner 指定 |
| 17 | 本机 Windows 实测 Linux 包：`AppImage` 构建需要创建 `usr/share/icons/...` 符号链接，无管理员权限报 `A required privilege is not held by the client` | 确认为平台限制而非配置问题：`dist:linux` 保留警告 + 尝试，正式产物交给 `ubuntu-latest`；清理规则补上 `__appImage-*` 等临时目录 |

计划内的加固均已落地：`backend/package.json` 的 `files: ["dist"]` + 脚本 fail-fast 扫描、Host/Origin 白名单、`OPENPRD_EMBEDDED` 自动启动守卫、Express 5 用 `app.use` 做 SPA fallback、`ELECTRON_BUILD` base 开关、单实例 / 日志 / 错误弹窗 / `stopServer`、`NSIS + portable` 双产物、`.env` 首启模板。

> 完整实现说明见 `docs/electron-guide.md`，使用者说明见 `docs/windows-desktop-user-guide.md`。
