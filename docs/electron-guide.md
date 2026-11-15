# Electron 桌面壳实现指南（当前实现）

> 本文描述**代码现状**，取代早期的骨架设计稿。方案决策与验收清单见
> [`plan-windows-exe-packaging-C.md`](./plan-windows-exe-packaging-C.md)；面向使用者的安装说明见
> [`windows-desktop-user-guide.md`](./windows-desktop-user-guide.md)。

---

## 工具链

| 工具 | 版本（以 lockfile 为准） | 职责 |
| --- | --- | --- |
| Electron | 42.x | 桌面运行时 |
| electron-vite | 5.x | 构建 `main` + `preload`（渲染进程由 `frontend/` 独立构建） |
| electron-builder | 26.x | NSIS / portable 打包 |
| prebuild-install | 7.x（随 better-sqlite3） | 在隔离副本上下载 Electron ABI 预编译二进制 |
| pnpm deploy | pnpm 9.x | 生成自包含后端运行目录 |

`electron.vite.config.ts` 里 `main` / `preload` 都必须显式写 `build.target: "node22"`——electron-vite 5 + Vite 8 缺此配置会直接报错。

---

## 运行时架构

```
Electron 主进程 (out/main/index.js, CJS)
 ├─ requestSingleInstanceLock()
 ├─ 注入 env（早于 backend 加载）：DATA_DIR / DB_PATH / USER_SKILLS_DIR
 │  / DOTENV_CONFIG_PATH / STATIC_DIR / OPENPRD_EMBEDDED / NODE_ENV
 ├─ await import(pathToFileURL(<resources>/backend/dist/index.js).href)
 ├─ startServer(0, "127.0.0.1")  → 随机端口
 └─ BrowserWindow.loadURL(`http://127.0.0.1:${port}/`)
        │
        └─ 同一进程内的 Express 5
           Host/Origin 白名单 → /health → /api/* →
           express.static(STATIC_DIR, {index:false}) → SPA fallback → index.html
```

**为什么不用 `file://`**：前端 40+ 处请求是根相对 `fetch("/api/...")`，在 `file://` 下会解析成 `file:///api/...`；`createWebHistory` 深链刷新也会失效；CanvasKit WASM / 字体在 `file://` 下 fetch 受 CORS 限制。HTTP 同源托管一次解决以上全部问题，前端业务代码零改动。

**关键顺序约束**：`backend/src/index.ts` 顶部有 `import "dotenv/config"`，模块加载时立即读 `DOTENV_CONFIG_PATH`，所以所有 env 注入必须在动态 `import()` 之前完成。

### dev 模式

`pnpm dev` 时主进程 `NODE_ENV=development` 且未打包，**不内嵌 backend**：前端 Vite `:5173` + 独立后端 `:3000`（Vite proxy），主进程只 `loadURL("http://localhost:5173")`。不需要给 electron 包声明 `backend` workspace 依赖，也不依赖 `backend/dist` 是否新鲜。

---

## 目录与数据

```
<安装目录>/resources/
├── app.asar                 # out/main + out/preload
├── backend/                 # pnpm deploy 产物（asar 外）
│   ├── dist/index.js
│   └── node_modules/        # 含 Electron ABI 的 better_sqlite3.node
├── frontend/dist/           # ELECTRON_BUILD=1 构建产物
└── skills/                  # 内置 Skill（只读）

%APPDATA%/OpenPRD/
├── prd.db (+ -wal / -shm)   # DB_PATH
├── .env                     # 首启生成的模板，可选填写
├── prototypes/*.fig         # DATA_DIR
├── skills/skill-custom-*    # USER_SKILLS_DIR
└── logs/main.log
```

`skillDirs.ts` 的 `BUILTIN_SKILLS_ROOT` 从 `<resources>/backend/dist/services` 上溯三级正好落到 `<resources>/skills`，**无需改动后端路径逻辑**。

---

## 原生模块（最容易踩坑的一节）

`pnpm deploy` 在 **Windows 上使用硬链接**指向主仓库 pnpm store。若直接对 deploy 目录重建原生模块，会把主仓库 `better_sqlite3.node` 换成 Electron ABI，导致本机 `pnpm dev` 立刻 `ERR_DLOPEN_FAILED`。

因此 `scripts/build-desktop.mjs` 的做法是：

1. 把 deploy 内的 `better-sqlite3` 包**真实复制**到 `.packaging/native/node_modules/`（`dereference: true`）；
2. 在隔离副本目录执行 `prebuild-install --runtime=electron --target=<electronVersion>`，下载官方 Electron ABI 预编译包（不触发 node-gyp、不需要 MSVC）；
3. 注入 deploy 产物前先 `renameSync` 让出原路径，再 `copyFileSync` 写入**独立文件**，断开与主仓库 store 的硬链接。

Electron 42 对应 `NODE_MODULE_VERSION 146`。`better-sqlite3 12.10.0` 既无该 ABI 预编译包，C++ 源码又使用旧 V8 API（`v8::External::New` 两参数形式），源码编译会报 `C2660`。本仓库已将依赖升级到 **`^12.11.1`**（上游 v12.10.1 修 V8 API、v12.11.1 补回 Electron 42 构建目标并修复 Windows 构建）。若将来升级 Electron 到没有预编译包的版本，才需要 Visual Studio Build Tools + Python 从源码编译。

**依赖展平**：electron-builder 的 `extraResources` 从父目录整体复制时会按目录名排除 `node_modules`，也会跳过 pnpm 的 `.pnpm` 隐藏目录与符号链接。脚本会把 deploy 产物展平为 `.packaging/runtime/`（真实文件、无链接），再由 `electron-builder.yml` 把 `dist/`、`package.json`、`node_modules/` **拆成三条独立映射**。Skills 用 filter 排除用户自建的 `skill-custom-*`。

若本机曾因误操作把主仓库二进制换成 Electron ABI，恢复方式：用 `prebuild-install --runtime=node --target=<本机 Node 版本>` 下载 Node 版二进制，把主仓库的 `.node` 改名让出路径（断开硬链接），再写入新文件。

---

## 构建与打包命令

```bash
pnpm dist:win              # Windows NSIS + portable（x64）
pnpm dist:mac              # macOS dmg + zip（须在 macOS 主机）
pnpm dist:linux            # Linux AppImage + deb（建议 Linux 主机）
pnpm dist:mac -- --arch=arm64     # 指定架构（x64 / arm64）
pnpm dist:win -- --dir     # 只生成 unpacked 目录，调试用（快）
pnpm dist:win -- --skip-rebuild   # 跳过原生模块处理（复跑）
pnpm dist:win -- --keep-artifacts # 保留 unpacked / builder-debug.yml 等中间产物便于排障
pnpm icon                  # 由 favicon.svg 渲染并生成 icon.ico / icon.icns / icon.png
```

脚本流程：`frontend build:desktop` → `backend build` → `electron build` → `pnpm deploy` → 白名单校验 → **按目标平台/架构**取 Electron ABI 预编译包并在隔离副本注入 → 展平依赖 → `electron-builder` → **清理中间产物** → 产物安全扫描 → 体积 / SHA-256 摘要。三平台共用 `scripts/build-desktop.mjs`，由 `--platform` / `--arch` 区分。

### 发布目录只保留交付物

正式打包后 `electron/release/<version>/` 只保留可分发产物（Windows 是两个 exe；macOS 是 dmg / zip；Linux 是 AppImage / deb）。中间产物的处置：

| 产物 | 处置 |
| --- | --- |
| `*.exe.blockmap` | `electron-builder.yml` 里 `nsis.differentialPackage: false` **从源头不生成**（`publish: null`、未接 electron-updater，差分包没有消费者）。将来做自动更新时改回 `true`，并同时发布 `latest.yml` |
| `builder-debug.yml` | electron-builder 26 默认写出的有效配置快照，没有官方关闭开关；由脚本在所有 target 完成后清理 |
| `win-unpacked/` | 是 NSIS / portable 的输入，**无法阻止生成**，脚本在全部打包完成后移除。`--dir` 模式下它就是目标产物，会保留 |

需要排障时加 `--keep-artifacts` 保留全部。若受管环境禁止批量删除，脚本会把它们改名移到 `.packaging/tmp/discarded-<时间戳>/`（可恢复），release 目录仍然干净。

- 前端走 `build:desktop`（纯 `vite build`）。`frontend` 的 `build`（含 `vue-tsc -b`）目前存在一批**既存类型错误**（迁移的 pencil 源码引用了 `@tauri-apps/plugin-*`、`storybook`，以及 `Uint8Array` 的 BlobPart 类型），与打包链路无关，故不阻塞打包；类型治理另立计划。
- `backend/package.json` 的 `files: ["dist"]` 保证 deploy 只带 `dist/`，不带 `.env` / `src/`；脚本另做一次 fail-fast 扫描。
- 首次构建需联网下载 Electron / NSIS 资源，可设置 `ELECTRON_MIRROR`、`ELECTRON_BUILDER_BINARIES_MIRROR` 走镜像。
- **切换 Node 大版本**（如 22 ↔ 24）会让主仓库 `better-sqlite3` 的 `.node` ABI 失配，`pnpm dev` 报 `NODE_MODULE_VERSION` 不匹配 / `ERR_DLOPEN_FAILED`。执行 `pnpm fix:native`（必须**用你实际使用的那个 Node** 运行）：脚本按当前 Node ABI 取官方预编译包，断开与 pnpm store 的硬链接后写入主仓库，并实加载验证。桌面打包不受影响——`scripts/build-desktop.mjs` 在隔离副本里按 Electron ABI 单独处理原生模块。
- **固定 Node 版本不会影响打包**：项目用 `.nvmrc`（24.9.0）+ `engines: ">=24.9.0 <25"` 统一开发环境，CI 用 `node-version-file: .nvmrc` 对齐。这些配置只作用于 `pnpm install` 与版本管理器；`scripts/build-desktop.mjs` 取的是 **Electron 版本（ABI 146）** 对应的预编译包，与宿主 Node 的 ABI 无关，electron-builder / Vite / electron-vite 也不会因此改变行为。已生成的 exe 自带 Electron 运行时，更是不受影响。打包脚本里**特意不加** Node 版本检查，就是为了让它能在任意受支持的 Node 上运行。

---

## 配置与 API Key（双通道）

1. **主链路**：应用内「设置 → 模型服务」填写，随请求体 `llmConfig` 下发（`runWithLlmConfig`）。
2. **兜底**：`%APPDATA%/OpenPRD/.env`（首启生成带注释模板），由 `DOTENV_CONFIG_PATH` 指定；用于 `OLLAMA_BASE_URL`、`VECTORIZE_*`、`LLM_TIMEOUT_MS` 等 `llmConfig` 覆盖不到的变量。
3. 系统级 `OPENAI_API_KEY` 等环境变量自然透传。

代码中 `safeStorage` 加密持久化尚未实现；`.env` 是明文，使用者文档已注明风险。

---

## 安全与健壮性

- Express 仅监听 `127.0.0.1` 的随机端口；`mountHostGuard` 校验 `Host` / `Origin` 只放行回环地址，防 DNS rebinding。
- `OPENPRD_EMBEDDED=1` + `fileURLToPath(import.meta.url)` 双重守卫，避免 backend 被 `import` 时误触发 `startServer()` 二次监听 3000。
- 单实例锁、第二实例聚焦、`ready-to-show` 防白屏、`did-fail-load` 与启动异常写 `logs/main.log` 并弹错误框。
- `before-quit` 调 `stopServer()` 关闭监听。
- `preload` 仍暴露 `getApiPort()`（调试用），`contextIsolation: true` / `nodeIntegration: false`；前端类型声明在 `frontend/src/types/electron.d.ts`。

---

## 已知限制

- PRD 的 Mermaid / markmap 图表脚本来自公网 CDN（`prd-runtime.js`），断网时不渲染；导出 HTML 仍按项目规范使用 CDN。
- 打包未做代码签名，Windows SmartScreen 会提示「未知发布者」。
- 原型编辑器里 `@tauri-apps/api` 的动态 import 在 Electron 下走失败兜底；不要因为「看起来是死依赖」而删除。
- 三平台均未做代码签名 / 公证，详见下方「多平台构建」。

---

## 多平台构建（macOS / Linux）

### 产物矩阵

| 平台 | 命令 | 产物 | 架构 | 构建主机 |
| --- | --- | --- | --- | --- |
| Windows | `pnpm dist:win` | `OpenPRD-Setup-<v>.exe`（NSIS）、`OpenPRD-Portable-<v>.exe` | x64（可 `--arch=arm64`） | Windows |
| macOS | `pnpm dist:mac` | `OpenPRD-<v>-<arch>.dmg`、`.zip` | x64 / arm64 | **必须 macOS** |
| Linux | `pnpm dist:linux` | `OpenPRD-<v>-<arch>.AppImage`、`.deb` | x64 / arm64 | Linux（或 Docker） |

### 平台限制（重要）

- **macOS dmg 只能在 macOS 主机构建**：DMG 需要 `hdiutil`，签名/公证也依赖 macOS 工具链。在 Windows / Linux 上执行 `pnpm dist:mac` 会被脚本**直接拒绝**并提示改用 Mac 或 CI。
- **Linux 包建议在原生 Linux 或 Docker 中构建**：electron-builder 官方故障排查文档明确指出，在 Windows/macOS 上构建 Linux 包可能挂起或失败。脚本在 Windows 上会打印警告但仍允许尝试。本机实测：Linux 版 Electron 二进制、`electron-v146-linux-x64` 预编译包都能正常下载，但 AppImage 构建阶段需要创建 `usr/share/icons/...` 符号链接，Windows 无管理员权限时报 `A required privilege is not held by the client`，因此**本机无法产出可用 Linux 包**；`ubuntu-latest` 上无此限制。
- 架构统一由 `scripts/build-desktop.mjs` 的 `--x64` / `--arm64` 决定，`electron-builder.yml` 的 target 里**不要写死 `arch`**（否则单次构建会同时产出多个架构）。
- 三平台正式发版统一走 `.github/workflows/desktop-release.yml` 的 matrix：`windows-latest` / `macos-latest`(arm64) / `ubuntu-latest`；push `v*` tag 或手动 `workflow_dispatch` 触发，产物作为 Actions artifacts 上传。
- **平台参数必须直达 electron-builder**：脚本用 `pnpm --filter electron exec electron-builder --<platform> --<arch>`。不要改回「包脚本 + `--` 传参」的写法——pnpm 会吞掉 `--` 后的参数，electron-builder 静默按宿主平台打包，曾导致 `dist:linux` 产出 Windows exe 且混入 Linux ABI 原生模块。脚本现在会校验目标平台扩展名的产物是否真的生成，找不到即报错，杜绝"假成功"。
- 下载目标平台 Electron / 预编译包需要联网；CI 已配置 `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR` 走 npmmirror，本机网络不佳时也可手动设置这两个变量。

### 原生模块按目标平台取包

`scripts/build-desktop.mjs` 用 `prebuild-install --runtime=electron --target=<electronVersion> --platform=<win32|darwin|linux> --arch=<x64|arm64>` 下载**目标平台**的 better-sqlite3 预编译包。Electron 42 对应 `NODE_MODULE_VERSION 146`，以下资产均已确认可用：

`electron-v146-win32-x64` · `darwin-x64` · `darwin-arm64` · `linux-x64` · `linux-arm64`

因此三平台都不需要 node-gyp / MSVC / Xcode 源码编译。二进制写入隔离副本后再注入 deploy 产物，不影响构建机自身的 `pnpm dev`。

### 图标（同一 SVG 原图，三种格式）

| 文件 | 用于 |
| --- | --- |
| `electron/build/icon.ico` | Windows（多尺寸 32bpp BMP ICO） |
| `electron/build/icon.icns` | macOS（PNG 压缩条目：16 / 32 / 128 / 256 / 512） |
| `electron/build/icon.png` | Linux（512×512 RGBA） |

### 各平台安装与使用

| 平台 | 安装 | 用户数据目录 |
| --- | --- | --- |
| Windows | 双击 Setup exe；或 Portable exe 直接运行 | `%APPDATA%/OpenPRD/` |
| macOS | 打开 dmg 拖入「应用程序」；未签名包首次打开可能被 Gatekeeper 拦截，可执行 `xattr -dr com.apple.quarantine /Applications/OpenPRD.app` | `~/Library/Application Support/OpenPRD/` |
| Linux | `chmod +x OpenPRD-*.AppImage && ./OpenPRD-*.AppImage`；AppImage 需要 FUSE（`libfuse2`），或加 `--appimage-extract-and-run`；deb 用 `sudo dpkg -i` | `~/.config/OpenPRD/` |

### 三平台共同限制

- **未做代码签名 / 公证**：Windows SmartScreen、macOS Gatekeeper 会提示未知发布者。正式分发需 OV/EV 证书与 Apple Developer 账号，并配置 `win.certificateFile`、`mac.identity` / `notarize`（当前 `mac.identity: null` 显式跳过签名）。
- Linux arm64 与 macOS x64 未进 CI 默认 matrix；需要时在 workflow 里加对应 runner 与 `--arch` 即可，配置与预编译包都已就绪。
- 仍未接入自动更新（`publish: null`），三平台都靠手动分发。

---

## 版本更新与重新打包

### 版本号来源

产物版本只取 **`electron/package.json` 的 `version`**（当前 `0.1.0`）：`directories.output: release/${version}` 与 `artifactName` 里的 `${version}` 都由它决定。根 `package.json`、`backend`、`frontend` 的版本号只用于 workspace 一致性，建议一起改，但不影响 exe 命名。

### 标准流程

```bash
# 1. 自检（frontend 的 vue-tsc 有一批既存类型错误，见上文「构建与打包命令」）
pnpm lint
pnpm --filter backend typecheck
pnpm --filter electron typecheck

# 2. 提升版本号：至少改 electron/package.json，例如 0.1.0 → 0.1.1

# 3. 快速验证（可选，约 2 分钟，只出 win-unpacked）
pnpm dist:win -- --dir

# 4. 正式打包，两个 exe 落到 electron/release/<新版本>/
pnpm dist:win
```

脚本每次都会重新构建三端、重置 `.packaging/`、重新 deploy + 展平 + 取 Electron ABI 二进制，**不需要手动清理中间目录**；旧的 `release/<旧版本>/` 会保留，可自行归档或删除。结尾会打印两个 exe 的体积与 SHA-256，并扫描确认包内无 `.env` / `*.db`。

### 按变更类型

| 变更 | 额外动作 |
| --- | --- |
| 前端 / 后端业务代码、内置 Skill、Prompt | 无，直接 `pnpm dist:win` |
| 新增或升级 npm 依赖 | 先 `pnpm install`，再 `pnpm dist:win`（deploy 会重新拉生产依赖；`files:["dist"]` 仍保证源码 / 密钥不进包） |
| 数据库表结构变化 | 在 `backend/src/db/migrations.ts` 追加 `if (version < N) { …; db.pragma("user_version = N"); }`，覆盖安装后首次启动自动执行 |
| 图标 | **唯一权威源是 `frontend/public/favicon.svg`**（首页 logo 与浏览器标签页 favicon 共用的矢量原图）。改它之后执行 `pnpm icon`：脚本用 headless Chrome/Edge 渲染 1024×1024 透明位图，生成多尺寸 `icon.ico` 与 `icon-preview.png`；`electron/build/icon-source.png` 只是渲染缓存，**不要拿低分辨率截图当图标源**。改完**必须重新打包** `pnpm dist:win`，exe 才会带上新图标 |
| **升级 Electron** | 先确认 `better-sqlite3` 有对应 `electron-v<ABI>` 预编译包（脚本用 `prebuild-install --runtime=electron --target=<新版本>` 下载）；没有则需 MSVC 源码编译或同步升级 `better-sqlite3`。之后 `pnpm install` → `pnpm dist:win`，并用 `ELECTRON_RUN_AS_NODE=1` 复核 `process.versions.modules` 与 SQLite 加载 |

### 升级兼容性硬规则

- **不要改 `appId` / `productName`**：Windows 的 `app.getPath('userData')` 与安装 / 卸载识别都依赖它们，改了会被当成另一个应用，`%APPDATA%/OpenPRD/` 里的历史数据会「看起来丢了」。
- 数据目录恒为 `%APPDATA%/OpenPRD/`；`nsis.deleteAppDataOnUninstall: false` 保证卸载也保留。覆盖安装前建议先备份该目录。
- 内置 Skill 每次从仓库 `skills/` 重新打包（用户自建 `skill-custom-*` 已排除，不会被覆盖）；用户目录里的同名 Skill 优先于内置。
- 每次构建需联网：`prebuild-install` 取 Electron ABI 包、electron-builder 取 Electron / NSIS 资源。可用 `ELECTRON_MIRROR`、`ELECTRON_BUILDER_BINARIES_MIRROR` 走镜像。
- 目前 `publish: null`，**没有自动更新**：新版需要用户手动下载安装（NSIS 覆盖安装会保留数据）。若要接 `electron-updater`，还需代码签名与发布源，并把 `nsis.differentialPackage` 改回 `true` 让差分更新所需的 blockmap 重新生成。

### 发布前最小验收

1. `pnpm dist:win` 退出码 0，两个 exe 存在且大小合理（当前各约 127 MB）。
2. 在**没有 Node / pnpm 的机器**上装新版，确认首页 → SSE 对话 → PRD 生成 → `/prototype/:id` 画布 → 导出可用。
3. 覆盖安装旧版本，确认 `%APPDATA%/OpenPRD/prd.db` 中的会话、PRD、版本、原型都还在。
4. 用 `ELECTRON_RUN_AS_NODE=1 <安装目录>/OpenPRD.exe -e "…"` 复核 ABI 与 `better-sqlite3` 加载。
