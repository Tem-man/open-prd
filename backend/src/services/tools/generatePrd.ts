import { tool } from "@langchain/core/tools";
import * as z from "zod";
import type { OrchestratorContext } from "../agent/types.js";
import { buildConfirmForm, createPendingAction } from "../pendingActions.js";
import { runPrdPipeline } from "../prdPipeline.js";
import { emitterFor } from "./common.js";

export function generatePrdTool(ctx: OrchestratorContext) {
	return tool(
		async (_input, config) => {
			const emit = emitterFor(ctx, config);
			const zh = ctx.locale === "zh-CN";

			// 已有 PRD：只发确认卡片，真正执行由路由凭 token 触发（模型拿不到 token）
			if (ctx.prdId) {
				if (ctx.recorder.pendingAction || ctx.recorder.form) {
					return zh
						? "本轮已向用户发送过卡片，请等待用户选择。"
						: "A card was already sent this turn. Wait for the user to choose.";
				}
				const action = createPendingAction(ctx.prdId);
				const form = buildConfirmForm(action);
				ctx.recorder.pendingAction = action;
				ctx.recorder.form = form;
				emit({ type: "form", data: form });
				return zh
					? "已向用户发送整份重新生成的确认卡片，等待用户选择。"
					: "A confirmation card for full regeneration has been sent. Wait for the user to choose.";
			}

			ctx.recorder.generationStarted = true;
			const outcome = await runPrdPipeline(
				ctx.sessionId,
				(sectionId, status) => emit({ type: "prd_progress", sectionId, status }),
				ctx.signal,
			);
			ctx.recorder.prd = outcome;
			return outcome.status === "ready"
				? zh
					? "PRD 已生成完成。"
					: "The PRD has been generated."
				: zh
					? `PRD 生成失败：${outcome.message}`
					: `PRD generation failed: ${outcome.message}`;
		},
		{
			name: "generate_prd",
			description:
				"生成整份 PRD。收集阶段信息充分时调用，系统会自动完成所有模块。PRD 已存在时，仅当用户明确要求「整份 / 全部」重新生成才调用，系统会先向用户发送确认卡片。",
			schema: z.object({
				reason: z
					.string()
					.max(300)
					.optional()
					.describe("PRD 已存在时填写用户要求整份重新生成的原话摘要；首次生成留空"),
			}),
			returnDirect: true,
		},
	);
}
