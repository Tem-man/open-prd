import type { ComposerTarget } from "../types.js";

export interface ExpectedCall {
	tool: string;
	/** 参数中需包含的值（字符串比较忽略大小写，取包含关系） */
	args?: Record<string, string>;
}

export interface IntentCase {
	id: number;
	input: string;
	target?: ComposerTarget;
	/** 期望的变更类工具调用序列（前缀匹配）；空数组 = 不应调用任何变更类工具 */
	expect: ExpectedCall[];
	/** 属于「编辑类」请求：被判成任何重新生成都记为严重错误 */
	editIntent?: boolean;
}

/** 与 docs/plan-orchestrator-agent.md §14.1 保持一致 */
export const INTENT_CASES: IntentCase[] = [
	{ id: 1, input: "这个架构图是什么意思", expect: [] },
	{ id: 2, input: "数据模型设计得合理吗", expect: [] },
	{ id: 3, input: "不错，就这样", expect: [] },
	{
		id: 4,
		input: "给用户表加个手机号字段",
		expect: [{ tool: "edit_entity", args: { entityName: "USER" } }],
		editIntent: true,
	},
	{
		id: 5,
		input: "订单实体删掉备注字段",
		expect: [{ tool: "edit_entity", args: { entityName: "ORDER" } }],
		editIntent: true,
	},
	{
		id: 6,
		input: "新增一个优惠券实体，关联订单",
		expect: [{ tool: "edit_entity", args: { entityName: "COUPON" } }],
		editIntent: true,
	},
	{
		id: 7,
		input: "功能清单里把导出报表的优先级改成 P0",
		expect: [{ tool: "edit_section", args: { sectionId: "featureList" } }],
		editIntent: true,
	},
	{
		id: 8,
		input: "业务流程里加一个审批节点",
		expect: [{ tool: "edit_section", args: { sectionId: "flowchart" } }],
		editIntent: true,
	},
	{
		id: 9,
		input: "信息架构里删掉设置页",
		expect: [{ tool: "edit_section", args: { sectionId: "infoArch" } }],
		editIntent: true,
	},
	{
		id: 10,
		input: "业务流程图重新生成一下",
		expect: [{ tool: "regenerate_section", args: { sectionId: "flowchart" } }],
	},
	{
		id: 11,
		input: "功能清单写得不好，重写",
		expect: [{ tool: "regenerate_section", args: { sectionId: "featureList" } }],
	},
	{
		id: 12,
		input: "再加一个支付模块",
		expect: [{ tool: "edit_section", args: { sectionId: "featureList" } }],
		editIntent: true,
	},
	{
		id: 13,
		input: "去掉积分功能",
		expect: [{ tool: "edit_section", args: { sectionId: "featureList" } }],
		editIntent: true,
	},
	{
		id: 14,
		input: "功能清单里加一个导出报表功能，业务流程也同步一下",
		expect: [
			{ tool: "edit_section", args: { sectionId: "featureList" } },
			{ tool: "edit_section", args: { sectionId: "flowchart" } },
		],
		editIntent: true,
	},
	{ id: 15, input: "整份 PRD 重新生成", expect: [{ tool: "generate_prd" }] },
	{ id: 16, input: "全部模块重写一遍", expect: [{ tool: "generate_prd" }] },
	{ id: 17, input: "改成 App，不做 Web 了", expect: [{ tool: "ask_user_form" }] },
	{ id: 18, input: "目标用户换成 B 端企业客户", expect: [{ tool: "ask_user_form" }] },
	{ id: 19, input: "重新生成一下", expect: [{ tool: "ask_user_form" }] },
	{
		id: 20,
		input: "重新生成一下",
		target: { sectionId: "dataModel", sectionTitle: "数据模型" },
		expect: [{ tool: "regenerate_section", args: { sectionId: "dataModel" } }],
	},
	{
		id: 21,
		input: "把这一格改成「支持批量导出」",
		target: {
			sectionId: "featureList",
			sectionTitle: "功能清单",
			elementLabel: "单元格",
			selectedElementHtml: "<td>导出报表</td>",
			tablePath: { kind: "cell", tableIndex: 0, rowIndex: 1, cellIndex: 1 },
		},
		expect: [{ tool: "edit_section", args: { sectionId: "featureList" } }],
		editIntent: true,
	},
	{
		id: 22,
		input: "PRD 里加一个竞品分析章节",
		expect: [{ tool: "add_section", args: { title: "竞品分析" } }],
	},
	{
		id: 23,
		input: "补一个非功能需求部分",
		expect: [{ tool: "add_section", args: { templateId: "nonFunctional" } }],
	},
	{ id: 24, input: "把信息架构这一章删掉", expect: [] },
	{ id: 25, input: "改一下那个表", expect: [{ tool: "ask_user_form" }] },
	{ id: 26, input: "换个产品，做一个外卖 App", expect: [] },
];
