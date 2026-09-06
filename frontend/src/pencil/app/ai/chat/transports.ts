import { Chat } from "@ai-sdk/vue";
import { DirectChatTransport, stepCountIs, ToolLoopAgent } from "ai";
import type { ChatTransport, FinishReason, LanguageModel, UIMessage } from "ai";
import type { ComputedRef } from "vue";

import type { AIProviderID } from "@open-pencil/core/constants";
import { dialogMessages } from "@open-pencil/vue";

import { resolveLanguageModelID } from "@/app/ai/chat/model";
import SYSTEM_PROMPT from "@/app/ai/chat/system-prompt.md?raw";
import { getPrdBasis, prdBasisReady } from "@/app/ai/prdContext";
import { createAIModelRuntime } from "@/app/ai/models";
import {
	MAX_AGENT_STEPS,
	createAITools,
	recordStepUsage,
	resetRunSteps,
} from "@/app/ai/tools";
import type { getActiveEditorStore } from "@/app/editor/active-store";
import { toast } from "@/app/shell/ui";

type EditorStore = ReturnType<typeof getActiveEditorStore>;

/*
 * Upstream also accepts `isACPProvider` / `providerID` to route the chat through a locally spawned
 * ACP agent. That path needs Tauri's sidecar process API, which open-prd's Electron shell does not
 * expose, so only the direct provider transport is supported here.
 */
type ChatSessionOptions = {
	isConfigured: ComputedRef<boolean>;
	credentialsReady: Promise<void>;
	getActiveEditorStore: () => EditorStore;
};

type ToolLoopTransportOptions = {
	store: EditorStore;
	providerID: AIProviderID;
	model: LanguageModel;
	effectiveModelID: string;
	maxOutputTokens: number;
};

const ANTHROPIC_CACHE_CONTROL = {
	anthropic: { cacheControl: { type: "ephemeral" } },
} as const;

/**
 * A step that yields neither a tool call nor text ends the tool loop with nothing to show.
 * Without this the run just stops mid-conversation and the user gets no explanation.
 */
function reportDeadStep(finishReason: FinishReason): void {
	const messages = dialogMessages.get();
	toast.error(
		finishReason === "length"
			? messages.agentStoppedOutputLimit
			: messages.agentStoppedWithoutOutput({ reason: finishReason }),
	);
}

function supportsAnthropicCaching(
	providerID: AIProviderID,
	modelID: string,
): boolean {
	return (
		providerID === "anthropic" ||
		providerID === "anthropic-compatible" ||
		(providerID === "openrouter" && modelID.startsWith("anthropic/"))
	);
}

export function createToolLoopTransport({
	store,
	providerID,
	model,
	effectiveModelID,
	maxOutputTokens,
}: ToolLoopTransportOptions) {
	const tools = createAITools(store);
	const cacheProviderOptions = supportsAnthropicCaching(
		providerID,
		effectiveModelID,
	)
		? ANTHROPIC_CACHE_CONTROL
		: undefined;

	// 原型关联了 PRD 会话时，把「原型设计依据」章节注入 instructions，
	// 使 AI 生成/修改原型页面时严格遵循 PRD 中的页面清单、结构与设计规范。
	const basis = getPrdBasis();
	if (basis) {
		console.debug(
			"[chat] 设计代理已注入 PRD 原型设计依据，字符数:",
			basis.basisText.length,
		);
	} else {
		console.debug("[chat] 设计代理无 PRD 依据（原型未关联会话或依据为空）");
	}
	const instructions = basis
		? `${SYSTEM_PROMPT}\n\n# PRD 原型设计依据\n\n以下内容摘自该产品 PRD 的「原型设计依据」章节。生成或修改原型页面时必须严格遵循其中的页面清单、页面结构、导航关系与设计规范，页面名称与优先级以依据为准：\n\n${basis.basisText}`
		: SYSTEM_PROMPT;

	const agent = new ToolLoopAgent({
		model,
		instructions,
		tools,
		stopWhen: stepCountIs(MAX_AGENT_STEPS),
		maxOutputTokens,
		providerOptions: cacheProviderOptions,
		prepareCall: (options) => {
			resetRunSteps(store);
			return {
				...options,
				maxOutputTokens,
				providerOptions: cacheProviderOptions,
			};
		},
		onStepFinish: ({ usage, finishReason, toolCalls, text }) => {
			recordStepUsage(
				{
					inputTokens: usage.inputTokens ?? 0,
					outputTokens: usage.outputTokens ?? 0,
					cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
					cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? 0,
					timestamp: Date.now(),
				},
				store,
			);
			if (toolCalls.length === 0 && text.trim() === "")
				reportDeadStep(finishReason);
		},
	});

	return new DirectChatTransport({ agent }) as ChatTransport<UIMessage>;
}

export function createChatSessionManager({
	isConfigured,
	credentialsReady,
	getActiveEditorStore,
}: ChatSessionOptions) {
	let transportDirty = false;
	let currentChatStore: EditorStore | null = null;
	let currentChatMessages = new WeakMap<EditorStore, UIMessage[]>();
	let chat: Chat<UIMessage> | null = null;
	let overrideTransport: (() => ChatTransport<UIMessage>) | null = null;

	function markTransportDirty() {
		transportDirty = true;
		currentChatStore = null;
		currentChatMessages = new WeakMap();
	}

	async function createTransport(store: EditorStore) {
		if (overrideTransport) return overrideTransport();

		// 等待 PRD 依据加载完成（或确认不存在），避免 agent 以无上下文状态启动
		await prdBasisReady();

		const runtime = await createAIModelRuntime("design");
		if (runtime?.kind !== "direct") {
			throw new Error(
				"The Design model is not configured for direct API access",
			);
		}
		return createToolLoopTransport({
			store,
			providerID: runtime.role.connection.providerID,
			model: runtime.model,
			effectiveModelID: resolveLanguageModelID({
				providerID: runtime.role.connection.providerID,
				modelID: runtime.role.profile.modelID,
				customModelID: runtime.role.profile.customModelID,
			}),
			maxOutputTokens: runtime.role.profile.maxOutputTokens,
		});
	}

	async function ensureChat(): Promise<Chat<UIMessage> | null> {
		await credentialsReady;
		if (!isConfigured.value) return null;

		const store = getActiveEditorStore();
		if (currentChatStore && chat) {
			currentChatMessages.set(currentChatStore, chat.messages);
		}

		if (!chat || transportDirty || currentChatStore !== store) {
			const messages = currentChatMessages.get(store);
			const transport = await createTransport(store);
			chat = new Chat<UIMessage>({ transport, messages });
			currentChatStore = store;
			transportDirty = false;
		}
		return chat;
	}

	function resetChat() {
		if (currentChatStore) currentChatMessages.delete(currentChatStore);
		chat = null;
		currentChatStore = null;
		transportDirty = false;
	}

	function setOverrideTransport(
		factory: (() => ChatTransport<UIMessage>) | null,
	) {
		overrideTransport = factory;
		markTransportDirty();
	}

	return { ensureChat, resetChat, markTransportDirty, setOverrideTransport };
}
