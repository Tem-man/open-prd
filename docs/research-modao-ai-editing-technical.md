# 墨刀 AI 原型设计稿智能体编辑功能技术逆向分析

> 研究对象：[墨刀 AI 设计稿页面](https://modao.cc/ai/design/splpderyo2gwp6pw/6a091b4dfed7e9979e4c1d5d)  
> 研究方式：Cursor 浏览器模拟点击、页面快照、控制台与网络请求观察、公开资料交叉验证  
> 研究时间：2026-05-30

## 1. 结论摘要

墨刀 AI 的“生成原型设计稿编辑功能”本质上不是传统 Figma/Sketch 式的图层编辑器，而是一个 **代码优先的 HTML 工作区 + 可视化 iframe 预览 + AI 文件编辑 Agent + 版本化交付** 的组合系统。

从实际页面观察看，它把生成结果保存为任务工作区内的 HTML 应用文件，例如：

```text
/workspace/schedule-app.html/app.html
```

右侧预览区域通过 iframe 渲染该 HTML，代码模式通过 Monaco Editor 展示同一份 HTML 源码。用户在“编辑模式”里选中页面元素或通过输入框描述修改需求后，系统会把“选中元素上下文 + 用户指令 + 当前工作区文件路径”发送给后端编辑型 Agent，由 Agent 读取文件、定位代码、修改文件，再生成新的预览版本。

可以概括为：

```text
用户自然语言/区域选择
        ↓
前端收集选中 DOM/元素描述/文件上下文
        ↓
后端 HTML 编辑 Agent 读取工作区文件
        ↓
基于文本匹配、结构定位或 LLM 推理修改 HTML/CSS/JS
        ↓
生成新版本文件
        ↓
iframe 重新加载预览 + Monaco 展示源码
        ↓
可导出至墨刀原型或下载代码
```

## 2. 页面结构与编辑入口

实际进入目标设计稿后，页面呈现为左右分栏：

| 区域 | 作用 |
| --- | --- |
| 左侧对话区 | 展示任务日志、AI 修改摘要、后续建议、继续输入框 |
| 左侧文件卡片 | 展示生成物，如 `schedule-app`，点击后打开预览 |
| 右侧预览区 | iframe 渲染生成的移动端 HTML 原型 |
| 顶部工具栏 | `预览`、`编辑`、`代码`、`V1`、`导出至墨刀`、`分享`、全屏/关闭等 |
| 文件弹窗 | “查看任务中的所有文件”，展示当前任务文件树 |

实测能看到的关键入口：

- `预览`：渲染 HTML 原型。
- `编辑`：进入可视化编辑模式，顶部出现实时保存、撤销、重做等状态按钮。
- `代码`：切换到 Monaco Editor 源码视图。
- `V1`：版本标识，说明生成物有版本概念。
- `导出至墨刀`：将 HTML 原型转入墨刀原型体系继续精修。
- `分享`：分享当前生成结果。
- `下载/复制代码`：从预览或代码模式导出 HTML。

## 3. 网络请求与运行时证据

### 3.1 任务元数据接口

页面加载设计任务时，观察到请求：

```text
GET https://modao.cc/agent-py/tasks/6a091b4dfed7e9979e4c1d5d
```

推断该接口返回任务详情，包括会话消息、生成状态、文件列表、版本信息、工作区路径等。

### 3.2 工作区 HTML 文件接口

打开生成文件时，观察到多次拉取：

```text
GET https://modao.cc/agent-py/workspace/6a091b4dfed7e9979e4c1d5d/mixed-versions/schedule-app.html
```

这说明右侧预览不是图片，而是从任务工作区加载 HTML 文件。`mixed-versions` 命名表明它可能是当前可展示版本的聚合视图，或者是从多个编辑版本中合成出的当前结果。

### 3.3 预览依赖

代码模式中可见生成 HTML 引入了：

```html
<script src="https://modao.cc/agent-py/static/source/js/tailwindcss.js"></script>
<script src="https://modao.cc/agent-py/static/source/js/iconify-icon.min.js"></script>
```

预览运行时还会请求：

```text
https://api.iconify.design/lucide.json?... 
https://fonts.googleapis.com/css2?family=Inter...
```

说明 AI 生成的原型采用单文件 HTML 思路，样式主要依赖 Tailwind CSS 运行时，图标依赖 Iconify，字体使用 Inter。

### 3.4 代码编辑器

切换到“代码”模式后，网络请求加载：

```text
https://modao.cc/ai/static/monaco/loader.js
https://modao.cc/ai/static/monaco/editor/editor.main.js
https://modao.cc/ai/static/monaco/language/html/htmlMode.js
https://modao.cc/ai/static/monaco/basic-languages/html/html.js
https://modao.cc/ai/static/monaco/basic-languages/css/css.js
https://modao.cc/ai/static/monaco/basic-languages/javascript/javascript.js
```

由此可以确认源码视图基于 Monaco Editor 实现，并对 HTML/CSS/JavaScript 做语法高亮。

### 3.5 iframe 沙箱

控制台出现：

```text
An iframe which has both allow-scripts and allow-same-origin for its sandbox attribute can escape its sandboxing.
```

说明右侧预览使用了带 `sandbox` 的 iframe，并允许脚本执行与同源能力。这便于原型内部 JavaScript 运行，也便于宿主页面与 iframe 之间进行 DOM 选择、尺寸计算、状态同步等通信，但安全边界需要谨慎处理。

### 3.6 实时连接

控制台出现：

```text
[socket 连接成功] times 1
```

推断生成、编辑状态、日志流、任务进度等可能通过 WebSocket 或类似长连接机制推送到前端。

## 4. 编辑功能的实现拆解

### 4.1 生成物模型：从“设计图”变成“HTML 工作区”

墨刀 AI 这里的生成产物不是位图，也不是纯粹设计图层，而是任务工作区中的 HTML 应用：

```text
taskId = 6a091b4dfed7e9979e4c1d5d
workspace = /workspace/schedule-app.html/
entry = /workspace/schedule-app.html/app.html
```

对应前端展示：

- 预览模式：iframe 运行 `app.html`
- 代码模式：Monaco 展示 `app.html`
- 文件模式：展示任务中的所有文件
- 下载/复制：直接导出 HTML 代码
- 导出至墨刀：进一步转换为墨刀可编辑原型

这类架构的好处是编辑闭环非常短：AI 只要能修改 HTML/CSS/JS，就能立刻刷新预览。

### 4.2 可视化编辑模式：DOM 选择 + 指令绑定

在编辑历史中可以看到类似上下文：

```text
V1 中的 <div> 元素 把提醒时段改成提醒设置
```

这说明用户在可视化编辑模式中选中了某个 DOM 元素，前端把该元素抽象成 `<div>` 这样的结构描述，再与用户输入的自然语言修改指令拼接成编辑任务。

可能的数据结构如下：

```json
{
  "taskId": "6a091b4dfed7e9979e4c1d5d",
  "version": "V1",
  "file": "/workspace/schedule-app.html/app.html",
  "selectedElement": {
    "tagName": "div",
    "text": "提醒时段",
    "domPath": "...",
    "bbox": { "x": 0, "y": 0, "width": 0, "height": 0 },
    "outerHTML": "<div>提醒时段</div>"
  },
  "instruction": "把提醒时段改成提醒设置"
}
```

前端最可能通过 iframe 内注入脚本实现：

1. 监听 iframe 内部鼠标 hover/click。
2. 计算元素边界并绘制高亮框。
3. 提取目标元素的 `tagName`、文本、class、DOM path、相邻上下文。
4. 使用 `postMessage` 将选择信息传回父页面。
5. 父页面把选择信息作为下一次 AI 编辑请求的上下文。

### 4.3 后端编辑 Agent：文件级修改而不是图层级修改

页面历史里直接暴露了编辑 Agent 的工作方式：

```text
读取文件 — 读取 /workspace/schedule-app.html/app.html 全量内容
精确字符串匹配 — 在文件内容中搜索 "提醒时段" 这个字符串
确认行号 — 定位到该字符串所在的行（第 643 行）
执行替换 — 将 "提醒时段" 替换为 "提醒设置"
```

这说明至少在简单文本修改场景下，它使用的是文件级编辑流程：

```text
read file
  → search target text / infer target block
  → locate line or code segment
  → apply patch
  → validate key snippets
  → save as current/new version
```

对于更复杂的新增功能，历史中也能看到它会修改 CSS、HTML、JavaScript 三层：

- 新增 `.modal-overlay`、`.modal-sheet` 样式。
- 插入底部弹窗 HTML。
- 替换 FAB 的 `alert()` 为 `openModal()` / `closeModal()` / 保存逻辑。
- 修改动态计数 `${mockEvents.length}`。
- 调整 `z-index`。

因此它不是简单的“局部重绘”，而是一个能理解并改写完整 HTML 应用代码的编辑型 Agent。

### 4.4 版本机制：V1 + 派生目录

当前工具栏显示 `V1`，历史里出现：

```text
目前后端已指定源目录为 /workspace/schedule-app.html/
编辑结果会输出到新版本 /workspace/schedule-app_v2.html/
```

推断版本机制可能是：

```text
/workspace/schedule-app.html/       # 初始版本或当前源版本
/workspace/schedule-app_v2.html/    # 编辑后的派生版本
/mixed-versions/schedule-app.html   # 当前展示版本或合并后的入口
```

这使得系统可以支持：

- 版本下拉切换。
- 撤销/重做。
- 编辑前后对比。
- 失败时回滚。
- 多轮编辑保存历史。

### 4.5 实时保存与工具状态

进入编辑模式后，顶部出现“已实时保存”状态，同时撤销/重做等按钮初始为禁用。推断前端维护了一个编辑状态机：

```text
preview
  → edit
    → selecting element
    → pending instruction
    → agent editing
    → saving
    → saved
    → version updated
```

源码编辑器、可视化编辑、AI 对话编辑都需要写回同一个工作区文件，因此“实时保存”很可能由前端本地状态 + 后端 workspace save API 共同完成。

## 5. 技术架构推断

```text
┌────────────────────────────────────────────────────┐
│                    Web 前端                         │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ 对话/任务流  │  │ 工具栏状态机   │  │ 文件列表    │ │
│  └──────┬──────┘  └──────┬───────┘  └─────┬──────┘ │
│         │                │                │        │
│  ┌──────▼────────────────▼────────────────▼──────┐ │
│  │ iframe HTML 预览 + DOM 选择桥接 + postMessage  │ │
│  └──────┬────────────────────────────────────────┘ │
│         │                                          │
│  ┌──────▼──────┐                                   │
│  │ Monaco 代码 │                                   │
│  └──────┬──────┘                                   │
└─────────┼──────────────────────────────────────────┘
          │ REST / WebSocket
┌─────────▼──────────────────────────────────────────┐
│                  agent-py 后端                      │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │
│  │ Task Service │ │ Workspace FS │ │ Version Store │ │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ │
│         │                │                │        │
│  ┌──────▼────────────────▼────────────────▼──────┐ │
│  │ HTML 编辑 Agent：读取、定位、补丁、校验、保存     │ │
│  └───────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

## 6. 编辑请求的可能协议

结合 UI 和日志，AI 编辑请求可能包含：

```json
{
  "conversationId": "splpderyo2gwp6pw",
  "taskId": "6a091b4dfed7e9979e4c1d5d",
  "mode": "edit",
  "speed": "fast",
  "sourceVersion": "V1",
  "workspacePath": "/workspace/schedule-app.html/",
  "entryFile": "/workspace/schedule-app.html/app.html",
  "selection": {
    "elementTag": "div",
    "textContent": "提醒时段",
    "domPath": "...",
    "outerHTML": "...",
    "nearbyText": "..."
  },
  "instruction": "把提醒时段改成提醒设置"
}
```

服务端返回可能是流式事件：

```json
{
  "type": "tool_log",
  "content": "读取文件 /workspace/schedule-app.html/app.html"
}
```

```json
{
  "type": "patch_result",
  "file": "/workspace/schedule-app.html/app.html",
  "summary": "将第 643 行的提醒时段改为提醒设置"
}
```

```json
{
  "type": "version_ready",
  "version": "V2",
  "previewUrl": "/agent-py/workspace/.../mixed-versions/schedule-app.html"
}
```

## 7. “导出至墨刀”的技术含义

页面顶部存在“导出至墨刀”按钮，公开资料也提到“支持导入墨刀原型自由编辑”。结合当前 HTML 工作区实现，推断导出链路大概率是：

```text
HTML/CSS/JS 文件
  → HTML 解析
  → DOM 节点转换为墨刀原型元素
  → CSS 样式映射到图层属性
  → 交互事件尽量转换为动态组件/跳转/面板
  → 生成墨刀项目文件
```

公开资料中提到，导出后文本可改、图层完整、组件结构保留、交互动效可拓展；这与“先生成 HTML，再转为设计工具内部模型”的路径一致。

## 8. 对 open-prd 的可借鉴实现

如果在本项目中实现类似“PRD/HTML 原型可编辑智能体”，建议采用相同的分层设计：

### 8.1 产物工作区

为每个会话建立版本化工作区：

```text
/workspace/{sessionId}/prd.html
/workspace/{sessionId}/prd_v2.html
/workspace/{sessionId}/mixed/prd.html
```

### 8.2 三种编辑模式

| 模式 | 实现 |
| --- | --- |
| 对话编辑 | 用户输入自然语言，Agent 修改指定模块 |
| 区域选择编辑 | iframe 中选择 DOM 节点，带上 `outerHTML` 和文本上下文 |
| 代码编辑 | Monaco Editor 直接编辑 HTML/CSS/JS |

### 8.3 DOM 选择桥接

在 iframe 里注入编辑脚本：

```js
window.addEventListener('click', (event) => {
  const el = event.target;
  window.parent.postMessage({
    type: 'select-element',
    payload: {
      tagName: el.tagName.toLowerCase(),
      text: el.textContent?.slice(0, 200),
      className: el.className,
      outerHTML: el.outerHTML.slice(0, 4000),
      rect: el.getBoundingClientRect()
    }
  }, '*');
});
```

### 8.4 文件级 Agent 修改

后端不要只保存文档字符串，而应保存“可编辑文件”：

```text
读取当前 HTML
  → 根据模块 ID / DOM 选择 / 文本线索定位
  → 生成 patch
  → 保存新版本
  → 重新渲染预览
```

这样可以获得和墨刀类似的“生成后继续编辑”体验。

## 9. 风险与限制

- 当前分析基于浏览器可见行为、网络请求和控制台信息，无法直接确认服务端内部实现。
- iframe 使用 `allow-scripts + allow-same-origin` 能提升预览和编辑能力，但要注意 XSS 与沙箱逃逸风险。
- 基于文本匹配的编辑在简单文案修改上很稳定，但复杂布局修改需要 AST/DOM 解析或更强的代码补丁校验。
- Tailwind CDN 适合快速原型，但生产级交付应转为构建期 Tailwind。
- HTML 转墨刀原型时，CSS、响应式布局、JS 交互不一定能 100% 映射成设计工具内部组件。

## 10. 参考资料

- [墨刀 AI 官方功能页](https://modao.cc/feature/ai)
- [墨刀 AI Agent 生成原型图全流程解读：可编辑才是关键](https://www.zcool.com.cn/article/ZMTY4NTEwOA==.html)
- [墨刀 AI 再进化：基于设计系统生成 React/HTML 应用](https://ai.codefather.cn/news/2055143841689784327)
- [AI 画原型工具评测：墨刀 AI 可编辑高保真原型](https://zhuanlan.zhihu.com/p/2022321052294869668)

