import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractStreamParts } from "./llmStream.js";

describe("extractStreamParts", () => {
	it("treats string content as visible text", () => {
		assert.deepEqual(extractStreamParts({ content: "hello" }), {
			text: "hello",
			thinking: "",
		});
	});

	it("reads DeepSeek reasoning_content without mixing it into text", () => {
		assert.deepEqual(
			extractStreamParts({
				content: "final answer",
				additional_kwargs: { reasoning_content: "let me think" },
			}),
			{ text: "final answer", thinking: "let me think" },
		);
	});

	it("reads nested additional_kwargs.reasoning.content", () => {
		assert.deepEqual(
			extractStreamParts({
				content: "ok",
				additional_kwargs: { reasoning: { content: "step 1" } },
			}),
			{ text: "ok", thinking: "step 1" },
		);
	});

	it("splits Anthropic-style content arrays into thinking vs text", () => {
		assert.deepEqual(
			extractStreamParts({
				content: [
					{ type: "thinking", thinking: "need more info" },
					{ type: "text", text: "请问目标用户是谁？" },
				],
			}),
			{ text: "请问目标用户是谁？", thinking: "need more info" },
		);
	});

	it("does not stringify unknown array blocks into the visible reply", () => {
		assert.deepEqual(
			extractStreamParts({
				content: [{ type: "thinking", thinking: "secret" }, { type: "tool_use" }],
			}),
			{ text: "", thinking: "secret" },
		);
	});

	it("returns empty parts for empty or unknown chunks", () => {
		assert.deepEqual(extractStreamParts(null), { text: "", thinking: "" });
		assert.deepEqual(extractStreamParts({}), { text: "", thinking: "" });
		assert.deepEqual(extractStreamParts({ content: "" }), {
			text: "",
			thinking: "",
		});
	});

	it("joins OpenAI reasoning summary arrays", () => {
		assert.deepEqual(
			extractStreamParts({
				content: "done",
				additional_kwargs: {
					reasoning: { summary: [{ text: "a" }, { text: "b" }] },
				},
			}),
			{ text: "done", thinking: "ab" },
		);
	});
});
