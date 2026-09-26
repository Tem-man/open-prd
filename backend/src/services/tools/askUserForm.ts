import { tool } from "@langchain/core/tools";
import * as z from "zod";
import type { FormQuestion, OrchestratorContext } from "../agent/types.js";
import { emitterFor } from "./common.js";

const EXTRA_QUESTION: FormQuestion = {
	id: "q_extra",
	label: "你还有什么需要补充的吗？",
	type: "text",
	required: false,
	placeholder: "可选，请自由描述",
};

const questionSchema = z.object({
	id: z.string().describe("问题 id，如 q1"),
	label: z.string().min(1).max(100).describe("问题标题"),
	type: z.enum(["single_choice", "multi_choice", "text"]),
	options: z
		.array(z.string().min(1).max(60))
		.max(8)
		.optional()
		.describe("选择题选项，2–6 个"),
	required: z.boolean(),
	placeholder: z.string().max(60).optional(),
});

/** 业务规则在代码中兜底：选择题必须有选项、文本题强制非必填、末尾补齐开放题 */
export function normalizeQuestions(
	raw: z.infer<typeof questionSchema>[],
): FormQuestion[] | string {
	const seen = new Set<string>();
	const questions: FormQuestion[] = [];
	for (const [i, q] of raw.entries()) {
		const isChoice = q.type !== "text";
		const options = q.options?.map((o) => o.trim()).filter(Boolean) ?? [];
		if (isChoice && options.length < 2) {
			return `问题「${q.label}」是选择题，至少需要 2 个选项，请修正后重新调用。`;
		}
		const id = q.id && !seen.has(q.id) ? q.id : `q${i + 1}`;
		seen.add(id);
		questions.push({
			id,
			label: q.label.trim(),
			type: q.type,
			required: isChoice ? q.required : false,
			...(isChoice ? { options } : {}),
			...(q.placeholder ? { placeholder: q.placeholder } : {}),
		});
	}
	const last = questions[questions.length - 1];
	if (!last || last.type !== "text") {
		questions.push({ ...EXTRA_QUESTION, id: seen.has("q_extra") ? "q_extra_2" : "q_extra" });
	}
	return questions;
}

export function askUserFormTool(ctx: OrchestratorContext) {
	return tool(
		async ({ questions }, config) => {
			if (ctx.recorder.form) return "本轮已经发送过表单，请等待用户填写。";
			const normalized = normalizeQuestions(questions);
			if (typeof normalized === "string") return normalized;
			const form = { questions: normalized };
			ctx.recorder.form = form;
			emitterFor(ctx, config)({ type: "form", data: form });
			return "表单已发送给用户，等待用户填写。";
		},
		{
			name: "ask_user_form",
			description:
				"向用户发送结构化提问表单（单选 / 多选 / 文本）。信息不足、需要用户做选择或定位有歧义时使用。调用后本轮对话结束，等待用户填写。",
			schema: z.object({
				questions: z.array(questionSchema).min(1).max(6),
			}),
			returnDirect: true,
		},
	);
}
