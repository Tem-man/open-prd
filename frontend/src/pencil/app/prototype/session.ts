import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { useEventListener, useRafFn } from '@vueuse/core'

import type { PrototypeTrigger } from '@open-pencil/scene-graph'
import {
  advanceTransition,
  applyPrototypeAction,
  closeTopOverlay,
  collectDelayedReactions,
  findReaction,
  findReactionNode,
  findStartFrameId,
  goBack,
  goToFrame,
  handleTrigger,
  listPresentableFrames,
  startPresent,
  type PresentResult,
  type PresentState
} from '@open-pencil/core/prototype'

import type { EditorStore } from '@/app/editor/active-store'

/** Triggers a pointer move has to consider: hover reactions plus cursor feedback. */
const POINTER_TRIGGERS: readonly PrototypeTrigger[] = [
  'ON_CLICK',
  'ON_HOVER',
  'ON_HOVER_END'
] as const

/**
 * Runtime for the fullscreen prototype presenter.
 *
 * Owns the immutable `PresentState`, the transition animation clock, `afterDelay` timers, and
 * keyboard shortcuts. The scene graph is only read, never mutated, so leaving the presenter
 * cannot alter the document.
 */
export function usePresentSession(store: EditorStore, exit: () => void) {
  const frames = computed(() => listPresentableFrames(store.graph, store.state.currentPageId))

  const state = ref<PresentState>(
    startPresent(findStartFrameId(store.graph, store.state.currentPageId) ?? '')
  )

  const currentFrame = computed(() => store.graph.getNode(state.value.currentFrameId) ?? null)
  const previousFrame = computed(() =>
    state.value.transition ? (store.graph.getNode(state.value.transition.fromId) ?? null) : null
  )
  const isInteractiveHover = shallowRef(false)

  function apply(result: PresentResult) {
    state.value = result.state
    if (!result.openUrl) return
    window.open(result.openUrl.url, result.openUrl.newTab ? '_blank' : '_self', 'noopener')
  }

  // ─── Transition clock ───────────────────────────────────────────
  const clock = useRafFn(
    () => {
      const next = advanceTransition(state.value, performance.now())
      if (next !== state.value) state.value = next
      if (!next.transition) clock.pause()
    },
    { immediate: false }
  )

  watch(
    () => state.value.transition?.startTime,
    (startTime) => {
      if (startTime === undefined) clock.pause()
      else clock.resume()
    }
  )

  // ─── afterDelay timers ──────────────────────────────────────────
  let delayTimers: ReturnType<typeof setTimeout>[] = []

  function clearDelayTimers() {
    for (const timer of delayTimers) clearTimeout(timer)
    delayTimers = []
  }

  watch(
    () => state.value.currentFrameId,
    (frameId) => {
      clearDelayTimers()
      if (!frameId) return
      for (const { delay, reaction } of collectDelayedReactions(store.graph, frameId)) {
        delayTimers.push(
          setTimeout(() => {
            apply(applyPrototypeAction(state.value, reaction.action, performance.now()))
          }, delay)
        )
      }
    },
    { immediate: true }
  )

  onScopeDispose(clearDelayTimers)

  // ─── Pointer ────────────────────────────────────────────────────
  const hoveredNodeId = shallowRef<string | null>(null)

  function fire(nodeId: string, trigger: PrototypeTrigger) {
    apply(handleTrigger(state.value, store.graph, nodeId, trigger))
  }

  function onFrameClick(frameId: string, localX: number, localY: number) {
    const node = findReactionNode(store.graph, frameId, localX, localY, ['ON_CLICK'])
    if (node) fire(node.id, 'ON_CLICK')
  }

  function onFramePointerMove(frameId: string, localX: number, localY: number) {
    const node = findReactionNode(store.graph, frameId, localX, localY, POINTER_TRIGGERS)
    isInteractiveHover.value = node !== null && findReaction(node, 'ON_CLICK') !== undefined

    const next =
      node && (findReaction(node, 'ON_HOVER') ?? findReaction(node, 'ON_HOVER_END'))
        ? node.id
        : null
    const previous = hoveredNodeId.value
    if (next === previous) return
    hoveredNodeId.value = next
    if (previous) fire(previous, 'ON_HOVER_END')
    if (next) fire(next, 'ON_HOVER')
  }

  function onFramePointerLeave() {
    isInteractiveHover.value = false
    const previous = hoveredNodeId.value
    if (!previous) return
    hoveredNodeId.value = null
    fire(previous, 'ON_HOVER_END')
  }

  // ─── Navigation ─────────────────────────────────────────────────
  function closeOverlay() {
    state.value = closeTopOverlay(state.value)
  }

  function onBackdropClick() {
    if (state.value.overlayStack.at(-1)?.closeOnBackdrop) closeOverlay()
  }

  function back() {
    state.value = goBack(state.value)
  }

  function showFrame(frameId: string) {
    state.value = goToFrame(state.value, frameId)
  }

  useEventListener(window, 'keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      if (state.value.overlayStack.length > 0) closeOverlay()
      else exit()
      return
    }
    if (event.key === 'Backspace' || event.key === 'ArrowLeft') {
      event.preventDefault()
      back()
    }
  })

  return {
    state,
    frames,
    currentFrame,
    previousFrame,
    isInteractiveHover,
    back,
    showFrame,
    closeOverlay,
    onBackdropClick,
    onFrameClick,
    onFramePointerMove,
    onFramePointerLeave
  }
}

export type PresentSession = ReturnType<typeof usePresentSession>
