# 方案：手动新增表格行并输入文字

## 背景

当前表格内容完全由 AI 生成，用户无法手动在表格中插入新行。在编辑模式下，用户有时需要在特定位置补充一条记录，这类操作不值得调用 AI——直接手动插入一行并输入文字更高效。

---

## 一、交互设计

### 触发方式

在编辑模式（`select` 子模式）下，鼠标悬停到某一 `tr` 行时，在该行**左侧**出现一个 `+` 图标浮钮（`AddRowBtn`）。

```
┌─────────────────────────────────────────┐
│  功能点      功能描述      优先级  迭代期 │ ← thead（不显示 +）
├─────────────────────────────────────────┤
+ │  看板管理    支持拖拽…    P0 核心  MVP  │ ← hover 时左侧显示 +
├─────────────────────────────────────────┤
+ │  权限管理    支持角色…    P1 重要  一期  │
└─────────────────────────────────────────┘
                                        [+ 在末尾追加行]
```

- `thead` 行不显示 `+`（只在 `tbody` 的 `tr` 上触发）
- `+` 钮紧贴行左侧，不占列宽，用 `position: absolute` 实现
- 点击 `+` → 在该行**下方**插入一条新行
- 表格底部额外保留一个"**+ 追加行**"按钮（永久可见，点击在末尾插入）

### 新行插入后的行为

1. 新行按现有表格的列数自动生成对应数量的空 `<td>`
2. 光标自动定位到新行的**第一个 `<td>`**，内容区切换为 `contenteditable="true"`（复用现有 text 模式）
3. 用户直接输入文字；按 `Tab` 键跳到同行下一格，`Shift+Tab` 跳上一格
4. 按 `Enter`（在最后一格时）或点击其他区域 → 退出 `contenteditable`，回到 `select` 模式
5. 新行的修改纳入现有**保存流程**（点击底部工具条"保存"）

### 删除行（同步实现）

- 在行被选中（第二级，`tr.el-selected`）时，`ElementFloatPanel` 底部增加一个"🗑 删除行"按钮
- 点击 → 弹 `ConfirmDialog` 确认 → 从 DOM 中删除该 `tr` → 自动保存

---

## 二、UI 规范

### `+` 浮钮样式

```css
.add-row-btn {
  position: absolute;
  left: -22px;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #4f46e5;
  color: #fff;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;           /* 默认隐藏 */
  transition: opacity 0.15s;
}

tr:hover .add-row-btn {
  opacity: 1;           /* hover 时显示 */
}
```

> `tr` 需设置 `position: relative`（通过 `:deep(tbody tr)` 注入）

### 末尾"追加行"按钮

```html
<button class="append-row-btn">＋ 追加行</button>
```

样式：与表格等宽，高度 32px，背景 `#f8fafc`，虚线边框 `1px dashed #c7d2fe`，hover 时背景变为 `#eef2ff`。

### 新行初始 HTML 模板

```html
<tr class="prd-tr-new">
  <td></td>   <!-- 重复 N 次，N = 现有列数 -->
</tr>
```

不复制 `colspan`、`rowspan` 等属性，不复制 badge 等子结构。

---

## 三、实现方案

### 3.1 前端组件改动

#### `PrdSectionItem.vue`

| 改动点 | 说明 |
|---|---|
| 新增 `hoveredRow` ref | 记录当前 hover 的 `tr` 元素 |
| `@mouseover` 监听 `.prd-section-body` | 识别 `tr` hover，更新 `hoveredRow` |
| `@mouseleave` | 清空 `hoveredRow` |
| `addRowAfter(tr)` | 插入新行并进入 text 模式 |
| `appendRow(table)` | 在 table 末尾插入新行 |
| `deleteRow(tr)` | 删除选中行，触发确认弹窗 |
| Template | 用 `Teleport` 或绝对定位渲染 `+` 浮钮 |

**核心函数 `addRowAfter(refTr)`**：

```typescript
function addRowAfter(refTr: HTMLTableRowElement) {
  // 1. 计算列数（取最大 td/th 数）
  const table = refTr.closest('table') as HTMLTableElement
  const colCount = Math.max(
    ...Array.from(table.rows).map(r => r.cells.length)
  )

  // 2. 生成新行
  const newTr = document.createElement('tr')
  newTr.classList.add('prd-tr-new')
  for (let i = 0; i < colCount; i++) {
    newTr.appendChild(document.createElement('td'))
  }

  // 3. 插入到 refTr 后面
  refTr.after(newTr)

  // 4. 进入 text 模式，光标定位到新行首格
  enterTextMode(newTr.cells[0])
}
```

#### `ElementFloatPanel.vue`

- 在 `selectedEl.tagName === "TR"` 时，面板底部新增"🗑 删除行"按钮
- 点击后 `emit("delete-row", selectedEl)` 由 `PrdSectionItem` 处理

#### `SectionEditBar.vue`（可选）

- 不需要改动，删除行后调用已有 `handleSaveContent` 流程即可

### 3.2 CSS 改动（`PrdSectionItem.vue` scoped）

```scss
// 编辑模式下 tbody tr 相对定位，允许 + 钮绝对定位
.prd-section-body.select-cursor {
  :deep(tbody tr) {
    position: relative;
  }
}

// 追加行按钮
.append-row-btn { ... }
```

### 3.3 Tab 键跳格

在 `enterTextMode` 内，新行激活时给 `.prd-section-body` 绑定一次性 `keydown` 监听：

```typescript
function bindTabNavigation(tr: HTMLTableRowElement) {
  function onTab(e: KeyboardEvent) {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const cells = Array.from(tr.cells)
    const active = document.activeElement
    const idx = cells.findIndex(td => td === active || td.contains(active as Node))
    const next = e.shiftKey ? cells[idx - 1] : cells[idx + 1]
    if (next) {
      (next as HTMLElement).focus()
    } else if (!e.shiftKey) {
      // 最后一格按 Tab → 退出文字模式
      leaveTextMode()
    }
  }
  contentRef.value?.addEventListener('keydown', onTab, { once: false })
  // 离开 text 模式时移除
  watchOnce(() => editSubMode.value, () => {
    contentRef.value?.removeEventListener('keydown', onTab)
  })
}
```

---

## 四、交互边界处理

| 场景 | 处理方式 |
|---|---|
| `thead` 行 hover | 不显示 `+` 钮（判断 `tr` 的父元素是否为 `thead`） |
| 插入后未输入即切走 | 保留空行（下次保存时写入 DB），不自动删除 |
| 表格只有一行（thead+1行）时删除 | 提示"至少保留一行数据"，取消删除 |
| 多表结构（功能清单）| 每张表独立管理，与 `tableIndex` 逻辑兼容 |
| AI 生成中 | `isAiEditing` 为 true 时隐藏所有 `+` 钮和删除按钮 |

---

## 五、不在本次范围内

- 新增列（列操作复杂度远高于行操作，独立规划）
- 行拖拽排序
- 单元格合并 / 拆分
- 撤销（Undo）新增行操作

---

## 六、文件变更清单

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `frontend/src/views/session/components/PrdSectionItem.vue` | 修改 | 主要逻辑：新增行、删除行、Tab 导航、hover 状态 |
| `frontend/src/components/ElementFloatPanel.vue` | 修改 | TR 选中时新增"删除行"按钮 |
| `frontend/src/styles/prd-content.scss` | 修改 | `prd-tr-new` 样式（可选，高亮新行） |
| `backend/src/services/prd/renderer.ts` | 不变 | 不涉及 AI 生成逻辑 |
| `backend/src/routes/sessions.ts` | 不变 | 通过现有 `PUT /content` 保存即可 |
