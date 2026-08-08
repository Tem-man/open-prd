# PRD 生成 Agent — 分阶段代码实施计划

> 基于 `AGENTS.md` 技术约束，按交付价值由低依赖到高依赖顺序排列。
> 每阶段结束后，项目应处于**可独立运行/可验证**的状态。

---

## Phase 1 · 基础设施搭建

**目标**：跑通 monorepo 骨架，前后端均可启动，数据库表就绪。

### 1.1 Monorepo 初始化

- [ ] 创建根 `package.json`，设置 `name: "open-prd"`，`private: true`
- [ ] 创建 `pnpm-workspace.yaml`，声明 `packages: ["frontend", "backend", "daemon", "electron"]`
- [ ] 根目录 `.gitignore`：忽略 `node_modules/`、`backend/data/`、`**/.env`、`dist/`

### 1.2 后端脚手架（`backend/`）

- [ ] 初始化 `package.json`，name: `backend`
- [ ] 配置 `tsconfig.json`：`strict: true`，`module: NodeNext`，`outDir: dist`
- [ ] 安装依赖：
  ```bash
  pnpm --filter backend add express better-sqlite3 uuid dotenv
  pnpm --filter backend add @langchain/core @langchain/openai @langchain/anthropic
  pnpm --filter backend add -D typescript @types/express @types/better-sqlite3 @types/node tsx
  ```
- [ ] 创建 `backend/.env.example`：
  ```env
  LLM_PROVIDER=openai
  LLM_MODEL=gpt-4o
  OPENAI_API_KEY=sk-...
  ANTHROPIC_API_KEY=sk-ant-...
  PORT=3000
  ```
- [ ] 实现 `src/index.ts`：导出 `startServer(port?: number): Promise<number>` 函数，返回实际监听端口；同时支持直接运行（`node dist/index.js`）时自动调用 `startServer()`
  > Electron 主进程通过 `import { startServer } from 'backend'` 内嵌启动 Express，必须以函数形式导出而非模块顶层副作用启动
- [ ] 健康检查：`GET /health` 返回 200

### 1.3 数据库初始化（`backend/src/db/`）

- [ ] `schema.ts`：定义 `CREATE TABLE` SQL（sessions / messages / prds）
- [ ] `client.ts`：初始化 better-sqlite3，首次运行自动建表
- [ ] `backend/data/` 加入 `.gitignore`

### 1.4 前端脚手架（`frontend/`）

- [ ] 使用 Vite 创建 Vue 3.5 + TypeScript 项目
  ```bash
  pnpm create vite frontend --template vue-ts
  ```
- [ ] 安装依赖：
  ```bash
  pnpm --filter frontend add vue-router pinia
  pnpm --filter frontend add -D @vitejs/plugin-vue
  ```
- [ ] 配置 `vite.config.ts`：开发代理 `/api → http://localhost:3000`
- [ ] 建立 `src/` 目录骨架：`components/`、`views/`、`stores/`、`composables/`、`types/`
- [ ] 创建 CSS 变量文件 `src/styles/variables.css`，写入 AGENTS.md 色彩系统

### 1.5 Daemon 配置（`daemon/`）

- [ ] 安装 PM2：`pnpm --filter daemon add -D pm2`
- [ ] 创建 `daemon/ecosystem.config.cjs`：配置后端进程名、入口、`watch`、`restart_delay`
- [ ] 在根 `package.json` 中添加脚本：`start`、`stop`、`restart`

### 1.6 Electron 脚手架（`electron/`）

- [ ] 初始化 `electron/package.json`，name: `electron`，main: `out/main/index.js`
- [ ] 安装依赖：
  ```bash
  pnpm --filter electron add -D electron electron-vite electron-builder @electron/rebuild typescript
  ```
- [ ] 配置 `electron/tsconfig.json`：`strict: true`，`module: CommonJS`
- [ ] 创建 `electron/electron.vite.config.ts`（参见 `docs/electron-guide.md`）
- [ ] 创建 `electron/src/main/index.ts`：最简骨架，启动空白 BrowserWindow
- [ ] 创建 `electron/src/preload/index.ts`：最简骨架，暴露 `getApiPort` IPC
- [ ] 在 `electron/package.json` scripts 中添加 `dev`、`build`、`dist`、`rebuild`

**阶段验收**：`pnpm --filter backend dev` 启动正常，`GET /health` 返回 200；前端 `pnpm --filter frontend dev` 页面空白但无报错；`pnpm --filter electron dev`（先启动 frontend dev）能打开空白 Electron 窗口。

---

## Phase 2 · 后端 LLM 层 & SSE 通道

**目标**：后端能与 LLM 通信并通过 SSE 将流式结果推送给前端。

### 2.1 LLM 工厂函数（`backend/src/services/llm.ts`）

- [ ] 读取 `LLM_PROVIDER` 环境变量，按**协议标准**（而非厂商）分支
- [ ] `openai` 分支：使用 `@langchain/openai` 的 `ChatOpenAI` 实例化
  - 从 `OPENAI_API_KEY` 读取密钥
  - 从 `OPENAI_BASE_URL` 读取端点（默认 `https://api.openai.com/v1`），可无缝切换至 OpenRouter、DeepSeek、SiliconFlow、LM Studio 等任意 OpenAI 兼容服务
- [ ] `anthropic` 分支：使用 `@langchain/anthropic` 的 `ChatAnthropic` 实例化
  - 从 `ANTHROPIC_API_KEY` 读取密钥
  - 从 `ANTHROPIC_BASE_URL` 读取端点（默认 `https://api.anthropic.com`），可切换至任意 Anthropic 兼容服务
- [ ] `ollama` 分支：使用 `@langchain/ollama` 的 `ChatOllama` 实例化，从 `OLLAMA_BASE_URL` 读取本地服务地址（默认 `http://localhost:11434`），无需 API Key
- [ ] 未识别的 `LLM_PROVIDER` 值时抛出明确错误信息，提示可选值
- [ ] 导出统一的 `createChatModel()` 工厂函数，返回类型为 `@langchain/core` 的 `BaseChatModel`

### 2.2 SSE 工具函数（`backend/src/services/sse.ts`）

- [ ] `writeDelta(res, content)`：写 `data: {"type":"delta","content":"..."}` 事件
- [ ] `writeDone(res, prdGenerated)`：写 `done` 事件并关闭流
- [ ] `writePrdReady(res, prdId)`：写 `prd_ready` 事件
- [ ] `writeError(res, message)`：写 `error` 事件并关闭流
- [ ] 设置响应头：`Content-Type: text/event-stream`，禁止缓存

### 2.3 会话 & 消息路由（`backend/src/routes/sessions.ts`）

- [ ] `POST /api/sessions`：创建会话，写入 `sessions` 表，返回 `{ id, title, createdAt }`
- [ ] `GET /api/sessions`：返回会话列表（按 `updated_at` 倒序）
- [ ] `GET /api/sessions/:id`：返回会话详情 + 消息历史
- [ ] `POST /api/sessions/:id/messages`：
  1. 将用户消息写入 `messages` 表
  2. 从 `messages` 表加载历史，使用 `@langchain/core` 的 `HumanMessage` / `AIMessage` 构建消息数组
  3. 调用 LangChain `model.stream()`，逐 chunk 通过 SSE 推送 `delta`
  4. 流结束后将完整回复写入 `messages` 表，发送 `done` 事件
- [ ] `GET /api/sessions/:id/prd`：查询 `prds` 表，返回最新 HTML

**阶段验收**：用 `curl` 或 Postman 发送消息，终端能看到 LLM 流式输出分块推送。

---

## Phase 3 · 前端开发

**目标**：实现完整前端应用，包括首页、双栏会话界面、PRD 预览与导出，与后端 SSE 联通实现流式渲染。严格还原 `docs/assets/images/` 中的 5 张设计稿。

> **设计稿速览**：
>
> - `01` 首页：顶部导航栏 + PRD 卡片网格，`+ 新建 PRD` 按钮
> - `02` 会话初始态：左侧对话栏（AI 欢迎语）+ 右侧 PRD 空状态占位
> - `03` 对话进行中：进度步骤条 + 结构化反问表单 + 右侧大纲树
> - `04` PRD 完成态：步骤全部打勾 + 右侧实际 PRD 内容，可继续对话
> - `05` 导出弹窗：三种格式选择（HTML / Markdown / PDF）

### 3.1 路由配置（`frontend/src/router/index.ts`）

- [ ] `/` → `HomeView`（PRD 卡片列表 + `+ 新建 PRD` 入口）
- [ ] `/session/:id` → `SessionView`（双栏对话界面）

### 3.2 类型定义（`frontend/src/types/index.ts`）

- [ ] `Session`：`{ id, title, status, createdAt, updatedAt }`
- [ ] `Message`：`{ id, sessionId, role: 'user'|'assistant', content, createdAt, isStreaming? }`
- [ ] `PrdOutline`：`{ sections: Array<{ id, title, keyPoints }> }`
- [ ] `WorkflowStep`：`{ id, label, status: 'pending'|'active'|'done' }`

### 3.3 状态管理（`frontend/src/stores/`）

- [ ] `sessions.ts`：
  - 会话列表（`GET /api/sessions`）、当前会话
  - `createSession()`：`POST /api/sessions`，成功后路由跳转 `/session/:id`
  - `deleteSession(id)`、`updateTitle(id, title)`
- [ ] `messages.ts`：
  - 当前会话消息列表（`GET /api/sessions/:id`）
  - `appendDelta(msgId, chunk)`：流式追加 AI 回复文本
  - `finalizeMessage(msgId)`：流结束时关闭 `isStreaming`
  - `prdReady`：`ref<string | null>`，存储最新 `prdId`
  - `workflowSteps`：10 个步骤的当前状态（理解需求 / 查漏补缺 / 7 个 PRD 模块 / 输出 PRD），随 SSE 事件更新

### 3.4 SSE 组合式函数（`frontend/src/composables/useSSE.ts`）

- [ ] 封装 `fetch` + `ReadableStream` 消费 SSE（不使用 `EventSource`）
- [ ] 解析 `delta` → 调用 `messages.appendDelta`
- [ ] 解析 `done` → `messages.finalizeMessage`，更新 `workflowSteps`
- [ ] 解析 `prd_ready` → 设置 `messages.prdReady`，右侧面板切换为 PRD 内容
- [ ] 解析 `error` → 页面内 Toast 提示（不使用 `alert`）
- [ ] 暴露 `sendMessage(sessionId, text)`，返回 Promise

### 3.5 首页（`frontend/src/views/HomeView.vue`）

> 还原设计稿 `01`

- [ ] 顶部导航栏：
  - 左：`P` 图标 + `PRD Craft` 品牌名，导航 Tab（最近 / 我的PRD / 示例）
  - 右：搜索框（占位文字「搜索 PRD...」）、图标组、用户头像
- [ ] 主内容区：
  - 标题「最近编辑」+ PRD 数量文字 `共 N 个 PRD 文档`
  - `+ 新建 PRD` 按钮（primary 色，右上角）
  - PRD 卡片网格（4列，响应式降为 2列）
    - 卡片上半：彩色渐变预览区（蓝/绿/黄/紫等不同色系）+ 居中「PRD 封面预览」文字
    - 卡片下半：PRD 标题、风格标签（灰底）、状态标签（`进行中`绿/`已完成`蓝/`失败`红/`已取消`灰）、相对时间
  - 点击卡片 → 跳转 `/session/:id`
  - 点击`+ 新建 PRD` → 调用 `sessions.createSession()`

### 3.6 会话页整体布局（`frontend/src/views/SessionView.vue`）

> 还原设计稿 `02～05`，双栏 fixed 布局

- [ ] 整体：`display: flex; height: 100vh; overflow: hidden`
- [ ] 左侧栏（`width: 340px; flex-shrink: 0`）：渲染 `<SessionSidebar>`
- [ ] 右侧面板（`flex: 1`）：渲染 `<PrdPanel>`
- [ ] 进入时调用 `GET /api/sessions/:id` 加载历史消息

### 3.7 左侧对话栏（`frontend/src/components/SessionSidebar.vue`）

> 还原设计稿 `02～04` 左侧区域

- [ ] **顶部 Header**：
  - 返回箭头（`←`，点击回首页）
  - 会话标题（可点击编辑，`contenteditable`）
  - 铅笔图标
- [ ] **历史会话折叠区**：
  - `历史会话` 标签 + 折叠/展开箭头
  - 展开后列出同 session 历史轮次摘要（取 assistant 消息前 20 字）
- [ ] **对话 / 评论 Tab 切换**（当前仅实现「对话」Tab）
- [ ] **进度步骤条 `<ProgressSteps>`**（仅当有消息时显示）：
  - 10 步：理解需求 → 查漏补缺 → 背景与目标 → 用户与场景 → 功能清单 → 产品架构 → 业务流程 → 信息架构 → 数据模型 → 输出 PRD
  - `pending` 灰色数字，`active` 蓝色高亮，`done` 绿色勾
- [ ] **消息列表 `<MessageList>`**：
  - assistant 消息：左对齐，圆形 `AI` 头像（靛蓝背景），白底气泡，支持 Markdown 渲染（加粗/列表/代码块）
  - user 消息：右对齐，用户头像圆圈，靛蓝背景气泡，白色文字
  - 结构化反问表单作为特殊 assistant 消息渲染（含 `<select>` 下拉 + `<textarea>`，橙色警示头）
  - 流式输出时末尾显示 `<TypingIndicator>`
  - 新消息到来时自动滚底
- [ ] **底部输入区 `<MessageInput>`**：
  - 左侧：附件图标、麦克风图标（占位，暂不实现功能）
  - 中间：`<textarea>` 自动撑高，占位文字「描述你的产品需求...」/ 「继续对话...」（PRD 生成后切换）
  - 右侧：发送按钮（靛蓝圆形，内含箭头图标）
  - `Enter` 发送，`Shift+Enter` 换行
  - 发送中禁用输入框和按钮

### 3.8 右侧 PRD 面板（`frontend/src/components/PrdPanel.vue`）

> 还原设计稿 `02～05` 右侧区域

- [ ] **顶部 Header**：
  - 左：`设计文件` 灰色标签
  - 中：会话标题（`H2`）
  - 右：刷新图标、复制图标；PRD 生成前为空，生成后变为蓝色填充的 `导出 HTML` 按钮
- [ ] **7 个 Tab 导航**（背景与目标 / 用户与场景 / 功能清单 / 产品架构 / 业务流程 / 信息架构 / 数据模型）：
  - 点击切换内容区
  - 激活 Tab 下方蓝色下划线
- [ ] **内容区三态**：
  1. **空状态**（PRD 未生成）：文档图标 + 「PRD 内容将在此实时生成」+ 「查看结构大纲」链接 → 展开大纲树
  2. **大纲树态**（生成中/点击查看大纲）：展示 `<PrdOutlineTree>`，7 个模块可折叠展开，子节点为 `keyPoints`
  3. **PRD 内容态**（`prd_ready` 触发后）：`<iframe srcdoc>` 渲染完整 HTML，高度撑满面板
- [ ] **导出弹窗 `<ExportModal>`**（点击「导出 HTML」按钮触发）：
  - 遮罩 + 居中卡片（圆角 12px，白底，阴影）
  - 标题「导出 PRD」+ 关闭按钮
  - 三个格式选项（单选 radio 卡片样式）：
    - `HTML 网页`（默认选中）—「完整的交互式网页，保留所有样式和图表」
    - `Markdown` —「纯文本格式，适合导入 Notion、GitHub 等」
    - `PDF 文档` —「适合打印和正式交付的版式文档」
  - 底部：`取消` 文字按钮 + `确认导出` primary 按钮
  - 点击确认后触发 `<a download>` + Blob URL 下载

### 3.9 公共小组件

- [ ] `TypingIndicator.vue`：三个圆点弹跳动画（CSS keyframes）
- [ ] `ProgressSteps.vue`：接收 `steps: WorkflowStep[]` prop，横向排列，步骤间连线
- [ ] `PrdOutlineTree.vue`：接收 `outline: PrdOutline` prop，可折叠树形列表，图标区分模块类型

**阶段验收**：

- 首页展示会话卡片，点击 `+ 新建 PRD` 可创建新会话并跳转
- 会话页左右双栏布局正确，消息历史刷新后保留
- 发送消息后 AI 回复字符逐步出现（流式），进度步骤条随之推进
- 结构化反问表单可正常填写并提交
- PRD 生成完成后右侧面板自动切换为 PRD 内容
- 导出弹窗三种格式可选，点击「确认导出」触发下载

---

## Phase 4 · Agent 核心逻辑

**目标**：后端 Agent 具备信息诊断、结构化反问、确认机制，能加载 Skill 扩展行为，并通过上下文工程管理长对话质量；同时具备 SSE 重连与流中断恢复能力，保障对话阶段的连接可靠性。

### 4.1 系统提示词（`backend/src/services/prompts.ts`）

- [ ] 定义 `SYSTEM_PROMPT`：
  - 角色定位（PRD 生成专家）
  - 信息诊断规则（何时反问、何时确认）
  - 输出格式规则（结构化提问表单 Markdown 格式）
  - PRD 触发条件（何时开始生成 PRD）

### 4.2 Skill 加载与注入（`backend/src/services/skillLoader.ts`）

- [ ] 实现 `loadSkill(skillName: string): string`：
  - 从 `skills/<skillName>/SKILL.md` 同步读取文件内容
  - 找不到文件时抛出明确错误，避免静默失败
- [ ] 实现 `buildSkillBlock(skillName: string): string`：
  - 将 Skill 内容包裹为 `<skill name="...">...</skill>` XML 块
  - 供注入 System Prompt 时结构清晰
- [ ] 在 `agent.ts` 中按需动态加载 Skill：
  - 当 Agent 判断需要生成某类图表时，加载对应 Skill（`skill-prd-architecture` 等）
  - 将 Skill 块追加至当次调用的 System Prompt 末尾（不污染基础 `SYSTEM_PROMPT`）
  - 生成完成后不保留 Skill 注入，保持上下文干净

### 4.3 上下文工程（`backend/src/services/contextManager.ts`）

长对话中消息历史会持续增长，需主动管理传入 LLM 的上下文窗口：

- [ ] **Token 估算**：实现 `estimateTokens(messages: BaseMessage[]): number`，用字符数 / 3 快速估算（无需精确 tokenizer）
- [ ] **历史裁剪策略**：实现 `trimHistory(messages, maxTokens)`：
  - 始终保留 System Prompt + 最新一条用户消息（不可裁剪）
  - 从最旧的消息开始丢弃，直到 token 总量降至 `maxTokens`（默认 12 000）
  - 若对话中存在已确认的关键信息摘要消息（`role: assistant`，带特殊标记），优先保留
- [ ] **关键信息摘要**：当裁剪发生时，先调用一次独立 LLM 请求生成已收集信息的摘要，将摘要作为一条 `system` 消息插入历史顶部，再执行裁剪，防止关键需求信息丢失
- [ ] 将 `trimHistory` 接入 `agent.ts`，在每次调用 LLM 前执行

### 4.4 Agent 服务（`backend/src/services/agent.ts`）

- [ ] 构建带 System Prompt 的 LangChain `ChatPromptTemplate`
- [ ] 将经 `contextManager` 处理后的历史消息注入 prompt（`MessagesPlaceholder`）
- [ ] 实现 `runAgentStream(sessionId, userMessage, onDelta, onDone)`：
  - 从 DB 加载完整历史 → `trimHistory` → 构建 prompt
  - 按需调用 `skillLoader` 注入对应 Skill 块
  - 流式调用 `model.stream()`，逐 chunk 触发 `onDelta`
  - 流结束后检测回复中的 PRD 触发信号，返回 `{ reply, shouldGeneratePrd }`

### 4.4.5 PRD Outline 生成（`backend/src/services/prdOutline.ts`）

> 这是 Phase 4 → Phase 5 的桥接步骤，只在 `shouldGeneratePrd === true` 时触发，**不参与常规对话循环**。

- [ ] 定义 `PrdOutline` 类型：

  ```ts
  interface SectionOutline {
  	id:
  		| "background"
  		| "userScenario"
  		| "featureList"
  		| "architecture"
  		| "flowchart"
  		| "infoArch"
  		| "dataModel";
  	title: string;
  	keyPoints: string[]; // 从需求对话中提炼的核心要点
  	skillRequired?: string; // 需要注入的 Skill 名称（仅图表类模块有值）
  	status: "pending" | "generating" | "done" | "error"; // Phase 5 断点续传用
  }

  interface PrdOutline {
  	sessionId: string;
  	sections: SectionOutline[];
  	createdAt: number;
  }
  ```

- [ ] 实现 `generatePrdOutline(sessionId: string): Promise<PrdOutline>`：
  - 从 DB 读取该会话的完整消息历史（已含需求收集结果）
  - 发起一次**非流式** LLM 调用，要求模型输出符合 `PrdOutline` schema 的 JSON
  - 使用 LangChain `JsonOutputParser` 解析结果，解析失败时抛出明确错误
  - 返回值持久化到 `sessions` 表的 `outline` 字段（JSON 字符串，按需迁移表结构）
- [ ] 在 `agent.ts` 中，当 `shouldGeneratePrd === true` 时，在进入 Phase 5 生成流程前调用 `generatePrdOutline()`，将返回的 `outline` 传递给各模块生成函数
- [ ] Phase 5 各模块生成函数以 `outline.sections[id].keyPoints` 为核心输入，不再重新读取完整对话历史，降低 token 消耗

### 4.5 更新消息路由

- [ ] `POST /api/sessions/:id/messages` 改为调用 `agent.ts` 而非直接调用 model
- [ ] 根据 `shouldGeneratePrd` 决定是否进入 PRD 生成流程：先调用 `generatePrdOutline()`，再进入 Phase 5

### 4.6 连接可靠性（`backend/src/services/sse.ts` + 前端 `useSSE.ts`）

> 对话阶段的 AI 回复单条较短，断线后用户重发即可恢复对话，但仍需防止部分消息写入 DB 以及客户端反复重建连接造成的资源浪费。

#### 服务端

- [ ] **SSE 事件 ID**：每个 chunk 下发时附带递增的 `id` 字段（格式 `id: <sequenceNumber>\n`），流结束时发送 `event: done` 事件
- [ ] **读取 `Last-Event-ID`**：在 SSE 路由中读取请求头 `Last-Event-ID`；若有效，说明是客户端重连，直接从 DB 查询该 `session_id` 最新的已完成 `assistant` 消息并重放全文（一次性发完，不重新触发 LLM）
- [ ] **流中断时安全落库**：在 `runAgentStream` 的 `onDone` / `catch` 双路径中确保：
  - 正常结束：将完整 `reply` 写入 `messages` 表
  - 中途断开（`res.writableEnded === false` 时客户端关闭连接）：若已累积的 `partialReply` 超过 20 字符，仍写入 DB 并在内容末尾追加 `[⚠ 回复被中断]` 标记，避免空消息污染历史

#### 客户端

- [ ] **`useSSE.ts` 自动重连**：SSE 原生支持自动重连，确认 `EventSource` 初始化时**不**设置 `withCredentials`（避免触发预检），并依赖浏览器默认的指数退避重连行为
- [ ] **重连去重**：在 Pinia `messages` store 中，收到重放的完整消息时，按 `messageId` 去重，防止同一条消息渲染两次

**阶段验收**：

- Agent 能识别信息不足场景并输出结构化提问表单
- 信息完整时回复"即将生成 PRD"触发信号
- 超长对话（>20 轮）时历史被正确裁剪，关键需求信息不丢失
- 生成图表时对应 Skill 内容已注入 prompt（可通过日志验证）
- `generatePrdOutline()` 能输出合法 JSON，所有 7 个模块的 `keyPoints` 均有实质内容，图表类模块的 `skillRequired` 字段已正确填写
- 模拟网络断线后重连，客户端能收到已完成消息的重放，且 Pinia store 中无重复条目
- 模拟流中途断开（关闭浏览器标签），DB 中能查到带 `[⚠ 回复被中断]` 标记的部分消息，不存在空消息记录

---

## Phase 5 · PRD 生成与输出

**目标**：Agent 能生成完整的 7 模块单文件 HTML PRD。

### 5.1 各模块生成服务（`backend/src/services/prd/`）

> **断点续传**：每个模块生成前将对应 `SectionOutline.status` 置为 `"generating"` 并持久化到 `sessions.outline`；生成成功后置为 `"done"`，失败置为 `"error"`。客户端可通过 `GET /api/sessions/:id` 轮询 `outline` 字段获知进度。当用户重新触发生成时，跳过所有 `status === "done"` 的模块，仅重试 `"pending"` / `"error"` 的模块，避免重复消耗 token。

- [ ] `modules/background.ts`：生成背景与目标（业务痛点 + SMART 目标）
- [ ] `modules/userScenario.ts`：生成用户画像与场景
- [ ] `modules/featureList.ts`：生成功能清单（优先级表格）
- [ ] `modules/architecture.ts`：读取 `skill-prd-architecture` Skill，生成 Mermaid `graph TB`
- [ ] `modules/flowchart.ts`：读取 `skill-prd-flowchart` Skill，生成 Mermaid `flowchart TD`
- [ ] `modules/infoArch.ts`：读取 `skill-prd-infoarch` Skill，生成 markmap Markdown
- [ ] `modules/dataModel.ts`：读取 `skill-prd-datamodel` Skill，生成 Mermaid `erDiagram`

### 5.2 HTML 模板生成（`backend/src/services/prd/renderer.ts`）

- [ ] 组装 7 个模块内容为单文件 HTML
- [ ] 内嵌样式（遵循 AGENTS.md 色彩系统、字体、圆角、阴影）
- [ ] Tab 导航 JS：点击切换对应模块 `div`
- [ ] 引入 CDN：
  - `mermaid.js`，初始化 `mermaid.initialize({ startOnLoad: true })`
  - `markmap-lib` + `markmap-view`，初始化思维导图
- [ ] 将 HTML 写入 `prds` 表，更新 `sessions.updated_at`

### 5.3 前端 PRD 预览

- [ ] `PrdPreview.vue`：接收 `prdId`，`GET /api/sessions/:id/prd` 获取 HTML
- [ ] 使用 `<iframe srcdoc>` 渲染 HTML，隔离样式
- [ ] 对话界面增加"查看 PRD"按钮，点击展开预览面板
- [ ] 增加"下载 HTML"按钮：`<a download>` + Blob URL

**阶段验收**：完整走通一次对话 → PRD 生成 → 预览 → 下载全流程，7 个 Tab 均可渲染，Mermaid 图表和 markmap 思维导图正常显示。

---

## Phase 6 · 工程化收尾

**目标**：项目可一键启动，代码质量检查通过，生产可部署。

### 6.1 Lint & 类型检查

- [ ] 前端：配置 ESLint + `@typescript-eslint`，`pnpm --filter frontend lint`
- [ ] 后端：配置 ESLint，`pnpm --filter backend lint`
- [ ] 根目录添加 `pnpm lint`、`pnpm typecheck` 脚本，串联前后端检查

### 6.2 构建验证

- [ ] `pnpm --filter frontend build` 无报错，产物输出 `frontend/dist/`
- [ ] `pnpm --filter backend build` 无报错，产物输出 `backend/dist/`

### 6.3 Daemon 生产启动

- [ ] 完善 `daemon/ecosystem.config.cjs`：
  ```js
  module.exports = {
  	apps: [
  		{
  			name: "open-prd-backend",
  			script: "./backend/dist/index.js",
  			env: { NODE_ENV: "production", PORT: 3000 },
  			restart_delay: 3000,
  			max_restarts: 10,
  		},
  	],
  };
  ```
- [ ] `daemon/scripts/start.sh` / `stop.sh` / `restart.sh`
- [ ] 根目录文档化一键启动流程：`pnpm install → pnpm build → pnpm start`

### 6.5 Electron 构建与打包

- [ ] 完善 `electron/src/main/index.ts`：接入 `startServer()`，通过 IPC 传端口给渲染进程（参见 `docs/electron-guide.md`）
- [ ] 完善 `electron/src/preload/index.ts`：`contextBridge` 暴露 `getApiPort`
- [ ] 前端 `frontend/src/main.ts` 增加 Electron 环境判断，读取端口配置 axios baseURL
- [ ] 重编译原生模块：`pnpm --filter electron rebuild`
- [ ] 配置 `electron/electron-builder.yml`（参见 `docs/electron-guide.md`）
- [ ] 验证完整构建流程：
  ```bash
  pnpm --filter frontend build
  pnpm --filter backend build
  pnpm --filter electron build
  pnpm --filter electron dist
  ```
- [ ] 验证打包产物：安装 `.exe` / `.dmg` / `AppImage` 后应用可正常启动、对话、生成 PRD

### 6.6 README

- [ ] 项目简介 + 截图
- [ ] 环境要求（Node.js 版本、pnpm 版本）
- [ ] 快速启动步骤
- [ ] 环境变量说明（引用 `.env.example`）

---

## 阶段依赖关系总览

```
Phase 1 (基础设施 + Electron 脚手架)
    └─► Phase 2 (LLM & SSE)
            └─► Phase 3 (前端对话 UI)
            └─► Phase 4 (Agent 逻辑)
                    └─► Phase 5 (PRD 生成)
                            └─► Phase 6 (工程化收尾)
                                    ├─► 6.1–6.4  Web 版本发布
                                    └─► 6.5      Electron 打包发布
```

- Phase 3 和 Phase 4 可**并行开发**，在 Phase 5 联调时合并
- Phase 6.5（Electron 打包）依赖 Phase 6.1–6.2（构建验证通过）后进行
- Electron 开发全程使用 Web 版本调试，Phase 6.5 仅做桌面壳层接入与打包验证
