import type { CanvasKit, Surface, WebGLContextHandle } from 'canvaskit-wasm'

import type { Editor } from '@open-pencil/core/editor'

import type { UseCanvasOptions } from '#vue/canvas/surface/types'

type GLContext = ReturnType<CanvasKit['MakeGrContext']>

export type CanvasGLContext = GLContext

/** CanvasKit's identity for the browser WebGL context behind a surface. */
export type CanvasGLHandle = WebGLContextHandle

/** All GL plumbing owned by one canvas. Surfaces are cheaper and recreated freely on top. */
export interface CanvasGLState {
  glContext: CanvasGLContext | null
  glHandle: CanvasGLHandle | null
  /** Raw browser context, captured at creation so teardown can force-release it. */
  rawGl: WebGL2RenderingContext | null
}

/**
 * Match the drawing buffer to the element size.
 *
 * `publishViewportSize` is off for single-frame canvases: their size is the frame's, not the
 * editor viewport's, so publishing it would corrupt pan/zoom state.
 */
export function sizeCanvas(
  canvas: HTMLCanvasElement,
  editor: Editor,
  { publishViewportSize = true }: { publishViewportSize?: boolean } = {}
) {
  const dpr = window.devicePixelRatio || 1
  canvas.width = canvas.clientWidth * dpr
  canvas.height = canvas.clientHeight * dpr
  if (!publishViewportSize) return
  if ('setViewportSize' in editor && typeof editor.setViewportSize === 'function') {
    editor.setViewportSize(canvas.clientWidth, canvas.clientHeight)
  }
}

export function makeGLSurface(
  ck: CanvasKit,
  canvas: HTMLCanvasElement,
  editor: Editor,
  options: UseCanvasOptions | undefined,
  existing: CanvasGLState
): { surface: Surface | null } & Omit<CanvasGLState, 'rawGl'> {
  let context = existing.glContext
  let handle = existing.glHandle
  if (!context) {
    const glAttrs = options?.preserveDrawingBuffer ? { preserveDrawingBuffer: 1 } : undefined
    handle = ck.GetWebGLContext(canvas, glAttrs)
    if (!handle) return { surface: null, glContext: null, glHandle: null }
    context = ck.MakeGrContext(handle)
  }
  if (!context) return { surface: null, glContext: null, glHandle: handle }

  const preferredSpace = editor.graph.documentColorSpace
  const colorSpaces =
    preferredSpace === 'display-p3'
      ? [ck.ColorSpace.DISPLAY_P3, ck.ColorSpace.SRGB]
      : [ck.ColorSpace.SRGB]

  for (const colorSpace of colorSpaces) {
    const surface = ck.MakeOnScreenGLSurface(context, canvas.width, canvas.height, colorSpace)
    if (surface) return { surface, glContext: context, glHandle: handle }
  }

  return { surface: null, glContext: context, glHandle: handle }
}

/**
 * Release the GL plumbing owned by one canvas.
 *
 * `GrContext.delete()` only frees Skia's GPU resources; the browser keeps counting the
 * underlying WebGL context as active, and emscripten retains a module-level reference to
 * every context it ever created, so GC cannot reclaim it either. Past ~16 active contexts
 * Chrome force-loses the oldest one ("Too many active WebGL contexts") — in the presenter
 * that used to happen once per transition or overlay, since each mounts a throwaway canvas.
 *
 * `deleteContext` drops emscripten's registry entry so the context becomes collectable;
 * `loseContext` additionally releases it in the browser right away. Pass `lose: true` only
 * when the canvas element is being discarded for good: a lost context never revives, and
 * `getContext` on that element keeps returning it for its whole lifetime.
 */
export function disposeGLContext(ck: CanvasKit | null, state: CanvasGLState, lose: boolean) {
  state.glContext?.delete()
  state.glContext = null
  if (state.glHandle !== null && ck) {
    ck.deleteContext(state.glHandle)
    state.glHandle = null
  }
  if (lose && state.rawGl) {
    state.rawGl.getExtension('WEBGL_lose_context')?.loseContext()
    state.rawGl = null
  }
}
