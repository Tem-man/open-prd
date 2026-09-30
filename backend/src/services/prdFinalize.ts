import { getDb } from "../db/client.js";
import { validatePrdHtml } from "./prdValidator.js";

export type PrdValidationResult =
	| { ok: true; prdId: string; warnings: string[] }
	| {
			ok: false;
			reason: "prd_write_error" | "prd_validation_failed";
			message: string;
	  };

/** 校验流水线写入的 PRD；不负责推送，由路由 / 工具决定如何反馈。 */
export function validateGeneratedPrd(
	sessionId: string,
	prdId: string,
): PrdValidationResult {
	const db = getDb();
	const prdRow = db.prepare("SELECT html FROM prds WHERE id = ?").get(prdId) as
		| { html: string }
		| undefined;

	if (!prdRow?.html) {
		return {
			ok: false,
			reason: "prd_write_error",
			message: "PRD 内容写入异常，无法读取生成结果",
		};
	}

	const sessionRow = db
		.prepare("SELECT selected_modules FROM sessions WHERE id = ?")
		.get(sessionId) as { selected_modules: string | null } | undefined;

	let expectedSectionCount = 0;
	if (sessionRow?.selected_modules) {
		try {
			expectedSectionCount = (JSON.parse(sessionRow.selected_modules) as unknown[])
				.length;
		} catch {
			/* ignore */
		}
	}

	const { hardErrors, warnings } = validatePrdHtml(
		prdRow.html,
		expectedSectionCount,
	);
	if (hardErrors.length > 0) {
		return {
			ok: false,
			reason: "prd_validation_failed",
			message: `PRD 结构校验失败：\n• ${hardErrors.join("\n• ")}`,
		};
	}
	return { ok: true, prdId, warnings };
}
