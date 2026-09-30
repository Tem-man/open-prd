import { defineStore } from "pinia";
import { ref } from "vue";
import type { PrdVersionMeta } from "@/types";
import { useMessagesStore } from "./messages";
import { usePrdEditStore } from "./prdEdit";
import { useSessionsStore } from "./sessions";

/**
 * PRD 版本管理（Figma Page 模型）。
 * 切换/新建/删除激活版本后，统一刷新工作区：PrdPanel HTML + 模块编辑状态。
 */
export const usePrdVersionsStore = defineStore("prdVersions", () => {
	const versions = ref<PrdVersionMeta[]>([]);
	const loading = ref(false);
	/** 版本切换/新建/删除进行中（用于禁用列表交互） */
	const mutating = ref(false);
	const drawerOpen = ref(false);

	async function fetchVersions(sessionId: string) {
		loading.value = true;
		try {
			const res = await fetch(`/api/sessions/${sessionId}/prd/versions`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as { versions: PrdVersionMeta[] };
			versions.value = data.versions;
		} finally {
			loading.value = false;
		}
	}

	/** 版本操作后刷新工作区显示（PRD HTML + 模块编辑态 + 对话记录 + 进度状态） */
	async function refreshWorkspace(assembledPrdHtml: string, sessionId: string) {
		const messagesStore = useMessagesStore();
		const sessionsStore = useSessionsStore();
		const hasContent = !!assembledPrdHtml;
		messagesStore.setPrdHtml(assembledPrdHtml);
		const prdEditStore = usePrdEditStore();
		prdEditStore.loadSections(sessionId);

		// 空白版本：在拉取会话前先把进度条打回未勾选，避免沿用上一版本的全勾选态
		if (!hasContent) {
			messagesStore.initWorkflowSteps(
				sessionsStore.currentSession?.selectedModules,
			);
			if (messagesStore.prdReady) {
				messagesStore.setPrdReady(messagesStore.prdReady, false);
			}
		}

		// 对话记录随版本走：重新拉取会话消息与流水线状态
		const data = await sessionsStore.fetchSession(sessionId);
		if (!data) return;
		messagesStore.loadMessages(data.messages ?? []);
		messagesStore.initWorkflowSteps(data.selectedModules);
		if (hasContent && data.pipelineState && data.pipelineState.phase !== "done") {
			messagesStore.applyPipelineState(data.pipelineState);
		} else if (hasContent && messagesStore.prdReady) {
			messagesStore.setPrdReady(messagesStore.prdReady, true);
		} else if (messagesStore.prdReady) {
			// 空白版本：进度条保持未勾选
			messagesStore.setPrdReady(messagesStore.prdReady, false);
		}
	}

	/** 顶部新增：空白版本 */
	async function addVersion(
		sessionId: string,
		label: string,
		opts: { copyIntake?: boolean } = {},
	): Promise<void> {
		mutating.value = true;
		try {
			const res = await fetch(`/api/sessions/${sessionId}/prd/versions`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					label,
					mode: "blank",
					copyIntake: opts.copyIntake,
				}),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as { assembledPrdHtml: string };
			await refreshWorkspace(data.assembledPrdHtml, sessionId);
			await fetchVersions(sessionId);
		} finally {
			mutating.value = false;
		}
	}

	/** 行内复制：复制指定版本行的 PRD */
	async function duplicateVersion(
		sessionId: string,
		versionId: string,
		label: string,
		copyConversation = true,
	): Promise<void> {
		mutating.value = true;
		try {
			const res = await fetch(
				`/api/sessions/${sessionId}/prd/versions/${versionId}/duplicate`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ label, copyConversation }),
				},
			);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as { assembledPrdHtml: string };
			await refreshWorkspace(data.assembledPrdHtml, sessionId);
			await fetchVersions(sessionId);
		} finally {
			mutating.value = false;
		}
	}

	/** 切换版本：工作区内容换为目标版本 */
	async function activateVersion(sessionId: string, versionId: string): Promise<void> {
		mutating.value = true;
		try {
			const res = await fetch(
				`/api/sessions/${sessionId}/prd/versions/${versionId}/activate`,
				{ method: "POST" },
			);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as { assembledPrdHtml: string };
			await refreshWorkspace(data.assembledPrdHtml, sessionId);
			await fetchVersions(sessionId);
		} finally {
			mutating.value = false;
		}
	}

	/** 重命名版本备注 */
	async function renameVersion(
		sessionId: string,
		versionId: string,
		label: string,
	): Promise<void> {
		mutating.value = true;
		try {
			const res = await fetch(
				`/api/sessions/${sessionId}/prd/versions/${versionId}`,
				{
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ label }),
				},
			);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			await fetchVersions(sessionId);
		} finally {
			mutating.value = false;
		}
	}

	/** 删除版本；若删除的是激活版本，后端会自动切到最新剩余版本 */
	async function deleteVersion(sessionId: string, versionId: string): Promise<void> {
		mutating.value = true;
		try {
			const res = await fetch(
				`/api/sessions/${sessionId}/prd/versions/${versionId}`,
				{ method: "DELETE" },
			);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as { assembledPrdHtml?: string };
			if (typeof data.assembledPrdHtml === "string") {
				await refreshWorkspace(data.assembledPrdHtml, sessionId);
			}
			await fetchVersions(sessionId);
		} finally {
			mutating.value = false;
		}
	}

	function reset() {
		versions.value = [];
		loading.value = false;
		mutating.value = false;
	}

	return {
		versions,
		loading,
		mutating,
		drawerOpen,
		fetchVersions,
		addVersion,
		duplicateVersion,
		activateVersion,
		renameVersion,
		deleteVersion,
		reset,
	};
});
