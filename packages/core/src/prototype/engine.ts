import type { PrototypeAction, PrototypeTrigger, SceneGraph } from '@open-pencil/scene-graph'

import { findReaction } from './hit-test'
import { applyEasing, isSmartAnimate } from './transitions'
import type { PresentResult, PresentState } from './types'

/** Instant and unsupported Smart Animate both skip the transition clock. */
function shouldAnimate(action: Extract<PrototypeAction, { transition: unknown }>): boolean {
  return (
    action.transition.type !== 'instant' &&
    !isSmartAnimate(action.transition.type) &&
    action.transition.duration > 0
  )
}

export function startPresent(startFrameId: string): PresentState {
  return { currentFrameId: startFrameId, overlayStack: [], history: [], transition: null }
}

function unchanged(state: PresentState): PresentResult {
  return { state, openUrl: null }
}

/** Jump straight to a frame without recording history — used by the flow picker. */
export function goToFrame(state: PresentState, frameId: string): PresentState {
  if (frameId === state.currentFrameId) return state
  return { currentFrameId: frameId, overlayStack: [], history: [], transition: null }
}

export function goBack(state: PresentState): PresentState {
  const previous = state.history.at(-1)
  if (previous === undefined) return state
  return {
    currentFrameId: previous,
    history: state.history.slice(0, -1),
    overlayStack: [],
    transition: null
  }
}

export function closeTopOverlay(state: PresentState): PresentState {
  if (state.overlayStack.length === 0) return state
  return { ...state, overlayStack: state.overlayStack.slice(0, -1) }
}

export function applyPrototypeAction(
  state: PresentState,
  action: PrototypeAction,
  now: number
): PresentResult {
  switch (action.type) {
    case 'NAVIGATE': {
      if (!action.targetId || action.targetId === state.currentFrameId) return unchanged(state)
      return unchanged({
        currentFrameId: action.targetId,
        overlayStack: [],
        history: [...state.history, state.currentFrameId],
        transition: shouldAnimate(action)
          ? {
              fromId: state.currentFrameId,
              toId: action.targetId,
              params: action.transition,
              progress: 0,
              startTime: now
            }
          : null
      })
    }
    case 'BACK':
      return unchanged(goBack(state))
    case 'CLOSE':
      return unchanged(closeTopOverlay(state))
    case 'OVERLAY': {
      if (!action.targetId) return unchanged(state)
      if (state.overlayStack.some((overlay) => overlay.frameId === action.targetId)) {
        return unchanged(state)
      }
      return unchanged({
        ...state,
        overlayStack: [
          ...state.overlayStack,
          {
            frameId: action.targetId,
            position: action.position,
            closeOnBackdrop: action.closeOnBackdrop
          }
        ]
      })
    }
    case 'OPEN_URL':
      return { state, openUrl: { url: action.url, newTab: action.newTab } }
    default:
      return unchanged(state)
  }
}

export function handleTrigger(
  state: PresentState,
  graph: SceneGraph,
  nodeId: string,
  trigger: PrototypeTrigger,
  now: number = performance.now()
): PresentResult {
  const node = graph.getNode(nodeId)
  if (!node) return unchanged(state)
  const reaction = findReaction(node, trigger)
  if (!reaction) return unchanged(state)
  return applyPrototypeAction(state, reaction.action, now)
}

/**
 * Recompute transition progress for the current animation frame. Returns the same state
 * object when nothing changed so hosts can skip re-rendering.
 */
export function advanceTransition(state: PresentState, now: number): PresentState {
  const transition = state.transition
  if (!transition) return state

  const raw = Math.min((now - transition.startTime) / transition.params.duration, 1)
  if (raw >= 1) return { ...state, transition: null }

  const progress = applyEasing(raw, transition.params.easing)
  if (progress === transition.progress) return state
  return { ...state, transition: { ...transition, progress } }
}
