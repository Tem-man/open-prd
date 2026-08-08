# PRD 生成全链路流程梳理

> 本文描述从用户在前端发起第一条消息，到最终获得一份完整 HTML 格式 PRD 文档，系统内部经历的每个阶段与关键细节。

---

## 总览

```
用户输入
  │
  ▼
[Phase 1] 前端发送消息 → POST /api/sessions/:id/messages
  │
  ▼
[Phase 2] 后端写入用户消息 → 初始化 SSE 推流
  │
  ▼
[Phase 3] Agent 多轮对话（信息诊断 → 结构化反问 → 确认）
  │        ↳ 若信息不足：返回提问表单，继续收集
  │        ↳ 若信息充分：回复末尾追加 [GENERATE_PRD] 触发信号
  ▼
[Phase 4] 检测到触发信号 → 生成 PRD Outline（7 个模块 keyPoints）
  │
  ▼
[Phase 5] 逐模块生成内容（可注入 Skill）→ SSE 推送进度
  │
  ▼
[Phase 6] 渲染单文件 HTML → 写入 prds 表
  │
  ▼
[Phase 7] 前端接收 prd_ready 事件 → 拉取并展示 PRD
```

---

## Phase 1：前端发送消息

**入口**：`frontend/src/composables/useSSE.ts` → `sendMessage()`

1. 用户在聊天输入框提交文本。
2. 前端立即在本地 Store 中插入两条占位消息：
   - 用户消息（`role: user`，内容即输入文本）
   - AI 消息（`role: assistant`，内容为空，`isStreaming: true`）
3. 向后端发起 `POST /api/sessions/:id/messages`，携带 `{ content: text }`。
4. 后端返回 `text/event-stream`，前端进入流消费循环（`consumeStream`）。

**断线重连机制**：若 SSE 流意外中断且消息未结束，前端携带 `Last-Event-ID` 请求头重发一次请求，服务端检测到该头后重放最近一条已完成的 AI 消息。

---

## Phase 2：后端接收请求 & 初始化 SSE

**入口**：`backend/src/routes/sessions.ts` → `POST /:id/messages`

1. 校验 `session_id` 是否存在。
2. 将用户消息写入 `messages` 表（`role='user'`）。
3. 若为该会话的第一条消息，自动截取前 60 字作为会话标题写入 `sessions.title`。
4. 调用 `initSse(res)` 设置响应头（`Content-Type: text/event-stream`），开启持久连接。
5. 注册 `req.on('close')` 监听：若客户端提前断开，保存已累积的部分回复（超过 20 字时落库，内容末尾标注 `[⚠ 回复被中断]`）。

---

## Phase 3：Agent 多轮对话（核心决策层）

**入口**：`backend/src/services/agent.ts` → `runAgentStream()`

### 3.1 消息历史加载

从 `messages` 表按时序加载全部对话历史（不含当前用户消息，避免重复），转换为 LangChain `HumanMessage` / `AIMessage` 数组。

### 3.2 上下文裁剪（contextManager）

**入口**：`backend/src/services/contextManager.ts` → `trimHistory()`

- 用字符数 / 3 估算 token 数，默认上限 **12 000 tokens**。
- **超限时**：先调用 LLM 将历史对话压缩成一份结构化需求摘要（≤500 字 Markdown 列表），再从最旧消息开始丢弃，直到 token 数降至上限以内（最新一条用户消息必须保留）。
- 生成的摘要文本会注入 `SystemPrompt`，防止关键需求在裁剪中丢失。

### 3.3 构建消息列表

```
[SystemMessage(PRD提示词 + 可选需求摘要)]
  + [...裁剪后的历史]
  + [HumanMessage(当前输入)]
```

始终只有一个 `SystemMessage` 位于消息列表最前，兼容 Anthropic 不允许多 system message 的限制。

### 3.4 System Prompt 核心规则

**入口**：`backend/src/services/prompts.ts` → `buildSystemPrompt()`

Agent 扮演资深产品经理，核心逻辑分两阶段：

**信息不足时 → 输出结构化提问表单**

必须缺少以下任一维度时反问（每次不超过 5 个问题）：

| 维度 | 说明 |
|------|------|
| 产品定位 | 核心用户群体、目标市场 |
| 业务痛点 | 现状问题与改进方向 |
| 核心功能 | 至少 3 个主要功能模块 |
| 技术约束 | 平台（Web/App/桌面）、集成系统 |
| 优先级 | MVP 功能 vs. 后续迭代 |

提问格式固定为引用块表单，禁止主观臆断。

**信息充分时 → 触发 PRD 生成**

同时满足以下条件即可触发：
1. 已收集到产品定位、业务痛点、至少 3 个核心功能
2. 技术平台明确
3. 用户已确认或未提出异议

触发方式：在回复末尾**单独追加一行** `[GENERATE_PRD]`（不得有其他字符）。

### 3.5 流式推理

调用 `createChatModel()` 实例（根据 `.env` 中 `LLM_PROVIDER` 动态选择 OpenAI / Anthropic / Ollama），通过 `model.stream(messages)` 以异步迭代器方式接收增量 chunk，每个 chunk 通过 `writeDelta(res, chunk, seq)` 实时推送给前端。

### 3.6 触发信号检测

流结束后，检查完整回复是否包含 `[GENERATE_PRD]`：
- **包含**：`shouldGeneratePrd = true`，清理标记后落库，进入 Phase 4。
- **不包含**：`shouldGeneratePrd = false`，发送 `writeDone(res, false)` 结束本轮对话。

---

## Phase 4：生成 PRD Outline

**入口**：`backend/src/services/prdOutline.ts` → `generatePrdOutline()`

当 `shouldGeneratePrd === true` 时触发（在 `sessions.ts` 的 `onDone` 回调中调用）。

1. 从 `messages` 表加载完整对话历史，格式化为纯文本（`用户：... \n AI：...`）。
2. 向 LLM 发起一次**非流式**调用，要求按固定 JSON Schema 输出包含 7 个模块的 Outline：

```json
{
  "sections": [
    {
      "id": "background",
      "title": "背景与目标",
      "keyPoints": ["核心要点1", "核心要点2", "..."],
      "status": "pending"
    },
    // ... 另外 6 个模块
  ]
}
```

3. 图表类模块（`architecture` / `flowchart` / `infoArch` / `dataModel`）自动填充 `skillRequired` 字段，指向对应 Skill 名称。
4. Outline 结果以 JSON 字符串形式持久化到 `sessions.outline` 字段，供后续断点续传使用。

**7 个模块 ID 对照**：

| id | 标题 | 是否图表模块 |
|----|------|-------------|
| `background` | 背景与目标 | 否 |
| `userScenario` | 用户与场景 | 否 |
| `featureList` | 功能清单 | 否 |
| `architecture` | 产品架构 | 是（Mermaid graph TB）|
| `flowchart` | 业务流程 | 是（Mermaid flowchart TD）|
| `infoArch` | 信息架构 | 是（markmap.js）|
| `dataModel` | 数据模型 | 是（Mermaid erDiagram）|

---

## Phase 5：逐模块内容生成

**入口**：`backend/src/services/prd/index.ts` → `generateFullPrd()`

读取 Phase 4 生成的 Outline，按顺序驱动 7 个模块依次生成。

### 5.1 生成循环

每个模块执行以下步骤：

1. 读取 `section.status`，若已为 `'done'` 则跳过（支持断点续传）。
2. 将状态更新为 `'generating'`，通过 `writePrdProgress(res, sectionId, 'generating')` 推送进度给前端。
3. 调用对应 `MODULE_MAP[sectionId].generate(section)`。
4. 成功：状态置为 `'done'`，推送进度；失败：状态置为 `'error'`，写入错误占位 HTML。

### 5.2 各模块对应文件

```
backend/src/services/prd/modules/
├── background.ts     ← 背景与目标
├── userScenario.ts   ← 用户与场景
├── featureList.ts    ← 功能清单
├── architecture.ts   ← 产品架构（注入 skill-prd-architecture）
├── flowchart.ts      ← 业务流程（注入 skill-prd-flowchart）
├── infoArch.ts       ← 信息架构（注入 skill-prd-infoarch）
└── dataModel.ts      ← 数据模型（注入 skill-prd-datamodel）
```

### 5.3 Skill 注入（图表模块）

图表类模块生成时，`agent.ts` 中的 `buildMessagesWithSkill()` 会将对应 Skill 文件内容以 XML 块的形式注入 `SystemPrompt`，覆盖默认行为，确保 Mermaid / markmap 语法的准确性。

Skill 路径对应关系：

| 模块 | Skill 路径 |
|------|-----------|
| 产品架构 | `skills/skill-prd-architecture/SKILL.md` |
| 业务流程 | `skills/skill-prd-flowchart/SKILL.md` |
| 信息架构 | `skills/skill-prd-infoarch/SKILL.md` |
| 数据模型 | `skills/skill-prd-datamodel/SKILL.md` |

---

## Phase 6：渲染单文件 HTML & 落库

**入口**：`backend/src/services/prd/renderer.ts` → `renderPrd()`

1. 接收 7 个模块的 `{ id, title, content }` 数组。
2. 将所有模块内容内嵌进单一 HTML 文件，包含：
   - Tab 导航栏（点击切换 7 个模块）
   - 内联 CSS（遵循项目色彩/字体/圆角/阴影规范）
   - 内联 JS（Tab 切换逻辑）
   - CDN 引入 `mermaid.js`（渲染架构图/流程图/ER 图）和 `markmap-lib` + `markmap-view`（渲染信息架构思维导图）
3. 生成的 HTML 写入 `prds` 表（`session_id` 关联），若已存在则更新。
4. 返回 `prdId`。

---

## Phase 7：前端展示 PRD

**入口**：`frontend/src/composables/useSSE.ts` → `consumeStream()` 中的事件分发

1. 后端生成完成后，通过 SSE 推送两个事件：
   - `prd_progress` × 7（每个模块的 `generating` / `done` 状态，前端用于渲染进度条）
   - `prd_ready`（携带 `prdId`）
   - `done`（`prdGenerated: true`，关闭流）

2. 前端收到 `prd_ready` 后，发起 `GET /api/sessions/:id/prd` 拉取完整 HTML。

3. 将 HTML 字符串存入 `messagesStore.prdHtml`，前端通过 `<iframe srcdoc>` 渲染为可交互的 PRD 文档。

---

## SSE 事件类型汇总

| 事件类型 | 触发时机 | 关键字段 |
|---------|---------|---------|
| `delta` | LLM 每输出一个 chunk | `content`（增量文本）|
| `prd_progress` | 每个模块状态变化 | `sectionId`, `status` |
| `prd_ready` | 全部模块生成完毕 | `prdId` |
| `done` | 流正常结束 | `prdGenerated`（是否触发了 PRD 生成）|
| `error` | 任意阶段出错 | `message`（错误描述）|

---

## 数据流转图（简化）

```
前端 useSSE.sendMessage()
    │  POST /api/sessions/:id/messages
    ▼
sessions.ts (路由层)
    │  写入 user message → initSse()
    │  调用 runAgentStream()
    ▼
agent.ts
    │  loadHistory() → trimHistory() → buildSystemPrompt()
    │  model.stream() 流式调用
    │  ← writeDelta (SSE) ←─────────────────── 前端实时渲染
    │  检测 [GENERATE_PRD]
    ▼ (shouldGeneratePrd=true)
prdOutline.ts
    │  generatePrdOutline() — 非流式 LLM 调用
    │  → 持久化到 sessions.outline
    ▼
prd/index.ts
    │  generateFullPrd()
    │  for each section:
    │    ← writePrdProgress (SSE) ←──────────── 前端进度条
    │    module.generate(section)
    ▼
prd/renderer.ts
    │  renderPrd() → 单文件 HTML
    │  写入 prds 表
    ▼
sessions.ts
    │  writePrdReady(prdId)
    │  ← prd_ready (SSE) ←──────────────────── 前端拉取 HTML
    │  writeDone(res, true)
    ▼
前端
    GET /api/sessions/:id/prd
    → messagesStore.setPrdHtml()
    → <iframe srcdoc> 渲染 PRD
```

---

## 关键设计决策

| 决策点 | 方案 | 原因 |
|--------|------|------|
| 前后端通信 | SSE（单向流） | PRD 生成耗时较长，需要实时反馈进度；WebSocket 对此场景偏重 |
| Outline 先行 | Phase 4 独立生成 Outline | 将"需求理解"和"内容生成"解耦，各模块只需关注自身 keyPoints，降低单次 LLM 调用复杂度 |
| 上下文裁剪 + 摘要 | trimHistory + summarizeHistory | 防止长对话超出模型上下文窗口，同时保留关键需求信息 |
| 触发信号 | 回复末尾追加 `[GENERATE_PRD]` | 利用 LLM 自身判断信息是否充分，无需硬编码规则 |
| 断点续传 | section.status 字段 | 单模块失败不影响其他模块，可重跑失败部分 |
| 单文件 HTML | 所有 CSS/JS 内嵌 | 便于分享、存档，无需额外静态服务 |
