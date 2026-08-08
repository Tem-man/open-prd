# 升级计划：Agent 结构化提问表单

> 状态：草稿 | 创建时间：2026-05-25

---

## 一、背景与目标

### 现状

Agent 在信息不足时，通过纯文本 Markdown 格式向用户输出问题（`> ⚠️ 需要补充...` 区块），前端只做简单的 Markdown 渲染，用户需要通过普通输入框手动回答所有问题。这种方式存在以下问题：

- 用户不知道哪些问题是必填的；
- 纯文本回答难以被结构化收集；
- 没有预设选项，用户填写成本高；
- 提交时无法校验必填是否完整。

### 目标

升级 Agent 提问功能，使其输出**结构化表单**：

1. Agent 生成每个问题时，同时声明题型（单选 / 多选 / 文本输入）、选项列表、是否必填；
2. 前端将结构化问题渲染成交互式表单卡片，用户点击选项或填写文本；
3. **只有选择题（单选 / 多选）才可设为必填**，未完成必填题时提交按钮禁用；
4. 文本输入题始终为选填，提供 placeholder 引导；
5. 配色完全沿用项目原有色彩系统（主色 `#4F46E5`），不使用参考图中的橙色。

---

## 二、参考设计分析

### 参考图布局结构（`提问表单参考风格-*.png`）

| 区域           | 描述                                                                       |
| -------------- | -------------------------------------------------------------------------- |
| **题目标题行** | 左对齐大字，必填题右侧有 `*` 红色标记                                      |
| **选项区**     | 胶囊形 pill 按钮，横向自动换行排列；选中态有填充背景色 + 文字变色          |
| **文本输入区** | 圆角矩形输入框，有 placeholder 灰色提示；单行或多行（自适应）              |
| **底部操作栏** | 固定在表单卡片底部，左侧提示文案，右侧 "发送答案" 按钮（必填未完成时禁用） |

### 交互状态

| 状态       | 表现                                                       |
| ---------- | ---------------------------------------------------------- |
| 未选中选项 | 白底 + 灰色边框 + 深色文字                                 |
| 选中选项   | 主色浅色背景（`#EEF2FF`）+ 主色边框（`#4F46E5`）+ 主色文字 |
| 必填未完成 | 提交按钮灰色禁用                                           |
| 必填已完成 | 提交按钮亮主色可点击                                       |

---

## 三、整体架构变更

```
LLM 输出
  ↓
后端 SSE 流中检测 [QUESTION_FORM] 标记
  ↓
解析 JSON 数据块，通过 SSE event: form 推送给前端
  ↓
前端 useSSE 消费 form 事件 → 存入 messages store（type: 'form'）
  ↓
SessionSidebar 消息列表：遇到 type='form' 的消息 → 渲染 QuestionForm 组件
  ↓
用户交互（选择 + 输入）→ 点击提交 → 自动整合为文本消息 → 正常发送
```

---

## 四、数据结构设计

### 4.1 问题表单 JSON 格式（LLM 输出 / 后端解析目标）

```typescript
interface QuestionForm {
	questions: Question[];
}

interface Question {
	id: string; // 唯一标识，如 "q1"
	label: string; // 问题标题文字
	required: boolean; // 是否必填（仅 single_choice / multi_choice 可为 true）
	type: "single_choice" | "multi_choice" | "text";
	options?: string[]; // 选择题的选项列表（text 类型无此字段）
	placeholder?: string; // 文本题的 placeholder
}
```

**约束规则：**

- `type === 'text'` 时，`required` 必须为 `false`（由前端校验兜底，后端 prompt 也明确要求）
- 每次表单最多 4 个问题（与现有 prompt 规则一致）
- 选项数量建议 2–6 个

### 4.2 前端消息类型扩展

在 `frontend/src/types/index.ts` 的 `Message` 类型中新增：

```typescript
interface Message {
	id: string;
	role: "user" | "assistant";
	content: string;
	isStreaming?: boolean;
	// 新增字段
	formData?: QuestionForm; // 当 role='assistant' 且含问题表单时填充
}
```

### 4.3 SSE 事件扩展

后端在 SSE 流中新增 `form` 事件类型：

```
event: form
data: {"questions": [...]}
```

普通文本 chunk 仍使用现有的 `delta` 事件，`form` 事件在流结束前单独推送一次。

---

## 五、后端变更

### 5.1 Prompt 更新（`backend/src/services/prompts.ts`）

在 `buildSystemPrompt` 中，将"结构化提问表单格式"部分从 Markdown 文本格式改为 JSON 信号格式：

**新格式规范（注入到 system prompt）：**

```
### 结构化提问表单格式
信息不足时，必须输出以下格式的提问表单（禁止主观臆断）：

先输出一句简短的提示语，如"我需要了解以下信息，才能为您生成完整的 PRD："
然后在新的一行输出如下标记块（必须是合法 JSON，不得有多余字符）：

[QUESTION_FORM]
{
  "questions": [
    {
      "id": "q1",
      "label": "问题标题",
      "required": true,
      "type": "single_choice",
      "options": ["选项A", "选项B", "选项C"]
    },
    {
      "id": "q2",
      "label": "有其他需要补充的吗？",
      "required": false,
      "type": "text",
      "placeholder": "可选，请自由描述"
    }
  ]
}
[/QUESTION_FORM]

规则：
- 每次最多 4 个问题，按重要性排序；
- type 为 text 的题目 required 必须为 false；
- 不要询问能轻松推断的信息；
- 除标记块之外的正常对话内容照常输出。
```

### 5.2 SSE 路由更新（`backend/src/routes/sessions.ts`）

在 `onDone` 回调处理中，检测并解析 `[QUESTION_FORM]...[/QUESTION_FORM]` 块：

1. 若存在，提取 JSON 数据；
2. 在 SSE 流中在 `done` 事件之前额外推送一个 `form` 事件：
   ```
   event: form
   data: <JSON字符串>
   ```
3. 将 AI 回复中的 `[QUESTION_FORM]...[/QUESTION_FORM]` 块从落库内容中剥离（存纯文字部分）；
4. `form` 数据单独通过 `event: form` 传给前端，不落库（避免历史重放时重复渲染表单）。

### 5.3 常量扩展（`prompts.ts`）

```typescript
export const QUESTION_FORM_START = "[QUESTION_FORM]";
export const QUESTION_FORM_END = "[/QUESTION_FORM]";
```

---

## 六、前端变更

### 6.1 类型定义（`frontend/src/types/index.ts`）

新增 `Question`、`QuestionForm` 接口，扩展 `Message` 类型（见 §4.2）。

### 6.2 SSE Composable（`frontend/src/composables/useSSE.ts`）

处理新的 `form` 事件：

- 监听 `event: form` → 解析 JSON → 调用 `messagesStore.attachFormToLastMessage(formData)`
- 新增 store action `attachFormToLastMessage`：将 formData 挂载到最后一条 assistant 消息上

### 6.3 新组件：`QuestionForm.vue`（`frontend/src/components/`）

**组件职责：**

- 接收 `QuestionForm` 数据作为 props
- 渲染每个问题（单选 / 多选 / 文本输入）
- 管理本地选中/输入状态
- 校验必填项 → 控制提交按钮状态
- 提交时 emit `submit` 事件，携带整合后的文本答案

**Props：**

```typescript
interface Props {
	form: QuestionForm;
	disabled?: boolean; // 已提交后禁用整个表单
}
```

**Emits：**

```typescript
emit('submit', answersText: string)
```

**答案整合格式（提交时自动合成文本消息）：**

```
1. [问题标题]：[选中选项 / 输入内容]
2. [问题标题]：[选中选项]
...
```

### 6.4 SessionSidebar 更新

在消息列表渲染循环中，为 `role === 'assistant'` 的消息增加分支：

- 若 `msg.formData` 存在 → 在 assistant bubble 下方（或替换为）渲染 `<QuestionForm>` 组件
- 表单提交后：将答案文本填入 inputText 并自动发送（或直接调用 `sendMessage`），同时标记该表单为 `disabled`

### 6.5 消息 Store 更新（`frontend/src/stores/messages.ts`）

新增 action：

```typescript
attachFormToLastMessage(formData: QuestionForm): void
```

---

## 七、组件视觉规范

### 7.1 色彩映射（参考图 → 本项目）

| 元素         | 参考图（橙色系）  | 本项目（靛蓝系）            |
| ------------ | ----------------- | --------------------------- |
| 选中选项背景 | `#f5e8e3`（浅橙） | `#EEF2FF`（浅靛蓝）         |
| 选中选项边框 | `#e07b5a`（橙）   | `#4F46E5`（主色）           |
| 选中选项文字 | `#c0533a`（深橙） | `#4F46E5`（主色）           |
| 必填星号     | `#e53e3e`（红）   | `#EF4444`（错误色，同项目） |
| 提交按钮激活 | `#c0533a`（深橙） | `#4F46E5`（主色）           |
| 提交按钮禁用 | 浅橙灰            | `var(--color-text-muted)`   |

### 7.2 选项 Pill 按钮规范

```css
/* 未选中 */
border: 1px solid var(--color-border);
background: #fff;
color: var(--color-text-primary);
border-radius: 20px; /* 全胶囊 */
padding: 6px 14px;
font-size: 13px;

/* 选中 */
border-color: #4f46e5;
background: #eef2ff;
color: #4f46e5;
```

### 7.3 表单卡片结构

```
┌─────────────────────────────────────────┐
│  简短提示语（AI 文字气泡）               │
│                                          │
│  ── 表单卡片 ──────────────────────────  │
│  问题1 标题  *                           │
│  [选项A]  [选项B]  [选项C]              │
│                                          │
│  问题2 标题（多选）                      │
│  [选项X]  [选项Y]  [选项Z]              │
│                                          │
│  问题3 标题（文本，选填）                │
│  ┌─────────────────────────────────┐    │
│  │ placeholder...                   │    │
│  └─────────────────────────────────┘    │
│  ─────────────────────────────────────  │
│  提示文案（选填可跳过）  [Send answers] │
└─────────────────────────────────────────┘
```

### 7.4 底部操作栏

- 左侧：小号灰色提示文案，内容固定为"选填项可以跳过，Agent 会使用默认值"
- 右侧：`Send answers` 按钮
  - 宽度自适应内容，高度 36px，圆角 8px
  - 激活：`background: #4F46E5; color: #fff`
  - 禁用：`background: var(--color-text-muted); cursor: not-allowed`

---

## 八、边界情况处理

| 情况                          | 处理方式                                                        |
| ----------------------------- | --------------------------------------------------------------- |
| LLM 输出 JSON 格式错误        | 后端解析失败时降级，不推送 `form` 事件，当作普通文本消息处理    |
| 表单已提交后用户刷新页面      | 历史消息加载时无 formData（已剥离），表单不重新渲染，只显示文本 |
| 用户在表单提交前发送普通消息  | 表单自动标记为 `disabled`，不可再次提交                         |
| 必填题但 LLM 标注了 text 类型 | 前端强制将 `text` 类型的 `required` 改为 `false`（防御性处理）  |
| 多轮提问（第二次出现表单）    | 支持，每次表单独立，前一个表单禁用即可                          |

---

## 九、文件变更清单

| 文件                                         | 变更类型 | 说明                                            |
| -------------------------------------------- | -------- | ----------------------------------------------- |
| `backend/src/services/prompts.ts`            | 修改     | 更新系统提示词中的提问格式规范                  |
| `backend/src/routes/sessions.ts`             | 修改     | 解析 QUESTION_FORM 块，推送 `form` SSE 事件     |
| `frontend/src/types/index.ts`                | 修改     | 新增 Question / QuestionForm 类型，扩展 Message |
| `frontend/src/composables/useSSE.ts`         | 修改     | 监听并处理 `form` 事件                          |
| `frontend/src/stores/messages.ts`            | 修改     | 新增 `attachFormToLastMessage` action           |
| `frontend/src/components/QuestionForm.vue`   | 新增     | 结构化提问表单渲染组件                          |
| `frontend/src/components/SessionSidebar.vue` | 修改     | 在消息列表中渲染 QuestionForm，处理提交逻辑     |

---

## 十、不在本次范围内

- 表单答案的持久化存储（当前只在内存中，刷新后不恢复选中状态）；
- 表单校验错误动画（如震动提示）；
- 问题的条件分支显示（如选了 A 才显示下一题）；
- 文件上传类型的问题题型。
