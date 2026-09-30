import { tool } from "@langchain/core/tools";
import * as z from "zod";
import type { OrchestratorContext } from "../agent/types.js";
import {
	SEARCH_LIMIT,
	buildCatalog,
	foldFiner,
	filterByQuery,
	searchCatalog,
	type SearchHit,
} from "../sectionLocator.js";
import { readCurrentSections, resolveSection } from "./common.js";

function hitsJson(
	query: string | undefined,
	targets: SearchHit[],
	extra?: Record<string, unknown>,
): string {
	const truncated = targets.length > SEARCH_LIMIT;
	const sliced = targets.slice(0, SEARCH_LIMIT);
	return JSON.stringify({
		...(query ? { query } : {}),
		targets: sliced,
		...(sliced.length === 0 ? { note: "没有匹配的可编辑节点（流程图 / 信息架构图内节点不可定位）。" } : {}),
		...(truncated ? { note: "结果已截断，请缩小 query 或指定 sectionId。" } : {}),
		...extra,
	});
}

export function searchTargetsTool(ctx: OrchestratorContext) {
	return tool(
		async ({ query, sectionId }) => {
			const q = query?.trim() ?? "";
			const sid = sectionId?.trim() ?? "";
			if (!q && !sid) {
				return "请提供 query 或 sectionId。不能无过滤列出全部可编辑节点。";
			}
			if (!ctx.prdId) return "当前还没有 PRD 内容。";

			if (sid) {
				const resolved = resolveSection(ctx, sid);
				if (typeof resolved === "string") return resolved;
				const catalog = buildCatalog(resolved.row.html_content);
				const matched = q ? foldFiner(filterByQuery(catalog, q)) : catalog;
				const targets: SearchHit[] = matched.map((e) => ({
					id: e.id,
					kind: e.kind,
					label: e.label,
					sectionId: sid,
				}));
				return hitsJson(q || undefined, targets, { sectionId: sid });
			}

			const rows = readCurrentSections(ctx.prdId);
			const hits = searchCatalog(
				rows.map((r) => ({ sectionId: r.section_id, html: r.html_content })),
				q,
			);
			return hitsJson(q, hits);
		},
		{
			name: "search_targets",
			description:
				"在已生成的 PRD 中搜索可局部修改的节点（小节、功能分组、场景卡片、表格行/单元格），返回 locatorId。改已有行/格/小节时先调用本工具，再把 id 传给 edit_section.locatorId。不要用来搜索流程图、信息架构、产品架构图中的节点。",
			schema: z.object({
				query: z
					.string()
					.max(200)
					.optional()
					.describe("关键词，对节点标题/行名/列名做包含匹配。跨模块搜索时必填。"),
				sectionId: z
					.string()
					.optional()
					.describe(`限定模块 id。当前可选：${ctx.modules.map((m) => m.id).join(" / ")}。仅传 sectionId 不传 query 时返回该章前 ${SEARCH_LIMIT} 个节点。`),
			}),
		},
	);
}
