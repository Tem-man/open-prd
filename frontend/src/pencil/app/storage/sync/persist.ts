import { prototypeMessages } from "@open-pencil/vue";
import type { StorageProviderID } from "@pencil/app/integrations/storage/types";

/*
 * Remote S3 storage was not migrated. open-prd reuses the storage-binding slot in
 * document IO so autosave (`createAutosave` → `writeFile` → here) can PUT `.fig`
 * bytes to `/api/prototypes/:id` without rewriting the upstream IO pipeline.
 */

export const OPEN_PRD_PROTOTYPE_PROVIDER: StorageProviderID = "open-prd";

export type PersistStorageCanvasOptions = {
	providerId: StorageProviderID;
	canvasId: string;
	name: string;
	figBytes: Uint8Array;
};

export async function persistStorageCanvasLocally(
	options: PersistStorageCanvasOptions,
): Promise<{ revision: number }> {
	if (options.providerId !== OPEN_PRD_PROTOTYPE_PROVIDER) {
		throw new Error("Remote storage sync is not available in open-prd");
	}

	const res = await fetch(`/api/prototypes/${options.canvasId}`, {
		method: "PUT",
		headers: { "Content-Type": "application/octet-stream" },
		body: options.figBytes,
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: prototypeMessages.get().saveFailed }));
		throw new Error((err as { error?: string }).error ?? prototypeMessages.get().saveFailed);
	}

	// Keep title in sync when the user renames via AppMenu double-click.
	if (options.name) {
		void fetch(`/api/prototypes/${options.canvasId}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: options.name }),
		}).catch(() => {
			/* title sync is best-effort; fig bytes already saved */
		});
	}

	return { revision: Date.now() };
}
