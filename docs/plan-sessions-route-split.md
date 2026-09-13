# sessions.ts 路由模块化拆分 — 实施规划

> 需求来源：用户对话（2026-09-12）
> 目标：将 `backend/src/routes/sessions.ts`（约 1787 行）按业务域拆成可维护的子模块，**不改变任何 HTTP 路径、请求体、SSE 事件与响应契约**。
> 状态：**✅ 已实施**（2026-09-12：按 P0–P3 完成目录拆分；`sessions.ts` 保留薄 re-export 以兼容 NodeNext）

---

## 一、为何要拆

当前文件同时承载：会话 CRUD、SSE 对话/重试、PRD 读取、版本管理、模块 AI 改写（三种模式）、内联保存、回滚，以及 HTML/表格/Mermaid 实体补丁工具。问题不是「逻辑写错」，而是：

1. **定位成本高**：改表格单元格补丁要在 1700+ 行里翻；改版本路由也要打开同一文件。
2. **重复代码已出现**：`prd_sections` 新版本 INSERT 在 PATCH 三分支 + PUT 里复制了 4 份；`POST /messages` 与 `POST /messages/retry` 的 `runAgentStream` 回调高度同构。
3. **路由顺序隐式依赖**：Express 按注册顺序匹配，继续往单文件堆会更容易把 `/:id` 这类宽匹配插错位置。
4. **与仓库约定不符**：`AGENTS.md` 要求模块化；`docs/plan-*.md` 已把版本管理等能力写进独立 service，路由层却仍是上帝文件。

本次拆分是**结构重构，不是功能迭代**：行为必须与现状逐端点对齐。

---

## 二、现状盘点

### 2.1 文件内分区（按现有注释块）

| 行号（约） | 区块 | 行数（约） | 性质 |
| ---------- | ---- | ---------- | ---- |
| 1–52 | import | 50 | 依赖面过宽，拆完后按子文件收敛 |
| 54–57 | `readLlmFromBody` | 4 | 多路由共用 |
| 59–216 | HTML 补丁：`stripElSelected` / `TableElementPath` / `extractParentTableHtml` / `patchTableElementByPath` / `patchElementInHtml` | 160 | 纯函数，无 Express |
| 216 | `const router = Router()` | 1 | 应上收到 `index.ts` |
| 218–303 | Mermaid 实体：`extractEntityBlock` / `extractEntitySection` / `applyEntityPatch` | 85 | 纯函数，依赖 `patchElementInHtml` |
| 307–453 | `validateModuleIds` / `extractQuestionForm` / `finalizePrd` / `parseSelectedModules` | 145 | 会话/SSE 共用工具 |
| 456–512 | `POST /` `GET /` `GET /:id` | 55 | 会话 CRUD |
| 514–711 | `POST /:id/messages` | 200 | SSE 对话 + 触发生成 PRD |
| 713–922 | `POST /:id/messages/retry` | 210 | 四种 retry mode |
| 924–990 | `PATCH /:id/modules` `DELETE /:id` | 65 | 会话 CRUD |
| 992–1062 | `GET /:id/prd` `GET /:id/prd/sections` | 70 | PRD 只读 |
| 1064–1170 | 版本管理 6 个端点 + `findPrdId` / `findVersionInPrd` | 105 | 薄封装 `prdVersions` service |
| 1172–1664 | `PATCH /:id/prd/sections/:sectionId` | **490** | 最大块：实体聚焦 / 元素补丁 / 全模块重写 |
| 1666–1784 | `PUT .../content` `POST .../rollback` | 120 | 手动保存 + 单步回滚 |
| 1786 | `export default router` | 1 | **对外契约，必须保留** |

### 2.2 已注册端点（顺序不可乱）

Express 按注册顺序匹配。拆分后 `index.ts` 的挂载顺序必须与下表一致：

| 顺序 | 方法 | 路径 |
| ---- | ---- | ---- |
| 1 | POST | `/` |
| 2 | GET | `/` |
| 3 | GET | `/:id` |
| 4 | POST | `/:id/messages` |
| 5 | POST | `/:id/messages/retry` |
| 6 | PATCH | `/:id/modules` |
| 7 | DELETE | `/:id` |
| 8 | GET | `/:id/prd` |
| 9 | GET | `/:id/prd/sections` |
| 10 | GET | `/:id/prd/versions` |
| 11 | POST | `/:id/prd/versions` |
| 12 | POST | `/:id/prd/versions/:vid/activate` |
| 13 | POST | `/:id/prd/versions/:vid/clone` |
| 14 | DELETE | `/:id/prd/versions/:vid` |
| 15 | PATCH | `/:id/prd/versions/:vid` |
| 16 | PATCH | `/:id/prd/sections/:sectionId` |
| 17 | PUT | `/:id/prd/sections/:sectionId/content` |
| 18 | POST | `/:id/prd/sections/:sectionId/rollback` |

入口不变：`backend/src/index.ts` 仍 `import sessionsRouter from "./routes/sessions.js"`。

---

## 三、拆分原则

1. **零契约变更**：路径、状态码、JSON 字段、SSE 事件名与 payload 一律不动；前端零改动。
2. **用 `register(router)` 组合，不用嵌套 `router.use()` 挂载子 Router**。
   - 子 Router 需要 `mergeParams`、前缀切分，且容易打乱上表顺序。
   - 每个域文件导出 `export function registerXxx(router: IRouter): void`，在 `index.ts` 按上表顺序调用。
3. **纯函数下沉到 `helpers/`，路由处理函数留在域文件**。工具不进 `services/`（目前没有第二处调用方）；版本业务逻辑已在 `services/prdVersions.ts`，路由只做 HTTP 校验与转发。
4. **单文件目标规模**：域文件尽量 ≤ 400 行；`sectionEdit.ts` 因三分支 prompt 较长，允许到 ~450。禁止再出现 1000+ 行路由文件。
5. **顺手消重复，但不做行为优化**：只提取已经逐字重复的持久化 / SSE 收尾；不改 prompt、不改补丁三层策略、不改 retry 语义。
6. **目录替换而非并存**：删除顶层 `sessions.ts`，改为 `sessions/index.ts`。Node / TypeScript `NodeNext` 下 `./routes/sessions.js` 会解析到目录 index，无需改 `backend/src/index.ts`。

---

## 四、目标目录

```
backend/src/routes/
├── modules.ts                 # 不动
├── prototypes.ts              # 不动
└── sessions/                  # 原 sessions.ts
    ├── index.ts               # 创建 Router，按序 register*，default export
    ├── crud.ts                # 会话 CRUD + 模块选择
    ├── messages.ts            # 对话 SSE + retry
    ├── prdRead.ts             # GET prd / GET sections
    ├── versions.ts            # 版本 6 端点
    ├── sectionEdit.ts         # PATCH 模块 AI 改写（三分支）
    ├── sectionMutate.ts       # PUT content + POST rollback
    └── helpers/
        ├── llm.ts             # readLlmFromBody
        ├── selectedModules.ts # validateModuleIds / parseSelectedModules
        ├── questionForm.ts    # extractQuestionForm
        ├── prdFinalize.ts     # finalizePrd
        ├── htmlPatch.ts       # stripElSelected / 表格路径 / patchElementInHtml
        ├── mermaidEntity.ts   # ER 实体提取与缝合
        └── sectionPersist.ts  # 查找当前 PRD/section + 写入新版本行
```

### 4.1 各文件职责与预估规模

| 文件 | 职责 | 预估行数 |
| ---- | ---- | -------- |
| `index.ts` | `Router()` + 按序 `registerCrud` → `registerMessages` → `registerPrdRead` → `registerVersions` → `registerSectionEdit` → `registerSectionMutate`；`export default router` | ~40 |
| `crud.ts` | `POST /` `GET /` `GET /:id` `PATCH /:id/modules` `DELETE /:id` | ~150 |
| `messages.ts` | `POST /:id/messages` `POST /:id/messages/retry`；内部可抽 `pipeAgentStream` 消除与 retry 的回调复制 | ~350 |
| `prdRead.ts` | `GET /:id/prd` `GET /:id/prd/sections` | ~80 |
| `versions.ts` | 6 个版本端点 + `findPrdId` / `findVersionInPrd`（或改从 `sectionPersist` 复用「取最新 prd id」） | ~120 |
| `sectionEdit.ts` | `PATCH .../sections/:sectionId` 三分支：entity / element / rewrite | ~400–450 |
| `sectionMutate.ts` | `PUT .../content` `POST .../rollback` | ~130 |
| `helpers/llm.ts` | body → `LlmRuntimeConfig` | ~15 |
| `helpers/selectedModules.ts` | 校验 / 解析 `selected_modules` | ~50 |
| `helpers/questionForm.ts` | 剥离 `[QUESTION_FORM]` | ~40 |
| `helpers/prdFinalize.ts` | 校验 HTML + `prd_ready` / `writeDone` | ~80 |
| `helpers/htmlPatch.ts` | 选中态清理、表格坐标补丁、三层元素替换 | ~180 |
| `helpers/mermaidEntity.ts` | 实体块 / entity-section 提取与 `applyEntityPatch` | ~90 |
| `helpers/sectionPersist.ts` | `findLatestPrdId`、读当前 section、`persistSectionRevision`（UPDATE is_current=0 + INSERT 新行 + `reassemblePrd`） | ~80 |

拆完后路由层合计仍约 1700 行，但单文件可读，重复 SQL 只留一处。

### 4.2 `register*` 形态（示意，实施时按此写）

```ts
// sessions/index.ts
import { Router, type IRouter } from "express";
import { registerCrud } from "./crud.js";
import { registerMessages } from "./messages.js";
import { registerPrdRead } from "./prdRead.js";
import { registerVersions } from "./versions.js";
import { registerSectionEdit } from "./sectionEdit.js";
import { registerSectionMutate } from "./sectionMutate.js";

const router: IRouter = Router();
registerCrud(router);
registerMessages(router);
registerPrdRead(router);
registerVersions(router);
registerSectionEdit(router);
registerSectionMutate(router);
export default router;
```

```ts
// sessions/crud.ts
import type { IRouter } from "express";

export function registerCrud(router: IRouter): void {
  router.post("/", (req, res) => { /* 原逻辑原样搬迁 */ });
  // ...
}
```

禁止改成 `router.use("/:id/prd", prdRouter)` 这类前缀挂载，除非同步证明全部 18 个路径与参数名（`id` / `vid` / `sectionId`）行为不变——本方案明确不做这条路。

---

## 五、允许的小提取（仍属「搬家」，不是新功能）

以下重复已在现状中可见，拆分时一并收口，避免复制到多个文件后更难改：

### 5.1 `persistSectionRevision`

PATCH 实体聚焦、元素补丁、全模块重写、PUT content 四处均为：

1. `UPDATE prd_sections SET is_current = 0 WHERE prd_id = ? AND section_id = ?`
2. `INSERT` 新行，`version = current.version + 1`，`is_current = 1`
3. `await reassemblePrd(prd.id, sessionId)`

抽到 `helpers/sectionPersist.ts`。回滚不走这条（它是切换 `is_current`，不是插入新行）。

### 5.2 `pipeAgentStream`（可选，P2）

`POST /messages` 与 `retry_last` / `continue_agent` 共享：

- `req.on("close")` 写中断标记
- `onDelta` 累加 `partialReply`
- `onDone`：`extractQuestionForm` → 落库 assistant → 可选 `generatePrdOutline` + `generateFullPrd` + `finalizePrd`
- `onError`：idle / agent_error 落库 + `writeError`

P1 可以先原样搬进 `messages.ts`（文件会到 ~420 行，可接受）；P2 再抽，避免第一次拆分同时改控制流。

### 5.3 `findLatestPrdId`

`findPrdId`（版本区）与 PATCH/PUT/rollback 内联 `SELECT id FROM prds ... LIMIT 1` 是同一查询。统一到 `sectionPersist.ts` 的 `findLatestPrdId(sessionId)`，`versions.ts` 复用。

---

## 六、明确不做

| 项 | 原因 |
| -- | ---- |
| 改 URL / 改 SSE 事件 | 本次是重构，不是 API 版本升级 |
| 把 HTML 补丁搬进 `services/prd/` | 尚无第二调用方；过早下沉会扩大 diff |
| 改 Agent / outline / renderer | 路由拆分不应牵动生成管线 |
| 前端、DB schema、migration | 无契约变化 |
| 用嵌套 Express Router 按前缀切分 | 顺序与 `req.params` 风险高于收益 |
| 顺便删 `console.log("req.body")` 等调试输出 | 可在独立清理 PR 做，避免和行为回归缠在一起 |
| 重写三套 section prompt | 属于功能改动 |

---

## 七、实施步骤

### P0 — 目录替换（机械搬家，行为零 diff）

1. 新建 `backend/src/routes/sessions/index.ts`，把现有 `sessions.ts` **整文件移入**（先不拆内部）。
2. 删除 `backend/src/routes/sessions.ts`。
3. 确认 `pnpm --filter backend` 能启动，`import "./routes/sessions.js"` 仍解析到目录 index。
4. 跑 `pnpm --filter backend typecheck`（或仓库等价命令）。

若 Node 解析在本仓库配置下不认目录 index（需实装时验证 `backend/tsconfig.json` 的 `moduleResolution`），则保留一层薄壳：

```ts
// backend/src/routes/sessions.ts  （仅 re-export）
export { default } from "./sessions/index.js";
```

优先尝试无薄壳方案；只有解析失败才加这一行。

### P1 — 按域切开（主工作量）

按依赖从底向上抽，每次抽完保证 typecheck 通过：

1. `helpers/llm.ts`、`helpers/htmlPatch.ts`、`helpers/mermaidEntity.ts`
2. `helpers/selectedModules.ts`、`helpers/questionForm.ts`、`helpers/prdFinalize.ts`
3. `helpers/sectionPersist.ts`（含 `persistSectionRevision`，四处调用点替换）
4. `crud.ts` / `messages.ts` / `prdRead.ts` / `versions.ts`
5. `sectionEdit.ts` / `sectionMutate.ts`
6. `index.ts` 只留组合；确认无残留顶层处理函数

搬迁规则：函数体、注释、错误文案、SQL **逐字移动**；import 按文件实际用到的符号收敛。

### P2 — 可选收口

- `messages.ts` 内 `pipeAgentStream`，让 retry 的 agent 两模式调用同一函数。
- 若 `sectionEdit.ts` 仍 > 500 行，再把三个分支拆成 `sectionEditEntity.ts` / `sectionEditElement.ts` / `sectionEditRewrite.ts`，由 `sectionEdit.ts` 做分支分发。P1 不强制。

### P3 — 文档与校验

- 更新根目录 `AGENTS.md`「项目目录结构」：`routes/` 从 `sessions.ts` 改为 `sessions/` 子目录，并点名 `crud` / `messages` / `versions` / `sectionEdit` 等职责（新增模块 checklist）。
- `pnpm lint` + `pnpm typecheck`（或 `--filter backend` 等价命令）必须通过。
- 对照本文 **2.2 端点表** 做一次手工/curl 冒烟（见第八节）。

---

## 八、验证计划

重构验收以「旧行为仍在」为准，不引入新用例。

### 8.1 静态

- [ ] `backend/src/routes/sessions.ts` 不再存放业务逻辑（要么删除，要么只 re-export）
- [ ] `backend/src/index.ts` 的 import 路径不变
- [ ] 无循环依赖：`mermaidEntity` → `htmlPatch` 单向；路由文件不互相 import，只依赖 `helpers/`
- [ ] `pnpm lint`、backend typecheck 通过

### 8.2 运行时冒烟（对已有会话 / 或新建后走一遍）

| 场景 | 期望 |
| ---- | ---- |
| 创建会话、列会话、取详情、删会话 | 与拆分前相同 |
| `PATCH /:id/modules` | outline / selected_modules 写入不变 |
| 发消息 SSE | delta →（可选 form）→ done；触发生成时 progress + prd_ready |
| retry 四种 mode | 参数校验与续写/重试/续生成/单模块重试语义不变 |
| `GET /:id/prd` 与 `GET .../sections` | HTML / 模块列表不变 |
| 版本 list / 新建 / 激活 / 克隆 / 删除 / 重命名 | 与 `docs/plan-prd-version-management.md` 一致 |
| PATCH section：全模块改写 | 流式 delta + 新 version + 整页 HTML |
| PATCH section：选中元素 / 表格坐标 | 补丁策略顺序不变（坐标 → 三层字符串/DOM） |
| PATCH section：ER 实体名 | 只改实体块 + entity-section |
| PUT content | `el-selected` 仍被剥离后落库 |
| rollback | version=1 仍 400；否则切回上一版并重装 HTML |

无浏览器工具时：用 curl 打 JSON 端点 + 对 SSE 端点读 `text/event-stream` 首尾事件；表格/实体补丁若缺现成数据，至少保证请求能进对应分支且错误码与原先一致。

---

## 九、风险

| 风险 | 缓解 |
| ---- | ---- |
| 目录 index 解析失败，后端起不来 | P0 先做整文件搬家并启动验证；失败则加薄壳 `sessions.ts` |
| `register*` 调用顺序错误，`GET /:id` 吃掉更具体路径 | `index.ts` 按本文 2.2 表固化顺序，PR 里重点 review 这一文件 |
| `persistSectionRevision` 抽错字段（漏 `title` / `session_id`） | 对照四处原 SQL 做参数表，单测或读回 `prd_sections` 行对比 |
| `patchElementInHtml` 与 `applyEntityPatch` 拆文件后循环依赖 | 实体缝合依赖元素补丁：只允许 `mermaidEntity → htmlPatch` |
| 大 diff 难以 review | 提交可按 P0 / P1 helpers / P1 routes 拆成 2–3 个 commit（若用户要求提交时再执行） |

---

## 十、AGENTS.md 同步清单（实施时勾选）

- [ ] 「文件目录规范」中 `backend/src/routes/` 由 `sessions.ts` 改为 `sessions/` 子目录，并简述各文件用途
- [ ] 不新增 npm 依赖，无需改白名单
- [ ] 不新增环境变量、表、端口、Prompt 模板

---

## 十一、建议实施顺序（给执行 agent）

1. 只写/改本计划范围内的后端路由文件，不动 frontend / services（`prdVersions.ts` 等）。
2. 先 P0 验证能启动，再 P1；不要在搬家同时改 retry 控制流。
3. P1 完成后跑 lint/typecheck，再按第八节冒烟。
4. 最后改 `AGENTS.md`。
5. **在用户明确要求之前不要 git commit。**
