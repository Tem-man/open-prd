import { defineStore } from "pinia";
import { ref } from "vue";
import type {
	Message,
	MessageAction,
	MessageEdit,
	MessageMeta,
	PipelineState,
	Question,
	QuestionForm,
	RetryMode,
	WorkflowStep,
	WorkflowStepStatus,
} from "@/types";
import { DEFAULT_WORKFLOW_STEPS } from "@/types";

/** module id (from backend/ModuleManager) → WorkflowStep id */
const MODULE_TO_STEP_ID: Record<string, string> = {
	background: "background",
	userScenario: "users",
	featureList: "features",
	architecture: "architecture",
	flowchart: "flow",
	infoArch: "infoarch",
	dataModel: "datamodel",
	prototypeBasis: "prototype",
};

/** section id（后端 outline key）→ WorkflowStep id */
const SECTION_TO_STEP: Record<string, string> = {
	background: "background",
	userScenario: "users",
	featureList: "features",
	architecture: "architecture",
	flowchart: "flow",
	infoArch: "infoarch",
	dataModel: "datamodel",
	prototypeBasis: "prototype",
};

/** 中断标记正则（与后端 pipelineState.ts 保持一致） */
const INTERRUPT_RE = /(?:\[⚠ 生成中断(?:\|[^\]|]+)?\]|\[⚠ 回复被中断\])\s*$/;

const QUESTION_FORM_START = "[QUESTION_FORM]";
const QUESTION_FORM_END = "[/QUESTION_FORM]";

export function stripInterruptMarker(content: string): {
	clean: string;
	interrupted: boolean;
} {
	if (!INTERRUPT_RE.test(content))
		return { clean: content, interrupted: false };
	return {
		clean: content.replace(INTERRUPT_RE, "").trimEnd(),
		interrupted: true,
	};
}

/** 从消息 content 提取 QUESTION_FORM 块（与后端 extractQuestionForm 语义一致） */
export function extractQuestionForm(content: string): {
	clean: string;
	formData: QuestionForm | null;
} {
	const startIdx = content.indexOf(QUESTION_FORM_START);
	const endIdx = content.indexOf(QUESTION_FORM_END);
	if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
		return { clean: content, formData: null };
	}
	const jsonStr = content
		.slice(startIdx + QUESTION_FORM_START.length, endIdx)
		.trim();
	const clean = (
		content.slice(0, startIdx) +
		content.slice(endIdx + QUESTION_FORM_END.length)
	).trim();
	try {
		const parsed = JSON.parse(jsonStr) as QuestionForm;
		if (!parsed || !Array.isArray(parsed.questions)) {
			return { clean: content, formData: null };
		}
		return {
			clean,
			formData: {
				questions: parsed.questions,
				...(parsed.intro ? { intro: parsed.intro } : {}),
				...(parsed.action ? { action: parsed.action } : {}),
			},
		};
	} catch {
		return { clean: content, formData: null };
	}
}

/**
 * 从用户提交的答案文本还原各题选中值。
 * 格式与 QuestionForm handleSubmit 一致：`标签：答案`，多选用顿号拼接。
 */
export function parseFormAnswers(
	questions: Question[],
	userContent: string,
): Record<string, string | string[]> {
	const answers: Record<string, string | string[]> = {};
	const lines = userContent
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);

	for (const q of questions) {
		const prefix = `${q.label}：`;
		const line = lines.find((l) => l.startsWith(prefix));
		if (!line) {
			answers[q.id] = q.type === "multi_choice" ? [] : "";
			continue;
		}
		const raw = line.slice(prefix.length).trim();
		if (!raw || raw === "（未填写）") {
			answers[q.id] = q.type === "multi_choice" ? [] : "";
			continue;
		}
		if (q.type === "multi_choice") {
			const parts = raw
				.split("、")
				.map((p) => p.trim())
				.filter(Boolean);
			const opts = new Set(q.options ?? []);
			answers[q.id] = opts.size > 0 ? parts.filter((p) => opts.has(p)) : parts;
		} else if (q.type === "single_choice") {
			answers[q.id] = raw;
		} else {
			answers[q.id] = raw;
		}
	}

	return answers;
}

function parseMessageMeta(raw: string | undefined): MessageMeta | undefined {
	if (!raw || raw === "{}") return undefined;
	try {
		const parsed = JSON.parse(raw) as MessageMeta;
		return parsed && typeof parsed === "object" ? parsed : undefined;
	} catch {
		return undefined;
	}
}

export const useMessagesStore = defineStore("messages", () => {
	const messages = ref<Message[]>([]);
	const prdReady = ref<string | null>(null);
	const prdHtml = ref<string | null>(null);
	const pipelineState = ref<PipelineState | null>(null);
	const workflowSteps = ref<WorkflowStep[]>(
		DEFAULT_WORKFLOW_STEPS.map((s) => ({ ...s })),
	);
	const activeStepIndex = ref(-1);

	function loadMessages(
		raw: Array<{
			id: string;
			session_id: string;
			role: string;
			content: string;
			created_at: number;
			thinking?: string;
			meta?: string;
		}>,
	) {
		const mapped: Message[] = raw.map((m) => {
			const { clean: withoutForm, formData } = extractQuestionForm(m.content);
			const { clean, interrupted } = stripInterruptMarker(withoutForm);
			const meta = parseMessageMeta(m.meta);
			const pending = meta?.pendingAction;
			// 确认卡片已处理或过期时不可再操作
			const settled =
				!!formData?.action &&
				(!pending || pending.status !== "pending" || pending.expiresAt < Date.now());
			return {
				id: m.id,
				sessionId: m.session_id,
				role: m.role as "user" | "assistant",
				content: clean,
				createdAt: m.created_at,
				interrupted: interrupted || undefined,
				formData: formData ?? undefined,
				formSubmitted: settled || undefined,
				thinking: m.thinking || undefined,
				meta,
			};
		});

		// 助手消息后若已有用户回复，视为表单已提交，并还原答题选中态
		for (let i = 0; i < mapped.length; i++) {
			const msg = mapped[i];
			if (!msg.formData) continue;
			const nextUser = mapped.slice(i + 1).find((m) => m.role === "user");
			if (!nextUser) continue;
			msg.formSubmitted = true;
			msg.formAnswers = parseFormAnswers(
				msg.formData.questions,
				nextUser.content,
			);
			nextUser.isFormAnswer = true;
		}

		messages.value = mapped;
	}

	function addUserMessage(msg: Message) {
		messages.value.push(msg);
	}

	function startStreamingMessage(msg: Message) {
		messages.value.push({
			...msg,
			isStreaming: true,
			isThinkingStreaming: false,
		});
		if (activeStepIndex.value === -1) {
			activeStepIndex.value = 0;
			workflowSteps.value[0].status = "active";
		}
	}

	function appendDelta(msgId: string, chunk: string) {
		const msg = messages.value.find((m) => m.id === msgId);
		if (msg) msg.content += chunk;
	}

	function appendThinking(msgId: string, chunk: string) {
		const msg = messages.value.find((m) => m.id === msgId);
		if (!msg) return;
		msg.thinking = (msg.thinking ?? "") + chunk;
		msg.isThinkingStreaming = true;
	}

	function clearStreamingContent(msgId: string) {
		const msg = messages.value.find((m) => m.id === msgId);
		if (!msg) return;
		msg.content = "";
		msg.thinking = "";
		msg.isThinkingStreaming = false;
	}

	function finalizeMessage(msgId: string) {
		const msg = messages.value.find((m) => m.id === msgId);
		if (!msg) return;
		msg.isStreaming = false;
		msg.isThinkingStreaming = false;
		msg.interrupted = false;

		if (activeStepIndex.value >= 0) {
			workflowSteps.value[activeStepIndex.value].status = "done";
			const next = activeStepIndex.value + 1;
			if (next < workflowSteps.value.length) {
				workflowSteps.value[next].status = "active";
				activeStepIndex.value = next;
			}
		}
	}

	/** 将消息标记为中断态（idle 超时后展示继续按钮） */
	function markMessageInterrupted(msgId: string) {
		const msg = messages.value.find((m) => m.id === msgId);
		if (!msg) return;
		msg.isStreaming = false;
		msg.isThinkingStreaming = false;
		msg.interrupted = true;
	}

	/** 将消息重新标记为流式状态（用于 retrySession 复用已有气泡） */
	function resumeStreamingMessage(msgId: string) {
		const msg = messages.value.find((m) => m.id === msgId);
		if (!msg) return;
		msg.isStreaming = true;
		msg.interrupted = false;
		msg.isThinkingStreaming = false;
	}

	/** 收到 prd_progress SSE 事件时更新对应 WorkflowStep 状态 */
	function setPrdSectionStatus(
		sectionId: string,
		status: "generating" | "done" | "error",
	) {
		const stepId = SECTION_TO_STEP[sectionId] ?? sectionId;
		const step = workflowSteps.value.find((s) => s.id === stepId);
		if (!step) return;
		if (status === "generating") {
			step.status = "active";
			activeStepIndex.value = workflowSteps.value.indexOf(step);
		} else if (status === "done") {
			step.status = "done";
			const fixedIds = new Set(["understand", "clarify", "output"]);
			const moduleSteps = workflowSteps.value.filter(
				(s) => !fixedIds.has(s.id),
			);
			const allDone =
				moduleSteps.length > 0 && moduleSteps.every((s) => s.status === "done");
			if (allDone) {
				const outputStep = workflowSteps.value.find((s) => s.id === "output");
				if (outputStep) outputStep.status = "active";
			}
		} else if (status === "error") {
			step.status = "error";
		}
	}

	/**
	 * 标记 PRD 就绪。
	 * @param markStepsDone 是否把进度步骤全部置为完成；
	 *        空白版本传 false——显式把所有步骤重置为 pending（未勾选）
	 */
	function setPrdReady(prdId: string, markStepsDone = true) {
		prdReady.value = prdId;
		if (markStepsDone) {
			workflowSteps.value = workflowSteps.value.map((s) => ({
				...s,
				status: "done" as WorkflowStepStatus,
			}));
			activeStepIndex.value = workflowSteps.value.length - 1;
		} else {
			workflowSteps.value = workflowSteps.value.map((s) => ({
				...s,
				status: "pending" as WorkflowStepStatus,
			}));
			activeStepIndex.value = -1;
		}
		pipelineState.value = null;
	}

	function setPrdHtml(html: string) {
		prdHtml.value = html;
	}

	function updatePrdHtmlAfterEdit(assembledHtml: string) {
		prdHtml.value = assembledHtml;
	}

	/**
	 * 根据后端返回的 pipelineState 恢复进度步骤和中断态。
	 * 仅在页面加载时调用，不覆盖已有正在流式输出的状态。
	 */
	function applyPipelineState(state: PipelineState | null | undefined) {
		if (!state) {
			pipelineState.value = null;
			return;
		}
		pipelineState.value = state;

		// 根据 outlineProgress 恢复 WorkflowStep 状态
		if (state.outlineProgress) {
			for (const step of workflowSteps.value) {
				// step.id 可能是映射后的值（如 "users"），也可能是原 sectionId（自定义模块）
				// 先从 SECTION_TO_STEP 反向查找，再直接匹配
				const rawSectionId =
					Object.entries(SECTION_TO_STEP).find(([, v]) => v === step.id)?.[0] ??
					step.id;
				const sectionStatus = state.outlineProgress[rawSectionId];
				if (!sectionStatus) continue;

				if (sectionStatus === "done") step.status = "done";
				else if (sectionStatus === "generating") {
					step.status = "active";
					activeStepIndex.value = workflowSteps.value.indexOf(step);
				} else if (sectionStatus === "error") {
					step.status = "error";
				} else {
					step.status = "pending";
				}
			}
		}

		// 标记被中断的消息
		if (state.phase === "agent_interrupted" && state.interruptedMessageId) {
			const msg = messages.value.find(
				(m) => m.id === state.interruptedMessageId,
			);
			if (msg) {
				msg.interrupted = true;
				msg.isStreaming = false;
			}
		}
	}

	/** 清除 pipelineState（流正常结束后调用） */
	function clearPipelineState() {
		pipelineState.value = null;
	}

	function initWorkflowSteps(
		selectedModules?: Array<{ id: string; name: string }>,
	) {
		activeStepIndex.value = -1;
		if (!selectedModules || selectedModules.length === 0) {
			workflowSteps.value = DEFAULT_WORKFLOW_STEPS.map((s) => ({
				...s,
				status: "pending" as WorkflowStepStatus,
			}));
			return;
		}
		const moduleSteps: WorkflowStep[] = selectedModules.map((m) => ({
			id: MODULE_TO_STEP_ID[m.id] ?? m.id,
			label: m.name,
			status: "pending" as WorkflowStepStatus,
		}));
		workflowSteps.value = [
			{ id: "understand", label: "理解需求", status: "pending" },
			{ id: "clarify", label: "查漏补缺", status: "pending" },
			...moduleSteps,
			{ id: "output", label: "输出 PRD", status: "pending" },
		];
	}

	function addStaticAssistantMessage(
		sessionId: string,
		content: string,
		action?: MessageAction,
	) {
		messages.value.push({
			id: `sys-${Date.now()}`,
			sessionId,
			role: "assistant",
			content,
			createdAt: Date.now(),
			isStreaming: false,
			action,
		});
	}

	function attachFormToLastMessage(formData: QuestionForm) {
		for (let i = messages.value.length - 1; i >= 0; i--) {
			if (messages.value[i].role === "assistant") {
				messages.value[i].formData = formData;
				return;
			}
		}
	}

	function markFormSubmitted(msgId: string) {
		const msg = messages.value.find((m) => m.id === msgId);
		if (msg) msg.formSubmitted = true;
	}

	/** 对话中工具改完模块后记录到对应助手气泡（与后端 meta.edits 同构） */
	function recordEdit(msgId: string, edit: MessageEdit) {
		const msg = messages.value.find((m) => m.id === msgId);
		if (!msg) return;
		const meta = msg.meta ?? {};
		meta.kind = "prd_edit";
		meta.edits = [...(meta.edits ?? []), edit];
		msg.meta = meta;
	}

	/** 流结束后用后端落库 id 替换临时 id（撤回需凭真实 id 持久化） */
	function adoptMessageId(tempId: string, realId: string) {
		const msg = messages.value.find((m) => m.id === tempId);
		if (msg) msg.id = realId;
	}

	function removeMessages(ids: string[]) {
		messages.value = messages.value.filter((m) => !ids.includes(m.id));
	}

	/** 对话中新增章节后补齐进度步骤（不重置已有步骤状态） */
	function syncWorkflowModules(selectedModules: Array<{ id: string; name: string }>) {
		const outputIdx = workflowSteps.value.findIndex((s) => s.id === "output");
		for (const m of selectedModules) {
			const stepId = MODULE_TO_STEP_ID[m.id] ?? m.id;
			if (workflowSteps.value.some((s) => s.id === stepId)) continue;
			const step: WorkflowStep = { id: stepId, label: m.name, status: "pending" };
			if (outputIdx === -1) workflowSteps.value.push(step);
			else workflowSteps.value.splice(outputIdx, 0, step);
		}
	}

	function markEditRolledBack(msgId: string, sectionId: string, version: number) {
		const edit = messages.value
			.find((m) => m.id === msgId)
			?.meta?.edits?.find((e) => e.sectionId === sectionId && e.resultVersion === version);
		if (edit) edit.rolledBack = true;
	}

	function reset() {
		messages.value = [];
		prdReady.value = null;
		prdHtml.value = null;
		pipelineState.value = null;
		workflowSteps.value = DEFAULT_WORKFLOW_STEPS.map((s) => ({ ...s }));
		activeStepIndex.value = -1;
	}

	return {
		messages,
		prdReady,
		prdHtml,
		pipelineState,
		workflowSteps,
		loadMessages,
		addUserMessage,
		startStreamingMessage,
		appendDelta,
		appendThinking,
		clearStreamingContent,
		finalizeMessage,
		markMessageInterrupted,
		resumeStreamingMessage,
		setPrdSectionStatus,
		setPrdReady,
		setPrdHtml,
		initWorkflowSteps,
		attachFormToLastMessage,
		markFormSubmitted,
		recordEdit,
		adoptMessageId,
		removeMessages,
		syncWorkflowModules,
		markEditRolledBack,
		addStaticAssistantMessage,
		updatePrdHtmlAfterEdit,
		applyPipelineState,
		clearPipelineState,
		reset,
	};
});

// 仅供外部偶尔需要用的辅助类型
export type { RetryMode };
