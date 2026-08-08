---
name: skill-prd-infoarch
description: 根据产品功能描述生成信息架构思维导图（markmap.js），用于 PRD 文档的信息架构模块。当用户提到要画信息架构图、功能脑图、导航结构、产品地图、思维导图，或 PRD 中需要信息架构时，立即使用此 skill。即使用户只说"帮我整理下功能结构"、"画个思维导图"也应触发。
---

# 信息架构思维导图生成指南

根据用户描述的产品功能与导航层级，生成一份结构清晰、层级完整、可直接嵌入 PRD HTML 的 markmap.js 思维导图。

---

## 工作流程

1. **梳理功能层级**：从用户描述中提取产品的顶级模块 → 子模块 → 功能点三层结构。
2. **识别导航关系**：区分哪些是主导航、哪些是子页面、哪些是操作功能。
3. **信息不足时反问**：如果一级模块不清晰，向用户确认核心功能板块，不要自行补全。
4. **生成 Markdown 树**：严格按照下方层级缩进规范输出 markmap 所需的 Markdown 结构。
5. **附层级说明**：在思维导图后简要说明各模块职责。

---

## 层级规范

| 层级          | 含义                  | 示例           |
| ------------- | --------------------- | -------------- |
| `#`（一级）   | 产品名称（根节点）    | `# 电商平台`   |
| `##`（二级）  | 顶级功能模块 / 主导航 | `## 商品管理`  |
| `###`（三级） | 子功能模块 / 子页面   | `### 商品列表` |
| `-`（四级）   | 具体功能点 / 操作项   | `- 搜索筛选`   |

三级以内的结构是重点，四级仅用于补充细节，不必穷举。

---

## 输出模板

Markdown 树（供 markmap 渲染）：

```markdown
# 产品名称

## 模块A

### 子模块A1

- 功能点1
- 功能点2

### 子模块A2

- 功能点3

## 模块B

### 子模块B1

- 功能点4
- 功能点5

## 模块C

- 功能点6
- 功能点7
```

---

## 嵌入 PRD HTML 的写法

使用 D3 + markmap-lib + markmap-view 三个 CDN，将 Markdown 存入隐藏 `<script type="application/json">` 标签，由 JS 手动初始化并调用 `fit()` 居中：

```html
<!-- Markdown 数据（隐藏存储，由 JS 读取） -->
<script type="application/json" id="markmap-data">
	"# 产品名称\n\n## 模块A\n### 子模块A1\n- 功能点1\n- 功能点2\n\n## 模块B\n- 功能点3"
</script>
<!-- SVG 渲染容器 -->
<div class="markmap-wrap">
	<svg id="markmap-svg" style="width:100%;height:560px;display:block;"></svg>
</div>

<!-- CDN：D3 必须在 markmap-view 之前加载 -->
<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/markmap-lib/dist/browser/index.js"></script>
<script src="https://cdn.jsdelivr.net/npm/markmap-view/dist/browser/index.js"></script>
<script>
	var md = JSON.parse(document.getElementById("markmap-data").textContent);
	var transformer = new window.markmap.Transformer();
	var root = transformer.transform(md).root;
	var mm = window.markmap.Markmap.create("#markmap-svg", null, root);
	requestAnimationFrame(function () {
		mm.fit();
	});
</script>
```

---

## 生成规则（必须遵守）

- **根节点唯一**：`#` 只出现一次，值为产品或系统名称。
- **层级清晰**：`##` 代表一级导航，`###` 代表二级页面，`-` 代表功能动作；不要跳级。
- **精简原则**：每个层级节点的文字不超过 10 个字，描述功能动词+名词即可。
- **覆盖完整**：所有主要功能模块必须体现，宁可少一些细节，不要遗漏主模块。
- **不要加标点**：节点文字结尾不加句号、逗号等标点。
