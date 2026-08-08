/** Stub — multi-tab editing was not migrated (plan 3.6). */
export function openFileInNewTab(_file: unknown): void {
	console.warn('[pencil] openFileInNewTab is unavailable in open-prd')
}
export function createTab(): never {
	throw new Error('Tabs are not migrated')
}
export function closeTab(_id?: string): void {}
// Shaped like upstream's active-tab ref so `activeTab.value?.id` reads still typecheck; open-prd
// opens exactly one prototype per editor instance, so it stays null.
export const activeTab: { value: { id: string } | null } = { value: null }
export function tabCount(): number { return 0 }
export function getActiveStore() {
	return null
}
