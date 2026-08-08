/*
 * Per-prototype camera persistence.
 *
 * Pan is stored in screen pixels, so persisting it directly makes the document jump whenever the
 * canvas column is a different size on reload (a resized splitter, a different window). What is
 * saved here is the canvas-space point under the centre of the viewport plus the zoom level, which
 * is independent of the viewport size, and pan is recomputed from it on restore.
 */

const STORAGE_PREFIX = 'open-prd:prototype-viewport:'

export interface PrototypeViewport {
	pageId: string
	centerX: number
	centerY: number
	zoom: number
}

interface ViewportSource {
	state: { panX: number; panY: number; zoom: number; currentPageId: string }
	getMeasuredViewportSize: () => { width: number; height: number } | null
}

function storageKey(prototypeId: string): string {
	return `${STORAGE_PREFIX}${prototypeId}`
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value)
}

export function readPrototypeViewport(prototypeId: string): PrototypeViewport | null {
	try {
		const raw = localStorage.getItem(storageKey(prototypeId))
		if (!raw) return null
		const parsed: unknown = JSON.parse(raw)
		if (!parsed || typeof parsed !== 'object') return null
		const { pageId, centerX, centerY, zoom } = parsed as Record<string, unknown>
		if (typeof pageId !== 'string') return null
		if (!isFiniteNumber(centerX) || !isFiniteNumber(centerY)) return null
		if (!isFiniteNumber(zoom) || zoom <= 0) return null
		return { pageId, centerX, centerY, zoom }
	} catch (e) {
		console.warn('[pencil] failed to read saved viewport', e)
		return null
	}
}

export function writePrototypeViewport(prototypeId: string, viewport: PrototypeViewport): void {
	try {
		localStorage.setItem(storageKey(prototypeId), JSON.stringify(viewport))
	} catch (e) {
		console.warn('[pencil] failed to save viewport', e)
	}
}

export function clearPrototypeViewport(prototypeId: string): void {
	try {
		localStorage.removeItem(storageKey(prototypeId))
	} catch (e) {
		console.warn('[pencil] failed to clear saved viewport', e)
	}
}

/** Returns null while the canvas has no measured size, since the centre would be meaningless. */
export function captureViewport(store: ViewportSource): PrototypeViewport | null {
	const size = store.getMeasuredViewportSize()
	if (!size) return null
	const { width, height } = size
	const { panX, panY, zoom } = store.state
	if (!isFiniteNumber(zoom) || zoom <= 0) return null
	return {
		pageId: store.state.currentPageId,
		centerX: (width / 2 - panX) / zoom,
		centerY: (height / 2 - panY) / zoom,
		zoom
	}
}

export function applyViewport(store: ViewportSource, viewport: PrototypeViewport): boolean {
	const size = store.getMeasuredViewportSize()
	if (!size) return false
	const { width, height } = size
	store.state.zoom = viewport.zoom
	store.state.panX = width / 2 - viewport.centerX * viewport.zoom
	store.state.panY = height / 2 - viewport.centerY * viewport.zoom
	return true
}
