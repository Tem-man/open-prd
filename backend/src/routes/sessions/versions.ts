import type { IRouter } from "express";
import {
	listPrdVersions,
	getPrdVersionRow,
	createPrdVersion,
	activatePrdVersion,
	deletePrdVersion,
	renamePrdVersion,
	CopyIntakeUnavailableError,
	VersionNotFoundError,
} from "../../services/prdVersions.js";
import { findLatestPrdId } from "./helpers/sectionPersist.js";

/** 校验版本行属于该会话的 PRD，防止跨会话操作 */
function findVersionInPrd(versionId: string, prdId: string) {
	const row = getPrdVersionRow(versionId);
	return row && row.prd_id === prdId ? row : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "boolean") return value;
	return undefined;
}

/** 注册 PRD version 管理路由（列表、创建、激活、删除、重命名）。 */
export function registerVersions(router: IRouter): void {
	// GET /api/sessions/:id/prd/versions — 版本列表（version DESC）
	router.get("/:id/prd/versions", (req, res) => {
		const sessionId = req.params.id;
		const prdId = findLatestPrdId(sessionId);
		if (!prdId) {
			res.status(404).json({ error: "PRD not found for this session" });
			return;
		}
		res.json({ versions: listPrdVersions(prdId, sessionId) });
	});

	// POST /api/sessions/:id/prd/versions — 新增空白版本（或内部 duplicate 当前工作区）
	// { label?, mode: 'duplicate' | 'blank', copyConversation?, copyIntake? }
	router.post("/:id/prd/versions", (req, res) => {
		const sessionId = req.params.id;
		const prdId = findLatestPrdId(sessionId);
		if (!prdId) {
			res.status(404).json({ error: "PRD not found for this session" });
			return;
		}
		const label = (req.body?.label as string | undefined)?.trim() ?? "";
		const mode = req.body?.mode as string | undefined;
		if (mode !== "duplicate" && mode !== "blank") {
			res.status(400).json({ error: "mode must be 'duplicate' or 'blank'" });
			return;
		}
		if (
			req.body?.copyConversation !== undefined &&
			typeof req.body.copyConversation !== "boolean"
		) {
			res.status(400).json({ error: "copyConversation must be a boolean" });
			return;
		}
		if (
			req.body?.copyIntake !== undefined &&
			typeof req.body.copyIntake !== "boolean"
		) {
			res.status(400).json({ error: "copyIntake must be a boolean" });
			return;
		}
		try {
			const result = createPrdVersion(prdId, sessionId, {
				label,
				mode,
				copyConversation: optionalBoolean(req.body?.copyConversation),
				copyIntake: optionalBoolean(req.body?.copyIntake),
			});
			res.json(result);
		} catch (err) {
			if (err instanceof CopyIntakeUnavailableError) {
				res.status(400).json({ error: err.message });
				return;
			}
			if (err instanceof VersionNotFoundError) {
				res.status(404).json({ error: err.message });
				return;
			}
			throw err;
		}
	});

	// POST /api/sessions/:id/prd/versions/:vid/duplicate — 复制该版本行
	router.post("/:id/prd/versions/:vid/duplicate", (req, res) => {
		const sessionId = req.params.id;
		const prdId = findLatestPrdId(sessionId);
		if (!prdId) {
			res.status(404).json({ error: "PRD not found for this session" });
			return;
		}
		if (!findVersionInPrd(req.params.vid, prdId)) {
			res.status(404).json({ error: "Version not found" });
			return;
		}
		const label = (req.body?.label as string | undefined)?.trim() ?? "";
		if (
			req.body?.copyConversation !== undefined &&
			typeof req.body.copyConversation !== "boolean"
		) {
			res.status(400).json({ error: "copyConversation must be a boolean" });
			return;
		}
		try {
			const result = createPrdVersion(prdId, sessionId, {
				label,
				mode: "duplicate",
				fromVersionId: req.params.vid,
				copyConversation: optionalBoolean(req.body?.copyConversation),
			});
			res.json(result);
		} catch (err) {
			if (err instanceof VersionNotFoundError) {
				res.status(404).json({ error: err.message });
				return;
			}
			throw err;
		}
	});

	// POST /api/sessions/:id/prd/versions/:vid/activate — 切换版本（写回旧版本 + 重建工作区）
	router.post("/:id/prd/versions/:vid/activate", (req, res) => {
		const sessionId = req.params.id;
		const prdId = findLatestPrdId(sessionId);
		if (!prdId) {
			res.status(404).json({ error: "PRD not found for this session" });
			return;
		}
		if (!findVersionInPrd(req.params.vid, prdId)) {
			res.status(404).json({ error: "Version not found" });
			return;
		}
		res.json(activatePrdVersion(req.params.vid, sessionId));
	});

	// DELETE /api/sessions/:id/prd/versions/:vid — 物理删除版本
	router.delete("/:id/prd/versions/:vid", (req, res) => {
		const sessionId = req.params.id;
		const prdId = findLatestPrdId(sessionId);
		if (!prdId) {
			res.status(404).json({ error: "PRD not found for this session" });
			return;
		}
		if (!findVersionInPrd(req.params.vid, prdId)) {
			res.status(404).json({ error: "Version not found" });
			return;
		}
		res.json(deletePrdVersion(req.params.vid, sessionId));
	});

	// PATCH /api/sessions/:id/prd/versions/:vid — 重命名版本备注 { label }
	router.patch("/:id/prd/versions/:vid", (req, res) => {
		const sessionId = req.params.id;
		const prdId = findLatestPrdId(sessionId);
		if (!prdId) {
			res.status(404).json({ error: "PRD not found for this session" });
			return;
		}
		if (!findVersionInPrd(req.params.vid, prdId)) {
			res.status(404).json({ error: "Version not found" });
			return;
		}
		const label = (req.body?.label as string | undefined)?.trim() ?? "";
		renamePrdVersion(req.params.vid, label);
		res.json({ ok: true });
	});
}
