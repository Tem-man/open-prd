# Plan：产品架构图 & 业务流程图 Mermaid 源码编辑

## 目标

为 `graph TB`（产品架构）和 `flowchart TD`（业务流程）两类 Mermaid 图表，实现与数据模型（ER 图）相同风格的分段源码编辑功能。

---

## 与 ER 图的差异分析

| 维度 | ER 图（已实现） | 架构图 / 流程图（待实现） |
|---|---|---|
| 图表语法 | `erDiagram` | `graph TB` / `flowchart TD` |
| 结构单元 | 实体块（`ENTITY {...}`）+ 关系行 | 子图（`subgraph ... end`）+ 节点/连线 |
| SVG 实体结构 | `<g id="entity-*">` | `<g class="cluster">` 子图容器 |
| 高亮目标 | entityGroup（实体组） | cluster（子图组） |
| 分段策略 | entity / relation / diagram | subgraph / diagram |

---

## 分段编辑策略

### 两种 Zone

| Zone | 触发条件 | 编辑器显示内容 | 回写逻辑 |
|---|---|---|---|
| `subgraph` | 点击 SVG `<g class="cluster">` 区域 | 对应的 `subgraph ... end` 块 | 正则替换同名子图块 |
| `diagram` | 点击节点 / 连线 / 空白区 | 完整 Mermaid 源码 | 整体替换 |

### 浮层按钮（任意 Mermaid 区域点击后均显示）

| 按钮 | 说明 |
|---|---|
| ✎ 编辑分组 | 仅 zone = subgraph 时高亮激活 |
| ✎ 编辑完整图表 | 仅 zone = diagram 时高亮激活 |

---

## 技术可行性分析

### 子图 SVG 结构（Mermaid v10）

```html
<!-- subgraph 渲染为 <g class="cluster"> -->
<g class="cluster" id="subGraph0">
  <rect class="cluster-bg" />
  <text class="cluster-label">用户层</text>
  <!-- 内部节点 <g class="node"> -->
</g>
```

检测方式：`clickedEl.closest('g.cluster')` 即可命中子图容器。

### 子图名称提取

Mermaid 为每个 `subgraph` 生成 `id`，格式：`subGraph0`, `subGraph1`... 或直接用 label text。  
方案：从命中的 `<g class="cluster">` 中读取 `<text class="cluster-label">` 的文字内容，匹配源码中的 `subgraph "xxx"` 或 `subgraph xxx` 行。

### 子图源码提取 / 回写

源码片段形如：
```
subgraph 用户层
    PC[PC端]
    MOBILE[移动端]
end
```

正则提取：
```typescript
/^[ \t]*subgraph[ \t]+(?:"([^"]+)"|(\S+))[ \t]*\n[\s\S]*?\nend/m
```

回写：同名子图块原位替换。

---

## 实现步骤

### Step 1：扩展 `mermaidErUtils.ts`

新增纯函数：

```typescript
/** 从 Mermaid 源码中提取指定 label 的 subgraph 块 */
export function extractSubgraphBlock(source: string, label: string): string

/** 将编辑后的 subgraph 块回写到完整源码 */
export function replaceSubgraphBlock(source: string, label: string, newBlock: string): string

/** 从 <g class="cluster"> 元素中提取子图 label */
export function getClusterLabel(g: Element): string

/** 判断点击元素是否命中 SVG subgraph cluster */
export function isMermaidClusterEl(el: Element): Element | null  // 返回命中的 cluster g 元素
```

同时扩展 `MermaidErZone` 类型：
```typescript
export type MermaidErZone = "entity" | "relation" | "diagram" | "subgraph";
```

新增 `zoneHintText` 分支：
```typescript
if (zone === "subgraph" && subgraphLabel) return `编辑分组：${subgraphLabel}`;
```

### Step 2：`PrdSectionItem.vue` — 扩展 state

```typescript
/** 当前命中的 subgraph label（用于分段提取） */
const selectedSubgraphLabel = ref<string>("");
```

`clearHighlight` 里同步清空 `selectedSubgraphLabel`。

### Step 3：`PrdSectionItem.vue` — 更新 `onContentClick`

在 Mermaid 分支中，entityGroup 检测前先检测 cluster：

```typescript
// ── 区域：子图（graph TB / flowchart TD 的 subgraph）──
const clusterEl = isMermaidClusterEl(clickedEl);
if (clusterEl) {
  const label = getClusterLabel(clusterEl);
  highlightSvgCluster(clusterEl);
  selectedMermaidZone.value = "subgraph";
  selectedSubgraphLabel.value = label;
  selectedMermaidDiv.value = mermaidDiv;
  selectedEl.value = mermaidDiv;
  return;
}
```

ER 图的 entityGroup 检测逻辑不变（`erDiagram` 图没有 cluster）。

新增 `highlightSvgCluster(g: Element)` 函数：
与 `highlightSvgEntity` 类似，对 cluster 内所有 rect 施加描边 + 填充高亮。

### Step 4：`PrdSectionItem.vue` — 更新 `handleMermaidEditSource`

扩展 `mermaidEditorState` 增加 `subgraphLabel?: string`。

```typescript
const effectiveZone = ...;
// 新增 subgraph 分支
if (effectiveZone === "subgraph" && subgraphLabel) {
  editSource = extractSubgraphBlock(fullSource, subgraphLabel);
}
```

`saveMermaidSource` 回写：
```typescript
if (zone === "subgraph" && subgraphLabel) {
  newFullSource = replaceSubgraphBlock(originalSource, subgraphLabel, editedText);
}
```

### Step 5：`ElementFloatPanel.vue` — 更新按钮

将 Mermaid 三按钮（编辑实体、编辑连线、编辑所有实体）调整为根据图表类型显示不同按钮，通过新增 `mermaidType` prop 区分：

| mermaidType | 显示按钮组 |
|---|---|
| `er` | ✎ 编辑实体 · ✎ 编辑连线 · ✎ 编辑所有实体 |
| `graph` / `flowchart` | ✎ 编辑分组 · ✎ 编辑完整图表 |

`mermaidType` 从 `.mermaid` div 的文本内容第一行关键词判断：
```typescript
const firstLine = mermaidDiv.textContent?.trim().split('\n')[0] ?? '';
// 含 erDiagram → 'er'；含 graph 或 flowchart → 'graph'
```

或直接在 `selectedMermaidDiv` 设置时同步计算一个 `selectedMermaidType` ref。

---

## 文件改动清单

| 文件 | 改动 |
|---|---|
| `frontend/src/utils/mermaidErUtils.ts` | 新增 subgraph 相关工具函数，扩展 `MermaidErZone` |
| `frontend/src/views/session/components/PrdSectionItem.vue` | 新增 `selectedSubgraphLabel`、`highlightSvgCluster`、更新 `onContentClick` / `handleMermaidEditSource` / `saveMermaidSource` |
| `frontend/src/components/ElementFloatPanel.vue` | 新增 `mermaidType` prop，按图表类型切换按钮组 |

---

## 边界处理

| 场景 | 处理方式 |
|---|---|
| 嵌套 subgraph（架构图 `核心业务` 在 `业务服务层` 内） | `closest('g.cluster')` 命中最内层，编辑最内层 subgraph |
| subgraph label 含中文或特殊字符 | 提取前 `escapeRegExp` 处理，正则 group 用 `(?:"label"\|label)` 兼容带引号/不带引号两种写法 |
| 语法错误保存 | 已有 `fallbackSource` 机制，渲染失败自动回滚 |
| 点击 `graph TB` / `flowchart TD` 的连线 | 无 entityGroup / cluster 命中 → 退化为 `diagram` 整图编辑 |

---

## 工作量估算

| 任务 | 预计时间 |
|---|---|
| Step 1 mermaidErUtils 扩展 | 1h |
| Step 2–3 点击检测 + cluster 高亮 | 1h |
| Step 4 编辑器分段逻辑 | 0.5h |
| Step 5 ElementFloatPanel 按钮分组 | 0.5h |
| 测试 + 边界修复 | 1h |
| **合计** | **4h** |
