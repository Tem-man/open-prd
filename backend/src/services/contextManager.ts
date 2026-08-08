import {
  HumanMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { createChatModel } from './llm.js';

/**
 * trimHistory 的返回值。
 *
 * messages  — 裁剪后的纯对话消息（只含 HumanMessage / AIMessage），
 *             由 agent.ts 负责在最前面拼接 SystemMessage。
 * summary   — 当触发裁剪时生成的需求摘要文本（非 null 时由 agent.ts 注入
 *             buildSystemPrompt，避免 SystemMessage 混入历史数组导致的
 *             多 system message 问题）。
 */
export interface TrimResult {
  messages: BaseMessage[];
  summary: string | null;
}

/**
 * 用字符数 / 3 快速估算 token 数（无需精确 tokenizer）。
 */
export function estimateTokens(messages: BaseMessage[]): number {
  return messages.reduce((total, msg) => {
    const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    return total + Math.ceil(text.length / 3);
  }, 0);
}

/**
 * 调用 LLM 将对话历史提炼为需求摘要，防止关键信息在裁剪中丢失。
 * 返回纯文本，由调用方决定如何注入（不在此处创建 Message 对象）。
 */
async function summarizeHistory(messages: BaseMessage[]): Promise<string> {
  const model = createChatModel();

  const historyText = messages
    .map((m) => {
      const role = m._getType() === 'human' ? '用户' : 'AI';
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `${role}：${content}`;
    })
    .join('\n\n');

  // 一个 SystemMessage（角色指令）+ 一个 HumanMessage（待处理内容）
  const { SystemMessage } = await import('@langchain/core/messages');
  const response = await model.invoke([
    new SystemMessage(
      '你是一个信息提炼助手。请将以下对话中已确认的产品需求信息提炼为简洁的结构化摘要，' +
        '保留所有关键业务细节（目标用户、核心功能、技术平台、业务流程等）。' +
        '输出格式：用 Markdown 列表，不超过 500 字。',
    ),
    new HumanMessage(`对话记录：\n\n${historyText}`),
  ]);

  return typeof response.content === 'string'
    ? response.content
    : JSON.stringify(response.content);
}

/**
 * 裁剪历史消息，使总 token 数降至 maxTokens 以内。
 *
 * 返回 TrimResult：
 * - messages  只含 HumanMessage / AIMessage，不含任何 SystemMessage
 * - summary   裁剪发生时生成的需求摘要文本，由 agent.ts 注入 SystemPrompt
 *
 * 保留规则（优先级由高到低）：
 * 1. 最新一条 HumanMessage（当前用户输入，不可裁剪）
 * 2. 从最旧的消息开始丢弃，直到 token 总量降至 maxTokens
 *
 * @param messages  纯对话历史（只含 HumanMessage / AIMessage）
 * @param maxTokens token 上限，默认 12 000
 */
export async function trimHistory(
  messages: BaseMessage[],
  maxTokens = 12_000,
): Promise<TrimResult> {
  if (estimateTokens(messages) <= maxTokens) {
    return { messages, summary: null };
  }

  // 裁剪前先生成摘要，防止关键需求信息丢失
  const summary = await summarizeHistory(messages);

  // 找到最新一条 HumanMessage 的索引（必须保留）
  let lastHumanIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]._getType() === 'human') {
      lastHumanIdx = i;
      break;
    }
  }

  // 从最旧消息开始丢弃，保留最新的 HumanMessage
  const mustKeep = lastHumanIdx >= 0 ? [messages[lastHumanIdx]] : [];
  const canTrim = messages.filter((_, idx) => idx !== lastHumanIdx);

  // 摘要本身会被注入 SystemPrompt，占用部分 token，此处预留 500 token 给摘要
  const budgetForHistory = maxTokens - Math.ceil(summary.length / 3) - 500;
  const retained: BaseMessage[] = [...mustKeep];
  let currentTokens = estimateTokens(retained);

  // 从最新的可裁剪消息开始保留（保留近期上下文）
  for (let i = canTrim.length - 1; i >= 0; i--) {
    const candidate = canTrim[i];
    const candidateTokens = estimateTokens([candidate]);
    if (currentTokens + candidateTokens <= budgetForHistory) {
      retained.push(candidate);
      currentTokens += candidateTokens;
    }
  }

  // 按原始时序重新排列
  const sorted = retained.sort((a, b) => messages.indexOf(a) - messages.indexOf(b));

  return { messages: sorted, summary };
}
