---
type: architecture
title: 运行时架构
description: Vue 工作区、Express 接口、SQLite、磁盘上的原型文件和 Electron 壳共用同一个后端进程。设计画布跑在前端里，不是独立服务。
tags: [architecture, runtime, express, electron, sqlite]
verified:
  - by: openwiki/0.6.0
    at: 2026-09-28T02:15:14.097Z
sources:
  - id: openwiki-source-4aff6d1caf9ba7257c5beb88
    resource: repo://backend/src/db/client.ts
  - id: openwiki-source-2a2dfd1bcd8735843534fafd
    resource: repo://backend/src/index.ts
  - id: openwiki-source-44ef66a20374b0a4de8f8201
    resource: repo://backend/src/services/prototypeStore.ts
  - id: openwiki-source-637dc5ee7b44844748b73b6f
    resource: repo://daemon/ecosystem.config.cjs
  - id: openwiki-source-28de003f381ffa0a868534b7
    resource: repo://electron/src/main/index.ts
  - id: openwiki-source-5678b5e9df5b1d1081ac33c6
    resource: repo://electron/src/preload/index.ts
  - id: openwiki-source-69b522f10ffdb79d601b4fcf
    resource: repo://frontend/src/main.ts
  - id: openwiki-source-77c413f182fc2eead5535edb
    resource: repo://frontend/src/router/index.ts
  - id: openwiki-source-b8d7c28d26281fbe5a5c3b4b
    resource: repo://frontend/src/views/prototype/PrototypeView.vue
  - id: openwiki-source-7695936f24f118d347f7eb8c
    resource: repo://frontend/src/views/session/SessionView.vue
  - id: openwiki-source-378e3cf05ab0d05d335c68d5
    resource: repo://frontend/vite.config.ts
generated: { by: "cursor", at: "2026-09-28T02:15:14.097Z" }
---

# 运行时架构

OpenPRD 是一个 pnpm 工作区，运行时有五个职责方：`frontend` 里的 Vue 应用、`backend` 里的 Express 接口、`daemon` 里的 PM2 宿主、`electron` 壳，以及 `packages` 下在浏览器里跑的设计引擎。只有后端进程读写 SQLite 和原型文件。画布没有自己的端口。

## 谁负责什么

`pnpm dev` 同时启动前端和后端。后端监听 `PORT`，未设置时用 3000。它在第一次使用时打开数据库、创建原型目录，并挂上 `/api/sessions`、`/api/modules`、`/api/prototypes` 三个路由，外加 `GET /health`。`PUT /api/prototypes/:id` 的原始请求体处理写在 `express.json` 之前，因此 `.fig` 上传不会被当成 JSON 解析。

Vue 应用是工作区界面。路由包括 `/`（首页）、`/session/:id`（对话和 PRD），以及 `/prototype/:id` 和 `/prototype/:id/present`（同一个原型视图，在放映切换时保持挂载）。不带 id 的 `/prototype` 会重定向回首页。

设计引擎通过 Vite 的 `@pencil` 别名打进前端包。打开原型时，编辑器在同一页里懒加载，不是旁路进程。

## 请求如何到达 Express

浏览器开发服务器里，Vite 监听 5173，把所有 `/api` 请求代理到 `http://localhost:3000`。会话页用相对路径 `fetch` 打这个前缀，例如打开会话时请求 `GET /api/sessions/:id/prd`。聊天、版本、模块和原型走同一套相对地址。

Electron 主进程从后端导入 `startServer`，等到端口绑定后再创建窗口。打包后的应用会先把 `DATA_DIR` 和 `DB_PATH` 指到 Electron 的 `userData`，再用 `loadFile` 打开 `frontend/dist/index.html`。开发态的 Electron 窗口则加载 `http://localhost:5173`。preload 暴露了 `electronAPI.getApiPort`，Vue 入口没有读取它。因此打包后的页面仍在 `file://` 源上请求 `/api`，到不了内嵌的服务器。开发态能通，是因为 Vite 源把 `/api` 代理到 3000，而这个端口必须正好是 `startServer` 实际绑定的端口。

## 后端存什么

SQLite 是每个进程一个 `better-sqlite3` 连接。`getDb()` 打开 WAL 和外键，创建基础表并跑迁移。文件默认是 `backend/data/prd.db`，可用 `DB_PATH` 覆盖。会话、消息、PRD HTML 和版本行都在这个库里。

原型字节是文件，不是数据库大字段。它们放在 `<数据目录>/prototypes/<id>.fig`。数据目录优先取 `DATA_DIR`，否则取 `DB_PATH` 所在目录，再否则是 `backend/data`。写入先落到临时文件，再 `rename` 覆盖目标。HTTP 路由拒绝不是单一路径段的文件名。

## 宿主有什么差别

PM2 应用 `open-prd-backend` 只跑 `backend/dist/index.js`，端口 3000。最多重启 10 次，每次间隔 3 秒，不托管 Vue 应用。要用这个宿主打开界面，前端仍需自己把 `/api` 转发出去。

Electron 是同时内嵌 Express 并打开界面窗口的宿主。它不改变数据库或原型目录的布局，只在打包时把它们挪到 `userData` 下面。

## 接下来读哪里

- [快速开始](/openwiki/quickstart.md)：启动这些进程的命令。
- [进程托管](/openwiki/operations/process-hosts.md)：守护进程和 Electron 启动失败时的行为。
- [会话、文档与版本](/openwiki/persistence/documents.md)：接口背后的表。
- [原型编辑器](/openwiki/prototype/editor.md)：画布和 `.fig` 路由。
- [对话回合](/openwiki/conversation/agent-turn.md)：`/api/sessions/:id/messages` 到达之后做什么。
