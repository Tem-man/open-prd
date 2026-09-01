import { AsyncLocalStorage } from "node:async_hooks";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOllama } from "@langchain/ollama";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

/**
 * 整体请求超时（ms）。
 * 若 LLM_TIMEOUT_MS 未配置，默认 120 秒。
 * 该值作为 HTTP 请求级别的兜底，防止 API 端完全无响应时永久挂起。
 */
const REQUEST_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS ?? "120000", 10);

/** Client-supplied runtime config (from SettingsDialog / PRD agent payload). */
export type LlmRuntimeConfig = {
	providerID: string;
	model: string;
	apiKey?: string;
	baseURL?: string;
	apiType?: "completions" | "responses";
	maxOutputTokens?: number;
};

const llmContext = new AsyncLocalStorage<LlmRuntimeConfig>();

const OPENAI_FAMILY = new Set([
	"openai",
	"openrouter",
	"deepseek",
	"minimax",
	"openai-compatible",
]);

const ANTHROPIC_FAMILY = new Set(["anthropic", "anthropic-compatible", "zai"]);

const DEFAULT_BASE_URL: Record<string, string> = {
	openai: "https://api.openai.com/v1",
	openrouter: "https://openrouter.ai/api/v1",
	deepseek: "https://api.deepseek.com",
	minimax: "https://api.minimax.io/v1",
	anthropic: "https://api.anthropic.com",
	zai: "https://api.z.ai/api/anthropic",
};

export function runWithLlmConfig<T>(
	config: LlmRuntimeConfig | undefined,
	fn: () => T,
): T {
	if (!config) return fn();
	return llmContext.run(config, fn);
}

export function parseLlmRuntimeConfig(
	value: unknown,
): LlmRuntimeConfig | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "object" || Array.isArray(value)) {
		throw new Error("llm 配置格式无效");
	}
	const record = value as Record<string, unknown>;
	const providerID =
		typeof record.providerID === "string" ? record.providerID.trim() : "";
	const model = typeof record.model === "string" ? record.model.trim() : "";
	if (!providerID || !model) {
		throw new Error("llm 配置缺少 providerID 或 model");
	}
	if (providerID.startsWith("acp:") || providerID === "google") {
		throw new Error(
			"该提供商暂不支持 PRD Agent，请改用 OpenAI 兼容或 Anthropic 兼容提供商",
		);
	}
	if (!OPENAI_FAMILY.has(providerID) && !ANTHROPIC_FAMILY.has(providerID)) {
		throw new Error(`未识别的模型提供商：${providerID}`);
	}
	const apiKey = typeof record.apiKey === "string" ? record.apiKey.trim() : "";
	if (!apiKey) {
		throw new Error("llm 配置缺少 API Key");
	}
	const customBase =
		typeof record.baseURL === "string" ? record.baseURL.trim() : "";
	const baseURL = customBase || DEFAULT_BASE_URL[providerID] || "";
	if (
		(providerID === "openai-compatible" ||
			providerID === "anthropic-compatible") &&
		!baseURL
	) {
		throw new Error("兼容提供商需要填写 Base URL");
	}
	const apiType =
		record.apiType === "responses" || record.apiType === "completions"
			? record.apiType
			: "completions";
	const maxOutputTokens =
		typeof record.maxOutputTokens === "number" &&
		Number.isFinite(record.maxOutputTokens)
			? Math.min(128_000, Math.max(1024, Math.round(record.maxOutputTokens)))
			: undefined;

	return { providerID, model, apiKey, baseURL, apiType, maxOutputTokens };
}

function createFromRuntime(config: LlmRuntimeConfig): BaseChatModel {
	const verbose = process.env.LANGCHAIN_LLM_VERBOSE === "true";
	const { providerID, model, apiKey, baseURL, maxOutputTokens } = config;

	if (OPENAI_FAMILY.has(providerID)) {
		return new ChatOpenAI({
			model,
			apiKey,
			configuration: {
				baseURL: baseURL || DEFAULT_BASE_URL.openai,
			},
			timeout: REQUEST_TIMEOUT_MS,
			maxTokens: maxOutputTokens,
			verbose,
		});
	}

	if (ANTHROPIC_FAMILY.has(providerID)) {
		return new ChatAnthropic({
			model,
			apiKey,
			clientOptions: {
				baseURL: baseURL || DEFAULT_BASE_URL.anthropic,
			},
			maxTokens: maxOutputTokens,
			verbose,
		});
	}

	throw new Error(`未识别的模型提供商：${providerID}`);
}

function createFromEnv(): BaseChatModel {
	const provider = (process.env.LLM_PROVIDER ?? "openai").toLowerCase();
	const model = process.env.LLM_MODEL ?? "gpt-4o";
	const verbose = process.env.LANGCHAIN_LLM_VERBOSE === "true";

	if (provider === "openai" || provider === "openrouter") {
		return new ChatOpenAI({
			model,
			apiKey: process.env.OPENAI_API_KEY,
			configuration: {
				baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
			},
			timeout: REQUEST_TIMEOUT_MS,
			verbose,
		});
	}

	if (provider === "anthropic") {
		return new ChatAnthropic({
			model,
			apiKey: process.env.ANTHROPIC_API_KEY,
			clientOptions: {
				baseURL: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
			},
			verbose,
		});
	}

	if (provider === "ollama") {
		return new ChatOllama({
			model,
			baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
			verbose,
		});
	}

	throw new Error(
		`[llm] 未识别的 LLM_PROVIDER="${process.env.LLM_PROVIDER}"，可选值为：openai | anthropic | ollama`,
	);
}

/**
 * 按请求级覆盖（SettingsDialog → body.llm）或 LLM_PROVIDER 环境变量实例化 ChatModel。
 * openai 分支兼容所有 OpenAI API 格式的服务（OpenRouter、DeepSeek、SiliconFlow 等）。
 *
 * 调试：在 .env 中设置 LANGCHAIN_LLM_VERBOSE=true 可打印 LangChain [llm/start|end] 全量 JSON。
 */
export function createChatModel(): BaseChatModel {
	const override = llmContext.getStore();
	if (override) return createFromRuntime(override);
	return createFromEnv();
}
