# 实施计划：将模块编辑控制区完整迁移至左侧对话栏

## 背景与问题

当前每个 PRD 模块进入编辑模式后，底部会出现 `SectionEditBar` 工具条，包含：

1. **AI 指令输入框 + "AI 重写" 按钮** ← 藏在模块底部，用户不易发现
2. **操作按钮**：取消 / 保存文案 / ↩ 撤回 ← 同样不易发现

### 目标

将上述所有控件**完整迁移**到左侧对话栏底部，`SectionEditBar.vue` 整个组件予以删除。模块进入编辑态时，对话栏底部替换为「模块编辑控制区」，编辑结束后恢复普通对话输入。

---

## 目标效果

```
左侧对话栏（SessionSidebar）                右侧 PRD 面板（PrdSectionItem）
┌─────────────────────────────────┐         ┌─────────────────────────────────┐
│  对话  模块管理  历史会话          │         │  [业务流程模块标题]                │
├─────────────────────────────────┤         │                                 │
│  [消息历史，不变]                │         │  [模块内容区域，可单击/双击编辑]   │
│                                 │         │                                 │
│                                 │         │                                 │
│                                 │         ├─────────────────────────────────┤
├─────────────────────────────────┤         │  ← 单击选元素 · 双击编文字  [×] │ ← 模式徽章保留
│ ╔═══════════════════════════╗   │         └─────────────────────────────────┘
│ ║ ✏ 正在编辑：业务流程       ║   │           模块底部不再有任何工具条 ✓
│ ║─────────────────────────────║   │
│ ║ ┌─────────────────────┐   ║   │
│ ║ │ 输入 AI 重写指令...  │   ║   │
│ ║ └─────────────────────┘   ║   │
│ ║              [AI 重写]     ║   │
│ ║─────────────────────────────║   │
│ ║ [取消]  [↩ 撤回]  [保存文案]║   │
│ ╚═══════════════════════════╝   │
│  （普通对话输入框隐藏）           │
└─────────────────────────────────┘
```

### 模式切换规则

| 状态 | 左侧对话栏底部显示 |
|------|----------------|
| 无模块编辑 | 正常对话输入框 |
| 某模块进入编辑态 | 模块编辑控制区（上：AI 指令输入；下：操作按钮行） |
| AI 重写中 | 加载动画，所有按钮禁用 |
| 编辑结束（保存/取消/AI完成） | 恢复正常对话输入框 |

---

## 关键架构问题与解法

### 问题：保存文案需要读取 contenteditable DOM

`SectionEditBar.handleSaveContent` 通过 `getContentHtml` 回调读取 `PrdSectionItem` 中 `contentRef.value`（contenteditable DOM）的当前 HTML，这个访问权限在侧边栏中不存在。

### 解法：prdEditStore 注册 HTML Getter 回调

在 `prdEditStore` 中新增一个 `htmlGetter` 字段，`PrdSectionItem` 进入编辑模式时向 store 注册自己的 `getContentHtml` 函数；侧边栏保存时通过 `prdEditStore.getHtml()` 获取当前 HTML，无需直接访问 DOM。

```
PrdSectionItem 进入编辑 → prdEditStore.registerHtmlGetter(fn)
侧边栏点击保存 → getHtml = prdEditStore.htmlGetter() → 调用 saveSection API
编辑结束 → prdEditStore 清空 htmlGetter
```

> 注意：`PrdSectionItem` 内部仍有多处**自动保存**（失焦、删除行、插入行等），这些仍直接在 `PrdSectionItem` 内部调用，不经过侧边栏，无需改动。

### 问题：保存/回滚的 HTTP 逻辑目前在 `SectionEditBar` 中

删除 `SectionEditBar` 后，这两个 HTTP 调用需要迁移到可被侧边栏调用的位置。

### 解法：提取为独立 composable

新建 `frontend/src/composables/useSectionActions.ts`，封装：
- `saveSection(sessionId, sectionId, getHtml)` — 原 `handleSaveContent` 的 HTTP 逻辑
- `rollbackSection(sessionId, sectionId)` — 原 `handleRollback` 的 HTTP 逻辑

侧边栏和 `PrdSectionItem`（内部自动保存）均可引用此 composable。

---

## 涉及文件

| 文件 | 改动性质 |
|------|---------|
| `frontend/src/stores/prdEdit.ts` | 新增：`editingSectionTitle` 计算属性、`htmlGetter` 注册机制 |
| `frontend/src/composables/useSectionActions.ts` | **新建**：提取保存/回滚 HTTP 逻辑 |
| `frontend/src/views/session/components/SessionSidebar.vue` | 核心改造：底部输入区增加编辑模式控制区（AI指令 + 操作按钮） |
| `frontend/src/views/session/components/PrdSectionItem.vue` | 调整：进入编辑时注册 htmlGetter；自动保存改用新 composable；删除 SectionEditBar 相关代码 |
| `frontend/src/views/session/components/SectionEditBar.vue` | **整个删除** |

---

## 详细实施步骤

### Step 1：`prdEdit.ts` — 新增 htmlGetter 注册与 editingSectionTitle

```ts
import { ref, computed } from 'vue'

// --- 新增 ---
/** 当前编辑模块的实时 HTML getter，由 PrdSectionItem 在进入编辑时注册 */
const htmlGetter = ref<(() => string) | null>(null)

/** 当前编辑模块的标题，供侧边栏显示上下文 */
const editingSectionTitle = computed(() => {
  if (!editingSection.value) return null
  return sections.value.find(s => s.sectionId === editingSection.value)?.title ?? null
})

function registerHtmlGetter(fn: () => string) {
  htmlGetter.value = fn
}

function unregisterHtmlGetter() {
  htmlGetter.value = null
}

/** 侧边栏调用：获取当前 contenteditable 的最新 HTML */
function getHtml(): string {
  return htmlGetter.value?.() ?? editingHtml.value ?? ''
}
// --- 已有 cancelEdit，在其中追加清理 ---
function cancelEdit() {
  editingSection.value = null
  editingHtml.value = null
  aiStreamBuffer.value = ''
  htmlGetter.value = null   // 追加这一行
}
```

在 `return` 中暴露：`editingSectionTitle`、`registerHtmlGetter`、`unregisterHtmlGetter`、`getHtml`、`htmlGetter`。

---

### Step 2：新建 `useSectionActions.ts` — 保存与回滚逻辑

```ts
// frontend/src/composables/useSectionActions.ts
import { ref } from 'vue'
import { usePrdEditStore } from '@/stores/prdEdit'
import { useMessagesStore } from '@/stores/messages'

export function useSectionActions() {
  const prdEditStore = usePrdEditStore()
  const messagesStore = useMessagesStore()

  const saving = ref(false)
  const rolling = ref(false)

  async function saveSection(
    sessionId: string,
    sectionId: string,
    getHtml: () => string,
  ) {
    if (saving.value) return
    saving.value = true
    try {
      const html = getHtml()
      const res = await fetch(
        `/api/sessions/${sessionId}/prd/sections/${sectionId}/content`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html }),
        },
      )
      if (!res.ok) throw new Error(`保存失败 ${res.status}`)
      const data = (await res.json()) as { version: number; updatedAt: number }
      prdEditStore.onContentSaved(sectionId, html, data.version)
      // 重新拉取完整 HTML 以更新导出源
      const prdRes = await fetch(`/api/sessions/${sessionId}/prd`)
      if (prdRes.ok) {
        const prdData = (await prdRes.json()) as { html?: string }
        if (prdData.html) messagesStore.updatePrdHtmlAfterEdit(prdData.html)
      }
    } finally {
      saving.value = false
    }
  }

  async function rollbackSection(sessionId: string, sectionId: string) {
    if (rolling.value) return
    rolling.value = true
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/prd/sections/${sectionId}/rollback`,
        { method: 'POST' },
      )
      if (!res.ok) throw new Error(`回滚失败 ${res.status}`)
      const data = (await res.json()) as {
        restoredVersion: number
        html: string
        assembledPrdHtml: string
      }
      prdEditStore.onRollback(sectionId, data.html, data.restoredVersion)
      messagesStore.updatePrdHtmlAfterEdit(data.assembledPrdHtml)
    } finally {
      rolling.value = false
    }
  }

  return { saving, rolling, saveSection, rollbackSection }
}
```

---

### Step 3：`PrdSectionItem.vue` — 注册 htmlGetter，改用新 composable

**3.1 进入编辑时注册 htmlGetter**

找到 `startEdit` 函数（调用 `prdEditStore.startEdit(sectionId)` 的地方），追加注册：

```ts
function startEdit() {
  prdEditStore.startEdit(props.sectionId)
  prdEditStore.registerHtmlGetter(getContentHtml) // 新增
}
```

**3.2 内部自动保存改用新 composable**

引入 `useSectionActions`：

```ts
import { useSectionActions } from '@/composables/useSectionActions'
const { saveSection, rollbackSection } = useSectionActions()
```

将内部 `handleSaveContent` 改为：

```ts
function handleSaveContent() {
  saveSection(props.sessionId, props.sectionId, getContentHtml)
}
```

> 内部自动保存（失焦、删除行、插入行等场景）的调用点不变，仍是 `handleSaveContent()`。

**3.3 删除 SectionEditBar 相关代码**

- 删除 `import SectionEditBar from './SectionEditBar.vue'`
- 删除 `const editBarRef = ref<...>(null)`
- 删除 template 中的 `<SectionEditBar ... />` 及其所有 props/事件绑定

**3.4 删除 `SectionEditBar.vue` 本身**

整个文件删除。

---

### Step 4：`SessionSidebar.vue` — 完整的模块编辑控制区

**4.1 引入依赖**

```ts
import { usePrdEditStore } from '@/stores/prdEdit'
import { useSectionActions } from '@/composables/useSectionActions'
import { useSectionEdit } from '@/composables/useSSE' // 已有

const prdEditStore = usePrdEditStore()
const { saving, rolling, saveSection, rollbackSection } = useSectionActions()
const { editSection } = useSectionEdit()
```

**4.2 计算属性**

```ts
const isModuleEditing = computed(() => !!prdEditStore.editingSection)
const editingSectionTitle = computed(() => prdEditStore.editingSectionTitle)
const isAiEditing = computed(() => !!prdEditStore.aiEditingSection)
const moduleEditBusy = computed(() => isAiEditing.value || saving.value || rolling.value)
```

**4.3 操作函数**

```ts
const moduleInstruction = ref('')

async function handleModuleAiRewrite() {
  const text = moduleInstruction.value.trim()
  if (!text || moduleEditBusy.value || !prdEditStore.editingSection) return
  moduleInstruction.value = ''
  await editSection(props.sessionId, prdEditStore.editingSection, text)
}

async function handleModuleSave() {
  if (moduleEditBusy.value || !prdEditStore.editingSection) return
  await saveSection(
    props.sessionId,
    prdEditStore.editingSection,
    () => prdEditStore.getHtml(),
  )
}

async function handleModuleRollback() {
  if (moduleEditBusy.value || !prdEditStore.editingSection) return
  await rollbackSection(props.sessionId, prdEditStore.editingSection)
}

function handleModuleCancel() {
  prdEditStore.cancelEdit()
}
```

**4.4 模板：底部输入区两态**

```html
<!-- ── 模块编辑控制区（编辑模式激活时） ── -->
<div v-if="isModuleEditing" class="input-area module-edit-area">

  <!-- 上下文标题 -->
  <div class="module-edit-context">
    <span class="module-edit-icon">✏</span>
    <span class="module-edit-label">正在编辑：</span>
    <span class="module-edit-title">{{ editingSectionTitle }}</span>
  </div>

  <!-- AI 指令输入 -->
  <div class="input-box" :class="{ disabled: moduleEditBusy }">
    <textarea
      v-model="moduleInstruction"
      class="input-textarea"
      placeholder="输入指令让 AI 重写整个模块…"
      :disabled="moduleEditBusy"
      @keydown.enter.exact.prevent="handleModuleAiRewrite"
      rows="1"
      @input="autoResize"
    />
    <div class="input-actions">
      <button
        class="btn-rewrite"
        :disabled="!moduleInstruction.trim() || moduleEditBusy"
        @click="handleModuleAiRewrite"
      >
        <span v-if="isAiEditing" class="spinner" />
        <span v-else>AI 重写</span>
      </button>
    </div>
  </div>

  <!-- 操作按钮行 -->
  <div class="module-edit-actions">
    <button
      class="mod-btn mod-btn-ghost"
      :disabled="moduleEditBusy"
      @click="handleModuleCancel"
    >
      取消
    </button>
    <button
      class="mod-btn mod-btn-ghost mod-btn-warning"
      :disabled="moduleEditBusy"
      @click="handleModuleRollback"
    >
      {{ rolling ? '回滚中…' : '↩ 撤回' }}
    </button>
    <button
      class="mod-btn mod-btn-outline"
      :disabled="moduleEditBusy"
      @click="handleModuleSave"
    >
      {{ saving ? '保存中…' : '保存文案' }}
    </button>
  </div>
</div>

<!-- ── 普通对话输入区（默认，不变） ── -->
<div v-else class="input-area">
  <!-- 保持现有对话输入框代码完全不变 -->
</div>
```

**4.5 新增样式**

```scss
/* ── 模块编辑控制区 ── */
.module-edit-area {
  background: #eef2ff;
  border-top: 2px solid var(--color-primary);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.module-edit-context {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text-secondary);

  .module-edit-icon { font-size: 13px; }

  .module-edit-title {
    font-weight: 600;
    color: var(--color-primary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.module-edit-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

.mod-btn {
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.15s;
  display: inline-flex;
  align-items: center;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.mod-btn-ghost {
  background: transparent;
  color: #64748b;
  &:not(:disabled):hover {
    background: rgba(0, 0, 0, 0.06);
  }
}

.mod-btn-warning {
  color: #b45309;
  &:not(:disabled):hover { color: #92400e; }
}

.mod-btn-outline {
  background: #fff;
  border: 1.5px solid var(--color-primary);
  color: var(--color-primary);
  &:not(:disabled):hover { background: #eef2ff; }
}

.btn-rewrite {
  height: 30px;
  padding: 0 12px;
  border-radius: 15px;
  background: var(--color-primary);
  border: none;
  cursor: pointer;
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;

  &:hover:not(:disabled) { background: var(--color-primary-hover); }
  &:disabled {
    background: var(--color-text-muted);
    cursor: not-allowed;
  }
}

.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

---

## 交互细节与边界情况

### 1. 内部自动保存不受影响
`PrdSectionItem` 内部有多处自动保存（表格失焦、删除行、插入行、Mermaid 编辑确认等），这些仍直接调用组件内的 `handleSaveContent()`（改用新 composable 后逻辑不变），完全独立于侧边栏按钮。

### 2. AI 重写完成后自动退出编辑态
`onAiEditDone` → `cancelEdit()` → `editingSection = null`，侧边栏自动切回普通对话输入框，无需额外处理。

### 3. 保存/回滚完成后退出编辑态
`onContentSaved` 和 `onRollback` 都会调用 `cancelEdit()`（已有逻辑），同样自动恢复。

### 4. 侧边栏 Tab 与控制区的关系
模块编辑控制区在 `.input-area` 区域，位于 Tab 内容区之外，对「对话/模块管理/历史会话」三个 Tab 均生效，无需强制切换 Tab。

### 5. 模式徽章（mode-badge）保留
`PrdSectionItem` 顶部的「← 单击选元素 · 双击编文字」提示徽章及关闭按钮 `[×]` 保留，为用户提供右侧面板的编辑状态视觉反馈。`[×]` 点击触发 `cancelEdit`，与侧边栏「取消」按钮效果相同。

### 6. 保存时 HTML 来源
侧边栏 `handleModuleSave` → `prdEditStore.getHtml()` → 调用已注册的 `htmlGetter`（即 `PrdSectionItem` 的 `getContentHtml`，从 `contentRef.value.innerHTML` 读取），获取最新的 contenteditable 内容。

---

## 不需要改动的内容

- 后端 API：无需改动
- `useSSE.ts` 的 `editSection` / `useSectionEdit`：无需改动
- `PrdSectionList.vue`：无需改动
- `PrdPanel.vue`：无需改动
- `ElementFloatPanel.vue`：无需改动

---

## 实施顺序

1. **`prdEdit.ts`** — 添加 `editingSectionTitle`、`htmlGetter` 注册机制（10 分钟）
2. **`useSectionActions.ts`** — 新建 composable，提取保存/回滚逻辑（15 分钟）
3. **`PrdSectionItem.vue`** — 注册 htmlGetter；改用新 composable；删除 SectionEditBar 引用（20 分钟）
4. **`SectionEditBar.vue`** — 整个文件删除（1 分钟）
5. **`SessionSidebar.vue`** — 添加模块编辑控制区（模板 + 逻辑 + 样式）（35 分钟）
6. **视觉验证与微调**（15 分钟）

**总预估：约 1.5 小时**
