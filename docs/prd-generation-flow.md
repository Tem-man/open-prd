# PRD 生成全链路流程梳理

> 本文描述从用户在前端发起第一条消息，到最终获得一份完整 HTML 格式 PRD 文档，系统内部经历的每个阶段与关键细节。
>
> 对话层已改为「编排 Agent（`createAgent`）+ 工具调用」，不再使用 `[GENERATE_PRD]` / `[QUESTION_FORM]` 文本标记；
> PRD 生成后的对话式编辑、整份重新生成的两步确认见 [`plan-orchestrator-agent.md`](./plan-orchestrator-agent.md)。

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
[Phase 3] 编排 Agent 多轮对话（信息诊断 → 结构化反问 → 确认）
  │        ↳ 若信息不足：调用 ask_user_form 工具发送提问表单
  │        ↳ 若信息充分：调用 generate_prd 工具
  ▼
[Phase 4] generate_prd 工具内：生成 PRD Outline（各模块 keyPoints）
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

**入口**：`backend/src/routes/sessions/messages.ts` → `POST /:id/messages`

1. 校验 `session_id` 是否存在。
2. 将用户消息写入 `messages` 表（`role='user'`）。
3. 若为该会话的第一条消息，自动截取前 60 字作为会话标题写入 `sessions.title`。
4. 调用 `initSse(res)` 设置响应头（`Content-Type: text/event-stream`），开启持久连接。
5. 注册 `res.on('close')` 监听：客户端断开（含点击停止）时中止 Agent 与生成流水线，已累积的部分回复超过 20 字时落库，内容末尾标注中断标记。

---

## Phase 3：编排 Agent 多轮对话（核心决策层）

**入口**：`backend/src/services/agent/orchestrator.ts` → `runTurn()`

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

**入口**：`backend/src/services/prompts.ts` → `buildCollectPrompt()`（尚无 PRD）/ `buildEditPrompt()`（PRD 已生成）

Agent 扮演资深产品经理。收集阶段只暴露 `ask_user_form` / `generate_prd` 两个工具：

**信息不足时 → 调用 `ask_user_form`**

两轮递进提问（第一轮基础信息、第二轮功能模块确认），收集以下维度：

| 维度     | 说明                                |
| -------- | ----------------------------------- |
| 产品定位 | 核心用户群体、目标市场              |
| 业务痛点 | 现状问题与改进方向                  |
| 使用场景 | 用户在什么情况下使用                |
| 技术约束 | 平台（Web/App/桌面）、集成系统      |
| 核心功能 | 第二轮动态生成候选模块，至少选 4 个 |

表单规则（选择题必须有选项、文本题非必填、末尾补齐开放题）由工具在代码中校验。

**信息充分时 → 调用 `generate_prd`**

第二轮表单已回答，或首条消息已包含产品定位、业务痛点、至少 4 个核心功能模块和技术平台。

### 3.5 流式推理

`createAgent` 以 `streamMode: ["messages", "custom"]` 运行：模型节点（`model_request`）的 token 经 `extractStreamParts` 拆成 `delta` / `thinking` 推送；工具内部调用模型产生的 HTML token 被过滤，不进入聊天气泡。工具通过 LangGraph custom 流推送 `form`、`prd_progress`、`section_edit_*` 等事件。

### 3.6 轮次结束

`ask_user_form` 与 `generate_prd` 调用后本轮立即结束（`returnDirect`）。路由落库助手消息（表单以标记块存入 content，仅用于刷新后还原），并按本轮是否生成了 PRD 发送 `prd_ready` + `done`。

---

## Phase 4：生成 PRD Outline

**入口**：`backend/src/services/prdOutline.ts` → `generatePrdOutline()`

由 `generate_prd` 工具触发（经 `services/prdPipeline.ts` 的 `runPrdPipeline()`）。PRD 已存在时该工具只发确认卡片，用户确认后由路由凭 token 直接执行同一流水线。

1. 从 `messages` 表加载完整对话历史，格式化为纯文本（`用户：... \n AI：...`）。
2. 向 LLM 发起一次**非流式**调用，要求按固定 JSON Schema 输出包含 8 个模块的 Outline：

```json
{
  "sections": [
    {
      "id": "background",
      "title": "背景与目标",
      "keyPoints": ["核心要点1", "核心要点2", "..."],
      "status": "pending"
    }
    // ... 另外 6 个模块
  ]
}
```

3. 图表类模块（`architecture` / `flowchart` / `infoArch` / `dataModel`）自动填充 `skillRequired` 字段，指向对应 Skill 名称。
4. Outline 结果以 JSON 字符串形式持久化到 `sessions.outline` 字段，供后续断点续传使用。

**8 个模块 ID 对照**：

| id               | 标题         | 是否图表模块                                    |
| ---------------- | ------------ | ----------------------------------------------- |
| `background`     | 背景与目标   | 否                                              |
| `userScenario`   | 用户与场景   | 否                                              |
| `featureList`    | 功能清单     | 否                                              |
| `architecture`   | 产品架构     | 是（Mermaid graph TB）                          |
| `flowchart`      | 业务流程     | 是（Mermaid flowchart TD）                      |
| `infoArch`       | 信息架构     | 是（markmap.js）                                |
| `dataModel`      | 数据模型     | 是（Mermaid erDiagram）                         |
| `prototypeBasis` | 原型设计依据 | 否（文段类，注入 skill-prd-prototype 固化结构） |

---

## Phase 5：逐模块内容生成

**入口**：`backend/src/services/prd/index.ts` → `generateFullPrd()`

读取 Phase 4 生成的 Outline，按顺序驱动 8 个模块依次生成。

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
├── dataModel.ts      ← 数据模型（注入 skill-prd-datamodel）
└── prototypeBasis.ts ← 原型设计依据（注入 skill-prd-prototype）
```

### 5.3 Skill 注入（图表模块与原型设计依据）

图表类模块生成时，各模块生成器（`prd/modules/*.ts`）会将对应 Skill 文件内容注入系统提示，覆盖默认行为，确保 Mermaid / markmap 语法的准确性。「原型设计依据」虽为文段类模块，同样通过 Skill 固化输出结构（页面清单 / 页面详情 / 导航关系 / 设计规范），供原型设计 AI 代理消费。

Skill 路径对应关系：

| 模块         | Skill 路径                               |
| ------------ | ---------------------------------------- |
| 产品架构     | `skills/skill-prd-architecture/SKILL.md` |
| 业务流程     | `skills/skill-prd-flowchart/SKILL.md`    |
| 信息架构     | `skills/skill-prd-infoarch/SKILL.md`     |
| 数据模型     | `skills/skill-prd-datamodel/SKILL.md`    |
| 原型设计依据 | `skills/skill-prd-prototype/SKILL.md`    |

---

## Phase 6：渲染单文件 HTML & 落库

**入口**：`backend/src/services/prd/renderer.ts` → `renderPrd()`

1. 接收 8 个模块的 `{ id, title, content }` 数组。
2. 将所有模块内容内嵌进单一 HTML 文件，包含：
   - Tab 导航栏（点击切换 8 个模块）
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

| 事件类型       | 触发时机                   | 关键字段                                           |
| -------------- | -------------------------- | -------------------------------------------------- |
| `delta`        | LLM 每输出一个 chunk       | `content`（增量文本）                              |
| `thinking`     | 模型思考增量               | `content`                                          |
| `event: form`  | `ask_user_form` / 确认卡片 | `questions`，确认卡片额外有 `action.token`         |
| `prd_progress` | 每个模块状态变化           | `sectionId`, `status`                              |
| `prd_ready`    | 全部模块生成完毕           | `prdId`                                            |
| `section_*`    | 对话中工具修改模块         | `sectionId`, `newHtml`, `version`                  |
| `done`         | 流正常结束                 | `prdGenerated`、`messageId`（落库后的助手消息 id） |
| `error`        | 任意阶段出错               | `message`（错误描述）                              |

---

## 数据流转图（简化）

```
前端 useSSE.sendMessage()
    │  POST /api/sessions/:id/messages
    ▼
messages.ts (路由层)
    │  写入 user message → initSse()
    │  调用 getAgentDriver().runTurn()
    ▼
agent/orchestrator.ts
    │  loadHistory() → trimHistory() → buildCollectPrompt()
    │  createAgent().stream() 流式调用
    │  ← writeDelta (SSE) ←─────────────────── 前端实时渲染
    │  模型调用 generate_prd 工具
    ▼
tools/generatePrd.ts → prdPipeline.ts
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
messages.ts
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

| 决策点            | 方案                           | 原因                                                                                |
| ----------------- | ------------------------------ | ----------------------------------------------------------------------------------- |
| 前后端通信        | SSE（单向流）                  | PRD 生成耗时较长，需要实时反馈进度；WebSocket 对此场景偏重                          |
| Outline 先行      | Phase 4 独立生成 Outline       | 将"需求理解"和"内容生成"解耦，各模块只需关注自身 keyPoints，降低单次 LLM 调用复杂度 |
| 上下文裁剪 + 摘要 | trimHistory + summarizeHistory | 防止长对话超出模型上下文窗口，同时保留关键需求信息                                  |
| 触发生成          | 模型调用 `generate_prd` 工具   | 由 LLM 判断信息是否充分；工具调用比文本标记可靠，已有 PRD 时由服务端两步确认兜底    |
| 断点续传          | section.status 字段            | 单模块失败不影响其他模块，可重跑失败部分                                            |
| 单文件 HTML       | 所有 CSS/JS 内嵌               | 便于分享、存档，无需额外静态服务                                                    |
