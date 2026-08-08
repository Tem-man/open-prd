import type { EditorStore } from "@/app/editor/active-store";
import type { CollabSession } from "@/app/collab/use";

/**
 * No-op stand-in for upstream's Yjs peer-cursor awareness.
 * Collaboration was not migrated (plan 3.6); EditorCanvas still calls this helper.
 */
export function useCanvasCollaborationAwareness(
	_store: EditorStore,
	_collab: CollabSession | undefined,
) {
	return {
		updateCursor(_x: number, _y: number): void {},
	};
}
