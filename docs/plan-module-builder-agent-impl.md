# 模块构建智能体 — 施工计划

> 依据：`docs/plan-module-builder-agent.md`  
> 施工日期：2026-06-13  
> 总工期：~5.25 天

---

## 一、现状盘点

| 层       | 现状                                                  | 问题                                        |
| -------- | ----------------------------------------------------- | ------------------------------------------- |
| **DB**   | `module_templates` 无 `skill_name`/`render_type` 字段 | 无法关联 Skill 文件，无法识别渲染类型       |
| **后端** | `custom.ts` 仅用文字描述生成自定义模块内容            | 无 Skill 约束，输出质量不可控               |
| **后端** | `renderer.ts` 用硬编码 ID Set 检测 CDN 需求           | 自定义图表模块的 CDN 不会加载，导致崩溃     |
| **后端** | PATCH 编辑端点 System Prompt 无 Skill 注入            | AI 重写自定义 Skill 模块时不知道输出格式    |
| **前端** | `ModuleManager.vue` 只有手动添加模块（名称+描述）     | 无 AI 引导创建入口                          |
| **前端** | `PrdSectionItem.vue` 无按需 CDN 加载                  | 自定义 mermaid/markmap 模块编辑视图渲染失败 |

---

## 二、施工分阶段

### Phase 1：数据层改造

**目标**：为 `module_templates` 表补充两列，所有后续阶段依赖此基础。

#### 1.1 修改 `backend/src/db/schema.ts`

在 `CREATE_MODULE_TEMPLATES_TABLE` SQL 中追加两列：

```sql
CREATE TABLE IF NOT EXISTS module_templates (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL,
  description TEXT,
  skill_name  TEXT    DEFAULT NULL,   -- ← 新增：关联的 Skill 目录名
  render_type TEXT    DEFAULT NULL,   -- ← 新增：'mermaid'|'markmap'|'table'|'html'
  is_builtin  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
)
```

同步更新 `ModuleTemplateRow` 接口：

```typescript
export interface ModuleTemplateRow {
	id: string;
	name: string;
	description: string | null;
	skill_name: string | null; // ← 新增
	render_type: string | null; // ← 新增
	is_builtin: 0 | 1;
	created_at: number;
}
```

#### 1.2 修改 `backend/src/db/migrations.ts`

追加新版本迁移分支（假设当前 `user_version = N`，新版本为 `N+1`）：

```typescript
if (version < N + 1) {
	db.exec(`
    ALTER TABLE module_templates ADD COLUMN skill_name  TEXT DEFAULT NULL;
    ALTER TABLE module_templates ADD COLUMN render_type TEXT DEFAULT NULL;
    PRAGMA user_version = ${N + 1};
  `);
}
```

---

### Phase 2：修复现有代码的兼容断层

**目标**：修复自定义 Skill 模块接入后会触发的 Breaking 问题，独立可验证。

#### 2.1 修改 `backend/src/services/prd/renderer.ts`

**改动①**：CDN 检测从按 section ID 改为按 HTML 内容特征检测：

```typescript
// 修改前
const needsMermaid = ordered.some((s) => MERMAID_IDS.has(s.id));
const needsMarkmap = ordered.some((s) => MARKMAP_IDS.has(s.id));

// 修改后
const needsMermaid = ordered.some(
	(s) => MERMAID_IDS.has(s.id) || s.content.includes('class="mermaid"'),
);
const needsMarkmap = ordered.some(
	(s) => MARKMAP_IDS.has(s.id) || s.content.includes('id="markmap-svg"'),
);
```

**改动②**：`infoArchTabIdx` 同步修复：

```typescript
const infoArchTabIdx = ordered.findIndex(
	(s) => MARKMAP_IDS.has(s.id) || s.content.includes('id="markmap-svg"'),
);
```

**改动③**：在生成的 HTML JS 中为 `runMermaidInPanel` 加安全守卫（模板字符串内）：

```javascript
// 修改前
if (nodes.length) {
  Promise.resolve(mermaid.run({ nodes: nodes })).then(...)
}

// 修改后
if (typeof mermaid !== 'undefined' && nodes.length) {
  Promise.resolve(mermaid.run({ nodes: nodes })).then(...)
}
```

#### 2.2 修改 `backend/src/services/prd/modules/custom.ts`

改造 `generate()` 函数，新增 Skill 注入分支：

```typescript
import { getDb } from "../../db/client.js";
import { buildSkillBlock } from "../../skillLoader.js";

export async function generate(section: SectionOutline): Promise<string> {
	const db = getDb();
	const row = db
		.prepare("SELECT skill_name FROM module_templates WHERE id = ?")
		.get(section.id) as { skill_name: string | null } | undefined;

	const keyPoints = section.keyPoints
		.map((p, i) => `${i + 1}. ${p}`)
		.join("\n");

	if (row?.skill_name) {
		// 高质量路径：注入 Skill 规范
		const skillBlock = buildSkillBlock(row.skill_name);
		const sys = `${skillBlock}\n\n你是一位资深产品经理，正在撰写 PRD 文档中的「${section.title}」章节。
严格按照上方 Skill 规范生成内容。只输出 HTML 片段，不含根标签。`;
		const user = `「${section.title}」关键要点：\n\n${keyPoints}\n\n请生成完整的 HTML 内容。`;
		return invokeModule(sys, user);
	}

	// 兜底路径：保持原有逻辑（向后兼容）
	const sys = `你是一位资深产品经理，正在撰写 PRD 文档中的「${section.title}」章节。
根据提供的关键要点，生成结构清晰、专业规范的 HTML 内容。
只输出 HTML 片段，不含 <html>/<head>/<body> 根标签。`;
	const user = `「${section.title}」关键要点：\n\n${keyPoints}\n\n请生成完整的 HTML 内容。`;
	return invokeModule(sys, user);
}
```

#### 2.3 修改 `backend/src/routes/modules.ts`

**改动①**：`toPublic` 函数暴露新字段：

```typescript
function toPublic(row: ModuleTemplateRow) {
	return {
		id: row.id,
		name: row.name,
		description: row.description ?? undefined,
		skillName: row.skill_name ?? undefined, // ← 新增
		renderType: row.render_type ?? undefined, // ← 新增
		isBuiltin: row.is_builtin === 1,
	};
}
```

**改动②**：DELETE 端点联动删除 Skill 文件：

```typescript
import { rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";

router.delete("/:id", (req, res) => {
	// ...原有校验逻辑...

	// 联动删除 Skill 目录
	if (row.skill_name) {
		const skillDir = resolve(
			__dirname,
			"..",
			"..",
			"..",
			"..",
			"skills",
			row.skill_name,
		);
		if (existsSync(skillDir)) {
			rmSync(skillDir, { recursive: true, force: true });
		}
	}

	db.prepare("DELETE FROM module_templates WHERE id = ?").run(req.params.id);
	res.status(204).send();
});
```

---

### Phase 3：新增 Skill 构建后端 API

**目标**：实现模块构建智能体的核心后端逻辑。

#### 3.1 新建 `backend/src/services/moduleBuilder.ts`

负责 Skill 生成 Prompt 构建、LLM 调用、质量校验、文件写入：

```typescript
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createChatModel } from "./llm.js";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

const SKILLS_ROOT = resolve(/* 同 skillLoader.ts 的路径计算 */);
const CREATE_SKILL_SPEC = readFileSync(
	resolve(
		SKILLS_ROOT,
		"..",
		".cursor",
		"skills-cursor",
		"create-skill",
		"SKILL.md",
	),
	"utf-8",
);

export interface BuildSkillInput {
	moduleName: string; // 用户填写的模块名称
	userDescription: string; // 第一轮：用户原始描述
	confirmedPoints: string[]; // 第一轮：用户确认的内容要点
	renderType: "html" | "table" | "html+table" | "mermaid" | "markmap";
}

/** 第一轮：根据用户描述生成内容要点建议（供前端渲染多选题） */
export async function suggestContentPoints(
	moduleName: string,
	userDescription: string,
): Promise<string[]> {
	const model = createChatModel();
	const sys = new SystemMessage(
		"你是一位产品经理助手。根据用户描述的模块诉求，提炼 4-6 个该模块应包含的具体内容要点。" +
			"直接输出 JSON 数组，每项为一个简短的要点字符串，不超过 20 字。不要输出其他内容。",
	);
	const user = new HumanMessage(
		`模块名称：${moduleName}\n用户诉求：${userDescription}`,
	);
	const result = await model.invoke([sys, user]);
	try {
		return JSON.parse(
			typeof result.content === "string" ? result.content : "[]",
		);
	} catch {
		return [];
	}
}

/** 第二轮完成后：生成 SKILL.md 内容，含程序化校验和重试 */
export async function generateSkillContent(
	input: BuildSkillInput,
	skillName: string,
	retryCount = 0,
): Promise<string> {
	const model = createChatModel();

	const sys = new SystemMessage(
		`你必须严格遵循以下 create-skill 规范生成 SKILL.md 文件内容：\n\n${CREATE_SKILL_SPEC}`,
	);

	const user = new HumanMessage(
		`请根据以下信息生成一份 SKILL.md，用于指导 AI 生成「${input.moduleName}」模块的 PRD 内容。\n\n` +
			`模块名称：${input.moduleName}\n` +
			`Skill 文件名（name 字段使用此值）：${skillName}\n` +
			`模块诉求：${input.userDescription}\n` +
			`内容要点（用户已确认）：\n${input.confirmedPoints.map((p) => `- ${p}`).join("\n")}\n` +
			`展示形式：${input.renderType}\n\n` +
			`要求：直接输出完整的 SKILL.md 文件内容（含 YAML frontmatter），不要加 Markdown 代码块。`,
	);

	const result = await model.invoke([sys, user]);
	const content = typeof result.content === "string" ? result.content : "";

	// 程序化校验
	const isValid = validateSkillContent(content);
	if (!isValid && retryCount < 2) {
		return generateSkillContent(input, skillName, retryCount + 1);
	}

	return content;
}

/** 校验 SKILL.md 格式（frontmatter + 行数） */
function validateSkillContent(content: string): boolean {
	const hasFrontmatter = /^---\n[\s\S]+?\n---/.test(content);
	const hasName = /^name:\s*.+/m.test(content);
	const hasDescription = /^description:\s*.+/m.test(content);
	const lineCount = content.split("\n").length;
	return hasFrontmatter && hasName && hasDescription && lineCount <= 500;
}

/** 将生成的 SKILL.md 写入文件系统 */
export function writeSkillFile(skillName: string, content: string): void {
	// 安全校验：只允许 skill-custom- 前缀 + [a-z0-9-] 字符
	if (!/^skill-custom-[a-z0-9-]+$/.test(skillName)) {
		throw new Error(`非法 skill 名称：${skillName}`);
	}
	const dir = resolve(SKILLS_ROOT, skillName);
	mkdirSync(dir, { recursive: true });
	writeFileSync(resolve(dir, "SKILL.md"), content, "utf-8");
}
```

#### 3.2 在 `backend/src/routes/modules.ts` 新增三个端点

```typescript
import { customAlphabet } from "nanoid";
import {
	suggestContentPoints,
	generateSkillContent,
	writeSkillFile,
} from "../services/moduleBuilder.js";

const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 8);

// POST /api/modules/suggest-points — 第一轮：生成内容要点建议
router.post("/suggest-points", async (req, res) => {
	const { moduleName, userDescription } = req.body as {
		moduleName?: string;
		userDescription?: string;
	};
	if (!moduleName || !userDescription) {
		res.status(400).json({ error: "缺少必填字段" });
		return;
	}
	const points = await suggestContentPoints(moduleName, userDescription);
	res.json({ points });
});

// POST /api/modules/build-skill — 第二轮完成后：生成 Skill 草稿（不写文件）
router.post("/build-skill", async (req, res) => {
	const { moduleName, userDescription, confirmedPoints, renderType } =
		req.body as {
			moduleName?: string;
			userDescription?: string;
			confirmedPoints?: string[];
			renderType?: string;
		};
	if (
		!moduleName ||
		!userDescription ||
		!confirmedPoints?.length ||
		!renderType
	) {
		res.status(400).json({ error: "缺少必填字段" });
		return;
	}
	const skillName = `skill-custom-${nanoid()}`;
	const skillContent = await generateSkillContent(
		{
			moduleName,
			userDescription,
			confirmedPoints,
			renderType: renderType as never,
		},
		skillName,
	);
	res.json({ skillName, skillContent });
});

// POST /api/modules/confirm-skill — 用户预览确认后：写文件 + 创建模块记录
router.post("/confirm-skill", (req, res) => {
	const { name, description, skillName, skillContent, renderType } =
		req.body as {
			name?: string;
			description?: string;
			skillName?: string;
			skillContent?: string;
			renderType?: string;
		};
	if (!name || !skillName || !skillContent) {
		res.status(400).json({ error: "缺少必填字段" });
		return;
	}

	// 写 Skill 文件
	writeSkillFile(skillName, skillContent);

	// 写 DB
	const db = getDb();
	const id = uuidv4();
	const now = Date.now();
	db.prepare(
		"INSERT INTO module_templates (id, name, description, skill_name, render_type, is_builtin, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
	).run(
		id,
		name.trim(),
		description?.trim() || null,
		skillName,
		renderType || null,
		now,
	);

	const row = db
		.prepare("SELECT * FROM module_templates WHERE id = ?")
		.get(id) as ModuleTemplateRow;
	res.status(201).json(toPublic(row));
});
```

---

### Phase 4：前端 — 模块构建对话面板

**目标**：在 `ModuleManager.vue` 中嵌入 AI 引导创建流程，**两轮问答直接复用 `QuestionForm.vue`** 组件与样式。

#### 4.0 小扩展 `frontend/src/components/QuestionForm.vue`（改动极小）

现有 `QuestionForm` 已支持 `single_choice`、`multi_choice`、`text` 三种题型，仅需两处小改：

**改动①**：新增可选 prop `defaultAnswers`，用于第一轮问答时预选 AI 建议的要点：

```typescript
// 新增 prop
const props = defineProps<{
	form: QuestionForm;
	disabled?: boolean;
	defaultAnswers?: Record<string, string | string[]>; // ← 新增
	submitLabel?: string; // ← 新增，自定义按钮文字
}>();

// 初始化时合并 defaultAnswers
props.form.questions.forEach((q) => {
	if (props.defaultAnswers?.[q.id] !== undefined) {
		answers.value[q.id] = props.defaultAnswers[q.id]; // 使用传入的默认值
	} else if (q.type === "multi_choice") {
		answers.value[q.id] = [];
	} else {
		answers.value[q.id] = "";
	}
});
```

**改动②**：按钮文字改为读取 `submitLabel` prop（默认保持"发送答案"）：

```html
<!-- 原来 -->
发送答案
<!-- 改为 -->
{{ submitLabel ?? '发送答案' }}
```

这两处改动不影响现有使用场景，完全向后兼容。

---

#### 4.1 修改 `frontend/src/components/ModuleManager.vue`

**改动①**：在"添加自定义模块"按钮旁新增"AI 引导创建"入口：

```
[ + 手动添加模块 ]   [ ✦ AI 引导创建 ]
```

**改动②**：新增 `showAiBuilder` ref，点击"AI 引导创建"时展开，替换 `mm-add-form` 区域：

```html
<ModuleBuilderPanel
	v-if="showAiBuilder"
	@done="onBuilderDone"
	@cancel="showAiBuilder = false"
/>
```

`onBuilderDone` 回调：将新建模块加入 `localSelected`，关闭面板，刷新 `modulesStore`。

---

#### 4.2 新建 `frontend/src/components/ModuleBuilderPanel.vue`

内部状态机：`step: 'input' → 'points' → 'format' → 'preview' → 'done'`

**各步骤直接传入 `QuestionForm` 组件的 `form` 数据：**

```
step = 'input'  →  传入如下 form 给 QuestionForm：
  {
    questions: [
      { id: 'name',  label: '模块名称', type: 'text', required: true,  placeholder: '例：竞品分析' },
      { id: 'desc',  label: '描述一下你想展示什么内容', type: 'text', required: true, placeholder: '...' }
    ]
  }
  submitLabel = "AI 分析内容要点 →"
  submit 事件 → 解析 answers，调用 POST /api/modules/suggest-points

step = 'points'  →  调用 API 拿到建议要点后，传入如下 form：
  {
    questions: [
      {
        id: 'points',
        label: 'AI 建议的内容要点（可多选，可增删）',
        type: 'multi_choice',
        required: true,
        options: [...suggestedPoints]   // 来自 API 返回
      }
    ]
  }
  defaultAnswers = { points: [...suggestedPoints] }  // 全部预选
  submitLabel = "确认要点，选择展示形式 →"
  submit 事件 → 记录 checkedPoints，进入 step = 'format'

step = 'format'  →  传入如下 form：
  {
    questions: [
      {
        id: 'format',
        label: '选择展示形式',
        type: 'single_choice',
        required: true,
        options: ['文段', '表格', '文段+表格', 'Mermaid图', '思维导图']
      }
    ]
  }
  submitLabel = "生成 Skill 规范 →"
  submit 事件 → 记录 renderType，调用 POST /api/modules/build-skill，进入 step = 'preview'

step = 'preview'  →  不使用 QuestionForm，直接渲染：
  ┌──────────────────────────────────────────────────────┐
  │  <pre class="skill-preview">{{ skillContent }}</pre>  │
  │  [← 重新生成]                      [确认，创建模块 ✓] │
  └──────────────────────────────────────────────────────┘
  "确认" → 调用 POST /api/modules/confirm-skill → emit('done', newModule)
```

**各步骤间导航**：在 `QuestionForm` 上方加一行面包屑进度条 + "← 返回"链接，样式复用 `mm-add-area` 现有风格。

step = 'preview'（调用 POST /api/modules/build-skill 后）
┌────────────────────────────────────────────────┐
│ Skill 预览（Markdown 渲染）： │
│ ┌──────────────────────────────────────────┐ │
│ │ --- │ │
│ │ name: skill-custom-abc12345 │ │
│ │ description: ... │ │
│ │ --- │ │
│ │ # 竞品分析生成指南 ... │ │
│ └──────────────────────────────────────────┘ │
│ [← 重新生成] [确认，创建模块] │
└────────────────────────────────────────────────┘

````

关键逻辑：

```typescript
// step: input → points
async function analyzePoints() {
  loading.value = true;
  const res = await fetch('/api/modules/suggest-points', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ moduleName: moduleName.value, userDescription: description.value }),
  });
  const data = await res.json();
  suggestedPoints.value = data.points.map((p: string) => ({ text: p, checked: true }));
  step.value = 'points';
  loading.value = false;
}

// step: format → preview
async function buildSkill() {
  loading.value = true;
  const res = await fetch('/api/modules/build-skill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      moduleName: moduleName.value,
      userDescription: description.value,
      confirmedPoints: checkedPoints.value,
      renderType: selectedFormat.value,
    }),
  });
  const data = await res.json();
  skillName.value = data.skillName;
  skillContent.value = data.skillContent;
  step.value = 'preview';
  loading.value = false;
}

// step: preview → done（写文件 + 创建模块记录）
async function confirmSkill() {
  const res = await fetch('/api/modules/confirm-skill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: moduleName.value,
      description: description.value,
      skillName: skillName.value,
      skillContent: skillContent.value,
      renderType: selectedFormat.value,
    }),
  });
  const newModule = await res.json();
  emit('done', newModule);
}
````

---

### Phase 5：编辑功能的 Skill 注入适配

**目标**：确保 PRD 编辑（AI 重写）对自定义 Skill 模块也能正确工作。

#### 5.1 修改 `backend/src/routes/sessions.ts` — PATCH handler

在 `PATCH /api/sessions/:id/prd/sections/:sectionId` 的处理函数中，生成 System Prompt 前查询 Skill：

```typescript
// 查询该 section 是否有关联 Skill
const moduleRow = db
	.prepare("SELECT skill_name FROM module_templates WHERE id = ?")
	.get(sectionId) as { skill_name: string | null } | undefined;

const skillPart = moduleRow?.skill_name
	? `\n\n该模块的输出格式规范（必须严格遵循）：\n${loadSkill(moduleRow.skill_name)}`
	: "";

const systemPrompt =
	`你是一个 PRD 文档编辑助手。你只负责修改指定模块的内容，` +
	`输出格式为纯 HTML 片段（不含 <html>/<body> 标签）。` +
	`保留原有的 CSS class 命名规范。不要输出任何解释文字。` +
	skillPart;
```

#### 5.2 修改 `frontend/src/views/session/components/PrdSectionItem.vue`

在 `onMounted` 及 `watch(section.html)` 中，按 `section.renderType` 动态按需加载 CDN：

```typescript
async function ensureCdn(renderType: string | undefined) {
	if (renderType === "mermaid" && !window.mermaid) {
		await loadScript(
			"https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js",
		);
		window.mermaid.initialize({ startOnLoad: false, theme: "default" });
	}
	if (renderType === "markmap" && !window.markmap) {
		await loadScript("https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js");
		await loadScript(
			"https://cdn.jsdelivr.net/npm/markmap-lib/dist/browser/index.js",
		);
		await loadScript(
			"https://cdn.jsdelivr.net/npm/markmap-view/dist/browser/index.js",
		);
	}
}

function loadScript(src: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const s = document.createElement("script");
		s.src = src;
		s.onload = () => resolve();
		s.onerror = reject;
		document.head.appendChild(s);
	});
}
```

---

## 三、文件变更清单

### 新增文件

| 文件                                             | 说明                                                |
| ------------------------------------------------ | --------------------------------------------------- |
| `backend/src/services/moduleBuilder.ts`          | Skill 生成服务（要点建议、SKILL.md 生成、文件写入） |
| `frontend/src/components/ModuleBuilderPanel.vue` | AI 引导创建模块对话面板（两轮问答 + Skill 预览）    |
| `skills/skill-custom-{nanoid8}/SKILL.md`         | 运行时动态生成，每次用户确认后新建一个              |

### 修改文件

| 文件                                                       | 改动内容                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `backend/src/db/schema.ts`                                 | `module_templates` 补充 `skill_name`、`render_type` 列定义及 `ModuleTemplateRow` 接口 |
| `backend/src/db/migrations.ts`                             | 新增 `ALTER TABLE` 迁移语句                                                           |
| `backend/src/services/prd/renderer.ts`                     | CDN 检测改为内容特征检测；`runMermaidInPanel` 加 `typeof` 安全守卫                    |
| `backend/src/services/prd/modules/custom.ts`               | 新增 DB 查 `skill_name` + Skill 注入分支                                              |
| `backend/src/routes/modules.ts`                            | `toPublic` 暴露新字段；DELETE 联动删 Skill 目录；新增 3 个端点                        |
| `backend/src/routes/sessions.ts`                           | PATCH handler 注入自定义 Skill 规范                                                   |
| `frontend/src/components/QuestionForm.vue`                 | 新增 `defaultAnswers`、`submitLabel` 两个可选 prop（向后兼容）                        |
| `frontend/src/components/ModuleManager.vue`                | 新增"AI 引导创建"按钮 + 嵌入 `ModuleBuilderPanel`                                     |
| `frontend/src/views/session/components/PrdSectionItem.vue` | 按 `renderType` 动态按需加载 Mermaid/markmap CDN                                      |

---

## 四、施工顺序与依赖关系

```
Phase 1（DB Schema + 迁移）
    ↓ 必须最先完成，后续所有阶段依赖
Phase 2（修复现有代码断层）
    ↓ 2.1 renderer.ts（独立，可先做）
    ↓ 2.2 custom.ts（依赖 Phase 1）
    ↓ 2.3 modules.ts 基础改动（依赖 Phase 1）
Phase 3（新增后端 API）
    ↓ 3.1 moduleBuilder.ts 服务（依赖 Phase 1）
    ↓ 3.2 modules.ts 新端点（依赖 3.1）
Phase 4（前端对话面板）
    ↓ 4.1 ModuleManager.vue（依赖 Phase 3 API 就绪）
    ↓ 4.2 ModuleBuilderPanel.vue（依赖 4.1）
    ↓ 4.3 Skill 预览（随 4.2 一起处理）
Phase 5（编辑功能适配）
    ↓ 5.1 sessions.ts PATCH（依赖 Phase 1）
    ↓ 5.2 PrdSectionItem.vue（依赖 Phase 1 render_type 字段）
    ↓ Phase 4 与 Phase 5 可并行
```

---

## 五、验收标准

| #   | 场景                                        | 验收条件                                                                           |
| --- | ------------------------------------------- | ---------------------------------------------------------------------------------- |
| T-1 | 创建文段类自定义模块（无 Skill）            | 手动添加后，PRD 生成时 custom.ts 走兜底路径，输出正常                              |
| T-2 | AI 引导创建表格类 Skill 模块                | 两轮问答完成后，`skills/skill-custom-xxx/SKILL.md` 文件存在且 frontmatter 格式正确 |
| T-3 | AI 引导创建 Mermaid 类 Skill 模块           | PRD 生成后，自定义 mermaid 模块的图表正常渲染（CDN 已加载）                        |
| T-4 | 只选自定义 mermaid 模块（不选内置图表模块） | PRD HTML 正常加载 Mermaid CDN，不抛 ReferenceError                                 |
| T-5 | AI 引导创建 markmap 类 Skill 模块           | Tab 切换时思维导图正确居中显示                                                     |
| T-6 | 对自定义 Skill 模块使用 AI 重写（PATCH）    | LLM 输出格式符合 Skill 规范（表格保持 table，mermaid 保持合法语法）                |
| T-7 | 编辑视图中自定义 mermaid 模块渲染           | `PrdSectionItem.vue` 按需加载 CDN，图表正常显示                                    |
| T-8 | 删除已关联 Skill 的自定义模块               | `skills/skill-custom-xxx/` 目录同步删除                                            |
| T-9 | 存量无 Skill 的自定义模块                   | 升级迁移后，`skill_name` 为 NULL，行为与之前完全一致                               |

---

## 六、风险与注意事项

| 风险                         | 说明                                                                      | 应对                                                           |
| ---------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `create-skill` SKILL.md 路径 | 该文件位于 `~/.cursor/skills-cursor/`，不在项目仓库内，部署环境可能不存在 | 将 `create-skill` 规范内容直接硬编码为常量，不依赖文件系统读取 |
| Skill 生成 LLM 调用耗时      | 生成 SKILL.md 可能需要 5-15 秒                                            | 前端展示"生成中…"骨架屏；后端设置 30s 超时                     |
| nanoid 碰撞                  | 8 位 nanoid 理论上极低概率碰撞                                            | 写入前检查目录是否已存在，存在则重新生成                       |
| SQLite ALTER TABLE 兼容性    | SQLite 的 `ALTER TABLE ADD COLUMN` 有限制（不支持 NOT NULL 无默认值）     | 两列均设 `DEFAULT NULL`，无问题                                |
