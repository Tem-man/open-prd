import { test } from "node:test";
import assert from "node:assert/strict";
import {
	bindByInstruction,
	buildCatalog,
	foldFiner,
	filterByQuery,
	isExcluded,
	resolveLocator,
	searchCatalog,
} from "./sectionLocator.js";
import {
	patchElementInHtml,
	patchTableElementByPath,
} from "../routes/sessions/helpers/htmlPatch.js";
import { parse as parseHtml } from "node-html-parser";

const FEATURE_HTML = `
<div class="feature-module-group">
  <h3 class="feature-module-title">🎯 核心功能</h3>
  <table class="prd-table feature-table">
    <thead>
      <tr><th>功能点</th><th>功能描述</th><th>优先级</th><th>迭代期</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>记账</td>
        <td>记录收支</td>
        <td><span class="badge badge-p0">P0 核心</span></td>
        <td>MVP</td>
      </tr>
      <tr>
        <td>导出报表</td>
        <td>导出 Excel</td>
        <td><span class="badge badge-p1">P1 重要</span></td>
        <td>一期</td>
      </tr>
      <tr>
        <td>导出明细</td>
        <td>导出 CSV</td>
        <td><span class="badge badge-p2">P2 优化</span></td>
        <td>二期</td>
      </tr>
    </tbody>
  </table>
</div>
<div class="feature-module-group">
  <h3 class="feature-module-title">📊 数据分析</h3>
  <table class="prd-table feature-table">
    <thead>
      <tr><th>功能点</th><th>功能描述</th><th>优先级</th><th>迭代期</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>统计图表</td>
        <td>可视化</td>
        <td><span class="badge badge-p1">P1 重要</span></td>
        <td>一期</td>
      </tr>
    </tbody>
  </table>
</div>
`;

const BACKGROUND_HTML = `
<div class="prd-subsection"><h2>项目背景</h2><p>业务现状</p></div>
<div class="prd-subsection"><h2>产品目标</h2><p>SMART 目标</p></div>
<div class="prd-subsection"><h2>成功指标</h2><p>留存 40%</p></div>
`;

const SCENARIO_HTML = `
<div class="scenario-card">
  <div class="scenario-title">财务报销</div>
  <p>触发条件：员工提交单据</p>
</div>
`;

const FLOWCHART_HTML = `
<div class="mermaid">flowchart TD
  A[提交申请] --> B[审批]
  B --> C[打款]
</div>
<p>主流程从提交到打款。</p>
`;

test("buildCatalog：小节 / 分组 / 表格行列 id 稳定", () => {
	const bg = buildCatalog(BACKGROUND_HTML);
	assert.equal(bg.find((e) => e.id === "sub:2")?.label, "成功指标");

	const catalog = buildCatalog(FEATURE_HTML);
	assert.ok(catalog.some((e) => e.id === "group:0" && e.label.includes("核心功能")));
	const exportRow = catalog.find((e) => e.kind === "row" && e.label === "导出报表");
	assert.ok(exportRow?.tablePath && exportRow.tablePath.kind === "row");
	const prioCell = catalog.find((e) => e.id.endsWith(":2") && e.label === "导出报表 · 优先级");
	assert.ok(prioCell?.tablePath && prioCell.tablePath.kind === "cell");
	assert.equal(prioCell?.kind, "cell");
});

test("resolveLocator 取出的 HTML 可被精确打补丁", () => {
	const catalog = buildCatalog(FEATURE_HTML);
	const row = catalog.find((e) => e.kind === "row" && e.label === "导出报表");
	assert.ok(row?.tablePath);
	const patched = patchTableElementByPath(
		FEATURE_HTML,
		row.tablePath,
		"<tr><td>导出报表</td><td>CHANGED</td><td>P0</td><td>一期</td></tr>",
	);
	assert.ok(patched);
	assert.ok(patched.includes("CHANGED"));
	assert.ok(patched.includes("记账"));
	assert.ok(patched.includes("导出明细"));

	const sub = resolveLocator(BACKGROUND_HTML, "sub:2");
	assert.ok(sub);
	const subPatched = patchElementInHtml(
		BACKGROUND_HTML,
		sub.selectedElementHtml,
		'<div class="prd-subsection"><h2>成功指标</h2><p>DAU 1万</p></div>',
	);
	assert.ok(subPatched?.includes("DAU 1万"));
	assert.ok(subPatched?.includes("项目背景"));
	assert.ok(subPatched?.includes("产品目标"));
});

test("mermaid 不进索引；审批搜流程图章为 0 命中", () => {
	const catalog = buildCatalog(FLOWCHART_HTML);
	assert.equal(catalog.length, 0);
	const mermaid = parseHtml(FLOWCHART_HTML).querySelector(".mermaid");
	assert.ok(mermaid && isExcluded(mermaid));
	const hits = searchCatalog([{ sectionId: "flowchart", html: FLOWCHART_HTML }], "审批");
	assert.equal(hits.length, 0);
});

test("searchCatalog「导出报表」优先 cell 而非整行", () => {
	const hits = searchCatalog([{ sectionId: "featureList", html: FEATURE_HTML }], "导出报表");
	assert.ok(hits.length > 0);
	assert.ok(hits.every((h) => h.kind !== "row"));
	assert.ok(hits.some((h) => h.kind === "cell" && h.label.startsWith("导出报表")));
});

test("bindByInstruction：导出报表+优先级 → 唯一 cell", () => {
	const catalog = buildCatalog(FEATURE_HTML);
	const bound = bindByInstruction(catalog, "把导出报表的优先级改成 P0");
	assert.equal(bound.status, "unique");
	if (bound.status === "unique") {
		assert.equal(bound.entry.kind, "cell");
		assert.equal(bound.entry.label, "导出报表 · 优先级");
	}
});

test("bindByInstruction：改导出 两行都含导出 → 多命中", () => {
	const catalog = buildCatalog(FEATURE_HTML);
	const bound = bindByInstruction(catalog, "改导出");
	assert.equal(bound.status, "ambiguous");
});

test("bindByInstruction：加一个支付模块 → 0 命中", () => {
	const catalog = buildCatalog(FEATURE_HTML);
	const bound = bindByInstruction(catalog, "加一个支付模块");
	assert.equal(bound.status, "none");
});

test("跨章：成功指标只命中 background 小节", () => {
	const hits = searchCatalog(
		[
			{ sectionId: "featureList", html: FEATURE_HTML },
			{ sectionId: "background", html: BACKGROUND_HTML },
			{ sectionId: "userScenario", html: SCENARIO_HTML },
		],
		"成功指标",
	);
	assert.equal(hits.length, 1);
	assert.equal(hits[0].sectionId, "background");
	assert.equal(hits[0].kind, "subsection");
});

test("foldFiner：同行 cell 覆盖 row", () => {
	const catalog = buildCatalog(FEATURE_HTML);
	const exportEntries = filterByQuery(catalog, "导出报表");
	const folded = foldFiner(exportEntries);
	assert.ok(folded.every((e) => e.kind !== "row" && e.kind !== "table"));
});

test("scenario-card 进入索引", () => {
	const catalog = buildCatalog(SCENARIO_HTML);
	assert.equal(catalog.find((e) => e.kind === "scenario")?.label, "财务报销");
});
