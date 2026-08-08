/*
 * Platform shim.
 *
 * Upstream OpenPencil ships as a Tauri desktop app and branches on `isTauri()` to reach native
 * capabilities. open-prd uses Electron instead, so the whole Tauri layer was left behind and this
 * module keeps the ~19 call sites compiling while permanently selecting the browser branch.
 *
 * The module path is kept as `app/tauri/*` on purpose, so these files stay diffable against
 * upstream. See packages/PENCIL_UPSTREAM.md.
 */
export function isTauri(): boolean {
	return false;
}
