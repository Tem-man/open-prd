# Plan：Mermaid ER 分段编辑（实体 / 连线 / 整图）

## 目标

点击 Mermaid ER 图的不同区域，进入「编辑实体」模式时只呈现该区域对应的源码片段，编辑后精确回写，不影响其余部分。

| 点击区域 | 编辑器显示 | 回写逻辑 |
|---|---|---|
| 某张实体表（entityGroup） | 仅该实体块，如 `USER { ... }` | 替换全源码中同名实体块 |
| 关系连线 / 标签 | 仅全部关系行（`||--|{` 行） | 替换全源码中所有关系行 |
| `.mermaid` div 空白区域 | 完整 Mermaid 源码 | 整体替换 |

---

## 技术可行性分析

### 现有基础
- `selectedEntityName`：已能区分"点到实体 entityGroup"还是"其他"
- `selectedMermaidDiv`：指向当前操作的 `.mermaid` div
- `getMermaidSourceByDiv()`：已可提取完整源码
- `applyMermaidSourceToStoredHtml()`：已支持将新源码回写到 `props.html`
- `applyMermaidSource()`：已支持整体重渲染 + fallback

### 新增需求
1. **连线点击检测**：Mermaid ER 连线渲染为 `<path class="er relationshipLine">` 或 `<line>`，需在 `onContentClick` 里加一条判断：若点击元素为这类路径（且未命中 entityGroup），则标记 `selectedRelationType = 'relation'`。
2. **源码分段提取**：
   - 实体块：`/^ENTITY_NAME\s*\{[^}]*\}/ms` 正则匹配
   - 关系行：源码按行过滤，含 `||` 的行即为关系行
   - 整图：直接返回原始完整源码
3. **分段回写**：
   - 实体块：正则替换同名实体块
   - 关系行：用编辑后的关系行替换原源码中所有关系行（非实体块行）
   - 整图：整体替换（已实现）

### SVG 连线特征（Mermaid v10）

```
<g class="er">
  <!-- 实体 -->
  <g id="entity-USER" class="er entityGroup"> ... </g>

  <!-- 关系 -->
  <path class="er relationshipLine" .../>
  <text class="er relationshipLabel"> ... </text>
</g>
```

---

## 实现步骤

### Step 1：新增选区类型状态

在 `PrdSectionItem.vue` 的 script 区增加：

```ts
/** 选区类型：entity = 点到实体，relation = 点到连线，diagram = 点到整图空白 */
const selectedMermaidZone = ref<'entity' | 'relation' | 'diagram' | ''>('');
```

### Step 2：更新 `onContentClick` 的 Mermaid 分支

在现有逻辑中，当 `clickedEl` 在 `.mermaid` 内且**未命中 entityGroup** 时，进一步判断：

```ts
// 判断是否点到连线
const isRelationLine =
  clickedEl.closest('path.er, line.er, text.er') !== null ||
  /relation/i.test((clickedEl as SVGElement).className?.baseVal ?? '');

if (isRelationLine) {
  selectedMermaidZone.value = 'relation';
  selectedEntityName.value = '';
  selectedMermaidDiv.value = mermaidDiv;
  selectedEl.value = mermaidDiv;          // 浮层锚点用整个 div
  highlightEl(mermaidDiv);
} else {
  // 点到空白：整图编辑
  selectedMermaidZone.value = 'diagram';
  selectedEntityName.value = '';
  selectedMermaidDiv.value = mermaidDiv;
  selectedEl.value = mermaidDiv;
  highlightEl(mermaidDiv);
}
```

当命中 entityGroup 时，补充：

```ts
selectedMermaidZone.value = 'entity';
```

### Step 3：源码分段提取工具函数

```ts
/** 从完整 Mermaid ER 源码中提取指定实体块 */
function extractEntityBlock(source: string, entityName: string): string {
  const m = source.match(new RegExp(`^[ \\t]*${entityName}\\s*\\{[^}]*\\}`, 'ms'));
  return m ? m[0].trim() : '';
}

/** 从完整 Mermaid ER 源码中提取所有关系行 */
function extractRelationLines(source: string): string {
  return source
    .split('\n')
    .filter(l => /\|\|/.test(l))
    .join('\n');
}

/** 将编辑后的实体块回写到完整源码 */
function replaceEntityBlock(source: string, entityName: string, newBlock: string): string {
  return source.replace(
    new RegExp(`(^[ \\t]*)${entityName}\\s*\\{[^}]*\\}`, 'ms'),
    newBlock,
  );
}

/** 将编辑后的关系行回写到完整源码 */
function replaceRelationLines(source: string, newRelations: string): string {
  const lines = source.split('\n');
  const nonRelationLines = lines.filter(l => !/\|\|/.test(l));
  // 把新关系行插入到首个实体块之前
  const firstEntityIdx = nonRelationLines.findIndex(l => /^\s*\w+\s*\{/.test(l));
  const insertAt = firstEntityIdx >= 0 ? firstEntityIdx : nonRelationLines.length;
  nonRelationLines.splice(insertAt, 0, ...newRelations.split('\n'));
  return nonRelationLines.join('\n');
}
```

### Step 4：更新 `handleMermaidEditSource`

根据 `selectedMermaidZone` 决定编辑器内容：

```ts
function handleMermaidEditSource() {
  const zone = selectedMermaidZone.value;
  const mermaidDiv = selectedMermaidDiv.value;
  const fullSource = getMermaidSourceByDiv(mermaidDiv);

  let editSource = fullSource;
  if (zone === 'entity' && selectedEntityName.value) {
    editSource = extractEntityBlock(fullSource, selectedEntityName.value);
  } else if (zone === 'relation') {
    editSource = extractRelationLines(fullSource);
  }
  // zone === 'diagram'：保持 fullSource

  // 其余逻辑不变（创建 textarea、绑定快捷键等）
  // 保存时需传入 zone 和 entityName，以便回写
}
```

### Step 5：更新 `saveMermaidSource`

```ts
async function saveMermaidSource() {
  const { div, textarea, originalSource, idx, zone, entityName } = state;
  const editedText = textarea.value.trim();
  let newFullSource: string;

  if (zone === 'entity' && entityName) {
    newFullSource = replaceEntityBlock(originalSource, entityName, editedText);
  } else if (zone === 'relation') {
    newFullSource = replaceRelationLines(originalSource, editedText);
  } else {
    newFullSource = editedText;   // 整图模式，直接替换
  }

  const newHtml = applyMermaidSourceToStoredHtml(idx, newFullSource);
  const resultDiv = await applyMermaidSource(div, newFullSource, originalSource);
  if (resultDiv?.getAttribute('data-processed')) {
    editBarRef.value?.handleSaveContent(() => newHtml);
  }
}
```

### Step 6：`ElementFloatPanel` 显示调整

- 点到连线 / 整图空白时，`entityName` 为空 → 原有「编辑实体」按钮不出现
- 需让浮层在连线 / 整图两种情况也能出现「编辑实体」按钮

方案：将 `entityName` 改为更宽泛的 `mermaidZone` prop 传给 `ElementFloatPanel`，或增加一个 `isMermaid` boolean prop，只要 `isMermaid === true` 就显示「编辑实体」按钮。

---

## 编辑器 UI 差异

| zone | 编辑器标题提示 |
|---|---|
| entity | `编辑实体：USER（Ctrl+Enter 保存）` |
| relation | `编辑关系连线（Ctrl+Enter 保存）` |
| diagram | `编辑完整 ER 图源码（Ctrl+Enter 保存）` |

可在 `.mermaid-source-toolbar` 左侧加一个 `<span>` 显示上述提示，让用户清楚当前编辑范围。

---

## 风险与边界

| 风险 | 处理 |
|---|---|
| 实体名含特殊字符 | `escapeRegExp` 转义 |
| 关系行中包含 `||` 注释 | Mermaid ER 语法不支持 `||` 出现在注释里，可忽略 |
| 编辑后语法错误 | 已有 `fallbackSource` 机制，渲染失败自动回滚 |
| 关系行回写插入位置偏差 | 单元测试覆盖边界：纯关系图（无实体块）、纯实体图（无关系行） |

---

## 工作量估算

| 任务 | 预计时间 |
|---|---|
| Step 1–2 点击区域识别 | 1h |
| Step 3 分段提取/回写函数 | 1h |
| Step 4–5 编辑器逻辑更新 | 1h |
| Step 6 UI 调整 + 提示文字 | 0.5h |
| 手动测试 + 边界修复 | 1h |
| **合计** | **4.5h** |
