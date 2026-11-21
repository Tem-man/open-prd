import type { Locale } from "../../i18n/locale.js";
import type {
	ComposerTarget,
	OrchestratorEvent,
	TurnRecorder,
} from "./types.js";

export interface AgentTurnInput {
	sessionId: string;
	/** 当前用户消息（已写入 DB） */
	userMessage: string;
	target: ComposerTarget | null;
	/** 界面语言，决定 AI 回复与表单文案的语言 */
	locale: Locale;
	/** 续写：上一轮被中断时已输出的文本 */
	partialReply?: string;
	signal: AbortSignal;
	/** 由调用方创建，出错时仍可据此落库本轮已完成的编辑 */
	recorder: TurnRecorder;
}

export interface AgentTurnResult {
	/** 本轮可见文本（不含 partialReply） */
	reply: string;
	thinking: string;
	recorder: TurnRecorder;
}

/** Agent 驱动抽象：默认 LangChain 编排；预留 Claude Code / Codex 实现。 */
export interface AgentDriver {
	runTurn(
		input: AgentTurnInput,
		onEvent: (evt: OrchestratorEvent) => void,
	): Promise<AgentTurnResult>;
}
