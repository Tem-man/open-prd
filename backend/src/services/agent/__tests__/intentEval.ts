/**
 * 意图识别回归（plan-orchestrator-agent.md §14.1）。
 * 用 backend/.env 的真实模型逐条运行；变更类工具替换为只记录调用的桩，读取类工具照常读取示例 PRD。
 * 需要在 .env 中配置 LLM_PROVIDER / LLM_MODEL 及对应 API Key（界面里的模型配置不会传到这里）。
 * 运行：pnpm --filter backend test:intent
 */
import "dotenv/config";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { tool } from "@langchain/core/tools";
import { INTENT_CASES, type ExpectedCall, type IntentCase } from "./intentCases.js";

// 必须在导入 db/client 之前设置，避免写入真实数据库
process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "prd-intent-")), "intent.db");
// 真实模型评测时首 token 可能较慢，避免被默认 20s idle 超时误杀。
process.env.LLM_IDLE_TIMEOUT_MS ??= "120000";

const SESSION_ID = "intent-eval";
const READ_TOOLS = new Set(["list_sections", "get_section", "search_targets"]);
const ENDING_TOOLS = new Set(["ask_user_form", "generate_prd"]);

interface RecordedCall {
	tool: string;
	args: Record<string, unknown>;
}

const SECTIONS: Array<[string, string, string]> = [
	["background", "背景与目标", "<p>面向中小团队的在线记账与报销工具，目标半年内获得 1 万付费团队。</p>"],
	[
		"featureList",
		"功能清单",
		`<table class="prd-table"><tr><th>功能模块</th><th>功能点</th><th>优先级</th></tr>
<tr><td>报表</td><td>导出报表</td><td>P1</td></tr>
<tr><td>会员</td><td>积分功能</td><td>P2</td></tr>
<tr><td>账单</td><td>记账</td><td>P0</td></tr></table>`,
	],
	["architecture", "产品架构", '<div class="mermaid">graph TB\n  Web --> API\n  API --> DB</div>'],
	[
		"flowchart",
		"业务流程",
		'<div class="mermaid">flowchart TD\n  A[提交报销] --> B[财务审核] --> C[打款]</div>',
	],
	[
		"infoArch",
		"信息架构",
		'<div class="markmap-wrap"><ul><li>首页</li><li>账单</li><li>报表</li><li>设置页</li></ul></div>',
	],
	[
		"dataModel",
		"数据模型",
		`<div class="mermaid">erDiagram
  USER {
    string id
    string name
  }
  ORDER {
    string id
    string remark
  }
  USER ||--o{ ORDER : places
</div>
<div class="entity-section"><h4 class="entity-table-title">USER</h4></div>
<div class="entity-section"><h4 class="entity-table-title">ORDER</h4></div>`,
	],
];

async function seed(): Promise<void> {
	const { getDb } = await import("../../../db/client.js");
	const db = getDb();
	const now = Date.now();
	db.prepare(
		"INSERT INTO sessions (id, title, selected_modules, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
	).run(
		SESSION_ID,
		"团队记账报销工具",
		JSON.stringify(SECTIONS.map(([id, name]) => ({ id, name }))),
		now,
		now,
	);
	db.prepare(
		"INSERT OR IGNORE INTO module_templates (id, name, description, is_builtin, created_at) VALUES ('nonFunctional', '非功能需求', '性能、安全、可用性等非功能性要求', 0, ?)",
	).run(now);
	const insertMsg = db.prepare(
		"INSERT INTO messages (id, session_id, role, content, thinking, meta, created_at) VALUES (?, ?, ?, ?, '', '{}', ?)",
	);
	insertMsg.run("m1", SESSION_ID, "user", "做一个面向中小团队的 Web 记账报销工具", now - 2000);
	insertMsg.run("m2", SESSION_ID, "assistant", "PRD 已生成完成，可以继续修改。", now - 1000);
	db.prepare(
		"INSERT INTO prds (id, session_id, html, created_at, updated_at) VALUES ('intent-prd', ?, '<html>prd</html>', ?, ?)",
	).run(SESSION_ID, now, now);
	const insertSection = db.prepare(
		`INSERT INTO prd_sections (id, prd_id, session_id, section_id, title, html_content, version, is_current, created_at, updated_at)
     VALUES (?, 'intent-prd', ?, ?, ?, ?, 1, 1, ?, ?)`,
	);
	for (const [id, title, html] of SECTIONS) {
		insertSection.run(`sec-${id}`, SESSION_ID, id, title, html, now, now);
	}
}

function matches(expected: ExpectedCall, actual: RecordedCall | undefined): boolean {
	if (!actual || actual.tool !== expected.tool) return false;
	return Object.entries(expected.args ?? {}).every(([key, value]) => {
		const got = actual.args[key];
		return typeof got === "string" && got.toLowerCase().includes(value.toLowerCase());
	});
}

function judge(c: IntentCase, calls: RecordedCall[]): boolean {
	if (c.expect.length === 0) return calls.length === 0;
	return c.expect.every((e, i) => matches(e, calls[i]));
}

async function main(): Promise<void> {
	await seed();
	const { createOrchestrator } = await import("../orchestrator.js");
	const { buildTools } = await import("../../tools/index.js");
	const { createTurnRecorder } = await import("../types.js");

	let calls: RecordedCall[] = [];
	const driver = createOrchestrator(undefined, (ctx) =>
		buildTools(ctx).map((real) => {
			if (READ_TOOLS.has(real.name)) return real;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const schema = (real as any).schema;
			return tool(
				async (args: Record<string, unknown>) => {
					calls.push({ tool: real.name, args });
					return JSON.stringify({ ok: true, note: "（评测桩：已记录，未真正执行）" });
				},
				{
					name: real.name,
					description: real.description,
					schema,
					returnDirect: ENDING_TOOLS.has(real.name),
				},
			);
		}) as ReturnType<typeof buildTools>,
	);

	let passed = 0;
	let generateFalsePositive = 0;
	let editMisrouted = 0;
	for (const c of INTENT_CASES) {
		calls = [];
		let error = "";
		try {
			await driver.runTurn(
				{
					sessionId: SESSION_ID,
					userMessage: c.input,
					target: c.target ?? null,
					locale: "zh-CN",
					signal: new AbortController().signal,
					recorder: createTurnRecorder(),
				},
				() => {},
			);
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
		const ok = !error && judge(c, calls);
		if (ok) passed++;
		if (c.expect[0]?.tool !== "generate_prd" && calls.some((x) => x.tool === "generate_prd")) {
			generateFalsePositive++;
		}
		if (
			c.editIntent &&
			calls.some((x) => x.tool === "generate_prd" || x.tool === "regenerate_section")
		) {
			editMisrouted++;
		}
		const got = calls.map((x) => `${x.tool}(${JSON.stringify(x.args)})`).join(" → ") || "none";
		console.log(`${ok ? "PASS" : "FAIL"} #${c.id} ${c.input}\n     → ${error ? `ERROR ${error}` : got}`);
	}

	const accuracy = passed / INTENT_CASES.length;
	console.log(
		`\n准确率 ${(accuracy * 100).toFixed(1)}%（${passed}/${INTENT_CASES.length}）｜generate_prd 误触发 ${generateFalsePositive}｜编辑被判成重新生成 ${editMisrouted}`,
	);
	if (accuracy < 0.9 || generateFalsePositive > 0 || editMisrouted > 0) process.exitCode = 1;
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
