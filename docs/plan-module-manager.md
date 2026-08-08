# PRD 模块管理功能 — 实施规划

> **功能目标**：在用户与 AI 开始对话之前，提供一个模块管理器，支持从默认模块库中选择/取消选择模块、添加自定义模块、删除自定义模块、拖拽排序；最终用户选中且排好序的模块列表，将作为本次 PRD 生成的构成模块，并按此顺序输出。

---

## 一、功能全景

```
新建 PRD 入口（首页）
    │
    ▼
模块管理器弹窗（ModuleManager）
    ├── 模块库面板（右/下）：展示所有可用模块（默认7个 + 用户自定义）
    │       ├── 点击已取消模块 → 添加到已选区，保持排序
    │       └── 点击已选模块  → 从已选区移除
    ├── 已选模块面板（左/上）：展示已选中的模块，支持拖拽排序
    │       └── 拖拽手柄 → 重新排序
    ├── 添加自定义模块（输入名称 → 加入模块库）
    └── 删除自定义模块（仅限用户添加的，默认7个不可删）
    │
    ▼ 确认（带选定模块列表 + 顺序）
    │
    ▼
创建会话，将 selectedModules 写入 sessions 表
    │
    ▼
AI 对话（Agent 感知本次 PRD 所含模块列表）
    │
    ▼
generatePrdOutline：只为选定模块生成 keyPoints
    │
    ▼
generateFullPrd：只渲染选定模块，按顺序组装 HTML
```

---

## 二、数据模型变更

### 2.1 新增表：`module_templates`

存储模块库的全部模块（默认 7 个 + 用户自定义），全局共享，不绑定 session。

```sql
CREATE TABLE IF NOT EXISTS module_templates (
  id       TEXT PRIMARY KEY,          -- 对于内置模块使用固定 id（如 'background'），
                                      -- 自定义模块使用 UUID
  name     TEXT NOT NULL,             -- 模块展示名称（如 "背景与目标"）
  is_builtin INTEGER NOT NULL DEFAULT 0, -- 1=内置不可删，0=用户自定义可删
  created_at INTEGER NOT NULL
);
```

**初始数据**（首次建表时 seed）：

| id           | name       | is_builtin |
| ------------ | ---------- | ---------- |
| background   | 背景与目标 | 1          |
| userScenario | 用户与场景 | 1          |
| featureList  | 功能清单   | 1          |
| architecture | 产品架构   | 1          |
| flowchart    | 业务流程   | 1          |
| infoArch     | 信息架构   | 1          |
| dataModel    | 数据模型   | 1          |

### 2.2 `sessions` 表新增字段：`selected_modules`

```sql
ALTER TABLE sessions ADD COLUMN selected_modules TEXT;
-- JSON 字符串，存储有序模块 id 数组，如 '["background","featureList","dataModel"]'
-- NULL 表示使用全部 7 个默认模块（向后兼容）
```

> **向后兼容**：`selected_modules` 为 NULL 时，系统使用全部 7 个内置模块的默认顺序，确保现有会话不受影响。

### 2.3 类型定义变更（`backend/src/db/schema.ts`）

```typescript
export interface ModuleTemplate {
	id: string;
	name: string;
	is_builtin: 0 | 1;
	created_at: number;
}

export interface SessionRow {
	id: string;
	title: string;
	status: string;
	outline: string | null;
	selected_modules: string | null; // 新增
	created_at: number;
	updated_at: number;
}
```

---

## 三、后端实施规划

### 3.1 数据库层（`backend/src/db/`）

#### `schema.ts`

- 新增 `module_templates` 建表 SQL
- `sessions` 建表 SQL 加入 `selected_modules TEXT` 字段
- 新增 `seedModuleTemplates()` 函数：首次建表后写入内置 7 条记录（使用 `INSERT OR IGNORE`，幂等）
- `client.ts` 中在 `initDb()` 调用完建表后调用 `seedModuleTemplates()`

#### 迁移方案

由于使用 `better-sqlite3` 无 ORM，采用简单版本号迁移：

```typescript
// db/migrations.ts
export function runMigrations(db: Database) {
	const version = (db.pragma("user_version", { simple: true }) as number) ?? 0;

	if (version < 1) {
		db.exec(`
      CREATE TABLE IF NOT EXISTS module_templates (...);
      -- seed 内置模块
    `);
		db.pragma("user_version = 1");
	}

	if (version < 2) {
		// ALTER TABLE sessions ADD COLUMN selected_modules TEXT
		// SQLite 不支持 IF NOT EXISTS，需先检查列是否存在
		const cols = db.pragma("table_info(sessions)") as { name: string }[];
		if (!cols.find((c) => c.name === "selected_modules")) {
			db.exec("ALTER TABLE sessions ADD COLUMN selected_modules TEXT");
		}
		db.pragma("user_version = 2");
	}
}
```

### 3.2 模块模板路由（`backend/src/routes/modules.ts`）

新增资源路由 `/api/modules`：

| 方法   | 路径               | 说明                                      |
| ------ | ------------------ | ----------------------------------------- |
| GET    | `/api/modules`     | 获取模块库列表（内置 + 自定义）           |
| POST   | `/api/modules`     | 添加自定义模块（`{ name: string }`）      |
| DELETE | `/api/modules/:id` | 删除自定义模块（is_builtin=1 时返回 403） |

#### GET /api/modules 响应格式

```json
[
	{ "id": "background", "name": "背景与目标", "isBuiltin": true },
	{ "id": "userScenario", "name": "用户与场景", "isBuiltin": true },
	{ "id": "uuid-xxx", "name": "竞品分析", "isBuiltin": false }
]
```

#### POST /api/modules 请求体

```json
{ "name": "竞品分析" }
```

- 名称不能为空，长度限制 50 字符
- 自动生成 UUID 作为 id
- 返回新建的模块对象

#### DELETE /api/modules/:id

- `is_builtin = 1` → 返回 `403 Forbidden`
- 找不到 → 返回 `404`
- 成功 → 返回 `204 No Content`

### 3.3 会话创建接口变更（`backend/src/routes/sessions.ts`）

#### POST /api/sessions 请求体扩展

```typescript
interface CreateSessionBody {
	selectedModules?: string[]; // 有序模块 id 数组，可选
}
```

- 不传 `selectedModules` 或为空数组 → 使用全部 7 个内置模块默认顺序
- 传入时：
  1. 验证每个 id 是否存在于 `module_templates` 表
  2. 过滤掉不存在的 id（防御性处理）
  3. 将验证后的数组 `JSON.stringify()` 存入 `sessions.selected_modules`

### 3.4 Outline 生成变更（`backend/src/services/prdOutline.ts`）

#### `generatePrdOutline` 函数签名扩展

```typescript
export async function generatePrdOutline(
	sessionId: string,
	selectedModules?: SelectedModule[], // 从 session 读取传入
): Promise<PrdOutline>;
```

其中 `SelectedModule`：

```typescript
interface SelectedModule {
	id: string; // 模块 id（内置或自定义）
	name: string; // 模块名称
	isBuiltin: boolean;
}
```

#### 逻辑变更

1. 从 `sessions.selected_modules` 读取本次选定的模块列表（若为 NULL 则 fallback 到内置 7 个）
2. `SECTION_IDS` 不再硬编码，改为从传入的 `selectedModules` 动态构建
3. Schema 描述（`schemaDesc`）按 `selectedModules` 顺序生成，只包含选定的模块
4. 对于自定义模块（`isBuiltin = false`），没有对应的 `skillRequired`，也没有专用生成器；需要在 schema 中标注为 `"type": "custom"` 供后续生成器识别

#### 辅助函数：`getSessionModules(sessionId)`

```typescript
// 从 session 的 selected_modules 字段读取模块列表，
// fallback 到 7 个内置模块默认顺序
export function getSessionModules(sessionId: string): SelectedModule[];
```

### 3.5 PRD 生成变更（`backend/src/services/prd/index.ts`）

#### `generateFullPrd` 变更

```typescript
export async function generateFullPrd(
	sessionId: string,
	onProgress?: ProgressCallback,
): Promise<string>;
```

内部逻辑变更：

1. 调用 `getSessionModules(sessionId)` 获取本次选定模块列表
2. 遍历时不再固定 `MODULE_MAP`，而是按 `selectedModules` 顺序逐模块处理
3. 内置模块：从 `MODULE_MAP` 查找对应生成器（`background`、`userScenario` 等）
4. **自定义模块**：使用通用生成器 `modules/custom.ts`（见下方 3.6）
5. `RendererSection` 按 `selectedModules` 顺序组装，保证 HTML 中 Tab 顺序与用户设定一致

### 3.6 自定义模块通用生成器（`backend/src/services/prd/modules/custom.ts`）

内置模块有专属 Prompt + Skill；自定义模块使用通用生成器：

```typescript
export async function generate(section: SectionOutline): Promise<string> {
	// section.title 为用户自定义的模块名称
	// section.keyPoints 为从对话中提炼的要点
	// 使用通用 Prompt，要求 LLM 基于 keyPoints 生成 HTML 片段
}
```

Prompt 策略：

- 告知 LLM 这是 PRD 中的自定义模块，名为 `{section.title}`
- 基于 `keyPoints` 生成结构化的 HTML 段落（表格/列表/段落，视内容而定）
- 输出纯 HTML 片段，不含 `<html>/<body>` 包装

### 3.7 HTML 渲染器变更（`backend/src/services/prd/renderer.ts`）

#### `renderPrd` 函数

- 当前：Tab 数量和名称硬编码为 7 个
- 变更后：接收动态 `RendererSection[]`，Tab 导航和内容区均按传入数组动态生成

```typescript
export interface RendererSection {
	id: string;
	title: string;
	content: string;
}

export function renderPrd(
	sessionTitle: string,
	sections: RendererSection[], // 动态，不再固定 7 个
): string;
```

渲染逻辑：

- Tab 导航：`sections.map(s => <button ...>${s.title}</button>)`
- 内容区：`sections.map(s => <div id="tab-${s.id}" ...>${s.content}</div>)`
- mermaid / markmap CDN 按需引入（只有当 sections 中包含对应模块时才注入相关 CDN 脚本）

### 3.8 Agent 提示词变更（`backend/src/services/prompts.ts`）

系统提示词需感知本次 PRD 将包含哪些模块：

```typescript
export function buildSystemPrompt(selectedModules: SelectedModule[]): string {
	const moduleList = selectedModules
		.map((m, i) => `  ${i + 1}. ${m.name}`)
		.join("\n");

	return `你是一位资深产品经理和PRD生成专家...

## 本次 PRD 将包含以下模块（按顺序）：
${moduleList}

在收集到足够信息后，你将按上述顺序生成 PRD。...`;
}
```

`SYSTEM_PROMPT` 从常量改为工厂函数，在 `agent.ts` 中调用时传入 `selectedModules`。

---

## 四、前端实施规划

### 4.1 新增类型定义（`frontend/src/types/index.ts`）

```typescript
export interface ModuleTemplate {
	id: string;
	name: string;
	isBuiltin: boolean;
}

export interface ModuleManagerState {
	library: ModuleTemplate[]; // 模块库全部模块
	selected: string[]; // 已选中的模块 id（有序）
}
```

### 4.2 新增 Pinia Store（`frontend/src/stores/modules.ts`）

```typescript
export const useModulesStore = defineStore("modules", () => {
	const library = ref<ModuleTemplate[]>([]);
	const loading = ref(false);

	async function fetchModules() {
		/* GET /api/modules */
	}
	async function addModule(name: string): Promise<ModuleTemplate> {
		/* POST /api/modules */
	}
	async function deleteModule(id: string) {
		/* DELETE /api/modules/:id */
	}

	return { library, loading, fetchModules, addModule, deleteModule };
});
```

### 4.3 新增组件：`ModuleManager.vue`

**位置**：`frontend/src/components/ModuleManager.vue`

**复用场景**：该组件在两处使用，内容完全相同，仅容器形态不同：

| 使用场景         | 触发入口                      | 容器形态           | 确认按钮文案       | 确认行为                                            |
| ---------------- | ----------------------------- | ------------------ | ------------------ | --------------------------------------------------- |
| 新建 PRD         | 首页「新建 PRD」按钮          | 居中弹窗（modal）  | 确认，开始创建 PRD | emit `confirm`，由父组件调用 `createSession`        |
| 管理当前会话模块 | SessionSidebar「模块管理」Tab | 右侧抽屉（drawer） | 保存模块配置       | emit `confirm`，由父组件调用 `updateSessionModules` |

通过 `mode` prop 控制容器形态，内部业务逻辑（模块选择、排序、增删）完全共享。

#### Props / Emits

```typescript
// Props
interface Props {
	visible: boolean;
	mode: "modal" | "drawer"; // 容器形态
	initialSelected?: string[]; // 预设已选模块（drawer 模式用于回显当前会话配置）
}

// Emits
interface Emits {
	(e: "confirm", selectedModules: string[]): void; // 有序 id 数组
	(e: "cancel"): void;
}
```

#### 组件结构（双栏布局，内容区完全一致）

```
┌─────────────────────────────────────────────────────────┐
│  模块管理                                      [×]关闭   │
├──────────────────────────┬──────────────────────────────┤
│  已选模块（拖拽排序）     │  模块库                      │
│  ──────────────────────  │  ─────────────────────────── │
│  ⠿ 1. 背景与目标         │  ☑ 背景与目标   [内置]      │
│  ⠿ 2. 功能清单           │  ☑ 用户与场景   [内置]      │
│  ⠿ 3. 产品架构           │  ☑ 功能清单     [内置]      │
│  ⠿ 4. 竞品分析  [自定义] │  ☑ 产品架构     [内置]      │
│                          │  ☐ 业务流程     [内置]      │
│                          │  ☐ 信息架构     [内置]      │
│                          │  ☑ 数据模型     [内置]      │
│                          │  ☑ 竞品分析  [自定义][×]   │
│                          │  ─────────────────────────── │
│                          │  [+ 添加自定义模块]          │
├──────────────────────────┴──────────────────────────────┤
│                 [取消]          [确认，开始创建 PRD]      │  ← modal 模式
│                 [取消]          [保存模块配置]            │  ← drawer 模式
└─────────────────────────────────────────────────────────┘
```

#### 容器渲染策略

```html
<!-- modal 模式：居中遮罩弹窗 -->
<template v-if="mode === 'modal'">
	<Teleport to="body">
		<Transition name="modal-fade">
			<div v-if="visible" class="modal-overlay" @click.self="emit('cancel')">
				<div class="module-manager-modal">
					<!-- 内容区（抽取为内部组件 <ModuleManagerContent>）-->
					<ModuleManagerContent ... />
				</div>
			</div>
		</Transition>
	</Teleport>
</template>

<!-- drawer 模式：右侧抽屉，复用 HistoryDrawer 同款动画规范 -->
<template v-else>
	<Teleport to="body">
		<Transition name="drawer-mask">
			<div v-if="visible" class="drawer-mask" @click="emit('cancel')"></div>
		</Transition>
		<Transition name="drawer-slide">
			<div v-if="visible" class="module-manager-drawer">
				<ModuleManagerContent ... />
			</div>
		</Transition>
	</Teleport>
</template>
```

- `drawer-mask` / `drawer-slide` 动画类与 `HistoryDrawer.vue` 完全一致（复用已有 CSS 定义），保持视觉风格统一
- `ModuleManagerContent` 为内部子组件或抽象的模板块，持有全部业务逻辑和 UI，不关心外层容器形态

#### 内部状态

```typescript
const localSelected = ref<string[]>([]); // 已选模块 id（有序）
const customModuleName = ref(""); // 添加自定义模块的输入框
const showAddInput = ref(false); // 是否显示添加输入框
const draggingIndex = ref<number | null>(null); // 拖拽状态
```

#### 交互细节

**模块库面板（右侧）**：

- 每行显示：`[勾选状态图标] 模块名称 [内置/自定义标签] [删除按钮（仅自定义）]`
- 点击行（非删除按钮区域）：
  - 若未选中 → 追加到 `localSelected` 末尾
  - 若已选中 → 从 `localSelected` 移除
- 删除按钮：调用 `modulesStore.deleteModule(id)`，同时从 `localSelected` 移除
- 添加自定义模块：
  - 点击「+ 添加自定义模块」显示输入框
  - 输入名称后按 Enter 或点击「添加」：调用 `modulesStore.addModule(name)`，成功后自动选中该模块（加到 `localSelected` 末尾）
  - 名称为空或超 50 字时禁用添加按钮并显示提示

**已选模块面板（左侧）**：

- 显示 `localSelected` 中的模块，按顺序编号
- 每行左侧有拖拽手柄（`⠿`），鼠标悬停时显示 `grab` 光标
- 拖拽实现：使用 HTML5 原生 Drag and Drop API（避免引入额外依赖）
  - `dragstart` → 记录 `draggingIndex`
  - `dragover` → 视觉高亮目标位置
  - `drop` → 交换位置，更新 `localSelected`
- 若未选中任何模块：显示空状态提示「请从右侧模块库中至少选择一个模块」

**底部操作区**：

- 「取消」→ emit `cancel`，关闭弹窗
- 确认按钮：
  - `mode === 'modal'` 时文案为「确认，开始创建 PRD」
  - `mode === 'drawer'` 时文案为「保存模块配置」
  - `localSelected.length === 0` 时按钮置灰并提示「至少需选择一个模块」
  - 通过校验后 emit `confirm(localSelected)`

#### 打开时的初始化策略

```typescript
watch(
	() => props.visible,
	async (val) => {
		if (!val) return;
		await modulesStore.fetchModules();

		if (props.initialSelected && props.initialSelected.length > 0) {
			// drawer 模式：回显当前会话的模块配置
			localSelected.value = [...props.initialSelected];
		} else {
			// modal 模式（新建）：默认全选内置 7 个模块
			localSelected.value = modulesStore.library
				.filter((m) => m.isBuiltin)
				.map((m) => m.id);
		}
		showAddInput.value = false;
		customModuleName.value = "";
	},
);
```

---

### 4.4 会话侧边栏改造（`frontend/src/components/SessionSidebar.vue`）

在「对话」Tab 和「历史会话」Tab 之间新增「模块管理」Tab，点击后以右侧抽屉形式打开 `ModuleManager` 组件。

#### Tab 类型扩展

```typescript
// 变更前
type Tab = "chat" | "comment" | "history";

// 变更后
type Tab = "chat" | "modules" | "history";
```

#### 新增状态

```typescript
const modulesOpen = ref(false);

function openModules() {
	activeTab.value = "modules";
	modulesOpen.value = true;
}
function closeModules() {
	modulesOpen.value = false;
	activeTab.value = "chat";
}
```

#### Tab 栏顺序（对话 → 模块管理 → 历史会话）

```html
<div class="tabs">
	<!-- 对话 Tab（原有） -->
	<button
		class="tab"
		:class="{ active: activeTab === 'chat' }"
		@click="activeTab = 'chat'; historyOpen = false; modulesOpen = false"
	>
		对话
	</button>

	<!-- 模块管理 Tab（新增） -->
	<button
		class="tab"
		:class="{ active: activeTab === 'modules' }"
		@click="openModules"
	>
		模块管理
	</button>

	<!-- 历史会话 Tab（原有） -->
	<button
		class="tab"
		:class="{ active: activeTab === 'history' }"
		@click="openHistory"
	>
		历史会话
	</button>
</div>
```

#### 引入 ModuleManager 并挂载（drawer 模式）

```html
<ModuleManager
	:visible="modulesOpen"
	mode="drawer"
	:initial-selected="currentSessionModuleIds"
	@confirm="onModulesConfirm"
	@cancel="closeModules"
/>
```

```typescript
import ModuleManager from "./ModuleManager.vue";

// 计算当前会话已选模块 id 列表，供 drawer 回显
const currentSessionModuleIds = computed(
	() => currentSession.value?.selectedModules?.map((m) => m.id) ?? [],
);

// 确认后更新当前会话的模块配置
async function onModulesConfirm(selectedModuleIds: string[]) {
	modulesOpen.value = false;
	activeTab.value = "chat";
	await sessionsStore.updateSessionModules(props.sessionId, selectedModuleIds);
}
```

#### 行为说明

- 点击「模块管理」Tab：`activeTab` 切换为 `'modules'`，`modulesOpen` 置为 true，抽屉从右侧滑入
- 点击遮罩或「取消」：`closeModules()`，抽屉收起，`activeTab` 恢复为 `'chat'`
- 「保存模块配置」确认后：调用 `sessionsStore.updateSessionModules()`，抽屉收起，`activeTab` 恢复为 `'chat'`
- 切换到「对话」Tab 时：若 `modulesOpen` 为 true，同时收起抽屉（互斥）
- 切换到「历史会话」Tab 时：若 `modulesOpen` 为 true，同时收起模块抽屉（互斥）

---

### 4.5 首页流程改造（`frontend/src/views/HomeView.vue`）

```typescript
// 当前：
@click="sessionsStore.createSession()"

// 改为：
const showModuleManager = ref(false);
const pendingModules = ref<string[]>([]);

function openModuleManager() {
  showModuleManager.value = true;
}

async function onModuleManagerConfirm(selectedModules: string[]) {
  showModuleManager.value = false;
  await sessionsStore.createSession(selectedModules);
}
```

模板中：

- 「新建 PRD」按钮 `@click="openModuleManager"`
- 引入 `<ModuleManager :visible="showModuleManager" mode="modal" @confirm="onModuleManagerConfirm" @cancel="showModuleManager = false" />`
- 注意：modal 模式不传 `initialSelected`，组件默认全选内置模块

### 4.6 Sessions Store 变更（`frontend/src/stores/sessions.ts`）

```typescript
// createSession：新增 selectedModules 参数
async function createSession(selectedModules?: string[]) {
	const body: Record<string, unknown> = {};
	if (selectedModules && selectedModules.length > 0) {
		body.selectedModules = selectedModules;
	}
	const res = await fetch("/api/sessions", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	// ...
}

// 新增：更新当前会话的模块配置（drawer 确认时调用）
async function updateSessionModules(
	sessionId: string,
	selectedModuleIds: string[],
) {
	await fetch(`/api/sessions/${sessionId}/modules`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ selectedModules: selectedModuleIds }),
	});
	// 重新拉取会话详情，刷新 currentSession.selectedModules
	await fetchSession(sessionId);
}
```

### 4.7 PRD 面板 Tab 动态化（`frontend/src/components/PrdPanel.vue`）

**当前**：7 个 Tab 硬编码在模板中。

**变更后**：从会话信息中获取 `selectedModules`，动态渲染 Tab。

```typescript
// 从 sessionsStore 当前会话读取 selectedModules
const sessionModules = computed(() => {
	const session = sessionsStore.currentSession;
	if (!session?.selectedModules?.length) return DEFAULT_MODULES;
	return session.selectedModules;
});
```

其中 `DEFAULT_MODULES` 为内置 7 个模块的默认对象数组（保持向后兼容）。

模板中 Tab 导航和内容区均改为 `v-for="module in sessionModules"` 动态渲染。

### 4.8 Session 类型扩展（`frontend/src/types/index.ts`）

```typescript
export interface Session {
	id: string;
	title: string;
	status: string;
	selectedModules?: Array<{ id: string; name: string }>; // 新增
	createdAt: number;
	updatedAt: number;
}
```

后端 `GET /api/sessions/:id` 响应中需要解析并返回 `selectedModules`（从 JSON 字符串反序列化）。

---

## 五、Agent 逻辑实施规划

### 5.1 对话阶段感知模块配置

**修改入口**：`backend/src/services/agent.ts` 中 `runAgentStream` 函数

```typescript
export async function runAgentStream(
	sessionId: string,
	userMessage: string,
	onDelta: (chunk: string) => void,
	onDone: (shouldGeneratePrd: boolean) => void,
) {
	// 读取本次选定的模块
	const selectedModules = getSessionModules(sessionId);

	// 使用动态 System Prompt（感知模块列表）
	const systemPrompt = buildSystemPrompt(selectedModules);
	// ...
}
```

### 5.2 Outline 生成感知模块配置

**修改**：`generatePrdOutline` 不再使用硬编码的 `SECTION_IDS`，改为：

```typescript
const selectedModules = getSessionModules(sessionId);

// 动态构建 schemaDesc
const schemaDesc = selectedModules
	.map((m) => {
		const skillRequired = DIAGRAM_SKILL_MAP[m.id] ?? undefined;
		return `  {
    "id": "${m.id}",
    "title": "${m.name}",
    "keyPoints": ["<核心要点1>", "..."],
    ${skillRequired ? `"skillRequired": "${skillRequired}",` : ""}
    "status": "pending"
  }`;
	})
	.join(",\n");
```

关键：LLM 被告知只需为 `selectedModules` 中的模块生成 `keyPoints`，其他模块不出现在 Outline 中。

### 5.3 自定义模块的 Outline 要点提取策略

对于 `isBuiltin = false` 的自定义模块，LLM 在生成 Outline 时需要：

- 理解该模块的名称语义（如「竞品分析」）
- 从对话历史中提炼与该模块名称相关的信息作为 `keyPoints`
- 若对话历史中无相关信息，`keyPoints` 可包含通用建议（如「请在生成后补充竞品数据」）

这一策略通过在 Outline 生成提示词中增加一段说明实现：

```
对于自定义模块，请根据模块名称的语义，从对话历史中提炼相关要点。
若对话中无相关信息，可基于模块名称生成合理的通用建议性要点（3条以上）。
```

### 5.4 PRD 生成阶段的自定义模块处理

**`generateFullPrd` 中的路由逻辑**：

```typescript
for (const module of selectedModules) {
	const builtinGenerator = MODULE_MAP[module.id as SectionId];

	if (builtinGenerator) {
		// 内置模块：使用专属生成器
		content = await builtinGenerator.generate(section);
	} else {
		// 自定义模块：使用通用生成器
		content = await customGenerator.generate(section);
	}
}
```

**`custom.ts` 通用生成器 Prompt 设计**：

```typescript
const prompt = `
你是一位资深产品经理，正在撰写 PRD 文档中的「${section.title}」模块。

核心要点（来自需求对话）：
${section.keyPoints.map((p, i) => `${i + 1}. ${p}`).join("\n")}

请基于上述要点，生成「${section.title}」模块的 HTML 内容片段：
- 内容结构合理（标题、段落、表格、列表等灵活使用）
- 内容实质丰富，不要空泛
- 输出纯 HTML 片段，不含 <html>/<head>/<body> 标签
- 遵循整体 PRD 的专业产品文档风格
`;
```

### 5.5 进度步骤条动态化（SSE 事件）

当前进度步骤固定为 10 步（理解需求 → 查漏补缺 → 7个模块 → 输出PRD）。

**变更后**：步骤数量跟随 `selectedModules` 数量动态调整：

```
理解需求 → 查漏补缺 → [模块1名称] → [模块2名称] → ... → [模块N名称] → 输出 PRD
```

SSE 中 `workflow_steps` 事件的步骤列表改为动态生成：

```typescript
// backend/src/services/agent.ts
function buildWorkflowSteps(selectedModules: SelectedModule[]): WorkflowStep[] {
	return [
		{ id: "understand", label: "理解需求" },
		{ id: "clarify", label: "查漏补缺" },
		...selectedModules.map((m) => ({ id: m.id, label: m.name })),
		{ id: "output", label: "输出 PRD" },
	];
}
```

前端 `ProgressSteps.vue` 本就接收 prop，无需改动组件本身，只需确保 store 中的 `workflowSteps` 在会话加载时动态初始化。

---

## 六、API 变更汇总

### 新增端点

| 方法   | 路径               | 说明           |
| ------ | ------------------ | -------------- |
| GET    | `/api/modules`     | 获取模块库列表 |
| POST   | `/api/modules`     | 添加自定义模块 |
| DELETE | `/api/modules/:id` | 删除自定义模块 |

### 变更端点

| 方法  | 路径                        | 变更内容                                              |
| ----- | --------------------------- | ----------------------------------------------------- |
| POST  | `/api/sessions`             | Body 新增可选字段 `selectedModules: string[]`         |
| GET   | `/api/sessions/:id`         | 响应新增 `selectedModules: { id, name }[]` 字段       |
| PATCH | `/api/sessions/:id/modules` | **新增**：更新会话的已选模块配置（drawer 确认时调用） |

#### PATCH /api/sessions/:id/modules

- **请求体**：`{ "selectedModules": ["background", "featureList", "uuid-xxx"] }`
- 验证每个 id 是否存在于 `module_templates` 表，过滤无效 id
- 更新 `sessions.selected_modules` 字段并刷新 `updated_at`
- **响应**：`{ "selectedModules": [{ "id": "...", "name": "..." }] }`（反序列化后的完整对象数组）
- 会话进行到一半时修改模块配置：记录变更，下次生成 PRD 时以新配置为准（当前正在生成中时返回 `409 Conflict`）

---

## 七、实施顺序与依赖关系

```
Step 1：数据库变更
    └── schema.ts 加入 module_templates 表 + selected_modules 字段
    └── migrations.ts 编写并接入 initDb()
    └── seedModuleTemplates() 内置 7 条记录
            │
            ▼
Step 2：后端模块路由
    └── routes/modules.ts（CRUD 接口：GET/POST/DELETE /api/modules）
    └── index.ts 注册新路由
            │
            ▼
Step 3：会话接口扩展
    └── routes/sessions.ts：
        ├── POST /api/sessions 支持 selectedModules
        ├── GET  /api/sessions/:id 返回 selectedModules
        └── PATCH /api/sessions/:id/modules（drawer 确认更新）
            │
            ▼
Step 4：Agent & Outline 逻辑改造
    └── prompts.ts：SYSTEM_PROMPT → buildSystemPrompt(modules)
    └── prdOutline.ts：动态模块支持（不再硬编码 SECTION_IDS）
    └── prd/modules/custom.ts：自定义模块通用生成器
    └── prd/index.ts：按 selectedModules 动态路由
    └── prd/renderer.ts：动态 Tab 渲染
            │
            ▼
Step 5：前端 Store & 类型
    └── types/index.ts 新增 ModuleTemplate、扩展 Session
    └── stores/modules.ts 新增（fetchModules / addModule / deleteModule）
    └── stores/sessions.ts：
        ├── createSession 新增 selectedModules 参数
        └── 新增 updateSessionModules(sessionId, ids)
            │
            ▼
Step 6：前端组件
    ├── ModuleManager.vue（支持 modal/drawer 双模式）
    ├── HomeView.vue 改造（新建PRD→先开 modal 弹窗）
    ├── SessionSidebar.vue 改造（新增「模块管理」Tab → drawer 模式）
    └── PrdPanel.vue Tab 动态化
```

---

## 八、边界情况与异常处理

| 场景                                                              | 处理方案                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 用户选了自定义模块 A，对话中完全没提到相关内容                    | Outline 生成时 LLM 基于模块名生成通用建议性 keyPoints，custom.ts 生成器据此生成占位内容并附带说明「建议补充XXX信息」                                                                                                                                                         |
| 用户删除了自定义模块，但已有 session 引用了该模块                 | `module_templates` 中只删除记录；`sessions.selected_modules` 保留原始 id；`getSessionModules()` 中处理：id 在 `module_templates` 中不存在时，保留 id 但 `isBuiltin` 为 false，name 显示为「已删除模块（{id}）」；前端 Tab 照常显示，生成内容为空占位                         |
| 用户未选任何模块直接确认                                          | 前端禁用确认按钮（modal/drawer 两处均禁用），不允许提交                                                                                                                                                                                                                      |
| `selected_modules` 字段为 NULL（旧数据）                          | `getSessionModules()` fallback 返回内置 7 个模块默认列表，完全向后兼容                                                                                                                                                                                                       |
| 自定义模块名称与内置模块名称重复                                  | 允许，id 不同，前端展示时内置加「内置」标签区分                                                                                                                                                                                                                              |
| 并发请求同时删除同一个自定义模块                                  | SQLite 单进程，`better-sqlite3` 同步操作，天然串行，无竞态                                                                                                                                                                                                                   |
| 用户在 SessionSidebar 的 drawer 中修改模块后，正好 PRD 正在生成中 | `PATCH /api/sessions/:id/modules` 检测 `sessions.outline` 中是否存在 `status === 'generating'` 的模块，若存在则返回 `409 Conflict`，前端提示「PRD 正在生成中，请稍后再修改模块配置」                                                                                         |
| 用户在 drawer 中修改模块后，已有生成好的 PRD                      | PATCH 接口更新 `selected_modules` 后，同时清空该会话的 `outline` 字段（重置为 NULL），使下次生成时以新模块配置重新生成 Outline；已生成的 PRD HTML 保留在 `prds` 表中不删除，但前端 PRD 面板的 Tab 会立即按新模块列表更新（旧 PRD 内容在旧 Tab 中不再可见，等待下次重新生成） |
| 用户在 drawer 中取消，未保存                                      | `localSelected` 的修改仅在组件内部，不触发任何 API 调用，关闭后状态丢弃                                                                                                                                                                                                      |

---

## 九、UI/UX 细节规范

### 模块管理弹窗

- **尺寸**：宽 760px，高 520px，居中
- **圆角**：12px，白底，`box-shadow: 0 20px 60px rgba(0,0,0,0.15)`
- **遮罩**：`rgba(0,0,0,0.4)` 半透明，点击遮罩不关闭（防误触）
- **左侧已选区域**：`flex: 1`；**右侧模块库**：宽 360px

### 模块库单行

```
[✓图标] 背景与目标        [内置]
[空图标] 业务流程          [内置]
[✓图标] 竞品分析          [自定义] [× 删除]
```

- 选中状态：行背景 `#eef2ff`，图标为靛蓝勾选
- 未选中：白底，图标为灰色空圆
- 内置标签：`#f1f5f9` 灰底，字色 `#94a3b8`，圆角 4px，字号 11px
- 自定义标签：`#ede9fe` 紫底，字色 `#7c3aed`
- 删除按钮：仅自定义模块显示，灰色 × 号，hover 变红

### 已选模块单行

```
⠿  1  背景与目标              [自定义标签（若有）]
```

- 拖拽手柄：`⠿` 符号，`color: #cbd5e1`，hover 时 `cursor: grab`
- 拖拽中：被拖动行半透明（`opacity: 0.5`），目标位置显示蓝色分割线

### 添加自定义模块

```
[+ 添加自定义模块]  →  展开：[ 输入模块名称...  ] [添加]
```

- 内联展开，不单独弹窗
- 输入框边框 `#4F46E5`，focus 态蓝色光晕

---

## 十、文件变更清单

### 后端（新增）

- `backend/src/db/migrations.ts`
- `backend/src/routes/modules.ts`
- `backend/src/services/prd/modules/custom.ts`

### 后端（新增）

- `backend/src/db/migrations.ts`
- `backend/src/routes/modules.ts`
- `backend/src/services/prd/modules/custom.ts`

### 后端（修改）

- `backend/src/db/schema.ts`
- `backend/src/db/client.ts`
- `backend/src/routes/sessions.ts`（POST 扩展 + 新增 PATCH /modules）
- `backend/src/services/prompts.ts`
- `backend/src/services/prdOutline.ts`
- `backend/src/services/agent.ts`
- `backend/src/services/prd/index.ts`
- `backend/src/services/prd/renderer.ts`
- `backend/src/index.ts`（注册 modules 路由）

### 前端（新增）

- `frontend/src/stores/modules.ts`
- `frontend/src/components/ModuleManager.vue`

### 前端（修改）

- `frontend/src/types/index.ts`
- `frontend/src/stores/sessions.ts`（`createSession` 扩展 + 新增 `updateSessionModules`）
- `frontend/src/views/HomeView.vue`（新建PRD改为先开 modal）
- `frontend/src/components/SessionSidebar.vue`（新增「模块管理」Tab + drawer 挂载）
- `frontend/src/components/PrdPanel.vue`（Tab 动态化）
