---
type: testing
title: 行为测试
description: pnpm --filter backend test 只跑不联网的编排器和流式拆分。意图评测另走真实模型，变更类工具被换成只记录调用的桩，并且使用临时数据库。
tags: [testing, agent, streaming]
verified:
  - by: openwiki/0.6.0
    at: 2026-09-28T02:15:14.097Z
sources:
  - id: openwiki-source-9a7277933ab0110af5cb7cbe
    resource: repo://backend/package.json
  - id: openwiki-source-44a6cf114fcbf203d357ba9e
    resource: repo://backend/src/services/agent/__tests__/intentCases.ts
  - id: openwiki-source-8e2419af3e209cb116295124
    resource: repo://backend/src/services/agent/__tests__/intentEval.ts
  - id: openwiki-source-3036b1dcb41fd7a5b43e297d
    resource: repo://backend/src/services/agent/orchestrator.test.ts
  - id: openwiki-source-7627ac4d3958770273c23450
    resource: repo://backend/src/services/llmStream.test.ts
generated: { by: "cursor", at: "2026-09-28T02:15:14.097Z" }
---

# 行为测试

`backend` 的 `test` 脚本是 `tsx --test`，只包含 `llmStream.test.ts` 和 `orchestrator.test.ts`。它不调用外部模型。`test:intent` 是另一条命令，不在 `test` 里面。

## 不碰真实库

两个会写 SQLite 的文件都在导入 `db/client` 之前把 `DB_PATH` 设到系统临时目录下的新文件。编排器测试用 `node:test` 的 `before` 钩子再动态导入编排器和数据库，避免模块初始化时连上 `backend/data/prd.db`。意图评测同样先改 `DB_PATH`，再插入固定的会话、PRD 和示例章节。流式测试不打开数据库。

## 编排器测试锁住阶段和工具

脚本模型按预定的 `AIMessage` 回答，因此这些断言不依赖厂商。

收集阶段只有 `ask_user_form` 和 `generate_prd`。表单发出后模型只被调用一次，开放题会被自动补上。已有 PRD 时首轮可见 8 个工具。`list_sections` 能带回示例里的实体名 `BILL`。要求整份重做只会留下确认卡片，`recorder.prd` 仍为空。未知模块返回含「不存在」的工具结果，不抛异常。确认 token 在已消费、过期、版本 id 不同或跨会话时查找失败。工具内部模型产出的 `INNER_HTML_SECRET` 不会出现在回复或 `delta` 里。选中整章时首轮只有三个编辑工具，用户消息里带有 `sectionId`。选中单元格时首轮只有 `edit_section`；该目标标记为已消费后，再调用整章改写或重写会得到「只选中了」，且没有 `section_edit_done`。

## 流式拆分测试

`extractStreamParts` 的用例不启动服务。它们固定：纯字符串是可见文字；DeepSeek 的 `reasoning_content` 不混进正文；嵌套 `reasoning.content` 和 Anthropic 的 `thinking` / `text` 块分属两路；`tool_use` 不会被字符串化；空值和未知块得到空字符串；OpenAI 的 `summary` 数组按顺序拼进思考内容。

## 意图评测走真实模型

`pnpm --filter backend test:intent` 读取 `backend/.env` 的 `LLM_PROVIDER`、模型和密钥。界面里保存的模型配置不会传进来。未设置时把空闲超时提到 120 秒，避免首 token 慢被默认 20 秒杀掉。

`list_sections` 和 `get_section` 用真工具读示例 PRD。其余工具换成桩：记下名称和参数，返回「未真正执行」，不改章节。`ask_user_form` 和 `generate_prd` 保持 `returnDirect`。

用例在 `intentCases.ts`。期望序列按前缀匹配，参数字符串忽略大小写、只要包含即可。空期望表示不该出现任何变更类调用，例如询问架构图含义或表示认可。带 `editIntent` 的句子如果调了 `generate_prd` 或 `regenerate_section`，记为编辑被判成重新生成。准确率低于 90%，或出现任何不该有的 `generate_prd`，或出现这类误判，进程以退出码 1 结束。它打印的是每条 PASS/FAIL，不是测试框架里的断言失败。

## 接下来读哪里

- [对话回合](/openwiki/conversation/agent-turn.md)：这些断言对应的运行时门槛。
- [模型接入与流式输出](/openwiki/model/providers-and-streaming.md)：流式拆分的实现。
- [快速开始](/openwiki/quickstart.md)：命令放在哪一组脚本里。
