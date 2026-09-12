# PRD 版本管理 — 实施规划

> 需求来源：用户对话（2026-09-06）
> 目标：
>
> 1. 顶栏 NavBar「导出」**左侧**新增「版本」按钮，点击后从**左侧**弹出抽屉窗；
> 2. 版本管理采用 **Figma Page 模型**（而非 git checkout 模型）：**每个版本都是一份独立的活文档**，平行共存、各自持续保存；点击版本记录 = 打开该版本（如同切换到另一个 Page），随后可直接在其上编辑；
> 3. **版本只由用户手动创建**（「新增版本」= 复制当前内容或空白新建），AI 改写 / 手动编辑 / 全量生成等均**不自动产生版本**；唯一例外是**懒引导**——首次拉取版本列表时若 PRD 已有内容但无任何版本，自动物化当前内容为 v1「当前内容」（见 2.2）；
> 4. 行内操作仅保留 **克隆、删除**，头部保留 **新增版本**。层级分工（与 Figma 一致）：**版本 = 会话内的 Page，会话 = File**——「新增版本」是文件内 Duplicate Page，「克隆」是文件级 Duplicate File，两者是同一复制操作在不同层级上的体现，不冗余（详见 2.3 分工表）：
>    - **点击切换（打开版本）**：工作区内容写回旧版本行后，把目标版本加载进工作区（PRD HTML + `prd_sections` + `selected_modules`），随后可正常 AI 对话改写 / 手动内联编辑 / 模块管理；切换永远无损，无需未保存确认框；
>    - **克隆为新会话（fork）**：以**任意**版本行为基础复制出一个独立新会话（含 PRD、对话记录、模块选择），当前会话不受影响，用于另起独立演进线；
>    - **新增版本**：作用于**当前工作区**，「空白版本」（默认）或「复制当前内容」（Figma Duplicate Page），创建后即打开；
>    - **删除**：物理删除该版本记录（不可恢复）；删除激活版本时自动切换到最新剩余版本。
>
> 状态：**✅ 已实施**（2026-09-06 完成开发，含懒引导与空白默认两项迭代调整）

---

## 一、现状盘点

| 层                 | 现状                                                                                                                                                                                                                | 问题 / 差距                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **DB · 整篇 PRD**  | `prds` 表每会话一行，`html` 字段被反复原地覆盖（`backend/src/services/prd/index.ts` L107–126 `persistResults`）                                                                                                     | 无版本概念；本方案中 `prds` + `prd_sections` 改演「当前打开版本的工作区」                                                               |
| **DB · 模块级**    | `prd_sections` 已有 `version` + `is_current` 版本设计（`backend/src/db/schema.ts` L101–124）；AI 改写（`sessions.ts` L1218/L1388/L1508）与手动编辑（L1588–1604）都会写新版本；单步回滚端点已存在（L1611–1668）      | **全量/单模块重新生成**走 `upsertPrdSection`（`prd/index.ts` L60–86）原地 UPDATE，不产生新版本——section 级历史在重新生成后断档          |
| **DB · 会话状态**  | `sessions.selected_modules` 存 `SelectedModule[]` JSON（`prdOutline.ts` L40–53 读取）；`sessions.outline` 存 `PrdOutline` JSON（L144–149 写入）；`messages.role` 允许 `user/assistant/system`（`schema.ts` L82–90） | 切换/克隆时需要同步或复制这两类会话级状态；对话记录随版本走（`messages_json` 快照，切换时随工作区重建）                                 |
| **后端 API**       | PRD 路由族已有：`GET /:id/prd`、`GET /:id/prd/sections`、`PATCH /:id/prd/sections/:sid`、`PUT .../content`、`POST .../rollback`                                                                                     | 无任何版本列表 / 创建 / 激活 / 克隆 / 删除端点                                                                                          |
| **前端入口**       | NavBar 右侧仅有「导出」（`frontend/src/components/NavBar/NavBar.vue` L106–128），显示条件 `isSessionPage && hasPrd`；通过 `emit('openExport')` → `App.vue` 托管 `ExportModal`（`App.vue` L16–21）                   | 无版本管理入口；但 NavBar 的「条件显示 + emit + App 托管弹层」模式可直接复用                                                            |
| **前端面板**       | `PrdPanel.vue` 无工具栏，纯内容区（`PrdSectionList` / iframe / 空状态，L60–122）；`SessionSidebar.vue` 模块编辑条内有 section 级「↩ 撤回」（L547–553）                                                              | 无版本列表 UI；section 级撤回是「当前工作区」内的编辑反悔，与版本管理互补（注意：切换版本后工作区重建，撤回历史随之重置，见七、风险表） |
| **抽屉先例**       | `HistoryDrawer.vue`（历史会话抽屉）已存在，`ModuleManager.vue` L806 复用其动画                                                                                                                                      | 新抽屉可复用同款交互模式，但方向按需求改为**左侧**弹出                                                                                  |
| **组装 HTML 结构** | `renderer.ts` L36–45 按选定顺序输出 `<section class="tab-panel" id="panel-{i}">`，**只有序号没有 section_id**                                                                                                       | 从整篇 HTML 反解模块不可靠，故每个版本行冗余存储 `sections_json` 作为该版本的权威内容                                                   |

---

## 二、方案设计

### 2.0 核心模型：工作区交换（swap）

```
prd_versions 表（每个版本一份独立文档）        prds + prd_sections（当前打开版本的工作区）
┌────────────────────┐   激活 v3 时：         ┌──────────────────────────┐
│ v1  html+sections  │ ──① 写回旧版本行────►   │ （旧版本内容持久化）        │
│ v2  html+sections  │                        │                          │
│ v3  html+sections  │ ──② 读出并重建工作区──►  │ prds.html / prd_sections │
│     is_active=1 ●  │                        │ 既有生成/编辑链路直接读写   │
└────────────────────┘                        └──────────────────────────┘
```

- **激活版本**的内容载体就是现有的 `prds.html` + `prd_sections`（`is_current=1` 行）——既有生成、AI 改写、手动编辑、导出链路**全部零改动**，它们读写的就是激活版本的内容；
- **非激活版本**的内容完整存放在自己的 `prd_versions` 行里（`html` + `sections_json`）；
- **点击切换** = 一个事务内完成 swap：① 把当前工作区写回旧激活版本行；② 用目标版本的 `sections_json` 重建工作区。因为旧版本内容在切换瞬间已持久化，**切换永不丢内容**——这是 Figma 模型相对 git 模型的根本优势，之前方案里的 409 确认框、哈希比对、切换标记消息全部不需要；
- 对话记录**随版本走**：每个版本行额外保存 `messages_json` 对话快照，切换/新建/删除时随工作区一起写回与重建——空白版本自然是空对话（如同新建 PRD），切回旧版本时其对话记录完整恢复；AI 改写以上下文 + 当前工作区内容为准，天然自洽。

### 2.1 数据模型（新增 `prd_versions` 表）

```sql
CREATE TABLE IF NOT EXISTS prd_versions (
  id            TEXT    PRIMARY KEY,
  prd_id        TEXT    NOT NULL REFERENCES prds(id) ON DELETE CASCADE,
  session_id    TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,               -- 每个 prd 内递增 1,2,3...；删除后不重排
  label         TEXT    NOT NULL DEFAULT '',    -- 用户备注（新增版本时填写）
  source        TEXT    NOT NULL,               -- snapshot（复制当前）/ blank（空白）/ clone（克隆初始）
  html          TEXT    NOT NULL,               -- 该版本的完整单文件 HTML
  sections_json TEXT    NOT NULL,               -- [{section_id,title,html_content}]，按模块顺序，该版本的权威内容
  messages_json TEXT    NOT NULL DEFAULT '[]',  -- [{role,content,created_at}]，该版本的对话快照（对话随版本走）
  is_active     INTEGER NOT NULL DEFAULT 0,     -- 1 = 当前打开在工作区的版本
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_prd_versions_lookup ON prd_versions (prd_id, version DESC);
-- 每篇 PRD 至多一个激活版本（SQLite 部分唯一索引）
CREATE UNIQUE INDEX idx_prd_versions_active ON prd_versions (prd_id) WHERE is_active = 1;
```

`source` 枚举与抽屉徽章文案（版本只由用户显式动作产生）：

| source     | 触发场景                       | 徽章文案 |
| ---------- | ------------------------------ | -------- |
| `snapshot` | 「新增版本」选复制当前内容     | 手动版本 |
| `blank`    | 「新增版本」选空白版本         | 空白     |
| `clone`    | 克隆 fork 出的新会话的初始版本 | 克隆     |

**为什么 `sections_json` 是权威内容而非只靠 `html`**：切换时要用模块数据重建 `prd_sections` 工作区，否则后续模块编辑触发 `reassemblePrd` 会把切换来的内容冲掉（`prd/index.ts` L152–208）；组装 HTML 中 panel 只有序号（见现状盘点），无法可靠反解。

### 2.2 版本产生时机（纯手动 + 懒引导）

| 入口                                 | source     | 说明                                                                                                                                      |
| ------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 抽屉「+ 新增版本」→ 复制当前内容     | `snapshot` | 以当前工作区内容为起点创建新版本并打开（Figma Duplicate Page）                                                                            |
| 抽屉「+ 新增版本」→ 空白版本（默认） | `blank`    | 创建空版本并打开，可随后通过对话重新生成内容                                                                                              |
| 克隆 fork 新会话的初始版本           | `clone`    | 2.6，新会话的 v1                                                                                                                          |
| **懒引导**（`GET /prd/versions` 时） | `snapshot` | PRD 已有内容但无任何版本（如功能上线前的存量会话）时，自动把当前工作区物化为 v1「当前内容」并激活，保证「工作区总有激活版本」的模型一致性 |

**明确不做**：全量生成、单模块重生成、AI 改写、手动内联编辑均**不**自动创建版本；`persistResults`、PATCH、PUT content 等既有链路**零改动**。不设自动保留上限——版本完全由用户创建与删除，规模可控。

### 2.3 版本操作语义

| 操作                     | 触发方式           | 语义                                                                                                                                                                                       | 影响工作区         |
| ------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| **切换（打开版本）**     | 点击版本列表项     | swap：当前工作区写回旧版本行 → 目标版本加载进工作区 → 目标版本标记 `is_active=1`；随后可直接编辑                                                                                           | 是（无损切换）     |
| **新增版本**             | 头部「+ 新增版本」 | **会话内复制**（Duplicate Page）：复制当前工作区内容（或空白）创建新版本并立即打开；旧版本内容已在此刻写回其版本行                                                                         | 切换到新版本       |
| **克隆为新会话（fork）** | 行内「克隆」       | **跨会话复制**（Duplicate File）：以该版本为基础创建**独立新会话**（复制 PRD、对话记录、outline、模块选择），前端跳转到新会话；当前会话完全不受影响                                        | 否（作用于新会话） |
| **删除**                 | 行内「删除」       | 物理删除版本行（**不可恢复**）；删除非激活版本不影响工作区；删除激活版本时自动激活最新剩余版本并 swap 过去；删除最后一个版本时工作区内容保留为「未版本化」状态（回到无任何版本的初始形态） | 删除激活版本时切换 |

**「新增版本（复制当前内容）」与「克隆」的层级分工**（消除表象重合）：

|               | 新增版本（复制当前内容）               | 克隆为新会话                                               |
| ------------- | -------------------------------------- | ---------------------------------------------------------- |
| Figma 类比    | Duplicate **Page**（文件内复制页面）   | Duplicate **File**（复制整个文件）                         |
| 作用对象      | 仅当前工作区（激活版本）               | **任意**版本行（含历史版本，无需先切换、不打扰当前工作区） |
| 对话记录      | 复制当前对话快照（此后各版本独立演进） | 复制该版本对话快照，在新会话中独立演进                     |
| 结果位置      | 本会话版本列表                         | 历史会话列表中的新条目                                     |
| 切换/访问成本 | 点击即换（无损秒切）                   | 跨会话跳转                                                 |
| 典型场景      | 同一需求出 A/B 两版方案对比            | 基于 v{N} 另起一条独立演进线（衍生产品 / 独立需求）        |

> 想基于某个旧版本在本会话内复制？先点击打开它（无损），再「+ 新增版本」即可——无需为此增设行内「另存为新版本」。

### 2.4 切换（激活版本）设计

`POST /:id/prd/versions/:vid/activate` 在**单个事务**内完成：

1. 若目标版本已是 `is_active` → 直接返回当前内容（幂等无操作）；
2. **写回旧版本**：若存在旧激活版本，读取当前工作区（`prds.html` + `prd_sections` 中 `is_current=1` 行，按 `getSessionModules` 顺序），UPDATE 旧版本行的 `html` / `sections_json` / `updated_at`；
3. **重建工作区**：删除该 prd 下全部 `prd_sections` 旧行（工作区是易失的，section 级撤回历史随切换重置——见七、风险表），按目标版本的 `sections_json` 插入新行（`version=1, is_current=1`）；`sections_json` 为空（空白版本）时工作区清空；
4. **同步 `sessions.selected_modules`**：按目标版本 `sections_json` 的顺序与模块集合重建 `SelectedModule[]`（`id` = section_id，`name` = title，`isBuiltin` 按 `BUILTIN_MODULES` 查表），保证「模块管理」Tab 与打开的版本一致；空白版本保持现状不变；
5. **同步 outline 状态**：`sessions.outline` 中存在于目标版本的模块 `status` 置 `'done'`；目标为空白版本时全部置 `'pending'`（使全量生成可重新跑）；
6. **更新 `prds.html`**：直接置为目标版本的 `html`（与 `reassemblePrd` 产物一致，但省去一次重组；空白版本为空串 `""`——前端据此呈现「新建 PRD」空状态（含进度步骤），而非空壳文档；顶栏「版本」入口只看 `prdReady` 不受影响，「导出」按钮在空白版本下隐藏）；
7. **翻转激活标志**：旧版本 `is_active=0`，目标版本 `is_active=1`（部分唯一索引兜底）；
8. 响应 `{ assembledPrdHtml, activeVersion }`，前端据此刷新右栏、模块编辑数据与版本列表。

> 不插入对话标记消息：对话是会话级共享时间线，切换版本如同切换 Figma Page，无需留痕；AI 改写读取的是当前工作区内容，天然自洽。

### 2.5 新增版本设计

`POST /:id/prd/versions`，body `{ label, mode: "duplicate" | "blank" }`，单个事务：

1. **写回旧激活版本**（若存在）：同 2.4 第 2 步——保证复制的内容是最新的；
2. `mode = "duplicate"`：新版本的 `html` / `sections_json` = 当前工作区内容；工作区与 `selected_modules` / outline **保持不变**（内容相同，无需重建）；
3. `mode = "blank"`：新版本的 `sections_json = []`、`messages_json = []`、`html = ""`（空串，前端呈现全新空状态）；随后按 2.4 第 3–6 步把工作区清空，`sessions.outline` 置 `NULL`（避免误判"生成中断"气泡）；
4. 旧版本 `is_active=0`，新版本 `is_active=1`，`version = MAX(version)+1`；
5. 响应 `{ id, version, assembledPrdHtml }`。

### 2.6 克隆（fork 新会话）设计

`POST /:id/prd/versions/:vid/clone` 在**单个事务**内完成：

1. 读取目标版本行（`html`、`sections_json`、`version`、`label`）；若克隆的是激活版本，先按 2.4 第 2 步写回，保证内容最新；
2. 创建新会话：`id = uuid`，`title = 「{原会话标题}」v{N} 分支`，`created_at/updated_at = now`；
3. **复制 `selected_modules`**：按 `sections_json` 重建（同 2.4 第 4 步）；
4. **复制 `outline`**：深拷贝原会话 outline，`sessionId` 改为新 id，存在于该版本的模块 `status` 置 `'done'`；
5. **复制对话记录**：以目标版本的 `messages_json` 快照为准（而非当前工作区 messages——克隆历史版本时带的是该版本自己的对话），写入新会话 `messages` 表（新 id、新 session_id、保持 `created_at` 原值）；末尾追加一条标记消息：`📌 本会话克隆自「{原会话标题}」的 v{N}，可在此基础上继续编辑。`，并一并计入新会话初始版本的 `messages_json`；
6. 写入新 `prds` 行（`html` = 版本内容）；
7. 按 `sections_json` 写入新 `prd_sections` 行（`version=1, is_current=1`）；
8. 写入新会话的初始 `prd_versions` 行（`version=1, source='clone', label='克隆自 v{N}', is_active=1`）——新会话的版本库从 v1 重新开始，**不复制**原会话的版本历史（见「八、待确认决策点」D-2）；
9. 响应 `{ sessionId }`，前端 `router.push({ name: "session", params: { id: sessionId } })` 跳转到新会话。

### 2.7 删除版本设计

`DELETE /:id/prd/versions/:vid`，单个事务：

1. 目标为**非激活版本** → 直接物理删除该行，响应 `{ ok: true }`；
2. 目标为**激活版本**且仍有其他版本 → 删除该行，取剩余版本中 `version` 最大者，按 2.4 第 3–7 步 swap 过去并置 `is_active=1`（被删版本的工作区内容随之丢弃——用户已显式删除），响应 `{ ok: true, activatedVersion }`；
3. 目标为**最后一个版本** → 删除该行，工作区内容保留（`prds.html` / `prd_sections` 不动），此后会话处于「无版本」状态（与从未创建过版本的初始形态一致），响应 `{ ok: true, activatedVersion: null }`。

### 2.8 存储说明

- 版本仅由用户显式动作产生（2.2），规模天然可控，**不设自动保留上限**；清理完全通过「删除」操作手动进行；
- 存储估算：单篇 PRD HTML 约 100–500KB，即使积累上百个手动版本也在几十 MB 量级，本地 SQLite 可接受。

### 2.9 API 设计（挂在 `sessions.ts` PRD 路由族下）

| 方法   | 路径                                           | 说明                                                            | 响应                                                                             |
| ------ | ---------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| GET    | `/api/sessions/:id/prd/versions`               | 版本列表（**不含 html / sections_json**，按 version 倒序）      | `{ versions: [{ id, version, label, source, isActive, createdAt, updatedAt }] }` |
| POST   | `/api/sessions/:id/prd/versions`               | 新增版本（2.5），body `{ label, mode: "duplicate" \| "blank" }` | `{ id, version, assembledPrdHtml }`                                              |
| POST   | `/api/sessions/:id/prd/versions/:vid/activate` | 打开（切换到）该版本（2.4）                                     | `{ assembledPrdHtml, activeVersion }`                                            |
| POST   | `/api/sessions/:id/prd/versions/:vid/clone`    | 克隆 fork 新会话（2.6）                                         | `{ sessionId }`                                                                  |
| DELETE | `/api/sessions/:id/prd/versions/:vid`          | 删除版本（2.7）                                                 | `{ ok: true, activatedVersion?: number \| null, assembledPrdHtml?: string }`     |
| PATCH  | `/api/sessions/:id/prd/versions/:vid`          | （可选）重命名 label，body `{ label }`                          | `{ version, label }`                                                             |

### 2.10 前端 UI 设计

```
┌──────────────────────────────────────────────────────────────┐
│ NavBar:  ← 标题 ✎                    [🕘 版本] [⬇ 导出 ] [⚙]   │  ← 版本按钮在导出左侧
├─────────────┬────────────────────────────────────────────────┤
│ ┌─────────┐ │                                                │
│ │ 版本抽屉  │ │   PrdPanel（正常渲染链）                        │
│ │(左侧滑出) │ │                                                │
│ │ +新增版本│ │   点击列表项 → swap 到该版本                     │
│ │         │ │   → PrdSectionList 正常渲染，可直接编辑           │
│ │ v3 手动  │ │                                                │
│ │ v2 空白  │ │   SessionSidebar：对话共享不随切换；              │
│ │  ●当前   │ │   模块管理同步为该版本模块集合                     │
│ │ v1 克隆  │ │                                                │
│ │[克隆][删除]│ │                                               │
│ └─────────┘ │                                                │
└─────────────┴────────────────────────────────────────────────┘
```

- **入口按钮**（`NavBar.vue`）：`v-if="isSessionPage && hasPrd"`（与导出同条件），图标用 `<icon-lucide-history />`（IconsResolver 覆盖 `src/components`，无需 import）；幽灵按钮样式，不与主按钮「导出」抢视觉权重；`emit('openVersions')` → `App.vue` 托管 `<VersionDrawer v-model="showVersions" />`（复刻 ExportModal 接线模式）。
- **版本抽屉**（新组件 `frontend/src/components/VersionDrawer.vue`）：`position: fixed; left: 0` 从左缘滑出（宽约 400px，z-index 高于侧栏），遮罩点击关闭；头部「版本记录」+「+ 新增版本」按钮；列表项含版本号、source 徽章、相对时间、label、`isActive` 时显示「当前」高亮徽章。
  - **点击列表项** → `activateVersion`（点当前项无操作）；抽屉保持打开，可连续点击在版本间切换对比；
  - **空状态**：无版本时显示「暂无版本。点击「+ 新增版本」把当前 PRD 存为第一个版本」；
  - 行内操作（hover 显示）：「克隆为新会话」`<icon-lucide-copy-plus />`、「删除」`<icon-lucide-trash-2 />`（危险色 `#EF4444`）；
  - **版本名称**：列表主标题显示 `label || v{N}`；有自定义名称时旁边附 `v{N}` 小徽章保持可追溯；**双击版本名称进入行内编辑**（输入框预填当前显示名并全选，Enter/失焦保存调 PATCH，Esc 取消；名称与默认 `v{N}` 一致时落库为空 label，展示层回退）；
  - 「克隆为新会话」→ 确认框：「将以 v{N} 为基础创建**独立新会话**（含对话记录）并跳转，当前会话不受影响」→ 调 clone → 跳转新会话；
  - 「删除」→ 确认框：「删除后不可恢复，确认删除 v{N}？」（删除激活版本时追加提示「将自动切换到 v{M}」）→ 调 DELETE → 刷新列表与工作区；
  - 「+ 新增版本」→ 弹窗：**版本名称输入框预填下一个默认名（如 `v5`）并自动聚焦全选，用户可立即输入覆盖**，回车可提交；方式选择（**空白版本**（默认，说明：「创建空白版本并切换过去，当前内容保留在原版本中」）/ **复制当前内容**（说明：「在本会话内创建内容相同的平行版本」））→ 调 POST versions。
- **PrdPanel 无预览态**：不新增横幅与预览 iframe 分支；唯一改动是把 L28–57 拉取 sections 的逻辑下沉为 `prdEditStore.loadSections(sessionId)`，供其自身 watch 与切换/新增/删除后刷新复用。
- **状态管理**（新 store `frontend/src/stores/prdVersions.ts`）：`versions`、`drawerOpen`、`activating`、`loading`；actions：`fetchVersions / addVersion / activateVersion / cloneVersion / renameVersion / deleteVersion`。
- **切换/新增/删除后刷新**：成功后 → `messagesStore.setPrdHtml(assembledPrdHtml)` + `prdEditStore.loadSections(sessionId)` + 重新拉取会话（`loadMessages` + `initWorkflowSteps` + `applyPipelineState`，对话记录随版本切换）+ 刷新版本列表（更新「当前」徽章）。
- **编辑态保护**：切换/新增/删除激活版本时，若 `prdEditStore.editingSection` 非空（有正在内联编辑未保存的模块），先弹确认「切换版本将丢弃当前未保存的编辑」。

---

## 三、施工分阶段

### Phase 1：数据层与版本服务

**目标**：`prd_versions` 表入库，版本服务（创建 / 列表 / 激活 / 克隆 / 删除）可用。**不触碰任何既有生成与编辑链路。**

#### 1.1 修改 `backend/src/db/schema.ts`

新增 `CREATE_PRD_VERSIONS_TABLE`、`CREATE_PRD_VERSIONS_INDEX`、`CREATE_PRD_VERSIONS_ACTIVE_INDEX`（部分唯一索引）常量与 `PrdVersionRow` 接口（仿照 `skill_versions` 写法，L131–154）。

#### 1.2 修改 `backend/src/db/migrations.ts`

当前最新为 v9（L122–141），新增 v10：

```typescript
if (version < 10) {
	db.exec(CREATE_PRD_VERSIONS_TABLE);
	db.exec(CREATE_PRD_VERSIONS_INDEX);
	db.exec(CREATE_PRD_VERSIONS_ACTIVE_INDEX);
	db.pragma("user_version = 10");
}
```

#### 1.3 新建 `backend/src/services/prdVersions.ts`

- `listPrdVersions(prdId)`（不含 html / sections_json）；
- `createPrdVersion(prdId, sessionId, { label, mode })`（2.5 事务全流程）；
- `activatePrdVersion(versionId, sessionId)`（2.4 事务全流程：写回旧版本 → 重建工作区 → 同步 selected_modules / outline → 翻转 is_active）；
- `forkSessionFromVersion(versionId, sessionId)`（2.6 事务全流程，返回新 sessionId）；
- `deletePrdVersion(versionId, sessionId)`（2.7 三分支）；
- 内部工具：`writeBackActiveVersion(prdId)`（2.4 第 2 步）、`loadVersionIntoWorkspace(versionRow, sessionId)`（2.4 第 3–6 步）、`buildSelectedModules(sections)`、`syncOutlineStatus(sessionId, sectionIds | "all-pending")`。

---

### Phase 2：API 路由

**目标**：2.9 的端点全部可用（PATCH 重命名为可选项，最后做）。

#### 2.1 修改 `backend/src/routes/sessions.ts`

在 `POST .../rollback`（L1611）之后追加 versions 路由组（含 DELETE）；全部先按 `sessionId → prd` 解析（复用 L984–991 的查询模式），找不到返回 404；参数校验失败返回 400。

---

### Phase 3：前端入口、抽屉与切换

**目标**：按钮可见、抽屉可开、点击版本即切换工作区。

#### 3.1 新建 `frontend/src/stores/prdVersions.ts`

状态与 actions 见 2.10；类型定义追加到 `frontend/src/types/index.ts`。

#### 3.2 修改 `frontend/src/components/NavBar/NavBar.vue`

- `defineEmits` 增加 `openVersions`；
- 「导出」左侧插入幽灵按钮（`<icon-lucide-history />` + 「版本」），显示条件与导出一致。

#### 3.3 修改 `frontend/src/App.vue`

`showVersions` ref + `<VersionDrawer v-model="showVersions" />`（挂在 `ExportModal` 旁）。

#### 3.4 新建 `frontend/src/components/VersionDrawer.vue`

左侧抽屉（参考 `HistoryDrawer.vue` 结构，方向改为左）；打开时 `fetchVersions`；列表渲染（含「当前」徽章、空状态）+ 点击切换 + 行内「克隆 / 删除」+ 头部「+ 新增版本」弹窗（label + 方式选择）+ 各确认框。

#### 3.5 修改 `frontend/src/stores/prdEdit.ts` 与 `PrdPanel.vue`

- `prdEdit.ts` 新增 `loadSections(sessionId)`（自 `PrdPanel.vue` L28–57 下沉）；
- `PrdPanel.vue` 的 watch 改为调用 `loadSections`；**不加**预览横幅与预览 iframe。

---

### Phase 4：克隆 / 新增 / 删除交互闭环

#### 4.1 克隆（fork）

行内「克隆」→ 确认框 → `cloneVersion` → `router.push` 跳转新会话。

#### 4.2 新增版本

头部「+ 新增版本」→ label + 方式选择（复制当前 / 空白）→ `addVersion` → 刷新列表与工作区。

#### 4.3 删除版本

行内「删除」→ 确认框（危险色强调不可恢复；删除激活版本时提示将自动切换）→ `deleteVersion` → 刷新列表，必要时按响应刷新工作区。

#### 4.4（可选）PATCH 重命名 label

列表行内 label 支持点击编辑。

---

### Phase 5（可选，推荐）：修复 section 级版本缺口

**目标**：全量/单模块重新生成也保留 section 级历史，使既有「↩ 撤回」在重新生成后仍可用。

#### 5.1 修改 `backend/src/services/prd/index.ts` `upsertPrdSection`（L60–86）

原地 UPDATE 改为「旧行 `is_current=0` + 插入 `version+1` 新行」，与 PUT content 端点写法对齐。

> 说明：这是 `prd_sections` 自身的一致性补强（与版本库无关），工作量小（单函数），建议一并完成；若工期紧张可延后。

---

### Phase 6：文档同步（仓库硬性要求）

- `AGENTS.md`：「前后端通信协议」表追加 versions 端点；「数据持久化 Schema」追加 `prd_versions` 表；目录结构 `components/` 追加 `VersionDrawer.vue`、`stores/` 说明补充 `prdVersions`；
- 本 plan 归档于 `docs/`（已满足）。

---

## 四、文件变更清单

### 新增文件

| 文件                                        | 说明                                             |
| ------------------------------------------- | ------------------------------------------------ |
| `backend/src/services/prdVersions.ts`       | 版本创建 / 列表 / 激活（swap）/ 克隆 fork / 删除 |
| `frontend/src/stores/prdVersions.ts`        | 版本列表、抽屉态、切换中状态管理                 |
| `frontend/src/components/VersionDrawer.vue` | 左侧版本抽屉（列表 + 确认框 + 新增弹窗）         |
| `docs/plan-prd-version-management.md`       | 本文件                                           |

### 修改文件

| 文件                                                 | 改动内容                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| `backend/src/db/schema.ts`                           | `CREATE_PRD_VERSIONS_TABLE` / 索引（含部分唯一索引）/ `PrdVersionRow` |
| `backend/src/db/migrations.ts`                       | 新增 v10 迁移                                                         |
| `backend/src/routes/sessions.ts`                     | 新增 versions 路由组（含 DELETE）                                     |
| `backend/src/services/prd/index.ts`                  | （仅 Phase 5 可选）`upsertPrdSection` 版本化                          |
| `frontend/src/types/index.ts`                        | `PrdVersionMeta` 类型（含 `isActive`）                                |
| `frontend/src/components/NavBar/NavBar.vue`          | 「版本」按钮 + `openVersions` emit                                    |
| `frontend/src/App.vue`                               | 托管 `VersionDrawer`                                                  |
| `frontend/src/views/session/components/PrdPanel.vue` | sections 拉取逻辑下沉到 store（无预览态改动）                         |
| `frontend/src/stores/prdEdit.ts`                     | 新增 `loadSections(sessionId)`                                        |
| `AGENTS.md`                                          | 端点表 / Schema / 目录结构同步                                        |

> 既有生成与编辑链路（`persistResults`、PATCH、PUT content）**零改动**——它们读写的 `prds` / `prd_sections` 在本方案中就是「激活版本的工作区」。

---

## 五、施工顺序与依赖关系

```
Phase 1（表 + 版本服务）
    ↓ 一切皆依赖 prd_versions 数据存在
Phase 2（API 端点，含 DELETE）
    ↓ 前端依赖 API
Phase 3（store + NavBar 入口 + 抽屉 + 点击切换）
    ↓
Phase 4（克隆 / 新增 / 删除交互闭环）
    ↓
Phase 5（可选：section 级版本缺口修复）   ← 与 Phase 2–4 无依赖，可任意插入
    ↓
Phase 6（文档同步）                        ← 最后收口
```

---

## 六、验收标准

| #    | 场景                               | 验收条件                                                                                                                                                                                                                      |
| ---- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-1  | 老库升级                           | v10 迁移幂等执行，既有 `prds` / `prd_sections` 数据不受影响                                                                                                                                                                   |
| T-2  | 生成 / 编辑不产生版本              | 全量生成、单模块重生成、AI 改写、手动编辑后，`prd_versions` **均无**新行（版本纯手动产生）                                                                                                                                    |
| T-3  | 入口                               | 会话页且有 PRD 时 NavBar 显示「版本」按钮（导出左侧）；点击从**左侧**滑出抽屉；无 PRD 时不显示                                                                                                                                |
| T-4  | 版本列表                           | 按 version 倒序展示版本号 / 徽章 / 时间 / label；列表接口不返回 html 字段；激活版本显示「当前」徽章；无版本时显示空状态引导                                                                                                   |
| T-5  | 新增版本（复制当前）               | 创建后出现 `snapshot` 新行并置为激活；工作区内容不变；旧版本行的内容已写回为其最新状态                                                                                                                                        |
| T-6  | 新增版本（空白）                   | 创建后工作区清空：`prds.html = ""`，前端呈现「新建 PRD」空状态（含进度步骤）；对话记录清空；`sessions.outline = NULL`（无中断气泡），可触发全量生成重新填充；旧版本内容完整保留在其版本行                                     |
| T-7  | 点击切换（无损）                   | 在 v2 上做过编辑（未手动存任何版本）→ 直接点 v1：① 无任何确认框；② 工作区切换为 v1 内容；③ 再点回 v2，之前的编辑**完整保留**（切换时已写回 v2 行）；④ `prd_versions` 无新行、对话无新消息                                     |
| T-8  | 切换一致性                         | 切换后：① 右栏展示目标版本；② `prd_sections` 与目标版本一致（切换后再做模块编辑，内容不被冲掉）；③ `selected_modules` 与「模块管理」Tab 同步；④ 对话历史原样保留                                                              |
| T-9  | 切换后继续编辑                     | 在打开的版本上执行 AI 改写 / 手动编辑，正常生效并写入工作区；**不自动**产生新版本；切换到其他版本再切回，编辑内容仍在                                                                                                         |
| T-10 | 克隆（fork）                       | 克隆后跳转到新会话：① 标题为「{原标题}」v{N} 分支；② PRD 内容与目标版本一致；③ 对话记录完整复制且末尾有克隆标记消息；④ 模块管理与原版本一致；⑤ 新会话版本库从 v1（`source='clone'`、`is_active=1`）开始；⑥ 原会话一切数据不变 |
| T-11 | 删除版本                           | ① 删除非激活版本：行消失，工作区不变；② 删除激活版本：自动切换到最新剩余版本并刷新工作区；③ 删除最后一个版本：工作区内容保留，会话回到「无版本」状态；④ 版本号不重排（列表出现空洞）；⑤ 取消确认框则不产生任何变化            |
| T-12 | 编辑态保护                         | 有未保存的内联编辑时切换 / 新增 / 删除激活版本，先弹确认「切换将丢弃未保存的编辑」                                                                                                                                            |
| T-13 | 激活唯一性                         | 任意时刻每篇 PRD 至多一个 `is_active=1` 的版本（部分唯一索引兜底，并发/异常下也不会出现两个）                                                                                                                                 |
| T-14 | （Phase 5）重新生成后 section 撤回 | 全量重新生成后，对某模块执行「↩ 撤回」可回到重新生成前的该模块内容                                                                                                                                                            |
| T-15 | 质量门禁                           | `pnpm lint`、`pnpm --filter frontend typecheck`、`pnpm --filter backend build` 通过                                                                                                                                           |

---

## 七、风险与注意事项

| 风险                        | 说明                                                                              | 应对                                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 切换后 section 撤回历史重置 | 工作区（`prd_sections`）在切换时重建，既有「↩ 撤回」只能撤到切换后的状态          | 预期行为（撤回是工作区内的编辑反悔，版本是文档级的平行分支）；在风险文档与计划中明示；Phase 5 与本项无关                               |
| 激活版本行的内容滞后        | 激活版本的 `prd_versions` 行只在切换/新增/克隆/删除时写回，平时编辑不实时更新该行 | 预期设计：权威内容 = 工作区；任何切换路径都先写回，不会读到过期内容；崩溃场景下 `prds.html` 仍是当前内容，重开会话后首次切换会正确写回 |
| 误删版本                    | 删除为物理删除，不可恢复                                                          | 确认框二次确认并用危险色强调；删除激活版本时明确提示将自动切换；验收 T-11 覆盖                                                         |
| 切换后 sections 不一致      | 只覆盖 `prds.html` 会被后续 `reassemblePrd` 冲掉                                  | 2.4 事务内重建 `prd_sections` 工作区 + 同步 `selected_modules` / outline 状态；验收 T-8②③ 覆盖                                         |
| 空白版本后 AI 再生成        | 空白版本工作区为空，需 outline 状态为 `pending` 才能全量重新生成                  | 2.4 第 5 步置 `'pending'`；验收 T-6 覆盖                                                                                               |
| 克隆复制对话的体积          | messages 全量复制，长会话有一定体积                                               | 本地 SQLite，量级可忽略；复制在同一事务内完成                                                                                          |
| 左侧抽屉遮挡对话侧栏        | 抽屉从视口左缘滑出会盖住 SessionSidebar                                           | 需求明确要求左侧弹出；遮罩点击即关闭；抽屉保持打开时可连续点击版本对比（右栏不被遮挡）                                                 |
| Electron 环境               | 无额外风险：纯 HTTP API + 本地 SQLite，与现有 PRD 链路相同                        | 无需特殊处理                                                                                                                           |

---

## 八、待确认决策点

| #   | 决策点                                 | 本计划默认选择                                                                    | 备选                                                 |
| --- | -------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------- |
| D-1 | ~~版本管理模型~~                       | **已确认**：Figma Page 模型——版本为平行独立文档，点击即打开并可直接编辑，切换无损 | —                                                    |
| D-2 | 克隆出的新会话是否携带原会话的版本历史 | 不携带，新会话版本库从 v1（`source='clone'`）重新开始                             | 全量复制版本历史（实现直接但新会话列表一开始就很长） |
| D-3 | ~~是否需要「删除版本」~~               | **已确认**：本期实现，物理删除 + 确认框                                           | —                                                    |
| D-4 | ~~版本产生方式~~                       | **已确认**：纯手动（「新增版本」/ 克隆），无任何自动快照钩子                      | —                                                    |
| D-5 | 新增版本的默认方式                     | 「空白版本」为默认选项，「复制当前内容」为可选项（2026-09-06 按用户要求调整）     | 仅支持复制当前内容                                   |
| D-6 | 版本号展示规则                         | 每 prd 内从 v1 递增；删除后不重排（保留空洞）                                     | 删除后重排（不推荐）                                 |
