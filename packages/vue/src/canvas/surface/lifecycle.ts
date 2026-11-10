import type { CanvasKit } from 'canvaskit-wasm'
import { onScopeDispose, toValue } from 'vue'
import type { Ref } from 'vue'

import { SkiaRenderer } from '@open-pencil/core/canvas'
import type { Editor } from '@open-pencil/core/editor'

import {
  disposeGLContext,
  makeGLSurface,
  sizeCanvas,
  type CanvasGLContext,
  type CanvasGLHandle
} from '#vue/canvas/surface/gl-surface'
import { useCanvasKitLoader } from '#vue/canvas/surface/kit-loader'
import { createCanvasRenderLoop } from '#vue/canvas/surface/render-loop'
import { useCanvasResizeObserver } from '#vue/canvas/surface/resize-observer'
import type { UseCanvasOptions } from '#vue/canvas/surface/types'

type SurfaceManagerState = {
  renderer: SkiaRenderer | null
  glContext: CanvasGLContext | null
  /** CanvasKit's handle for the browser WebGL context, for teardown. */
  glHandle: CanvasGLHandle | null
  /** Raw browser context, captured at creation for `WEBGL_lose_context` teardown. */
  rawGl: WebGL2RenderingContext | null
}

export function createCanvasSurfaceManager({
  editor,
  canvasRef,
  options,
  getCanvasKit,
  isDestroyed,
  shouldShowRulers
}: {
  editor: Editor
  canvasRef: { value: HTMLCanvasElement | null }
  options: UseCanvasOptions | undefined
  getCanvasKit: () => CanvasKit | null
  isDestroyed: () => boolean
  shouldShowRulers: () => boolean
}) {
  const state: SurfaceManagerState = {
    renderer: null,
    glContext: null,
    glHandle: null,
    rawGl: null
  }
  let sceneBackingRenderTimer: ReturnType<typeof setTimeout> | null = null
  const sizeOptions = { publishViewportSize: options?.frameId === undefined }

  function clearSceneBackingRenderTimer() {
    if (sceneBackingRenderTimer === null) return
    clearTimeout(sceneBackingRenderTimer)
    sceneBackingRenderTimer = null
  }

  function createSurface(
    canvas: HTMLCanvasElement,
    { reloadFonts = false }: { reloadFonts?: boolean } = {}
  ) {
    const ck = getCanvasKit()
    if (!ck) return

    if (state.renderer) editor.removeCanvasRenderer(state.renderer)
    state.renderer?.destroy()
    state.renderer = null
    // The element is reused in this path, so the browser context must stay usable — only let
    // CanvasKit forget the previous registration instead of losing the context.
    disposeGLContext(ck, state, false)

    sizeCanvas(canvas, editor, sizeOptions)

    const result = makeGLSurface(ck, canvas, editor, options, state)
    state.glContext = result.glContext
    state.glHandle = result.glHandle
    const surface = result.surface
    if (!surface) {
      canvas.dataset.surfaceError = 'webgl'
      return
    }

    const glCtx = canvas.getContext('webgl2') ?? null
    state.rawGl = glCtx
    state.renderer = new SkiaRenderer(ck, surface, glCtx)
    editor.setCanvasKit(ck, state.renderer)
    canvas.dataset.ready = '1'

    // When the surface is recreated after a resize fallback, destroyRenderer
    // has cleared the module-level fontProvider — the new renderer must reload.
    // On initial mount, kit-loader.init() handles loadFonts, so skip here.
    if (reloadFonts && !isDestroyed()) {
      void state.renderer.loadFonts(renderNow).then(() => {
        if (!isDestroyed()) renderNow()
        return undefined
      })
    }
  }

  function renderNow() {
    if (!state.renderer || isDestroyed()) return
    const width = canvasRef.value?.clientWidth ?? 0
    const height = canvasRef.value?.clientHeight ?? 0
    const frameId = toValue(options?.frameId)
    if (frameId) {
      const dpr = window.devicePixelRatio || 1
      const frameScale = toValue(options?.frameScale) ?? 1
      state.renderer.renderFrame(
        editor.graph,
        frameId,
        width / frameScale,
        height / frameScale,
        dpr * frameScale
      )
    } else {
      state.renderer.renderFromEditorState(
        editor.state,
        editor.graph,
        editor.textEditor,
        width,
        height,
        shouldShowRulers(),
        options?.layer ?? 'full'
      )
    }
    renderLoop.markRendered()
    clearSceneBackingRenderTimer()
    if (options?.layer === 'scene' && state.renderer.sceneBackingNeedsCrispRender) {
      const delay = Math.max(0, state.renderer.sceneBackingPreviewUntil - performance.now())
      sceneBackingRenderTimer = setTimeout(() => renderLoop.markDirty(), delay)
    }
  }

  const renderLoop = createCanvasRenderLoop(editor, renderNow, { layer: options?.layer })

  function resizeCanvas(canvas: HTMLCanvasElement) {
    const ck = getCanvasKit()
    if (!ck || !state.renderer) {
      createSurface(canvas)
      return
    }

    sizeCanvas(canvas, editor, sizeOptions)

    const result = makeGLSurface(ck, canvas, editor, options, state)
    state.glContext = result.glContext
    state.glHandle = result.glHandle
    const surface = result.surface
    if (!surface) {
      console.warn('Falling back to full surface recreation after resize')
      createSurface(canvas, { reloadFonts: true })
      return
    }
    state.renderer.replaceSurface(surface)
    renderNow()
  }

  function destroy() {
    clearSceneBackingRenderTimer()
    renderLoop.pause()
    if (state.renderer) editor.removeCanvasRenderer(state.renderer)
    state.renderer?.destroy()
    // The scope and its canvas element are being discarded, so release the browser-side
    // WebGL context for real (deleteContext + loseContext), not just Skia's GPU resources.
    disposeGLContext(getCanvasKit(), state, true)
  }

  return {
    createSurface,
    resizeCanvas,
    renderNow,
    destroy,
    markDirty: renderLoop.markDirty,
    getRenderer: () => state.renderer
  }
}

export function useCanvasSurfaceLifecycle({
  canvasRef,
  surface,
  setCanvasKit,
  getCanvasKitValue,
  lifecycle,
  onReady
}: {
  canvasRef: Ref<HTMLCanvasElement | null>
  surface: ReturnType<typeof createCanvasSurfaceManager>
  setCanvasKit: (ck: CanvasKit | null) => void
  getCanvasKitValue: () => CanvasKit | null
  lifecycle: { destroyed: boolean }
  onReady?: () => void
}) {
  useCanvasKitLoader({
    canvasRef,
    lifecycle,
    setCanvasKit,
    createSurface: surface.createSurface,
    loadFonts: () => surface.getRenderer()?.loadFonts(surface.renderNow),
    renderNow: surface.renderNow,
    onReady
  })

  const { cancelResize } = useCanvasResizeObserver({
    canvasRef,
    getCanvasKitValue,
    resizeCanvas: surface.resizeCanvas
  })

  onScopeDispose(() => {
    lifecycle.destroyed = true
    cancelResize()
    surface.destroy()
  })
}
