import type { Response } from "express";
import { writeDone, writeError, writePrdReady } from "../../../services/sse.js";
import { validateGeneratedPrd } from "../../../services/prdFinalize.js";

/** 校验 PRD HTML 并推送 prd_ready / done（失败时推送可重试的 error）。 */
export async function finalizePrd(
	res: Response,
	sessionId: string,
	prdId: string,
	stopHeartbeat: () => void,
): Promise<void> {
	const result = validateGeneratedPrd(sessionId, prdId);
	if (res.writableEnded) return;
	stopHeartbeat();
	if (!result.ok) {
		writeError(res, result.message, {
			retryable: true,
			reason: result.reason,
			suggestedMode: "continue_prd",
		});
		return;
	}
	writePrdReady(
		res,
		prdId,
		result.warnings.length > 0 ? result.warnings : undefined,
	);
	writeDone(res, true);
}
