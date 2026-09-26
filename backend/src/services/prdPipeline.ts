import { generatePrdOutline } from "./prdOutline.js";
import { generateFullPrd, type ProgressCallback } from "./prd/index.js";
import { validateGeneratedPrd } from "./prdFinalize.js";
import type { PrdOutcome } from "./agent/types.js";

/** 大纲 → 逐模块生成 → 校验；生成异常转为 failed，中止则继续抛出。 */
export async function runPrdPipeline(
	sessionId: string,
	onProgress: ProgressCallback,
	signal?: AbortSignal,
): Promise<PrdOutcome> {
	try {
		await generatePrdOutline(sessionId);
		const prdId = await generateFullPrd(sessionId, onProgress, signal);
		const result = validateGeneratedPrd(sessionId, prdId);
		return result.ok
			? { status: "ready", prdId, warnings: result.warnings }
			: { status: "failed", reason: result.reason, message: result.message };
	} catch (err) {
		if (signal?.aborted) throw err;
		const msg = err instanceof Error ? err.message : String(err);
		return {
			status: "failed",
			reason: "prd_generation_failed",
			message: `PRD 生成失败：${msg}`,
		};
	}
}
