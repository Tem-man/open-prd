# 原型编辑器评论功能移植计划（open-pencil → open-prd）

> 目标：把 open-pencil 的画布评论功能（Comment 工具 + Pin + 线程卡片 + 评论列表面板）移植到
> `open-prd` 迁移版原型编辑器（`/prototype` 路由，`packages/` 引擎 + `frontend/src/pencil/` 壳），
> 交互对齐 open-pencil 当前版本（C 选工具 → 点画布 → 输入/回复 → 解决/删除，Shift+C 控制工作区外的 Pin 显示）。
>
> 前置阅读：`docs/plan-prototype-editor-migration.md`、`packages/PENCIL_UPSTREAM.md`。
> 参考资料：《open-pencil 评论功能实现梳理》（`D:\AI\Donjet\docs\open-pencil-评论功能实现梳理.md`，
> 含全部 file:line 引用；本文不再重复上游细节）。

---

## 一、现状核对（2026-11 已逐项验证）

open-prd 里**评论功能完全不存在**（全仓 grep `comment|Comment` 在引擎与壳中零命中）。
迁移基线是 open-pencil `ff31f90`（2026-07-31），远早于评论功能提交；且引擎已裁剪为平铺结构。

### 1.1 引擎层现状（`packages/*`，直接可用 / 需补 / 需确认）

| 项              | 现状                                                                                                                                                                                                    | 对评论的影响                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Tool` 联合类型 | `packages/core/src/editor/types.ts:18-29`，11 个工具，**无 `'COMMENT'`**                                                                                                                                | 新增枚举值；所有 `Record<Tool,…>` 侧表联动改                                                                                                               |
| 工具表          | `packages/core/src/editor/tool-registry.ts`（10 项）+ `TOOL_SHORTCUTS`（**无 `KeyC`，无占用冲突**）                                                                                                     | 加 `{ key:'COMMENT', label:'Comment', shortcut:'C' }`                                                                                                      |
| 画布工具输入    | `packages/vue/src/canvas/tool-input/use.ts` 的 `handleToolMouseDown` 是 **if 链**（非上游最新的 `CANVAS_TOOLS` 注册表）                                                                                 | 不加分支；Comment 工具的画布点击由应用层捕获层吞掉（同上游设计）                                                                                           |
| 工具光标        | `packages/vue/src/editor/tool-cursor/index.ts`，`Record<Tool,string>` 纯 CSS 光标，无 comment.svg                                                                                                       | 简化：`COMMENT: 'copy'`（或后续补 SVG 光标）                                                                                                               |
| pluginData      | `SceneNode.pluginData: PluginDataEntry[]`（`scene-graph/src/types.ts:508`，条目 `{ pluginId, key, value: string }` :287），**无 readPluginData/withPluginData 辅助、无 OPEN_PENCIL_PLUGIN_DATA 字段表** | 需新建一个小工具模块（读写 + 常量）                                                                                                                        |
| SceneGraph API  | `rootId/getNode/updateNode/hitTest/getAbsolutePosition` 均在（`scene-graph/src/index.ts`）；nanoevents `node:created/:updated/:reparented/:reordered/:deleted`                                          | 评论依赖的图 API 基本齐全；**无 `closest()`**（需补）                                                                                                      |
| 随机 ID         | `randomHex/randomInt/randomIndex` 已有（`scene-graph/src/index.ts:4` → `random.ts`，crypto）                                                                                                            | 直接用于 `c_`/`r_` ID                                                                                                                                      |
| 撤销            | **命令式** `UndoManager`（forward/inverse 闭包栈，`scene-graph/src/undo.ts`）+ 显式 `ctx.undo.push`（如 `core/src/editor/undo.ts:37`）                                                                  | 评论写入根节点不会自动进 undo —— 天然满足"评论不入 undo"；页面快照恢复（`editor/history/snapshot.ts`）只操作 page 子树，不触根 pluginData（仍需验证项 V2） |
| `.fig` 持久化   | 导出已接 pluginData：`packages/fig/src/node-change/export-node.ts:837-838` `mergePluginData(node.pluginData)`，解析侧 `convert.ts:678`                                                                  | **评论作为根节点 pluginData 自动随 `.fig` 持久化**，后端零改动                                                                                             |
| 归属常量        | `OPEN_PENCIL_PLUGIN_ID` 定义在 `packages/fig/src/node-change/plugin-data.ts`；scene-graph 侧无                                                                                                          | 评论字段常量放 scene-graph，避免反向依赖                                                                                                                   |

### 1.2 壳层现状（`frontend/src/pencil/`）

| 项            | 现状                                                                                                                                                                                                                                                             | 集成点                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 评论状态/组件 | 无 `app/comments`、`components/comments`、theme；i18n 无 comments 命名空间                                                                                                                                                                                       | 全部新建，从当前 open-pencil 树移植                                                           |
| 画布挂载      | `components/EditorCanvas.vue`（201 行收窄版）：scene/overlay 双 canvas、`ContextMenuRoot`+`CanvasMenu`、`useCanvasVirtualReference` 挂锚自动布局 padding 编辑器（:101,142-177）                                                                                  | CommentsLayer 挂在第二个 `<canvas>`（:124）之后；`useCanvasVirtualReference` 直接复用为卡片锚 |
| 右侧栏        | `components/PropertiesPanel.vue`：Design/Code/AI 三 Tabs，`useAIChat().activeTab` 驱动                                                                                                                                                                           | Comment 工具激活时整栏替换为 CommentsPanel（同上游）                                          |
| 工具条        | `components/Toolbar/Toolbar.vue`：`toolLabels`(:28-40)、`toolShortcuts`(:42-54) `Record<Tool,…>` 硬编码；`app/editor/icons.ts:22` `toolIcons`                                                                                                                    | 三处集合加 COMMENT（图标 lucide `message-circle`）                                            |
| 键盘          | `app/shell/keyboard/registry.ts`（tinykeys + 命令绑定）；**无上游 onEscape 栈**                                                                                                                                                                                  | Shift+C 走 registry 加一条；Escape 关卡片由 CommentsLayer 自行监听 keydown                    |
| 偏好设置      | **未迁移**（`app/settings/` 只有 credentials+dialog）                                                                                                                                                                                                            | 新建轻量 `app/settings/preferences.ts`（VueUse `useLocalStorage`）                            |
| 身份/协作     | `app/collab/use.ts` 为 no-op 桩（迁移裁掉协作）                                                                                                                                                                                                                  | 无多端：作者取本地身份（localStorage），`authorColor` 单色或从调色板派生                      |
| 自动保存      | `app/document/autosave/create.ts` `watchDebounced(state.sceneVersion, 3000)` → `saveCurrentDocument` → `exportFigFile(graph)`（`app/document/io/source.ts:50`）→ `PUT/POST /api/prototypes/:id` 原子写（`backend/src/services/prototypeStore.ts:42` tmp+rename） | 评论写根节点 → 若 sceneVersion 递增（V1）则 autosave 自动覆盖，后端零改动                     |
| i18n          | nanostores；命名空间 = `packages/vue/src/i18n/messages/<ns>.ts` + `locales/<locale>/<ns>.json`，`messages.ts:20-28` 聚合 `messageDefaults`；语言可切换（en + 8 语言）                                                                                            | 新增 `comments` 命名空间（messages 文件 + 8 个 locale json + index 注册）                     |
| Markdown 渲染 | **无渲染器**（`app/shell/markdown/index.ts` 仅 `export default undefined`）；但 `vue-stream-markdown@^1.0.3`、`marked@^18` 都在 `frontend/package.json` deps                                                                                                     | 评论文本的 Markdown 渲染方案见 §7.3                                                           |
| 依赖就绪      | `@vueuse/core 14.2.1`（`createGlobalState`）、`tailwind-variants`、`reka-ui 2.9.2`、`valibot` 均已装                                                                                                                                                             | 组件可按上游原样移植                                                                          |

### 1.3 移植源（d:\AI\Donjet\open-pencil 当前工作树）

| 上游文件                                                                          | 处置                                                 |
| --------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `packages/scene-graph/src/comments/{schema,threads,document,list,merge,index}.ts` | **直迁 + API 适配**（见 §3）                         |
| `src/app/comments/{use,document,format}.ts`                                       | **直迁 + 裁剪**（单机无协作 → 精简 sync/merge 路径） |
| `src/components/comments/*`（12 组件 + author/ui/usePinDrag + 示例 threads.ts）   | **直迁 + 少量适配**（Tailwind 主题同源可用）         |
| `src/theme/comments.ts`                                                           | 直迁                                                 |
| i18n `messages/comments.ts` + `locales/*/comments.json`                           | 直迁 + 注册                                          |
| `markerdown` 渲染组件 `src/components/markdown/`                                  | 方案见 §7.3                                          |
| AI 评论工具 `packages/core/src/tools/comments.ts`                                 | P3 可选（见 §8）                                     |

---

## 二、总体设计（单机版评论 = 上游的裁剪）

保留（与上游一致）：数据模型与 Pin 交互全部保留 —— 线程/回复/墓碑解决/编号/列表筛选/落层跟随/拖拽/卡片锚定。
裁剪（open-prd 是单人文档、无多人协作）：

1. **无多端合并**：`merge.ts`/`hasNewerComments`/collab 房间同步整组不迁；`followDocumentComments` 精简为"事件驱动重读"（保留同幅骨架与事件名，未来要恢复协作时直接补回）。
2. **无删除确认的多端提示文案**，删除仍是墓碑（防"旧快照复活"，行为不变）。
3. **作者身份**：不做协作房间身份；本地昵称 + 从固定调色板取色。
4. **AI 工具与脚本 API**：上游的 `openpencil-api`（脚本层）与 4 个 MCP/AI 工具不是本期必需，列为 P3 可选。
5. **偏好**：轻量 localStorage 模块替代上游完整 preferences 体系（只放评论相关 5 个开关）。

---

## 三、数据层移植（`packages/scene-graph/src/comments/`）

### 3.1 新增文件与内容

将上游 `packages/scene-graph/src/comments/{schema,threads,document,list,merge,index}.ts` 移植为
`open-prd/packages/scene-graph/src/comments/{schema,threads,repository,list,index}.ts`（merge 可暂缓，接口预留）：

```
packages/scene-graph/src/comments/
├── schema.ts      # valibot 宽松 schema（commentThreadsSchema，同上游逐字段）
├── threads.ts     # CommentAuthor/commentAnchor/commentPosition/createCommentThread/
│                  #   createCommentReply/resolve/reply/delete(墓碑)/liveReplies/排序
├── repository.ts  # readComments(graph)/writeComments(graph, threads)/withCommentsChanged —— 见 3.2
├── list.ts        # COMMENT_SORTS/commentThreadNumbers/listCommentThreads（同上游）
└── index.ts       # re-export，并加入 packages/scene-graph/src/index.ts 的桶文件
```

### 3.2 pluginData 读写（必须新建的小工具）

上游存在 `readPluginData` / `withPluginData` / `withoutPluginData` / `isPluginDataEntry`（新版 scene-graph），
基线版没有。在 `comments/repository.ts`（或独立 `plugin-data.ts`）实现最小版本：

```ts
// key 沿用上游约定
export const OPEN_PENCIL_PLUGIN_ID = "open-pencil"; // 与 packages/fig/src/node-change/plugin-data.ts 的常量对齐（实施时取该常量原名与值）
export const COMMENTS_PLUGIN_KEY = "comments";

function findEntry(
	pluginData: PluginDataEntry[],
	key: string,
): PluginDataEntry | undefined;
// readComments: JSON.parse(entry.value) → commentThreadsSchema 校验
// writeComments: 读 root → 拼 entry 数组 → graph.updateNode(root.id, { pluginData: [...] })
//   threads 为空 → 移除该条目（同上游 writeComments 语义）
```

要点（与上游一致）：

- `writeComments` 是 `graph.updateNode` 的普通写入：触发渲染失效与保存请求（autosave），**不进 undo**（命令式栈不会自动包它）。
- schema 继续"宽松解析、单条损坏牺牲单条"；`updatedAt` 空值回退 `createdAt`。
- `commentAnchor` 依赖 `graph.hitTest` + "钉到顶层层"：上游用 `graph.closest()`，基线版没有。**在 threads.ts 内用父链 walk 实现**（从命中节点沿 `parentId` 上溯，直到父亲是页面/root 或 SECTION 的直接子层；带父环保护），避免为一次移植给 SceneGraph 加公开 API。若实施时倾向给 `index.ts` 补一个私有 `ancestorChain()`，需走 `packages/tsconfig.json` 同步检查（include 是通配，自动覆盖）。

### 3.3 引擎层不改动清单

- 不改 `Tool` 之外的编辑器状态机、不改 undo 管理器。
- 不改 `.fig` 导出/解析（pluginData 已通）。
- 不加 `behat…` 等上游新机制。

---

## 四、引擎工具接入（让 Comment 工具可被选中）

1. `packages/core/src/editor/types.ts:18` — `Tool` 联合加 `| 'COMMENT'`。
2. `packages/core/src/editor/tool-registry.ts` — `EDITOR_TOOLS` 追加 `{ key:'COMMENT', label:'Comment', shortcut:'C', flyout: undefined? }`；`TOOL_SHORTCUTS` 加 `KeyC: 'COMMENT'`（已确认无占用）。
3. `packages/vue/src/editor/tool-cursor/index.ts` — `TOOL_CURSORS` 加 `COMMENT: 'copy'`（基线无 comment.svg；P2 可补 SVG 光标资产到 `packages/vue/src/shared/assets/`）。
4. `packages/vue/src/canvas/tool-input/use.ts` — **不加 COMMENT 分支**（实施验证项 V4：确认 if 链的默认落空分支对 COMMENT 无副作用；若有 catch-all 画形状，则按 `tool === 'COMMENT' → return` 加一个短路分支）。画布点击由 §7.1 的捕获层接管（与上游行为一致）。
5. 文案进 i18n `tools` 命名空间：`locales/<locale>/tools.json` 增 `comment` 键，`messages/tools.ts` 默认值补 `'Comment'`。

---

## 五、应用状态层（`frontend/src/pencil/app/comments/`）

### 5.1 文件清单

```
src/pencil/app/comments/
├── use.ts        # useComments()：createGlobalState（@vueuse/core 已可用）
├── document.ts   # followDocumentComments(storeRef, onReset)：精简版文档跟随
└── format.ts     # 输入框 Markdown 格式化（bold/italic/strike/link/lists + continueList，整文件直迁上游）
```

### 5.2 `use.ts` 状态与动作（对齐上游，少协作者是唯一差异）

状态：`threads`（跟随文档）、`activeThreadId`、`draft: PagePoint | null`、`listQuery / showResolved / onlyPage / onlyMine / sort / showOnCanvas`（后面几个为空间偏好 computed，写穿到 §5.4）。
动作：`startDraft / closeCard / addThread / movePin / reply / setResolved / requestDelete / confirmDelete / deleteReply / focusThread / toggleOnCanvas`。

两点差异：

- **作者身份**（替代上游 `roomForStore(...).identity`）：新建 `src/pencil/app/comments/identity.ts`
  —— `useLocalStorage('open-pencil-comment-identity', { name: '', color })`，name 缺省 `"Me"`，
  color 从 `PEER_COLORS` 风格调色板按随机索引取一次并持久化。组件 `author.ts` 的空名回退逻辑照迁（显示"某人"）。
- **卡片状态随文档切换重置**：上游用 `onDocumentChange` 回调清 `activeThreadId/draft`；这里在
  `useActiveEditorStoreRef()` 变化时执行同一回调（active-store 是模块级 `shallowRef` + `triggerRef`，
  `app/editor/active-store/index.ts:7-16`，天然有切换信号）。

### 5.3 `document.ts`（单机精简版 followDocumentComments）

```ts
export function followDocumentComments(storeRef, onDocumentChange) {
	const threads = ref<CommentThread[]>([]);
	// bind(store)：订阅 editor 事件
	//   node:updated(root) → show(_comments.readComments(graph))          # 本会话/AI 工具/撤销(passthrough)后的重读
	//   node:updated(其他)/node:reparented → rememberPositions()           # Pin 最后位置缓存
	//   node:deleted → detachFromLayer(id)                                 # 层删 Pin 留位（nodeId:null + lastSeen 坐标）
	//   graph 替换（readDocument 换图）→ onDocumentChange + 全量重读
	// mutate(change) = readComments → change → writeComments → show
	// update(id, edit) = mutate(editCommentThread(..., now(), edit))      # updatedAt 戳
}
```

注意：**不做** reconcile/merge（无远端）；事件源就是本编辑器与 AI 工具写入。函数骨架、事件名、
`lastSeen`/`detachFromLayer`/`pinPosition = commentPosition(graph, thread)` 全部保持上游形状，未来恢复协作时补 merge 即可。

### 5.4 偏好（新建 `src/pencil/app/settings/preferences.ts`）

上游 preferences 体系未迁移，本期只建评论所需的极简模块：

```ts
// useLocalStorage('open-pencil-pencil-prefs', { comment: { showOnCanvas: true, showResolved: false,
//   onlyPage: false, onlyMine: false, sort: 'newest' } }, { mergeDefaults: true })
// 导出 commentPreferences ref + updateCommentPreferences(patch)
```

`useComments` 里 `showOnCanvas` 等直接读这个 ref；`toggleOnCanvas` 只改 ref（无原生菜单同步需求——
open-prd 无 Tauri 原生菜单，桌面菜单是壳内 `shell/menu/`，P2 可选加 View→Comments 复选项）。

---

## 六、UI 组件层（`frontend/src/pencil/components/comments/`）

### 6.1 组件清单（从上游整组移植）

| 文件                                                                                                                                                                                         | 说明                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `CommentsLayer.vue`                                                                                                                                                                          | 画布覆盖层：Pin 渲染、捕获层、拖拽、草稿+线程卡片 popover、Pin 右键、滚轮转发 |
| `CommentsPanel.vue`                                                                                                                                                                          | 侧栏列表：搜索/筛选/排序（`listCommentThreads` + `commentThreadNumbers`）     |
| `CommentPin.vue` / `CommentThreadCard.vue` / `CommentComposer.vue` / `CommentMessage.vue` / `CommentListItem.vue` / `CommentActionsMenu.vue` / `CommentDeleteDialog.vue` / `CommentTime.vue` | 同上游                                                                        |
| `author.ts` / `ui.ts` / `usePinDrag.ts`                                                                                                                                                      | 同上游（`pinPosition` 经 store 提供）                                         |
| `src/pencil/theme/comments.ts`                                                                                                                                                               | tv 主题直迁                                                                   |

适配点：

1. **`toolCursor('COMMENT')`**：捕获层 cursor 改用 `toolCursor`（§四.3 已加）。
2. **`screenToCanvas`**：`placeDraft` 里 click → 画布坐标换算走 `store`（`Editor` 已有 `screenToCanvas`，基线 `packages/vue/src/canvas/drop/use.ts:23` 在用同 API）。
3. **卡片锚**：直接用 `useCanvasVirtualReference(canvasRef, store, anchor)`（`packages/vue/src/canvas/overlays/useCanvasVirtualReference.ts`，EditorCanvas 已有同款用法），替代上游自建的 `cardReference` 假元素——它是迁移版引擎里现成的Popover 锚定基元，行为一致（把 Pin 屏幕位置换成 `getBoundingClientRect`）。
4. **位置刷新**：上游 pins 重算依赖 `store.state.sceneVersion`（`CommentsLayer.vue:86`）。迁移版 `EditorState` 同样有响应式 `sceneVersion`（`core/src/editor/types.ts:82`），照样生效；需要平移 `panX/panY/zoom`（:76-80）换算（Pin `left = x*zoom`、容器随 pan 平移）。
5. **依赖组件**：`PersonAvatar` / `AvatarStack`（上游 `components/ui/`）若迁移壳缺失，则以最小自绘圆点/重叠头像实现，或从上游补迁该组件（实施时看 `src/pencil/components/ui/` 现有内容决定）。
6. **lucide 图标**：`message-circle`（工具与 Pin 内占位）、`check`、`trash-2`、`corner-down-left`（回复）等走自动导入 `<icon-lucide-*>`。

### 6.2 i18n

- 新增 `packages/vue/src/i18n/messages/comments.ts`（键集合照上游，25 键）并挂进 `messages.ts:20` 的 `messageDefaults`。
- `locales/{de,es,fr,it,ja,pl,ru,zh-CN}/comments.json` 新增（可直接从上游 `packages/vue/src/i18n/locales/<locale>/comments.json` 复制，注意 open-prd 目录名是 `zh-CN` 大小写映射为 `zh-cn` 的差别见 `locale.ts:19-28`），并在每个 `locales/<locale>/index.ts` 注册。
- 组件取词：`useI18n()` / `useCommentMessages = i18n('comments', ...)` 风格与现有 `messages/tools.ts` 一致。

### 6.3 Markdown 渲染

上游 `CommentMessage.vue` 用 `MarkdownContent`（`vue-stream-markdown` 包封装 + 硬化链接）。
open-prd 已装 `vue-stream-markdown@^1.0.3` 但没有该包装组件、`app/shell/markdown/index.ts` 是 `export default undefined` 桩。
**方案：把上游 `src/components/markdown/MarkdownContent.vue`（及其必要子组件）一起迁入
`frontend/src/pencil/components/markdown/`**，保持评论渲染管线与上游一致（含接 link 硬化）。
若该组件依赖迁移裁掉的上下文多于预期，回退方案是用 `marked` 自渲染（静态只读评论无流式需求），
写入 `CommentMessage.vue` 的局部实现，公开接口不变。

---

## 七、编辑器集成点（壳层各处的接线）

### 7.1 `EditorCanvas.vue`

- `import CommentsLayer from './comments/CommentsLayer.vue'`；在第二个 `<canvas>`（:124）之后挂
  `<CommentsLayer v-if="isActivePane" :canvas-ref="canvasRef" />`（open-prd 无多窗格，`v-if` 可省）。
- CommentsLayer 需要的画布走位（`pan/zoom`、`screenToCanvas`）全部经 `store` 获得，不需要新 props 协议。
- 捕获层（COMMENT 工具激活时 `pointer-events-auto inset-0`）：`@pointerdown.prevent="placeDraft"` +
  `@contextmenu.prevent`，并`@wheel` 重新派发给 canvas 元素以保持缩放/平移（同上游 `forwardWheel`）。
- Pin 右键菜单 = `CommentActionsMenu kind="context"`（`@contextmenu.stop`），不能落到 CanvasMenu 上。

### 7.2 `PropertiesPanel.vue`

```vue
<CommentsPanel v-if="store.state.activeTool === 'COMMENT'" />
<TabsRoot v-else …>   <!-- 现有三 Tabs 原样 -->
```

（侧栏从"属性面板"变"评论列表"，同上游 Figma 行为；工具退出自动还原。）

### 7.3 `Toolbar/`

- `Toolbar.vue`：`toolLabels` 加 `COMMENT: tools.value.comment`；`toolShortcuts` 加 `COMMENT: 'C'`；
  工具条模板把 COMMENT 放进文本/抓手所在的组（实施时看 DesktopToolbar/MobileToolbar 分组 helper 与
  `useToolbarState` 的移动端分类，加一个 `comment` 类目或归入现有类目）。
- `app/editor/icons.ts`：`toolIcons` 加 `COMMENT: IconMessageCircle`（`~icons/lucide/message-circle`）。

### 7.4 键盘

- `app/shell/keyboard/registry.ts` 加一条：`{ id:'view-comments', keys:'Shift+C', run: ({ }) => useComments().toggleOnCanvas() }`
  （注意 registry 已有 overlay/editing 防抖拦截逻辑 `shouldIgnoreShortcut`，沿用）。`Shift+C` 只切
  `showOnCanvas`；Comment 工具内 Pin 恒显示（组件内判断，非偏好），同上游。
- **Escape**：迁移壳无全局 onEscape 栈。CommentsLayer 在"卡片开着"时自行监听 `keydown.escape`
  （`onKeydown` capture、`event.stopImmediatePropagation()`），实现"先关卡片、再退出 Comment 工具"
  两次退出语义；`CommentComposer` 内部 Escape 仍走 `emit('cancel')`。不改 `packages/vue` 键盘管线。

### 7.5 点击流（状态机保持上游语义，anchor 到/app 层）

```
C → setTool('COMMENT') → capture 层出现
点画布（卡片开着）→ closeCard() → return          #一次点击只关卡片
点画布（无卡片）→ comments.startDraft({pageId, x, y}) → 空 Pin + composer popover（聚焦）
Enter（非 Shift）提交 → addThread → thread 创建（锚定顶层 frame/section 子层）→ 卡片转线程态，回复框聚焦
拖 Pin（>3px）→ usePinDrag → movePin（落点重新 hitTest 锚定）
菜单/列表 → focusThread → switchPage + 居中 + 开卡
Shift+C / 工具切走 → showOnCanvas / 草稿丢弃
```

`switchPage`：`open-prd` 编辑器会话有页面切换 API（`pages.ts` 在 core editor），实施时用 `store` 暴露的等价方法。

---

## 八、AI 评论工具（P3，可选）

open-prd 的 AI 面板基于 `packages/core/src/tools`（`registry.ts` / `registry-extended.ts` / `schema.ts`，
valibot 校验，Vercel AI SDK 的调用链在 `frontend/src/pencil/app/ai/tools/tools/index.ts`）。
移植上游 4 个工具（`packages/core/src/tools/comments.ts`，参数 schema 描述完全照搬），依赖 §三的
repository，无需 `openpencil-api` 层 —— 工具直接 `getComments(graph, {...}).toJSON()`。

| 工具               | 摘要                                                     |
| ------------------ | -------------------------------------------------------- |
| `get_comments`     | 读（`{ kind:'sync', mutation:'none' }`），默认只列未解决 |
| `add_comment`      | `{sync, document}`；`text`、`node?/page?/x?/y?/author?`  |
| `reply_to_comment` | 未知 id 返回 `{error}`，不瞎造                           |
| `resolve_comment`  | `resolved?: boolean`（默认 true，false 重开）            |

注册到 `registry-extended.ts` + 前端 catalog 默认启用集；i18n 键（工具描述走英文默认，无需 locale）。
字段对齐（`author`）用 §5.2 identity；缺省作者名 `"Agent"`。

---

## 九、持久化 / 撤销 / 自动保存（验证计划 V1–V4）

| #   | 验证                                                                                                    | 已有事实                                                                                                                                                                                                        | 若失败                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| V1  | 评论写入会推进 autosave：`graph.updateNode(root,{pluginData})` → sceneVersion 递增                      | autosave 挂 `state.sceneVersion`（`autosave/create.ts:20-21`）；updateNode emit `node:updated`。**sceneVersion 的递增点在 core 会话（实施时找 sceneVersion++ 的触发集合，断定"任意节点变更都推进"还是白名单）** | 在 `writeComments` 后手动 bump（或经 ctx提供的 render/request 接口），并注明未来上游对齐     |
| V2  | 撤销永不回滚评论：命令式 undo 无评论条目；页面快照 undo（`editor/history/snapshot.ts`）只恢复 page 子树 | 快照恢复不触 root pluginData；实施时写一条手动脚本验证（造评论 → 画形状 → 撤销 → 评论在）                                                                                                                       | 若有其他"恢复图"路径（readDocument 重载）依赖旧快照，重载后 comment 重读即可（本就全量重读） |
| V3  | `.fig` 往返不丢评论：`exportFigFile` → 重开 → 评论仍在（根 pluginData）                                 | `export-node.ts:837`、`convert.ts:678` 已通 pluginData                                                                                                                                                          | 手动：保存 → 刷新 → Pin 还在                                                                 |
| V4  | Comment 工具激活时画布无副作用绘制/误选中                                                               | `tool-input/use.ts` if 链默认落空                                                                                                                                                                               | 加 `tool === 'COMMENT' → return` 短路                                                        |
| V5  | 自动保存原子性无回归（tmp+rename 已）                                                                   | `prototypeStore.ts:41-50`                                                                                                                                                                                       | —                                                                                            |

后端**零改动**：评论在 `.fig` 里，(`/api/prototypes/:id` 读写原型文件，无需新端点/新表；
`backend/src/routes/prototypes.ts` 不碰)。

---

## 十、分阶段任务

### P0 — 数据层与工具枚举（引擎，可独立合入）

- `packages/scene-graph/src/comments/`（schema/threads/repository/list/index）+ 桶文件导出；
  pluginData 读写小工具；`randomHex` 复用。
- `Tool` 加 `'COMMENT'`；`EDITOR_TOOLS`/`TOOL_SHORTCUTS`/`TOOL_CURSORS`；tools i18n 键。
- **验收**：typecheck 通过；`writeComments` 写入后 `readComments` 往返；V1/V4 定论。

### P1 — 应用状态 + 评论主链路（可用）

- `app/comments/{use,document,format,identity}.ts` + `app/settings/preferences.ts`。
- `components/comments/*` + `theme/comments.ts` + i18n comments 命名空间（≥ zh-CN，英文默认）
  - markdown 渲染（§6.3 方案）。
- 集成：EditorCanvas 挂层、PropertiesPanel takeover、Toolbar 三处集合、Escape 处理。
- **验收**：走完 §7.5 全链路（含拖 Pin、解决/重开/删除、列表筛选编号、Shift+C）；V2/V3 使用浏览自动化工具验证过。

### P2 — 打磨

- View→Comments 复选项（`shell/menu/schema.ts` + `app-menu.ts` checked 逻辑）；SVG 评论光标资产；
  Avatar 组件补齐/最大化对齐上游视觉；`commentPreview` 移植；Mobile（`MobileHud/MobileDrawer`）里
  CommentsPanel 复用（上游做法：Comment 工具激活时抽屉换评论列表）。

### P3 — AI 工具（可选）

- `packages/core/src/tools/comments.ts` 4 工具 + registry-extended + 前端 catalog 默认启用；
  manual 验证"问 AI 拿未解决评论/让它回复"。

### P4（显式不做）

- 多人协作/多端合并/Y 房间同步 —— 未来如做，骨架已在（document.ts 事件形状与上游同构）。
- Present/放映视图中显示评论 Pin（上游 present 视图也无 Pin）。
- 脚本 API（`openpencil.getComments` 等 eval 层）—— open-prd 无此需求。
- Electron 只读锁定等。

---

## 十一、风险对照

| 风险                                                                                    | 影响                | 处置                                                                                      |
| --------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| 引擎基线与上游最新差异（tool-input if 链 vs `CANVAS_TOOLS`、无 closest、无 prefs 体系） | 移植不是复制即用    | §3/§4/§5 已按基线落地；所有适配点集中在 `repository.ts` / `threads.ts` 局部函数与壳层接线 |
| `sceneVersion` 白名单可能不含 pluginData 变更                                           | 保存不触发          | V1 验证 + 手动 bump 兜底（改动小、可回补）                                                |
| TypeScript 6.0 vs 上游 5.8                                                              | 新文件类型报错      | 新文件按 `packages/tsconfig.json` 规则写（`noUnusedLocals:false` 宽松档，strict 保留）    |
| 上游 `CommentsLayer` 依赖未迁组件（PersonAvatar/AvatarStack/MarkdownContent）           | 一处编译断          | §6.1.5、§6.3 两个替代方案；优先"整组补迁"                                                 |
| `useCanvasVirtualReference` 与上游 PopoverContent 参考语义差（多一层封装）              | 卡片位置偏          | EditorCanvas 已有同用法先例（padding 编辑器），按同模式传 anchor                          |
| 删除层后 Pin 落点 drift（坐标基准换层数）                                               | 视觉小 bug          | `detachFromLayer` + `rememberPositions` 照迁 + 使用浏览自动验收"删层 Pin 留位"            |
| `PropertiesPanel` takeover 与 AI activeTab 状态互踩                                     | 退出工具后 Tab 错位 | takeover 用 `v-if` 短路、不动 TabsRoot state；退出即还原                                  |

---

## 十二、验收清单（对齐上游 e2e 场景，使用浏览自动化工具执行）

1. `C` 选 Comment 工具：侧栏变评论列表；画布捕获态，点击 → 空 Pin + 输入框聚焦。
2. 输入文本 Enter：创建线程，卡片转线程态、回复框聚焦；列表出现一项（编号 #1）。
3. 点别处：先只关卡片（Pin 保留）；再点又开新草稿。
4. 回复保留换行；Shift+Enter 在列表项中续行、空项退出列表；Escape 关卡片 → 再按退工具；工具内 Pin 恒显示。
5. `Shift+C`：非 Comment 工具下隐藏/恢复 Pin。
6. 拖 Pin 40px：精确定位；拖后落点重新吸附；滚轮在 Pin 上仍可缩放/平移画布。
7. 列表：搜索命中正文/作者/层名；"仅当前页 / 仅我的 / 已解决"筛选；newest/oldest；删除后编号不漂移。
8. Pin 右键：评论菜单（非图层菜单）；删除 → 确认弹窗 → Pin 与列表清空（空态文案出现）。
9. 解决：Pin 置灰、默认从画布与列表消失，"显示已解决"开关可找回。
10. 层移动 Pin 跟随；删层 Pin 留位。
11. 保存（自动 3s / Ctrl+S）→ 重新打开原型：评论还原（V3）。
12. 画形状 → Ctrl+Z 撤销：评论不受影响（V2）。
13. 暗色/亮色主题下 Pin/卡片可读（theme/comments.ts 用 panel/accent 令牌，与编辑器同源）。

依赖命令（提交前）：

```
pnpm --filter frontend typecheck
pnpm --filter frontend typecheck:pencil
pnpm --filter frontend lint
pnpm build
```
