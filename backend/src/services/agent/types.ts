import type { TableElementPath } from "../../routes/sessions/helpers/htmlPatch.js";
import type { SelectedModule } from "../prompts.js";

/** 前端 chip 指向的编辑目标；精确定位参数只来自界面点选，不经模型 */
export interface ComposerTarget {
	sectionId: string;
	sectionTitle?: string;
	elementLabel?: string;
	selectedElementHtml?: string;
	entityName?: string;
	tablePath?: TableElementPath;
}

export interface FormQuestion {
	id: string;
	label: string;
	type: "single_choice" | "multi_choice" | "text";
	required: boolean;
	options?: string[];
	placeholder?: string;
}

export interface FormAction {
	token: string;
	kind: "regenerate_prd";
}

export interface FormPayload {
	questions: FormQuestion[];
	intro?: string;
	action?: FormAction;
}

export interface EditRecord {
	sectionId: string;
	sectionTitle: string;
	elementLabel?: string;
	resultVersion: number;
	kind: "edit" | "entity" | "regenerate" | "add";
}

export interface PendingAction {
	token: string;
	kind: "regenerate_prd";
	prdId: string;
	activeVersionId: string | null;
	expiresAt: number;
	status: "pending" | "consumed" | "cancelled";
}

export type PrdOutcome =
	| { status: "ready"; prdId: string; warnings: string[] }
	| { status: "failed"; reason: string; message: string };

/** 编排 Agent 推给 SSE 映射层的事件 */
export type OrchestratorEvent =
	| { type: "delta"; content: string }
	| { type: "thinking"; content: string }
	| { type: "form"; data: FormPayload }
	| {
			type: "prd_progress";
			sectionId: string;
			status: "generating" | "done" | "error";
	  }
	| { type: "section_patch_start"; sectionId: string }
	| { type: "section_edit_delta"; sectionId: string; content: string }
	| {
			type: "section_edit_done";
			sectionId: string;
			newHtml: string;
			version: number;
			assembledPrdHtml: string;
	  }
	| { type: "section_edit_error"; sectionId: string; message: string }
	| { type: "session_modules_updated"; selectedModules: SelectedModule[] };

/** 单轮内工具写入的副作用记录，路由据此落库 */
export interface TurnRecorder {
	form: FormPayload | null;
	edits: EditRecord[];
	pendingAction: PendingAction | null;
	prd: PrdOutcome | null;
	/** 本轮是否启动过整篇生成流水线（中断时据此建议 continue_prd） */
	generationStarted: boolean;
	/** chip 目标已被某次编辑消费（元素 / 实体补丁只应用一次） */
	targetConsumed: boolean;
}

/** 点选到具体元素 / 实体（而非整个模块）的目标 */
export function isElementTarget(target: ComposerTarget | null): boolean {
	return !!target && !!(target.selectedElementHtml || target.entityName);
}

export interface OrchestratorContext {
	sessionId: string;
	/** null = 尚无 PRD 内容（收集阶段） */
	prdId: string | null;
	modules: SelectedModule[];
	target: ComposerTarget | null;
	signal: AbortSignal;
	recorder: TurnRecorder;
	emit: (evt: OrchestratorEvent) => void;
}

export function createTurnRecorder(): TurnRecorder {
	return {
		form: null,
		edits: [],
		pendingAction: null,
		prd: null,
		generationStarted: false,
		targetConsumed: false,
	};
}
