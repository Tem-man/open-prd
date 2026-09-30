import { test } from "node:test";
import assert from "node:assert/strict";
import {
	hasCollectionForm,
	isCollectionForm,
	splitIntakeMessages,
	type IntakeMessage,
} from "./versionIntake.js";
import { QUESTION_FORM_END, QUESTION_FORM_START } from "./prompts.js";

const COLLECTION_FORM = {
	questions: [
		{
			id: "q1",
			label: "目标用户是谁？",
			type: "multi_choice",
			required: true,
			options: ["C 端个人", "B 端企业"],
		},
	],
};

const ROUND2_FORM = {
	questions: [
		{
			id: "q1",
			label: "本期做哪些功能？",
			type: "multi_choice",
			required: true,
			options: ["记账", "报表", "预算", "发票"],
		},
	],
};

const CONFIRM_FORM = {
	intro: "整份重新生成会覆盖当前所有模块",
	questions: [
		{
			id: "decision",
			label: "如何处理当前内容？",
			type: "single_choice",
			required: true,
			options: ["先另存为新版本，再重新生成", "直接覆盖重新生成", "取消"],
		},
	],
	action: { token: "tok-1", kind: "regenerate_prd" },
};

function withForm(text: string, form: unknown): string {
	return `${text}\n\n${QUESTION_FORM_START}${JSON.stringify(form)}${QUESTION_FORM_END}`;
}

function msg(
	role: "user" | "assistant",
	content: string,
	meta: Record<string, unknown> = {},
): IntakeMessage {
	return { role, content, meta: JSON.stringify(meta) };
}

test("isCollectionForm：收集表单为 true，确认卡为 false", () => {
	assert.equal(isCollectionForm(withForm("请补充", COLLECTION_FORM)), true);
	assert.equal(isCollectionForm(withForm("请选择", CONFIRM_FORM)), false);
	assert.equal(isCollectionForm("正在生成 PRD"), false);
});

test("无表单直出生成：复制收入首次生成说明，空白不收，hasCollectionForm 为 false", () => {
	const messages = [
		msg("user", "做个记账 App，面向个人，Web，核心功能记账报表预算发票"),
		msg("assistant", "好的，开始生成 PRD。"),
		msg("user", "把标题改一下"),
		msg("assistant", "已改标题", { kind: "prd_edit", edits: [{ sectionId: "background" }] }),
	];

	const dup = splitIntakeMessages(messages, { includeFirstGenerate: true });
	assert.equal(dup.hasCollectionForm, false);
	assert.deepEqual(
		dup.intake.map((m) => m.content),
		["做个记账 App，面向个人，Web，核心功能记账报表预算发票", "好的，开始生成 PRD。"],
	);

	const blank = splitIntakeMessages(messages, { includeFirstGenerate: false });
	assert.equal(blank.hasCollectionForm, false);
	assert.deepEqual(
		blank.intake.map((m) => m.content),
		["做个记账 App，面向个人，Web，核心功能记账报表预算发票"],
	);
	assert.equal(hasCollectionForm(messages), false);
});

test("一轮表单：收入提问与作答，停在首次生成", () => {
	const messages = [
		msg("user", "想做个报销系统"),
		msg("assistant", withForm("先确认基础信息", COLLECTION_FORM)),
		msg("user", "目标用户是谁？：B 端企业"),
		msg("assistant", "好的，开始生成 PRD。"),
		msg("user", "流程图再细一点"),
	];

	const dup = splitIntakeMessages(messages, { includeFirstGenerate: true });
	assert.equal(dup.hasCollectionForm, true);
	assert.equal(dup.intake.length, 4);
	assert.equal(dup.intake[3]?.content, "好的，开始生成 PRD。");

	const blank = splitIntakeMessages(messages, { includeFirstGenerate: false });
	assert.equal(blank.hasCollectionForm, true);
	assert.equal(blank.intake.length, 3);
	assert.equal(blank.intake.at(-1)?.role, "user");
});

test("两轮表单：两轮问答都进前缀", () => {
	const messages = [
		msg("user", "做个内部工单系统"),
		msg("assistant", withForm("第一轮", COLLECTION_FORM)),
		msg("user", "目标用户是谁？：B 端企业"),
		msg("assistant", withForm("第二轮", ROUND2_FORM)),
		msg("user", "本期做哪些功能？：记账、报表、预算、发票"),
		msg("assistant", "好的，开始生成 PRD。"),
		msg("user", "补一个字段"),
	];

	const blank = splitIntakeMessages(messages, { includeFirstGenerate: false });
	assert.equal(blank.hasCollectionForm, true);
	assert.equal(blank.intake.length, 5);
	assert.equal(blank.intake[3]?.content.includes("第二轮"), true);
});

test("生成后的确认卡与编辑记录不进前缀", () => {
	const messages = [
		msg("user", "做个报销系统"),
		msg("assistant", withForm("先确认基础信息", COLLECTION_FORM)),
		msg("user", "目标用户是谁？：B 端企业"),
		msg("assistant", "好的，开始生成 PRD。"),
		msg("user", "重新生成一下"),
		msg("assistant", withForm("请选择", CONFIRM_FORM), {
			pendingAction: { token: "tok-1", kind: "regenerate_prd" },
		}),
		msg("assistant", "已改数据模型", {
			kind: "prd_edit",
			edits: [{ sectionId: "dataModel", sectionTitle: "数据模型", resultVersion: 2, kind: "edit" }],
		}),
	];

	const dup = splitIntakeMessages(messages, { includeFirstGenerate: true });
	assert.equal(dup.hasCollectionForm, true);
	assert.deepEqual(
		dup.intake.map((m) => m.role),
		["user", "assistant", "user", "assistant"],
	);
	assert.equal(dup.intake.some((m) => m.content.includes("请选择")), false);
	assert.equal(dup.intake.some((m) => m.content === "已改数据模型"), false);
});
