export interface ModuleTemplate {
	id: string;
	name: string;
	description?: string;
	skillName?: string;
	renderType?: string;
	isBuiltin: boolean;
}

// ─── Pipeline 状态（会话恢复用）──────────────────────────────────────────────

export type PipelinePhase =
	| "idle"
	| "agent_interrupted"
	| "prd_generating"
	| "prd_partial"
	| "done";

export type RetryMode =
	| "retry_last"
	| "continue_agent"
	| "continue_prd"
	| "retry_section";

export interface PipelineLastError {
	reason: string;
	retryable: boolean;
	message?: string;
	suggestedMode?: RetryMode;
}

export interface PipelineState {
	phase: PipelinePhase;
	lastError?: PipelineLastError;
	/** sectionId → status，供 ProgressSteps 恢复显示 */
	outlineProgress?: Record<string, "pending" | "generating" | "done" | "error">;
	interruptedMessageId?: string;
	failedSectionId?: string;
}

export interface Session {
	id: string;
	title: string;
	status?: "active" | "completed" | "failed" | "cancelled";
	style?: string;
	selectedModules?: Array<{ id: string; name: string; description?: string }>;
	pipelineState?: PipelineState;
	created_at: number;
	updated_at: number;
}

/** Prototype document index (`.fig` lives on disk; this is the SQLite row). */
export interface Prototype {
	id: string;
	sessionId: string | null;
	title: string;
	fileName: string;
	fileSize: number;
	thumbnail: string | null;
	createdAt: number;
	updatedAt: number;
}

export interface Question {
	id: string;
	label: string;
	required: boolean;
	type: "single_choice" | "multi_choice" | "text";
	options?: string[];
	placeholder?: string;
}

export interface QuestionFormAction {
	token: string;
	kind: "regenerate_prd";
}

export type ConfirmDecision = "save_version_then_regenerate" | "overwrite" | "cancel";

/** 确认卡片选项下标 → 决策（与后端 pendingActions 顺序一致） */
export const CONFIRM_DECISIONS: ConfirmDecision[] = [
	"save_version_then_regenerate",
	"overwrite",
	"cancel",
];

export interface QuestionForm {
	questions: Question[];
	intro?: string;
	/** 存在时为服务端确认卡片，提交时携带 token */
	action?: QuestionFormAction;
}

export interface MessageEdit {
	sectionId: string;
	sectionTitle: string;
	elementLabel?: string;
	resultVersion: number;
	rolledBack?: boolean;
}

export interface MessageMeta {
	kind?: "prd_edit";
	edits?: MessageEdit[];
	pendingAction?: {
		token: string;
		status: "pending" | "consumed" | "cancelled";
		expiresAt: number;
	};
	citation?: { sectionId: string; sectionTitle?: string; elementLabel?: string };
}

export interface Message {
	id: string;
	sessionId: string;
	role: "user" | "assistant";
	content: string;
	createdAt: number;
	isStreaming?: boolean;
	/** true 表示该消息被 idle 中断，可展示「继续」按钮 */
	interrupted?: boolean;
	formData?: QuestionForm;
	formSubmitted?: boolean;
	/** 刷新后还原的已选答案（questionId → 选项或文本） */
	formAnswers?: Record<string, string | string[]>;
	/** 结构化提问表单的提交记录，对话窗不展示（答案已反映在表单选中态） */
	isFormAnswer?: boolean;
	/** 消息附带的动作按钮（如 PRD 完成后引导生成原型稿） */
	action?: MessageAction;
	/** 模型思考过程（仅展示，不回传 LLM） */
	thinking?: string;
	/** 思考是否仍在流式写入（折叠块 spinner / 默认展开） */
	isThinkingStreaming?: boolean;
	/** 后端落库的元数据（编辑记录、待确认动作等） */
	meta?: MessageMeta;
}

export interface MessageAction {
	type: "create-prototype";
	label: string;
}

export interface PrdOutlineSection {
	id: string;
	title: string;
	keyPoints: string[];
	icon?: string;
}

export interface PrdOutline {
	sections: PrdOutlineSection[];
}

export type WorkflowStepStatus = "pending" | "active" | "done" | "error";

export interface WorkflowStep {
	id: string;
	label: string;
	status: WorkflowStepStatus;
}

export const DEFAULT_WORKFLOW_STEPS: WorkflowStep[] = [
	{ id: "understand", label: "理解需求", status: "pending" },
	{ id: "clarify", label: "查漏补缺", status: "pending" },
	{ id: "background", label: "背景与目标", status: "pending" },
	{ id: "users", label: "用户与场景", status: "pending" },
	{ id: "features", label: "功能清单", status: "pending" },
	{ id: "architecture", label: "产品架构", status: "pending" },
	{ id: "flow", label: "业务流程", status: "pending" },
	{ id: "infoarch", label: "信息架构", status: "pending" },
	{ id: "datamodel", label: "数据模型", status: "pending" },
	{ id: "prototype", label: "原型设计依据", status: "pending" },
	{ id: "output", label: "输出 PRD", status: "pending" },
];

// ─── PRD 版本管理（Figma Page 模型）──────────────────────────────────────────

export interface PrdVersionMeta {
	id: string;
	version: number;
	label: string;
	source: "snapshot" | "blank" | "clone";
	isActive: boolean;
	createdAt: number;
	updatedAt: number;
}
