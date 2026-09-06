import type { SectionOutline } from '../../prdOutline.js';
import { invokeModule } from '../base.js';
import { buildSkillBlock } from '../../skillLoader.js';

/**
 * 「原型设计依据」章节生成器。
 * 该章节的首要读者是原型设计编辑器的 AI 代理，因此通过 skill-prd-prototype
 * 固化输出结构（页面清单 / 页面详情 / 导航关系 / 设计规范 / 流程映射），
 * 保证内容稳定、可直接据此绘制原型页面。
 */
export async function generate(section: SectionOutline): Promise<string> {
  const keyPoints = section.keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n');

  const skillBlock = buildSkillBlock('skill-prd-prototype');
  const sys = `${skillBlock}

你是一位资深产品经理兼 UX 设计师，正在撰写 PRD 文档中的「${section.title}」章节。
该章节将作为原型设计 AI 代理生成原型稿的直接依据，必须严格遵循上方 Skill 规范中定义的结构与输出要求。

输出规范：
- 只输出 HTML 片段，不含 <html>/<head>/<body> 根标签
- 不要输出任何解释文字或 Markdown 代码块标记
- 直接输出 HTML 内容`;
  const user = `「${section.title}」关键要点：\n\n${keyPoints}\n\n请生成完整的 HTML 内容。`;
  return invokeModule(sys, user);
}
