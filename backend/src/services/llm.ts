import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOllama } from '@langchain/ollama';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

/**
 * 整体请求超时（ms）。
 * 若 LLM_TIMEOUT_MS 未配置，默认 120 秒。
 * 该值作为 HTTP 请求级别的兜底，防止 API 端完全无响应时永久挂起。
 */
const REQUEST_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS ?? '120000', 10);

/**
 * 按 LLM_PROVIDER 环境变量实例化对应的 LangChain ChatModel。
 * openai 分支兼容所有 OpenAI API 格式的服务（OpenRouter、DeepSeek、SiliconFlow 等）。
 *
 * 调试：在 .env 中设置 LANGCHAIN_LLM_VERBOSE=true 可打印 LangChain [llm/start|end] 全量 JSON。
 */
export function createChatModel(): BaseChatModel {
  const provider = (process.env.LLM_PROVIDER ?? 'openai').toLowerCase();
  const model = process.env.LLM_MODEL ?? 'gpt-4o';
  const verbose = process.env.LANGCHAIN_LLM_VERBOSE === 'true';

  if (provider === 'openai' || provider === 'openrouter') {
    return new ChatOpenAI({
      model,
      apiKey: process.env.OPENAI_API_KEY,
      configuration: {
        baseURL: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
      },
      timeout: REQUEST_TIMEOUT_MS,
      verbose,
    });
  }

  if (provider === 'anthropic') {
    return new ChatAnthropic({
      model,
      apiKey: process.env.ANTHROPIC_API_KEY,
      clientOptions: {
        baseURL: process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
      },
      verbose,
    });
  }

  if (provider === 'ollama') {
    return new ChatOllama({
      model,
      baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
      verbose,
    });
  }

  throw new Error(
    `[llm] 未识别的 LLM_PROVIDER="${process.env.LLM_PROVIDER}"，可选值为：openai | anthropic | ollama`,
  );
}
