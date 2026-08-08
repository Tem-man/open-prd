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

export interface QuestionForm {
	questions: Question[];
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
	{ id: "output", label: "输出 PRD", status: "pending" },
];
