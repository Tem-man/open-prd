import type { SectionOutline } from '../../prdOutline.js';
import { invokeModule } from '../base.js';

export async function generate(section: SectionOutline): Promise<string> {
  const keyPoints = section.keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n');

  const sys = `你是一位资深产品经理，正在撰写 PRD 文档的「背景与目标」章节。
根据提供的关键要点，生成结构清晰、专业规范的 HTML 内容。

输出规范：
- 只输出 HTML 片段，不含 <html>/<head>/<body> 根标签
- 使用语义化标签：<h2> 子标题，<p> 正文，<ul><li> 列表，<strong> 强调
- 包含三个子章节，各用 <div class="prd-subsection"> 包裹：
  1. 项目背景：业务现状描述 + 核心痛点（2-3 段）
  2. 产品目标：SMART 格式目标，每条目标单独一个 <li>（3-5 条）
  3. 成功指标：可量化的衡量标准，带具体数值（3-5 条）
- 内容必须来源于提供的关键要点，禁止虚构
- 直接输出 HTML，不要加 Markdown 代码块`;

  const user = `「背景与目标」关键要点：\n\n${keyPoints}\n\n请生成完整的 HTML 内容。`;

  return invokeModule(sys, user);
}
