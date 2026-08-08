# Electron 桌面应用实现指南

本文档详述 `electron/` workspace 包的完整实现规范，供 AI 在开发 Electron 相关代码时按需读取。

---

## 工具链

| 工具 | 版本 | 职责 |
| --- | --- | --- |
| `electron-vite` | ^3.x | 主进程 + 预加载脚本的 Vite 构建与 HMR |
| `electron-builder` | ^25.x | 跨平台打包（NSIS / DMG / AppImage） |
| `@electron/rebuild` | latest | 针对 Electron ABI 重编译原生模块（better-sqlite3） |

> `electron-vite` 仅负责构建 **main + preload**，渲染进程复用 `frontend/` 的 Vite 配置，两者彼此独立。

---

## 架构原则

| 层级 | 运行位置 | 说明 |
| --- | --- | --- |
| 主进程 | `electron/src/main/index.ts` | 启动 BrowserWindow，内嵌启动 Express 服务 |
| 预加载脚本 | `electron/src/preload/index.ts` | 通过 `contextBridge` 向渲染进程暴露安全 IPC |
| Express 后端 | 主进程内（`import` backend 模块） | 与 Web 模式共用同一份 backend 代码 |
| 渲染进程 | BrowserWindow | 开发时加载 `http://localhost:5173`；生产时加载 `frontend/dist/` |

关键设计：主进程 `import` backend 的 `startServer()` 获得随机可用端口后传给 BrowserWindow，无需独立子进程，无端口冲突风险。

---

## 目录结构（electron/ 包）

```
electron/
├── src/
│   ├── main/
│   │   └── index.ts           # 主进程入口
│   └── preload/
│       └── index.ts           # 预加载脚本
├── electron.vite.config.ts    # electron-vite 构建配置
├── electron-builder.yml       # electron-builder 打包配置
├── package.json
└── tsconfig.json
```

---

## electron.vite.config.ts

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  }
  // 无 renderer 配置：渲染进程由独立的 frontend/ 包负责
})
```

---

## 主进程（electron/src/main/index.ts）

```ts
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { startServer } from 'backend'

let apiPort: number

async function createWindow() {
  if (app.isPackaged) {
    process.env.DB_PATH = join(app.getPath('userData'), 'prd.db')
  }

  apiPort = await startServer()

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(join(__dirname, '../../frontend/dist/index.html'))
  }
}

ipcMain.handle('get-api-port', () => apiPort)

app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

---

## 预加载脚本（electron/src/preload/index.ts）

```ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  getApiPort: () => ipcRenderer.invoke('get-api-port')
})
```

前端在 `main.ts` 中读取端口后配置 axios baseURL：

```ts
if (window.electronAPI) {
  const port = await window.electronAPI.getApiPort()
  axios.defaults.baseURL = `http://localhost:${port}`
}
```

---

## 数据目录

- 开发模式：`backend/data/prd.db`
- 生产打包：`app.getPath('userData')/prd.db`（由主进程在启动时通过 `process.env.DB_PATH` 注入）

---

## API Key 管理（桌面模式）

打包后无 `.env` 文件，通过两种方式提供：

1. **应用内设置页**：用户首次启动时填写，通过 `safeStorage` 加密存入系统钥匙串，主进程读取后写入 `process.env`
2. **系统环境变量回退**：若已设置 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`，主进程直接透传给 Express

---

## 原生模块（better-sqlite3）

```bash
pnpm --filter electron rebuild
```

`electron/package.json`：

```json
{
  "scripts": {
    "rebuild": "electron-rebuild -f -w better-sqlite3"
  }
}
```

`externalizeDepsPlugin()` 确保打包时使用重编译后的原生 `.node` 文件。

---

## 开发命令

```bash
# 开发（两个终端并行）
pnpm --filter frontend dev         # Vite dev server :5173
pnpm --filter electron dev         # electron-vite dev（主进程 HMR）

# 构建
pnpm --filter frontend build
pnpm --filter backend build
pnpm --filter electron build       # electron-vite build

# 打包
pnpm --filter electron dist        # electron-builder

# 重编译原生模块
pnpm --filter electron rebuild
```

---

## electron-builder.yml

```yaml
appId: com.donjet.open-prd
productName: OpenPRD
directories:
  buildResources: build
  output: release/${version}
files:
  - out/
  - '!out/**/*.map'
extraResources:
  - from: ../frontend/dist/
    to: frontend/dist/
  - from: ../backend/dist/
    to: backend/dist/
win:
  target:
    - target: nsis
      arch: [x64]
mac:
  target:
    - target: dmg
      arch: [x64, arm64]
linux:
  target:
    - target: AppImage
      arch: [x64]
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```
