import type { IRouter } from "express";
import {
	listPrdVersions,
	getPrdVersionRow,
	createPrdVersion,
	activatePrdVersion,
	clonePrdVersion,
	deletePrdVersion,
	renamePrdVersion,
} from "../../services/prdVersions.js";
import { findLatestPrdId } from "./helpers/sectionPersist.js";

/** 校验版本行属于该会话的 PRD，防止跨会话操作 */
function findVersionInPrd(versionId: string, prdId: string) {
	const row = getPrdVersionRow(versionId);
	return row && row.prd_id === prdId ? row : undefined;
}

/** 注册 PRD version 管理路由（列表、创建、激活、克隆、删除、重命名）。 */
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

	// POST /api/sessions/:id/prd/versions — 新增版本 { label?, mode: 'duplicate' | 'blank' }
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
		const result = createPrdVersion(prdId, sessionId, { label, mode });
		res.json(result);
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

	// POST /api/sessions/:id/prd/versions/:vid/clone — 克隆为当前会话的新版本（仅 PRD，不复制对话）
	router.post("/:id/prd/versions/:vid/clone", (req, res) => {
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
		res.json(clonePrdVersion(req.params.vid, sessionId));
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
