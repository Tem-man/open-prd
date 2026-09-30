---
type: operations
title: 进程托管
description: 开发时 Vite 和 Express 各占一个进程；PM2 只守护编译后的后端；Electron 把同一个 startServer 嵌进主进程。三种宿主的端口、数据库位置和失败方式不一样。
tags: [operations, electron, pm2, vite]
verified:
  - by: openwiki/0.6.0
    at: 2026-09-28T02:15:14.097Z
sources:
  - id: openwiki-source-4aff6d1caf9ba7257c5beb88
    resource: repo://backend/src/db/client.ts
  - id: openwiki-source-2a2dfd1bcd8735843534fafd
    resource: repo://backend/src/index.ts
  - id: openwiki-source-637dc5ee7b44844748b73b6f
    resource: repo://daemon/ecosystem.config.cjs
  - id: openwiki-source-d257c2ade7c84a9c546073ee
    resource: repo://daemon/package.json
  - id: openwiki-source-857d1056871d63360d501d67
    resource: repo://electron/package.json
  - id: openwiki-source-28de003f381ffa0a868534b7
    resource: repo://electron/src/main/index.ts
  - id: openwiki-source-5678b5e9df5b1d1081ac33c6
    resource: repo://electron/src/preload/index.ts
  - id: openwiki-source-69b522f10ffdb79d601b4fcf
    resource: repo://frontend/src/main.ts
  - id: openwiki-source-378e3cf05ab0d05d335c68d5
    resource: repo://frontend/vite.config.ts
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
generated: { by: "cursor", at: "2026-09-28T02:15:14.097Z" }
---

# 进程托管

根脚本 `pnpm dev` 并行启动 frontend 和 backend。`pnpm start`、`stop`、`restart` 交给 daemon 包里的 PM2。Electron 用自己的 `electron-vite dev`，不在这条并行命令里。

## 开发：两个进程，一个代理

Vite 固定监听 5173，把 `/api` 代理到 `http://localhost:3000`。后端作为主模块启动时调用 `startServer()`，端口是 `PORT` 或 3000，数据库默认 `backend/data/prd.db`。界面用相对路径 `/api`，所以它以为接口和页面同源，真正的一跳是 Vite 代理。

监听失败（例如 3000 已被占用）会让 `startServer` 的 Promise 拒绝。直接跑后端入口时，这个拒绝被抓住后打印日志并 `process.exit(1)`。前端进程不会因此退出。

## PM2：只守护后端

`daemon/ecosystem.config.cjs` 的应用名是 `open-prd-backend`，脚本是 `backend/dist/index.js`，`PORT` 固定 3000，工作目录是 daemon 目录。日志写到 `daemon/logs`。进程异常退出后等 3 秒再拉起，最多 10 次。它不设置 `DB_PATH`，编译后的客户端仍按自身路径解析到 `backend/data/prd.db`。

这台宿主不提供网页。浏览器要另有一个把 `/api` 转到 3000 的前端。连续启动失败超过 10 次后，PM2 不再重启，接口保持不可用。

## Electron：主进程里的同一台服务器

窗口创建之前先 `await startServer()`。打包后、调用之前，主进程把 `DATA_DIR` 和 `DB_PATH` 设为 `userData` 下的目录和 `prd.db`，原型文件因此和数据库放在一起。`NODE_ENV=development` 时窗口加载 `http://localhost:5173` 并打开开发工具；否则 `loadFile` 打开 `frontend/dist/index.html`。

preload 只暴露 `getApiPort`。Vue 入口不读它，页面仍请求相对 `/api`。开发态能通，是因为 5173 上的 Vite 把 `/api` 转到 3000，而这个 3000 必须是 Electron 刚刚绑定的那一个。若本机已经有 `pnpm dev` 的后端占着 3000，`startServer` 会失败，`whenReady` 没有接住这个拒绝，窗口也不会创建。打包态用 `file://` 打开页面，相对 `/api` 到不了内嵌端口。

`better-sqlite3` 是原生模块。Electron 换了 Node ABI 之后需要在 electron 包里执行 rebuild，否则内嵌服务在打开数据库时失败，同样走不到创建窗口。

## 接下来读哪里

- [快速开始](/openwiki/quickstart.md)：这几条命令怎么敲。
- [运行时架构](/openwiki/architecture/runtime.md)：请求穿过这些进程之后落在哪。
- [会话、文档与版本](/openwiki/persistence/documents.md)：`DB_PATH` 指向的库里有什么。
