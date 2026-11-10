# 方案：导出弹窗新增 Word（.docx）格式

## 背景

当前 `ExportModal`（`frontend/src/components/ExportModal/ExportModal.vue`）支持三种导出格式：HTML 网页、Markdown、PDF。用户需要在 Word 中编辑、批注、走评审流程，因此需要新增「Word 文档（.docx）」导出。

PRD 内容的特殊性：包含 Mermaid 图（产品架构、业务流程、数据模型）、markmap 思维导图（信息架构）以及部分自定义模块图表（echarts 等）。这些图表在前端以 **SVG** 形式渲染，导出时必须先转为位图（PNG）才能在 Word 中正常显示——这是本方案的核心难题，而 .docx 封装本身反而是次要问题。

---

## 一、技术选型

### 对比

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| A. 前端程序化生成（`docx` 包） | 把 HTML 解析成结构化模型再逐节点生成 docx | ❌ 工作量大：标题/表格/图片都要手写映射，且 PRD 是自由 HTML 结构，解析极易丢样式 |
| B. 前端 altChunk 方案（`html-docx-js-typescript`） | 把清洗后的 Word 兼容 HTML 打包为 docx（内部走 altChunk），浏览器侧直接生成 Blob | ✅ 选此方案：纯前端、保留 HTML 原有表格与内联样式、依赖小 |
| C. 后端转换（`html-to-docx` / pandoc） | 新增后端端点转换 `prds.html` | ❌ 后端存的是**源码级** PRD HTML（图表处是 mermaid 源文本，不是渲染后的 SVG），Node 侧无法渲染图表成图片，需引入 headless 浏览器，过重 |
| D. 伪 .doc（MS Word HTML，`application/msword`） | 无任何依赖，HTML 直接改扩展名 | ⚠️ 不作为主方案；若封装库图片兼容性差时可作兜底（图表转 PNG 的核心工作两个方案共用） |

### 依赖

```bash
pnpm --filter frontend add html-docx-js-typescript
```

> 仅前端业务包依赖，遵循 pnpm only 约束；无 CDN / HTTPS 外链（构建期内联）。

---

## 二、交互设计

弹窗在现有 3 项之后新增第 4 项「Word 文档」（单选，互斥，与 PDF 项之间加分隔或直接排第四）：

```
┌──────────────────────────────────────────────┐
│  导出 PRD                                 ×  │
│  选择导出格式，将 PRD 下载到本地：              │
│                                              │
│  (•) HTML 网页 / ( ) Markdown / ( ) PDF       │
│                                              │
│  ( ) Word 文档                               │
│      在 Word 中编辑与批注的 .docx 文档        │
└──────────────────────────────────────────────┘
```

- 图标：Lucide **无** `file-word`（已确认 `@iconify-json/lucide` 里没有），采用
  `<icon-lucide-file-type />`，色值用 Office Word 绿 `#2E7B34`（或品牌蓝 `#185ABD`，实现时二选一）
- `exportFormat` 类型从 `"html" | "markdown" | "pdf"` 扩为 `"html" | "markdown" | "pdf" | "docx"`
- 已有三种格式的行为全部不动

---

## 三、核心实现：`docxExport.ts`

新文件 `frontend/src/utils/docxExport.ts`，从 `ExportModal.vue` 调用，整体流程：

```
sections（权威数据） → 离屏渲染图表 → SVG 转 PNG → HTML 清洗 → 组装 Word 兼容 HTML → asBlob() → 下载 .docx
```

### 3.1 数据源

不能直接用 `messagesStore.prdHtml`（整份单文件 HTML，其中图表是**未渲染**的 mermaid/markmap 源码与脚本）。改用结构化模块数据：

- 首选：`usePrdEditStore().sections`（已从 `GET /api/sessions/:id/prd/sections` 拉取并在编辑流程中实时同步，`{ sectionId, title, html }[]`）
- 兜底：导出时若 store 为空，调 `prdEditStore.loadSections(sessionId)` 重新拉取

标题用 `<h1>`/现有 section 标题结构，各模块按 store 顺序串联，无 Tab 结构（Word 里没有 Tab）。

### 3.2 离屏渲染图表（复用现有运行时）

`@prd-runtime/prd-runtime.js`（`backend/src/services/prd/runtime/`）已提供全量渲染入口，与 `PrdSectionItem` 同源共用，**不改渲染逻辑**：

```ts
import { runMermaid, renderDiagrams, waitFrames } from "@prd-runtime/prd-runtime.js";
```

步骤：

1. 创建离屏容器：`position: fixed; left: -99999px; top: 0; width: 900px;` 挂到 `document.body`（mermaid 测量需要真实挂在 DOM 上，不能是 detached 节点）
2. 注入 `prd-content.css` 样式文本（Vite `?raw` 导入 `@prd-runtime/prd-content.css?raw`，key 用 `?!raw` 别名）保证表格/标题排版样式参与渲染
3. 逐 section `container.innerHTML = sec.html`，然后 `await runMermaid(nodes)` → `await renderDiagrams(el, ...)`（markmap 走 `renderMarkmapIn`，与 `PrdSectionItem` 的调用顺序保持一致）
4. 注意：**不调用** `initZoomIn`，避免往 DOM 注入缩放/拖拽交互元素；不挂载 `ElementFloatPanel`

### 3.3 SVG → PNG 光栅化

新工具函数 `svgToPngDataUrl(svg: SVGSVGElement): Promise<string | null>`：

1. `XMLSerializer().serializeToString(svg)` 得到 SVG 字符串，带高度/宽度（SVG 无尺寸时用 `getBBox()` 兜底）
2. 转成 `data:image/svg+xml;charset=utf-8,` + `encodeURIComponent` 的 URL，`new Image()` 加载
3. `canvas` 2D 绘制，按 2x 缩放（Word 里放大不糊），`canvas.toDataURL("image/png")`
4. 遍历渲染结果里的所有 `svg`（`.mermaid`、`#markmap-svg`、echarts 图表），替换成 `<img src="data:image/png;base64,...">`

**已知风险**：mermaid 默认 `htmlLabels: true`，文字在 `foreignObject` 内。Chrome 下通过 data-URI Image + canvas 绘制可渲染 foreignObject，但存在文字丢失/字体回退风险。

**兜底方案**（验收时验证，若文字缺失则启用）：给 `runMermaid` 增加可选配置覆盖参数（`runtime/third arg` 改动很小，`prd-runtime.d.ts` 同步更新），docx 导出路径传入 `htmlLabels: false`，让 mermaid 输出原生 SVG `<text>`，光栅化必定稳妥。markmap 是纯 SVG，无此问题。

**降级**：无法光栅化的图表（光栅化返回 null、渲染报错），在 docx 中降级为等宽字体的源码块 + 一行提示文字，不静默丢弃。

### 3.4 HTML 清洗（Word 兼容子集）

清洗函数 `sanitizeForWord(html)`，规则：

1. 移除所有 `<script>`、`<link>`、`<style>` 外引用；只保留一张精简内嵌 `<style>`（从 `prd-content.css` 抽一小份简化样式：标题级差、表格边框 `border-collapse`、单元格 padding、图片 max-width）
2. 移除交互属性：`contenteditable`、`data-*`（locatorId 等地址标签）、`draggable`、按钮类编辑态元素
3. Word（altChunk）对 flex/grid 支持差 → 不必逐一转换，PRD 正文以文档流为主，验收时以实际打开效果为准，只对明显破坏段落的结构加最小修正（如 figure 内 SVG 换 img 后套 `<p align="center">`）
4. 表格补全 `border="1"` + 同步写死的单元格边框样式，避免 Word 渲染出无边框表格

### 3.5 打包与下载

```ts
import { asBlob } from "html-docx-js-typescript";

const html = toWordDocument(title, sanitizedInnerHtml);
const blob = (await asBlob(html, {
  orientation: "portrait",
  margins: { top: 1134, right: 1134, bottom: 1134, left: 1134 }, // 2cm
})) as Blob;
// 复用现有 downloadTextFile 逻辑（markmapExport.ts 里的 downloadTextFile 可直接复用/挪出公共）
a.download = `${session.title || "prd"}.docx`;
```

下载复用现有 createObjectURL + `<a click>` 模式；文件名复用 `sanitizeDownloadFilename`。

---

## 四、代码改动清单

| 文件 | 改动 |
| --- | --- |
| `frontend/package.json` | `pnpm --filter frontend add html-docx-js-typescript` |
| `frontend/src/utils/docxExport.ts`（新增） | `exportPrdToDocx(options)` / `sanitizeForWord()` / `svgToPngDataUrl()` |
| `frontend/src/components/ExportModal/ExportModal.vue` | `exportFormat` 类型加 `"docx"`；新增第 4 个 `<label class="format-item">`（图标 `icon-lucide-file-type`，样式类 `.docx`）；`handleExport()` 增加 docx 分支（导出中加 loading 态，图表渲染+光栅化可能 1~3s） |
| `frontend/src/views/session/components/ExportModal 样式`（同上文件 `<style>`） | `.format-icon.docx { color: #185ABD; }` |
| `backend/src/services/prd/runtime/prd-runtime.d.ts` | 仅在启用 3.3 兜底方案时：`runMermaid` 增加 config 覆盖参数的类型声明 |

不涉及后端改动、不新增 API。

---

## 五、分阶段实施与验收

### M1：纯内容 docx（无图表也能交付）

- [ ] 弹窗新增 Word 选项，选中后能下载合法 .docx（桌面 Word / WPS 均可打开）
- [ ] 标题层级、表格（含边框）、加粗/文字颜色保留
- [ ] 图表位置以「源码块 + 提示文字」占位（3.4 降级路径先落地）

### M2：图表栅格化

- [ ] mermaid 三张图（架构/流程/ER）在 docx 中显示为清晰位图
- [ ] markmap 思维导图显示完整
- [ ] 若 foreignObject 导致 mermaid 文字缺失 → 启用 `htmlLabels: false` 兜底并回归 M1 验收项

### 验收用例

1. 空会话 / 未生成 PRD 时点导出 → 走现有 `if (!prdHtml) return` 逻辑，不出错
2. 8 个默认模块的完整 PRD → 打开 docx 逐 Tab 对比内容完整性
3. 含自定义模块（非默认模块 + renderType）的 PRD → 自定义图表降级或正常显示，不卡死
4. 超长 PRD（多表格、多图）→ 导出耗时 < 5s，Word 打开无损坏告警
5. Electron 环境 → 与 Web 行为一致（renderer 侧 Blob 下载逻辑相同，无需额外适配）

---

## 六、风险与边界

| 风险 | 缓解 |
| --- | --- |
| altChunk docx 在旧版 Word 在线版 / 移动端 Word 兼容性一般 | 文档描述里注明「建议用桌面 Word / WPS 打开」；兜底可切方案 D（MS Word HTML .doc） |
| mermaid foreignObject 光栅化文字丢失 | 3.3 兜底：导出专用 `htmlLabels: false` |
| 图表多时导出耗时 | 导出按钮加 loading + 完成后 Toast；不做后台队列 |
| `html-docx-js-typescript` 维护度一般 | 封装在 `docxExport.ts` 单文件内，后续可替换实现而不动 UI |
| store 的 sections 与当前工作区版本不同步（切版本瞬间） | 导出前重新 `loadSections()` 或以 `prdHtml` 存在与否做守卫；版本切换本就重建工作区，风险窗口极小 |

---

## 七、实现记录（2026-11-01）

> 实现与 plan 的差异点：

- 最终的 Word HTML 使用 `docxExport.ts` 自带的精简样式表（`WORD_CSS`），未在离屏容器注入 `prd-content.css`——光栅化对 SVG 按计算样式内联（`inlineComputedStyles`），CSS 类不参与独立 SVG 文档渲染，无需注入。
- 图标色值落定为 Word 品牌蓝 `#185ABD`（plan 中二选一项）。
- 自定义模块 `renderType` 仅支持 `html / table / mermaid / markmap`（`ModuleBuilderPanel` 的 `FORMAT_TO_RENDER_TYPE`），全部被现有管线覆盖，无需额外降级路径。

已落地：

- ✅ `html-docx-js-typescript@0.1.5`（仅 frontend 依赖，pnpm 安装）
- ✅ `frontend/src/utils/docxExport.ts`：离屏渲染（复用 `@prd-runtime` 运行时）→ SVG 光栅化（计算样式内联、≤2x 缩放、画布尺寸安全上限）→ mermaid/markmap 渲染失败降级为源码块 → HTML 清洗（去 script / 交互属性 / data-*）→ MHT 打包下载
- ✅ `ExportModal.vue`：新增 Word 选项（`icon-lucide-file-type`）、导出中 loading（按钮禁用 + "导出中…"）、失败错误提示留在弹窗内、成功才关闭弹窗
- ✅ 类型检查无新增错误、`vite build` 通过（jszip 正常打包为独立 chunk）

### 修订 1：信息架构（markmap）导出过小的修补

现象：信息架构模块在 Word 中渲染为极小的图形。排查要点与修补：

1. `<img>` 只带了 `style="max-width:100%; height:auto"` 内联样式——Word 对
   altChunk HTML 里这两条 CSS 支持不稳，回退时以非预期尺寸渲染。
   → 改为显式像素 `width`/`height` 属性；宽图缩至页宽（`WORD_CONTENT_WIDTH_PX = 620`），
   小图按原始逻辑尺寸不放大。
2. markmap 的 SVG 是 `width:100% + height:560px` 的固定视口，`fit()` 只是把树塞进视口，
   按视口矩形导出会把窄长树压得很小。
   → 光栅化取景改为**内容包围盒**（`getBBox()` + 12px 内边距），克隆根节点剥离
   `width/height/max-width/min-width` 计算样式（否则 CSS 会压过 width/height 属性）。
3. 加固缩放策略：至少 3x，内容逻辑宽度不足 1600px 时继续提高倍率；markmap
   一律整页宽展示。
4. `renderDiagrams` 返回的 zoom 清理函数显式执行，避免残留监听/内联样式。
5. `WORD_CSS` 移除 `img { max-width: 100% }`（与显式尺寸属性互相干扰）。

### 修订 2：信息架构导出成一摊文字叠影/中途动画状态的修补

`markmap-view@0.18.12` 源码确认：markmap 的进场渲染与 `fit()` 都是 **d3 transition
（默认 `duration: 500ms`）**——所有节点从根部位置动画过渡到最终坐标。
此前只等了 6 帧（~100ms）就光栅化，导出的 PNG 是动画中途状态
（节点全堆在根部 → 第一次的「小墨块」与第二次的「文字叠影」都源自于此）。

修补：`docxExport.ts` 在包含 markmap 的模块光栅化前显式等待 1200ms
（`MARKMAP_SETTLE_MS`）+ 2 帧，确保 fit transition 完全结束再取 content bbox。
mermaid 为静态渲染，不受影响，不加额外等待。

待人工验收（M1/M2 中未勾选项）：

