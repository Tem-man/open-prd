import type { Message } from "@/types";
import { extractQuestionForm } from "@/stores/messages";

function formOf(message: Message) {
	return message.formData ?? extractQuestionForm(message.content).formData;
}

function isCollectionFormMessage(message: Message): boolean {
	const form = formOf(message);
	return !!form && Array.isArray(form.questions) && !form.action;
}

function isConfirmFormMessage(message: Message): boolean {
	return !!formOf(message)?.action;
}

function hasEditMeta(message: Message): boolean {
	return (
		message.meta?.kind === "prd_edit" || (message.meta?.edits?.length ?? 0) > 0
	);
}

/** 当前工作区对话是否走过信息收集提问表单（与后端 splitIntakeMessages 一致） */
export function hasCollectionIntake(messages: Message[]): boolean {
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		if (isConfirmFormMessage(message) || hasEditMeta(message)) break;
		if (isCollectionFormMessage(message)) return true;
		break;
	}
	return false;
}
