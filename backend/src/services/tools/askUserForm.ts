import { tool } from "@langchain/core/tools";
import * as z from "zod";
import type { Locale } from "../../i18n/locale.js";
import type { FormQuestion, OrchestratorContext } from "../agent/types.js";
import { emitterFor } from "./common.js";

/** 末尾自动补齐的开放题，按界面语言生成。 */
function extraQuestion(locale: Locale): FormQuestion {
	return {
		id: "q_extra",
		label:
			locale === "zh-CN" ? "你还有什么需要补充的吗？" : "Anything else you'd like to add?",
		type: "text",
		required: false,
		placeholder:
			locale === "zh-CN" ? "可选，请自由描述" : "Optional — feel free to describe",
	};
}

// 长度按英文长度设定（中文 60 字符足够写一个选项，英文往往不够）。
// 关键：用 transform 自动截断而不是 max() 拒绝——模型输出的文本若超长，
// zod 会在工具执行前直接抛 "did not match expected schema"，工具根本不运行、
// form 事件发不出去，前端表现为「问完一句话后卡住、没有表单」。
// LangChain 重试时若仍超长会耗尽调用上限静默结束，更难排查。
const LABEL_MAX = 240;
const OPTION_MAX = 160;
const PLACEHOLDER_MAX = 160;
const OPTIONS_MAX = 10;

const questionSchema = z.object({
	id: z.string().describe("问题 id，如 q1"),
	label: z
		.string()
		.min(1)
		.transform((s) => s.slice(0, LABEL_MAX))
		.describe("问题标题"),
	type: z.enum(["single_choice", "multi_choice", "text"]),
	options: z
		.array(
			z
				.string()
				.min(1)
				.transform((s) => s.slice(0, OPTION_MAX)),
		)
		.transform((arr) => arr.slice(0, OPTIONS_MAX))
		.optional()
		.describe("选择题选项，2–6 个"),
	required: z.boolean(),
	placeholder: z
		.string()
		.transform((s) => s.slice(0, PLACEHOLDER_MAX))
		.optional(),
});

/** 业务规则在代码中兜底：选择题必须有选项、文本题强制非必填、末尾补齐开放题 */
export function normalizeQuestions(
	raw: z.infer<typeof questionSchema>[],
	locale: Locale = "zh-CN",
): FormQuestion[] | string {
	const seen = new Set<string>();
	const questions: FormQuestion[] = [];
	for (const [i, q] of raw.entries()) {
		let isChoice = q.type !== "text";
		const options = q.options?.map((o) => o.trim()).filter(Boolean) ?? [];
		// 选项不足时降级为文本题，而不是返回错误字符串——返回字符串会让工具
		// 直接结束本轮且不发 form 事件，前端同样表现为「卡住、没有表单」。
		if (isChoice && options.length < 2) isChoice = false;
		const id = q.id && !seen.has(q.id) ? q.id : `q${i + 1}`;
		seen.add(id);
		questions.push({
			id,
			label: q.label.trim().slice(0, LABEL_MAX),
			type: isChoice ? q.type : "text",
			required: isChoice ? q.required : false,
			...(isChoice ? { options } : {}),
			...(q.placeholder ? { placeholder: q.placeholder.slice(0, PLACEHOLDER_MAX) } : {}),
		});
	}
	const last = questions[questions.length - 1];
	if (!last || last.type !== "text") {
		questions.push({
			...extraQuestion(locale),
			id: seen.has("q_extra") ? "q_extra_2" : "q_extra",
		});
	}
	return questions;
}

export function askUserFormTool(ctx: OrchestratorContext) {
	return tool(
		async ({ questions }, config) => {
			const locale = ctx.locale;
			if (ctx.recorder.form)
				return locale === "zh-CN"
					? "本轮已经发送过表单，请等待用户填写。"
					: "A form was already sent this turn. Wait for the user to fill it in.";
			const normalized = normalizeQuestions(questions, locale);
			if (typeof normalized === "string") return normalized;
			const form = { questions: normalized };
			ctx.recorder.form = form;
			emitterFor(ctx, config)({ type: "form", data: form });
			return locale === "zh-CN"
				? "表单已发送给用户，等待用户填写。"
				: "The form has been sent to the user. Wait for their response.";
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
