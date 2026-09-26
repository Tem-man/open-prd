import {
	AIMessage,
	HumanMessage,
	type BaseMessage,
} from "@langchain/core/messages";
import { getDb } from "../../db/client.js";
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

function describeForm(form: FormPayload): string {
	const labels = form.questions.map((q) => q.label).join(" / ");
	return form.action
		? `（已向用户发送整份重新生成确认卡片）`
		: `（已向用户发送表单：${labels}）`;
}

function assistantText(content: string, meta: MessageMeta): string {
	const { cleanReply, formData } = extractQuestionForm(content);
	let text = cleanReply;
	if (formData) text = `${text}\n\n${describeForm(formData as FormPayload)}`.trim();
	if (meta.edits && meta.edits.length > 0) {
		const edited = meta.edits
			.map((e) => `${e.sectionTitle} v${e.resultVersion}`)
			.join("、");
		text = `${text}\n\n（本轮已修改：${edited}）`.trim();
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
export function loadHistory(sessionId: string, excludeLastUserMsg = true): BaseMessage[] {
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
			const text = assistantText(m.content, meta);
			if (text) messages.push(new AIMessage(text));
		}
	}

	if (excludeLastUserMsg && messages.length > 0) {
		const last = messages[messages.length - 1];
		if (HumanMessage.isInstance(last)) return messages.slice(0, -1);
	}
	return messages;
}
