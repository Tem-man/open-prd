---
type: integration
title: 模型接入与流式输出
description: 对话优先用请求体里的模型配置创建 ChatModel，没有配置时才回落到环境变量。流式块被拆成可见文字和思考内容，未知结构不会进聊天气泡。
tags: [llm, streaming, providers]
verified:
  - by: openwiki/0.6.0
    at: 2026-09-28T02:15:14.097Z
sources:
  - id: openwiki-source-8999fd1e3c1a7be3f902f940
    resource: repo://backend/.env.example
  - id: openwiki-source-079b165c55dcae5feb167aea
    resource: repo://backend/src/services/llm.ts
  - id: openwiki-source-7627ac4d3958770273c23450
    resource: repo://backend/src/services/llmStream.test.ts
  - id: openwiki-source-96b4c6dc83f577d1a140cf70
    resource: repo://backend/src/services/llmStream.ts
  - id: openwiki-source-454a466fc2df0ca0d89d982d
    resource: repo://frontend/src/composables/useSSE.ts
generated: { by: "cursor", at: "2026-09-28T02:15:14.097Z" }
---

# 模型接入与流式输出

每一轮对话在 `runWithLlmConfig` 里执行。请求体带了合法的 `llm` 时，这次调用用 `AsyncLocalStorage` 盖住进程级配置；`createChatModel()` 先读这份覆盖，没有才读环境变量。界面发送消息时如果组不出模型载荷，`useSSE` 直接返回，不会打到后端。

## 请求体里的厂商

运行时配置必须有 `providerID`、`model` 和 API Key。`acp:` 前缀和 `google` 会被拒绝，提示改用 OpenAI 兼容或 Anthropic 兼容提供商。

OpenAI 家族是 `openai`、`openrouter`、`deepseek`、`minimax`、`openai-compatible`，都建成 `ChatOpenAI`。Anthropic 家族是 `anthropic`、`anthropic-compatible`、`zai`，都建成 `ChatAnthropic`。已知厂商有默认 Base URL；兼容厂商没填 Base URL 会报错。自定义 `baseURL` 优先于默认值。`maxOutputTokens` 会被夹在 1024 和 128000 之间。OpenAI 家族把 HTTP 超时设为 `LLM_TIMEOUT_MS`，默认 120 秒，避免对端无响应时一直挂着。

这条路径不接受 `ollama`。本地 Ollama 只存在于环境变量回落里。

## 环境变量回落

没有请求级配置时，`LLM_PROVIDER` 默认 `openai`，`LLM_MODEL` 默认 `gpt-4o`。`openai` 和 `openrouter` 读 `OPENAI_API_KEY` 与 `OPENAI_BASE_URL`。`anthropic` 读 `ANTHROPIC_API_KEY` 与 `ANTHROPIC_BASE_URL`。`ollama` 读 `OLLAMA_BASE_URL`，默认 `http://localhost:11434`，不需要 API Key。其他取值直接抛错。`LANGCHAIN_LLM_VERBOSE=true` 时两条路径都会把 LangChain 的详细日志打开。

意图评测走的是这份环境变量，不读界面里保存的模型。

## 可见文字和思考内容

编排器对 `model_request` 节点的每个块调用 `extractStreamParts`。字符串 `content` 整段算可见文字。`additional_kwargs` 或块本身上的 `reasoning_content`、字符串 `reasoning`、嵌套的 `content` / `text`，以及 `summary` 数组，算思考内容。内容数组里 `type` 为 `thinking` 或 `reasoning` 的块只进思考；`text` 和 `output_text` 只进可见文字。`tool_use` 以及其他未知块被丢掉，不会 `JSON.stringify` 进气泡。`null`、空对象和空字符串都得到两条空通道。

测试把这套拆分固定下来：DeepSeek 的 `reasoning_content` 不混进正文，Anthropic 风格的内容数组分开两路，OpenAI 的 `summary` 数组按顺序拼成思考文本。

## 接下来读哪里

- [对话回合](/openwiki/conversation/agent-turn.md)：拆开的两路如何变成 SSE。
- [行为测试](/openwiki/testing/behavior.md)：流式测试和意图评测怎么跑。
- [进程托管](/openwiki/operations/process-hosts.md)：`.env` 在哪种宿主下生效。
