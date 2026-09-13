/** Split a LangChain stream chunk into visible text vs model thinking. */

export interface StreamParts {
	text: string;
	thinking: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return null;
}

function stringField(
	record: Record<string, unknown>,
	key: string,
): string {
	const value = record[key];
	return typeof value === "string" ? value : "";
}

/** DeepSeek / OpenRouter / some OpenAI-compatible reasoning fields. */
function extractReasoningBlob(source: unknown): string {
	const rec = asRecord(source);
	if (!rec) return "";

	const direct = stringField(rec, "reasoning_content");
	if (direct) return direct;

	const reasoning = rec.reasoning;
	if (typeof reasoning === "string") return reasoning;

	const nested = asRecord(reasoning);
	if (!nested) return "";

	const nestedContent = stringField(nested, "content") || stringField(nested, "text");
	if (nestedContent) return nestedContent;

	const summary = nested.summary;
	if (typeof summary === "string") return summary;
	if (Array.isArray(summary)) {
		return summary
			.map((item) => {
				if (typeof item === "string") return item;
				const row = asRecord(item);
				return row ? stringField(row, "text") || stringField(row, "content") : "";
			})
			.join("");
	}

	return "";
}

function extractFromContentBlock(block: unknown): StreamParts {
	if (typeof block === "string") return { text: block, thinking: "" };

	const rec = asRecord(block);
	if (!rec) return { text: "", thinking: "" };

	const type = stringField(rec, "type");
	if (type === "thinking" || type === "reasoning") {
		const thinking =
			stringField(rec, "thinking") ||
			stringField(rec, "text") ||
			stringField(rec, "summary");
		return { text: "", thinking };
	}

	if (type === "text" || type === "output_text") {
		return { text: stringField(rec, "text"), thinking: "" };
	}

	// Unknown structured block: never JSON.stringify into the user-visible bubble.
	return { text: "", thinking: "" };
}

/**
 * Pull visible reply text and thinking/reasoning deltas out of one stream chunk.
 * Empty strings mean "this chunk had nothing for that channel".
 */
export function extractStreamParts(chunk: unknown): StreamParts {
	const rec = asRecord(chunk);
	if (!rec) return { text: "", thinking: "" };

	let text = "";
	let thinking = extractReasoningBlob(rec.additional_kwargs);
	if (!thinking) thinking = extractReasoningBlob(rec);

	const content = rec.content;
	if (typeof content === "string") {
		text += content;
	} else if (Array.isArray(content)) {
		for (const block of content) {
			const parts = extractFromContentBlock(block);
			text += parts.text;
			thinking += parts.thinking;
		}
	}

	return { text, thinking };
}
