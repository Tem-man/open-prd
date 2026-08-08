/// <reference types="vite/client" />

/**
 * Resolve a runtime-fetched asset (CanvasKit's wasm, the bundled font faces) against the app's
 * base URL.
 *
 * These are fetched by URL rather than imported, so the bundler cannot rewrite them. A
 * root-absolute path breaks whenever the app is not served from the origin root — notably in
 * Electron, where the built `index.html` is loaded over `file://` and `/foo.ttf` would resolve
 * against the filesystem root.
 */
export function publicAssetUrl(file: string): string {
  const base = 'env' in import.meta ? import.meta.env.BASE_URL : '/'
  const prefix = base === '/' ? '' : base.replace(/\/$/, '')
  return `${prefix}/${file.replace(/^\//, '')}`
}
