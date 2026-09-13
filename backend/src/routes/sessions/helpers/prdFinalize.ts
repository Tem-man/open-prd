import type { Response } from "express";
import { getDb } from "../../../db/client.js";
import { writeDone, writeError, writePrdReady } from "../../../services/sse.js";
import { validatePrdHtml } from "../../../services/prdValidator.js";

/**
 * 校验 PRD HTML 并推送 prd_ready / writeDone，
 * 供多个路由复用（原 POST /messages + 新 POST /messages/retry）。
 */
export async function finalizePrd(
	res: { writableEnded: boolean },
	db: ReturnType<typeof getDb>,
	sessionId: string,
	prdId: string,
	stopHeartbeat: () => void,
): Promise<void> {
	type PrdRow = { html: string };
	const prdRow = db.prepare("SELECT html FROM prds WHERE id = ?").get(prdId) as
		| PrdRow
		| undefined;

	if (!prdRow?.html) {
		stopHeartbeat();
		writeError(res as Response, "PRD 内容写入异常，无法读取生成结果", {
			retryable: true,
			reason: "prd_write_error",
			suggestedMode: "continue_prd",
		});
		return;
	}

	type SessionModuleRow = { selected_modules: string | null };
	const sessionRow = db
		.prepare("SELECT selected_modules FROM sessions WHERE id = ?")
		.get(sessionId) as SessionModuleRow | undefined;

	let expectedSectionCount = 0;
	if (sessionRow?.selected_modules) {
		try {
			const mods = JSON.parse(sessionRow.selected_modules) as unknown[];
			expectedSectionCount = mods.length;
		} catch {
			/* ignore */
		}
	}

	const { hardErrors, warnings } = validatePrdHtml(
		prdRow.html,
		expectedSectionCount,
	);

	if (hardErrors.length > 0) {
		stopHeartbeat();
		writeError(
			res as Response,
			`PRD 结构校验失败：\n• ${hardErrors.join("\n• ")}`,
			{
				retryable: true,
				reason: "prd_validation_failed",
				suggestedMode: "continue_prd",
			},
		);
		return;
	}

	if (!res.writableEnded) {
		stopHeartbeat();
		writePrdReady(
			res as Response,
			prdId,
			warnings.length > 0 ? warnings : undefined,
		);
		writeDone(res as Response, true);
	}
}
