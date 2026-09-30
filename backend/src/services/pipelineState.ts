import { getDb } from "../db/client.js";
import { getOutline } from "./prdOutline.js";
import type { SectionOutline } from "./prdOutline.js";

// ─── 公共类型 ─────────────────────────────────────────────────────────────────

export type PipelinePhase =
	| "idle"
	| "agent_interrupted"
	| "prd_generating"
	| "prd_partial"
	| "done";

export type RetryMode =
	| "retry_last"
	| "continue_agent"
	| "continue_prd"
	| "retry_section";

export interface PipelineLastError {
	reason: string;
	retryable: boolean;
	message?: string;
	suggestedMode?: RetryMode;
}

export interface PipelineState {
	phase: PipelinePhase;
	lastError?: PipelineLastError;
	outlineProgress?: Record<string, SectionOutline["status"]>;
	interruptedMessageId?: string;
	failedSectionId?: string;
}

// ─── 中断标记工具 ─────────────────────────────────────────────────────────────

/**
 * 末尾中断标记的两种格式：
 *   [⚠ 生成中断|idle_timeout]   (新格式，含原因)
 *   [⚠ 回复被中断]              (旧格式，兼容)
 */
export const INTERRUPT_MARKER_RE =
	/(?:\[⚠ 生成中断(?:\|([^\]|]+))?\]|\[⚠ 回复被中断\])\s*$/;

export function appendInterruptMarker(content: string, reason: string): string {
	return `${content.trimEnd()} [⚠ 生成中断|${reason}]`;
}

export function stripInterruptMarker(content: string): {
	clean: string;
	reason?: string;
	interrupted: boolean;
} {
	const m = content.match(INTERRUPT_MARKER_RE);
	if (!m) return { clean: content, interrupted: false };
	return {
		clean: content.replace(INTERRUPT_MARKER_RE, "").trimEnd(),
		reason: m[1] ?? "unknown",
		interrupted: true,
	};
}

export function isInterrupted(content: string): boolean {
	return INTERRUPT_MARKER_RE.test(content);
}

// ─── pipeline 状态推导 ────────────────────────────────────────────────────────

/**
 * 根据数据库状态推导当前会话的 pipeline 阶段，供 GET /sessions/:id 返回。
 */
export function computePipelineState(sessionId: string): PipelineState {
	const db = getDb();

	type AssistantRow = { id: string; content: string };
	const lastAssistant = db
		.prepare(
			`SELECT id, content FROM messages
       WHERE session_id = ? AND role = 'assistant'
       ORDER BY created_at DESC LIMIT 1`,
		)
		.get(sessionId) as AssistantRow | undefined;

	// 1. 检查最后一条助手消息是否带中断标记
	if (lastAssistant && isInterrupted(lastAssistant.content)) {
		const { reason } = stripInterruptMarker(lastAssistant.content);
		return {
			phase: "agent_interrupted",
			interruptedMessageId: lastAssistant.id,
			lastError: {
				reason: reason ?? "idle_timeout",
				retryable: true,
				message: "对话生成中断，可点击继续",
				suggestedMode:
					(lastAssistant.content.length - (INTERRUPT_MARKER_RE.exec(lastAssistant.content)?.[0].length ?? 0)) > 50
						? "continue_agent"
						: "retry_last",
			},
		};
	}

	// 2. 检查 outline 状态
	const outline = getOutline(sessionId);
	if (outline) {
		const outlineProgress: Record<string, SectionOutline["status"]> = {};
		for (const s of outline.sections) {
			outlineProgress[s.id] = s.status;
		}

		const hasGenerating = outline.sections.some((s) => s.status === "generating");
		const hasError = outline.sections.some((s) => s.status === "error");
		const hasPending = outline.sections.some((s) => s.status === "pending");
		const allDone = outline.sections.every((s) => s.status === "done");

		if (hasGenerating || hasPending) {
			return {
				phase: "prd_generating",
				outlineProgress,
				lastError: {
					reason: "prd_interrupted",
					retryable: true,
					message: "PRD 生成被中断，可继续",
					suggestedMode: "continue_prd",
				},
			};
		}

		const prdRow = db
			.prepare(
				"SELECT id FROM prds WHERE session_id = ? ORDER BY created_at DESC LIMIT 1",
			)
			.get(sessionId) as { id: string } | undefined;

		if (allDone && prdRow) {
			return { phase: "done", outlineProgress };
		}

		if (hasError) {
			const failedSection = outline.sections.find((s) => s.status === "error");
			return {
				phase: "prd_partial",
				outlineProgress,
				failedSectionId: failedSection?.id,
				lastError: {
					reason: "section_error",
					retryable: true,
					message: `模块「${failedSection?.title ?? failedSection?.id}」生成失败，可重试`,
					suggestedMode: "retry_section",
				},
			};
		}

		// outline 全 done 但无 prd 记录
		return {
			phase: "prd_partial",
			outlineProgress,
			lastError: {
				reason: "prd_incomplete",
				retryable: true,
				message: "PRD 组装未完成，可继续生成",
				suggestedMode: "continue_prd",
			},
		};
	}

	// 3. 有 prd 记录即为 done
	const prdRow = db
		.prepare(
			"SELECT id FROM prds WHERE session_id = ? ORDER BY created_at DESC LIMIT 1",
		)
		.get(sessionId) as { id: string } | undefined;
	if (prdRow) return { phase: "done" };

	return { phase: "idle" };
}

// ─── 辅助工具 ─────────────────────────────────────────────────────────────────

/** 返回会话最后一条 user 消息内容 */
export function getLastUserMessage(sessionId: string): string | null {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT content FROM messages
       WHERE session_id = ? AND role = 'user'
       ORDER BY created_at DESC LIMIT 1`,
		)
		.get(sessionId) as { content: string } | undefined;
	return row?.content ?? null;
}

/**
 * 删除最后一条带中断标记的 assistant 消息，
 * 返回去掉标记后的干净正文与思考（思考仅用于 UI 恢复，不回传模型）。
 */
export function removeLastInterruptedAssistant(
	sessionId: string,
): { content: string; thinking: string } | null {
	const db = getDb();
	type Row = { id: string; content: string; thinking: string };
	const row = db
		.prepare(
			`SELECT id, content, thinking FROM messages
       WHERE session_id = ? AND role = 'assistant'
       ORDER BY created_at DESC LIMIT 1`,
		)
		.get(sessionId) as Row | undefined;

	if (!row || !isInterrupted(row.content)) return null;

	const { clean } = stripInterruptMarker(row.content);
	db.prepare("DELETE FROM messages WHERE id = ?").run(row.id);
	return { content: clean, thinking: row.thinking ?? "" };
}
