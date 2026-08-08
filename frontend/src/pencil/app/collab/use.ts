import type { Ref } from "vue";
import type { Color } from "@open-pencil/scene-graph/primitives";

/*
 * Collaboration shim.
 *
 * Upstream backs multiplayer editing with Yjs + trystero P2P. That does not fit open-prd's
 * single-machine SQLite architecture and was not migrated
 * (docs/plan-prototype-editor-migration.md 3.6).
 *
 * `useCollabInjected` is upstream's optional accessor — it returns `undefined` whenever no collab
 * session was provided, and every call site already handles that with optional chaining. The
 * interface below mirrors the upstream shape so MobileHud / EditorCanvas typecheck against it;
 * the runtime always takes the undefined branch.
 */

export interface RemotePeer {
	id: number;
	name: string;
	color: Color;
	cursorX: number | null;
	cursorY: number | null;
	pageId: string | null;
	selection: string[];
}

export interface CollabState {
	connected: boolean;
	roomId: string | null;
	peers: RemotePeer[];
	localName: string;
	localColor: Color;
}

export const DEFAULT_COLLAB_STATE: CollabState = {
	connected: false,
	roomId: null,
	peers: [],
	localName: "",
	localColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
};

export interface CollabSession {
	state: Ref<CollabState>;
	remotePeers: Ref<RemotePeer[]>;
	followingPeer: Ref<number | null>;
	updateCursor(x: number, y: number, pageId: string): void;
	updateSelection(nodeIds: string[]): void;
	shareCurrentDoc(): string;
	disconnect(): void;
	followPeer(clientId: number | null): void;
}

export function useCollabInjected(): CollabSession | undefined {
	return undefined;
}
