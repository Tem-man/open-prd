---
type: guide
title: 快速开始
description: 用 pnpm 安装并同时启动前端和后端。界面在 5173，接口在 3000。改对话、PRD、原型或测试时，从这里跳到对应说明。
tags: [quickstart, pnpm, development]
verified:
  - by: openwiki/0.6.0
    at: 2026-09-28T02:15:14.097Z
sources:
  - id: openwiki-source-8999fd1e3c1a7be3f902f940
    resource: repo://backend/.env.example
  - id: openwiki-source-9a7277933ab0110af5cb7cbe
    resource: repo://backend/package.json
  - id: openwiki-source-2a2dfd1bcd8735843534fafd
    resource: repo://backend/src/index.ts
  - id: openwiki-source-77c413f182fc2eead5535edb
    resource: repo://frontend/src/router/index.ts
  - id: openwiki-source-378e3cf05ab0d05d335c68d5
    resource: repo://frontend/vite.config.ts
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-40275cb92c3610938f16ade3
    resource: repo://pnpm-workspace.yaml
generated: { by: "cursor", at: "2026-09-28T02:15:14.097Z" }
---

# 快速开始

仓库是 pnpm 工作区，包含 `frontend`、`backend`、`daemon`、`electron` 和 `packages/*`。在仓库根目录执行 `pnpm install`。不要用 npm 安装依赖。

把 `backend/.env.example` 复制为 `backend/.env`，至少填好 `LLM_PROVIDER`、模型和对应密钥。不填请求级配置时，对话和意图评测都读这份文件。本地 Ollama 只需要 `OLLAMA_BASE_URL`。

## 把应用跑起来

`pnpm dev` 并行启动前端和后端。浏览器打开 Vite 的 5173。`/api` 会被代理到后端的 `PORT` 或 3000。`GET /health` 返回 `{ status: "ok" }`。

页面只有三条业务路由：`/` 首页，`/session/:id` 对话和 PRD，`/prototype/:id` 以及同 id 的 `/present` 放映。

`pnpm start` 用 PM2 只守护编译后的后端，不打开界面。Electron 用 `pnpm --filter electron dev`，和 `pnpm dev` 不是同一条命令。端口冲突和打包后相对 `/api` 到不了内嵌服务的原因，见运行时架构和进程托管。

## 改哪里就读哪一页

| 你要做的事 | 先读 |
| --- | --- |
| 看清浏览器、Express、数据库和 Electron 谁连谁 | [运行时架构](/openwiki/architecture/runtime.md) |
| 改一条用户消息如何选工具、流式输出或重试 | [对话回合](/openwiki/conversation/agent-turn.md) |
| 改整份 PRD 如何从大纲写成 HTML | [PRD 生成](/openwiki/prd/generation.md) |
| 改某一节的 AI 改写、手动保存或回滚 | [PRD 章节编辑](/openwiki/prd/section-editing.md) |
| 改版本切换时对话是否跟着走 | [会话、文档与版本](/openwiki/persistence/documents.md) |
| 改首页、聊天气泡或版本抽屉 | [会话工作区](/openwiki/frontend/workspace.md) |
| 改画布、`.fig` 或原型依据 | [原型编辑器](/openwiki/prototype/editor.md) |
| 改厂商、密钥或思考内容如何进气泡 | [模型接入与流式输出](/openwiki/model/providers-and-streaming.md) |
| 改架构图、流程图等输出格式 | [图表与模块 Skill](/openwiki/skills/diagram-skills.md) |
| 改守护进程或桌面壳 | [进程托管](/openwiki/operations/process-hosts.md) |

提交前在仓库根跑 `pnpm lint` 和 `pnpm typecheck`。只想验证对话行为时，在 backend 包跑 `pnpm test`。那条命令不打模型。要拿真实模型对意图用例，另跑 `pnpm test:intent`，它需要 `.env` 里的密钥，并且使用临时数据库。细节在 [行为测试](/openwiki/testing/behavior.md)。
