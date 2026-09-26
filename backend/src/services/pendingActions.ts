import { randomUUID } from "node:crypto";
import { getDb } from "../db/client.js";
import { parseMeta } from "./agent/history.js";
import type { FormPayload, PendingAction } from "./agent/types.js";

const PENDING_TTL_MS = 30 * 60 * 1000;

export const CONFIRM_DECISIONS = [
	"save_version_then_regenerate",
	"overwrite",
	"cancel",
] as const;
export type ConfirmDecision = (typeof CONFIRM_DECISIONS)[number];

const CONFIRM_OPTIONS = ["先另存为新版本，再重新生成", "直接覆盖重新生成", "取消"];

function activeVersionIdOf(prdId: string): string | null {
	const row = getDb()
		.prepare("SELECT id FROM prd_versions WHERE prd_id = ? AND is_active = 1")
		.get(prdId) as { id: string } | undefined;
	return row?.id ?? null;
}

export function createPendingAction(prdId: string): PendingAction {
	return {
		token: randomUUID(),
		kind: "regenerate_prd",
		prdId,
		activeVersionId: activeVersionIdOf(prdId),
		expiresAt: Date.now() + PENDING_TTL_MS,
		status: "pending",
	};
}

export function buildConfirmForm(action: PendingAction): FormPayload {
	return {
		intro:
			"整份重新生成会覆盖当前所有模块（包括你手动和 AI 做过的修改），请选择：",
		questions: [
			{
				id: "decision",
				label: "如何处理当前内容？",
				type: "single_choice",
				required: true,
				options: CONFIRM_OPTIONS,
			},
		],
		action: { token: action.token, kind: action.kind },
	};
}

/** 选项文本 → 决策（按下标映射，供没有携带 decision 的调用方兜底） */
export function decisionFromOption(option: string): ConfirmDecision | null {
	const idx = CONFIRM_OPTIONS.indexOf(option);
	return idx === -1 ? null : CONFIRM_DECISIONS[idx];
}

export function confirmOptionText(decision: ConfirmDecision): string {
	return CONFIRM_OPTIONS[CONFIRM_DECISIONS.indexOf(decision)];
}

export type PendingLookup =
	| { ok: true; messageId: string; action: PendingAction }
	| { ok: false; message: string };

/** 校验确认凭证：存在、未处理、未过期、会话与激活版本匹配。 */
export function lookupPendingAction(
	sessionId: string,
	token: string,
): PendingLookup {
	const row = getDb()
		.prepare(
			`SELECT id, meta FROM messages
       WHERE session_id = ? AND role = 'assistant'
         AND json_extract(meta, '$.pendingAction.token') = ?
       LIMIT 1`,
		)
		.get(sessionId, token) as { id: string; meta: string } | undefined;
	if (!row) return { ok: false, message: "确认已失效，请重新发起整份重新生成" };

	const action = parseMeta(row.meta).pendingAction as PendingAction | undefined;
	if (!action || action.kind !== "regenerate_prd") {
		return { ok: false, message: "确认已失效，请重新发起整份重新生成" };
	}
	if (action.status !== "pending") {
		return { ok: false, message: "该确认已处理，请勿重复提交" };
	}
	if (Date.now() > action.expiresAt) {
		return { ok: false, message: "确认已过期，请重新发起整份重新生成" };
	}
	if (activeVersionIdOf(action.prdId) !== action.activeVersionId) {
		return { ok: false, message: "PRD 版本已切换，请重新发起整份重新生成" };
	}
	return { ok: true, messageId: row.id, action };
}

export function setPendingActionStatus(
	messageId: string,
	status: PendingAction["status"],
): void {
	getDb()
		.prepare(
			"UPDATE messages SET meta = json_set(meta, '$.pendingAction.status', ?) WHERE id = ?",
		)
		.run(status, messageId);
}
