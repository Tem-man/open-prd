import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { createChatModel } from "./llm.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// backend/src/services/ → backend/src/ → backend/ → open-prd/ → skills/
const SKILLS_ROOT = resolve(__dirname, "..", "..", "..", "skills");
const MERMAID_REF_ROOT = resolve(SKILLS_ROOT, "skill-mermaid", "references");

/**
 * 图类型关键词映射表：模块名 + 描述中的关键词 → 对应的 skill-mermaid reference 文件
 */
const DIAGRAM_KEYWORD_MAP: Array<{
	keywords: string[];
	file: string;
	label: string;
}> = [
	{
		keywords: [
			"占比",
			"频率",
			"比例",
			"分布",
			"构成",
			"饼图",
			"比重",
			"份额",
			"pie",
		],
		file: "pie.md",
		label: "Pie Chart（pie）",
	},
	{
		keywords: [
			"流程",
			"步骤",
			"审批",
			"旅程",
			"操作流",
			"业务流",
			"flowchart",
			"泳道",
		],
		file: "flowchart.md",
		label: "Flowchart（flowchart TD）",
	},
	{
		keywords: ["时序", "时序图", "接口调用", "消息序列", "sequence"],
		file: "sequenceDiagram.md",
		label: "Sequence Diagram（sequenceDiagram）",
	},
	{
		keywords: [
			"实体",
			"数据模型",
			"er图",
			"表结构",
			"数据库设计",
			"关系模型",
			"erdiagram",
		],
		file: "entityRelationshipDiagram.md",
		label: "ER Diagram（erDiagram）",
	},
	{
		keywords: ["类图", "类结构", "继承关系", "对象图", "classdiagram", "uml类"],
		file: "classDiagram.md",
		label: "Class Diagram（classDiagram）",
	},
	{
		keywords: ["状态机", "状态转换", "状态图", "statediagram"],
		file: "stateDiagram.md",
		label: "State Diagram（stateDiagram）",
	},
	{
		keywords: ["甘特", "项目计划", "里程碑", "排期", "进度计划", "gantt"],
		file: "gantt.md",
		label: "Gantt Chart（gantt）",
	},
	{
		keywords: ["用户旅程", "用户体验地图", "用户路径", "journey"],
		file: "userJourney.md",
		label: "User Journey（journey）",
	},
	{
		keywords: ["象限图", "四象限", "quadrant", "矩阵分析"],
		file: "quadrantChart.md",
		label: "Quadrant Chart（quadrantChart）",
	},
	{
		keywords: ["架构图", "系统架构", "组件架构", "architecture", "c4模型"],
		file: "architecture.md",
		label: "Architecture Diagram（architecture）",
	},
	{
		keywords: ["折线图", "柱状图", "趋势图", "xy图", "xychart", "数据趋势"],
		file: "xyChart.md",
		label: "XY Chart（xychart-beta）",
	},
	{
		keywords: ["雷达图", "多维对比", "雷达", "radar"],
		file: "radar.md",
		label: "Radar Chart（radar）",
	},
	{
		keywords: ["桑基图", "流量转化", "转化漏斗", "sankey"],
		file: "sankey.md",
		label: "Sankey Diagram（sankey-beta）",
	},
];

/**
 * 根据模块名称和描述检测最合适的 Mermaid 图类型。
 * 返回对应的 reference 文件名和图类型标签；无法匹配时返回 null。
 */
function detectMermaidDiagramType(
	moduleName: string,
	description: string,
): { file: string; label: string } | null {
	const text = `${moduleName} ${description}`.toLowerCase();
	for (const entry of DIAGRAM_KEYWORD_MAP) {
		if (entry.keywords.some((kw) => text.includes(kw.toLowerCase()))) {
			return { file: entry.file, label: entry.label };
		}
	}
	return null;
}

/**
 * 读取 skill-mermaid references 中对应图类型的语法文档。
 * - 跳过前 6 行自动生成的警告注释
 * - 截取前 maxLines 行核心语法内容，避免 prompt 超长
 */
function loadMermaidReference(refFile: string, maxLines = 160): string {
	try {
		const filePath = resolve(MERMAID_REF_ROOT, refFile);
		if (!existsSync(filePath)) return "";
		const raw = readFileSync(filePath, "utf-8");
		// 跳过开头的自动生成警告（前 6 行）
		const lines = raw.split("\n").slice(6);
		const truncated = lines.slice(0, maxLines);
		const suffix =
			lines.length > maxLines
				? `\n\n[...已截取前 ${maxLines} 行核心语法，完整文档见 skill-mermaid/references/${refFile}...]`
				: "";
		return truncated.join("\n") + suffix;
	} catch {
		return "";
	}
}

/**
 * create-skill 规范内容（硬编码），用于约束 Skill 生成格式。
 * 不依赖文件系统路径，确保在任何环境下都可用。
 */
const CREATE_SKILL_SPEC = `# create-skill 规范

## SKILL.md 结构要求
每个 SKILL.md 必须包含 YAML frontmatter 和 Markdown 正文：

\`\`\`markdown
---
name: your-skill-name
description: Brief description of what this skill does and when to use it
---

# Skill Title

## Instructions
Clear, step-by-step guidance.
\`\`\`

## 必填元数据字段
- name: 仅用 [a-z0-9-]，最长 64 字符
- description: 非空，最长 1024 字符，用第三人称，包含 WHAT（能做什么）和 WHEN（何时使用）

## 正文要求
- 控制在 500 行以内
- 简洁为要，避免冗余解释
- 使用具体示例，避免抽象描述
- 不要包含时效性信息
- 使用一致的术语

## 展示形式规范
根据用户选择的展示形式，在 SKILL.md 中明确说明：
- 文段：使用 <p>/<h2>/<h3>/<ul>/<li>/<strong> 等语义化 HTML 标签
- 表格：使用 <table class="prd-table"> 结构，包含 <thead>/<tbody>/<th>/<td>
- 文段+表格：先文字描述后表格，合理组合以上两种
- Mermaid图：使用 <div class="mermaid"> 包裹 Mermaid 语法，明确图类型（flowchart TD/sequenceDiagram/erDiagram等）
- 思维导图：使用 <script id="markmap-data" type="application/json"> 存储 Markdown 文本，<svg id="markmap-svg"> 作为渲染容器`;

export type RenderType =
	| "html"
	| "table"
	| "html+table"
	| "mermaid"
	| "markmap";

export interface BuildSkillInput {
	moduleName: string;
	userDescription: string;
	confirmedPoints: string[];
	renderType: RenderType;
}

/**
 * 第一轮：根据用户模块描述，生成内容要点建议列表（4-6 条）。
 * 供前端渲染多选题，默认全部预选。
 */
export async function suggestContentPoints(
	moduleName: string,
	userDescription: string,
): Promise<string[]> {
	const model = createChatModel();
	const sys = new SystemMessage(
		"你是一位产品经理助手。根据用户描述的模块诉求，提炼 4-6 个该模块应包含的具体内容要点。\n" +
			"要求：直接输出 JSON 数组，每项为一个简短要点字符串（不超过 20 字）。不要输出任何其他内容。",
	);
	const user = new HumanMessage(
		`模块名称：${moduleName}\n用户诉求：${userDescription}`,
	);

	try {
		const result = await model.invoke([sys, user]);
		const raw = typeof result.content === "string" ? result.content : "";
		// 剥离可能的代码块包裹
		const cleaned = raw
			.replace(/^```(?:json)?\s*/im, "")
			.replace(/\s*```$/m, "")
			.trim();
		const parsed = JSON.parse(cleaned);
		if (Array.isArray(parsed) && parsed.every((p) => typeof p === "string")) {
			return parsed.slice(0, 8);
		}
	} catch {
		// fallback 到空列表，前端可处理
	}
	return [];
}

/**
 * 第二轮完成后：根据两轮收集的信息生成 SKILL.md 内容。
 * 若展示形式为 Mermaid，自动从 skill-mermaid/references 注入对应图类型的权威语法文档。
 * 内置程序化校验，不合格自动重试（最多 2 次）。
 */
export async function generateSkillContent(
	input: BuildSkillInput,
	skillName: string,
	retryCount = 0,
): Promise<string> {
	const model = createChatModel();

	const renderTypeLabel: Record<RenderType, string> = {
		html: "文段（使用 <p>/<h>/<ul> 等语义化 HTML 元素）",
		table: '表格（使用 <table class="prd-table"> 结构）',
		"html+table": "文段+表格（先文字描述，再表格）",
		mermaid: 'Mermaid图（使用 <div class="mermaid"> 包裹 Mermaid 语法）',
		markmap: "思维导图（使用 markmap.js 渲染）",
	};

	// Mermaid 类型：检测图类型并注入对应的官方语法文档
	let mermaidRefSection = "";
	let detectedDiagramLabel = "";
	if (input.renderType === "mermaid") {
		const detected = detectMermaidDiagramType(
			input.moduleName,
			input.userDescription,
		);
		if (detected) {
			const refContent = loadMermaidReference(detected.file);
			if (refContent) {
				detectedDiagramLabel = detected.label;
				mermaidRefSection =
					`\n\n${"=".repeat(60)}\n` +
					`【Mermaid 权威语法参考 - 必须严格遵守】\n` +
					`检测到此模块应使用：${detected.label}\n` +
					`以下是该图类型的官方语法文档，你生成的 SKILL.md 中的所有示例代码必须严格符合此语法：\n\n` +
					refContent +
					`\n${"=".repeat(60)}`;
			}
		}
	}

	const sys = new SystemMessage(
		`你是一个专业的 SKILL.md 生成助手。你必须严格遵循以下规范生成 SKILL.md 文件内容：\n\n${CREATE_SKILL_SPEC}${mermaidRefSection}`,
	);

	const mermaidInstruction =
		input.renderType === "mermaid"
			? `\n【Mermaid 要求】\n` +
				(detectedDiagramLabel
					? `- 检测到应使用图类型：${detectedDiagramLabel}，必须在 SKILL.md 中明确说明此图类型并使用该语法\n` +
						`- 所有代码示例必须严格遵照上方「Mermaid 权威语法参考」中的语法，不得自行发明不存在的语法\n` +
						`- 在 SKILL.md「生成规则」章节中列出该图类型特有的语法约束（如 pie 的数值之和为 100 等）\n`
					: `- 请根据模块名称「${input.moduleName}」选择最合适的 Mermaid 图类型\n` +
						`- 所有代码示例必须使用正确的 Mermaid 语法\n`) +
				`- 代码示例必须用 <div class="mermaid"> 包裹，不得用 Markdown 代码块\n`
			: "";

	const user = new HumanMessage(
		`【重要】你正在为「${input.moduleName}」模块生成 SKILL.md，所有内容必须严格围绕「${input.moduleName}」主题，不得偏向其他无关主题。\n\n` +
			`模块名称：${input.moduleName}\n` +
			`name 字段使用此值：${skillName}\n` +
			`用户需求描述：${input.userDescription}\n` +
			`用户确认的内容要点：\n${input.confirmedPoints.map((p) => `- ${p}`).join("\n")}\n` +
			`展示形式：${renderTypeLabel[input.renderType]}\n` +
			mermaidInstruction +
			`\n输出要求：\n` +
			`- 直接输出完整的 SKILL.md 文件内容（含 YAML frontmatter）\n` +
			`- 不要加 Markdown 代码块包裹\n` +
			`- description 字段用中文第三人称，必须提及「${input.moduleName}」，说明该模块生成什么内容、何时使用\n` +
			`- 正文包含「工作流程」「输出规范」「输出示例」「生成规则（必须遵守）」四个章节\n` +
			`- 输出示例必须与「${input.moduleName}」直接相关，且语法正确可直接渲染`,
	);

	const result = await model.invoke([sys, user]);
	const content = typeof result.content === "string" ? result.content : "";
	const cleaned = content
		.replace(/^```(?:markdown|md)?\s*/im, "")
		.replace(/\s*```$/m, "")
		.trim();

	if (!validateSkillContent(cleaned) && retryCount < 2) {
		return generateSkillContent(input, skillName, retryCount + 1);
	}

	return cleaned;
}

/**
 * 程序化校验 SKILL.md 内容格式。
 */
export function validateSkillContent(content: string): boolean {
	const hasFrontmatter = /^---\r?\n[\s\S]+?\r?\n---/.test(content);
	const hasName = /^name:\s*.+/m.test(content);
	const hasDescription = /^description:\s*.+/m.test(content);
	const lineCount = content.split("\n").length;
	return hasFrontmatter && hasName && hasDescription && lineCount <= 500;
}

/**
 * 将生成的 SKILL.md 写入文件系统。
 * 命名安全校验：只允许 skill-custom- 前缀 + [a-z0-9-] 字符。
 */
export function writeSkillFile(skillName: string, content: string): void {
	if (!/^skill-custom-[a-z0-9-]+$/.test(skillName)) {
		throw new Error(`非法 Skill 名称：${skillName}`);
	}
	const dir = resolve(SKILLS_ROOT, skillName);
	// 若目录已存在（重新生成场景），直接覆盖
	mkdirSync(dir, { recursive: true });
	writeFileSync(resolve(dir, "SKILL.md"), content, "utf-8");
}

/**
 * 检查 Skill 目录是否已存在（用于 nanoid 碰撞检测）。
 */
export function skillExists(skillName: string): boolean {
	return existsSync(resolve(SKILLS_ROOT, skillName));
}

/**
 * AI 优化现有 Skill 内容。
 * 接收当前 Skill 内容和优化指令，返回优化后的内容（不写入，供前端预览确认）。
 */
export async function optimizeSkillContent(
	currentContent: string,
	instruction: string,
	retryCount = 0,
): Promise<string> {
	const model = createChatModel();

	const sys = new SystemMessage(
		`你是一个专业的 SKILL.md 优化助手。你需要根据用户指令修改现有的 SKILL.md 内容。\n\n` +
			`修改时必须严格遵循以下规范：\n${CREATE_SKILL_SPEC}`,
	);

	const user = new HumanMessage(
		`以下是当前的 SKILL.md 内容：\n\n${currentContent}\n\n` +
			`优化指令：${instruction}\n\n` +
			`要求：\n` +
			`- 直接输出修改后的完整 SKILL.md 文件内容（含 YAML frontmatter）\n` +
			`- 不要加 Markdown 代码块包裹\n` +
			`- 保留原有的 name 字段值不变\n` +
			`- 根据指令调整 description、正文内容和输出规范`,
	);

	const result = await model.invoke([sys, user]);
	const content = typeof result.content === "string" ? result.content : "";
	const cleaned = content
		.replace(/^```(?:markdown|md)?\s*/im, "")
		.replace(/\s*```$/m, "")
		.trim();

	if (!validateSkillContent(cleaned) && retryCount < 2) {
		return optimizeSkillContent(currentContent, instruction, retryCount + 1);
	}

	return cleaned;
}
