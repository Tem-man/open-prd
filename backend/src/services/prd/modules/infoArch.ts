import type { SectionOutline } from '../../prdOutline.js';
import { invokeModule } from '../base.js';
import { buildSkillBlock } from '../../skillLoader.js';

export async function generate(section: SectionOutline): Promise<string> {
  const skillBlock = buildSkillBlock('skill-prd-infoarch');
  const keyPoints = section.keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n');

  const sys = `你是一位资深产品经理，正在为 PRD 生成信息架构思维导图。

${skillBlock}

重要输出规范：
- 只输出 Markdown 树状结构，从 # 根节点开始
- 严格遵循 Skill 中的层级规范（# / ## / ### / -）
- 不要输出任何说明文字`;

  const user = `信息架构相关要点：\n\n${keyPoints}\n\n请按 Skill 规范生成信息架构 Markdown 树。`;

  const markdown = await invokeModule(sys, user);

  // Markdown 以 JSON 存入隐藏 script 标签，由 runtime/prd-runtime.js 读取并渲染
  // 转义 < ：模型输出里的 </script> 会提前截断脚本块
  const json = JSON.stringify(markdown).replace(/</g, "\\u003c");
  return `<script type="application/json" id="markmap-data">${json}<\/script>
<div class="markmap-wrap">
  <svg id="markmap-svg" style="width:100%;height:560px;display:block;"></svg>
</div>`;
}
