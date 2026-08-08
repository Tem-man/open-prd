# PR 分析：模块构建智能体（Module Builder Agent）

> 提案日期：2026-06-13  
> 当前状态：待评估

---

## 一、需求概述

用户希望在现有"自定义模块"功能的基础上，引入一个**模块构建智能体**：

1. 用户以自然语言描述想要的自定义模块诉求；
2. 智能体通过引导式问题帮助用户明确**展示形式**（table 表格 / mermaid 图 / markmap 思维导图）；
3. 若选择 table，进一步确认字段列表；
4. 需求确认完毕后，智能体**自动生成并持久化该模块对应的 SKILL.md**，供后续 PRD 生成时调用。

---

## 二、是否应该实现？

**结论：应该实现，但建议分两期推进。**

### 支持实现的理由

| 维度       | 分析                                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| 用户痛点   | 现有自定义模块仅支持"名称 + 文字描述"，AI 对该模块的理解完全依赖描述质量，输出随机性高、可控性差                      |
| 功能完整性 | 内置 7 个模块均有对应 Skill 文件规范约束输出质量；自定义模块缺少相同约束，形成明显的"二等公民"体验                    |
| 差异化价值 | 业界 PRD 工具（如 Notion AI、Axure AI）尚未提供自定义图表模块的智能向导，属于有竞争力的特性                           |
| 技术一致性 | 项目已有 Skill 加载机制（`skillLoader.ts`）和对话 Agent（`agent.ts`），本 PR 是对现有架构的自然延伸，不需要引入新依赖 |

### 潜在风险

| 风险                        | 说明                                                              | 缓解措施                                                             |
| --------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| LLM 生成的 Skill 质量不可控 | AI 自动生成的 SKILL.md 可能存在格式错误或逻辑缺陷                 | **引入 `create-skill` Skill 作为生成约束**（详见下方"质量保障机制"） |
| Mermaid 语法多样            | 不同 mermaid 图类型（graph、sequenceDiagram、gantt 等）规范差异大 | 一期仅支持 flowchart TD，后续渐进扩展                                |
| 对话轮次过多                | 问题引导过长可能降低用户体验                                      | 控制最多 3 轮问答，必填项集中确认                                    |

### 质量保障：以 `create-skill` Skill 约束生成行为

**核心思路**：模块构建智能体在生成 SKILL.md 时，将 `create-skill` Skill 的规范注入 System Prompt，让 LLM 按已验证的最佳实践输出，而非自由发挥。

`create-skill` 提供了以下可直接复用的质量约束：

| 约束维度         | `create-skill` 规范                                       | 对自定义模块 Skill 的价值                |
| ---------------- | --------------------------------------------------------- | ---------------------------------------- |
| **结构规范**     | YAML frontmatter（`name` + `description`）+ Markdown 正文 | 保证 `skillLoader.ts` 可正确解析         |
| **描述写法**     | 第三人称、含 WHAT + WHEN、不超过 1024 字符                | 提升 Skill 被 Agent 自动识别触发的准确率 |
| **篇幅限制**     | SKILL.md 正文控制在 500 行以内                            | 节省 Token，防止注入后撑爆上下文         |
| **格式规范**     | 名称仅用 `[a-z0-9-]`，最长 64 字符                        | 与 `DIAGRAM_SKILL_MAP` 键名规范一致      |
| **反模式规避**   | 禁止模糊命名、禁止冗余解释、禁止时效性信息                | 降低 AI 生成低质量内容的概率             |
| **质量检查清单** | 6 项核心质量项 + 4 项结构项                               | 可在后端生成后做程序化自检               |

**实现方式**：在 `/api/modules/build-skill` 端点的 System Prompt 中，通过 `buildSkillBlock('create-skill')` 机制（或直接内嵌）将 `create-skill` 规范注入，指示模块构建 Agent：

> "你生成的 SKILL.md 必须严格遵循 `<skill name="create-skill">` 中定义的结构规范、描述写法和质量检查清单。"

**额外保障**：生成后由后端做轻量级程序化校验（正则检查 frontmatter 格式、行数统计），不合格则触发 Agent 重新生成，最多重试 2 次。

---

## 三、用户价值分析

### 核心价值：将"随机描述"升级为"可执行规范"

```
现状：自定义模块 = 名称 + 200 字自由描述  →  AI 理解不确定，输出质量波动
目标：自定义模块 = 名称 + AI 生成的结构化 SKILL.md  →  AI 按明确规范输出
```

### 具体价值点

1. **降低创建成本**  
   用户无需了解 Mermaid 语法或 SKILL.md 格式，以自然语言对话即可创建专业级模块规范。

2. **提高 PRD 输出质量**  
   table 模块明确字段名称和类型后，AI 输出的表格列将精准对应业务实体；mermaid 模块明确图类型后，语法合规率接近 100%。

3. **形成模块资产积累**  
   用户创建的 Skill 持久化存储，可在不同会话中复用，逐步形成个人/团队的 PRD 模块库。

4. **引导式体验降低学习曲线**  
   对于不熟悉图表类型的产品经理，引导问题本身就是一次"图表选型"教育。

---

## 四、技术可行性分析

### 现有架构支撑

| 现有能力                    | 如何复用                                                      |
| --------------------------- | ------------------------------------------------------------- |
| `skillLoader.ts`            | 已实现从 `skills/` 目录加载任意 Skill 文件，新 Skill 自动生效 |
| `agent.ts` `runAgentStream` | 对话流式输出机制完整，模块构建智能体可以独立的 SSE 会话运行   |
| `ModuleManager.vue`         | "添加自定义模块"区域已有 UI 占位，可在此嵌入"AI 引导"入口     |
| `modules.ts` 路由           | 后端模块增删改查 API 完备，新增 Skill 落地后只需一个新端点    |
| `QuestionForm.vue`          | 已有结构化问答表单组件，可直接复用来渲染引导问题              |

### 技术实现路径

#### 阶段一：对话引导 + Skill 模板生成（推荐优先实现）

```
用户在 ModuleManager 点击"AI 引导创建模块"
  → 前端开启独立对话面板（复用 QuestionForm 组件）
  → 后端新增 POST /api/modules/build-skill 端点
  → Agent 按以下两轮对话引导：

  【第一轮】用户输入模块诉求（自由描述）
    Agent 理解需求后，提炼该模块的内容要点，以多选题形式供用户确认/调整：
    ✅ 已勾选项为 Agent 建议的要点，用户可增删后提交
    示例（以"竞品分析"模块为例）：
      ☑ 竞品名称与官网链接
      ☑ 核心功能对比
      ☑ 定价模型对比
      □ 优劣势总结
      □ 市场份额数据
    → 用户确认要点后进入第二轮

  【第二轮】Agent 给出展示形式供用户选择（单选）：
      ○ 文段      — 叙述性内容，使用 <p>/<h>/<ul> 等元素
      ○ 表格      — 结构化对比，使用 <table>
      ○ 文段+表格 — 混合排版，先文字说明再表格
      ○ Mermaid图 — 流程/时序/泳道/甘特/象限等图形化表达
      ○ 思维导图  — 分层结构，使用 markmap

  → 两轮收集完成后，将结果结构化为 Skill 生成提示词的核心内容：

      System Prompt 组成：
      ┌─────────────────────────────────────────────────────────┐
      │ [create-skill 规范]                                      │
      │   （强制结构/描述/行数合规，作为格式约束层）              │
      └─────────────────────────────────────────────────────────┘

      User Prompt 组成（两轮问答信息直接注入）：
      ┌─────────────────────────────────────────────────────────┐
      │ 模块名称：{用户填写的模块名}                              │
      │ 模块诉求：{第一轮用户原始描述}                            │
      │ 内容要点（用户已确认）：                                  │
      │   - {要点1}                                              │
      │   - {要点2}  ...                                         │
      │ 展示形式：{第二轮用户选择，例如"表格"}                    │
      │                                                          │
      │ 请根据以上信息生成一份 SKILL.md，指导 AI 生成该模块内容。 │
      └─────────────────────────────────────────────────────────┘

  → 后端程序化校验：frontmatter 格式 + 行数 ≤ 500，不合格自动重试（≤2次）
  → 前端预览 Skill 内容（Markdown 渲染）
  → 用户确认后写入 skills/{module-id}/SKILL.md
  → 模块记录更新 skill_name / render_type 字段
```

#### 阶段二：Skill 编辑与版本管理（后续迭代）

- 在模块库中为自定义模块提供"查看/编辑 Skill"入口
- 支持重新对话优化 Skill
- 支持 Skill 导入/导出

### 技术工作量估算

| 模块     | 工作项                                                            | 估时         |
| -------- | ----------------------------------------------------------------- | ------------ |
| 后端     | 新增 `/api/modules/build-skill` SSE 端点                          | 0.5 天       |
| 后端     | Agent prompt 编写（模块构建专用系统提示，注入 create-skill 规范） | 0.5 天       |
| 后端     | Skill 质量校验器（frontmatter 解析 + 行数检查 + 重试逻辑）        | 0.25 天      |
| 后端     | Skill 文件写入逻辑 + DB `skill_name` 字段 + migrations            | 0.5 天       |
| 后端     | `renderer.ts` CDN 检测改为内容特征检测 + JS 安全守卫（§5.1）      | 0.25 天      |
| 后端     | `custom.ts` 改造：DB 查 `skill_name` + Skill 注入分支（§5.2）     | 0.25 天      |
| 后端     | `modules.ts` DELETE 联动删除 Skill 文件（§5.5）                   | 0.1 天       |
| 前端     | ModuleManager 新增"AI 引导"入口按钮                               | 0.25 天      |
| 前端     | 对话引导面板（含表单式问题 + Skill 预览）                         | 1 天         |
| 前端     | Skill 预览渲染（Markdown）                                        | 0.25 天      |
| 测试     | 端到端验证（table/mermaid/markmap 三种场景 × 有/无内置图表模块）  | 0.5 天       |
| **合计** |                                                                   | **~4.35 天** |

### 落地产物：每次成功创建自定义 Skill 会产生以下变更

#### 1. 新建 `skills/skill-custom-{id}/SKILL.md`

```
skills/
└── skill-custom-{nanoid8}/       ← 新建目录
    └── SKILL.md                  ← AI 生成，由后端写入文件系统
```

命名规范：`skill-custom-` 前缀 + 8 位 nanoid，避免与内置 Skill 目录冲突。  
写入时机：用户在前端预览后点击"确认"，后端收到确认请求后写入。

#### 2. 修改（非新增）`backend/src/services/prd/modules/custom.ts`

当前 `custom.ts` 是所有自定义模块的通用生成器，仅使用 `section.title + section.keyPoints` 组装 Prompt。  
需在此基础上**增加 Skill 注入分支**：

```
generate(section) 流程:
  ├─ 查 DB：module_templates WHERE id = section.id → 读取 skill_name 字段
  ├─ skill_name 存在？
  │   ├─ YES → loadSkill(skill_name) 注入 System Prompt → 生成 HTML（高质量路径）
  │   └─ NO  → 原有 keyPoints 描述 Prompt → 生成 HTML（兜底路径，保持向后兼容）
```

**不需要**为每个自定义模块新建独立的 `.ts` 生成器文件，`custom.ts` 保持作为统一入口动态分发。

#### 3. DB Schema 新增字段

`module_templates` 表新增列：

```sql
ALTER TABLE module_templates ADD COLUMN skill_name TEXT DEFAULT NULL;
-- 示例值：'skill-custom-a1b2c3d4'，NULL 表示该模块尚未关联 Skill
```

### 关键技术约束

1. **文件写入安全**：后端写入 `skills/` 时需对 `skill_name` 做路径过滤（防止路径穿越攻击），只允许 `[a-z0-9-]` 字符集，且必须以 `skill-custom-` 开头。
2. **删除联动**：调用 `DELETE /api/modules/:id` 时，若 `skill_name` 非 NULL，同步删除对应的 `skills/{skill_name}/` 目录。
3. **向后兼容**：`custom.ts` 的 `generate()` 在 `skill_name` 为 NULL 时走原有路径，已有自定义模块不受影响。

---

## 五、对现有渲染器与模块编辑的影响评估

### 5.1 renderer.ts — 三处硬编码导致的断层

`renderer.ts` 通过两个**硬编码 Set** 决定是否注入 CDN：

```typescript
// renderer.ts L9-10
const MERMAID_IDS = new Set(["architecture", "flowchart", "dataModel"]);
const MARKMAP_IDS = new Set(["infoArch"]);
```

自定义模块的 `section.id` 是 DB UUID，永远不在这两个 Set 里。这导致三个连锁问题：

| #   | 问题                                                                   | 严重程度     | 触发条件                                            |
| --- | ---------------------------------------------------------------------- | ------------ | --------------------------------------------------- |
| R-1 | 自定义 mermaid/markmap 模块的 CDN 不加载                               | **Breaking** | 用户只选了自定义 mermaid 模块、未选任何内置图表模块 |
| R-2 | `mermaid.run()` 调用时 `mermaid` 未定义，抛 ReferenceError             | **Breaking** | 同上，HTML 里有 `.mermaid` 元素但 CDN 未加载        |
| R-3 | 自定义 markmap 模块的 `infoArchTabIdx === -1`，`fitMarkmap()` 永不触发 | Medium       | 自定义 markmap 模块 Tab 切换时思维导图无法居中/缩放 |

**修复方案（对 renderer.ts 的 2 处改动）：**

① 将 CDN 检测从"按 ID 判断"改为"按生成内容判断"：

```typescript
// 当前（有缺陷）
const needsMermaid = ordered.some((s) => MERMAID_IDS.has(s.id));

// 修复后：通过 HTML 内容特征检测
const needsMermaid = ordered.some(
	(s) => MERMAID_IDS.has(s.id) || s.content.includes('class="mermaid"'),
);
const needsMarkmap = ordered.some(
	(s) => MARKMAP_IDS.has(s.id) || s.content.includes('id="markmap-svg"'),
);
```

② 同理修复 `infoArchTabIdx`：

```typescript
const infoArchTabIdx = ordered.findIndex(
	(s) => MARKMAP_IDS.has(s.id) || s.content.includes('id="markmap-svg"'),
);
```

③ 在生成的 HTML 的 `runMermaidInPanel` 函数里加安全守卫，防止 CDN 未加载时崩溃：

```javascript
// 在 nodes.length 判断前加 typeof 守卫
if (typeof mermaid !== 'undefined' && nodes.length) {
  Promise.resolve(mermaid.run({ nodes: nodes })).then(...)
}
```

---

### 5.2 custom.ts — skillRequired 注入链路缺失

当前 `prdOutline.ts` 的 Outline 生成提示词**明确禁止**非内置模块使用 `skillRequired`：

```
图表类模块（architecture/flowchart/infoArch/dataModel）必须填写 skillRequired 字段
非图表类模块不要包含 skillRequired 字段
```

加上 `DIAGRAM_SKILL_MAP` 只映射内置 4 个图表模块：

```typescript
// skillLoader.ts
export const DIAGRAM_SKILL_MAP: Record<string, string> = {
	architecture: "skill-prd-architecture",
	flowchart: "skill-prd-flowchart",
	infoArch: "skill-prd-infoarch",
	dataModel: "skill-prd-datamodel",
};
```

因此，`section.skillRequired` 对自定义模块永远是 `undefined`。**`custom.ts` 无法通过 `section.skillRequired` 获取 Skill 名称**。

**修复方案：让 `custom.ts` 直接查 DB，不依赖 `section.skillRequired`：**

```typescript
// custom.ts generate() 修改后的流程
export async function generate(section: SectionOutline): Promise<string> {
	// 直接从 DB 读取该模块是否有关联 Skill
	const db = getDb();
	const row = db
		.prepare("SELECT skill_name FROM module_templates WHERE id = ?")
		.get(section.id) as { skill_name: string | null } | undefined;

	if (row?.skill_name) {
		// 高质量路径：注入 Skill 规范
		const skillBlock = buildSkillBlock(row.skill_name);
		return invokeModule(
			buildSysWithSkill(section, skillBlock),
			buildUserMsg(section),
		);
	}
	// 兜底路径：保持原有 keyPoints 描述（向后兼容）
	return invokeModule(buildLegacySys(section), buildUserMsg(section));
}
```

---

### 5.3 reassemblePrd（模块编辑重组）— 同渲染器问题

`index.ts` 中的 `reassemblePrd()` 同样调用 `renderPrd()`，面临完全相同的 R-1/R-2/R-3 问题。  
只要修复 5.1 中的 `renderer.ts`，`reassemblePrd()` 自动受益，**无需额外改动**。

---

### 5.4 DB schema — `module_templates` 缺少 `skill_name` 列

当前 `schema.ts` 的 `CREATE_MODULE_TEMPLATES_TABLE` 没有 `skill_name` 字段，5.2 的修复依赖此字段。  
需在 `migrations.ts` 中追加迁移语句：

```sql
ALTER TABLE module_templates ADD COLUMN skill_name TEXT DEFAULT NULL;
```

并同步更新 `ModuleTemplateRow` 接口：

```typescript
export interface ModuleTemplateRow {
	id: string;
	name: string;
	description: string | null;
	skill_name: string | null; // ← 新增
	is_builtin: 0 | 1;
	created_at: number;
}
```

---

### 5.5 影响范围汇总

| 文件                                         | 变更类型                                                | 是否 Breaking                  | 工作量  |
| -------------------------------------------- | ------------------------------------------------------- | ------------------------------ | ------- |
| `backend/src/services/prd/renderer.ts`       | 修改（CDN 检测逻辑 + JS 安全守卫）                      | 是（不改则自定义图表模块崩溃） | 0.25 天 |
| `backend/src/services/prd/modules/custom.ts` | 修改（DB 查询 + Skill 注入分支）                        | 否（向后兼容）                 | 0.25 天 |
| `backend/src/db/schema.ts`                   | 修改（新增 `skill_name` 字段定义）                      | 否                             | 0.1 天  |
| `backend/src/db/migrations.ts`               | 修改（ALTER TABLE 迁移语句）                            | 否                             | 0.1 天  |
| `backend/src/routes/modules.ts`              | 修改（`toPublic` 暴露 `skill_name`，DELETE 联动删文件） | 否                             | 0.25 天 |

以上改动均为**修改已有文件**，无需新增文件，且均向后兼容（未关联 Skill 的自定义模块走原有路径）。

---

## 六、优先级评估

### 评分矩阵

| 维度                       | 权重 | 得分（1-5） | 加权分       |
| -------------------------- | ---- | ----------- | ------------ |
| 用户价值（PRD 质量提升）   | 30%  | 5           | 1.50         |
| 技术可行性（复用现有架构） | 25%  | 4           | 1.00         |
| 实现复杂度（工期短）       | 20%  | 4           | 0.80         |
| 差异化竞争力               | 15%  | 4           | 0.60         |
| 用户使用频率预期           | 10%  | 3           | 0.30         |
| **综合得分**               |      |             | **4.20 / 5** |

### 优先级结论

**P1 — 高优先级，建议在下一个迭代周期内实现一期方案。**

理由：

- 本 PR 直接补全了"自定义模块"的核心能力短板，当前该功能处于"可用但效果差"的状态；
- 技术投入小（3.5 天），但对 PRD 输出质量的提升显著；
- 用户一旦创建过 Skill，留存动力（资产积累效应）会明显增强。

---

## 七、实现建议

### 入口设计（最小改动原则）

在 `ModuleManager.vue` 的"添加自定义模块"按钮旁增加一个**"AI 引导创建"**入口，两种方式并存：

```
[ + 手动添加模块 ]   [ ✦ AI 引导创建 ]
```

点击"AI 引导创建"后，在模块管理弹窗内展开一个**嵌入式对话面板**（而非新页面），保持交互上下文连贯。

### Skill 模板结构（Agent 生成目标）

Agent 应生成如下格式的 SKILL.md：

```markdown
---
name: skill-custom-{id}
description: { 用户需求一句话总结 }
---

# {模块名称} 生成指南

## 展示形式

{table/mermaid-flowchart/mermaid-erDiagram/markmap}

## 输出规范

{针对展示形式的具体规范，包含示例代码}

## 字段定义（仅 table 类型）

| 字段名 | 类型 | 说明 |
| ------ | ---- | ---- |
| ...    | ...  | ...  |
```

---

## 八、不实现的代价

如果延后或不实现本 PR：

- 自定义模块的 PRD 输出质量将持续低于内置模块，用户对自定义功能的满意度会随实际使用下降；
- 用户为了获得高质量输出，可能倾向于只用 7 个内置模块，降低了产品的灵活性价值；
- 竞品一旦实现类似"对话创建模块规范"的功能，本产品的差异化优势将被追平。

---

_文档生成于 2026-06-13，基于 `open-prd` 仓库当前代码状态分析。_
