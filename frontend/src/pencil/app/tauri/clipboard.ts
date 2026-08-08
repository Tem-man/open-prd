/*
 * Platform shim — see ./env.ts.
 *
 * Every caller reaches these only behind `isTauri()`, which is permanently false, so the browser
 * clipboard path is always taken instead. If Electron-native clipboard access is ever needed,
 * implement it here over IPC rather than reintroducing a second branch at the call sites.
 */

export async function writeTauriClipboardHtml(_html: string, _plainText: string): Promise<void> {
	throw new Error("Native clipboard is unavailable; the browser clipboard path should be used");
}

export async function writeTauriClipboardText(_text: string): Promise<void> {
	throw new Error("Native clipboard is unavailable; the browser clipboard path should be used");
}

export async function readTauriClipboardText(): Promise<string | null> {
	return null;
}
