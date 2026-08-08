import type { MaybeRefOrGetter } from 'vue'

/**
 * Options for {@link useCanvas}.
 */
export type CanvasRenderLayer = 'full' | 'scene' | 'overlays'

export interface UseCanvasOptions {
  /**
   * Selects which render layer this canvas owns.
   */
  layer?: CanvasRenderLayer
  /**
   * Renders a single top-level frame in local frame coordinates instead of the page
   * viewport. Editor viewport state (pan, zoom, selection) is ignored.
   *
   * Accepts a ref or getter so a host can swap frames without recreating the surface.
   */
  frameId?: MaybeRefOrGetter<string | null | undefined>
  /**
   * Zoom applied to single-frame rendering, so a frame larger than its container can be
   * fitted without CSS-downscaling the canvas. Baked into the Skia transform to stay crisp.
   *
   * Ignored unless `frameId` is set. Defaults to 1.
   */
  frameScale?: MaybeRefOrGetter<number>
  /**
   * Forces ruler visibility on or off for this canvas.
   *
   * When omitted, the composable falls back to viewport and URL-param logic.
   */
  showRulers?: boolean
  /**
   * Keeps the drawing buffer after presenting frames.
   *
   * Useful for screenshot or pixel-readback workflows, but may increase memory
   * usage depending on the browser and GPU backend.
   */
  preserveDrawingBuffer?: boolean
  /**
   * Called once the rendering surface is ready.
   */
  onReady?: () => void
}
