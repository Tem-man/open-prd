import {
	AIMessage,
	HumanMessage,
	type BaseMessage,
} from "@langchain/core/messages";
import { getDb } from "../../db/client.js";
import type { Locale } from "../../i18n/locale.js";
import { INTERRUPT_MARKER_RE } from "../pipelineState.js";
import { extractQuestionForm } from "../../routes/sessions/helpers/questionForm.js";
import type { EditRecord, FormPayload } from "./types.js";

type MsgRow = { role: string; content: string; meta: string };

export interface MessageMeta {
	kind?: "prd_edit";
	edits?: EditRecord[];
	pendingAction?: unknown;
	citation?: { sectionId: string; sectionTitle?: string; elementLabel?: string };
	confirmAction?: { decision: string };
}

export function parseMeta(raw: string | null | undefined): MessageMeta {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		return parsed && typeof parsed === "object" ? (parsed as MessageMeta) : {};
	} catch {
		return {};
	}
}

/** 旧版回放把表单压成这句正文，模型会在下一轮照抄；剥离以免污染后续轮次 */
const IMITATED_FORM_SUMMARY_RE =
	/（已向用户发送表单：[^）]*）/g;
const IMITATED_CONFIRM_SUMMARY_RE = /（已向用户发送整份重新生成确认卡片）/g;

function stripImitatedFormSummary(text: string): string {
	return text
		.replace(IMITATED_FORM_SUMMARY_RE, "")
		.replace(IMITATED_CONFIRM_SUMMARY_RE, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function describeForm(form: FormPayload, locale: Locale): string {
	if (locale === "zh-CN") {
		return form.action
			? "[系统] 本轮已调用工具 generate_prd，确认卡片只出现在界面上。等待用户点选；不要在回复中复述或仿写该卡片。"
			: "[系统] 本轮已调用工具 ask_user_form，题目只出现在界面表单中。等待用户填写；不要把题目或选项写进聊天气泡。";
	}
	return form.action
		? "[System] The generate_prd tool was called this turn; the confirmation card only appears in the UI. Wait for the user to choose; do not repeat or imitate the card in your reply."
		: "[System] The ask_user_form tool was called this turn; the questions only appear in the UI form. Wait for the user to fill it in; do not put the questions or options in the chat bubble.";
}

function assistantText(
	content: string,
	meta: MessageMeta,
	locale: Locale,
): string {
	const { cleanReply, formData } = extractQuestionForm(content);
	let text = stripImitatedFormSummary(cleanReply);
	if (formData)
		text = `${text}\n\n${describeForm(formData as FormPayload, locale)}`.trim();
	if (meta.edits && meta.edits.length > 0) {
		const edited = meta.edits
			.map((e) => `${e.sectionTitle} v${e.resultVersion}`)
			.join(locale === "zh-CN" ? "、" : ", ");
		const zh = locale === "zh-CN";
		const prefix = zh ? "（本轮已修改：" : "(Edited this turn: ";
		const suffix = zh ? "）" : ")";
		text = `${text}\n\n${prefix}${edited}${suffix}`.trim();
	}
	return text;
}

function userText(content: string, meta: MessageMeta): string {
	const c = meta.citation;
	if (!c) return content;
	const label = c.elementLabel
		? `${c.sectionTitle ?? c.sectionId} · ${c.elementLabel}`
		: (c.sectionTitle ?? c.sectionId);
	return `（针对 PRD「${label}」）${content}`;
}

/**
 * 加载会话文本历史（不含 thinking、不含工具中间消息）。
 * 带中断标记的助手消息会被过滤；默认排除最后一条用户消息（由调用方作为当前输入追加）。
 */
export function loadHistory(
	sessionId: string,
	excludeLastUserMsg = true,
	locale: Locale = "zh-CN",
): BaseMessage[] {
	const db = getDb();
	const rows = db
		.prepare(
			// Never SELECT thinking — it is UI-only and must not return to the LLM.
			"SELECT role, content, meta FROM messages WHERE session_id = ? ORDER BY created_at ASC",
		)
		.all(sessionId) as MsgRow[];

	const cleaned = rows.filter(
		(m) => !(m.role === "assistant" && INTERRUPT_MARKER_RE.test(m.content)),
	);

	const messages: BaseMessage[] = [];
	for (const m of cleaned) {
		const meta = parseMeta(m.meta);
		if (m.role === "user") {
			messages.push(new HumanMessage(userText(m.content, meta)));
		} else if (m.role === "assistant") {
			const text = assistantText(m.content, meta, locale);
			if (text) messages.push(new AIMessage(text));
		}
	}

	if (excludeLastUserMsg && messages.length > 0) {
		const last = messages[messages.length - 1];
		if (HumanMessage.isInstance(last)) return messages.slice(0, -1);
	}
	return messages;
}
