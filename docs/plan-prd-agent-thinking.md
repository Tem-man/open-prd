# 升级计划：PRD 对话窗口展示 Agent 思考过程

> 状态：草稿 | 创建时间：2026-09-13
>
> 范围：会话页左侧 `SessionSidebar` 的 PRD Agent 对话流（不含原型编辑器，那边已有 Reasoning UI）

---

## 一、背景与目标

### 现状

PRD Agent 通过 SSE 把模型输出推到左侧对话窗口。当前链路**只转发可见回复**：

| 层 | 行为 |
| -- | ---- |
| `backend/src/services/agent.ts` | `model.stream()` 后只取 `chunk.content`，拼成 `delta` |
| `backend/src/services/sse.ts` | 事件类型只有 `delta` / `form` / `prd_progress` / `prd_ready` / `error` / `done`，没有思考通道 |
| `backend/src/services/llm.ts` | 未打开 Anthropic Extended Thinking、OpenAI `reasoning_effort` 等开关 |
| `frontend/src/composables/useSSE.ts` | 只把 `delta` 追加进 `Message.content` |
| `SessionSidebar.vue` | 只渲染 Markdown 气泡 + 打字动画 |

因此即使用户选了 DeepSeek R1、Claude thinking、o 系列等推理模型，思考链也会被丢掉（或在 `content` 为数组时被 `JSON.stringify` 进气泡，污染可见回复）。

右侧 `ProgressSteps` 展示的是**模块生成进度**（`prd_progress`），不是模型在想什么，不能替代本需求。

同仓库对照：原型编辑器 `frontend/src/pencil/components/chat/ChatMessage.vue` 已有可折叠 “Thinking / Reasoning…” 块，交互可复用其信息架构，但**不要**把 Pencil 的 Tailwind / Collapsible 依赖拉进会话页。

### 目标

1. 对话窗口能实时展示 PRD Agent 的思考过程（与可见回复分开）。
2. 思考块**默认折叠**；流式进行中可自动展开，结束后收起（或保持用户手动开合）。
3. 思考内容**不得**进入下次 LLM 请求的对话历史（避免污染上下文、浪费 token）。
4. 刷新 / 重进会话后，若该条消息曾有思考过程，仍能在 UI 里看到（只给用户看，不回传模型）。
5. 无思考输出的模型（如普通 GPT-4o）行为不变：不出现空的思考块。

非目标（本期不做）：

- 各 PRD 章节生成器（`prd/modules/*`）的思考过程灌进对话窗。
- 原型编辑器 Chat（已有 Reasoning UI）。
- 把思考过程写进导出的 PRD HTML。

---

## 二、设计原则

1. **通道分离**：思考走独立 SSE 事件 `thinking`，回复仍走 `delta`。禁止把 thinking 拼进 `content`。
2. **有则展示**：流里出现思考增量才渲染思考块；没有就不占 UI。
3. **默认折叠**：思考通常很长，完成后折叠；流式期间展开并自动滚到底，方便确认「模型在干活」。
4. **历史隔离**：`loadHistory` / `trimHistory` / 续写 prompt 只使用 `content`。`thinking` 仅用于前端展示与会话恢复。
5. **不臆造思考**：不要用 Agent 自己的 pipeline 文案（「正在生成架构图」）冒充模型思考。那是进度，不是 reasoning。

---

## 三、整体架构

```
LLM stream chunk
  ↓
extractStreamParts(chunk)          ← 新增：拆出 text / thinking
  ├─ thinking delta  → writeThinking(res, delta, seq)
  └─ text delta      → writeDelta(res, delta, seq)
  ↓
前端 useSSE
  ├─ type=thinking → messagesStore.appendThinking(tempId, delta)
  └─ type=delta    → messagesStore.appendDelta(tempId, delta)
  ↓
SessionSidebar
  思考块（可折叠，仅 thinking 非空时渲染）
  可见回复气泡（Markdown，逻辑不变）
  ↓
落库
  messages.content   = 可见回复（与今天相同）
  messages.thinking  = 思考全文（可空）
  ↓
下次 runAgentStream
  loadHistory 只读 role + content，忽略 thinking
```

---

## 四、数据结构设计

### 4.1 前端 `Message`（`frontend/src/types/index.ts`）

```typescript
export interface Message {
  // ...现有字段不变
  /** 模型思考过程（仅展示，不回传 LLM） */
  thinking?: string;
  /** 思考是否仍在流式写入（用于折叠块的 spinner / 默认展开） */
  isThinkingStreaming?: boolean;
}
```

### 4.2 SSE 事件

在现有 JSON `data:` 上新增一种 `type`，复用 `delta` 的 `id:` 序号，便于断线重连按序重放：

```json
{ "type": "thinking", "content": "先确认用户有没有说清目标用户…" }
```

`backend/src/services/sse.ts` 新增 `writeThinking(res, content, seq?)`，格式与 `writeDelta` 对称。

前端 `SseEvent.type` 联合类型增加 `"thinking"`。

`event: form` / `event: done` 命名事件不变。

### 4.3 数据库

`messages` 表现有列：`id, session_id, role, content, created_at`。

新增可空列：

```sql
ALTER TABLE messages ADD COLUMN thinking TEXT NOT NULL DEFAULT '';
```

- 迁移：`backend/src/db/migrations.ts` 下一档 `user_version`（当前为 11 → **12**）。
- `schema.ts` 的 `CREATE_MESSAGES_TABLE` 同步加上 `thinking`，保证全新库一致。
- 所有 `INSERT INTO messages` 补上 `thinking`（agent 完成、中断、静态系统气泡写 `''`）。
- `prd_versions.messages_json` 快照对象增加可选字段 `thinking`。切换版本恢复对话时带回 UI；构建 LLM 历史时仍丢弃。体积偏大可接受（本地 SQLite），不单独做截断。

GET `/api/sessions/:id` 返回消息时带上 `thinking`，前端 `loadMessages` 填入 store。

### 4.4 断线重连

`POST /messages` 在 `Last-Event-ID` 重放路径里，若最新 assistant 有 `thinking`，先 `writeThinking` 再 `writeDelta`，避免刷新后只剩正文。

---

## 五、后端：从 chunk 拆出思考

### 5.1 抽取函数（建议 `backend/src/services/llmStream.ts`）

LangChain `AIMessageChunk` 因厂商而异，统一收敛为：

```typescript
interface StreamParts {
  text: string;
  thinking: string;
}

function extractStreamParts(chunk: unknown): StreamParts
```

识别顺序（有则累加，互不覆盖）：

| 来源 | 字段 | 典型厂商 |
| ---- | ---- | -------- |
| `additional_kwargs.reasoning_content` | string | DeepSeek R1 / 多数 OpenAI 兼容推理模型 |
| `additional_kwargs.reasoning` | string 或 `{ content: string }` | 部分 OpenRouter / OpenAI |
| `chunk.content` 为 string | 整段视为 **text** | GPT-4o 等 |
| `chunk.content` 为数组 | `type === "thinking"` / `"reasoning"` 的 `thinking` / `text` / `summary` 字段 → thinking；`type === "text"` → text | Anthropic Extended Thinking、部分 Responses API |

**必须改掉**今天的：

```ts
typeof chunk.content === "string" ? chunk.content : JSON.stringify(chunk.content)
```

数组 content 再 `JSON.stringify` 会把 thinking 块泄漏进用户气泡。

空字符串不调用 `onDelta` / `onThinking`。

### 5.2 `runAgentStream` 回调

```typescript
onDelta: (delta: string, seq: number) => void
onThinking: (delta: string, seq: number) => void   // 新增
onDone: (reply: string, shouldGeneratePrd: boolean, thinking: string) => void
```

- `fullReply` 只累加 text；`fullThinking` 只累加 thinking。
- idle timer：thinking 增量也算「有活动」，避免长思考被 `LLM_IDLE_TIMEOUT_MS` 误杀。必要时为推理模型把 idle 超时略放宽（实现时用现有 env，不新造配置则先保持 20s，验证 R1/Claude 后再调）。
- `onDone` 的 `cleanReply` 逻辑不变（剥离 `PRD_TRIGGER`）；thinking 不参与 trigger 检测。
- 中断时：已有 `content` 与 `thinking` 一并落库，便于「继续生成」后 UI 仍能展开旧思考。续写 prompt **只附 `partialReply`（content）**，不附 thinking。

### 5.3 是否主动打开思考能力

分两档，避免给不支持的模型乱加参数导致 400：

| 档 | 行为 | 何时 |
| -- | ---- | ---- |
| A. 被动解析 | 只拆 chunk，不改请求体 | **本期必做**。DeepSeek Reasoner 等会自发带 `reasoning_content` |
| B. 主动开启 | Anthropic `thinking: { type: "enabled", budgetTokens }`；OpenAI / 兼容方 `reasoning_effort` 或 extra body `include_reasoning: true` | **本期可选 / 二期**。需按 `providerID + model` 白名单，且 `maxTokens` > budget |

本期默认只做 A。B 另开一小节「模型能力开关」，实现时不要全局开启（GPT-4o 无 thinking，强开会失败或空转）。

若做 B，建议在 `LlmRuntimeConfig` 增加可选 `enableThinking?: boolean`，由前端模型选择器按模型 id 启发（名称含 `r1` / `reasoner` / `o1` / `o3` / `o4` / `thinking`）默认打开，用户可关。

---

## 六、前端

### 6.1 Store（`frontend/src/stores/messages.ts`）

```typescript
function appendThinking(msgId: string, chunk: string) {
  const msg = messages.value.find((m) => m.id === msgId);
  if (!msg) return;
  msg.thinking = (msg.thinking ?? "") + chunk;
  msg.isThinkingStreaming = true;
}

function finalizeMessage(msgId: string) {
  // 现有逻辑 +
  msg.isThinkingStreaming = false;
}
```

`startStreamingMessage` / `resumeStreamingMessage` 将 `isThinkingStreaming` 置 false，直到首个 thinking delta。

静态系统气泡（PRD 完成提示等）不写 thinking。

### 6.2 SSE（`frontend/src/composables/useSSE.ts`）

在 `evt.type === "delta"` 旁增加：

```typescript
} else if (evt.type === "thinking" && evt.content) {
  messagesStore.appendThinking(tempId, evt.content);
}
```

### 6.3 UI（`SessionSidebar.vue`）

插在 assistant 气泡**上方**（思考 → 回复，符合阅读顺序）：

```
[avatar]
  [思考过程 ▾]          ← 仅 msg.thinking 非空时
    折叠正文（等宽/辅助色，pre-wrap，max-height + 内部滚动）
  [Markdown 回复气泡]   ← 现有逻辑
  [提问表单 / 动作按钮]
```

交互：

| 状态 | 表现 |
| ---- | ---- |
| 尚无 thinking、仅在等首 token | 保持现有 `TypingIndicator`（不要空思考壳） |
| 正在流式 thinking、还无 text | 思考块展开 + 旋转图标「正在思考」；可暂不显示空回复气泡 |
| thinking 结束、text 开始 | 思考块保持展开或按用户操作；回复气泡按现有 Markdown 流式 |
| `finalizeMessage` | 思考块标题改为「思考过程」，默认收起（若用户正在展开则尊重当前开合） |
| 历史消息带 thinking | 默认收起，点击可展开 |

视觉对齐会话页现有 token（不要用 Pencil 的 Tailwind）：

- 标题 12px，颜色走辅助文字
- 卡片圆角 8px，背景第三层 `#F1F5F9`
- 图标优先 Lucide：`icon-lucide-brain` / `icon-lucide-loader-circle` / `icon-lucide-chevron-down`
- 思考正文 12px、`color: var(--text-muted)` 一类已有变量，不渲染 Markdown（避免思考里的代码块撑破布局）

组件可抽 `ThinkingBlock.vue` 放在 `frontend/src/components/`，避免 `SessionSidebar` 继续膨胀。

### 6.4 历史加载

`loadMessages` 映射 API 的 `thinking` 字段。旧数据无该列时视为 `''`。

---

## 七、实现任务拆分

建议顺序（后者依赖前者）：

1. **抽取层**：`extractStreamParts` + 单测（string content、数组 thinking+text、`reasoning_content`、空 chunk）。
2. **SSE**：`writeThinking`；`runAgentStream` 双通道；`messages.ts` 路由把 thinking 写入 DB。
3. **迁移 v12**：`messages.thinking`；补齐所有 INSERT；GET session 返回。
4. **前端协议**：`Message.thinking`、`appendThinking`、`useSSE`。
5. **UI**：`ThinkingBlock` + `SessionSidebar` 接入。
6. **隔离验收**：构造带 thinking 的历史，确认 `trimHistory` 发给模型的 messages 不含思考文本。
7. **文档**：实现完成后更新 `AGENTS.md`（SSE 事件表、`messages.thinking` 列）。不在写计划阶段改 AGENTS。

`loadHistory` 当前若 `SELECT *` 会把 thinking 查出来，必须在组装 `HumanMessage` / `AIMessage` 时只用 `content`。这是验收必选项。

---

## 八、风险与边界

| 风险 | 处理 |
| ---- | ---- |
| 思考很长，SSE 与 SQLite 膨胀 | 展示侧 `max-height` 内部滚动；落库不截断（本地桌面/内网场景可接受）。若单条超过数 MB 再考虑上限 |
| 推理模型首 token 慢，idle 超时 | thinking 增量重置 idle timer；不够再调 `LLM_IDLE_TIMEOUT_MS` |
| 厂商字段不统一，漏解析 | 抽取函数集中维护，漏了只是不显示思考，不能把未知结构 `JSON.stringify` 进 content |
| Anthropic 未开 thinking 却去读 | 被动解析即可，没有块就不展示 |
| 思考含用户不想给下次模型看的内容 | 硬约束：永不回传。UI 可后续加「复制思考」但不送进 agent |
| 版本快照变大 | `messages_json` 带 thinking；可接受。若后续要瘦身，再做「快照省略 thinking」 |

---

## 九、验收标准

- [ ] 使用会输出 `reasoning_content` 的模型时，对话窗出现可折叠思考块，正文气泡只有最终回复。
- [ ] 使用普通非推理模型时，无思考块，现有提问表单 / PRD 进度 / 中断续写均不受影响。
- [ ] 思考流式期间 idle 定时器被重置，不因「只在想、还没说话」而误中断（在该模型确实会推 thinking 增量的前提下）。
- [ ] 刷新会话后思考块仍在，默认折叠。
- [ ] 下一轮对话请求的 LLM messages 中无思考文本（抓 `debugLog` 或单测 `loadHistory`）。
- [ ] `content` 为多块数组时，用户气泡不再出现 `[{type:thinking...}]` 这种 JSON。
- [ ] 提问表单、PRD 完成引导、模块进度条行为与现网一致。

---

## 十、建议的后续（不纳入本期）

- 按模型白名单主动开启 Anthropic thinking / OpenAI reasoning，并在模型选择器提供开关。
- 章节生成阶段在对话里用一条「正在撰写 xxx」系统气泡（进度，不是 reasoning）。
- 思考块支持复制、字数统计。
- 将 Pencil Chat 与 PRD 会话的思考 UI 抽成跨页面约定（仍保持两套样式体系）。
