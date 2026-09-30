import type { Response } from "express";

/** 心跳间隔（ms）。若超过此时间无任何数据推送，自动发送 SSE 注释行保活连接。 */
const HEARTBEAT_INTERVAL_MS = parseInt(
	process.env.SSE_HEARTBEAT_MS ?? "10000",
	10,
);

/** 强制 flush Node.js/Express 写缓冲区，确保数据立即出网络。 */
function flushRes(res: Response): void {
	if (typeof (res as unknown as { flush?: () => void }).flush === "function") {
		(res as unknown as { flush: () => void }).flush();
	}
}

/** 设置 SSE 响应头，必须在首次写入前调用。返回用于停止心跳的清理函数。 */
export function initSse(res: Response): () => void {
	res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
	res.setHeader("Cache-Control", "no-cache, no-transform");
	res.setHeader("Connection", "keep-alive");
	res.setHeader("X-Accel-Buffering", "no"); // 禁止 Nginx 缓冲
	res.flushHeaders();

	// 定时发送心跳注释，防止浏览器/代理因空闲超时断流
	let heartbeatTimer: ReturnType<typeof setInterval> | null = setInterval(
		() => {
			if (!res.writableEnded) {
				res.write(": heartbeat\n\n");
				flushRes(res);
			}
		},
		HEARTBEAT_INTERVAL_MS,
	);

	const stopHeartbeat = () => {
		if (heartbeatTimer) {
			clearInterval(heartbeatTimer);
			heartbeatTimer = null;
		}
	};

	// 连接关闭时自动停止心跳
	res.on("close", stopHeartbeat);
	res.on("finish", stopHeartbeat);

	return stopHeartbeat;
}

/**
 * 推送增量文本。
 * @param seq 当前 chunk 的递增序号，供客户端断线重连时携带 Last-Event-ID
 */
export function writeDelta(res: Response, content: string, seq?: number): void {
	if (seq !== undefined) {
		res.write(`id: ${seq}\n`);
	}
	res.write(`data: ${JSON.stringify({ type: "delta", content })}\n\n`);
	flushRes(res);
}

/**
 * Push a thinking / reasoning increment. Same framing as writeDelta so
 * Last-Event-ID replay can restore both channels in order.
 */
export function writeThinking(res: Response, content: string, seq?: number): void {
	if (seq !== undefined) {
		res.write(`id: ${seq}\n`);
	}
	res.write(`data: ${JSON.stringify({ type: "thinking", content })}\n\n`);
	flushRes(res);
}

/** 流结束，关闭连接；messageId 为落库后的助手消息 id，供前端替换临时 id */
export function writeDone(
	res: Response,
	prdGenerated = false,
	messageId?: string,
): void {
	res.write(`event: done\n`);
	res.write(
		`data: ${JSON.stringify({ type: "done", prdGenerated, ...(messageId ? { messageId } : {}) })}\n\n`,
	);
	flushRes(res);
	res.end();
}

/**
 * 通知前端 PRD 已生成。
 * @param prdId    已写入 DB 的 PRD 记录 ID
 * @param warnings 可选的非阻塞性质量警告（如 Mermaid 语法异常），供前端展示提示
 */
export function writePrdReady(
	res: Response,
	prdId: string,
	warnings?: string[],
): void {
	res.write(
		`data: ${JSON.stringify({ type: "prd_ready", prdId, warnings: warnings ?? [] })}\n\n`,
	);
	flushRes(res);
}

/**
 * 推送 PRD 各模块生成进度。
 * @param sectionId  对应 SectionId（background / userScenario / …）
 * @param status     generating | done | error
 */
export function writePrdProgress(
	res: Response,
	sectionId: string,
	status: "generating" | "done" | "error",
): void {
	res.write(
		`data: ${JSON.stringify({ type: "prd_progress", sectionId, status })}\n\n`,
	);
	flushRes(res);
}

/**
 * 推送结构化提问表单数据给前端。
 * @param formData 解析好的问题表单 JSON 对象
 */
export function writeForm(res: Response, formData: unknown): void {
	res.write(`event: form\n`);
	res.write(`data: ${JSON.stringify(formData)}\n\n`);
	flushRes(res);
}

export interface WriteErrorMeta {
	/** 前端可据此展示「继续」按钮 */
	retryable?: boolean;
	/** idle_timeout | prd_generation_failed | prd_validation_failed | agent_error */
	reason?: string;
	/** 前端自动推荐的操作模式 */
	suggestedMode?: "retry_last" | "continue_agent" | "continue_prd" | "retry_section";
}

/** 推送错误并关闭连接 */
export function writeError(
	res: Response,
	message: string,
	meta?: WriteErrorMeta,
): void {
	res.write(
		`data: ${JSON.stringify({
			type: "error",
			message,
			retryable: meta?.retryable ?? false,
			reason: meta?.reason,
			suggestedMode: meta?.suggestedMode,
		})}\n\n`,
	);
	flushRes(res);
	res.end();
}

// ─── Section 编辑系列事件 ────────────────────────────────────────────────────

/** 推送 AI 模块重写增量内容 */
export function writeSectionEditDelta(
	res: Response,
	sectionId: string,
	content: string,
): void {
	res.write(
		`data: ${JSON.stringify({ type: "section_edit_delta", sectionId, content })}\n\n`,
	);
	flushRes(res);
}

/** 推送 element patch 模式开始（让前端知道 AI 正在处理，但不更新 section html） */
export function writeSectionElementPatchStart(
	res: Response,
	sectionId: string,
): void {
	res.write(
		`data: ${JSON.stringify({ type: "section_element_patch_start", sectionId })}\n\n`,
	);
	flushRes(res);
}

/** 推送模块重写完成，携带最新完整 html 和新版本号 */
export function writeSectionEditDone(
	res: Response,
	sectionId: string,
	newHtml: string,
	version: number,
	assembledPrdHtml: string,
	elementLabel?: string,
): void {
	res.write(
		`data: ${JSON.stringify({
			type: "section_edit_done",
			sectionId,
			newHtml,
			version,
			assembledPrdHtml,
			...(elementLabel ? { elementLabel } : {}),
		})}\n\n`,
	);
	flushRes(res);
}

/** 推送模块重写失败（不关闭连接，由调用方决定是否 writeDone/writeError） */
export function writeSectionEditError(
	res: Response,
	sectionId: string,
	message: string,
): void {
	res.write(
		`data: ${JSON.stringify({ type: "section_edit_error", sectionId, message })}\n\n`,
	);
	flushRes(res);
}

/** 会话模块列表变化（对话中新增章节） */
export function writeSessionModulesUpdated(
	res: Response,
	selectedModules: unknown[],
): void {
	res.write(
		`data: ${JSON.stringify({ type: "session_modules_updated", selectedModules })}\n\n`,
	);
	flushRes(res);
}

/** 版本列表变化（整份重新生成前另存了新版本） */
export function writePrdVersionsChanged(
	res: Response,
	activeVersionId: string,
	version: number,
): void {
	res.write(
		`data: ${JSON.stringify({ type: "prd_versions_changed", activeVersionId, version })}\n\n`,
	);
	flushRes(res);
}
