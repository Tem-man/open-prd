/**
 * 版本新建时从对话时间线切出「信息收集前缀」。
 * 详见 docs/plan-prd-version-create-options.md §3。
 */
import { parseMeta } from "./agent/history.js";
import { extractQuestionForm } from "../routes/sessions/helpers/questionForm.js";

export interface IntakeMessage {
	role: string;
	content: string;
	meta?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object";
}

function formFromContent(content: string): Record<string, unknown> | null {
	const { formData } = extractQuestionForm(content);
	return isRecord(formData) ? formData : null;
}

/** 收集表单：有 questions、没有整份重生成确认卡上的 action */
export function isCollectionForm(content: string): boolean {
	const form = formFromContent(content);
	if (!form || form.action) return false;
	return Array.isArray(form.questions);
}

function isConfirmForm(content: string): boolean {
	const form = formFromContent(content);
	return !!form?.action;
}

function hasEditMeta(meta: string | undefined): boolean {
	const parsed = parseMeta(meta);
	if (parsed.kind === "prd_edit") return true;
	return Array.isArray(parsed.edits) && parsed.edits.length > 0;
}

/**
 * 从时间线开头切到首次生成 PRD 的边界。
 * includeFirstGenerate：复制场景收入首次生成说明；空白场景不收。
 */
export function splitIntakeMessages<T extends IntakeMessage>(
	messages: T[],
	opts: { includeFirstGenerate: boolean },
): { intake: T[]; hasCollectionForm: boolean } {
	const intake: T[] = [];
	let hasCollectionForm = false;

	for (const message of messages) {
		if (message.role === "user") {
			intake.push(message);
			continue;
		}
		if (message.role !== "assistant") continue;

		if (isConfirmForm(message.content) || hasEditMeta(message.meta)) break;

		if (isCollectionForm(message.content)) {
			hasCollectionForm = true;
			intake.push(message);
			continue;
		}

		if (opts.includeFirstGenerate) intake.push(message);
		break;
	}

	return { intake, hasCollectionForm };
}

export function hasCollectionForm(messages: IntakeMessage[]): boolean {
	return splitIntakeMessages(messages, { includeFirstGenerate: false }).hasCollectionForm;
}
