import type { PrototypeOverlayPosition, PrototypeTransition, Reaction } from '@open-pencil/scene-graph'

export interface PresentOverlay {
  frameId: string
  position: PrototypeOverlayPosition
  closeOnBackdrop: boolean
}

export interface PresentTransition {
  fromId: string
  toId: string
  params: PrototypeTransition
  /** Eased 0-1 value the host uses to interpolate frame styles. */
  progress: number
  startTime: number
}

/** Immutable snapshot of the presentation runtime. Engine functions never mutate it. */
export interface PresentState {
  currentFrameId: string
  overlayStack: PresentOverlay[]
  /** Frames visited before the current one. `BACK` pops from the end. */
  history: string[]
  transition: PresentTransition | null
}

/**
 * External link requests are returned to the host instead of being performed in core,
 * which has no DOM access.
 */
export interface PresentOpenUrl {
  url: string
  newTab: boolean
}

export interface PresentResult {
  state: PresentState
  openUrl: PresentOpenUrl | null
}

export interface DelayedReaction {
  nodeId: string
  delay: number
  reaction: Reaction
}
