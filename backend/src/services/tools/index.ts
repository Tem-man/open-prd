import type { OrchestratorContext } from "../agent/types.js";
import { addSectionTool } from "./addSection.js";
import { askUserFormTool } from "./askUserForm.js";
import { generatePrdTool } from "./generatePrd.js";
import { getSectionTool, listSectionsTool } from "./sectionRead.js";
import {
	editEntityTool,
	editSectionTool,
	regenerateSectionTool,
} from "./sectionEdit.js";

export const TARGET_EDIT_TOOLS = ["edit_section", "regenerate_section", "edit_entity"];

/** 按阶段构建工具：收集阶段只暴露提问与生成，避免误调编辑工具 */
export function buildTools(ctx: OrchestratorContext) {
	const collect = [askUserFormTool(ctx), generatePrdTool(ctx)];
	if (!ctx.prdId) return collect;
	return [
		...collect,
		listSectionsTool(ctx),
		getSectionTool(ctx),
		editSectionTool(ctx),
		editEntityTool(ctx),
		regenerateSectionTool(ctx),
		addSectionTool(ctx),
	];
}
