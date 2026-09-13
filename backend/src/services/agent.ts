import {
	HumanMessage,
	AIMessage,
	SystemMessage,
	type BaseMessage,
} from "@langchain/core/messages";
import { getDb } from "../db/client.js";
import { createChatModel } from "./llm.js";
import { buildSystemPrompt, PRD_TRIGGER } from "./prompts.js";
import { trimHistory } from "./contextManager.js";
import { buildSkillBlock } from "./skillLoader.js";
import { getSessionModules } from "./prdOutline.js";
import { INTERRUPT_MARKER_RE } from "./pipelineState.js";
import { extractStreamParts } from "./llmStream.js";

export interface AgentStreamResult {
	reply: string;
	shouldGeneratePrd: boolean;
}

export interface AgentStreamOptions {
	/**
	 * 若不为空，说明这是一次"续写"请求。
	 * 后端会在 system prompt 中附上断点上文，并在 onDone 时把 partial+新内容
	 * 合并作为最终回复落库。
	 */
	partialReply?: string;
}

type MsgRow = { role: string; content: string };

/** 精简预览：[agent] messages →（与 LANGCHAIN_LLM_VERBOSE 独立） */
const VERBOSE = process.env.LANGCHAIN_AGENT_VERBOSE === "true";

function debugLog(messages: BaseMessage[]): void {
	if (!VERBOSE) return;
	console.log(
		"[agent] messages →",
		messages.map((m) => ({
			type: m._getType(),
			preview: (typeof m.content === "string"
				? m.content
				: JSON.stringify(m.content)
			).slice(0, 80),
		})),
	);
}

/**
 * 从数据库加载会话历史，转换为 LangChain BaseMessage 数组。
 * 返回值只含 HumanMessage / AIMessage，不含 SystemMessage。
 * 带中断标记的 assistant 消息会被自动过滤，避免污染上下文。
 */
function loadHistory(
	sessionId: string,
	excludeLastUserMsg = true,
): BaseMessage[] {
	const db = getDb();
	const rows = db
		.prepare(
			// Never SELECT thinking — it is UI-only and must not return to the LLM.
			"SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC",
		)
		.all(sessionId) as MsgRow[];

	// 过滤掉带中断标记的 assistant 消息（它们不应出现在上下文里）
	const cleaned = rows.filter(
		(m) => !(m.role === "assistant" && INTERRUPT_MARKER_RE.test(m.content)),
	);

	const messages: BaseMessage[] = cleaned.map((m) =>
		m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content),
	);

	// 排除最后一条 user 消息（调用方已写入 DB，此处加回 currentMsg 避免重复）
	if (excludeLastUserMsg && messages.length > 0) {
		const lastIdx = messages.length - 1;
		if (messages[lastIdx]._getType() === "human") {
			return messages.slice(0, lastIdx);
		}
	}

	return messages;
}

/**
 * 运行 Agent 流式推理。
 *
 * 消息结构（始终只有一个 SystemMessage 在最前）：
 *   [SystemMessage(PRD提示词 [+ 需求摘要]), ...对话历史, HumanMessage(当前)]
 *
 * @param sessionId   当前会话 ID
 * @param userMessage 用户当前输入（已写入 DB）
 * @param onDelta     可见回复增量（不含思考）
 * @param onThinking  思考 / reasoning 增量（不含可见回复）
 * @param onDone      流正常结束；thinking 只给 UI 落库，不得回传模型
 * @param onError     流异常时触发
 */
export async function runAgentStream(
	sessionId: string,
	userMessage: string,
	onDelta: (chunk: string, seq: number) => void,
	onThinking: (chunk: string, seq: number) => void,
	onDone: (reply: string, shouldGeneratePrd: boolean, thinking: string) => void,
	onError: (err: Error) => void,
	options: AgentStreamOptions = {},
): Promise<void> {
	const { partialReply } = options;
	// chunk 间最大静默时间（ms）。超过此时间没有新 chunk 视为流卡住，主动 abort。
	const IDLE_TIMEOUT_MS = parseInt(
		process.env.LLM_IDLE_TIMEOUT_MS ?? "20000",
		10,
	);

	const abortController = new AbortController();
	let idleTimer: ReturnType<typeof setTimeout> | null = null;

	const resetIdleTimer = () => {
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = setTimeout(() => {
			abortController.abort(
				new Error(`[agent] stream idle > ${IDLE_TIMEOUT_MS}ms，主动中止`),
			);
		}, IDLE_TIMEOUT_MS);
	};

	const clearIdleTimer = () => {
		if (idleTimer) {
			clearTimeout(idleTimer);
			idleTimer = null;
		}
	};

	try {
		// 1. 加载历史（不含当前用户消息）
		const rawHistory = loadHistory(sessionId, true);

		// 2. 上下文裁剪 — 返回 { messages, summary }
		//    summary 非 null 时说明发生了裁剪，需注入 SystemPrompt 防止需求信息丢失
		const { messages: trimmedMessages, summary } =
			await trimHistory(rawHistory);

		// 3. 构建唯一 SystemMessage：PRD 提示词 [+ 摘要（若裁剪触发）]
		//    始终只有一个 SystemMessage，避免多 system message 导致 Anthropic 报错
		const selectedModules = getSessionModules(sessionId);
		const systemMsg = new SystemMessage(
			buildSystemPrompt(selectedModules, "", summary ?? ""),
		);
		// 续写模式：在 user 消息中告知模型从哪里接续
		let currentMsg: HumanMessage;
		if (partialReply && partialReply.length > 0) {
			currentMsg = new HumanMessage(
				`${userMessage}\n\n` +
					`---\n【系统提示：你之前的回复因超时中断，已输出的内容如下。` +
					`请从中断处直接续写，不要重复已有内容，不要加任何前缀。】\n\n${partialReply}`,
			);
		} else {
			currentMsg = new HumanMessage(userMessage);
		}
		const messages: BaseMessage[] = [systemMsg, ...trimmedMessages, currentMsg];

		debugLog(messages);

		// 4. 流式调用 LLM
		const model = createChatModel();
		let fullReply = "";
		let fullThinking = "";
		let seq = 0;

		// 启动首 chunk 等待计时器（等同于 idle timeout，首个 chunk 到达前也适用）
		resetIdleTimer();

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let stream: AsyncIterable<any>;
		try {
			stream = await model.stream(messages, { signal: abortController.signal });
		} catch (streamErr) {
			clearIdleTimer();
			throw streamErr;
		}

		try {
			for await (const chunk of stream) {
				const { text, thinking } = extractStreamParts(chunk);
				if (!text && !thinking) continue;

				// thinking 增量也算活动，避免长思考被 idle timeout 误杀
				resetIdleTimer();

				if (thinking) {
					fullThinking += thinking;
					onThinking(thinking, seq++);
				}
				if (text) {
					fullReply += text;
					onDelta(text, seq++);
				}
			}
		} finally {
			// 无论正常结束、异常、还是 abort，都清除计时器
			clearIdleTimer();
		}

		// 5. 检测 PRD 触发信号，清理标记后落库
		//    续写时把 partial + 新输出合并为最终回复
		const mergedReply = partialReply ? partialReply + fullReply : fullReply;
		const shouldGeneratePrd = mergedReply.includes(PRD_TRIGGER);
		const cleanReply = mergedReply.replaceAll(PRD_TRIGGER, "").trimEnd();

		onDone(cleanReply, shouldGeneratePrd, fullThinking);
	} catch (err) {
		clearIdleTimer();
		const error = err instanceof Error ? err : new Error(String(err));
		onError(error);
	}
}

/**
 * 为指定图表模块注入对应 Skill 并构建消息列表（Phase 5 使用）。
 */
export function buildMessagesWithSkill(
	baseMessages: BaseMessage[],
	skillName: string,
	sessionId?: string,
): BaseMessage[] {
	const skillBlock = buildSkillBlock(skillName);
	const selectedModules = sessionId ? getSessionModules(sessionId) : [];
	const systemWithSkill = new SystemMessage(
		buildSystemPrompt(selectedModules, skillBlock),
	);
	const withoutSystem = baseMessages.filter((m) => m._getType() !== "system");
	return [systemWithSkill, ...withoutSystem];
}
