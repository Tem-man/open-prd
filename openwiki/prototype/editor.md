---
type: workflow
title: 原型编辑器
description: 原型的索引在 SQLite，二进制在 .fig 文件。画布是会话页之外的懒加载 Vue 路由；只有原型关联了 PRD 会话时，设计代理才会读「原型设计依据」章节。
tags: [prototype, editor, fig, prd]
verified:
  - by: openwiki/0.6.0
    at: 2026-09-28T02:15:14.097Z
sources:
  - id: openwiki-source-a0c8081a9596085a465ff8ac
    resource: repo://backend/src/routes/prototypes.ts
  - id: openwiki-source-7f1fd1afee120912646da7e9
    resource: repo://backend/src/services/prd/modules/prototypeBasis.ts
  - id: openwiki-source-44ef66a20374b0a4de8f8201
    resource: repo://backend/src/services/prototypeStore.ts
  - id: openwiki-source-5512e0ebc7731cb793836781
    resource: repo://frontend/src/pencil/app/ai/prdContext.ts
  - id: openwiki-source-77c413f182fc2eead5535edb
    resource: repo://frontend/src/router/index.ts
  - id: openwiki-source-b8d7c28d26281fbe5a5c3b4b
    resource: repo://frontend/src/views/prototype/PrototypeView.vue
  - id: openwiki-source-378e3cf05ab0d05d335c68d5
    resource: repo://frontend/vite.config.ts
  - id: openwiki-source-2d7be144ca0371d673c9bee0
    resource: repo://packages/PENCIL_UPSTREAM.md
generated: { by: "cursor", at: "2026-09-28T02:15:14.097Z" }
---

# 原型编辑器

首页的原型标签调用 `POST /api/prototypes`。服务端生成 id，先原子写入一个空的 `<id>.fig`，再插入 `prototypes` 行（标题默认「未命名原型」），然后前端跳到 `/prototype/:id`。可选的 `sessionId` 把这张稿和某个 PRD 会话连起来。SQLite 只存标题、文件名、大小和缩略图；字节不进库。

`GET /api/prototypes/:id` 按索引读文件。索引没有或文件丢了都是 404，后者文案是「原型文件缺失」，不当成 500。`PUT` 在 JSON 解析器之前用原始请求体接收，再临时文件加 `rename` 覆盖，并更新大小。`DELETE` 先删索引行再删文件，文件已经不在也不报错。`GET /meta` 和 `PATCH` 只动元数据。

## 编辑和放映是同一个页面

`/prototype/:id` 和 `/prototype/:id/present` 都渲染 `PrototypeView`，路由注释要求按原型 id 保持同一个实例，这样放映不用重新加载画布。不带 id 的 `/prototype` 回到首页的原型标签。

编辑器不进主包。`PrototypeView` 用异步组件加载 `PencilEditor`，并且故意不用 `<Suspense>`：Suspense 会在模板 ref 就绪前触发 `mounted`，画布在 `onMounted` 里拿不到 `<canvas>`。引擎包里的 `CanvasRoot` / `CanvasSurface` 有同样的时序问题，挂载必须用 `useCanvas` 配普通 canvas。画布资源按 URL 加载，所以前端构建的 `base` 保持相对路径。

## 原型依据怎么进设计代理

`prototypeBasis` 章节按 `skill-prd-prototype` 生成，结构是给设计代理用的页面清单、页面详情、导航和规范，不是给画布直接解析的场景图。

编辑器只在 `prototypes.session_id` 非空时去拉该会话的章节列表，取出 `sectionId === "prototypeBasis"` 的 HTML，转成纯文本（表格变成竖线分隔）并截到 6000 字。没有 PRD 或没有这一节是正常情况，依据为空。`beginPrdBasisLoad` 必须在 `PencilEditor` 的 setup 里同步调用。设计代理创建 transport 前会等待 `prdBasisReady()`；如果那时 Promise 已经结束，代理会在没有依据的情况下启动，之后再补上也进不去。

## 接下来读哪里

- [运行时架构](/openwiki/architecture/runtime.md)：`.fig` 和数据库放在哪个目录。
- [会话工作区](/openwiki/frontend/workspace.md)：首页如何进入这条路由。
- [PRD 生成](/openwiki/prd/generation.md)：`prototypeBasis` 章节何时被写出来。
- [图表与模块 Skill](/openwiki/skills/diagram-skills.md)：`skill-prd-prototype` 约束什么。
