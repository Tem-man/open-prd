import {
	parseLlmRuntimeConfig,
	type LlmRuntimeConfig,
} from "../../../services/llm.js";

export function readLlmFromBody(body: unknown): LlmRuntimeConfig | undefined {
	const llm = (body as { llm?: unknown } | null | undefined)?.llm;
	return parseLlmRuntimeConfig(llm);
}
