import type { SectionOutline } from '../../prdOutline.js';
import { invokeModule } from '../base.js';
import { getDb } from '../../../db/client.js';
import { buildSkillBlock } from '../../skillLoader.js';

/**
 * 自定义模块通用生成器。
 * 当 section.id 不在内置 MODULE_MAP 中时使用此生成器。
 *
 * 若该模块在 module_templates 中关联了 skill_name，则注入对应 Skill 规范（高质量路径）；
 * 否则 fallback 到原有 keyPoints 描述生成（向后兼容路径）。
 */
export async function generate(section: SectionOutline): Promise<string> {
  const keyPoints = section.keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n');

  // 查询该模块是否关联了 Skill
  const db = getDb();
  const row = db
    .prepare('SELECT skill_name FROM module_templates WHERE id = ?')
    .get(section.id) as { skill_name: string | null } | undefined;

  if (row?.skill_name) {
    // 高质量路径：注入 Skill 规范约束输出格式
    const skillBlock = buildSkillBlock(row.skill_name);
    const sys = `${skillBlock}

你是一位资深产品经理，正在撰写 PRD 文档中的「${section.title}」章节。
严格按照上方 Skill 规范中定义的展示形式和输出规范生成内容。

输出规范：
- 只输出 HTML 片段，不含 <html>/<head>/<body> 根标签
- 不要输出任何解释文字或 Markdown 代码块标记
- 直接输出 HTML 内容`;
    const user = `「${section.title}」关键要点：\n\n${keyPoints}\n\n请生成完整的 HTML 内容。`;
    return invokeModule(sys, user);
  }

  // 兜底路径：原有逻辑（向后兼容，已有自定义模块不受影响）
  const sys = `你是一位资深产品经理，正在撰写 PRD 文档中的「${section.title}」章节。
根据提供的关键要点，生成结构清晰、专业规范的 HTML 内容。

输出规范：
- 只输出 HTML 片段，不含 <html>/<head>/<body> 根标签
- 使用语义化标签：<h2> 子标题，<p> 正文，<ul><li> 列表，<table> 表格，<strong> 强调
- 根据内容性质灵活选择呈现方式（段落描述/列表/表格），不强制固定结构
- 内容需专业、实质丰富，不空泛
- 若关键要点中包含"建议补充"类提示，请在对应位置生成带有 <em class="placeholder"> 的占位提示
- 直接输出 HTML，不要加 Markdown 代码块`;

  const user = `「${section.title}」关键要点：\n\n${keyPoints}\n\n请生成完整的 HTML 内容。`;
  return invokeModule(sys, user);
}
