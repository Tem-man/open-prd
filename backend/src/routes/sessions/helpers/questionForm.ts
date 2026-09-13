import { QUESTION_FORM_START, QUESTION_FORM_END } from "../../../services/prompts.js";

/**
 * 从 AI 回复中提取并剥离 [QUESTION_FORM]...[/QUESTION_FORM] 块。
 * 返回 { cleanReply, formData }：
 *   - cleanReply：去掉标记块后的纯文字部分
 *   - formData：解析成功时为 JSON 对象，解析失败时为 null
 */
export function extractQuestionForm(reply: string): {
	cleanReply: string;
	formData: unknown | null;
} {
	const startIdx = reply.indexOf(QUESTION_FORM_START);
	const endIdx = reply.indexOf(QUESTION_FORM_END);
	if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
		return { cleanReply: reply, formData: null };
	}
	const jsonStr = reply
		.slice(startIdx + QUESTION_FORM_START.length, endIdx)
		.trim();
	const cleanReply = (
		reply.slice(0, startIdx) + reply.slice(endIdx + QUESTION_FORM_END.length)
	).trim();
	try {
		const formData = JSON.parse(jsonStr) as unknown;
		return { cleanReply, formData };
	} catch {
		console.warn(
			"[sessions] Failed to parse QUESTION_FORM JSON, falling back to plain text",
		);
		return { cleanReply: reply, formData: null };
	}
}
