# 可编辑 PRD 系统施工计划

> 基于方案评审结论：模块粒度双轨编辑（AI 重生成 + 直接内联编辑）  
> 不引入新 Agent 框架，复用现有 LangChain.js + SSE 管道  
> 施工日期：2026-05-30

---

## 一、现状盘点

| 层 | 现状 | 问题 |
| --- | --- | --- |
| **DB** | `prds.html` 存储完整单文件 HTML blob | 无法按模块独立读写，编辑即全量重建 |
| **后端** | `generateFullPrd()` 生成后一次性写入 `prds` | 模块内容生成完即丢弃，无法局部更新 |
| **前端** | `PrdPanel` 用 `<iframe :srcdoc>` 展示 | 没有编辑入口，PRD 是只读的 |
| **SSE** | 已有 `prd_progress`、`prd_ready`、`delta` 等事件类型 | 缺少 `section_edit_*` 系列事件 |

---

## 二、目标交互效果

```
PRD 已生成后：
  鼠标 hover 某模块 → 右上角出现「编辑」图标
      ↓ 点击「编辑」
  该模块进入编辑态：
    ┌──────────────────────────────────────────────────────┐
    │  [模块内容，contenteditable 可直接改文案]              │
    │                                                      │
    │  AI 指令：[____把表格改成 MoSCoW 优先级模型_________]  │
    │           [取消]  [AI 重写]   [保存文案]  [↩ 撤回]   │
    └──────────────────────────────────────────────────────┘
  → 点击「AI 重写」→ SSE 流式替换该模块内容
  → 点击「保存文案」→ 直接 PUT 保存 contenteditable 内容
  → 点击「↩ 撤回」→ 恢复到上一版本
```

---

## 三、施工分阶段

### Phase 1：数据层改造（地基）

**目标**：把每个模块的 HTML 片段从 blob 里拆出来，独立存储并支持版本追溯。

#### 1.1 新增 `prd_sections` 表 Schema

文件：`backend/src/db/schema.ts`

新增常量 `CREATE_PRD_SECTIONS_TABLE`：

```sql
CREATE TABLE IF NOT EXISTS prd_sections (
  id           TEXT    PRIMARY KEY,
  prd_id       TEXT    NOT NULL REFERENCES prds(id) ON DELETE CASCADE,
  session_id   TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  section_id   TEXT    NOT NULL,   -- background / featureList 等
  title        TEXT    NOT NULL,
  html_content TEXT    NOT NULL,   -- 该模块的 HTML 片段
  version      INTEGER NOT NULL DEFAULT 1,
  is_current   INTEGER NOT NULL DEFAULT 1,  -- 1 = 当前展示版本
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
)
```

索引：`(prd_id, section_id, is_current)`，用于快速查当前版本。

#### 1.2 数据库迁移

文件：`backend/src/db/migrations.ts`

新增 `version < 4` 分支，执行 `CREATE_PRD_SECTIONS_TABLE`，`user_version = 4`。

#### 1.3 修改 `generateFullPrd()`

文件：`backend/src/services/prd/index.ts`

在现有逻辑的「写入 prds 表」步骤之后，**追加**将 `results` Map 中每个模块写入 `prd_sections`：

- 遍历 `orderedSections`，对每个 section：
  - INSERT 一条 `prd_sections` 记录（`is_current = 1`）
- 该改动**不影响**现有 `renderPrd()` 和 `prds.html` 写入逻辑，保持向后兼容

> ⚠️ 注意：存量 PRD 没有 sections 记录，前端编辑功能对存量 PRD 展示「不可编辑」提示即可，不需要迁移老数据。

---

### Phase 2：后端 API 扩展（三个新端点）

文件：`backend/src/routes/sessions.ts`（在现有路由文件尾部追加）

#### 2.1 `GET /api/sessions/:id/prd/sections`

**作用**：返回当前 PRD 所有模块的元信息列表（不含 html_content，节省带宽）。

返回结构：
```json
{
  "prdId": "xxx",
  "sections": [
    { "id": "rec-uuid", "sectionId": "background", "title": "背景与目标", "version": 1 },
    { "id": "rec-uuid", "sectionId": "featureList", "title": "功能清单", "version": 2 }
  ]
}
```

逻辑：查 `prd_sections` 表，`WHERE prd_id = (最新 prd) AND is_current = 1`，按 section_id 顺序返回。

---

#### 2.2 `PATCH /api/sessions/:id/prd/sections/:sectionId`

**作用**：AI 重写指定模块，SSE 流式返回新内容。

Request body：
```json
{ "instruction": "把功能清单的优先级改为 MoSCoW 模型" }
```

处理流程：

```
1. 读取当前 section 的 html_content（is_current=1）
2. 读取 session 的对话历史摘要（取最近 6 条 messages，构建上下文背景）
3. 初始化 SSE（复用 initSse()）
4. 调用 LangChain ChatModel，Prompt 结构：
   ┌─────────────────────────────────────────────────────────────┐
   │ System: 你是一个 PRD 文档编辑助手。你只负责修改指定模块的内容，   │
   │         输出格式为纯 HTML 片段（不含 <html>/<body> 标签）。    │
   │         保留原有的 CSS class 命名规范。不要输出任何解释文字。   │
   │                                                              │
   │ User:   [session 上下文背景]                                  │
   │         以下是「{sectionTitle}」模块当前的 HTML 内容：         │
   │         <current_html>{currentHtml}</current_html>           │
   │         修改指令：{instruction}                               │
   └─────────────────────────────────────────────────────────────┘
5. SSE 推送 delta（复用 writeDelta()）
6. 生成完成后：
   a. 简单校验 HTML 结构（检查标签闭合）
   b. 若有 Mermaid 内容，提取并记录（供后续提示但不阻断保存）
   c. 将当前版本的 is_current 设为 0（旧版本归档）
   d. INSERT 新版本记录（version + 1，is_current = 1）
   e. 重新调用 renderPrd() 组装完整 HTML，UPDATE prds.html
   f. 推送 section_edit_done 事件：
      { type: 'section_edit_done', sectionId, newHtml, version }
7. writeDone()
```

**错误处理**：
- 生成内容为空 → 不写入，推送 error 事件
- HTML 结构严重损坏 → 不写入，推送 error 事件并建议用户重试

---

#### 2.3 `PUT /api/sessions/:id/prd/sections/:sectionId/content`

**作用**：直接保存内联编辑的 HTML 内容（contenteditable 改完后同步）。

Request body：
```json
{ "html": "<section>...</section>" }
```

处理流程：
1. 简单校验 html 字段非空
2. 旧版本 `is_current = 0`
3. INSERT 新记录（version + 1，is_current = 1）
4. 重新组装 `prds.html`
5. 返回 `{ version: N, updatedAt: ts }`

---

#### 2.4 `POST /api/sessions/:id/prd/sections/:sectionId/rollback`

**作用**：将指定模块回滚到上一个版本。

处理流程：
1. 查当前版本（is_current=1）的 `version` 号
2. 查 `version - 1` 的记录
3. 若存在：当前版本 is_current=0，上一版本 is_current=1
4. 重新组装 `prds.html`
5. 返回 `{ restoredVersion: N, html: "..." }`

---

### Phase 3：前端改造（核心体验）

#### 3.1 新增 Pinia store：`usePrdEditStore`

文件：`frontend/src/stores/prdEdit.ts`（新建）

状态：
```ts
{
  editingSection: string | null,      // 当前编辑中的 sectionId
  sectionVersions: Record<string, number>,  // sectionId → version
  editingHtml: string | null,         // contenteditable 当前内容
  isAiEditing: boolean,               // AI 重写进行中
  aiEditingSection: string | null,    // 正在被 AI 编辑的 sectionId
}
```

Actions：
- `startEdit(sectionId)` / `cancelEdit()`
- `setEditingHtml(html)`
- `onAiEditDelta(sectionId, chunk)` — 拼接流式 HTML
- `onAiEditDone(sectionId, newHtml, version)` — 完成后更新

---

#### 3.2 SSE 新增事件处理

文件：`frontend/src/composables/useSSE.ts`

在现有 `prd_progress`、`prd_ready` 事件处理逻辑之后，新增对以下事件的处理：

| 事件 type | 触发时机 | 前端动作 |
| --- | --- | --- |
| `section_edit_delta` | AI 重写时流式输出 | 实时替换编辑区预览内容 |
| `section_edit_done` | AI 重写完成 | 更新 prdHtml，退出编辑态，更新 version |
| `section_edit_error` | 重写失败 | 显示错误提示，保留原内容 |

---

#### 3.3 改造 `PrdPanel.vue`

**核心变化**：PRD 从 `<iframe :srcdoc>` 改为**原生 DOM 渲染 + 逐模块可编辑**。

> **为什么放弃 iframe？**  
> iframe 无法穿透操作其 DOM，无法实现 hover 高亮和 contenteditable。  
> 改为在 Vue 中直接渲染模块 HTML，用 `v-html` 绑定各 section 内容。

**新布局结构**（仅 PRD 已生成后的区域）：

```
PrdPanel
├── PrdToolbar.vue（顶部工具栏：导出、全屏等，已有逻辑迁入）
└── PrdSectionList.vue（模块列表）
    └── PrdSectionItem.vue × N（每个模块）
        ├── 预览区（v-html，有编辑态时变 contenteditable）
        └── SectionEditBar.vue（编辑工具条，hover 时浮现）
```

**`PrdSectionItem.vue` 关键逻辑**：

```
非编辑态：
  - 渲染 v-html="section.html"
  - hover 时右上角浮现「✏ 编辑」按钮
  - Mermaid / markmap 渲染通过 onMounted + MutationObserver 触发

编辑态（点击「编辑」后）：
  - 内容区 div 加上 contenteditable="true"
  - 底部出现工具条：
    [AI 指令输入框] [AI 重写 ↗] [保存文案 ✓] [取消 ✕] [撤回 ↩]
  - AI 重写时：禁用所有按钮，内容区显示流式替换动画
```

**`SectionEditBar.vue`** 输入框发送逻辑：
- 点击「AI 重写」→ `PATCH /api/sessions/:id/prd/sections/:sectionId`，开启独立 SSE 连接
- 点击「保存文案」→ `PUT .../content`，body 为 contenteditable 当前 innerHTML
- 点击「撤回」→ `POST .../rollback`，成功后更新本地 html

---

#### 3.4 Mermaid / markmap 重新渲染

**问题**：原 iframe 中 Mermaid 是自动初始化的，改为 Vue DOM 渲染后需手动触发。

**方案**：在 `PrdSectionItem.vue` 的 `onMounted` 和 `watch(section.html)` 中调用：

```
mermaid.run({ nodes: [...querySelectorAll('.mermaid')] })
markmap 对应逻辑同理
```

CDN 引用保持不变（通过 `<script>` 注入到页面全局，而非 iframe）。

---

### Phase 4：SSE 协议扩展

文件：`backend/src/services/sse.ts`

新增两个写入函数：

```
writeSectionEditDelta(res, sectionId, chunk)
  → data: { type: 'section_edit_delta', sectionId, content }

writeSectionEditDone(res, sectionId, newHtml, version)
  → data: { type: 'section_edit_done', sectionId, newHtml, version }
```

---

## 四、文件变更清单

### 新增文件

| 文件 | 说明 |
| --- | --- |
| `frontend/src/stores/prdEdit.ts` | PRD 编辑状态管理 |
| `frontend/src/components/PrdSectionList.vue` | 模块列表容器 |
| `frontend/src/components/PrdSectionItem.vue` | 单个模块展示+编辑 |
| `frontend/src/components/SectionEditBar.vue` | 模块编辑工具条 |

### 修改文件

| 文件 | 改动内容 |
| --- | --- |
| `backend/src/db/schema.ts` | 新增 `CREATE_PRD_SECTIONS_TABLE` 常量 |
| `backend/src/db/migrations.ts` | 新增 `version < 4` 迁移分支 |
| `backend/src/services/prd/index.ts` | `generateFullPrd()` 结尾写入 `prd_sections` |
| `backend/src/services/sse.ts` | 新增 `writeSectionEditDelta`、`writeSectionEditDone` |
| `backend/src/routes/sessions.ts` | 新增 3 个路由：PATCH sections、PUT content、POST rollback |
| `frontend/src/composables/useSSE.ts` | 新增 `section_edit_*` 事件处理 |
| `frontend/src/components/PrdPanel.vue` | 替换 iframe 为模块列表组件，迁移工具栏 |
| `frontend/src/stores/messages.ts` | 新增 `setPrdSectionHtml()` action |

---

## 五、实施顺序与依赖关系

```
Phase 1（DB + 数据写入）
    ↓ 完成后 Phase 2 才能读到数据
Phase 2（后端 API）
    ↓ 2.1 先做（GET sections，前端联调用）
    ↓ 2.2 其次（AI 重写，核心功能）
    ↓ 2.3 / 2.4 最后（直接保存、rollback，体验补全）
Phase 3（前端）
    ↓ 3.1 store 先建（其他组件依赖它）
    ↓ 3.2 SSE 事件（与 2.2 联调）
    ↓ 3.3 组件拆分（最后做，工作量最大）
    ↓ 3.4 Mermaid 渲染（随 3.3 一起处理）
Phase 4（SSE 协议）
    ↓ 可与 Phase 2 同步进行
```

---

## 六、风险与注意事项

| 风险点 | 说明 | 应对 |
| --- | --- | --- |
| **Mermaid 重渲染** | 从 iframe 切到原生 DOM 后，Mermaid CDN 需重新 `.run()` | onMounted + watch html 变化时触发 |
| **contenteditable 与 v-html 冲突** | Vue 在 DOM 被 contenteditable 修改后重新 patch 会覆盖用户输入 | 编辑态时停止 Vue 对该节点的响应式绑定（`v-once` 或直接操作 DOM ref） |
| **AI 输出 HTML 破坏 class 结构** | LLM 可能生成与 `renderPrd()` 模板不一致的 class | Prompt 中明确要求保留 CSS class 命名；写入前做基础结构校验 |
| **并发编辑冲突** | 用户同时编辑多个模块 | Phase 1 先只允许同时编辑一个模块（store 中 editingSection 互斥）；多模块并发编辑留作后期 |
| **存量 PRD 无 sections 数据** | 旧的 PRD 没有写入 prd_sections | 在 PrdPanel 判断：若 sections 为空则隐藏编辑入口，展示「重新生成以启用编辑」提示 |

---

## 七、不在本次范围内的功能

以下功能**本次不做**，保留接口扩展点即可：

- 模块版本历史查看 UI（rollback 接口已有，UI 暂不做）
- 智能建议卡片（生成完后主动推荐下一步）
- 多人协作编辑
- 模块级导出（按需导出单个模块）
