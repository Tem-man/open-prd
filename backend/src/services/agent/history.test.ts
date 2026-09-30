import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AIMessage } from "@langchain/core/messages";
import { QUESTION_FORM_END, QUESTION_FORM_START } from "../prompts.js";

process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "prd-hist-")), "test.db");

const { getDb } = await import("../../db/client.js");
const { loadHistory } = await import("./history.js");

function seedSession(id: string): void {
	const db = getDb();
	const now = Date.now();
	db.prepare(
		"INSERT INTO sessions (id, title, selected_modules, created_at, updated_at) VALUES (?, ?, '[]', ?, ?)",
	).run(id, "测试", now, now);
	db.prepare(
		"INSERT INTO messages (id, session_id, role, content, thinking, meta, created_at) VALUES (?, ?, 'user', ?, '', '{}', ?)",
	).run(`${id}-u1`, id, "做一个物业巡检系统", now);
}

function insertAssistant(sessionId: string, content: string, createdAt: number): void {
	getDb()
		.prepare(
			"INSERT INTO messages (id, session_id, role, content, thinking, meta, created_at) VALUES (?, ?, 'assistant', ?, '', '{}', ?)",
		)
		.run(`${sessionId}-a1`, sessionId, content, createdAt);
}

function historyText(sessionId: string): string {
	return loadHistory(sessionId, true)
		.filter((m) => AIMessage.isInstance(m))
		.map((m) => String(m.content))
		.join("\n");
}

test("loadHistory：表单回放标明工具调用，不把题目拼成可模仿的正文", () => {
	const id = "h-form";
	seedSession(id);
	const form = {
		questions: [
			{
				id: "q1",
				label: "以下功能模块中，哪些需要纳入本期范围（请至少选择 4 项）？",
				type: "multi_choice",
				required: true,
				options: ["二维码打卡", "异常工单"],
			},
			{ id: "q_extra", label: "你还有什么需要补充的吗？", type: "text", required: false },
		],
	};
	insertAssistant(
		id,
		`感谢补充。请确认优先范围。\n\n（已向用户发送表单：以下功能模块中，哪些需要纳入本期范围（请至少选择 4 项）？ / 你还有什么需要补充的吗？）\n\n${QUESTION_FORM_START}${JSON.stringify(form)}${QUESTION_FORM_END}`,
		Date.now() + 1,
	);

	const text = historyText(id);
	assert.ok(text.includes("感谢补充。请确认优先范围。"));
	assert.ok(text.includes("ask_user_form"));
	assert.equal(text.includes("（已向用户发送表单："), false);
	assert.equal(text.includes("哪些需要纳入本期范围"), false);
});

test("loadHistory：确认卡片回放标明 generate_prd，不仿写卡片摘要", () => {
	const id = "h-confirm";
	seedSession(id);
	const form = {
		questions: [
			{
				id: "confirm",
				label: "确认整份重新生成？",
				type: "single_choice",
				required: true,
				options: ["确认", "取消"],
			},
		],
		action: { token: "tok", kind: "regenerate_prd" },
	};
	insertAssistant(
		id,
		`将整份重新生成。\n\n（已向用户发送整份重新生成确认卡片）\n\n${QUESTION_FORM_START}${JSON.stringify(form)}${QUESTION_FORM_END}`,
		Date.now() + 1,
	);

	const text = historyText(id);
	assert.ok(text.includes("generate_prd"));
	assert.equal(text.includes("已向用户发送整份重新生成确认卡片"), false);
});
