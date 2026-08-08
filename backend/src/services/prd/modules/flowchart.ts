import type { SectionOutline } from '../../prdOutline.js';
import { invokeModule } from '../base.js';
import { buildSkillBlock } from '../../skillLoader.js';
import { splitAndWrapFlowcharts } from './mermaidUtils.js';

export async function generate(section: SectionOutline): Promise<string> {
	const skillBlock = buildSkillBlock('skill-prd-flowchart');
	const keyPoints = section.keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n');

	const sys = `你是一位资深产品经理，正在为 PRD 生成业务流程图。

${skillBlock}

重要输出规范：
- 只输出 Mermaid flowchart TD 代码，从 "flowchart TD" 开始，不含 \`\`\`mermaid 标记
- 如需展示多个流程，每个流程单独输出一个完整的 flowchart TD 代码块，之间用空行分隔，禁止在同一个 flowchart TD 内再次声明 flowchart TD
- 严格遵循 Skill 中的节点类型、颜色语义、多角色泳道规范
- 不要输出任何说明文字`;

	const user = `业务流程相关要点：\n\n${keyPoints}\n\n请按 Skill 规范生成业务流程图 Mermaid 代码。`;

	const code = await invokeModule(sys, user);
	// 自动拆分多图、修复 subgraph 引号，每图独立包裹为 <div class="mermaid">
	return splitAndWrapFlowcharts(code);
}
