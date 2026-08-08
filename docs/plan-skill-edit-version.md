# Skill 编辑与版本管理 — 施工计划

> 依据：`docs/plan-module-builder-agent.md` 阶段二  
> 施工日期：2026-06-14  
> 总工期：~4 天

---

## 一、现状盘点

| 层           | 现状                                                         | 问题                             |
| ------------ | ------------------------------------------------------------ | -------------------------------- |
| **DB**       | `module_templates` 有 `skill_name`/`render_type`，无版本记录 | Skill 修改只能覆盖写，无法回滚   |
| **文件系统** | `skills/skill-custom-{id}/SKILL.md` 单文件，无历史           | 覆盖即丢失旧版本                 |
| **后端**     | 有创建 Skill 的 3 个端点，无读取/更新/版本端点               | 无法查看或编辑已有 Skill         |
| **前端类型** | `ModuleTemplate` 接口缺少 `skillName`/`renderType` 字段      | 前端无法感知模块是否有关联 Skill |
| **前端 UI**  | 模块库列表只有"删除"按钮，自定义模块无编辑入口               | 用户无法查看或修改生成的 Skill   |

---

## 二、架构决策：文件系统 vs DB，谁是主存储？

**结论：文件系统是 Skill 内容的运行时主存储；DB 只存版本历史（内容快照）。**

```
┌─────────────────────────────────────────────────────┐
│                  数据流向                             │
│                                                     │
│  编辑器（前端）                                       │
│      │                                              │
│      │  读取：优先从 skill_versions DB 读当前版本     │
│      │  （若无 DB 记录则从文件系统读，并自动补写 v1）  │
│      ▼                                              │
│  PUT /skill（保存）                                   │
│      │                                              │
│      ├──① 写入 skill_versions DB（新版本快照）        │
│      │                                              │
│      └──② 覆写 skills/{name}/SKILL.md（文件系统）    │
│              ↑                                      │
│              │  skillLoader.ts 在 PRD 生成时读此文件  │
│              └── PRD 生成流程（custom.ts / sessions） │
└─────────────────────────────────────────────────────┘
```

### 设计原则

| 场景                           | 读哪里                                                        | 写哪里                                                   |
| ------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------- |
| PRD 生成 / AI 重写时注入 Skill | **文件系统**（`skillLoader.ts` 直接 `readFileSync`，不经 DB） | —                                                        |
| 前端编辑器展示当前内容         | **DB** `skill_versions`（当前版本，有完整历史）               | —                                                        |
| 用户保存 Skill                 | —                                                             | **DB**（写新版本）+ **文件系统**（覆写 SKILL.md）双写    |
| 版本历史列表                   | **DB**（仅列元数据）                                          | —                                                        |
| 版本回滚                       | **DB**（读目标版本内容）                                      | **DB**（更新 is_current）+ **文件系统**（覆写 SKILL.md） |
| 导出                           | **DB** 当前版本（若无则文件系统兜底）                         | —                                                        |
| 导入                           | —                                                             | **DB**（写 v1）+ **文件系统**（写 SKILL.md）             |

### 为什么不直接只用文件系统存版本？

- 文件系统不支持原子化的版本切换，需要自己维护 `.v1`、`.v2` 备份文件，路径管理复杂
- DB 事务保证版本切换的原子性（`is_current` 更新 + 新版本插入在同一事务内）
- 前端加载版本列表不需要扫描目录，直接 SQL 查询更高效

### 为什么不直接只用 DB 存所有内容（废弃文件系统）？

- `skillLoader.ts` 当前用 `readFileSync` 同步读文件，是 PRD 生成流程的热路径
- 改成查 DB 需要修改所有调用方（`custom.ts`、`sessions.ts` PATCH handler），且引入异步读取问题
- 保留文件系统作为"热副本"，PRD 生成无需改动

---

## 三、功能范围

### 本次实现（三个功能）

1. **查看/编辑 Skill**：在模块库中为关联了 Skill 的自定义模块提供编辑入口，支持直接文本编辑和 AI 对话优化两种模式。

2. **版本管理**：每次保存 Skill 时自动生成版本记录，支持查看历史版本并一键回滚。

3. **导入/导出**：支持将 Skill 导出为 `.md` 文件下载，也支持上传已有 SKILL.md 文件导入创建新模块。

### 不在本次范围

- 多用户/团队 Skill 共享
- Skill Marketplace（公开模板市场）
- Skill 合并/diff 对比视图

---

## 四、施工分阶段

### Phase 1：数据层 — 新增 `skill_versions` 表

#### 1.1 修改 `backend/src/db/schema.ts`

新增版本记录表：

```sql
CREATE TABLE IF NOT EXISTS skill_versions (
  id          TEXT    PRIMARY KEY,
  module_id   TEXT    NOT NULL REFERENCES module_templates(id) ON DELETE CASCADE,
  content     TEXT    NOT NULL,   -- SKILL.md 完整内容
  version     INTEGER NOT NULL,   -- 版本号，从 1 开始递增
  is_current  INTEGER NOT NULL DEFAULT 1,  -- 1 = 当前生效版本
  created_at  INTEGER NOT NULL
)
```

索引：`(module_id, is_current)` 用于快速查当前版本。

新增接口：

```typescript
export interface SkillVersionRow {
	id: string;
	module_id: string;
	content: string;
	version: number;
	is_current: 0 | 1;
	created_at: number;
}
```

#### 1.2 修改 `backend/src/db/migrations.ts`

追加 version 7 迁移：创建 `skill_versions` 表和索引。

#### 1.3 修改 `backend/src/routes/modules.ts` — `confirm-skill` 端点补写版本记录

在 `POST /api/modules/confirm-skill` 写入模块记录后，同步写入首个 `skill_versions` 记录（version=1，is_current=1）：

```typescript
db.prepare(
	"INSERT INTO skill_versions (id, module_id, content, version, is_current, created_at) VALUES (?, ?, ?, 1, 1, ?)",
).run(uuidv4(), id, skillContent.trim(), now);
```

---

### Phase 2：后端新增 Skill 管理 API

在 `backend/src/routes/modules.ts` 追加以下端点：

#### 2.1 `GET /api/modules/:id/skill` — 获取当前 Skill 内容

```
查 skill_versions WHERE module_id=:id AND is_current=1
→ 返回 { version, content, createdAt }
若无版本记录但有 skill_name → 读文件系统兜底
若都没有 → 404
```

#### 2.2 `PUT /api/modules/:id/skill` — 保存新版本 Skill

```
Request: { content: string }

处理流程：
1. 校验 content 非空 + frontmatter 格式合法
2. 读当前最大 version 号
3. 旧版本 is_current = 0
4. INSERT 新版本记录（version+1，is_current=1）
5. 用新 content 覆写 skills/{skill_name}/SKILL.md 文件
6. 返回 { version: N, savedAt: ts }
```

#### 2.3 `GET /api/modules/:id/skill/versions` — 获取版本列表

```
→ 返回 [ { id, version, is_current, createdAt }, ... ] 降序
  不返回 content（节省带宽），前端按需单独加载
```

#### 2.4 `GET /api/modules/:id/skill/versions/:versionId` — 获取指定版本内容

```
→ 返回 { version, content, createdAt }
```

#### 2.5 `POST /api/modules/:id/skill/rollback` — 回滚到指定版本

```
Request: { versionId: string }

处理流程：
1. 查目标版本记录，确认属于该模块
2. 当前版本 is_current = 0
3. 目标版本 is_current = 1
4. 用目标版本 content 覆写 SKILL.md 文件
5. 返回 { restoredVersion: N }
```

#### 2.6 `GET /api/modules/:id/skill/export` — 导出 SKILL.md 文件

```
读当前 Skill 内容（skill_versions 或文件系统）
→ Content-Disposition: attachment; filename="{moduleName}-skill.md"
→ Content-Type: text/markdown; charset=utf-8
→ 直接返回文件内容
```

#### 2.7 `POST /api/modules/import-skill` — 导入 SKILL.md 创建新模块

```
Request: multipart/form-data
  - file: SKILL.md 文件
  - moduleName: string（模块名称）

处理流程：
1. 读取上传文件内容（使用 multer，内存模式，最大 100KB）
2. 程序化校验 frontmatter 格式
3. 生成 skillName（skill-custom-{nanoid8}）
4. 写入文件系统
5. 创建 module_templates 记录
6. 写入 skill_versions 首个版本
7. 返回新模块对象
```

#### 2.8 `POST /api/modules/:id/skill/optimize` — AI 优化 Skill

```
Request: { instruction: string }（优化指令，如"把输出改为文段+表格混合形式"）

处理流程：
1. 读取当前 Skill content
2. 调用 LLM，System Prompt 注入 create-skill 规范
   User Prompt 包含：当前 Skill 内容 + 优化指令
3. 校验生成结果，不合格重试（≤2次）
4. 返回 { optimizedContent: string }（不自动写入，需用户预览确认后调用 PUT）
```

---

### Phase 3：前端类型与 Store 更新

#### 3.1 修改 `frontend/src/types/index.ts`

扩展 `ModuleTemplate` 接口：

```typescript
export interface ModuleTemplate {
	id: string;
	name: string;
	description?: string;
	skillName?: string; // ← 新增
	renderType?: string; // ← 新增
	isBuiltin: boolean;
}
```

#### 3.2 修改 `frontend/src/stores/modules.ts`

新增 Skill 相关 actions：

```typescript
/** 获取当前 Skill 内容 */
async function getSkillContent(
	moduleId: string,
): Promise<{ version: number; content: string }>;

/** 保存 Skill 新版本 */
async function saveSkillContent(
	moduleId: string,
	content: string,
): Promise<{ version: number }>;

/** 获取版本列表 */
async function getSkillVersions(
	moduleId: string,
): Promise<
	Array<{ id: string; version: number; is_current: boolean; createdAt: number }>
>;

/** 获取指定版本内容 */
async function getSkillVersion(
	moduleId: string,
	versionId: string,
): Promise<{ version: number; content: string }>;

/** 回滚版本 */
async function rollbackSkill(
	moduleId: string,
	versionId: string,
): Promise<{ restoredVersion: number }>;

/** 触发浏览器下载 Skill 文件 */
async function exportSkill(moduleId: string, moduleName: string): Promise<void>;

/** AI 优化 Skill（返回预览内容，不自动写入）*/
async function optimizeSkill(
	moduleId: string,
	instruction: string,
): Promise<{ optimizedContent: string }>;
```

---

### Phase 4：前端 UI — Skill 编辑面板

#### 4.1 修改 `frontend/src/components/ModuleManager.vue`

在模块库列表中，为 `skillName` 非空的自定义模块增加"编辑 Skill"按钮（铅笔图标），与"删除"按钮并排：

```
现状：[模块名称] [自定义标签] [× 删除]
目标：[模块名称] [自定义标签] [✎ 编辑 Skill] [× 删除]
```

点击"编辑 Skill"时：

1. 记录 `editingSkillModuleId` ref
2. 在 `mm-add-area` 区域展开 `SkillEditorPanel`（与 `ModuleBuilderPanel` 同位置）
3. 关闭手动添加和 AI 引导创建面板

#### 4.2 新建 `frontend/src/components/SkillEditorPanel.vue`

接收 `moduleId` 和 `moduleName` prop，内部状态机：

```
step: 'loading' → 'edit' → 'ai-optimize' → 'preview' → 'versions'
```

**各步骤 UI：**

```
step = 'edit'（主编辑界面）
  ┌────────────────────────────────────────────────────────┐
  │  [版本 v3  ↓]  [查看历史版本]     [导出 .md]           │
  │  ─────────────────────────────────────────────         │
  │  <textarea class="skill-editor">                       │
  │    ---                                                 │
  │    name: skill-custom-xxx                              │
  │    description: ...                                    │
  │    ---                                                 │
  │    # 竞品分析 生成指南 ...                              │
  │  </textarea>                                           │
  │  ─────────────────────────────────────────────         │
  │  [✦ AI 优化]           [取消]  [保存新版本 ✓]          │
  └────────────────────────────────────────────────────────┘

step = 'ai-optimize'
  ┌────────────────────────────────────────────────────────┐
  │  告诉 AI 如何优化这个 Skill：                            │
  │  [________________________________________]（文本域）   │
  │  例：把输出格式改为文段+表格，并增加市场趋势分析         │
  │                        [取消]  [生成优化版本 →]         │
  └────────────────────────────────────────────────────────┘

step = 'preview'（AI 生成结果预览，与 ModuleBuilderPanel 一致）
  ┌────────────────────────────────────────────────────────┐
  │  <pre class="skill-preview">{{ optimizedContent }}</pre>│
  │                     [← 重新生成]  [采用此版本 ✓]        │
  └────────────────────────────────────────────────────────┘

step = 'versions'（历史版本列表）
  ┌────────────────────────────────────────────────────────┐
  │  历史版本                              [← 返回编辑]      │
  │  ─────────────────────────────────────────────         │
  │  ● v3  当前版本  2026-06-14 11:30                       │
  │  ○ v2  2026-06-14 10:15           [预览] [回滚]         │
  │  ○ v1  2026-06-14 09:00           [预览] [回滚]         │
  └────────────────────────────────────────────────────────┘
```

**关键逻辑：**

```typescript
// 保存新版本
async function handleSave() {
	await modulesStore.saveSkillContent(props.moduleId, editContent.value);
	currentVersion.value++; // 更新显示的版本号
}

// AI 优化
async function handleAiOptimize() {
	loading.value = true;
	const result = await modulesStore.optimizeSkill(
		props.moduleId,
		instruction.value,
	);
	optimizedContent.value = result.optimizedContent;
	step.value = "preview";
	loading.value = false;
}

// 采用 AI 优化结果（不写文件，直接填入编辑器等待用户再次确认保存）
function adoptOptimized() {
	editContent.value = optimizedContent.value;
	step.value = "edit";
}

// 回滚
async function handleRollback(versionId: string) {
	await modulesStore.rollbackSkill(props.moduleId, versionId);
	// 重新加载当前内容
	await loadCurrentSkill();
	step.value = "edit";
}
```

#### 4.3 新增导入入口（`ModuleManager.vue` 添加区域）

在"手动添加"和"AI 引导创建"按钮旁新增"导入 Skill"按钮：

```
[ + 手动添加 ]   [ ✦ AI 引导创建 ]   [ ↑ 导入 Skill ]
```

点击"导入 Skill"：

1. 触发隐藏的 `<input type="file" accept=".md">` 文件选择
2. 用户选择文件后弹出输入模块名称的简单表单
3. 调用 `POST /api/modules/import-skill`
4. 成功后刷新模块列表并自动选中新模块

---

### Phase 5：后端安装 multer（文件上传依赖）

导入功能需要处理 multipart 上传：

```bash
pnpm --filter backend add multer
pnpm --filter backend add @types/multer -D
```

在 `modules.ts` 中配置内存存储（不落盘，直接读 buffer 转字符串）：

```typescript
import multer from "multer";
const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 100 * 1024 },
});

router.post("/import-skill", upload.single("file"), (req, res) => {
	const content = req.file?.buffer.toString("utf-8") ?? "";
	// ...
});
```

---

## 五、文件变更清单

### 新增文件

| 文件                                           | 说明                                            |
| ---------------------------------------------- | ----------------------------------------------- |
| `frontend/src/components/SkillEditorPanel.vue` | Skill 编辑面板（文本编辑 + AI 优化 + 版本历史） |

### 修改文件

| 文件                                        | 改动内容                                                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `backend/src/db/schema.ts`                  | 新增 `skill_versions` 表 DDL 和 `SkillVersionRow` 接口                                                     |
| `backend/src/db/migrations.ts`              | version 7：创建 `skill_versions` 表和索引                                                                  |
| `backend/src/routes/modules.ts`             | `confirm-skill` 补写版本记录；新增 7 个端点（GET/PUT skill、versions、rollback、export、import、optimize） |
| `backend/src/services/moduleBuilder.ts`     | 新增 `optimizeSkillContent(currentContent, instruction)` 函数                                              |
| `frontend/src/types/index.ts`               | `ModuleTemplate` 新增 `skillName`/`renderType` 字段                                                        |
| `frontend/src/stores/modules.ts`            | 新增 Skill 相关 6 个 actions                                                                               |
| `frontend/src/components/ModuleManager.vue` | 模块列表增加"编辑 Skill"按钮；添加区增加"导入 Skill"按钮；嵌入 `SkillEditorPanel`                          |

---

## 六、施工顺序与依赖关系

```
Phase 1（DB 层）
    ↓ schema + migrations + confirm-skill 补写版本记录
Phase 2（后端 API）
    ↓ 2.1/2.2 先做（查看/保存，前端联调基础）
    ↓ 2.3/2.4 版本列表/单版本内容
    ↓ 2.5 回滚
    ↓ 2.6 导出（独立，最简单）
    ↓ 2.7 导入（依赖 multer）
    ↓ 2.8 AI 优化（依赖 moduleBuilder.ts 扩展）
Phase 3（前端类型 + Store）
    ↓ 必须先更新类型，组件才能正确推断
Phase 4（前端 UI）
    ↓ 4.1 ModuleManager 入口（先做，最小改动）
    ↓ 4.2 SkillEditorPanel 主体（最大工作量）
    ↓ 4.3 导入入口（独立，最后做）
Phase 5（multer 安装）
    ↓ 可与 Phase 2 并行
```

---

## 七、API 端点总览

| 方法 | 路径                                         | 说明                              |
| ---- | -------------------------------------------- | --------------------------------- |
| GET  | `/api/modules/:id/skill`                     | 获取当前 Skill 内容 + 版本号      |
| PUT  | `/api/modules/:id/skill`                     | 保存新版本 Skill                  |
| GET  | `/api/modules/:id/skill/versions`            | 获取版本列表（不含内容）          |
| GET  | `/api/modules/:id/skill/versions/:versionId` | 获取指定版本内容                  |
| POST | `/api/modules/:id/skill/rollback`            | 回滚到指定版本                    |
| GET  | `/api/modules/:id/skill/export`              | 下载 SKILL.md 文件                |
| POST | `/api/modules/import-skill`                  | 上传 SKILL.md 导入创建新模块      |
| POST | `/api/modules/:id/skill/optimize`            | AI 优化 Skill（返回预览，不写入） |

---

## 八、验收标准

| #   | 场景                                           | 验收条件                                                              |
| --- | ---------------------------------------------- | --------------------------------------------------------------------- |
| T-1 | 查看已有 Skill                                 | 点击"编辑 Skill"后正确加载 SKILL.md 内容，显示当前版本号              |
| T-2 | 直接文本编辑并保存                             | 修改后保存，版本号 +1，文件系统和 DB 同步更新                         |
| T-3 | AI 优化 Skill                                  | 输入优化指令后生成新内容，预览确认后版本 +1                           |
| T-4 | 查看版本列表                                   | 正确展示所有历史版本，当前版本标记高亮                                |
| T-5 | 回滚到历史版本                                 | 回滚后文件内容和 DB `is_current` 正确更新，PRD 重新生成时使用回滚版本 |
| T-6 | 导出 SKILL.md                                  | 触发浏览器下载，文件名为 `{模块名}-skill.md`                          |
| T-7 | 导入 SKILL.md                                  | 上传后创建新模块并写入 Skill 文件，`skill_versions` 有 v1 记录        |
| T-8 | 旧存量模块（无 skill_versions 记录）查看 Skill | 从文件系统兜底读取，不报错                                            |
| T-9 | 删除有 Skill 的模块                            | `skill_versions` 记录通过外键 CASCADE 自动删除                        |

---

## 九、注意事项

| 风险                             | 说明                                     | 应对                                                                                 |
| -------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| 存量模块无 `skill_versions` 记录 | `confirm-skill` 补写逻辑只作用于新建模块 | 读取 Skill 时检查 `skill_versions`，无记录则从文件系统读取，同时自动补写一条 v1 记录 |
| 文件系统与 DB 不同步             | 若用户手动修改 `skills/` 目录下的文件    | 以 DB 版本为准，提供"从文件重新同步"功能（一期可不做）                               |
| AI 优化结果格式不合规            | LLM 可能输出不符合 SKILL.md 规范的内容   | 复用 `validateSkillContent()` 校验，不合规时提示用户而不自动采用                     |
| 大文件上传                       | 用户上传非 Markdown 文件或超大文件       | multer 限制 100KB；前端限制 `.md` 后缀；后端校验 frontmatter                         |
