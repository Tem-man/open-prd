# 升级计划：PRD AI 编辑并入对话输入框

> 状态：草稿 | 创建时间：2026-09-13
>
> **更新（2026-09-26）**：§2.1「前端路由器 + 两条 Agent」与 §6.1「独立摘要 LLM 调用」已被
> [`plan-orchestrator-agent.md`](./plan-orchestrator-agent.md) 取代：编辑意图由编排 Agent 判定，改动说明由 Agent 的回复承担。
> 本文的 chip 交互、`messages.meta`、撤回栏与气泡形态仍然有效。
>
> 范围：会话页左侧 `SessionSidebar` 的 PRD Agent 对话流 + 右侧模块/元素 AI 编辑。
> 取代 `docs/plan-section-ai-edit-to-sidebar.md` 里「专用输入区盖住对话框」的交互（实现可保留内部自动保存，UI 不再走那套）。

---

## 一、背景与目标

### 现状

PRD 有两条互不相通的 AI 编辑入口，且都**不进聊天记录**：

| 入口       | 交互                                                                                                                                    | 提交                                                            | 聊天窗 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------ |
| 整模块     | `SessionSidebar` 用 `module-edit-area` **盖住**普通输入框（「正在编辑：功能清单」+ 独立 textarea +「AI 重写」+ 取消 / 撤回 / 保存文案） | `editSection(sessionId, sectionId, instruction)`                | 无     |
| 模块内元素 | `ElementFloatPanel` 贴在选中元素下方，自带输入框                                                                                        | 同上，额外带 `selectedElementHtml` / `entityName` / `tablePath` | 无     |

后端 `PATCH /prd/sections/:sectionId` 只流式改 HTML（`section_edit_delta` / `section_element_patch_start` / `section_edit_done`），不写 `messages` 表，也不产出自然语言说明。撤回只挂在侧栏专用输入区，语义是「该模块回退一个 section version」。

对照：用户期望接近 Cursor Composer——输入框里是可关闭的 `# 引用` chip，发送后对话里出现引用 + 提示词，AI 用自然语言说明改了什么，气泡末尾可撤回。

### 目标

1. **整模块 AI 编辑**复用 `SessionSidebar` 普通对话输入框，不再盖一层专用输入区。点选模块后输入框出现 `# 功能清单` 这类 chip。
2. **模块内小编辑**保留 `ElementFloatPanel`，但侧栏输入框同步出现更细 chip（`# 功能清单 · 单元格`），发送后聊天窗信息与整模块路径一致。
3. 发送后聊天出现两条消息：
   - 用户：引用 chip + 输入框提示词
   - AI：一段自然语言（「已经在 `# 功能清单 · 单元格` 里做了 xxx」），正文内嵌同样的引用 chip；气泡末尾「当前版本」+ **撤回**
4. 砍掉侧栏的 **取消**、**保存文案**。撤回从输入区挪到该条 AI 消息末尾。
5. 右侧 PRD 仍走现有 `editSection` HTML 流式更新；聊天里不贴 HTML。
6. **未点选时**用户直接说「改功能清单 / 把水印那一行改成…」：解析出模块后走同一套 `submitPrdEdit`（见 §3.1），不要掉进主 Agent 误触发整篇 `[GENERATE_PRD]`。

### 非目标（本期不做）

- 不在输入框里做自由 `@` 搜索模块列表。
- **不从纯文本定位 DOM**（不伪造 `# 功能清单 · 单元格` 再走 element patch）。口头提到某元素时，chip 停在模块级，由整模块 rewrite 按指令改那一处。
- 不支持一条消息挂多个 chip。
- 不把 section 任意历史 version 做成时间轴；撤回仍是「该模块回退一版」（与今天 `rollback` 一致），仅最新一条 AI 编辑消息可点。
- 不改原型编辑器 Chat。
- 不把这段编辑摘要写进导出的 PRD HTML。
- 不把「信息收集 / 提问表单」那套第一、二轮流程改掉；只在 **PRD 已生成之后** 换编辑向系统提示。

---

## 二、设计原则

1. **一条输入框**：侧栏永远渲染现有对话输入区（textarea + 附件 + `ModelSelector` + 发送）。引用用 chip 叠在输入框内，不切换整块 DOM。
2. **点选或口头解析均可引用**：右侧点选 → chip；无点选但话里能唯一对应到已有模块 → 发送时补上模块 chip，再走同一套编辑。点 chip × 或退出编辑态 → 清除引用。
3. **双入口、同一提交**：悬浮框、带 chip 发送、口头解析出发送，都走同一个 `submitPrdEdit()`，都进同一套聊天气泡。元素级精确 patch **只来自点选**（有 DOM / `tablePath`）。
4. **通道分离**：HTML 补丁继续走 section-edit SSE；自然语言摘要走新事件，写入 `Message.content`。禁止把 HTML 拼进气泡。
5. **落库可恢复**：用户消息、AI 摘要、引用与撤回元数据写入 `messages`，刷新后 chip / 撤回栏仍在。
6. **手工编辑不受影响**：`PrdSectionItem` 失焦、插行、删行等内部自动保存保留；只是侧栏不再提供「保存文案」。
7. **先路由、再进 Agent**：生成与编辑是两条互不调用的路线；侧栏发送先跑路由器，再进入其中一个。禁止把编辑能力塞进生成 Agent 的 prompt，也禁止编辑 Agent 去收集需求或吐 `[GENERATE_PRD]`。

### 2.1 两条 Agent 与路由器

同一输入框，**两个 Agent**，中间加一层**路由器**（前端 `routePrdTurn()`，纯函数；必要时才用小分类器）。路由器自己不写 PRD、不改 HTML。

|          | 生成 Agent                                                                                                         | 编辑 Agent                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| 代码入口 | `sendMessage` → `POST /messages` → `runAgentStream`                                                                | `submitPrdEdit` → `PATCH /prd/sections/:sectionId` |
| Prompt   | 未有 PRD：`buildSystemPrompt`（提问表单 + `[GENERATE_PRD]`）；已有 PRD 且本轮判定为闲聊/重做：`buildPostPrdPrompt` | 现有 section rewrite / element patch + 摘要        |
| 产出     | 对话、表单、整份 PRD 流水线                                                                                        | 某一章 HTML + 聊天里的摘要/撤回                    |
| 禁止     | 自己改某一章 HTML、自己输出 PRD 正文                                                                               | 收集需求、触发整篇生成                             |

```
用户点发送
        │
        ├─ 流水线/编辑进行中 ──────────────► 禁用（不进任一 Agent）
        ├─ 输入框已有 chip ────────────────► 编辑 Agent（target = chip）
        ├─ 会话还没有 PRD ─────────────────► 生成 Agent（信息收集）
        │
        │  以下均「已有 PRD、无 chip」
        ├─ 明确整份重做* ──────────────────► 生成 Agent（post-PRD，允许 [GENERATE_PRD]）
        ├─ 像在改文档** 且  恰好 1 章 ─► 编辑 Agent（补上该章 chip）
        ├─ 像在改文档但 0 章或多章命中 ────► 澄清：提问表单选模块（先不进 Agent）
        └─ 其余（解释、闲聊、夸一句）──────► 生成 Agent（post-PRD 闲聊；
                                              禁止随口 [GENERATE_PRD]，禁止改 HTML）
```

\* 整份重做：原文同时具备「重新生成/重做/再写一份」和「PRD/整份/全部模块」一类词，例如「整份 PRD 重新生成」。只说「再改改」不算。

\*\ 像在改文档 `looksLikeEdit`：含 改/修改/重写/删掉/补充/换成/更新/加上…；「这个功能清单看起来不错」不含这些动词 → 闲聊，走生成 Agent 的 post-PRD 提示。

#### 路由器怎么锁定「改哪一章」（无 chip 时）

按顺序，**命中恰好 1 个已生成模块**才交给编辑 Agent：

1. **标题 **：用户原文是否包含该章 `title` / `id` / 别名（见 §3.1）。  
   「把功能清单的水印改成…」→ `featureList`。
2. **正文 **（标题未唯一命中时）：从原文去掉「把…改成」等句式，剩下的名词片段去扫各章 **textContent**（不扫 class / Mermaid 源码）。  
   「把水印改了」且「水印」只出现在功能清单 → `featureList`。
3. 0 或 ≥2 → 不算锁定，走澄清或闲聊，**不要猜**。

口头路径默认只把 **模块** 交给编辑 Agent（整章 rewrite）。只有点选才带 `tablePath` 做元素 patch（正文 唯一命中某一格可作为后续增强，本期不作为路由成功条件）。

#### 为什么不用生成 Agent 兼做路由

今天 `buildSystemPrompt` 的目标是收集信息并触发整篇生成。若 PRD 已有后仍把「改功能清单」喂给它，它没有 `editSection` 工具，却很容易再吐 `[GENERATE_PRD]`。  
因此：**生成 Agent 永不直接改章；编辑意图在进模型之前就由路由器切走。**  
`[PRD_EDIT]` 标记只作为可选兜底（ 失败、澄清表单之后仍要模型理解时），不是主路径。

#### `routePrdTurn` 伪代码

```ts
type Route =
  | { agent: "generate"; prompt: "collect" | "postPrdChat" | "postPrdRegen" }
  | { agent: "edit"; target: ComposerTarget }
  | { agent: "clarify"; sections: PrdSection[] }; // 本地表单，不调用 LLM

function routePrdTurn(text, ctx): Route {
  if (ctx.chip) return { agent: "edit", target: ctx.chip };
  if (!ctx.prdReady) return { agent: "generate", prompt: "collect" };
  if (looksLikeFullRegenerate(text))
    return { agent: "generate", prompt: "postPrdRegen" };

  if (looksLikeEdit(text)) {
    const hit =
      matchSectionByTitle(text, ctx.sections) ??
      matchSectionByBody(text, ctx.sections);
    if (hit)
      return {
        agent: "edit",
        target: { sectionId: hit.id, sectionTitle: hit.title },
      };
    return { agent: "clarify", sections: ctx.sections };
  }

  return { agent: "generate", prompt: "postPrdChat" };
}
```

`SessionSidebar.handleSend` 只根据 `Route` 分发：`edit` → `submitPrdEdit`，`generate` → `sendMessage`（请求体带 `prompt` 或由后端看是否已有 PRD + regen 标记选 prompt），`clarify` → 往对话里塞一道「要改哪个模块？」表单，用户选完再带 chip 走编辑 Agent。

---

## 三、目标交互

```
左侧 SessionSidebar                              右侧 PRD
┌─────────────────────────────┐                 ┌──────────────────┐
│ 用户: 生成一个…              │                 │ 功能清单          │
│ AI: 思考 / 提问表单          │                 │  [单元格选中态]    │
│                             │                 │  ┌ 悬浮框 ──────┐ │
│ 用户: [# 功能清单 · 单元格]  │                 │  │ 告诉 AI…     │ │
│       把水印改成…            │                 │  └──────────────┘ │
│ AI: 已经在 [# 功能清单 · 单元格]
│     里把水印说明改成了…      │                 │  预览已更新       │
│     ┌───────────────────┐   │                 └──────────────────┘
│     │ 当前版本    [撤回] │   │
│     └───────────────────┘   │
├─────────────────────────────┤
│  [# 功能清单 · 单元格  ×]   │  ← 与悬浮框同一引用
│  继续输入修改指令…          │
│              [模型] [发送]  │
└─────────────────────────────┘
```

### Chip 文案

| 点选               | label                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 整模块             | `# ${sectionTitle}`，如 `# 功能清单`                                                                                                    |
| 块级元素           | `# ${sectionTitle} · ${elementLabel}`，label 复用 `ElementFloatPanel` 现有 `TAG_LABELS` / `CLASS_LABELS`（段落、标题、场景卡片、图表…） |
| 单元格 / 表头 / 行 | `# 功能清单 · 单元格` / `· 表头` / `· 表格行`                                                                                           |
| 多格               | `# 功能清单 · 3个单元格`                                                                                                                |
| ER 实体            | `# 数据模型 · ROLE实体`                                                                                                                 |

展示形态对齐示意图：浅底圆角 pill、`#` 前缀、输入框内可 × 关闭；聊天里的 chip 无 ×（只读）。

### 发送规则

分发以 §2.1 `routePrdTurn` 为准，这里是对照表：

| 输入框状态            | 点发送                                                 |
| --------------------- | ------------------------------------------------------ |
| 有 chip，提示词非空   | **编辑 Agent** `submitPrdEdit`                         |
| 有 chip，提示词为空   | 不发送                                                 |
| 无 chip，PRD 尚未生成 | **生成 Agent**（信息收集）                             |
| 无 chip，PRD 已生成   | `routePrdTurn`：编辑 / 生成(闲聊或整份重做) / 澄清表单 |
| AI 编辑或流水线进行中 | 禁用发送                                               |

悬浮框回车/提交：等同侧栏发送（用悬浮框当前文本）。两边草稿建议写入同一 `composerDraft`，避免各打各的。

### 3.1 无点选：口头修改某某模块 / 某某元素

无 chip 时**先走 §2.1 路由器**，不要把句子直接喂给生成 Agent。本节只补充「 如何定章」和编辑 Agent 内部用整章 rewrite 还是 element patch。

#### 为什么不把口头里的「元素」当成点选？

`ElementFloatPanel` 的精确 patch 依赖 `selectedElementHtml` / `tablePath` / `entityName`。纯文本「改水印那一行」无法稳定命中 DOM：同名多行、改过标题、Mermaid 节点都对不上。硬套细粒度 chip 会让用户以为只改了一格，实际可能改错。

| 来源                                       | chip                   | 后端路径                                               |
| ------------------------------------------ | ---------------------- | ------------------------------------------------------ |
| 点选单元格                                 | `# 功能清单 · 单元格`  | element patch                                          |
| 口头「把功能清单里水印那行改成…」          | `# 功能清单`（模块级） | **整模块 rewrite**，指令原文交给模型在 HTML 里找那一处 |
| 口头只说「把水印改了」且能唯一匹配到某模块 | 同上                   | 同上                                                   |
| 口头含糊（多个模块都可能 / 不像在改 PRD）  | 不自动 chip            | 见下方降级                                             |

摘要里允许写「已经在 `# 功能清单` 的「现场拍照水印」里…」——位置用自然语言点名，不伪造元素 chip。

#### 两级解析（快路径 + 澄清 / 生成 Agent 闲聊）

无 chip 且 `prdReady` 时的细节即 §2.1：先 `looksLikeEdit` + 标题/正文 ，唯一命中才进编辑 Agent；否则澄清或 post-PRD 闲聊。不要在生成 Agent 里用 `[PRD_EDIT]` 当主路由。

模块别名示例：`featureList` ↔ 功能清单 / 功能列表 / 功能点；`dataModel` ↔ 数据模型 / ER / 实体。只匹配**当前会话已选模块**，避免点到没生成的章。

#### 不采用的方案

| 方案                                 | 原因                                                           |
| ------------------------------------ | -------------------------------------------------------------- |
| 继续丢给现有主 Agent                 | prompt 仍是收集需求，极易误触发整篇生成                        |
| 每条消息先打一次独立路由 LLM         | 所有闲聊都多一跳延迟；快路径标题匹配已覆盖高频说法             |
| 主 Agent 自己输出 HTML               | 违反现有「禁止 Agent 吐 PRD HTML」；也绕开 patch / 版本 / 撤回 |
| 文本模糊匹配某一格再走 element patch | 命中率差，本期不做                                             |

#### 和点选路径的关系

解析成功后的聊天形态、摘要、撤回栏、`messages.meta` **与点选整模块完全相同**。只是 chip 出现在「发送当时」而不是输入前；输入框里不必预先出现 chip（发送后用户气泡带 chip；若希望输入框也闪一下 chip，可在 `submitPrdEdit` 前 `setComposerTarget` 再在结束后按是否仍在编辑态决定是否保留）。

### 撤回栏

- 仅出现在 **kind = prd_edit** 的 assistant 气泡底部。
- 文案：左「当前版本」，右「撤回」（进行中「撤回中…」）。
- 仅当该消息是**该 `sectionId` 上最新一次成功的 AI 编辑**且尚未撤回时按钮可点。
- 点撤回 → 现有 `POST .../rollback`；成功后右侧 HTML 还原，该气泡标记已撤回（按钮改为「已撤回」或隐藏），更早的编辑气泡保持不可撤回。

---

## 四、整体架构

```
SessionSidebar.handleSend
  → routePrdTurn()                         ← §2.1 路由器（不是 Agent）
       ├─ generate → sendMessage / 生成 Agent
       ├─ clarify  → 本地「改哪一章」表单
       └─ edit     → setComposerTarget → submitPrdEdit
              ├─ 乐观插入 user / assistant 气泡
              └─ PATCH /prd/sections/:sectionId
                    ↓
                 persist section
                    ↓
                 短 LLM 摘要（{{CITE}}）
                    ↓
                 SSE: section_edit_* + summary_*
                    ↓
                 用户气泡 chip + 提示词
                 AI 气泡 {{CITE}}→chip + 撤回栏
```

点选：右侧选模块/元素直接 `setComposerTarget`，发送时路由器第一步就进编辑 Agent。

摘要**不**混进现有「只输出 HTML」的编辑 prompt。元素 Patch / 实体 Patch 对格式极敏感，第二段短调用更安全。代价是多一次小请求；在 HTML `section_edit_done` 之后再流式摘要，气泡先打字、后出正文。

---

## 五、数据与协议

### 5.1 `messages.meta`

新增列，与 `thinking` 同一套迁移风格：

```sql
ALTER TABLE messages ADD COLUMN meta TEXT NOT NULL DEFAULT '{}';
```

`schema.ts` 建表同步加上。`prdVersions` 快照 / 重建工作区的 `SELECT` / `INSERT` 必须带上 `meta`（否则切换版本会丢 chip 与撤回态）。

前端 `Message` 增补：

```ts
export interface PrdEditCitation {
  sectionId: string
  sectionTitle: string
  elementLabel?: string // 无则表示整模块
}

export interface PrdEditMeta {
  kind: "prd_edit"
  citation: PrdEditCitation
  /** assistant 专用：这次编辑写入的 section version */
  resultVersion?: number
  rolledBack?: boolean
}

// Message 上：
meta?: PrdEditMeta | Record<string, unknown>
```

- **user.content**：纯提示词（不含 chip 文本）。
- **assistant.content**：摘要原文，位置用 `{{CITE}}`。
- **主 Agent `loadHistory`**：`kind === "prd_edit"` 的 user 行格式化为 `（针对 PRD「功能清单 · 单元格」）提示词`，assistant 行把 `{{CITE}}` 换成可读标签后回传。这样后续对话知道改过什么，又不把 HTML 喂给模型。

### 5.2 新 SSE 事件

现有 `section_edit_*` 保持。新增：

| `data.type`                  | 含义                                              |
| ---------------------------- | ------------------------------------------------- |
| `section_edit_summary_delta` | 摘要增量 `{ content }`                            |
| `section_edit_summary_done`  | 摘要结束；可与 `section_edit_done` 合并字段，见下 |

建议把落库后的消息身份放进现有 `section_edit_done`（避免时序竞争）：

```ts
{
  type: "section_edit_done",
  sectionId, newHtml, version, assembledPrdHtml,
  userMessage: { id, content, meta, createdAt },
  assistantMessage: { id, content, meta, createdAt } // content 可能先空，随后 summary_delta 填充
}
```

若摘要在 persist **之后**才生成：先 `section_edit_done`（HTML + 消息 id + 空 assistant content），再 `summary_delta`，最后 `section_edit_summary_done`。前端用返回的 id 校正乐观消息。

失败：现有 `section_edit_error`；前端删掉这两条乐观气泡（或把 assistant 标为错误）。

### 5.3 PATCH 请求体

保持 `instruction` / `selectedElementHtml` / `entityName` / `tablePath` / `llm`。前端额外可传 `citation`（sectionTitle + elementLabel），供后端写 meta 与摘要 prompt，避免后端再猜中文标签。

---

## 六、后端改动

### 6.1 摘要生成（`sectionEdit.ts`）

三分支（整模块 rewrite / element patch / entity focus）在 `persistSectionRevision` **成功之后**、写 `section_edit_done` 前后：

1. `INSERT` user + assistant 消息（assistant content 先 `''`）。
2. 短 prompt `invoke` 或 `stream`（推荐 stream 以配合 `summary_delta`）：

```
你是 PRD 编辑助手。用一两句中文向用户说明刚才按指令做了什么修改。
- 必须包含占位符 {{CITE}} 表示修改位置，不要自己编模块名
- 不要输出 HTML、Markdown 代码块或 JSON
- 不要复读用户指令全文，要说结果（例如「已经在 {{CITE}} 里把水印说明改成支持压缩与本地缓存」）

模块：功能清单
目标：单元格   （整模块时写「整个模块」）
用户指令：…
```

3. 把完整摘要 `UPDATE` 到 assistant 行。
4. 摘要失败：assistant.content 回退为 `已经在 {{CITE}} 里按你的要求完成修改。`，不让整次 HTML 编辑失败。

### 6.2 撤回

`POST .../rollback` 协议不变。前端自行决定点哪条消息；后端仍只回退该 section 的 current→previous。不必按 message id 回退（本期不做任意 version）。

可选：rollback 成功时不改历史消息；前端把对应 `meta.rolledBack = true`。若要刷新后仍显示「已撤回」，需要：

- 前端 rollback 成功后再 `PATCH` 消息 meta，或
- rollback API 接收 `messageId` 并更新该行 meta

推荐 rollback 增加可选 `messageId`：有则把该 assistant 的 `meta.rolledBack` 置 true。无则行为与今天完全一致。

### 6.4 生成 Agent 的 post-PRD 提示（只用于闲聊 / 整份重做）

路由器把会话交给生成 Agent 且 **已有 PRD** 时，用 `buildPostPrdPrompt`，与信息收集 prompt **互斥**。

- `postPrdChat`：回答用户对已有 PRD 的问题；**禁止** `[GENERATE_PRD]`，**禁止**输出 HTML 或冒充改章。
- `postPrdRegen`：仅当路由器判定「整份重做」时启用，允许末尾 `[GENERATE_PRD]`。

不要在生成 Agent 里解析 `[PRD_EDIT]` 再跳到编辑——那会把两条路线拧在一起。编辑只由 `routePrdTurn` → `submitPrdEdit` 进入。

### 6.3 其它调用点

| 文件                                      | 改动                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `backend/src/db/schema.ts`                | `messages.meta`                                                          |
| `backend/src/db/migrations.ts`            | `ADD COLUMN meta`                                                        |
| `backend/src/services/sse.ts`             | `writeSectionEditSummaryDelta` 等                                        |
| `backend/src/services/prdVersions.ts`     | 快照读写带 `meta`                                                        |
| `backend/src/routes/sessions/messages.ts` | INSERT 带 `meta`；按路由选用 collect / postPrdChat / postPrdRegen prompt |
| `backend/src/services/prompts.ts`         | `buildPostPrdPrompt`                                                     |
| `AGENTS.md`                               | SSE、消息 meta、两条 Agent + 路由器                                      |

`GET /api/sessions/:id` 已 `SELECT *`，新列会自动返回。

---

## 七、前端改动

### 7.1 `prdEditStore`：composer 目标

```ts
interface ComposerTarget {
  sectionId: string;
  sectionTitle: string;
  elementLabel?: string;
  /** 交给 editSection 的 patch 参数；整模块时全空 */
  selectedElementHtml?: string;
  entityName?: string;
  tablePath?: TableElementPath;
}

composerTarget: Ref<ComposerTarget | null>;
composerDraft: Ref<string>;
```

- `startEdit(sectionId)`：同时 `setComposerTarget({ sectionId, sectionTitle })`（整模块）。
- `ElementFloatPanel` 选中变化：升级 target 的 `elementLabel` + patch payload。
- 取消选中元素但模块仍在编辑：退回整模块 chip。
- `cancelEdit()` / chip ×：清空 target 与 draft（× 是否退出右侧编辑态：与右侧模式徽章 × 一致，调用 `cancelEdit`）。
- **`onAiEditDone` 不再 `cancelEdit()`**，以便连续追问同一模块；HTML 更新逻辑保留。

侧栏「保存文案 / 取消 / 撤回」及相关 `handleModule*`、`module-edit-area` 模板和样式全部删除。`htmlGetter` / `useSectionActions.saveSection` 仍供 `PrdSectionItem` 内部自动保存使用。

### 7.2 统一提交：`useSectionEdit` 扩展

在 `useSSE.ts` 的 `useSectionEdit`（或新建 `usePrdEditComposer.ts`）中：

```ts
async function submitPrdEdit(
  sessionId: string,
  instruction: string,
): Promise<void>;
```

步骤：乐观插入 user / assistant → `editSection(...)`（把 citation 放进 body）→ 消费 summary SSE → `finalizeMessage`。悬浮框、侧栏带 chip、口头快路径都只调这个函数。

`editSection` 签名增加可选 `citation`、`onSummaryDelta`、消息 id 回调；或让 `submitPrdEdit` 包一层 fetch，避免再拆一套 SSE 解析。优先**扩展现有 parser**，不要复制一份 PATCH 客户端。

新建 `frontend/src/utils/routePrdTurn.ts`：实现 §2.1 `routePrdTurn`（含 `looksLikeEdit`、`looksLikeFullRegenerate`、标题 、正文 ）。单测同目录 `*.test.ts`。

### 7.3 `SessionSidebar.vue`

- 删除 `v-if="isModuleEditing"` 整块 `module-edit-area`，永远走普通 `.input-area`。
- 输入框顶部（textarea 内上方）渲染 chip：`v-if="prdEditStore.composerTarget"`。
- `v-model` 在有 target 时绑 `composerDraft`，否则绑 `inputText`。
- `handleSend`：调用 `routePrdTurn`，按返回值分发（`edit` / `generate` / `clarify`），见 §2.1。
- 用户气泡：`msg.meta.kind === 'prd_edit'` 时先画只读 chip，再画 `content`。
- AI 气泡：把 `{{CITE}}` 换成只读 chip（做一个小函数 / 小组件，避免 markdown 把 `#` 当标题）；底部 `PrdEditUndoBar`。
- 撤回：`rollbackSection` + 更新该条 `meta.rolledBack`。

新建小组件（均放 `frontend/src/components/`）：

| 组件                 | 用途                               |
| -------------------- | ---------------------------------- |
| `CitationChip.vue`   | pill；`dismissible` 控制是否显示 × |
| `PrdEditUndoBar.vue` | 「当前版本」+ 撤回                 |

图标继续 Lucide（如 `icon-lucide-hash` / `icon-lucide-undo-2`），主色 `#4F46E5`，chip 背景用浅靛（如 `#EEF2FF`）。

### 7.4 `ElementFloatPanel.vue`

- 保留定位、文字模式、插行/删行、Mermaid 按钮、本地输入框。
- 选中时 `setComposerTarget`（细粒度 label + patch payload）。
- `handleSubmit` 改为 `submitPrdEdit`；提交后清空 draft。
- 卸载或选中清空时，把 target 退回整模块（若仍 `editingSection`）。

### 7.5 消息 store / 类型 / 历史还原

- `Message.meta`；`setMessages` 从 API 解析 `meta` JSON 字符串。
- 乐观插入走现有 `addUserMessage` / `startStreamingMessage`。
- `appendDelta` 用于 summary（assistant content）。
- 版本切换后 `loadHistory` 必须还原 chip 与撤回态。

---

## 八、涉及文件

| 文件                                                       | 改动                                          |
| ---------------------------------------------------------- | --------------------------------------------- |
| `backend/src/db/schema.ts`                                 | `messages.meta`                               |
| `backend/src/db/migrations.ts`                             | 加列                                          |
| `backend/src/services/sse.ts`                              | summary 事件                                  |
| `backend/src/services/prdVersions.ts`                      | 快照带 meta                                   |
| `backend/src/routes/sessions/messages.ts`                  | INSERT meta                                   |
| `backend/src/routes/sessions/sectionEdit.ts`               | 落消息 + 摘要 LLM                             |
| `backend/src/routes/sessions/sectionMutate.ts`             | rollback 可选更新 message meta                |
| `frontend/src/types/index.ts`                              | citation / meta                               |
| `frontend/src/stores/prdEdit.ts`                           | composerTarget；AI 完成后不退出编辑态         |
| `frontend/src/stores/messages.ts`                          | 解析 meta                                     |
| `frontend/src/composables/useSSE.ts`                       | 扩展 section-edit SSE                         |
| `frontend/src/composables/useSectionActions.ts`            | 侧栏不再包 save；rollback 可接收 messageId    |
| `frontend/src/components/CitationChip.vue`                 | **新建**                                      |
| `frontend/src/components/PrdEditUndoBar.vue`               | **新建**                                      |
| `frontend/src/views/session/components/SessionSidebar.vue` | 去掉专用输入区；chip + 气泡 + 发送分流        |
| `frontend/src/components/ElementFloatPanel.vue`            | 同步 target；提交走 composer                  |
| `frontend/src/views/session/components/PrdSectionItem.vue` | startEdit 时写入整模块 target（若尚未有元素） |
| `frontend/src/utils/routePrdTurn.ts`                       | **新建**：§2.1 路由器                         |
| `backend/src/services/prompts.ts`                          | `buildPostPrdPrompt`（闲聊 / 整份重做）       |
| `AGENTS.md`                                                | 协议与交互                                    |

不改：`prd/modules/*` 章节生成器、提问表单的第一/二轮规则、原型编辑器 Chat。

---

## 九、实施顺序

1. **数据层**：`meta` 列 + types + 版本快照读写。
2. **Store**：`composerTarget` / `composerDraft`；`startEdit` / 取消选中 / chip × 的同步规则；`onAiEditDone` 不再 `cancelEdit`。
3. **Chip UI**：`CitationChip` + 侧栏输入框接入；删 `module-edit-area`；发送分流（先可只打日志，再接 API）。
4. **后端摘要 + 落库 + SSE**；前端 `useSectionEdit` 消费并写气泡。
5. **ElementFloatPanel** 同步细粒度 chip 与同一提交。
6. **AI 气泡内联 chip + `PrdEditUndoBar`**；rollback 与 `rolledBack`。
7. **主 Agent 历史格式化**、版本切换回归。
8. **路由器**：`routePrdTurn` + `buildPostPrdPrompt`（生成 Agent 不再拦截 `[PRD_EDIT]`）。
9. **更新 `AGENTS.md`**（两条 Agent、路由器、SSE、messages.meta）。
10. **浏览器验证**（见下）。

---

## 十、边界与回归

| 场景                                            | 期望                                                            |
| ----------------------------------------------- | --------------------------------------------------------------- |
| 未点选，PRD 尚未生成                            | 无 chip，主 Agent 信息收集，行为与今天一致                      |
| 未点选，PRD 已生成，说「把功能清单的水印改成…」 | 快路径命中 → 用户气泡 `# 功能清单` + 整模块 rewrite + 摘要/撤回 |
| 未点选，说「把水印改了」且无法唯一匹配模块      | post-PRD Agent 用表单问要改哪一章，不直接 patch                 |
| 未点选，说「这个功能清单不错」                  | 不走编辑（`looksLikeEdit` 为假）                                |
| 未点选，明确「整份 PRD 重做」                   | 允许 `[GENERATE_PRD]`                                           |
| 口头提到单元格但未点选                          | chip 仍是模块级，**不**走 element patch                         |
| 点选模块未点元素                                | `# 功能清单`；发送 = 整模块 rewrite                             |
| 再点单元格                                      | chip 变成 `# 功能清单 · 单元格`；发送 = element patch           |
| 悬浮框发送 / 侧栏发送                           | 同一对气泡，PRD 同一处更新                                      |
| 点 chip ×                                       | 无引用，输入框回到主对话；右侧退出编辑态                        |
| 摘要 LLM 失败                                   | HTML 已保存；气泡用兜底句 + 仍可撤回                            |
| 连续两次编辑同一模块                            | 两条 AI 气泡；只有最新一条能撤回                                |
| 撤回最新一次                                    | PRD 回上一版；该气泡「已撤回」                                  |
| 刷新页面                                        | chip 不自动恢复（未点选）；历史气泡的 chip / 撤回态从 meta 恢复 |
| 切换 PRD 版本                                   | 消息随版本走，meta 不丢                                         |
| 内部插行/删行/失焦保存                          | 仍自动 PUT content，不进聊天                                    |
| 无思考模型 / 有思考模型                         | 本节编辑摘要不走 thinking 通道                                  |

---

## 十一、验证清单

无浏览器工具时用页面实点（会话页桌面宽度）：

1. 普通对话发送仍走主 Agent。
2. 进入「功能清单」编辑：侧栏出现 `# 功能清单`，无「正在编辑」盖层，无取消/保存文案。
3. 输入「把优先级列改成 P0/P1/P2」发送：左侧出现用户 chip+文案；右侧模块更新；AI 一句自然语言且含 chip；底部可撤回。
4. 点某个单元格，悬浮框仍在，侧栏 chip 变为 `# 功能清单 · 单元格`；从悬浮框发送，聊天同样出现一对消息。
5. 撤回最新 AI 编辑，预览还原；再点更早那条的撤回应为禁用。
6. 刷新后历史里 chip 与「已撤回」仍在；新输入框无残留 chip。
7. **不点选**，输入「把功能清单里水印那行改成支持压缩」：聊天出现 `# 功能清单` 气泡，右侧该模块更新，不是整份 PRD 重生成。
8. **不点选**，输入「这个功能清单看起来不错」：普通对话，不改 HTML。
9. **不点选**，输入「把水印改一下」（无模块名）：应提问或澄清模块，而不是猜一个 section 就 rewrite。

---

## 十二、`AGENTS.md` 同步要点（实现时改）

- 前端组件表：补 `CitationChip`、`PrdEditUndoBar`；侧栏输入区说明改为「普通输入框 + 可选 PRD 引用 chip」，删除「模块编辑控制区盖住输入框」。
- SSE：`section_edit_summary_delta` / `section_edit_summary_done`；`section_edit_done` 附带消息 id。
- Schema：`messages.meta`。
- 交互：模块/元素 AI 编辑作为带引用的对话消息；撤回在对应 AI 气泡末尾。
- **两条 Agent**：生成（`POST /messages`）与编辑（`PATCH .../sections/:id`）互不调用；侧栏 `routePrdTurn` 按 chip / 是否已有 PRD / 是否整份重做 / 定章来选择。生成 Agent 不改章；编辑 Agent 不收集需求、不触发整篇生成。
