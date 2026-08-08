import type { SectionOutline } from "../../prdOutline.js";
import { invokeModule } from "../base.js";
import { buildSkillBlock } from "../../skillLoader.js";

export async function generate(section: SectionOutline): Promise<string> {
	const skillBlock = buildSkillBlock("skill-prd-datamodel");
	const keyPoints = section.keyPoints
		.map((p, i) => `${i + 1}. ${p}`)
		.join("\n");

	const sys = `你是一位资深产品经理，正在为 PRD 生成数据模型。

${skillBlock}

输出规范：
- 先输出 Mermaid erDiagram 代码（从 "erDiagram" 开始，不含代码块标记）
- 然后输出分隔符 "---TABLE---"（独占一行）
- 最后为每一个实体输出一个独立区块（所有实体都必须输出，不可省略）：
  <div class="entity-section">
    <h4 class="entity-table-title">实体名（大写英文）</h4>
    <table class="prd-table entity-table">
      <tr><th>字段</th><th>类型</th><th>说明</th></tr>
      （除了可以跳过 id PK、created_at、updated_at 这些字段，其他字段都要列出）
    </table>
  </div>
- 严格遵循 Skill 中的 erDiagram 生成规则
- 不要在输出中添加任何 <script> 标签`;

	const user = `数据模型相关要点：\n\n${keyPoints}\n\n请按 Skill 规范生成 ER 图代码和实体说明区块。`;

	const raw = await invokeModule(sys, user);
	const sep = "---TABLE---";
	const sepIdx = raw.indexOf(sep);

	let mermaidCode: string;
	let tablesHtml: string;

	if (sepIdx >= 0) {
		mermaidCode = raw.slice(0, sepIdx).trim();
		tablesHtml = raw.slice(sepIdx + sep.length).trim();
	} else {
		// LLM 没有使用分隔符时，尝试从第一个 entity-section 区块分割
		const entityIdx = raw.indexOf('<div class="entity-section">');
		if (entityIdx >= 0) {
			mermaidCode = raw.slice(0, entityIdx).trim();
			tablesHtml = raw.slice(entityIdx).trim();
		} else {
			// 兜底：尝试找旧格式的单张表格
			const tableMatch = raw.match(/<table[\s\S]*<\/table>/i);
			if (tableMatch) {
				tablesHtml = tableMatch[0];
				mermaidCode = raw.slice(0, tableMatch.index).trim();
			} else {
				mermaidCode = raw;
				tablesHtml = "";
			}
		}
	}

	const cleaned = /^erDiagram/i.test(mermaidCode)
		? mermaidCode
		: `erDiagram\n${mermaidCode}`;

	return `<div class="mermaid">\n${cleaned}\n</div>${tablesHtml ? `\n${tablesHtml}` : ""}`;
}
