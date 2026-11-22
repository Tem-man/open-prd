# Open PRD

**把零散的产品想法变成一份完整、可交互的 PRD，再进一步变成可点击的原型。**

简体中文 · [English](./README.md)

Open PRD 是一个本地优先的桌面 / Web 应用，面向产品经理、创业者和设计师。它不是把一句话丢给大模型碰运气，而是先「采访」你：用结构化表单补齐缺失信息，对关键决策做明确确认，然后生成一份包含架构图、业务流程图、信息架构脑图和数据模型的 PRD——全部打包进一个可交互的 HTML 文件。内置的设计编辑器还能以 PRD 为依据，把「原型设计依据」章节变成真正的原型。

## 核心特性

- **引导式需求澄清** —— 生成前先给结构化提问表单，关键环节要求显式确认，不做主观臆断。
- **8 个标准模块，可自由定制** —— 背景与目标、用户与场景、功能清单、产品架构、业务流程、信息架构、数据模型、原型设计依据；还可通过 Skill 手动新增、AI 生成或导入自己的模块。
- **真正的专业图表** —— Mermaid 绘制架构图 / 流程图 / ER 图，markmap 绘制信息架构脑图，导出后直接在 HTML 中渲染。
- **单文件交互导出** —— Tab 切换的 HTML，CSS / JS 全部内嵌，离线可看；同时支持 Markdown、PDF 与 Word。
- **对话式编辑** —— 在预览中点选模块或元素，用对话让 AI 改写；内置类似 Figma Page 的版本管理。
- **内置原型编辑器** —— 基于 OpenPencil 引擎（CanvasKit / Skia WASM + Yoga WASM），具备图层树、属性面板、结合 PRD 上下文的 AI 对话、JSX / Tailwind 代码输出、自动保存与放映模式。
- **模型自由切换** —— 在应用内的设置里添加服务商与 API Key，为设计、PRD、审阅、轻量任务、视觉分别指定模型；凭据存在浏览器加密存储，不绑定单一厂商。
- **全平台桌面安装包** —— Windows（NSIS + 便携版）、macOS（dmg + zip）、Linux（AppImage + deb），由 GitHub Actions 原生构建。
- **本地优先，数据私有** —— 会话与 PRD 存在本地 SQLite，无需账号、不上传云端。

## PRD 流程界面预览

**PRD 工作台首页：新建或接着编辑已有文档**

![PRD 工作台](./screenshots/home.png)

**会话页：左侧对话，右侧实时 PRD 预览**

![新建会话](./screenshots/session-start.png)

**结构化信息收集：生成之前先让 AI 把关键信息问清楚**

![结构化提问表单](./screenshots/question-form.png)

**生成结果：背景与目标章节，左侧仍可继续对话修改**

![生成的 PRD](./screenshots/prd-preview.png)

**数据模型：Mermaid ER 图与实体字段表格**

![数据模型](./screenshots/data-model.png)

**导出为交互 HTML、Markdown、PDF 或 Word**

![导出对话框](./screenshots/export.png)

## 工作流程

1. **描述想法** —— 越 rough 越好，产品类型、目标用户、核心场景，想到什么写什么。
2. **回答结构化问题** —— Agent 检查信息缺口，给出下拉框、多选、填空组合的提问表单。
3. **确认关键决策** —— 遇到有歧义的业务规则或数据流向，它会列出选项等你拍板。
4. **开始生成** —— 先规划大纲，再逐模块生成；架构、流程、信息架构、数据模型分别调用对应的图表 Skill。
5. **审阅与修改** —— 在预览里手动编辑某个章节，或在对话中让 AI 改指定元素；随时切换已保存的版本。
6. **导出或做原型** —— 下载交互 HTML，或者以 PRD 为依据打开原型编辑器继续设计。

## 开始使用

### 方式一：桌面安装包（推荐）

从 [GitHub Releases](https://github.com/Tem-man/open-prd/releases) 下载对应系统的安装包：

| 系统 | 产物 |
| --- | --- |
| Windows | `OpenPRD-Setup-<版本>.exe`（安装版）、`OpenPRD-Portable-<版本>.exe`（便携版） |
| macOS | `OpenPRD-<版本>-arm64.dmg`、`OpenPRD-<版本>-x64.dmg`（另有 `.zip`） |
| Linux | `OpenPRD-<版本>-x86_64.AppImage`、`OpenPRD-<版本>-amd64.deb` |

> **安装包未签名。** macOS 上需右键 → 打开，或执行 `xattr -cr /Applications/OpenPRD.app`；Windows 可能弹 SmartScreen，选择「更多信息 → 仍要运行」；Ubuntu 24.04+ 运行 AppImage 需先装 `sudo apt install libfuse2t64`。

### 方式二：源码运行

环境要求：**Node.js 24.9.0**（见 `.nvmrc`）与 **pnpm**。不支持 `npm`。

```bash
nvm use 24.9.0          # 或 fnm use
pnpm install
pnpm dev
```

然后打开 <http://localhost:5173>，后端默认监听 `3000` 端口。模型和 API Key 都在应用内配置（见下节），**不需要创建 `backend/.env`**。

如果切换到其他 Node 大版本后 `pnpm dev` 报 `NODE_MODULE_VERSION` 不匹配，执行一次 `pnpm fix:native` 即可。

### 模型配置

模型在**应用内配置**，不需要写 `backend/.env`，也不需要把 API Key 落盘成环境变量。

点击右上角的齿轮图标打开 **设置**，进入 **AI & agents**：

![模型设置](./screenshots/model-settings.png)

- **Models（模型）**：点 **+ Add model** 添加服务商连接（如 DeepSeek、OpenRouter 或任意 OpenAI 兼容服务），填入凭据并选择具体模型；每项会显示连接状态。
- **Assignments（分配）**：为不同工作指定模型——**Design agent**（AI 对话与画布编辑）、**PRD agent**（对话与 PRD 生成）、**Review**（方案与设计审阅）、**Fast tasks**（低成本后台任务）、**Vision**（视觉能力）。后三项可继承 Design 模型（「Same as Design」）或留空。

开启 **Remember credentials on this browser** 后，凭据保存在**浏览器加密存储**中，不会写入后端，也不会进入代码仓库。

日常使用时，直接在对话输入框下方的模型选择器里切换当前模型，无需再打开设置：

![模型选择器](./screenshots/model-selector.png)

## PRD 文档结构

默认输出八个章节，也可以在对话中增删或改名。

| # | 章节 | 内容 |
| --- | --- | --- |
| 1 | 背景与目标 | 业务痛点、SMART 目标 |
| 2 | 用户与场景 | 用户画像、典型使用场景 |
| 3 | 功能清单 | 功能模块 × 功能点 × 优先级表格 |
| 4 | 产品架构 | Mermaid `graph TB` 分层架构图 |
| 5 | 业务流程 | Mermaid `flowchart TD` 流程图 |
| 6 | 信息架构 | markmap 思维导图 |
| 7 | 数据模型 | Mermaid `erDiagram` + 实体说明表格 |
| 8 | 原型设计依据 | 页面清单、页面详情、导航关系与设计规范，供原型 AI 使用 |

## 模块与 Skill

上面八个章节只是默认配置。从工具栏打开 **Modules（模块）** 对话框即可增删、拖拽排序和定制：左侧的「已选模块」就是这篇 PRD 最终会包含的章节，顺序也完全一致。

![模块管理：手动添加、AI 生成或导入 Skill](./screenshots/module-skills.png)

每个模块背后都对应一个 **Skill**——一个 Markdown 指令文件，告诉 PRD Agent 这个章节该写什么、画什么图、按什么结构组织。内置模块自带 Skill 且不可删除。有三种方式扩充模块库：

- **Add manually（手动添加）**：填写名称和简短描述，自动生成一份空白的自定义 Skill。
- **Create with AI（AI 生成）**：回答两个问题，Agent 自动为新模块生成 Skill。
- **Import Skill（导入）**：上传已有的 `.md` 文件，并为模块命名。

自定义 Skill 后续可以继续编辑；内置 Skill 也能复制成可编辑的用户副本。它们是一一对应的关系：**一个 Skill → 一个模块 → PRD 中的一个章节**。例如把「竞品分析」加入已选列表，生成的 PRD 就会多出这一节。

## 原型设计编辑器

Open PRD 在 `/prototype` 路由下内置了一整套设计编辑器，由 OpenPencil 引擎（CanvasKit / Skia WASM + Yoga WASM）驱动。它不是静态原型查看器：你可以创建画板、编辑矢量图层、用 AI 驱动修改、复制可直接使用的代码，并放映演示。PRD 的「原型设计依据」章节会作为上下文接入，因此 AI 是围绕你已确认的页面和设计规范来设计，而不是凭空猜测。

### 三栏设计画布

![原型编辑器：图层树与属性面板](./screenshots/prototype-editor.png)

左侧是页面列表与可折叠的图层树，中间是带标尺和画板的无限画布，右侧是属性面板。选中画板（例如 iPhone 13 & 14）后可调整位置、自动布局、尺寸、裁剪、对齐与外观。底部浮动工具栏提供选择、画板、形状、钢笔、文本、手型和评论工具。

### 看得见选中对象的 AI 编辑

![带可展开推理步骤的 AI 编辑](./screenshots/prototype-ai.png)

把右侧面板切到 **AI**，选择模型，用自然语言描述要改的内容。Agent 会读取当前选中的节点、向上追溯父级上下文，逐步展示 Thinking / Get Node / Eval 等可展开的过程，然后把修改应用到画布。由于结合了 PRD 上下文，它知道这个页面是做什么的，而不是靠像素位置瞎猜。

### 设计稿直接转代码

![JSX 与 Tailwind 代码](./screenshots/prototype-code.png)

**Code** 标签会把当前设计投影为带 Tailwind class 的 JSX。节点保留 `data-name` 标记，结构清晰可读，可以直接导入或复制到项目里，不用照着设计稿手工还原。

### 交互式演示

![单页放映视图](./screenshots/prototype-present.png)

放映模式会隐藏编辑器界面，一次只显示一个页面，并提供适应窗口、页面切换和全屏控制——适合带着干系人走查流程，或在真实页面里验证交互。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | Vue 3.5、TypeScript、Sass、Vite 8、Pinia 3、LangChain.js |
| 后端 | Node.js、Express、LangChain.js、PM2 守护进程 |
| 持久化 | SQLite + better-sqlite3 |
| 模型 Provider | `@langchain/openai`、`@langchain/anthropic`、`@langchain/ollama` |
| 原型引擎 | OpenPencil 源码 —— CanvasKit / Skia WASM、Yoga WASM、Tailwind v4 |
| 桌面端 | Electron 42、electron-vite 5、electron-builder 26 |
| 包管理 | **仅 pnpm**（不支持 `npm install`） |

## 开发命令

```bash
pnpm dev                        # 前端 + 后端一起启动
pnpm --filter frontend dev      # 仅前端（http://localhost:5173）
pnpm --filter backend dev       # 仅后端（http://localhost:3000）
pnpm build                      # 前后端生产构建
pnpm lint
pnpm typecheck

pnpm dist:win                   # Windows NSIS + 便携版
pnpm dist:mac                   # macOS dmg + zip（须在 macOS 主机执行）
pnpm dist:linux                 # Linux AppImage + deb（建议 Linux 主机）
pnpm icon                       # 从 frontend/public/favicon.svg 重新生成图标
```

桌面安装包由 [`.github/workflows/desktop-release.yml`](./.github/workflows/desktop-release.yml) 在各平台原生构建。推送 `v*` 标签会自动构建全部四个目标并发布带校验和的 GitHub Release；也可以在 Actions 页面点 **Run workflow** 并勾选 `publish_release` 手动发布。

## 数据存在哪里

所有数据都留在本地。桌面版按操作系统放到应用数据目录：

| 系统 | 路径 |
| --- | --- |
| Windows | `%APPDATA%/OpenPRD/` |
| macOS | `~/Library/Application Support/OpenPRD/` |
| Linux | `~/.config/OpenPRD/` |

其中包含 `prd.db`、原型文件、自定义 Skill、`.env` 与日志，升级和卸载都会保留。开发模式下数据库位于 `backend/data/prd.db`（已加入 `.gitignore`）。

## 其他说明

- 原型编辑器的实现细节与上游改动记录见 [`packages/PENCIL_UPSTREAM.md`](./packages/PENCIL_UPSTREAM.md)。
- 桌面打包的设计与踩坑记录见 [`docs/electron-guide.md`](./docs/electron-guide.md)。
- 本仓库目前未附带 License 文件。

---

**English README：[README.md](./README.md)**
