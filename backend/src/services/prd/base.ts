import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { createChatModel } from '../llm.js';

/**
 * 调用 LLM 执行一次非流式推理，返回文本内容。
 * 自动剥离 LLM 有时会添加的 markdown 代码块包裹（```html / ```mermaid 等）。
 */
export async function invokeModule(
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const model = createChatModel();
  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(userPrompt),
  ]);

  const raw =
    typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

  // 剥离可能的代码块标记
  return raw
    .replace(/^```(?:html|mermaid|markdown|md|erdiagram|graphtb|flowchart|json)?\s*/im, '')
    .replace(/\s*```$/m, '')
    .trim();
}
