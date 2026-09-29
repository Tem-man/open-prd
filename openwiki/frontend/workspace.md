---
type: workflow
title: 会话工作区
description: 首页如何创建 PRD 会话或原型，会话页如何用 messages、sessions 和 prdVersions 三个 store 跟上 SSE、PRD HTML 和版本切换。
tags: [frontend, session, pinia, sse]
verified:
  - by: openwiki/0.6.0
    at: 2026-09-28T02:15:14.097Z
sources:
  - id: openwiki-source-454a466fc2df0ca0d89d982d
    resource: repo://frontend/src/composables/useSSE.ts
  - id: openwiki-source-c67cf72d81d24d0404120479
    resource: repo://frontend/src/stores/messages.ts
  - id: openwiki-source-5fd4236568a95cc18a136622
    resource: repo://frontend/src/stores/prdVersions.ts
  - id: openwiki-source-2c108c6a7aad156cf87be0b3
    resource: repo://frontend/src/stores/sessions.ts
  - id: openwiki-source-a900f418d5ebca00e251013c
    resource: repo://frontend/src/views/home/HomeView.vue
  - id: openwiki-source-7695936f24f118d347f7eb8c
    resource: repo://frontend/src/views/session/SessionView.vue
generated: { by: "cursor", at: "2026-09-28T02:15:14.097Z" }
---

# 会话工作区

工作区有两条入口。首页 `/` 用查询参数 `tab` 在 PRD、需求评估和原型之间切换。点「新建 PRD」会先打开模块选择器，确认后 `sessions` store 以所选模块 `POST /api/sessions`，再跳到 `/session/:id`。原型标签走的是另一条创建接口，不建 PRD 会话。需求评估标签的创建按钮目前直接返回，不发请求。

## 打开会话时加载什么

`SessionView` 挂载时先清空 `messages` store，再并行请求会话详情和 `GET /api/sessions/:id/prd`。

- `sessions` store 持有会话列表和 `currentSession`，包括已选模块。
- `messages` store 持有对话、当前 PRD 的 HTML、流水线状态和进度步骤。它从助手消息正文里剥掉 `[QUESTION_FORM]` 块和中断标记，用来还原表单和「回复被中断」。
- 进度步骤按会话已选模块初始化。PRD 的 `html` 非空才把步骤标成完成；空字符串仍记下 PRD id（顶栏版本入口可用），但进度保持未勾选，预览区显示空状态。

聊天不在 store 里直接 `fetch`。`useSSE` 先乐观插入用户气泡和一条流式助手气泡，再 `POST /api/sessions/:id/messages`，请求体带本轮模型配置、选中目标和确认动作。请求被拒绝时，这两条气泡会被撤掉，因为后端没有落库。流异常结束且助手仍在输出时，会带上 `Last-Event-ID` 再请求一次。用户主动中止则只结束本地流，不重连。

`prd_ready` 和章节编辑完成事件写回 `messages` 里的 PRD HTML。版本抽屉不自己拼文档。

## 版本切换如何把三处状态对齐

`prdVersions` store 持有版本列表。新建、激活、克隆或删除之后，它用接口返回的 `assembledPrdHtml` 刷新工作区：写回 PRD HTML，让 `prdEdit` store 重新拉取章节，再重新 `fetch` 会话。对话随版本走，所以消息列表会被整表替换，而不是在旧对话上打补丁。

空白版本会在拉会话之前先把进度打回未勾选，避免上一版的全勾选状态留下来。有内容且流水线还没结束时，用会话里的 `pipelineState` 恢复进度；已经完成则把步骤标成完成。

删除会话或原型在首页用确认框完成，分别打各自的删除接口，再从对应列表里拿掉。

## 接下来读哪里

- [对话回合](/openwiki/conversation/agent-turn.md)：这条 SSE 在后端如何编排。
- [PRD 章节编辑](/openwiki/prd/section-editing.md)：预览里的改写如何写回章节。
- [会话、文档与版本](/openwiki/persistence/documents.md)：版本接口背后的表。
- [原型编辑器](/openwiki/prototype/editor.md)：首页原型标签创建之后去哪。
