import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

// DB_PATH 必须在导入 db/client 之前设置
process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "prd-agent-")), "test.db");

type Orchestrator = typeof import("./orchestrator.js");
type Types = typeof import("./types.js");
let orchestrator: Orchestrator;
let types: Types;
let getDb: typeof import("../../db/client.js").getDb;

class ScriptedModel extends BaseChatModel {
	calls: BaseMessage[][] = [];
	boundTools: string[][] = [];
	boundOptions: Array<Record<string, unknown> | undefined> = [];
	constructor(private readonly script: AIMessage[]) {
		super({});
	}
	_llmType() {
		return "scripted";
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	override bindTools(tools: any[], options?: Record<string, unknown>): any {
		this.boundTools.push(tools.map((t) => t.name));
		this.boundOptions.push(options);
		return this;
	}
	async _generate(messages: BaseMessage[]): Promise<ChatResult> {
		this.calls.push(messages);
		const message = this.script[this.calls.length - 1] ?? new AIMessage("完成");
		return { generations: [{ message, text: String(message.content) }] };
	}
}

function seedSession(id: string, withPrd: boolean): void {
	const db = getDb();
	const now = Date.now();
	db.prepare(
		"INSERT INTO sessions (id, title, selected_modules, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
	).run(
		id,
		"测试",
		JSON.stringify([
			{ id: "featureList", name: "功能清单" },
			{ id: "dataModel", name: "数据模型" },
		]),
		now,
		now,
	);
	db.prepare(
		"INSERT INTO messages (id, session_id, role, content, thinking, meta, created_at) VALUES (?, ?, 'user', ?, '', '{}', ?)",
	).run(`${id}-u1`, id, "做一个记账 App", now);
	if (!withPrd) return;
	db.prepare(
		"INSERT INTO prds (id, session_id, html, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
	).run(`${id}-prd`, id, "<html>prd</html>", now, now);
	const insert = db.prepare(
		`INSERT INTO prd_sections (id, prd_id, session_id, section_id, title, html_content, version, is_current, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
	);
	insert.run(`${id}-s1`, `${id}-prd`, id, "featureList", "功能清单", "<table><tr><td>记账</td></tr></table>", now, now);
	insert.run(
		`${id}-s2`,
		`${id}-prd`,
		id,
		"dataModel",
		"数据模型",
		'<div class="mermaid">erDiagram\n  USER {\n    string id\n  }\n  BILL {\n    string id\n  }\n</div>',
		now,
		now,
	);
}

async function runTurn(sessionId: string, model: ScriptedModel, userMessage: string) {
	const events: import("./types.js").OrchestratorEvent[] = [];
	const recorder = types.createTurnRecorder();
	const result = await orchestrator.createOrchestrator(() => model).runTurn(
		{
			sessionId,
			userMessage,
			target: null,
			locale: "zh-CN",
			signal: new AbortController().signal,
			recorder,
		},
		(evt) => events.push(evt),
	);
	return { events, result };
}

before(async () => {
	orchestrator = await import("./orchestrator.js");
	types = await import("./types.js");
	getDb = (await import("../../db/client.js")).getDb;
});

test("收集阶段：ask_user_form 发送表单并结束本轮，只暴露收集工具", async () => {
	seedSession("s-collect", false);
	const model = new ScriptedModel([
		new AIMessage({
			content: "请补充以下信息",
			tool_calls: [
				{
					id: "c1",
					name: "ask_user_form",
					args: {
						questions: [
							{ id: "q1", label: "目标用户", type: "multi_choice", required: true, options: ["个人", "家庭"] },
						],
					},
				},
			],
		}),
	]);
	const { events, result } = await runTurn("s-collect", model, "做一个记账 App");

	assert.equal(model.calls.length, 1, "returnDirect 后不应再调用模型");
	assert.deepEqual(model.boundTools[0].sort(), ["ask_user_form", "generate_prd"]);
	assert.equal(result.reply, "请补充以下信息");
	const form = events.find((e) => e.type === "form");
	assert.ok(form && form.type === "form");
	assert.equal(form.data.questions.length, 2, "应自动补齐开放题");
	assert.equal(form.data.questions[1].type, "text");
	assert.ok(result.recorder.form);
});

test("收集阶段：上一轮表单在历史中不以「已向用户发送表单」出现", async () => {
	seedSession("s-form-hist", false);
	const form = {
		questions: [
			{
				id: "q1",
				label: "以下功能模块中，哪些需要纳入本期范围（请至少选择 4 项）？",
				type: "multi_choice",
				required: true,
				options: ["打卡", "工单"],
			},
			{ id: "q_extra", label: "你还有什么需要补充的吗？", type: "text", required: false },
		],
	};
	const content =
		`感谢补充。请确认优先范围。\n\n（已向用户发送表单：以下功能模块中，哪些需要纳入本期范围（请至少选择 4 项）？ / 你还有什么需要补充的吗？）\n\n[QUESTION_FORM]${JSON.stringify(form)}[/QUESTION_FORM]`;
	getDb()
		.prepare(
			"INSERT INTO messages (id, session_id, role, content, thinking, meta, created_at) VALUES (?, ?, 'assistant', ?, '', '{}', ?)",
		)
		.run("s-form-hist-a1", "s-form-hist", content, Date.now() + 1);

	const model = new ScriptedModel([new AIMessage("收到")]);
	await runTurn("s-form-hist", model, "打卡、工单");
	const fed = model.calls[0];
	const assistantHist = fed
		.filter((m) => m.getType() === "ai")
		.map((m) => String(m.content))
		.join("\n");
	assert.equal(assistantHist.includes("（已向用户发送表单："), false);
	assert.ok(assistantHist.includes("ask_user_form"));
});

test("编辑阶段：list_sections 返回实体名，整份重新生成只发确认卡片", async () => {
	seedSession("s-edit", true);
	const model = new ScriptedModel([
		new AIMessage({ content: "", tool_calls: [{ id: "c1", name: "list_sections", args: {} }] }),
		new AIMessage({ content: "", tool_calls: [{ id: "c2", name: "generate_prd", args: { reason: "整份重做" } }] }),
	]);
	const { events, result } = await runTurn("s-edit", model, "整份 PRD 重新生成");

	assert.equal(model.boundTools[0].length, 9);
	const listResult = model.calls[1].find((m) => m.getType() === "tool");
	assert.ok(listResult && String(listResult.content).includes("BILL"));
	assert.equal(model.calls.length, 2, "确认卡片后本轮结束");
	assert.ok(result.recorder.pendingAction, "应创建待确认动作");
	assert.equal(result.recorder.prd, null, "未确认前不得生成");
	const form = events.find((e) => e.type === "form");
	assert.ok(form && form.type === "form" && form.data.action?.token === result.recorder.pendingAction?.token);
	const toolMsg = model.calls[1].at(-1);
	assert.ok(toolMsg && !String(toolMsg.content).includes(result.recorder.pendingAction!.token));
});

test("编辑阶段：未知模块返回可读错误而不是抛出", async () => {
	const model = new ScriptedModel([
		new AIMessage({ content: "", tool_calls: [{ id: "c1", name: "get_section", args: { sectionId: "nope" } }] }),
		new AIMessage("抱歉，没有这个模块"),
	]);
	const { result } = await runTurn("s-edit", model, "看看 nope 模块");
	const toolMsg = model.calls[1].find((m) => m.getType() === "tool");
	assert.ok(toolMsg && String(toolMsg.content).includes("不存在"));
	assert.equal(result.reply, "抱歉，没有这个模块");
});

test("确认凭证：已处理、过期、切换版本后均被拒绝", async () => {
	const pending = await import("../pendingActions.js");
	const db = getDb();
	const store = (id: string, action: unknown) =>
		db.prepare(
			"INSERT INTO messages (id, session_id, role, content, thinking, meta, created_at) VALUES (?, 's-edit', 'assistant', '', '', ?, ?)",
		).run(id, JSON.stringify({ pendingAction: action }), Date.now());

	const ok = pending.createPendingAction("s-edit-prd");
	store("pa-ok", ok);
	const found = pending.lookupPendingAction("s-edit", ok.token);
	assert.ok(found.ok);
	pending.setPendingActionStatus("pa-ok", "consumed");
	assert.equal(pending.lookupPendingAction("s-edit", ok.token).ok, false, "不可重复提交");

	const expired = { ...pending.createPendingAction("s-edit-prd"), expiresAt: Date.now() - 1 };
	store("pa-expired", expired);
	assert.equal(pending.lookupPendingAction("s-edit", expired.token).ok, false, "过期拒绝");

	const switched = { ...pending.createPendingAction("s-edit-prd"), activeVersionId: "other-version" };
	store("pa-switched", switched);
	assert.equal(pending.lookupPendingAction("s-edit", switched.token).ok, false, "版本切换后拒绝");

	assert.equal(pending.lookupPendingAction("s-collect", ok.token).ok, false, "跨会话拒绝");
});

test("工具内部模型产生的 token 不会进入聊天气泡", async () => {
	const { tool } = await import("@langchain/core/tools");
	const z = await import("zod");
	const inner = new ScriptedModel([new AIMessage("<div>INNER_HTML_SECRET</div>")]);
	const leaky = tool(
		async () => {
			await inner.invoke("生成模块 HTML");
			return "ok";
		},
		{ name: "edit_section", description: "测试", schema: z.object({}) },
	);
	const outer = new ScriptedModel([
		new AIMessage({ content: "我来改", tool_calls: [{ id: "c1", name: "edit_section", args: {} }] }),
		new AIMessage("改好了"),
	]);
	const events: import("./types.js").OrchestratorEvent[] = [];
	const result = await orchestrator
		.createOrchestrator(() => outer, () => [leaky] as never)
		.runTurn(
			{
				sessionId: "s-edit",
				userMessage: "改一下",
				target: null,
				locale: "zh-CN",
			signal: new AbortController().signal,
				recorder: types.createTurnRecorder(),
			},
			(evt) => events.push(evt),
		);
	assert.equal(inner.calls.length, 1, "工具内部模型应被调用");
	assert.ok(!result.reply.includes("INNER_HTML_SECRET"));
	assert.ok(events.every((e) => e.type !== "delta" || !e.content.includes("INNER_HTML_SECRET")));
	assert.equal(result.reply, "我来改改好了");
});

test("chip 编辑：首轮只暴露编辑类工具", async () => {
	const model = new ScriptedModel([new AIMessage("好的")]);
	await orchestrator.createOrchestrator(() => model).runTurn(
		{
			sessionId: "s-edit",
			userMessage: "改一下这里",
			target: { sectionId: "featureList", sectionTitle: "功能清单" },
			locale: "zh-CN",
			signal: new AbortController().signal,
			recorder: types.createTurnRecorder(),
		},
		() => {},
	);
	assert.deepEqual(model.boundTools[0].sort(), [
		"edit_entity",
		"edit_section",
		"regenerate_section",
		"search_targets",
	]);
	const human = model.calls[0].at(-1);
	assert.ok(human && String(human.content).includes("sectionId: featureList"));
});

const CELL_TARGET = {
	sectionId: "featureList",
	sectionTitle: "功能清单",
	elementLabel: "单元格",
	selectedElementHtml: "<td>记账</td>",
	tablePath: { kind: "cell" as const, tableIndex: 0, rowIndex: 0, cellIndex: 0 },
};

test("单元格编辑：首轮只暴露 edit_section，不给整章重写的机会", async () => {
	const model = new ScriptedModel([new AIMessage("好的")]);
	await orchestrator.createOrchestrator(() => model).runTurn(
		{
			sessionId: "s-edit",
			userMessage: "这个增加支持无人机巡检GPS定位",
			target: CELL_TARGET,
			locale: "zh-CN",
			signal: new AbortController().signal,
			recorder: types.createTurnRecorder(),
		},
		() => {},
	);
	assert.deepEqual(model.boundTools[0], ["edit_section"]);
});

test("单元格编辑完成后，同一模块的整模块改写 / 重写都被拒绝", async () => {
	const recorder = types.createTurnRecorder();
	recorder.targetConsumed = true;
	const model = new ScriptedModel([
		new AIMessage({
			content: "",
			tool_calls: [
				{ id: "c1", name: "edit_section", args: { sectionId: "featureList", instruction: "顺便统一措辞" } },
				{ id: "c2", name: "regenerate_section", args: { sectionId: "featureList" } },
			],
		}),
		new AIMessage("已完成"),
	]);
	const events: import("./types.js").OrchestratorEvent[] = [];
	await orchestrator.createOrchestrator(() => model).runTurn(
		{
			sessionId: "s-edit",
			userMessage: "这个增加支持无人机巡检GPS定位",
			target: CELL_TARGET,
			locale: "zh-CN",
			signal: new AbortController().signal,
			recorder,
		},
		(evt) => events.push(evt),
	);
	const toolMsgs = model.calls[1].filter((m) => m.getType() === "tool");
	assert.equal(toolMsgs.length, 2);
	for (const m of toolMsgs) assert.ok(String(m.content).includes("只选中了"));
	assert.equal(recorder.edits.length, 0, "不应产生任何模块改动");
	assert.ok(events.every((e) => e.type !== "section_edit_done"));
});

test("search_targets：无 query 且无 sectionId 时拒绝 dump", async () => {
	const model = new ScriptedModel([
		new AIMessage({ content: "", tool_calls: [{ id: "c1", name: "search_targets", args: {} }] }),
		new AIMessage("请告诉我要改哪里"),
	]);
	await runTurn("s-edit", model, "改一下");
	const toolMsg = model.calls[1].find((m) => m.getType() === "tool");
	assert.ok(toolMsg && String(toolMsg.content).includes("query"));
	assert.ok(toolMsg && !String(toolMsg.content).includes("<td"));
});

test("search_targets：仅 sectionId 最多 20 条且不含 HTML", async () => {
	const model = new ScriptedModel([
		new AIMessage({
			content: "",
			tool_calls: [{ id: "c1", name: "search_targets", args: { sectionId: "featureList" } }],
		}),
		new AIMessage("已列出"),
	]);
	await runTurn("s-edit", model, "功能清单有哪些可改节点");
	const toolMsg = model.calls[1].find((m) => m.getType() === "tool");
	assert.ok(toolMsg);
	const payload = JSON.parse(String(toolMsg.content)) as { targets: unknown[] };
	assert.ok(Array.isArray(payload.targets));
	assert.ok(payload.targets.length <= 20);
	assert.ok(!String(toolMsg.content).includes("<td"));
	assert.ok(!String(toolMsg.content).includes("selectedElementHtml"));
});

test("edit_section：非法 locatorId 不落库", async () => {
	const model = new ScriptedModel([
		new AIMessage({
			content: "",
			tool_calls: [
				{
					id: "c1",
					name: "edit_section",
					args: {
						sectionId: "featureList",
						instruction: "改成 P0",
						locatorId: "cell:9:9:9",
					},
				},
			],
		}),
		new AIMessage("定位失败"),
	]);
	const { events, result } = await runTurn("s-edit", model, "改那一格");
	const toolMsg = model.calls[1].find((m) => m.getType() === "tool");
	assert.ok(toolMsg && String(toolMsg.content).includes("不存在"));
	assert.equal(result.recorder.edits.length, 0);
	assert.ok(events.every((e) => e.type !== "section_edit_done"));
});
