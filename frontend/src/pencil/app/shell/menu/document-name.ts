import { computed } from "vue";

import { useInlineRename } from "@open-pencil/vue";

import type { EditorStore } from "@/app/editor/active-store";
import { OPEN_PRD_PROTOTYPE_PROVIDER } from "@/app/storage/sync/persist";

const DOCUMENT_NAME_ID = "document-name";

export function useDocumentNameRename(store: EditorStore) {
	const rename = useInlineRename<"document-name">((_id, name) => {
		store.state.documentName = name;
		const binding = store.getStorageBinding?.();
		if (
			binding?.providerId === OPEN_PRD_PROTOTYPE_PROVIDER &&
			binding.documentId
		) {
			void fetch(`/api/prototypes/${binding.documentId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: name }),
			}).catch((e) => {
				console.warn("Failed to sync prototype title:", e);
			});
		}
	});
	const editingName = computed(
		() => rename.editingId.value === DOCUMENT_NAME_ID,
	);

	function startRename() {
		rename.start(DOCUMENT_NAME_ID, store.state.documentName);
	}

	function commitRename(e: Event) {
		rename.commit(DOCUMENT_NAME_ID, e);
	}

	return { rename, editingName, startRename, commitRename };
}
