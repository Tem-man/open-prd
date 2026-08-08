import type { SectionOutline } from '../../prdOutline.js';
import { invokeModule } from '../base.js';
import { buildSkillBlock } from '../../skillLoader.js';
import { sanitizeMermaidSubgraphs } from './mermaidUtils.js';

export async function generate(section: SectionOutline): Promise<string> {
  const skillBlock = buildSkillBlock('skill-prd-architecture');
  const keyPoints = section.keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n');

  const sys = `你是一位资深产品架构师，正在为 PRD 生成产品架构图。

${skillBlock}

重要输出规范：
- 只输出 Mermaid graph TB 代码，从 "graph TB" 开始，不含 \`\`\`mermaid 标记
- 严格遵循 Skill 中的五层结构与节点命名规范
- 不要输出任何说明文字`;

  const user = `产品架构相关要点：\n\n${keyPoints}\n\n请按 Skill 规范生成架构图 Mermaid 代码。`;

  const code = await invokeModule(sys, user);
  const normalized = /^graph\s+TB/i.test(code) ? code : `graph TB\n${code}`;
  const cleaned = sanitizeMermaidSubgraphs(normalized);
  return `<div class="mermaid">\n${cleaned}\n</div>`;
}
