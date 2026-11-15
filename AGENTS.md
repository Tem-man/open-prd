## 项目定位

要开发一个PRD（产品需求文档）生成 Agent，该Agent 能够通过对话深度分析用户零散需求，引导用户补充关键信息，最终生成一份结构化、包含多种专业图表且带有交互界面的HTML 格式 PRD 文档。

---

## 技术栈

| 层级           | 技术                                                                 |
| -------------- | -------------------------------------------------------------------- |
| 前端           | Vue 3.5 + TypeScript +sass+ LangChain.js1.1.46（前端）+pinia3+Vite 8 |
| 后端           | Node.js + Express + LangChain.js1.1.46（后端）+ Daemon 进程管理      |
| Agent          | LangChain.js（默认），预留接口支持切换至本地 Claude Code 或 Codex    |
| 数据持久化存储 | SQLite+ better-sqlite3                                               |
| 模型 Provider  | `@langchain/openai`（GPT-4o）、`@langchain/anthropic`（Claude）      |
| 桌面打包       | Electron 42 + electron-vite 5 + electron-builder 26（Windows NSIS / portable、macOS dmg / zip、Linux AppImage / deb） |
| 原型设计编辑器 | OpenPencil 引擎源码（CanvasKit/Skia WASM + Yoga WASM）+ Tailwind v4  |
| 包管理         | **pnpm only**（禁止使用 npm 安装任何包）                             |

> **重要约束**：所有第三方包的安装只允许使用 `pnpm`，严禁使用 `npm install`。

---

## 模型 Provider 配置

Agent 通过 LangChain.js 官方 Provider 包接入 LLM，按 **API 协议标准** 分为三种接入方式，通过环境变量切换：

| 协议标准    | 包名                   | 兼容厂商示例                                            | 说明                                    |
| ----------- | ---------------------- | ------------------------------------------------------- | --------------------------------------- |
| `openai`    | `@langchain/openai`    | OpenAI、OpenRouter、DeepSeek、SiliconFlow、LM Studio 等 | 凡支持 OpenAI API 格式的服务均可接入    |
| `anthropic` | `@langchain/anthropic` | Anthropic、AWS Bedrock（Anthropic 模型）等              | 凡支持 Anthropic API 格式的服务均可接入 |
| `ollama`    | `@langchain/ollama`    | 所有 Ollama 本地模型（llama3、mistral、qwen 等）        | 本地离线推理，无需 API Key              |

> **接入原则**：`openai` / `anthropic` 均支持自定义 `baseURL`，只需将目标服务的 API 地址填入对应变量，即可无缝切换至任意兼容厂商，无需修改代码。

环境变量在 `backend/.env` 中配置，模板见 `backend/.env.example`：

```env
# 选择协议标准: openai | anthropic | ollama
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o

# OpenAI 标准（适用于 OpenAI、OpenRouter、DeepSeek、SiliconFlow 等兼容服务）
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1   # 切换厂商只需改此地址

# Anthropic 标准（适用于 Anthropic 及兼容服务）
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_BASE_URL=https://api.anthropic.com  # 切换厂商只需改此地址

# Ollama（本地，无需 API Key）
OLLAMA_BASE_URL=http://localhost:11434
```

后端通过统一工厂函数按 `LLM_PROVIDER` 实例化对应的 LangChain ChatModel，上层 Agent 代码只依赖 `BaseChatModel`，无需感知具体厂商。

---

## 开发命令

```bash
# 安装依赖
pnpm install

# 同时启动前端 + 后端（推荐）
pnpm dev

# 单独启动
pnpm --filter frontend dev
pnpm --filter backend dev

# 构建
pnpm --filter frontend build
pnpm --filter backend build

# 桌面应用打包（输出 electron/release/<version>/）
pnpm dist:win              # Windows NSIS + portable (x64)
pnpm dist:mac              # macOS dmg + zip（须在 macOS 主机执行）
pnpm dist:linux            # Linux AppImage + deb（建议在 Linux 主机执行）
pnpm dist:mac -- --arch=arm64   # 指定架构
pnpm dist:win -- --dir    # 仅生成 unpacked 目录，调试用
pnpm icon                 # 由 favicon.svg 生成 icon.ico / icon.icns / icon.png
```

---

## 项目目录结构

```
open-prd/
├── frontend/                          # Vue 3.5 前端应用
│   ├── public/                        # 静态资源（favicon、icons.svg；运行时同步 canvaskit/字体）
│   ├── src/
│   │   ├── assets/                    # 图片等静态资源
│   │   ├── components/                # 跨页面公共组件（PascalCase）
│   │   │   ├── NavBar/                # 顶栏导航
│   │   │   ├── ExportModal/           # PRD 导出
│   │   │   ├── ModuleManager.vue      # PRD 模块管理
│   │   │   ├── ModuleBuilderPanel.vue # 自定义模块构建
│   │   │   ├── SkillEditorPanel.vue   # Skill 编辑
│   │   │   ├── HistoryDrawer.vue      # 历史会话抽屉
│   │   │   ├── VersionDrawer.vue      # PRD 版本管理抽屉（左侧弹出）
│   │   │   ├── QuestionForm.vue       # AI 信息收集表单
│   │   │   ├── ThinkingBlock.vue      # PRD 对话思考过程折叠块
│   │   │   ├── ModelSelector.vue      # PRD 对话输入框模型切换
│   │   │   └── …
│   │   ├── pencil/                    # 原型设计编辑器界面层（见下方专章）
│   │   │   ├── PencilEditor.vue       # 编辑器根组件，挂载 CanvasKit 画布
│   │   │   ├── PencilEditorShell.vue  # 三栏壳层（图层 / 画布 / 属性）
│   │   │   ├── PencilSettingsHost.vue # 设置弹层宿主（含模型配置）
│   │   │   ├── PresentView.vue        # 放映 / 演示视图
│   │   │   ├── pencil.css             # Tailwind v4 入口（作用域限定 .pencil-root）
│   │   │   ├── app/                   # 编辑器应用逻辑
│   │   │   │   ├── ai/                # AI 对话、模型配置、Provider、工具、PRD 依据上下文（prdContext.ts）
│   │   │   │   ├── document/          # 文档 IO、自动保存、导出
│   │   │   │   ├── editor/            # 会话、画布菜单、剪贴板、矢量等
│   │   │   │   ├── settings/          # 凭据与设置对话框
│   │   │   │   └── …
│   │   │   ├── components/            # 编辑器 UI（Layers/Design/Chat/Toolbar/settings…）
│   │   │   └── theme/                 # 编辑器主题
│   │   ├── views/                     # 路由页面（按业务域分子目录）
│   │   │   ├── home/                  # 首页：新建会话、历史入口
│   │   │   │   ├── HomeView.vue
│   │   │   │   └── components/        # 首页专属子组件（如 ConfirmDialog）
│   │   │   ├── session/               # 会话页：对话 + PRD 预览/编辑
│   │   │   │   ├── SessionView.vue
│   │   │   │   └── components/        # Sidebar、PrdPanel、ProgressSteps 等
│   │   │   └── prototype/             # 原型设计页：挂载 PencilEditor
│   │   │       └── PrototypeView.vue
│   │   ├── stores/                    # Pinia（sessions、messages、prdEdit、prdVersions、modules、prototypes）
│   │   ├── composables/               # useSSE、useMermaidZoom、useSectionActions 等
│   │   ├── router/                    # Vue Router
│   │   ├── styles/                    # variables.css、prd-content.scss
│   │   ├── types/                     # 前端 TypeScript 类型
│   │   ├── App.vue
│   │   └── main.ts
│   ├── vite/                          # Vite 插件与别名（引擎源码解析、静态资产同步）
│   │   ├── aliases.ts                 # @open-pencil/* 与 #core/#vue 等指向 packages/*/src
│   │   ├── pencil-assets.ts           # canvaskit.wasm 与内置字体同步到 public/
│   │   ├── pencil-components.ts       # @/components → @pencil/components 改写
│   │   ├── raw-markdown.ts            # .md / .kiwi 按裸文本导入
│   │   ├── empty-node-module.ts       # 浏览器侧 fs / path 空实现
│   │   └── stubs/                     # 浏览器侧 Node API stub
│   ├── index.html
│   └── vite.config.ts
├── packages/                          # 原型设计引擎源码（从 OpenPencil 迁入，无 dist）
│   ├── PENCIL_UPSTREAM.md             # 迁移基线 commit 与本地改动记录（必读）
│   ├── tsconfig.json                  # 引擎与编辑器界面层的统一类型检查配置
│   ├── scene-graph/src/               # 文档模型、变量系统、撤销栈、命中测试
│   ├── kiwi/src/                      # Figma Kiwi 二进制编解码
│   ├── fig/src/                       # .fig 解析与导出
│   ├── pen/src/                       # .pen 原生格式
│   ├── core/src/                      # createEditor()、Skia 渲染、Yoga 布局、IO、导出
│   ├── core/assets/                   # 内置字体（Inter / Noto），运行时由 public/ 提供
│   ├── dom-css/src/                   # HTML / CSS / JSX 投影（「代码」标签页）
│   └── vue/src/                       # Vue 绑定层：画布挂载、输入管线、headless 基元
├── backend/                           # Node.js + Express 后端
│   ├── data/                          # SQLite 库 prd.db（不提交 git）
│   ├── src/
│   │   ├── routes/                    # Express 路由
│   │   │   ├── sessions/              # 会话域（CRUD / SSE 对话 / PRD 读写与版本）
│   │   │   │   ├── index.ts           # 按序 register 子模块，export default router
│   │   │   │   ├── crud.ts            # 会话增删改查与 PATCH modules
│   │   │   │   ├── messages.ts        # POST messages / retry（SSE）
│   │   │   │   ├── prdRead.ts         # GET prd / GET sections
│   │   │   │   ├── versions.ts        # PRD 版本 6 端点
│   │   │   │   ├── sectionEdit.ts     # PATCH 模块 AI 改写（实体/元素/全模块）
│   │   │   │   ├── sectionMutate.ts   # PUT content 与 rollback
│   │   │   │   └── helpers/           # HTML 补丁、提问表单、section 持久化
│   │   │   ├── modules.ts
│   │   │   └── prototypes.ts
│   │   ├── services/
│   │   │   ├── agent/                 # 编排 Agent（createAgent）：driver / orchestrator / history / types
│   │   │   ├── tools/                 # Agent 工具：ask_user_form、generate_prd、list/get/edit_section、search_targets、edit_entity、regenerate/add_section
│   │   │   ├── sectionEditService.ts  # 模块改写 / 元素补丁 / 实体补丁（路由与工具共用）
│   │   │   ├── sectionLocator.ts      # PRD HTML 可寻址索引（search_targets / edit_section locatorId）
│   │   │   ├── pendingActions.ts      # 整份重新生成的服务端两步确认
│   │   │   ├── prdPipeline.ts         # 大纲 → 逐模块生成 → 校验
│   │   │   ├── llm.ts                 # LangChain ChatModel 工厂
│   │   │   ├── llmStream.ts           # 流式 chunk 拆成可见回复 / 思考
│   │   │   ├── prompts.ts             # 系统/阶段 Prompt
│   │   │   ├── contextManager.ts      # 上下文与 Token 管理
│   │   │   ├── skillLoader.ts         # 加载 skills/ 下图表 Skill
│   │   │   ├── moduleBuilder.ts       # 自定义模块构建 Agent
│   │   │   ├── pipelineState.ts       # PRD 生成流水线状态
│   │   │   ├── prototypeStore.ts      # 原型设计文档持久化
│   │   │   ├── sse.ts                 # SSE 流式推送
│   │   │   ├── prdOutline.ts          # PRD 大纲规划
│   │   │   ├── prdValidator.ts        # PRD 产出校验
│   │   │   ├── prdVersions.ts         # PRD 版本管理（Figma Page 模型）
│   │   │   └── prd/                   # PRD 生成与 HTML 渲染
│   │   │       ├── modules/           # 各章节生成器（background、architecture…）
│   │   │       ├── renderer.ts        # 单文件 HTML 组装
│   │   │       └── index.ts
│   │   ├── db/                        # client、schema、migrations
│   │   └── index.ts                   # Express 入口、startServer()
│   ├── .env                           # 环境变量（不提交 git）
│   ├── .env.example
│   └── tsconfig.json
├── daemon/                            # PM2 进程管理（pnpm start/stop/restart）
│   └── ecosystem.config.cjs
├── electron/                          # Electron 桌面壳（electron-vite）
│   ├── src/
│   │   ├── main/index.ts              # BrowserWindow + 内嵌 Express
│   │   └── preload/index.ts           # contextBridge IPC
│   ├── electron.vite.config.ts
│   ├── electron-builder.yml
│   ├── package.json
│   └── tsconfig.json
├── skills/                            # PRD 图表 / 自定义 Skill（运行时由 skillLoader 读取）
│   ├── skill-prd-architecture/
│   ├── skill-prd-flowchart/
│   ├── skill-prd-infoarch/
│   ├── skill-prd-datamodel/
│   ├── skill-prd-prototype/           # 原型设计依据模块 Skill（页面清单/详情/导航/设计规范）
│   ├── skill-mermaid/                 # Mermaid 通用图表 Skill
│   ├── skill-creator/                 # Skill 创建辅助
│   └── skill-custom-*/                # 用户自定义 Skill
├── docs/                              # 设计稿、实现方案与流程说明
│   ├── assets/images/                 # UI 参考截图
│   ├── electron-guide.md
│   ├── implementation-plan.md
│   ├── prd-generation-flow.md
│   ├── plan-*.md                      # 各功能迭代计划
│   └── research-*.md                  # 技术调研笔记
├── pnpm-workspace.yaml                # frontend | backend | daemon | electron | packages/*
└── package.json                       # 根脚本：dev、build、lint、daemon 启停
```

---

## Agent 核心工作流与交互原则

Agent 在与用户交互时，必须严格遵循以下机制：

### 信息诊断与反问机制

1. **前置评估**：接收到用户需求后，首先评估信息是否足以支撑生成完整 PRD。
2. **表单式提问**：当信息不足或存在歧义时，禁止主观臆断，必须向用户输出结构化的"提问表单"。
3. **确认机制**：在关键业务逻辑、核心数据流向等环节，需与用户明确确认后再进入 PRD 生成阶段。

- **工作流程**：理解需求 → 信息查漏补缺（结构化反问）→ 必要时与用户确认关键信息（无歧义则跳过）→ `TodoWrite` → 按 8 个默认模块生成 PRD → 输出单文件 HTML
- **实现方式**：单个编排 Agent（LangChain `createAgent`）+ 细粒度工具，按阶段切换系统提示与可用工具（收集阶段仅 `ask_user_form` / `generate_prd`；PRD 生成后开放读取与编辑工具）。PRD 已存在时整份重新生成必须经服务端两步确认（确认 token 不暴露给模型）。详见 `docs/plan-orchestrator-agent.md`。

### Skill 支持

- Agent 支持引用（`@skill`）和加载 Skill 文件。
- 加载 Skill 后，需按 Skill 内的指令扩展或覆盖默认行为。

---

## 前端样式规范

### 色彩系统

| 用途           | 色值              |
| -------------- | ----------------- |
| 主色           | `#4F46E5`（靛蓝） |
| 成功           | `#10B981`         |
| 警告           | `#F59E0B`         |
| 错误           | `#EF4444`         |
| 背景（主）     | `#FFFFFF`         |
| 背景（次）     | `#F8FAFC`         |
| 背景（第三层） | `#F1F5F9`         |

### 字体

- **字体**：Inter / PingFang SC / Noto Sans SC
- **字号**：标题 18–24px，正文 14px，辅助文字 12px

### 圆角

| 组件   | 圆角值 |
| ------ | ------ |
| 卡片   | 8px    |
| 小按钮 | 6px    |
| 大按钮 | 8px    |
| 气泡   | 12px   |
| 头像   | 50%    |

### 阴影

```css
/* 卡片阴影 */
box-shadow:
	0 1px 3px rgba(0, 0, 0, 0.1),
	0 1px 2px rgba(0, 0, 0, 0.06);

/* 悬浮按钮阴影 */
box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
```

> 具体设计稿参见 `docs/assets/images/`。

### 图标

- **优先使用 Lucide**，除Lucide 无对应图形时外。
- **接入方式**：`unplugin-icons` + `@iconify-json/lucide`（构建期编译为内联 SVG，无 CDN / HTTPS 外链）。不要安装 `@lucide/vue` / `lucide-vue-next`。
- **写法**：模板中直接使用自动导入标签，无需 `import`：

```vue
<icon-lucide-download />
<icon-lucide-globe />
<icon-lucide-x />
```

- 图标名与 [Lucide](https://lucide.dev/icons) / [Iconify lucide](https://icon-sets.iconify.design/lucide/) 一致，前缀固定为 `icon-lucide-`（如 `file-text` → `<icon-lucide-file-text />`）。
- 自动导入范围见 `frontend/vite.config.ts` 的 `IconsResolver`（覆盖 `src/pencil/components` 与 `src/components`）。
- 原型画布里插入的设计素材图标走 `packages/core` 的 Iconify API（`prefix:name`，如 `lucide:heart`），与上述 UI 图标链路不同，不要混用。

---

## PRD 文档结构

生成的 PRD 包含以下 8 个模块（默认结构，支持用户自定义）：

| #   | 模块         | 说明                                                                       |
| --- | ------------ | -------------------------------------------------------------------------- |
| 1   | 背景与目标   | 业务痛点、SMART 目标                                                       |
| 2   | 用户与场景   | 用户画像、使用场景                                                         |
| 3   | 功能清单     | 功能模块 × 功能点 × 优先级表格                                             |
| 4   | 产品架构     | Mermaid `graph TB` 分层架构图                                              |
| 5   | 业务流程     | Mermaid `flowchart TD` 流程图                                              |
| 6   | 信息架构     | markmap.js 思维导图                                                        |
| 7   | 数据模型     | Mermaid `erDiagram` ER 图 + 实体说明表格                                   |
| 8   | 原型设计依据 | 页面清单、页面详情、导航关系与设计规范（供原型设计 AI 代理生成原型稿使用） |

---

## 当需要生成，产品架构图，业务流程图，数据模型，信息架构请使用skills

各图表对应的 Skill 路径：

| 图表类型     | Skill 名称               | 路径                            |
| ------------ | ------------------------ | ------------------------------- |
| 产品架构图   | `skill-prd-architecture` | `skills\skill-prd-architecture` |
| 业务流程图   | `skill-prd-flowchart`    | `skills\skill-prd-flowchart`    |
| 信息架构     | `skill-prd-infoarch`     | `skills\skill-prd-infoarch`     |
| 数据模型     | `skill-prd-datamodel`    | `skills\skill-prd-datamodel`    |
| 原型设计依据 | `skill-prd-prototype`    | `skills\skill-prd-prototype`    |

## 生成对应图表时，先用 Read 工具读取对应 Skill 文件，按其规范输出。

## PRD 输出规范

最终输出为**单一纯静态可交互 HTML 文件**，遵守以下规则：

1. **单文件原则**：所有 CSS 和 JS 内嵌在 HTML 中，禁止依赖外部本地文件。
2. **CDN 依赖**：允许且必须引入以下 CDN：
   - `mermaid.js`：渲染产品架构图、业务流程图、数据模型；需在脚本中执行 `mermaid.initialize()`
   - `markmap-lib` + `markmap-view`：渲染信息架构思维导图
3. **Tab 导航**：包含 8 个 Tab 标签（背景与目标、用户与场景、功能清单、产品架构、业务流程、信息架构、数据模型、原型设计依据），点击标签切换对应模块内容。
4. **自定义结构**：默认 8 个模块，但支持用户在对话中自定义 PRD 结构，Agent 应据此调整输出。

---

## 前后端通信协议

### HTTP API 端点

| 方法   | 路径                                           | 说明                                                    |
| ------ | ---------------------------------------------- | ------------------------------------------------------- |
| POST   | `/api/sessions`                                | 创建新会话，返回 `session_id`                           |
| GET    | `/api/sessions`                                | 获取会话列表                                            |
| GET    | `/api/sessions/:id`                            | 获取会话信息及消息历史                                  |
| POST   | `/api/sessions/:id/messages`                   | 发送消息，触发 SSE 流式响应                             |
| GET    | `/api/sessions/:id/prd`                        | 获取该会话最新生成的 PRD HTML                           |
| GET    | `/api/sessions/:id/prd/versions`               | 版本列表（version DESC）                                |
| POST   | `/api/sessions/:id/prd/versions`               | 新增空白版本（`mode`: `blank`；可选 `copyIntake`）。`duplicate` 无 `fromVersionId` 时复制当前工作区（整份重生成另存） |
| POST   | `/api/sessions/:id/prd/versions/:vid/duplicate` | 复制该版本行（可选 `copyConversation`，信息收集前缀一律保留） |
| POST   | `/api/sessions/:id/prd/versions/:vid/activate` | 切换版本（写回旧版本 + 重建工作区，幂等）               |
| DELETE | `/api/sessions/:id/prd/versions/:vid`          | 物理删除版本（删激活版本自动切到最新剩余版本）          |
| PATCH  | `/api/sessions/:id/prd/versions/:vid`          | 重命名版本备注                                          |

> 版本管理采用 Figma Page 模型：每个版本是独立文档，`prds.html` + `prd_sections` + `messages` 为当前工作区；
> 切换/新建时先把旧激活版本写回其版本行，再用目标版本重建工作区（对话记录随版本走；行内复制指定版本，可选是否带上生成后的会话；顶部新增空白版本，可选是否带上信息收集前缀）。
> 版本仅由用户显式创建，AI 编辑与手动编辑不产生自动快照；唯一例外是懒引导——首次拉取版本列表时
> 若 PRD 已有内容但无任何版本，自动把当前工作区物化为 v1「当前内容」。详见 `docs/plan-prd-version-management.md`、`docs/plan-prd-version-create-options.md`。

### SSE 流式响应规范

对话消息统一使用 **Server-Sent Events（SSE）** 推送 AI 增量输出：

- **请求**：`POST /api/sessions/:id/messages`，`Content-Type: application/json`
  - 可选 `target`：界面选中的模块 / 元素（chip）；元素 DOM 坐标来自点选，或由编辑阶段 `search_targets` 的 locatorId / 服务端唯一标签绑定注入，不经模型伪造
  - 可选 `confirmAction: { token, decision }`：确认卡片提交，路由凭 token 直接执行，不进 Agent
- **响应**：`Content-Type: text/event-stream; charset=utf-8`，关闭 Nginx 缓冲
- **事件 `data.type`**：
  - `delta`：可见回复增量，写入 `Message.content`
  - `thinking`：模型思考 / reasoning 增量，写入 `Message.thinking`（仅展示，下次请求不回传 LLM）
  - `prd_progress` / `prd_ready` / `error` / `done`：进度、完成与错误
  - `section_element_patch_start` / `section_edit_delta` / `section_edit_done` / `section_edit_error`：对话中工具修改模块
  - `session_modules_updated`：对话中新增章节；`prd_versions_changed`：确认执行前另存了新版本
  - 命名事件 `event: form`：结构化提问表单（确认卡片额外携带 `action.token`）

思考内容落在 `messages.thinking`，`loadHistory` 只读 `role, content, meta`；工具中间消息不落库，编辑记录 / 待确认动作写入 `messages.meta`。

---

## 扩展接口（预留，暂不开发）

以下能力已预留接口，无需实现，但代码架构需为其留好扩展点：

- 切换 Agent 驱动至本地 **Claude Code**
- 切换 Agent 驱动至本地 **Codex**

---

## 数据持久化 Schema

使用 SQLite（`better-sqlite3`）持久化会话历史与生成的 PRD，表结构如下：

```sql
-- 会话表
CREATE TABLE sessions (
  id         TEXT    PRIMARY KEY,          -- UUID v4
  title      TEXT    NOT NULL DEFAULT '',  -- 首条用户消息摘要（自动生成）
  created_at INTEGER NOT NULL,             -- Unix 毫秒时间戳
  updated_at INTEGER NOT NULL
);

-- 消息历史表
CREATE TABLE messages (
  id         TEXT    PRIMARY KEY,
  session_id TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role       TEXT    NOT NULL CHECK(role IN ('user', 'assistant')),
  content    TEXT    NOT NULL,
  thinking   TEXT    NOT NULL DEFAULT '', -- 模型思考过程（仅 UI，不回传 LLM）
  meta       TEXT    NOT NULL DEFAULT '{}', -- JSON：编辑记录 edits / 待确认动作 pendingAction / chip 引用 citation
  created_at INTEGER NOT NULL
);

-- PRD 产出表
CREATE TABLE prds (
  id         TEXT    PRIMARY KEY,
  session_id TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  html       TEXT    NOT NULL,             -- 完整单文件 HTML
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- PRD 版本表（Figma Page 模型，详见 docs/plan-prd-version-management.md）
CREATE TABLE prd_versions (
  id            TEXT    PRIMARY KEY,
  prd_id        TEXT    NOT NULL REFERENCES prds(id) ON DELETE CASCADE,
  session_id    TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,           -- 从 1 递增
  label         TEXT    NOT NULL DEFAULT '', -- 用户备注
  source        TEXT    NOT NULL,           -- snapshot / blank
  html          TEXT    NOT NULL,           -- 该版本的完整 HTML
  sections_json TEXT    NOT NULL,           -- 该版本的结构化模块内容（权威数据源）
  messages_json TEXT    NOT NULL DEFAULT '[]', -- 该版本的对话快照（对话随版本走）
  is_active     INTEGER NOT NULL DEFAULT 0, -- 1 = 当前打开在工作区的版本
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_prd_versions_lookup ON prd_versions (prd_id, version DESC);
-- 每篇 PRD 至多一个激活版本（部分唯一索引）
CREATE UNIQUE INDEX idx_prd_versions_active ON prd_versions (prd_id) WHERE is_active = 1;
```

> 数据库文件路径：`backend/data/prd.db`（不提交 git，加入 `.gitignore`）。

---

## 代码规范

- 使用 TypeScript，开启严格模式（`strict: true`）
- Vue 组件使用 Composition API + `<script setup>` 语法
- 样式使用 CSS 变量管理主题色，遵循上方色彩系统
- **图标优先使用 Lucide**（`<icon-lucide-*>`），详见「前端样式规范 / 图标」
- 文件命名：组件使用 PascalCase，工具函数使用 camelCase
- 代码书写要模块化，组件化
- 提交前确保 `pnpm lint` 和 `pnpm typecheck` 通过

---

## 原型设计编辑器（packages/ + frontend/src/pencil）

`/prototype` 路由下的设计编辑器由 [OpenPencil](https://github.com/open-pencil/open-pencil) 的引擎
**源码**驱动，迁移基线与本地改动记录在 [`packages/PENCIL_UPSTREAM.md`](./packages/PENCIL_UPSTREAM.md)，
迁移方案见 [`docs/plan-prototype-editor-migration.md`](./docs/plan-prototype-editor-migration.md)。
**改动 `packages/` 下任何代码前请先读这两份文档。**

### 关键约束

- **引擎包不构建**。`packages/*` 没有 `dist`，Vite 与 TypeScript 通过别名直接读 `src`。
  改一行引擎代码页面就热更新——这是刻意的，不要为它们加回 build 脚本。
- **别名有两处，必须同步**：`frontend/vite/aliases.ts`（运行时解析）与
  `packages/tsconfig.json` + `frontend/tsconfig.app.json` 的 `paths`（类型解析）。
  `@vue/compiler-sfc` 解析 `defineProps<T>()` 的类型导入走的是 tsconfig 而非 Vite 别名，
  两边漏配任意一处都会整片报错。
- **Tailwind 严格限定在 `.pencil-root` 子树内**。`frontend/src/pencil/pencil.css` 只在编辑器组件里
  import，且不引入 preflight（改为手写的作用域 reset），以免冲掉其余页面的 Sass/CSS 变量体系。
- **静态资产不入库**。`canvaskit.wasm` 与内置字体由 `vite/pencil-assets.ts` 从
  `node_modules` / `packages/core/assets` 同步进 `frontend/public/`，已在 `.gitignore` 中排除。
- **`base` 有两种取值，不要随意改默认值**。`frontend/vite.config.ts` 默认 `"./"`（Web 可部署到子路径）；桌面构建由 `scripts/build-desktop.mjs` 注入 `ELECTRON_BUILD=1` 切到 `"/"`。桌面版改由主进程内 Express 以 `http://127.0.0.1:<port>/` 同源托管，`"./"` 在 SPA 深链刷新时会把 `./assets/*` 解析成 `/session/assets/*`；CanvasKit 按 `BASE_URL` 抓取的 `/canvaskit.wasm` 也只有根路径能命中静态目录。旧的「`file://` 下不能用 `/`」约束已随 HTTP 托管方案失效。
- **画布挂载用 `useCanvas(canvasRef, editor)` 配普通 `<canvas>`**，不要用
  `CanvasRoot` / `CanvasSurface`，原因见 `PENCIL_UPSTREAM.md` 的「已知偏差」。

### 类型检查

| 命令                                      | 范围                                                              |
| ----------------------------------------- | ----------------------------------------------------------------- |
| `pnpm --filter frontend typecheck`        | 业务代码（严格），会顺着导入一并检查用到的引擎源码                |
| `pnpm --filter frontend typecheck:pencil` | `packages/*/src` 与 `src/pencil` 全量（放宽了未使用变量等风格项） |

### 已知未完成项

- ~~Electron 生产环境下 `createWebHistory` + `file://` 无法进入 `/prototype`~~ —— 已由桌面版 HTTP 同源托管 + SPA fallback + `ELECTRON_BUILD` base 开关解决（见 `docs/plan-windows-exe-packaging-C.md`）。
- P1 已完成三栏布局 + 图层树 + 设计面板 + 底部工具条；Code/AI 完整能力、持久化、放映、矢量化仍按计划后续阶段推进。
- `@/components/*` 在 `src/pencil/` 源码内会被 Vite 插件改写为 `@pencil/components/*`，避免与业务侧 `src/components` 冲突。

---

## Electron 桌面应用支持

桌面壳层位于 `electron/` workspace 包，工具链为 **Electron 42 + electron-vite 5 + electron-builder 26**，由 `scripts/build-desktop.mjs` 统一编排，支持 **Windows（NSIS + portable）、macOS（dmg + zip）、Linux（AppImage + deb）** 三平台，x64 / arm64。

**平台限制**：macOS dmg 依赖 `hdiutil` 与签名工具链，只能在 macOS 主机构建（脚本会直接拒绝在其它平台执行 `dist:mac`）；Linux 包建议在原生 Linux 或 Docker 中构建。三平台正式发版走 `.github/workflows/desktop-release.yml` 的 matrix（windows-latest / macos-latest / ubuntu-latest）。

**架构要点**：

- 主进程按文件路径 `pathToFileURL(<resources>/backend/dist/index.js)` 动态 `import()` backend，在主进程内启动 Express；**不使用 `file://` 加载页面**
- Express 绑定 `127.0.0.1` 的随机端口，同时提供 `/api/*` 与 `frontend/dist` 静态资源 + SPA fallback，窗口 `loadURL(http://127.0.0.1:<port>/)`；因此前端 40+ 处相对 `fetch('/api/...')` 与 `createWebHistory` 均无需改动
- 后端由 `pnpm --filter backend deploy --prod .packaging/backend` 生成自包含目录，作为 `extraResources` 放在 asar 外；`backend/package.json` 的 `files: ["dist"]` 保证 `.env` / `src` 不进包
- `better-sqlite3` 必须在**隔离副本**上按**目标平台/架构**下载 Electron ABI 预编译包（`electron-v<ABI>-<platform>-<arch>`）后注入 deploy 产物：pnpm deploy 在 Windows 上使用硬链接，直接 rebuild 会污染主仓库 `node_modules`；Electron 42（ABI 146）的 win32-x64 / darwin-x64 / darwin-arm64 / linux-x64 / linux-arm64 预编译包均可用
- 数据由 `app.getPath('userData')` 决定：Windows `%APPDATA%/OpenPRD/`、macOS `~/Library/Application Support/OpenPRD/`、Linux `~/.config/OpenPRD/`（`prd.db`、`prototypes/*.fig`、`skills/`、`.env`、`logs/`），覆盖升级与卸载均保留
- 图标唯一权威源是 `frontend/public/favicon.svg`，`pnpm icon` 由它生成 `icon.ico`（Windows）、`icon.icns`（macOS）、`icon.png`（Linux）

**命令**：

```bash
pnpm dist:win              # Windows NSIS + portable，输出 electron/release/<version>/*.exe
pnpm dist:mac              # macOS dmg + zip（仅 macOS 主机）
pnpm dist:linux            # Linux AppImage + deb（建议 Linux 主机）
pnpm dist:mac -- --arch=arm64     # 指定架构
pnpm dist:win -- --dir     # 仅生成 unpacked 目录，调试用
pnpm icon                  # 由 favicon.svg 生成三平台图标
```

> 完整设计与实施记录见 [`docs/plan-windows-exe-packaging-C.md`](./docs/plan-windows-exe-packaging-C.md)，桌面壳实现说明见 [`docs/electron-guide.md`](./docs/electron-guide.md)。

<!-- OPENWIKI:START -->

## OpenWiki

This repository has a generated `openwiki/` evidence index. It is optional just-in-time context, not required startup reading.

- Do not enumerate, preload, or search wikis at task start. Use retrieval when the user asks for it, when unfamiliar architecture or dependency behavior materially affects the task, or when source inspection leaves an important uncertainty. Stop once the question is grounded.
- When those conditions apply and OpenWiki retrieval tools are available, use `openwiki_search` for just-in-time context and `openwiki_read` for the relevant complete sections. If search returns `workspace_required`, ask which listed workspace to use and retry with its ID.
- Use `openwiki_list_workspaces` or `openwiki_list_wikis` when workspace membership itself needs to be discovered.
- If the retrieval tools are unavailable, read `openwiki/quickstart.md` and follow its links to the relevant pages.
- Treat source code and tests as authoritative. A brief's unknowns and review items are verification gaps, not automatic requirements.
- Prefer the narrowest quiet validation that proves the changed behavior. Preserve complete failure output.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->
