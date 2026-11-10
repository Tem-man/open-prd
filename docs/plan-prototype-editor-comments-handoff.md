# 交接文档：原型编辑器评论功能移植（open-pencil → open-prd）

> **交接节点**：2026-11-10 · 分支 `add-comment` · **⚠️ 全部变更均未提交**（37 个修改 + 35 个新增 = 72 个文件）
> 完成度：**P0 ✅ P1 ✅**（已通过 gate + 基线实证）｜§12 使用浏览自动验收 ⬜｜V1/V4 部分验证｜P2 部分遗留｜P3 未开始｜P4 显式不做

---

## 0. 30 秒摘要

open-pencil 的画布评论已被按裁剪方案移植进 open-prd 单机原型编辑器：引擎数据层
（`packages/scene-graph/src/comments/`，草案上方 pluginData 存储、墓碑式删除、容错解析）、
应用状态层（`frontend/src/pencil/app/comments/`）、11 个 UI 组件 + i18n（8 语言）、
完整壳层接线（COMMENT 工具 / Escape 两段 / Shift+C / View 菜单 / 右侧栏接管）均已落地。

类型检查对**干净基线做过 stash 对照实证：错误集合 40 项对 40 项，仅有一个预存在错误的行号
从 registry.ts(188) 漂移到 (193)** —— 本功能未引入任何新类型错误。backend typecheck/build 均
绿色。P0 数据层的 write→read 往返已用无头脚本程序化验证（附录 A，A–I 全过）。

**下一个 agent 建议动作**：① 先提交（见 §10）→ ② `pnpm dev` 走 §12 验收 13 条 → ③ 修 bug 或继续 P2/P3（见 §9）。

---

## 1. 环境与命令

- 仓库：`D:\AI\Donjet\open-prd`，分支 `add-comment`（HEAD = 干净基线，功能全在未提交工作区）。
- **pnpm only**（AGENTS.md 明令禁止 npm install）。
- 引擎包（`packages/*`）**不构建**（无 dist 策略），Vite/tsconfig 用别名直读 src；别给它们加 build 脚本。
- TypeScript 严格基线为 **tsc 6.0.3**（via `vue-tsc`）。包内 tsconfig 对 `packages/*` 放宽 unused 检查，`frontend` 侧严格。
- 常用命令：
  ```bash
  pnpm dev                              # frontend + backend 并行开发
  pnpm --filter frontend dev            # 仅前端（使用浏览自动验收评论功能够用）
  pnpm --filter frontend typecheck      # 严格门（vue-tsc -b，全仓受影响面）
  pnpm --filter frontend typecheck:pencil  # packages/*/src + src/pencil 全量
  pnpm --filter frontend build          # = vue-tsc -b && vite build
  pnpm --filter backend typecheck       # 绿
  pnpm --filter backend build           # 绿
  ```
- Windows/PowerShell 注意：`pnpm` 输出偶尔包一层红色 `NativeCommandError` 噪声，**无害**；判定成败看 `$LASTEXITCODE`。
- 上一会话的验证产物在临时目录（**机器本地、可能已被清理**）：
  `C:\Users\jimman\AppData\Local\Temp\opencode\gate-baseline\`（current-errors.txt / baseline-errors.txt / typecheck-{current,baseline}.txt / comments-roundtrip.ts）。可按 §7、附录 A 复现。

## 2. 必读文档（顺序）

1. `AGENTS.md` —— 工作区规则、目录结构、图标规范（`<icon-lucide-*>` 经 unplugin-icons）。
2. `packages/PENCIL_UPSTREAM.md` —— 引擎迁移基线与本地偏差记录，**动 packages/ 前必读**。
3. `docs/plan-prototype-editor-comments.md` —— 本功能的母本：§1 基线核对、§3–§7 设计与接线、
   §7.5 点击流状态机、§10 阶段任务、§11 风险表、**§12 验收清单 13 条**。
4. 本文档（增量 + 坑 + 验证记录）。
5. 上游参考源码：`d:\AI\Donjet\open-pencil\src\components\comments\` 与 `src\app\comments\`
   （裁剪掉的：多人协作、Y 房间、Favorite/per-thread color 分配的 randomIndex 方案）。

## 3. 已完成范围与关键决策

### 3.1 P0 — 引擎数据层（全部完成＋验证）

`packages/scene-graph/src/comments/{schema,threads,repository,list,index}.ts`，桶文件 `./comments`
导出已接入 `packages/scene-graph/package.json` exports；根 `src/index.ts` 追加
`export type { CommentAuthor, CommentReply, CommentThread } from './comments'`。

- **存储位置**：document 根节点 `pluginData` 下的
  `{ pluginId: 'open-pencil', key: 'comments', value: JSON.stringify(threads) }`
  （常数在 `repository.ts`：`OPEN_PENCIL_PLUGIN_ID` / `COMMENTS_PLUGIN_KEY`）。
  随 `.fig` 与存储副本自然持久化，Figma/旧版本打开不受影响。
- **读/写**：`readComments(graph)` / `writeComments(graph, threads)`——写是普通
  `updateNode`，**不是 undo 步**；空列表会移除 entry；同在 pluginData 的其他插件条目原样保留。
- **解析是刻意宽容**（`schema.ts` 的 `parseCommentThreads`）：单条畸形跳过、缺字段回填、
  缺失 `nodeId/nodeName` 规范化为 `null`（注意：roundtrip 比较应与
  `parseCommentThreads(threads)` 的 canonical 形式比，不能比原对象——附录 A 的断言 A/B 就是这么写的）。
- **坐标模型**：`commentAnchor(graph, pageId, at, node?)` —— 第 3 参是 `Vector {x,y}`
  （app 层传 `PagePoint` 结构兼容）；pin 落在命中的**顶层 layer** 上（offsetX/Y 相对层左上），
  层动 pin 随动、层删 pin 落回 `x/y`。`commentPosition(graph, thread)` 是读端反算。
- **删除 = 墓碑**（thread 与 reply 的 `deleted: true` 常驻数据，防旧副本复活）；
  编号占位：`commentThreadNumbers`（`list.ts`）给已删线程保留槽位。
- **ID**：`c_`/`r_` + 16 hex；`threads.ts` 内部 `newCommentId` 直接用
  `crypto.getRandomValues`（引擎包不能依赖 core 的 `#core/random`）。
- 其余引擎工具函数：`commentTimestamp / byCreatedAt / liveReplies / takesPartInThread /
findLiveCommentThread / createCommentThread / createCommentReply / editCommentThread /
replyToCommentThread / resolveCommentThread / deleteCommentThread / deleteCommentReply`。

### 3.2 P1 — 应用层 + UI + 壳层接线（全部完成）

- **状态**：`frontend/src/pencil/app/comments/{use,document,format,identity}.ts` +
  新建 `app/settings/preferences.ts`（评论偏好：showOnCanvas/showResolved/onlyPage/onlyMine/sort，
  localStorage 持久化）。
- **useComments() 全局态**（`use.ts`，返回成员已核实）：
  状态 `threads / activeThreadId / draft(PagePoint|null) / author / showOnCanvas /
onDeleteRequested / pinPosition / listQuery / listShowResolved / listOnlyPage / listOnlyMine / listSort`；
  动作 `startDraft / toggleThread / closeCard():boolean / addThread / movePin / reply /
setResolved / requestDelete / confirmDelete / deleteReply / focusThread / toggleOnCanvas`。
  文档切换复位由 `document.ts` 的 `followDocumentComments(storeRef, resetCb)` 管。
- **身份**：`identity.ts` `useCommentIdentity` —— 本地单作者，localStorage 键
  `open-pencil:comments:{name,color}:v1`；`AUTHOR_COLORS` 从 `identity.ts` 导出，
  **默认取 `AUTHOR_COLORS[1]`**（上游用 `PEER_COLORS[0]`，交接方用本地 `AUTHOR_COLORS[0]` 兜底；
  scene-graph 没有 `randomIndex`，勿引用）。
- **UI**：`components/comments/` 11 个 .vue（Avatar/Time/Pin/Message/Composer/ThreadCard/
  ActionsMenu/ListItem/Layer/Panel/DeleteDialog）+ `author.ts/ui.ts/usePinDrag.ts/markdown.ts`；
  主题 token 在 `theme/comments.ts`（默认导出 slots/variants + 常量 `COMMENT_PIN_SIZE = 32`）。
  **pin hover 预览（上游 commentPreview 的等价物）已落地**：`CommentPin.vue` 的 `pinPreview*`
  slots，hover 展开两行预览。
- **markdown**：`markdown.ts` `renderCommentMarkdown()` → 先 `escapeHtml` 再
  `new Marked({ breaks: true }).parse(text, { async: false })`，链接只放行
  `^(https?:|mailto:)`，外链加 `target="_blank" rel="noopener noreferrer"`。
  **依赖是已装好的 marked ^18**（frontend/package.json），没有新装包。
- **i18n**：`comments` 命名空间 30 键（含 close/cancel/copied），文案默认英文 +
  de/es/fr/it/ja/pl/ru/zh-cn 八语言。`useCommentMessages` 从 `@open-pencil/vue` 根导出。
  locale 常量叫 `'zh-CN'`（`packages/vue/src/i18n/locale.ts`），磁盘目录是小写 `zh-cn`
  （`create.ts` 的 import 映射负责转接）——新语言照抄这个模式。
- 集成接线（→ 文件/锚点见 §5）。

### 3.3 关键决策（为什么和上游不一样）

| 决策                                                           | 理由                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 不引 Yjs/协作者，单机单身份                                    | 单机版上限就到这；`document.ts` 事件形状与上游同构，未来加协作者有骨架                            |
| 作者色确定性 `AUTHOR_COLORS[1]` + 本地 `AUTHOR_COLORS[0]` 兜底 | 上游 `randomIndex` 在 scene-graph 中不存在                                                        |
| markdown 用 marked v18                                         | 壳层没有上游的 MarkdownContent/PersonAvatar 等组件树，整补不划算                                  |
| Escape 两段（先关卡片再退工具）                                | 上游 7.5 点击流语义；`escapeOrDeselect()` 在 `activeTool==='COMMENT'` 且 `closeCard()` 命中时早退 |
| Draft 首击吞掉（`placeDraft`）                                 | 开着卡片时点画布先关卡片，不新建草稿                                                              |

## 4. 文件清单（72 个，全部未提交）

**新建（35）**

- `packages/scene-graph/src/comments/{schema,threads,repository,list,index}.ts`（5）
- `frontend/src/pencil/app/comments/{use,document,format,identity}.ts`（4）
- `frontend/src/pencil/app/settings/preferences.ts`（1，新文件夹）
- `frontend/src/pencil/components/comments/`：11 个 `Comment*.vue`/`Comments*.vue` +
  `author.ts` `ui.ts` `usePinDrag.ts` `markdown.ts`（19）
- `frontend/src/pencil/theme/comments.ts`（1）
- `packages/vue/src/i18n/messages/comments.ts`（1）+ 8 个 `locales/<lang>/comments.json`（8）

**修改（37）**

- 引擎：`packages/core/src/editor/{types,tool-registry}.ts`（Tool 联合 + EDITOR_TOOLS/TOOL_SHORTCUTS/TOOL_CURSORS）；
  `packages/scene-graph/{package.json,src/index.ts}`（桶导出 + 根类型再导出）
- Vue 绑定层：`packages/vue/src/canvas/tool-input/use.ts`（**在 catch-all `startShapeDraw` 之前**
  加 `tool === 'COMMENT'` 分支——顺序是语义，勿动）；`editor/tool-cursor/index.ts`
- i18n：`packages/vue/src/i18n/{messages.ts,useI18n.ts,index.ts,index.ts 根}`、
  `messages/tools.ts` + 8 语言 `tools.json`/`index.ts`（comment 工具键：de Komentar、es Comentario、
  fr Commentaire、it Commento、ja コメント、pl Komentarz、ru Комментарий、zh-cn 评论）
- 壳层：`app/shell/keyboard/{actions,registry,types}.ts`（Escape 两段 + Shift+C +
  `KeyboardShortcutActions` 增加 `toggleComments`）、`app/shell/menu/{schema,app-menu}.ts`
  （View→Comments 复选项 `view-comments`）、`app/editor/icons.ts`（`COMMENT: IconMessageCircle`，L35）、
  `components/Toolbar/Toolbar.vue`（L40 文案映射 / L55 快捷键 'C' / labels+shortcuts）
- 挂载点：`components/EditorCanvas.vue`（第二个 canvas 之后挂
  `<CommentsLayer :canvas-el="canvasRef" />` + `<CommentDeleteDialog />`）、
  `components/PropertiesPanel.vue`（L25：`CommentsPanel v-if="activeTool==='COMMENT'"`，TabsRoot 放 v-else）
- 样式：`pencil.css`（`--text-2xs: 0.6875rem` 新令牌）

## 5. 契约速查（继续开发时对照）

- **pluginData entry**：`{ pluginId, key, value }`，value 是 JSON 字符串数组 of `CommentThread`。
- **CommentThread 字段**（`schema.ts` 即权威）：坐标三元组 `nodeId/nodeName/offsetX/offsetY` +
  落点 `x/y` + `pageId/pageName`（pageName/pinned 时快照）；`resolved/resolvedAt`、
  thread 级与 reply 级 `deleted` 墓碑、thread `updatedAt` 每次变更 bump（`editCommentThread`）。
- **虚元素/DOMRect**：draft 与打开卡片都用「canvas rect + pin 屏幕坐标 − `COMMENT_PIN_SIZE`(32)」
  构造 rect 当 virtual element；**pins 层按 `store.state.panX/panY` 整层平移**，pin 自身只放缩放坐标。
- **拖 pin**：`usePinDrag.ts` 松手后按松手点重新 `commentAnchor` 吸附（movePin）。
- **Esc 序**：composer/card 上 `@keydown.escape.stop.prevent` 自关 → 全局 Esc →
  `escapeOrDeselect()`（定义 `app/shell/keyboard/actions.ts` L60）早退，不退COMMENT 工具。
- **键盘注册**：C 工具键走 `TOOL_SHORTCUTS`（core）经 `bindToolShortcuts`；
  `view-comments` 注册项 `appMenuTinykeysShortcut('view-comments') ?? 'Shift+KeyC'`
  （`registry.ts` L163–165；菜单 schema.ts 里快捷键label为 `SHIFT+C`）。
- **useEditorStore()**返回 Proxy 布局的 store（active-store），从 `useActiveEditorStoreRef()` 取；
  `screenToCanvas / switchPage / zoomToBounds` 都在 store 上（`focusThread` 已在用）。

## 6. Gates 验证记录（2026-11-10）

| Gate                        | 结果                        | 说明                                                                                           |
| --------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| `frontend typecheck`        | 红，40 错误                 | 与干净基线 **完全同集**（见下基线证明）；唯一差异=registry.ts 预存在 tinykeys 错误行号 188→193 |
| `frontend typecheck:pencil` | 红，基线错误                | 评论文件已 0 错误                                                                              |
| `frontend build`            | 红于 vue-tsc（vite 未执行） | `vue-tsc -b &&` 短路；错误集=typecheck 同集                                                    |
| `backend typecheck`         | **绿 exit 0**               | 本功能未动 backend                                                                             |
| `backend build`             | **绿 exit 0**               | 同上                                                                                           |
| 根 `pnpm build`             | 红                          | = frontend build(红基线) && backend build(绿)；属分支基线                                      |
| `pnpm lint`                 | 红/不存在                   | frontend 无 lint script；backend eslint.config 缺失——**均预存在**，勿修（除非被点名）          |

**基线证明（可复现，已完整跑通过一次）**：

```powershell
# 0) 清增量缓存，保证两次可比
Get-ChildItem -Recurse -Filter *.tsbuildinfo | ? { $_.FullName -notmatch 'node_modules' } | Remove-Item -Force
# 1) 当前树（含评论）：
pnpm --filter frontend typecheck 2>&1 | Out-File typecheck-current.txt
Select-String -Path typecheck-current.txt '^\S*\(\d+,\d+\): error TS' | % Line | Sort-Object -Unique > current-errors.txt
# 2) 干净基线：
git stash push -u -m "baseline-proof"      # -u 含新建文件；push 后应 status=0 变更
（重复 1）→ baseline-errors.txt
git stash pop                              # 用 git status --porcelain -uall 前后 diff 验证完全还原
# 3) Compare-Object 两组错误集
```

结果存证：40:40，仅 2 行差异且是**同一条**错误（TS18046 'handler' is of type 'unknown'，tinykeys 无类型导致的级联，在 registry.ts 内行号漂移）。**改 registry.ts 会继续推后该行号，这是预期，不是新错**。

**基线 40 错误的构成桶**（修 bug 时认清什么不是你的）：tauri 插件模块缺 TS2307（export/io 各文件）、
`~icons/lucide/*` 的 TS2307（icons.ts L2）、storybook 相关、`@/router`、tinykeys TS7016 +
registry TS18046 级联、menu/files.ts 参数数不匹配、Uint8Array/BlobPart、`@/stores/prototypes`。
完整清单见 `current-errors.txt`。

## 7. 踩坑与排障手册（新会话第一件事回顾）

1. **TS 6.0.3 对嵌套括号顺序敏感**：曾把 `replaceAll(..., cb => ternary)
}` 写成 `})` 开关反了，报 TS1005 `',' expected.` 指在 next-line 下一个 token —— 字面正确但
   解析歧义。**单文件复现**：
   ```powershell
   pnpm --filter frontend exec tsc --noEmit --ignoreConfig --target es2022 --module esnext `
     --moduleResolution bundler --skipLibCheck --lib "es2022,dom" <file.ts>
   ```
   再深化可用 `ts.createSourceFile` AST dump 树查真正的兄弟节点错位（上次就是这招抓到）。
2. **marked v18**：必须具名导入 `{ Marked }`；不写 `marked.Marked` 全路径。`new Marked({ breaks: true })`。
3. **strict unused**：`app/` 与 `frontend/` 下新增文件的未用 import/参数会被 TS6133 卡
   （如 repository 的未用 graph 参数→删、threads 的未用 Color import→删、preferences 的
   CommentThread→删）。`packages/*` 下文件走强壮 `packages/tsconfig.json` 放宽档。
4. **vue-tsc -b 是增量的**：做 stash 对照或看稳定数字前，先删全仓 `*.tsbuildinfo`
   （排除 node_modules）否则会读缓存数字。
5. **stash 还原**：`-u` 会连新文件一起 stash；pop 后用
   `git status --porcelain=v1 -uall` 前后 diff（这次 0 差异）。CRLF 警告 benign。
6. **`createCommentThread` 的参数形状**：app 层创建线程用 `createCommentThread(store.graph, {...})`，
   **第 3 个参数是 `Vector {x,y}`**（页面点即可），app 层 PagePoint 结构兼容。
7. **PowerShell 里跑 pnpm**：`2>&1` + `Out-String/Out-File` 才能拿全；中间偶发
   NativeCommandError 包装噪声、末尾 `Command xxx not found` 假报（参见上次 tsx 运行明明成功），
   一切以脚本自身输出与 `$LASTEXITCODE` 为准。
8. **resolved 与侧栏偏好联动**：`setResolved` 把线程置灰后，若「已解决」开关没开
   （`listShowResolved=false`）且这个线程正开着，卡片会被自动关掉；改这段逻辑时别丢这个口径。

## 9. 未完成事项

### 9.1 §12 使用浏览自动验收（13 条，需真人 `pnpm dev` 点验）

逐条见 `docs/plan-prototype-editor-comments.md` L360–374，要点：
C 工具切换侧栏 / 输入 Enter 建线程 / 点别处先关卡 / 回复换行与 Shift+Enter /
Shift+C 全局显隐 / 拖 pin 40px 精确、滚轮不劫 / 列表搜索+筛选+排序+删除不漂号 /
pin 右键删除确认流 / 解决→灰→「显示已解决」找回 / 层动 pin 跟、层删 pin 留 /
**保存后重开评论还原（V3）** / **画形状 Ctrl+Z 撤销不伤评论（V2）** / 双主题可读。
**重点指标**：V2（undo）与 V3（持久化）；
1 个已知风险卡位：**V1 —— `sceneVersion` 白名单是否覆盖 pluginData 变更**（自动保存 3s/退出是否真触发）；
未覆盖时兜底方案已在 plan §11 备好（手动 bump）。
另一个后续验证项：V4 —— `.fig` 里 Figma 真读 comments entry（上游同结构，未实测）。

### 9.2 P2 打磨（剩余 3 项）

- SVG 评论光标资产（当前 `TOOL_CURSORS` 里 COMMENT 用 `'copy'` 占位）；
- Mobile（`MobileHud/MobileDrawer`）复用 CommentsPanel（上游：Comment 工具激活时抽屉换评论列表）；
- Avatar 组视觉对齐微调。
- ~~View→Comments 复选项~~（**已做**）；~~commentPreview~~（**已做**，`pinPreview*` slots hover 预览）。

### 9.3 P3 AI 工具（可选，未动）

`packages/core/src/tools/comments.ts` 4 工具 + registry-extended + 前端 catalog 默认启用；
manual 验证「问 AI 拿未解决评论 / 让它回复」。

### 9.4 P4 负面清单（别做）

多人协作/合并/Y 房间；Present 视图 pin；eval 层脚本 API；Electron 只读锁定。
（骨架留了：`document.ts` 事件形状与上游同构。）

## 10. 建议执行顺序（给下一个 agent）

1. **先提交**（72 文件都未提交，任何 stash/切换都是风险）：
   ```bash
   git add -A && git commit -m "feat(pencil): port canvas comments from open-pencil (P0+P1)"
   ```
   （如要分粒度：P0 引擎层一笔、P1 应用+UI 一笔、i18n 一笔均可。）
2. `pnpm --filter frontend dev` 走 §12 的 13 条，记录结果，发现的 bug 就地小修
   （修时遵循 §7 基线规则：**只修评论引起的错**，基线 40 让它保持原样或用 stash 对照法自证）。
3. 验 V1（对 pluginData 写入是否触发自动保存/sceneVersion）——决定是否需要手动 bump 的兜底提交。
4. 然后 P2（三个小项）→ 或 P3（AI 工具，涉及 core tools registry 的新面）。
5. Pencil 相关 UI 改动顺手对照 upstream 组件差异（§2 第 5 条的 open-pencil 目录）。

## 附录 A：P0 无头往返回归脚本

> 运行：在仓库根执行 `pnpm --filter backend exec tsx <本脚本路径>`。
> 上次执行：`C:\Users\jimman\AppData\Local\Temp\opencode\gate-baseline\comments-roundtrip.ts`，**A–I 全过**。
> 引擎数据层三个文件只有 `import type`，可用最小 graph stub 脱离 Skia/编辑器跑。

```ts
// A–I 断言：write→read 往返（vs canonical parse）、payload 独立解析、宽容解析 5 中取 2、
// 其他插件条目共存、墓碑保留、空写入移除 entry。
import assert from "node:assert/strict";
import {
	readComments,
	writeComments,
} from "file:///D:/AI/Donjet/open-prd/packages/scene-graph/src/comments/repository.ts";
import { parseCommentThreads } from "file:///D:/AI/Donjet/open-prd/packages/scene-graph/src/comments/schema.ts";

const root = { id: "root", pluginData: [] };
const graph = {
	rootId: "root",
	getNode: (id: string) => (id === "root" ? root : undefined),
	updateNode: (id: string, patch: { pluginData: [] }) => {
		Object.assign(root, patch);
	},
};

const color = { r: 0.1, g: 0.2, b: 0.3, a: 1 };
const thread = {
	id: "c_deadbeefdeadbeef",
	pageId: "page1",
	pageName: "Page 1",
	nodeId: "layer1",
	nodeName: "Header",
	offsetX: 12,
	offsetY: 34,
	x: 100,
	y: 200,
	author: "Me",
	authorColor: color,
	text: "Hello **world**",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	resolved: false,
	resolvedAt: null,
	replies: [
		{
			id: "r_0101010101010101",
			author: "Me",
			authorColor: color,
			text: "line1\nline2",
			createdAt: "2026-01-02T00:00:00.000Z",
		},
		{
			id: "r_0202020202020202",
			author: "Bob",
			text: "removed",
			createdAt: "2026-01-02T01:00:00.000Z",
			deleted: true,
		},
	],
};
const resolvedThread = {
	id: "c_feedfacefeedface",
	pageId: "page1",
	x: 5,
	y: 6,
	author: "Bob",
	text: "done?",
	createdAt: "2026-01-01T09:00:00.000Z",
	updatedAt: "2026-01-01T09:00:00.000Z",
	resolved: true,
	resolvedAt: "2026-01-01T10:00:00.000Z",
	deleted: true,
	replies: [],
};
const threads = [thread, resolvedThread];

writeComments(graph, threads);
const stored = readComments(graph);
// 注意：解析器会把缺失 nodeId/nodeName 规范化为 null —— 与 canonical parse 比，不是与原对象比。
assert.equal(
	JSON.stringify(stored),
	JSON.stringify(parseCommentThreads(threads)),
	"A",
);
assert.equal(root.pluginData[0].pluginId, "open-pencil");
assert.equal(root.pluginData[0].key, "comments");

const fromPayload = parseCommentThreads(JSON.parse(root.pluginData[0].value));
assert.equal(
	JSON.stringify(fromPayload),
	JSON.stringify(parseCommentThreads(threads)),
	"B",
);

const lenient = parseCommentThreads([
	"not an object",
	{
		id: "c_ok0000000000000001",
		pageId: "p",
		x: 1,
		y: 2,
		createdAt: "t",
		resolved: "yes",
		replies: [],
	},
	{ pageId: "p" },
	{
		id: "missing-page",
		x: 1,
		y: 2,
		createdAt: "t",
		resolved: false,
		replies: [],
	},
	{
		id: "c_badreply0000000001",
		pageId: "p",
		x: 1,
		y: 2,
		createdAt: "t",
		resolved: false,
		replies: [{ author: "x" }, "junk"],
	},
]);
assert.equal(lenient.length, 2, "C");
assert.equal(lenient[0].resolved, false, "D");
assert.deepEqual(lenient[0].replies, [], "E");

root.pluginData = [{ pluginId: "library", key: "items", value: "{}" }];
writeComments(graph, threads);
assert.equal(root.pluginData.length, 2, "F");
assert.equal(readComments(graph)[1].deleted, true, "G");
writeComments(graph, []);
assert.equal(root.pluginData.length, 1, "H");
assert.deepEqual(readComments(graph), [], "I");
console.log("comments-roundtrip: all checks passed (A–I)");
```

---

_本文档为一次性交接快照；§12/§9 的结论变化时请在本文件追加更新日志，而不是重写历史段落。_
