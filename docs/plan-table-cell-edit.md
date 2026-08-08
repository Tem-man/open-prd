# 方案：表格元素（table / tr / th / td）细粒度 AI 编辑

## 背景

当前点击表格内任意 `td/tr/th` 时，选中目标会上浮到整张 `table`，AI 指令对象固定是整表。
本方案支持 **table → tr → td/th** 三级独立可选，每一级均可发送 AI 编辑指令。

---

## 一、交互设计

### 两级渐进选择模型

```
第一次单击表格内任意位置
  └─ 选中整张 table
        ↓  再次单击某一 tr / td / th
        └─ 选中该行或该单元格（缩小粒度）
             ↓  再次单击同一 td/th 中的更小元素（预留，暂不实现）
             ↓  单击 table 以外区域
             └─ 清除全部选中
```

- **第一级**：单击 → 选整张 `table`，浮层标签「表格」，提示「再次单击行/单元格可缩小范围」。
- **第二级**：整表已选中时，再次单击其内部 `tr` / `td` / `th`，选中对应行或单元格。
- **清除**：点击表格以外的元素或按 `ESC`，退回第一级或完全退出编辑。
- **直接跳级**：若已在第二级选中某 `tr`，再次单击该行内的 `td/th` → 直接进入第二级单元格选中（不需要先退回第一级）。

### 视觉反馈

| 状态                                | 样式                                             |
| ----------------------------------- | ------------------------------------------------ |
| 选择模式，鼠标悬停 `table`          | 虚线 `outline`（现有）                           |
| 整表被选中（第一级）                | 实线靛蓝 `outline`（现有）                       |
| 整表已选中，鼠标悬停内部 `tr`       | 行级虚线 `outline`                               |
| 整表已选中，鼠标悬停内部 `td/th`    | 单元格级更细虚线 `outline`（优先于行级）         |
| `tr` / `td` / `th` 被选中（第二级） | 实线靛蓝 `outline`（与整表一致，但框住更小范围） |

---

## 二、前端改动

### 2.1 `PrdSectionItem.vue` — 选中逻辑

**移除现有上浮逻辑**（`TABLE_CELL_TAGS` 整段删除）：

```ts
// 删除：点到 td/tr/th 时上浮到整张 table
const TABLE_CELL_TAGS = new Set(["TD", "TR", "TH"]);   // ← 删除
if (TABLE_CELL_TAGS.has(target.tagName)) { ... }       // ← 删除
```

**新增两级表格选择逻辑**：

```ts
// 新增：记录当前第一级选中的 table，用于判断是否进入第二级
const selectedTable = ref<HTMLElement | null>(null);

// onContentClick 中，替换原 TABLE_CELL_TAGS 块：
const TABLE_TAGS = new Set(["TABLE", "TR", "TD", "TH"]);

if (TABLE_TAGS.has(target.tagName)) {
	const parentTable = target.closest("table") as HTMLElement | null;
	if (!parentTable || !contentRef.value!.contains(parentTable)) {
		clearHighlight();
		selectedEl.value = null;
		selectedTable.value = null;
		return;
	}

	if (target.tagName === "TABLE") {
		// 直接点到 table 边框/空白区域
		selectedTable.value = parentTable;
		highlightEl(parentTable);
		selectedEl.value = parentTable;
		return;
	}

	// 第二级：已选中这张 table，或已选中这张表内某行，再次点击缩小粒度
	if (selectedTable.value === parentTable) {
		selectedTable.value = null; // 进入第二级后不再需要 selectedTable 标记
		highlightEl(target); // target 此时是 tr / td / th
		selectedEl.value = target;
		return;
	}

	// 第一级：尚未选中任何表，选整表
	selectedTable.value = parentTable;
	highlightEl(parentTable);
	selectedEl.value = parentTable;
	return;
}

// 点击非表格元素时清除表格选中状态
selectedTable.value = null;
```

在 `clearHighlight()` 和 `cancelEdit()` 中同步重置 `selectedTable.value = null`。

**`BLOCK_SELECTORS` 调整**：将 `"tr"`, `"td"`, `"th"` 从选择器列表中移除（它们不再通过 `closest(BLOCK_SELECTORS)` 命中，改由上方 TABLE_TAGS 逻辑单独处理），避免 `closest` 优先选到 `td` 而跳过 `table` 第一级。

### 2.2 `PrdSectionItem.vue` — CSS hover 补丁

```scss
// 整表被选中时，tr/td/th 悬停给出细粒度提示
:deep(table.el-selected) {
	tr:hover {
		outline: 1.5px dashed #a5b4fc;
		outline-offset: -1px;
		cursor: pointer;
	}
	// td/th 优先级更高，覆盖行级 hover
	td:hover,
	th:hover {
		outline: 1px dashed #818cf8;
		outline-offset: -1px;
		cursor: pointer;
	}
}

// tr 被选中时，其内部 td/th 悬停提示（允许继续缩小）
:deep(tr.el-selected) {
	td:hover,
	th:hover {
		outline: 1px dashed #818cf8;
		outline-offset: -1px;
		cursor: pointer;
	}
}
```

### 2.3 `ElementFloatPanel.vue` — 标签与 placeholder

`TAG_LABELS` 已有 `TD / TH / TR`，无需改动。

新增 `inputPlaceholder` computed，感知当前选中粒度：

```ts
const inputPlaceholder = computed(() => {
	if (props.entityName) return `告诉 AI 如何修改 ${props.entityName} 实体…`;
	const tag = props.selectedEl?.tagName;
	if (tag === "TABLE")
		return "告诉 AI 如何修改整张表格…（再次单击行/单元格可缩小范围）";
	if (tag === "TR") return "告诉 AI 如何修改选中行…";
	if (tag === "TD" || tag === "TH") return "告诉 AI 如何修改选中单元格…";
	return "告诉 AI 如何修改选中元素…";
});
```

将模板中原有 hardcode 的 placeholder 字符串替换为 `inputPlaceholder`。

### 2.4 `ElementFloatPanel.vue` — 提交时附带坐标

提交 `tr / td / th` 时，计算 DOM 坐标上报给后端，提升精确定位能力：

```ts
type TableElementPath =
	| { kind: "row"; rowIndex: number }
	| { kind: "cell"; rowIndex: number; cellIndex: number };

function getTablePath(el: HTMLElement): TableElementPath | null {
	const table = el.closest("table") as HTMLTableElement | null;
	if (!table) return null;
	const row = el.closest("tr") as HTMLTableRowElement | null;
	if (!row) return null;
	const rowIndex = Array.from(table.rows).indexOf(row);

	if (el.tagName === "TR") {
		return { kind: "row", rowIndex };
	}
	// td / th
	const cellIndex = Array.from(row.cells).indexOf(el as HTMLTableCellElement);
	return { kind: "cell", rowIndex, cellIndex };
}
```

在 `handleSubmit` 中，发送普通 Element Patch 时附带 `tablePath`：

```ts
await editSection(
	props.sessionId,
	props.sectionId,
	text,
	props.selectedEl.outerHTML,
	undefined, // entityName
	getTablePath(props.selectedEl) ?? undefined,
);
```

---

## 三、后端改动

### 3.1 `useSSE.ts` — `editSection` 新增 `tablePath` 参数

```ts
async function editSection(
	sessionId: string,
	sectionId: string,
	instruction: string,
	selectedElementHtml?: string,
	entityName?: string,
	tablePath?:
		| { kind: "row"; rowIndex: number }
		| { kind: "cell"; rowIndex: number; cellIndex: number },
): Promise<void>;
```

请求体新增 `tablePath` 字段一并发送。

### 3.2 `sessions.ts` — 表格元素编辑的 LLM 上下文升级

#### 问题：当前 Element Patch prompt 缺少表格结构上下文

现有 Element Patch 模式只把 `selectedElementHtml`（单个 `td` 的 outerHTML）传给 LLM：

```
<target_element>
<td>张三</td>
</target_element>

修改指令：{instruction}
```

当选中目标为 `tr / td / th` 时，LLM 缺少以下关键信息：

| 缺失信息                             | 影响                                                    |
| ------------------------------------ | ------------------------------------------------------- |
| 整张表格结构（表头、列定义、其他行） | 不知道该列叫什么，容易生成与上下文不一致的内容          |
| 所在行的其他单元格                   | 修改某格可能与同行数据语义冲突                          |
| 模块标题（section title）            | 不知道这张表属于「功能清单」还是「数据模型」            |
| 产品对话摘要                         | Element Patch 没有传最近对话，Section Rewrite 有传 6 条 |

#### 改进：当选中元素为表格内部元素时，升级 User Prompt

在 `isElementPatch` 分支中，判断 `tablePath` 存在时，从 `current.html_content` 里提取整张表的 HTML 作为额外上下文：

```ts
// 从 section HTML 中提取包含目标元素的 table outerHTML
function extractParentTableHtml(sectionHtml: string): string | null {
	const root = parseHtml(sectionHtml);
	const table = root.querySelector("table");
	return table ? table.outerHTML : null;
}
```

**升级后的 User Prompt（仅 tr/td/th 时使用）**：

```ts
const parentTableHtml = extractParentTableHtml(current.html_content);

const elementUserPrompt =
	tablePath && parentTableHtml
		? `以下是 PRD「${current.title}」模块中的一张表格：
<parent_table>
${parentTableHtml}
</parent_table>

用户选中了其中这个元素：
<target_element>
${selectedElementHtml}
</target_element>

修改指令：${instruction}

请只输出修改后的 <target_element> 内容（保持原标签类型 td/th/tr），不要输出整张表格：`
		: `以下是需要修改的 HTML 元素：
<target_element>
${selectedElementHtml}
</target_element>

修改指令：${instruction}

请只输出修改后的 HTML 元素：`;
```

这样 LLM 能看到完整表头和列结构，生成的内容与整表语义保持一致，同时输出仍然只是修改后的单个元素，不影响后续 `patchTableElementByPath` 的定位逻辑。

---

### 3.3 `sessions.ts` — 新增坐标定位策略（策略 0）

#### `patchTableElementByPath`

```ts
/**
 * 按 DOM 坐标精确替换 table 中的 tr / td / th。
 * 在 patchElementInHtml 三层策略之前调用；失败返回 null，调用方降级。
 */
function patchTableElementByPath(
	sectionHtml: string,
	path:
		| { kind: "row"; rowIndex: number }
		| { kind: "cell"; rowIndex: number; cellIndex: number },
	newElementHtml: string,
): string | null {
	const root = parseHtml(sectionHtml);
	// 暂取第一张 table（section 含多张表时后续迭代再传 tableIndex）
	const table = root.querySelector("table");
	if (!table) return null;

	const rows = table.querySelectorAll("tr");
	const row = rows[path.rowIndex];
	if (!row) return null;

	if (path.kind === "row") {
		row.replaceWith(parseHtml(newElementHtml).firstChild!);
		return root.toString();
	}

	// kind === "cell"
	const cells = row.querySelectorAll("td, th");
	const cell = cells[path.cellIndex];
	if (!cell) return null;
	cell.replaceWith(parseHtml(newElementHtml).firstChild!);
	return root.toString();
}
```

#### Element Patch 分支修改

```ts
// 解析请求体新增字段
const tablePath = req.body?.tablePath as
	| { kind: "row"; rowIndex: number }
	| { kind: "cell"; rowIndex: number; cellIndex: number }
	| undefined;

// ... isElementPatch 分支内，patchElementInHtml 调用前：
let patchedSectionHtml: string | null = null;

// 策略 0：坐标定位（tr / td / th 专用）
if (tablePath) {
	patchedSectionHtml = patchTableElementByPath(
		current.html_content,
		tablePath,
		newElementHtml,
	);
}

// 策略 1-3：原有三层降级
if (!patchedSectionHtml) {
	patchedSectionHtml = patchElementInHtml(
		current.html_content,
		selectedElementHtml,
		newElementHtml,
	);
}

// 最终降级：保留原内容（后续可改为整模块重写）
if (!patchedSectionHtml) {
	patchedSectionHtml = current.html_content;
}
```

---

## 四、改动文件清单

| 文件                                                       | 改动性质                                                                                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `frontend/src/views/session/components/PrdSectionItem.vue` | 两级选中逻辑（支持 table/tr/td/th）；BLOCK_SELECTORS 调整；CSS hover                                                    |
| `frontend/src/components/ElementFloatPanel.vue`            | `inputPlaceholder` 感知粒度；提交时附带 `tablePath`                                                                     |
| `frontend/src/composables/useSSE.ts`                       | `editSection` 增加 `tablePath` 可选参数                                                                                 |
| `backend/src/routes/sessions.ts`                           | 新增 `patchTableElementByPath`、`extractParentTableHtml`；Element Patch 分支接收 `tablePath`，升级表格元素的 LLM Prompt |

---

## 五、边界情况

| 情况                                   | 处理                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| 直接单击 `table` 边框/标题行以外空白   | `target.tagName === "TABLE"` 直接进第一级                                            |
| 已选 `tr`，再点击该行内 `td/th`        | `selectedTable.value === parentTable` 为 true，直接进入第二级，选中 `td/th`          |
| 已选 `td/th`，再点击同行另一个 `td/th` | 重新进入第一级（选整表），再单击即可选新单元格                                       |
| 表格含 `colspan/rowspan` 合并单元格    | `rowIndex` 按 `table.rows` DOM 索引，`cellIndex` 按 `row.cells` DOM 索引，与合并无关 |
| 一个 section 含多张表                  | `patchTableElementByPath` 暂取第一张；多表时后续迭代新增 `tableIndex` 字段           |
| `patchTableElementByPath` 失败         | 自动降级到 `patchElementInHtml` 三层策略，最终降级到保留原内容                       |
| ESC 键处理                             | 第二级按 ESC → 退回第一级（重选整表）；第一级按 ESC → 退出编辑模式                   |
