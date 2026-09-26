import { ref } from "vue";
import { usePrdEditStore } from "@/stores/prdEdit";
import { useMessagesStore } from "@/stores/messages";

export function useSectionActions() {
	const prdEditStore = usePrdEditStore();
	const messagesStore = useMessagesStore();

	const saving = ref(false);
	const rolling = ref(false);

	async function saveSection(
		sessionId: string,
		sectionId: string,
		getHtml: () => string,
	) {
		if (saving.value) return;
		saving.value = true;
		try {
			const html = getHtml();
			const res = await fetch(
				`/api/sessions/${sessionId}/prd/sections/${sectionId}/content`,
				{
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ html }),
				},
			);
			if (!res.ok) throw new Error(`保存失败 ${res.status}`);
			const data = (await res.json()) as { version: number; updatedAt: number };
			prdEditStore.onContentSaved(sectionId, html, data.version);
			// 重新拉取完整 HTML 以更新导出源
			const prdRes = await fetch(`/api/sessions/${sessionId}/prd`);
			if (prdRes.ok) {
				const prdData = (await prdRes.json()) as { html?: string };
				if (prdData.html) messagesStore.updatePrdHtmlAfterEdit(prdData.html);
			}
		} finally {
			saving.value = false;
		}
	}

	/** @param messageId 对话式编辑的助手消息 id，后端据此持久化「已撤回」 */
	async function rollbackSection(
		sessionId: string,
		sectionId: string,
		messageId?: string,
	) {
		if (rolling.value) return;
		rolling.value = true;
		try {
			const res = await fetch(
				`/api/sessions/${sessionId}/prd/sections/${sectionId}/rollback`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ messageId }),
				},
			);
			if (!res.ok) throw new Error(`回滚失败 ${res.status}`);
			const data = (await res.json()) as {
				restoredVersion: number;
				html: string;
				assembledPrdHtml: string;
			};
			prdEditStore.onRollback(sectionId, data.html, data.restoredVersion);
			messagesStore.updatePrdHtmlAfterEdit(data.assembledPrdHtml);
		} finally {
			rolling.value = false;
		}
	}

	return { saving, rolling, saveSection, rollbackSection };
}
