# 原型设计依据模块（PRD ↔ 原型桥接）— 实施规划

> 需求来源：用户对话（2026-09-05）
> 目标：
> 1. PRD 新增一个**默认选中**的内置模块「原型设计依据」，其内容作为原型设计编辑器 AI 代理生成原型的输入依据，打通 PRD 与原型稿之间的信息孤岛；
> 2. PRD Agent 生成完一份 PRD 后，提醒用户可以使用这份依据生成原型稿。
>
> 状态：**待施工**（本文件仅为计划，不包含任何代码改动）

---

## 一、现状盘点

| 层 | 现状 | 问题 / 差距 |
| --- | --- | --- |
| **DB** | `BUILTIN_MODULES`（`backend/src/db/schema.ts` L24–64）定义 7 个内置模块，迁移 v1 播种、v3 回填描述 | 无「原型设计依据」模块 |
| **后端生成** | `BUILTIN_MODULE_MAP`（`backend/src/services/prd/index.ts` L23–35）注册 7 个生成器，未知 ID 走 `custom.ts` 兜底 | 需新增生成器文件并注册 |
| **后端 Prompt** | `buildSystemPrompt`（`prompts.ts` L24–43）注入所选模块列表；空列表时硬编码 7 模块兜底 | 兜底清单需同步为 8 个 |
| **大纲规划** | `prdOutline.ts` `getSessionModules`（L40–53）在 `selected_modules` 为空时回退到全部 `BUILTIN_MODULES`；`DIAGRAM_SKILL_MAP`（`skillLoader.ts` L40–45）仅图表模块需要 | 新模块为文段类，无需进 DIAGRAM_SKILL_MAP |
| **前端默认选中** | `ModuleManager.vue` L235–241：无 `initialSelected` 时自动选中全部 `isBuiltin` 模块 | ✅ 新增 `is_builtin=1` 模块即自动默认选中，**无需改动** |
| **前端工作流步骤** | `DEFAULT_WORKFLOW_STEPS`（`frontend/src/types/index.ts` L111–122）硬编码 7 个模块步骤；`MODULE_TO_STEP_ID`（`stores/messages.ts` L15–34）做映射 | 需登记第 8 个模块的进度步骤 |
| **完成提醒** | `useSSE.ts` L170–189：收到 `prd_ready` 后 `addStaticAssistantMessage("✅ PRD 已生成完成，点击右侧面板查看")` | 静态纯文本，无动作按钮，无生成原型引导 |
| **原型编辑器 AI** | `frontend/src/pencil/app/ai/chat/transports.ts` 用固定 `SYSTEM_PROMPT`（`system-prompt.md?raw`）创建 `ToolLoopAgent` | 无任何外部上下文注入通道，不知道 PRD 的存在 |
| **会话↔原型关联** | `prototypes.session_id` 可空外键已存在（`schema.ts` L154–164）；`POST /api/prototypes` 已接受 `sessionId`（`routes/prototypes.ts` L49–61）；list/meta 已返回 `sessionId` | 前端 `createPrototype` 只传 `{ title }`，链路未打通 |
| **PRD 数据获取** | `GET /api/sessions/:id/prd/sections` 已存在（PRD 编辑器在用） | 原型侧未消费 |

---

## 二、方案设计

### 2.1 新模块定义

| 项 | 值 |
| --- | --- |
| id | `prototypeBasis` |
| 名称 | 原型设计依据 |
| `is_builtin` | `1`（→ ModuleManager 自动默认选中，满足需求 1） |
| `render_type` | `html`（文段 + 表格，无 CDN 依赖，`renderer.ts` 零改动） |
| `skill_name` | `skill-prd-prototype`（新增 Skill，约束输出结构） |
| 生成方式 | 专用生成器 `prototypeBasis.ts` + `buildSkillBlock` 注入 Skill 规范 |

**为什么需要 Skill**：该模块的首要消费者是**原型编辑器的 AI 代理**而非仅人类读者，输出结构必须稳定、可解析，因此用 Skill 固化章节结构（参照图表模块用 Skill 固化 Mermaid 语法的既有模式）。

### 2.2 模块内容结构（由 Skill 约束）

1. **产品概述与目标用户**（一段话，供 AI 把握整体）
2. **页面清单表格**：页面名称 / 层级 / 核心目标 / 优先级
3. **页面详情**：每页一个 `<h3>` 小节 —— 布局结构、关键组件、交互行为、异常态
4. **全局导航与页面跳转关系**（表格或列表）
5. **设计规范**：色彩 / 字体 / 圆角 / 间距（默认对齐项目色彩系统 `#4F46E5` 等）
6. **用户流程 → 页面映射**（与「业务流程」模块呼应，但落到页面级）

### 2.3 端到端数据流

```
PRD 生成（新增 prototypeBasis 章节）
  → SSE prd_ready
  → 聊天区提醒消息（文案 + 「生成原型稿」动作按钮）        ← 需求 2
  → 点击 → POST /api/prototypes { title, sessionId }      ← 打通已有字段
  → 跳转 /prototype/:id
  → PencilEditor 加载原型 meta 得到 sessionId
  → GET /api/sessions/:id/prd/sections 取 prototypeBasis 章节
  → HTML → 纯文本（截断 ≤ 6000 字符）
  → 注入设计代理 instructions（SYSTEM_PROMPT + 依据块）    ← 需求 1 落地
  → 用户在 AI 面板中基于 PRD 依据生成原型
```

### 2.4 提醒与入口设计

- **主路径（需求 2）**：`prd_ready` 时的静态助手消息追加提醒文案，并携带动作按钮「使用此 PRD 生成原型稿」。消息类型扩展可选 `action` 字段。
- **辅助入口（可选 Phase）**：`PrdPanel` 工具条增加「生成原型稿」按钮（`hasPrd` 时可用），解决静态消息不持久化、刷新后提醒消失的问题。
- **原型侧反馈**：AI 面板头部显示「已关联 PRD：{会话标题}」徽标，让用户确认依据已加载；未关联时不显示，行为与现状一致。

### 2.5 上下文注入方式（transports.ts 改造）

- 新增轻量上下文持有者（`frontend/src/pencil/app/ai/prdContext.ts`）：`{ sessionId, title, basisText }` + `loadBasis(sessionId)`。
- `createToolLoopTransport` 增加可选上下文读取：构建 agent 时若有依据则拼接：

```typescript
const instructions = basisText
	? `${SYSTEM_PROMPT}\n\n# PRD 原型设计依据（生成原型必须遵循）\n${basisText}`
	: SYSTEM_PROMPT;
```

- **选 instructions 注入而非首条 synthetic user message**，理由：不污染对话历史、对后续所有轮次生效、与用户真实提问区分清晰。
- **时序要求**：`PencilEditor` 挂载后先 `await loadBasis()` 再允许创建/使用 transport（或依据未加载完时禁用发送按钮），避免 agent 以无上下文状态启动。
- **HTML→文本**：去标签，表格转为 `|` 分隔的简化标记以保留结构；超 6000 字符截断并追加「（内容已截断）」。

---

## 三、施工分阶段

### Phase 1：数据层与 Prompt

**目标**：第 8 个内置模块入库，新旧数据库路径都覆盖。

#### 1.1 修改 `backend/src/db/schema.ts`

`BUILTIN_MODULES` 追加：

```typescript
{ id: "prototypeBasis", name: "原型设计依据", description: "面向原型设计 AI 代理的结构化设计依据：页面清单、页面详情、导航关系与设计规范" },
```

#### 1.2 修改 `backend/src/db/migrations.ts`

当前最新为 v3，新增 v4（老库补插；新库走 v1 播种已包含）：

```typescript
if (version < 4) {
	db.prepare(
		"INSERT OR IGNORE INTO module_templates (id, name, description, skill_name, render_type, is_builtin, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
	).run(
		"prototypeBasis",
		"原型设计依据",
		"面向原型设计 AI 代理的结构化设计依据：页面清单、页面详情、导航关系与设计规范",
		"skill-prd-prototype",
		"html",
		Date.now(),
	);
	db.exec("PRAGMA user_version = 4");
}
```

> 注意：v1 播种语句若直接改 `BUILTIN_MODULES` 依赖则新库自动包含；迁移分支用 `INSERT OR IGNORE` 保证幂等。

#### 1.3 修改 `backend/src/services/prompts.ts`

`buildSystemPrompt` 空列表时的硬编码 7 模块兜底清单追加第 8 项。

---

### Phase 2：后端生成器与 Skill

**目标**：`prototypeBasis` 章节能被稳定生成，且 AI 重写（PATCH）路径同样受 Skill 约束。

#### 2.1 新建 `skills/skill-prd-prototype/SKILL.md`

按 §2.2 六项结构编写输出规范，明确：只输出 HTML 片段、页面清单必须用 `<table>`、每页详情用 `<h3>` 起始、设计规范给出具体色值。

#### 2.2 新建 `backend/src/services/prd/modules/prototypeBasis.ts`

参照 `background.ts`（文段）与 `custom.ts`（Skill 注入）模式：

```typescript
import { buildSkillBlock } from "../../skillLoader.js";
import { invokeModule } from "../llm.js"; // 以实际导出名称为准
import type { SectionOutline } from "../types.js";

export async function generate(section: SectionOutline): Promise<string> {
	const skillBlock = buildSkillBlock("skill-prd-prototype");
	const keyPoints = section.keyPoints.map((p, i) => `${i + 1}. ${p}`).join("\n");
	const sys = `${skillBlock}\n\n你是一位资深产品经理兼 UX 设计师，正在撰写 PRD 中的「${section.title}」章节。
该章节的读者是原型设计 AI 代理，必须严格遵循上方 Skill 规范的结构输出。只输出 HTML 片段，不含根标签。`;
	const user = `「${section.title}」关键要点：\n\n${keyPoints}\n\n请生成完整的 HTML 内容。`;
	return invokeModule(sys, user);
}
```

#### 2.3 修改 `backend/src/services/prd/index.ts`

`BUILTIN_MODULE_MAP` 注册 `prototypeBasis`。

#### 2.4 修改 `backend/src/routes/sessions.ts`（PATCH handler）

确认/泛化 Skill 注入逻辑：按 `sectionId` 查 `module_templates.skill_name` 时对**内置模块同样生效**（上一迭代只为自定义模块接入）。若现有实现已按 ID 无差别查询则无需改动。

#### 2.5 无需改动项（明确排除）

- `renderer.ts`：纯 HTML 模块，CDN 检测不受影响；
- `skillLoader.ts` `DIAGRAM_SKILL_MAP`：非图表模块；
- `prdOutline.ts`：文段类模块走默认 `keyPoints` 规划路径。

---

### Phase 3：前端模块体系适配

**目标**：进度步骤与默认选中行为正确。

#### 3.1 修改 `frontend/src/types/index.ts`

`DEFAULT_WORKFLOW_STEPS`（L111–122）在「数据模型」后追加：

```typescript
{ id: "prototypeBasis", label: "原型设计依据" }, // 字段名以现有结构为准
```

#### 3.2 修改 `frontend/src/stores/messages.ts`

`MODULE_TO_STEP_ID`（L15–34）追加 `prototypeBasis` 映射。

#### 3.3 验证（无代码改动预期）

- `ModuleManager.vue`：新模块因 `is_builtin=1` 自动进入默认选中列表；
- `SessionSidebar.vue`：`initialSelected` 回显正常；
- 老会话 `selected_modules` 已固化，不含新模块 —— 符合预期（仅新会话默认携带）。

---

### Phase 4：完成提醒与生成原型入口

**目标**：实现需求 2 的提醒，并打通「PRD → 一键建原型」链路。

#### 4.1 修改 `frontend/src/types/index.ts`

`Message` 增加可选字段：

```typescript
action?: { type: "create-prototype"; label: string };
```

#### 4.2 修改 `frontend/src/stores/messages.ts`

`addStaticAssistantMessage(sessionId, content, action?)` 支持透传 `action`。

#### 4.3 修改 `frontend/src/composables/useSSE.ts`

`prd_ready` 分支（L170–189）的成功消息改为：

```typescript
messagesStore.addStaticAssistantMessage(
	sessionId,
	"✅ PRD 已生成完成，点击右侧面板查看。\n\n💡 这份 PRD 已包含「原型设计依据」模块，可以直接据此生成原型稿。",
	{ type: "create-prototype", label: "使用此 PRD 生成原型稿" },
);
```

#### 4.4 修改聊天消息渲染组件（`SessionView` 消息列表项）

当 `message.action?.type === "create-prototype"` 时在气泡下方渲染按钮，点击处理：

```typescript
async function onCreatePrototype() {
	const proto = await prototypesStore.createPrototype({
		title: `${session.title || "未命名"} - 原型`,
		sessionId, // ← 打通关联
	});
	router.push(`/prototype/${proto.id}`);
}
```

#### 4.5 修改 `frontend/src/stores/prototypes.ts`

`createPrototype` 入参从 `{ title }` 扩展为 `{ title, sessionId? }`，POST body 携带 `sessionId`（后端已支持，`routes/prototypes.ts` L49–61）。

#### 4.6（可选）修改 `frontend/src/views/session/components/PrdPanel.vue`

工具条增加「生成原型稿」按钮（`hasPrd` 时可用），逻辑复用 4.4。作为静态消息不持久化的兜底入口。

---

### Phase 5：原型编辑器 AI 上下文注入

**目标**：关联了会话的原型，其设计代理自动携带「原型设计依据」。

> 约束：本阶段只改 `frontend/src/pencil` 界面层与 `frontend/src/stores`，**不改动 `packages/` 引擎源码**。

#### 5.1 修改 `frontend/src/stores/prototypes.ts`

加载原型 meta 时把 `sessionId` 暴露到当前原型状态（list/meta 接口已返回该字段）。

#### 5.2 新建 `frontend/src/pencil/app/ai/prdContext.ts`

```typescript
export interface PrdBasisContext {
	sessionId: string;
	title: string;
	basisText: string; // 已去标签、截断
}

let current: PrdBasisContext | null = null;

export function getPrdBasis(): PrdBasisContext | null { return current; }
export function clearPrdBasis(): void { current = null; }

export async function loadPrdBasis(sessionId: string): Promise<PrdBasisContext | null> {
	const res = await fetch(`/api/sessions/${sessionId}/prd/sections`);
	if (!res.ok) return null;
	const data = await res.json();
	const section = (data.sections ?? []).find((s: { id: string }) => s.id === "prototypeBasis");
	if (!section?.html) return null;
	current = {
		sessionId,
		title: data.title ?? "",
		basisText: truncate(htmlToText(section.html), 6000),
	};
	return current;
}
```

`htmlToText`：去标签、表格转 `|` 分隔；`truncate` 超限追加「（内容已截断）」。

#### 5.3 修改 `frontend/src/pencil/PencilEditor.vue`

挂载并完成 `bindPrototype` 后：若当前原型 `sessionId` 存在，则 `await loadPrdBasis(sessionId)`；卸载时 `clearPrdBasis()`。依据加载完成前，AI 输入框禁用并提示「正在加载 PRD 依据…」。

#### 5.4 修改 `frontend/src/pencil/app/ai/chat/transports.ts`

创建 `ToolLoopAgent` 时拼接动态 instructions（见 §2.5），从 `getPrdBasis()` 读取。

#### 5.5 修改 AI 面板组件（`frontend/src/pencil/components/` 下 Chat 相关）

头部显示「已关联 PRD：{title}」徽标（`getPrdBasis()` 非空时）；未关联原型不显示，行为与现状完全一致。

---

### Phase 6：文档同步（仓库硬性要求）

- `AGENTS.md`：PRD 文档结构表 7 → 8 模块；Skill 表追加 `skill-prd-prototype`；目录结构 `skills/` 追加；`frontend/src/pencil/app/ai/` 说明补充 `prdContext.ts`。
- `docs/prd-generation-flow.md`：模块清单与生成流程更新为 8 模块。
- 本 plan 归档于 `docs/`。

---

## 四、文件变更清单

### 新增文件

| 文件 | 说明 |
| --- | --- |
| `skills/skill-prd-prototype/SKILL.md` | 「原型设计依据」输出结构规范 |
| `backend/src/services/prd/modules/prototypeBasis.ts` | 章节生成器（Skill 注入 + invokeModule） |
| `frontend/src/pencil/app/ai/prdContext.ts` | PRD 依据加载 / 持有 / 文本化 |

### 修改文件

| 文件 | 改动内容 |
| --- | --- |
| `backend/src/db/schema.ts` | `BUILTIN_MODULES` 追加 `prototypeBasis` |
| `backend/src/db/migrations.ts` | 新增 v4 迁移（`INSERT OR IGNORE` 播种新模块） |
| `backend/src/services/prompts.ts` | 空列表兜底模块清单 7 → 8 |
| `backend/src/services/prd/index.ts` | `BUILTIN_MODULE_MAP` 注册新生成器 |
| `backend/src/routes/sessions.ts` | PATCH handler 的 Skill 注入对内置模块生效（确认/泛化） |
| `frontend/src/types/index.ts` | `DEFAULT_WORKFLOW_STEPS` 追加步骤；`Message` 增加 `action` 字段 |
| `frontend/src/stores/messages.ts` | `MODULE_TO_STEP_ID` 追加映射；`addStaticAssistantMessage` 支持 `action` |
| `frontend/src/composables/useSSE.ts` | `prd_ready` 成功消息追加提醒文案与动作按钮 |
| 聊天消息渲染组件 | 渲染 `action` 按钮并处理「创建原型 → 跳转」 |
| `frontend/src/stores/prototypes.ts` | `createPrototype` 支持 `sessionId`；meta 加载暴露 `sessionId` |
| `frontend/src/pencil/PencilEditor.vue` | 挂载时按 `sessionId` 加载 PRD 依据；卸载清理 |
| `frontend/src/pencil/app/ai/chat/transports.ts` | instructions 动态拼接依据块 |
| AI 面板 Chat 组件 | 「已关联 PRD」徽标 |
| `frontend/src/views/session/components/PrdPanel.vue`（可选） | 工具条「生成原型稿」按钮 |
| `AGENTS.md` / `docs/prd-generation-flow.md` | 文档同步 |

---

## 五、施工顺序与依赖关系

```
Phase 1（DB Schema + 迁移 + Prompt 兜底）
    ↓ 必须最先完成，后续依赖模块记录存在
Phase 2（Skill + 生成器 + 注册 + PATCH 泛化）
    ↓ 2.1 Skill 先行（生成器引用它）
Phase 3（前端步骤映射）          ← 与 Phase 2 可并行
    ↓
Phase 4（提醒 + 创建原型入口）    ← 依赖 Phase 1 的模块存在（提醒文案才有意义）
    ↓ 4.5 createPrototype(sessionId) 是 Phase 5 的前置
Phase 5（原型编辑器上下文注入）   ← 依赖 Phase 4 打通的 sessionId 链路
    ↓
Phase 6（文档同步）              ← 最后收口
```

---

## 六、验收标准

| # | 场景 | 验收条件 |
| --- | --- | --- |
| T-1 | 全新数据库启动 | `module_templates` 含 8 个内置模块，`prototypeBasis` 的 `is_builtin=1`、`skill_name='skill-prd-prototype'` |
| T-2 | 老数据库升级 | v4 迁移幂等执行，老数据与老会话 `selected_modules` 不受影响 |
| T-3 | 新建会话打开 ModuleManager | 「原型设计依据」默认选中（需求 1） |
| T-4 | 完整生成 PRD | 输出 HTML 含「原型设计依据」Tab，结构符合 Skill（页面清单表格、`<h3>` 页面详情、设计规范色值） |
| T-5 | 生成过程进度 | 工作流步骤包含第 8 模块且状态推进正常 |
| T-6 | PRD 生成完成 | 聊天区出现提醒消息 + 「使用此 PRD 生成原型稿」按钮（需求 2） |
| T-7 | 点击按钮 | 创建原型并跳转 `/prototype/:id`，DB 中 `prototypes.session_id` 正确写入 |
| T-8 | 原型编辑器 AI | 面板显示「已关联 PRD」徽标；向 AI 提问依据中的页面清单/设计规范可得到一致回答 |
| T-9 | 无关联原型（首页直接新建） | AI 行为与现状完全一致，无徽标、无依据注入 |
| T-10 | AI 重写 prototypeBasis 章节（PATCH） | 输出仍符合 Skill 结构 |
| T-11 | 老会话（无此模块）生成/查看 | 行为与升级前一致 |
| T-12 | 质量门禁 | `pnpm lint`、`pnpm --filter frontend typecheck` 通过 |

---

## 七、风险与注意事项

| 风险 | 说明 | 应对 |
| --- | --- | --- |
| 老会话不含新模块 | `selected_modules` 在创建时固化 | 预期行为，仅新会话默认携带；文档中说明 |
| Token 膨胀 | 新增章节增加大纲与生成开销；注入设计代理占用上下文 | 生成器 Prompt 限制篇幅；注入前截断 ≤ 6000 字符 |
| 静态消息不持久化 | 刷新后提醒按钮消失 | 可接受；可选 Phase 4.6 的 PrdPanel 按钮作兜底入口 |
| 依据加载时序 | transport 创建早于 `loadPrdBasis` 完成会导致 agent 无上下文启动 | 加载完成前禁用 AI 发送；或 transport 构建前 `await` |
| HTML→文本失真 | 表格结构丢失会降低 AI 理解质量 | 表格转 `\|` 分隔标记保留行列结构 |
| Electron 已知限制 | `file://` 下 `/prototype` 路由不可达（AGENTS.md 已记录的已知未完成项） | 桌面端入口暂不可用，不阻塞本期；沿用既有跟踪 |
| `packages/` 引擎约束 | 引擎包不构建、别名双处同步等约束 | 本期不改动 `packages/`，仅改 `frontend/src/pencil` 界面层 |
