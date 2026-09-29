# 升级计划：侧边栏对话定位到小节 / 表格行 / 单元格

> 状态：草稿 | 创建时间：2026-09-29
>
> 范围：PRD 已生成后，会话侧栏自然语言编辑。在**不经点选**时，把「改哪一块」解析成现有元素补丁，而不是整章 `rewriteSection`。
>
> 关系：在 [`plan-orchestrator-agent.md`](./plan-orchestrator-agent.md) §4.3 之上增加**服务端可寻址索引（内部）+ `search_targets`（Agent 入口）+ `locatorId`**；点选 chip 路径、`ElementFloatPanel`、`edit_entity` 保持不变。
> 部分取代 [`plan-prd-edit-as-chat.md`](./plan-prd-edit-as-chat.md) 中「不从纯文本定位 DOM、口头路径一律整章 rewrite」的约束——仅对小节 / 表格 / 场景卡片生效。

---

## 一、背景与问题

两条编辑入口的定位数据不对等：

| 入口 | 请求里的 `target` | `edit_section` 实际路径 |
| --- | --- | --- |
| `ElementFloatPanel` 点选 | `sectionId` + `selectedElementHtml` / `tablePath` / `entityName` | `patchElement` / `patchEntity` |
| 侧栏对话（无点选，或只有模块 chip） | 无，或只有 `{ sectionId, sectionTitle }` | 一律 `rewriteSection`（输出整章 HTML） |

`edit_section` 工具 schema 只有 `{ sectionId, instruction }`。元素坐标按 §4.3 **不经模型伪造**，因此模型即使写「只改导出那一行」，执行层也没有可打补丁的节点。

提示词把「改 / 加 / 删 + 具体内容」标成局部编辑，但没有元素快照时执行的是整章重写。用户在侧栏说「功能清单里把导出报表的优先级改成 P0」，会看到整张功能清单被重新生成。

现有补丁能力已经够用（`patchElement`、`patchTableElementByPath`、`patchEntity`）。缺的是点选的服务端等价物。

**不要把「给模型看的入口」和「给补丁用的坐标」混成一个概念：**

- Agent 对外只需一个搜索工具 `search_targets`（按关键词查可补丁节点，返回白名单 id）。
- 搜索命中必须能 `resolve` 成 `selectedElementHtml` / `tablePath`。这依赖服务端对当前 HTML 的确定性扫描索引；索引不单独暴露给模型，也不入库。

现有 `list_sections` / `get_section` 替代不了这件事：一个给模块摘要，一个给整章纯文本（可选截断 HTML），都没有行/格坐标。全文搜索若只返回文本片段、不带可校验 `locatorId`，`edit_section` 仍会落到 `rewriteSection`。

---

## 二、目标与非目标

### 目标

1. 侧栏无点选（或仅有模块 chip）时，对**已存在**的小节、功能分组、场景卡片、表格、行、单元格走元素补丁，不再整章重写。
2. 可补丁坐标由服务端从当前 HTML **确定性扫描**编成内部索引；模型只通过 `search_targets` 拿到 id（或由服务端用标签唯一命中自动绑定），**不输出待替换 HTML、不编造 XPath**。不向模型 dump 完整目录。
3. 定位失败或命中多条时**禁止静默 `rewriteSection`**：返回候选或走 `ask_user_form`。
4. 点选路径、数据模型 `edit_entity`、整章 `regenerate_section`、跨模块多次 `edit_section` 行为与今天一致。
5. 前端 SSE / chip / 撤回协议不变；编辑记录带上解析出的 `elementLabel`（与悬浮窗一致，如 `功能清单 · 导出报表`）。

### 非目标（本期明确不做，保留原样）

1. **流程图某个节点**：存的是 Mermaid 源码，不是可点 DOM。侧栏里「业务流程里加一个审批节点」等仍走整章 `edit_section`（`rewriteSection`）。不解析 flowchart 节点、不改 Mermaid AST；这类节点不进索引，`search_targets` 搜不到图内节点。
2. **信息架构 markmap 某支**：同样是图源码，没有行/格坐标。侧栏里「信息架构里删掉设置页」等仍走整章改写。不解析 markmap 分支，不进索引。
3. **「那个」「顺便把别处也改了」**：指代消歧与跨模块联动不新做。无明确对象 → 继续 `ask_user_form`（如「改一下那个表」）；跨模块 → 继续按现有判定表逐个调用工具（如功能清单改完再 `edit_section(flowchart)`）。流程图 / 信息架构那一跳仍是整章改写。`search_targets` 跨模块命中多条时只返回候选，不自动改多章。

另外也不做：

- 不给产品架构图、ER 图（非实体名）做节点级定位；ER 实体继续用 `edit_entity`。
- 不在生成器里打持久 `data-edit-id`（本期用当轮扫描的序号 id；改完下一轮重扫）。
- 不改 `ElementFloatPanel` 点选交互，不改原型编辑器 Chat。
- 不把 `selectedElementHtml` / `tablePath` 放进工具 schema 让模型填写。
- 不另做「列出全量目录」工具。索引只给 `search_targets` 过滤和 `edit_section` 解析用。

---

## 三、设计原则

1. **复用补丁，不新写改写引擎**。解析成功后的执行与悬浮窗相同：`patchElement` / `patchTableElementByPath`。
2. **搜索是查询 API，索引是坐标簿**。`search_targets` = 对内部目录做过滤；模型不能发明节点，只能使用本轮搜索（或 §6.2 绑定）得到的 `locatorId`。
3. **宁可不改，也不整章误伤**。`locatorId` 无效、标签命中 ≥2、索引为空却带着 locator → 工具返回可读错误，不 persist。
4. **整章改写仍合法**。用户明确重写本章、功能清单新增尚不存在的行/分组、以及非目标里的流程图 / 信息架构 / 产品架构图，继续不带 `locatorId` 的 `rewriteSection`。
5. **点选优先**。请求已带元素级 `ctx.target` 时，忽略模型填的 `locatorId`，行为与今天完全一致。

---

## 四、总体流程

```
侧栏发送（可无 chip / 仅模块 chip）
        │
        ▼
编排 Agent（编辑阶段）
        │
        ├─ 数据模型实体 ──────────────► edit_entity（不变）
        ├─ 单章重写 / 流程图 / 信息架构 / 架构图
        │                              ► edit_section（无 locatorId）► rewriteSection
        ├─ 局部：小节 / 表格 / 场景卡片
        │        │
        │        ├─ search_targets({ query, sectionId? })
        │        └─ edit_section(sectionId, instruction, locatorId)
        │                 │
        │                 ▼
        │           服务端 resolve(locatorId)   ← 内部索引，不经模型
        │                 │
        │                 ├─ 命中 ► 注入合成 target ► patchElement
        │                 └─ 未命中 ► 错误文本，不改 HTML
        └─ 点选元素 chip ──────────────► 现有 forceTargetEdit + patch（不变）
```

无 `locatorId` 时的**安全网**（见 §6.2）：用 instruction 对**同一套内部索引**的 `label` 做唯一子串命中，命中 1 条则视为该 locator，避免模型漏搜又整章重写。这与 `search_targets` 共用 `buildCatalog` / 过滤逻辑，不是第二条定位系统。

---

## 五、内部索引与搜索入口

每轮在服务端对**当前** `prd_sections.html_content` 扫描，不入库。id 只在本轮有效。扫描结果只留在服务端：搜索过滤、`resolve(locatorId)`、§6.2 绑定都读它；**不**作为工具把全量列表交给模型。

### 5.1 扫描规则（内部 `buildCatalog`）

用现有 `node-html-parser`，按 DOM 顺序编号：

| kind | 选择器 / 规则 | `locatorId` | `label` 来源 |
| --- | --- | --- | --- |
| `subsection` | `.prd-subsection` | `sub:{i}` | 内部首个 `h2`/`h3` 文本，否则前 20 字 |
| `group` | `.feature-module-group` | `group:{i}` | `.feature-module-title` |
| `scenario` | `.scenario-card` | `scenario:{i}` | `.scenario-title` |
| `table` | `table` | `table:{t}` | 表前最近标题，或 `表格{t+1}` |
| `row` | `table tbody tr`（无 tbody 则跳过 thead） | `row:{t}:{r}` | 该行第一个 `td` 文本 |
| `cell` | 行内 `td`/`th` | `cell:{t}:{r}:{c}` | `{行标签} · {对应 thead 列名}` |

`t` / `r` / `c` / `i` 均为 0-based 序号，与现有 `TableElementPath` 一致。

**不进入索引**（保证非目标）：

- `.mermaid` 及其内部任何节点（含 ER 实体 SVG；实体走 `edit_entity`）
- markmap 容器及分支
- 产品架构图源码节点

因此对「审批节点」「设置页」做 `search_targets` 要么 0 命中，要么只命中无关的小节/表格（若碰巧有同名 label）。模型应按提示词对流程图 / 信息架构 **不要**靠搜索图节点，直接整章 `edit_section`。

自定义模块若碰巧有 `prd-subsection` / `table`，同样可被搜到；没有这些结构则该章索引为空，局部编辑只能整章改写或提问。

### 5.2 `search_targets` 返回给模型的形状

每条命中只含 id + kind + label + sectionId，**不返回 HTML**：

```json
{
  "query": "导出报表",
  "targets": [
    {
      "id": "cell:0:2:2",
      "kind": "cell",
      "label": "导出报表 · 优先级",
      "sectionId": "featureList"
    }
  ]
}
```

跨模块搜索时 `targets` 可含不同 `sectionId`。多条命中只返回列表，由模型选 id 或 `ask_user_form`，不自动改多章（非目标 3）。

默认上限 20 条；超过则注明「请缩小 query 或指定 sectionId」。label 匹配：不区分大小写的包含关系。同一节点的 row/cell 同时命中时，按 §5.3 优先级折叠，优先返回更细的 kind。

### 5.3 解析成补丁 target（内部 `resolveLocator`）

服务端按 id 从索引取出完整节点（不给模型）：

| kind | 合成 `ComposerTarget` |
| --- | --- |
| `subsection` / `group` / `scenario` / `table` | `selectedElementHtml = outerHTML`，`elementLabel = label` |
| `row` | `tablePath: { kind: "row", tableIndex, rowIndex }` + 该 `tr` 的 outerHTML |
| `cell` | `tablePath: { kind: "cell", tableIndex, rowIndex, cellIndex }` + 该格 outerHTML |

`sectionId` / `sectionTitle` 填该节点所属模块。之后走现有 `patchElement`。

绑定优先级（同一句里可能同时命中行和格）：**cell > row > group/scenario/subsection > table**。用户说「导出报表的优先级」应落到 cell，而不是整行或整表。

---

## 六、绑定策略

### 6.1 模型主路径

`edit_section` 增加可选参数：

```ts
edit_section: z.object({
  sectionId: sectionIdSchema,
  instruction: z.string().min(1).max(2000),
  locatorId: z.string().max(64).optional()
    .describe("search_targets 返回的 id；改已有小节/行/格时必填。整章重写、流程图、信息架构、产品架构不要填。"),
});
```

`locatorId` 是本轮索引白名单里的短 id，**不是** DOM 片段。校验失败则视为未定位。`locatorId` 必须属于所传 `sectionId` 的索引（跨模块搜到的 id 填进错误的 `sectionId` → 失败，不改 HTML）。

### 6.2 无 locatorId 时的唯一标签绑定

当没有 UI 元素级 `ctx.target`、也没有合法 `locatorId` 时：

1. 构建该 `sectionId` 的内部索引（与 `search_targets` 同一 `buildCatalog`）。
2. 在 `instruction` 中查找 `label`（长度 ≥ 2）的包含关系；同一节点的 row/cell 按 §5.3 优先级折叠为一条。
3. **恰好 1 条** → 当作该 `locatorId`，走补丁。
4. **≥ 2 条** → 返回候选 id/label 列表，**不改 HTML**（提示用 `search_targets` 收窄或 `ask_user_form`）。
5. **0 条** → 保持今天的 `rewriteSection`（新增尚不存在的功能、流程图/信息架构/架构图、整章按指令改写）。

这样「功能清单里把导出报表的优先级改成 P0」即使模型忘了先搜索，只要「导出报表」唯一，仍打补丁。

「再加一个支付模块」索引里没有「支付」→ 0 条 → 整章改写（在功能清单里插入新分组），符合现有功能变更路径。

「改一下那个表」没有可用 label → 0 条。**不在工具内做指代消歧**；提示词仍要求模型先 `ask_user_form`（非目标 3）。若模型仍直接 `edit_section`，行为与今天相同（整章改写），本期不修。

### 6.3 与点选 / 实体 / 重写的优先级

```
1. ctx.target 为元素级（selectedElementHtml | entityName）→ 现有 patch，locatorId 无效
2. locatorId 合法 → patch
3. §6.2 唯一绑定 → patch
4. 否则 rewriteSection（含流程图 / 信息架构 / 无索引结构 / 新增内容）
```

`regenerate_section` 不读 locator。元素级 UI target 时仍禁止对本模块整章改写 / 重写（现有 `elementScopeViolation`）。

NL 解析出的补丁同样设置 `recorder.targetConsumed`，同一轮不允许再对本模块 `rewriteSection` / `regenerate_section`。跨模块第二次 `edit_section`（非目标 3）不受此限。

---

## 七、工具与编排

### 7.1 新工具 `search_targets`

Agent **只**通过本工具发现可补丁节点，不另提供 list/dump 目录工具。

| 项 | 内容 |
| --- | --- |
| 阶段 | 仅编辑阶段（与 `list_sections` 一起暴露） |
| 参数 | `{ query?: string, sectionId?: string }` |
| 返回 | §5.2 JSON；0 命中返回空数组 + 一句说明；模块不存在则可读错误 |
| 禁止 | 不返回 HTML、不返回未过滤的全库目录 |

查询规则：

| `query` | `sectionId` | 行为 |
| --- | --- | --- |
| 有（去空白后非空） | 有 | 只在该章索引里按 label 包含匹配 |
| 有 | 无 | 扫当前 PRD 各章索引（跨模块）；命中带各自 `sectionId` |
| 无或空 | 有 | 返回该章索引前 N 条（N=20，与搜索上限相同），便于模型浏览已知结构 |
| 无或空 | 无 | 返回错误：需要 `query` 或 `sectionId`，禁止无过滤 dump 整份 PRD |

实现建议：`backend/src/services/sectionLocator.ts`（纯函数：`buildCatalog(html)` / `searchCatalog(catalogs, query)` / `resolveLocator(html, id)` / `bindByInstruction(catalog, instruction)`），工具层只做按章读库与拼 JSON。

### 7.2 `edit_section` 改动

在现有分支前插入 locator 解析：

```
pending UI target（未消费）
  → 实体 / 元素补丁（不变）
locatorId 或 §6.2 绑定
  → 合成 target → patchElement
否则
  → rewriteSection
```

`recordDone` 的 `elementLabel` 用索引 label。工具返回的 `scope` 用 label，不用「整个模块」。

### 7.3 中间件

- **有 UI 元素 target**：仍只暴露 `edit_section`（不变）。点选路径不需要搜索。
- **仅模块 chip / 无 chip**：编辑阶段工具列表增加 `search_targets`，不强制 `toolChoice`。
- 不要因为「可能是局部编辑」就收掉 `regenerate_section`，以免「功能清单重写」走偏。

### 7.4 提示词（`buildEditPrompt`）

在局部编辑一行补充：

- 改已有**小节标题 / 表格行 / 单元格 / 场景卡片 / 功能分组** → `search_targets` + `edit_section(..., locatorId)`。能确定章节时带上 `sectionId`。
- **业务流程 / 信息架构 / 产品架构**的图内增删改 → **不要**搜图节点、**不要** `locatorId`，直接 `edit_section` 整章（非目标 1、2）。
- 实体 → 仍 `edit_entity`。
- 「那个」「这格」等无名词 → `ask_user_form`（非目标 3）。不要对空泛词做跨模块搜索后猜第一条。
- 跨模块 → 逐个工具调用（非目标 3）；其中 flowchart / infoArch 那次不带 locator。`search_targets` 跨章多命中时选一条或提问，不要一次改多章。

判定表「局部编辑」工具路径改为：`search_targets` → `edit_section` + `locatorId`（§6.2 能唯一绑定时可直接 `edit_section`）。

正例：「功能清单里把导出报表的优先级改成 P0」→ `search_targets({ query: "导出报表", sectionId: "featureList" })` → `edit_section(featureList, locatorId=cell:…)`。  
反例：「业务流程里加一个审批节点」→ **不要** `search_targets` 图节点，`edit_section(flowchart)` 无 locator。

---

## 八、前端

本期**可以不改发送协议**。定位全在后端；侧栏仍只传模块 chip 或什么都不传。

建议同步（工作量小）：

1. `section_edit_done` / `messages.meta.edits` 已有 `elementLabel` 时，侧栏撤回栏显示 `功能清单 · 导出报表`，与悬浮窗一致。
2. 不在输入框自动伪造元素 chip（避免和点选 chip 混淆）。用户点选后仍以点选 `target` 为准。

不需要前端再扫 DOM、不需要预览高亮确认（可作为后续增强，本期不做）。

---

## 九、测试

### 9.1 单测 `sectionLocator.ts`

用固定 HTML fixture（功能清单两张表 + 背景三个 `prd-subsection` + 场景卡片 + 带 `.mermaid` 的流程图章）：

- `buildCatalog` 生成的 id / label / tablePath 稳定。
- `resolveLocator` 取出的 outerHTML 能被 `patchElementInHtml` / `patchTableElementByPath` 打上。
- `.mermaid` 不出现在索引中；对「审批」搜索流程图章 → 0 命中（或仅命中非图结构，fixture 应保证 0）。
- `searchCatalog(..., "导出报表")` → 优先 cell 而非整行。
- `bindByInstruction("把导出报表的优先级改成 P0")` → 唯一 cell。
- `bindByInstruction("改导出")` 若两行都含「导出」→ 多命中，不绑定。
- `bindByInstruction("加一个支付模块")` → 0 命中。
- 跨章：query「成功指标」只命中 background 的 subsection。

### 9.2 工具与 `edit_section` 集成

- `search_targets` 无 query 且无 sectionId → 错误，不返回全库。
- `search_targets` 仅 sectionId → 最多 20 条，无 HTML。
- 带合法 `locatorId`：有 `section_edit_done`，HTML 仅该节点变，其它小节/行不变（可用特征字符串断言）。
- 非法 `locatorId` 或 id 与 `sectionId` 不符：无 persist，返回含「不存在」或「可用」的文本。
- 无 locator、instruction 唯一包含某行 label：走补丁而非整章（对比改写前后其它行文本）。
- 无 locator、instruction 为「业务流程里加一个审批节点」、`sectionId=flowchart`：仍 `rewriteSection`（非目标 1）。
- UI 元素 target 与 `locatorId` 同时出现：以 UI target 为准。

### 9.3 意图用例（`intentCases.ts`）

| 用例 | 调整 |
| --- | --- |
| #7 功能清单改导出优先级 | 期望仍 `edit_section(featureList)`；有真实 HTML fixture 时应落到补丁。可选断言调用了 `search_targets` 或由 §6.2 绑定完成。 |
| #8 流程图加审批节点 | **不变**：`edit_section(flowchart)`，不要求 `search_targets`。 |
| #9 信息架构删设置页 | **不变**。 |
| #12 / #13 增删产品功能 | **不变**（0 标签命中或整组改写仍允许 rewrite）。 |
| #14 功能清单 + 同步业务流程 | **不变**：两次 `edit_section`；第二次 flowchart 无 locator。 |
| #21 点选单元格 | **不变**。 |
| #25 「改一下那个表」 | **不变**：`ask_user_form`。 |

新增：无 chip，「把背景里的成功指标改成…」且 HTML 有对应 subsection → 补丁，其它两个 subsection 文本不变。

---

## 十、实现步骤

| 序 | 内容 | 依赖 |
| --- | --- | --- |
| 1 | `sectionLocator.ts`（catalog + search + resolve + bind）+ fixture 单测 | 无 |
| 2 | `search_targets` 工具；`buildTools` 编辑阶段挂上 | 1 |
| 3 | `edit_section` 接入 locatorId + §6.2 绑定；合成 target 后走 `patchElement` | 1 |
| 4 | `buildEditPrompt` 判定表与示例（含三条非目标、禁止搜图节点） | 3 |
| 5 | orchestrator / sectionEdit 测试；扩展 intent 回归说明 | 3–4 |
| 6 | 侧栏 `elementLabel` 展示（若 done 事件已带回则只改 UI） | 3 |
| 7 | 更新 `AGENTS.md`（工具列表、元素定位「点选或 search_targets id」）、本计划状态改为已实现；在 `plan-orchestrator-agent.md` §4.3 加一句指向本文 | 5 |

建议顺序：先功能清单行/格 + 背景 subsection（最常见侧栏诉求），`group` / `scenario` / `table` 与同一扫描器一起做，不必分两期。

---

## 十一、验收标准

- 侧栏（无点选）：「功能清单里把{已有功能点}的优先级改成 P0」只改该行/格，其它功能点原文保留。
- 侧栏：「把{某章}里的{已有 h2 小节}补充一条…」只改该 `prd-subsection`。
- 侧栏：「业务流程里加一个审批节点」仍整章流程图改写，不出现失败的节点定位。
- 侧栏：「信息架构里删掉设置页」仍整章改写。
- 侧栏：「改一下那个表」仍提问，不猜。
- 侧栏：「功能清单加导出，业务流程也同步」仍两次编辑；业务流程那次整章改写。
- 悬浮窗点选改一格，行为与改前一致。
- 定位 id 无效时模块 HTML 版本号不变。
- 模型侧只有 `search_targets`，没有全量目录 dump；无 query 且无 sectionId 时工具拒绝。

---

## 十二、风险与明确放弃

| 风险 | 处理 |
| --- | --- |
| 模型漏填 `locatorId` 又整章重写 | §6.2 唯一标签绑定（与搜索共用索引） |
| 两行 label 相似 | 多命中不改，返回候选 |
| 生成 HTML 不带 `prd-subsection` / 表结构 | 索引空 → 与今天一样整章改写 |
| 改完序号变化 | id 不跨轮使用，每轮重扫 |
| 流程图 / markmap 用户期望点节点 | 本期明确不做；不进索引，验收时按整章改写 |
| 无过滤搜索打出整份 PRD | 无 query 且无 sectionId 直接报错 |

---

## 十三、文档同步（实现时）

- `AGENTS.md`：工具列表增加 `search_targets`；「元素定位参数只来自点选」改为「点选 chip，或编辑阶段 `search_targets` 的 locatorId / 服务端唯一标签绑定」。
- `backend/src/services/prompts.ts`：与 §7.4 一致。
- `docs/plan-orchestrator-agent.md` §4.3：补充 locatorId 属于服务端索引白名单（经 `search_targets` 发现），不是模型伪造的 DOM。
