---
type: workflow
title: 对话回合
description: 一条用户消息如何进入收集或编辑阶段，工具如何被收窄，流式事件如何落到 SSE，以及超时、确认卡片和重试如何结束这一轮。
tags: [agent, conversation, sse, tools]
verified:
  - by: openwiki/0.6.0
    at: 2026-09-28T02:15:14.097Z
sources:
  - id: openwiki-source-b17657299c9e9d219312b3d9
    resource: repo://backend/src/routes/sessions/messages.ts
  - id: openwiki-source-3036b1dcb41fd7a5b43e297d
    resource: repo://backend/src/services/agent/orchestrator.test.ts
  - id: openwiki-source-0a8d12cca2cc759ba9257ebf
    resource: repo://backend/src/services/agent/orchestrator.ts
  - id: openwiki-source-e3e2917316bfcc89ef0b0126
    resource: repo://backend/src/services/sse.ts
  - id: openwiki-source-34fd9156c9287bf447ada25c
    resource: repo://backend/src/services/tools/askUserForm.ts
  - id: openwiki-source-fe831814fe4f0f8ddd1a0faa
    resource: repo://backend/src/services/tools/generatePrd.ts
  - id: openwiki-source-4fa0b33e5b8a42a599908457
    resource: repo://backend/src/services/tools/index.ts
  - id: openwiki-source-9919e9f6335262441e32ffa6
    resource: repo://backend/src/services/tools/sectionEdit.ts
generated: { by: "cursor", at: "2026-09-28T02:15:14.097Z" }
---

# 对话回合

一条用户消息从 `POST /api/sessions/:id/messages` 进入。路由先确认会话存在，把用户消息写入 SQLite，再开一条 SSE，把编排器事件转成增量、思考、表单、PRD 进度和章节编辑事件。这一轮结束时，助手可见文字、思考内容和编辑元数据一起落库。

阶段由「当前会话有没有一份带内容的 PRD」决定。`html` 非空，并且至少有一行 `is_current = 1` 的章节，才算编辑阶段。空白版本仍走收集阶段。没有这份 PRD 时，界面上传来的选中目标会被丢掉。

## 收集阶段和编辑阶段

收集阶段的系统提示只允许两件工具：`ask_user_form` 和 `generate_prd`。提示要求最多两轮提问，第二轮回答后必须生成，并且禁止在聊天气泡里输出 HTML、Mermaid 或 PRD 正文。

`ask_user_form` 会把问题规范化：选择题至少两个选项，文本题强制非必填，末尾若不是开放题就补上一道「你还有什么需要补充的吗？」。表单一发出，本轮以 `returnDirect` 结束，模型不会再被调用。同一轮第二次发卡片会被拒绝。

尚无 PRD 时，`generate_prd` 直接跑生成流水线，并用 `prd_progress` 报告每个模块。已有 PRD 时，这个工具只发确认卡片，不生成文档。确认 token 写进助手消息的元数据，不回给模型。真正的整份重生成由路由凭 token 执行，不经过模型。取消则 PRD 保持不变；选择先存版本再生成时，会先补齐 v1，再复制出一个新版本，然后跑流水线。已消费、已过期、版本已切换或属于其他会话的 token 会被拒绝。

编辑阶段在收集工具之外再打开 `list_sections`、`get_section`、`edit_section`、`edit_entity`、`regenerate_section` 和 `add_section`。测试锁定此时首轮可见工具为 8 个。未知模块返回可读错误，不抛异常。

## 选中片段时工具被收窄

用户在界面上选中某个模块或元素时，请求体里的 `target` 会写进发给模型的用户消息。首轮在还没有工具结果、且目标尚未被消费时，可见工具被收窄：整章目标只留 `edit_section`、`regenerate_section`、`edit_entity`；元素或单元格目标只留 `edit_section`。元素级调用无论模型填了哪个 `sectionId`，都落到用户选中的那一节。该元素改完后，同一轮再对这一节做整章改写或重写会被拒绝，提示「只选中了」，并且不会写入编辑记录。

## 流式输出和超时

编排器只转发名为 `model_request` 的模型节点。工具内部再调模型产生的 HTML 不会进聊天气泡。可见文字走 `delta`，思考内容走 `thinking`。

模型 token 之间的空闲超过 `LLM_IDLE_TIMEOUT_MS`（默认 20000 毫秒）会中止本轮。工具还在跑时不计这个时限，避免 PRD 生成被误杀。另外，整轮工具调用最多 12 次，`generate_prd` 最多 1 次，模型调用最多 14 次。

SSE 响应带 `X-Accel-Buffering: no`，并按 `SSE_HEARTBEAT_MS`（默认 10 秒）写心跳注释。客户端断开且响应尚未结束时，本轮会被中止。

## 失败后怎么续

生成成功时先发 `prd_ready`，再发 `done`。生成失败时发可重试错误，建议模式是 `continue_prd`。普通对话结束只发 `done`。

若中断前可见文字超过 20 字、已有思考内容或已有编辑，会把带中断标记的助手消息存下来。建议的重试模式是：已经开始生成则 `continue_prd`，已经说出一段话则 `continue_agent`，否则 `retry_last`。错误文案里带 idle 时，原因记为 `idle_timeout`；连接断开记为 `connection_lost`。

`POST .../messages/retry` 接受四种模式。`retry_last` 和 `continue_agent` 重放最后一条用户消息；后者还会把被中断的助手草稿交给模型续写。`continue_prd` 不走对话模型，直接续跑整份生成。`retry_section` 必须带 `sectionId`，只重做那一个模块。

请求头里的 `Last-Event-ID` 不会重放事件日志。只要它非空，路由就把最近一条已落库的助手消息（思考加正文）再推一遍然后结束。

`getAgentDriver()` 目前固定返回 LangChain 编排器。换到本地 Claude Code 或 Codex 的位置留在这个函数上，还没有第二条实现。

## 接下来读哪里

- [PRD 生成](/openwiki/prd/generation.md)：`generate_prd` 进入流水线之后。
- [PRD 章节编辑](/openwiki/prd/section-editing.md)：`edit_section` 如何改 HTML 并留版本。
- [模型接入与流式输出](/openwiki/model/providers-and-streaming.md)：思考内容和可见文字如何拆开。
- [会话工作区](/openwiki/frontend/workspace.md)：前端如何消费这些 SSE 事件。
- [行为测试](/openwiki/testing/behavior.md)：上面这些门槛对应的测试。
