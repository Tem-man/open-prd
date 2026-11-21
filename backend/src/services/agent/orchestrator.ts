import {
	createAgent,
	createMiddleware,
	modelCallLimitMiddleware,
	toolCallLimitMiddleware,
	type AnyAgentMiddleware,
} from "langchain";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { getDb } from "../../db/client.js";
import { createChatModel } from "../llm.js";
import { extractStreamParts } from "../llmStream.js";
import { trimHistory } from "../contextManager.js";
import { getSessionModules } from "../prdOutline.js";
import { buildCollectPrompt, buildEditPrompt } from "../prompts.js";
import { buildTools, SECTION_CHIP_TOOLS } from "../tools/index.js";
import { loadHistory } from "./history.js";
import type { AgentDriver, AgentTurnInput, AgentTurnResult } from "./driver.js";
import type {
	ComposerTarget,
	OrchestratorContext,
	OrchestratorEvent,
} from "./types.js";
import { isElementTarget } from "./types.js";

/** createAgent 内部模型节点名；只转发该节点的 token，工具内部模型调用（PRD HTML）不进聊天气泡 */
const AGENT_MODEL_NODE = "model_request";

const IDLE_TIMEOUT_MS = parseInt(process.env.LLM_IDLE_TIMEOUT_MS ?? "20000", 10);

/** 有内容的 PRD 才进入编辑阶段；空白版本（html 为空）仍按收集阶段处理 */
function findPrdWithContent(sessionId: string): string | null {
	const row = getDb()
		.prepare(
			`SELECT p.id FROM prds p
       WHERE p.session_id = ? AND p.html <> ''
         AND EXISTS (SELECT 1 FROM prd_sections s WHERE s.prd_id = p.id AND s.is_current = 1)
       ORDER BY p.created_at DESC LIMIT 1`,
		)
		.get(sessionId) as { id: string } | undefined;
	return row?.id ?? null;
}

function buildUserContent(
	userMessage: string,
	target: ComposerTarget | null,
	locale: string,
	partialReply?: string,
): string {
	let content = userMessage;
	const zh = locale === "zh-CN";
	if (target) {
		const label = target.sectionTitle ?? target.sectionId;
		const scope = target.elementLabel ? `${label} · ${target.elementLabel}` : label;
		content = zh
			? `（用户在界面上选中了 PRD「${scope}」，sectionId: ${target.sectionId}）\n${content}`
			: `(The user selected PRD section "${scope}" in the UI, sectionId: ${target.sectionId})\n${content}`;
	}
	if (partialReply) {
		content += zh
			? `\n\n---\n【系统提示：你之前的回复因超时中断，已输出的内容如下。` +
				`请从中断处直接续写，不要重复已有内容，不要加任何前缀。】\n\n${partialReply}`
			: `\n\n---\n[System note: your previous reply was interrupted by a timeout. ` +
				`What you already output is shown below. Continue from where it stopped — ` +
				`do not repeat existing content and do not add any preamble.]\n\n${partialReply}`;
	}
	return content;
}

/** chip 编辑：首轮模型调用只保留编辑类工具并强制调用，保证落到目标模块 */
function forceTargetEditMiddleware(ctx: OrchestratorContext) {
	return createMiddleware({
		name: "ForceTargetEdit",
		wrapModelCall: (request, handler) => {
			const hasToolResult = request.messages.some((m) => ToolMessage.isInstance(m));
			if (ctx.recorder.targetConsumed || hasToolResult) return handler(request);
			// 元素级目标只允许 edit_section（元素补丁），排除整章重写
			const allowed = isElementTarget(ctx.target) ? ["edit_section"] : SECTION_CHIP_TOOLS;
			const tools = request.tools.filter(
				(t) => "name" in t && allowed.includes(String(t.name)),
			);
			// 某些推理模型在 thinking mode 下不支持 tool_choice，兼容性优先：仅收窄可见工具。
			return handler({ ...request, tools });
		},
	});
}

type ToolsFactory = (ctx: OrchestratorContext) => ReturnType<typeof buildTools>;

async function runTurn(
	input: AgentTurnInput,
	onEvent: (evt: OrchestratorEvent) => void,
	modelFactory: () => BaseChatModel,
	toolsFactory: ToolsFactory,
): Promise<AgentTurnResult> {
	const { sessionId, userMessage, target, locale, partialReply, recorder } = input;

	const controller = new AbortController();
	const forwardAbort = () => controller.abort(input.signal.reason);
	if (input.signal.aborted) forwardAbort();
	else input.signal.addEventListener("abort", forwardAbort, { once: true });

	const modules = getSessionModules(sessionId);
	const prdId = findPrdWithContent(sessionId);
	const ctx: OrchestratorContext = {
		sessionId,
		prdId,
		modules,
		target: prdId ? target : null,
		locale,
		signal: controller.signal,
		recorder,
		emit: onEvent,
	};

	const { messages: history, summary } = await trimHistory(
		loadHistory(sessionId, true, locale),
	);
	const systemPrompt = prdId
		? buildEditPrompt(
				modules,
				summary ?? "",
				ctx.target ? (isElementTarget(ctx.target) ? "element" : "section") : null,
				locale,
			)
		: buildCollectPrompt(modules, summary ?? "", locale);

	let toolsRunning = 0;
	const middleware: AnyAgentMiddleware[] = [
		toolCallLimitMiddleware({ runLimit: 12 }),
		toolCallLimitMiddleware({ toolName: "generate_prd", runLimit: 1 }),
		modelCallLimitMiddleware({ runLimit: 14, exitBehavior: "end" }),
		createMiddleware({
			name: "ToolActivity",
			wrapToolCall: async (request, handler) => {
				toolsRunning++;
				try {
					return await handler(request);
				} finally {
					toolsRunning--;
				}
			},
		}),
	];
	if (ctx.target) middleware.push(forceTargetEditMiddleware(ctx));

	const agent = createAgent({
		model: modelFactory(),
		tools: toolsFactory(ctx),
		systemPrompt,
		middleware,
	});

	// 模型 token 间静默超时；工具执行期间（PRD 生成可能很久）不计时
	let idleTimer: ReturnType<typeof setTimeout> | null = null;
	let idleAborted = false;
	const armIdle = () => {
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = setTimeout(() => {
			if (toolsRunning > 0) return armIdle();
			idleAborted = true;
			controller.abort(new Error(`[agent] stream idle > ${IDLE_TIMEOUT_MS}ms，主动中止`));
		}, IDLE_TIMEOUT_MS);
	};

	let reply = "";
	let thinking = "";
	try {
		armIdle();
		const stream = await agent.stream(
			{
				messages: [
					...history,
					new HumanMessage(buildUserContent(userMessage, ctx.target, locale, partialReply)),
				],
			},
			{
				streamMode: ["messages", "custom"],
				signal: controller.signal,
				recursionLimit: 100,
			},
		);
		for await (const item of stream as AsyncIterable<[string, unknown]>) {
			armIdle();
			const [mode, chunk] = item;
			if (mode === "custom") {
				onEvent(chunk as OrchestratorEvent);
				continue;
			}
			const [message, metadata] = chunk as [unknown, { langgraph_node?: string } | undefined];
			if (metadata?.langgraph_node !== AGENT_MODEL_NODE) continue;
			const parts = extractStreamParts(message);
			if (parts.thinking) {
				thinking += parts.thinking;
				onEvent({ type: "thinking", content: parts.thinking });
			}
			if (parts.text) {
				reply += parts.text;
				onEvent({ type: "delta", content: parts.text });
			}
		}
	} catch (err) {
		if (idleAborted) {
			throw new Error(`[agent] stream idle > ${IDLE_TIMEOUT_MS}ms，主动中止`);
		}
		throw err;
	} finally {
		if (idleTimer) clearTimeout(idleTimer);
		input.signal.removeEventListener("abort", forwardAbort);
	}

	return { reply, thinking, recorder };
}

export function createOrchestrator(
	modelFactory: () => BaseChatModel = createChatModel,
	toolsFactory: ToolsFactory = buildTools,
): AgentDriver {
	return {
		runTurn: (input, onEvent) => runTurn(input, onEvent, modelFactory, toolsFactory),
	};
}

export const langchainOrchestrator = createOrchestrator();

/** 预留：按环境变量切换至 Claude Code / Codex 驱动 */
export function getAgentDriver(): AgentDriver {
	return langchainOrchestrator;
}
