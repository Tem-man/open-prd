/**
 * Prototype interaction data attached to nodes via `SceneNode.reactions`.
 *
 * These are document-level types: they describe what a node reacts to and where it
 * navigates. The presentation runtime that consumes them lives in
 * `@open-pencil/core/prototype`.
 */

export type PrototypeTrigger = 'ON_CLICK' | 'ON_HOVER' | 'ON_HOVER_END' | 'AFTER_DELAY'

export type PrototypeTransitionType =
  | 'instant'
  | 'dissolve'
  | 'fade'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'slide-down'
  | 'push-left'
  | 'push-right'
  | 'push-up'
  | 'push-down'
  | 'smart'

export type PrototypeEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'spring'

export type PrototypeOverlayPosition =
  | 'center'
  | 'top'
  | 'bottom'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

export interface PrototypeTransition {
  type: PrototypeTransitionType
  /** Duration in milliseconds. */
  duration: number
  easing: PrototypeEasing
  /** Overrides `easing` when present. */
  easingCurve?: [number, number, number, number]
}

/**
 * Navigation targets are authored by frame name because JSX has no node ids at author
 * time. `targetId` is filled in by a post-render resolution pass and stays `null` when
 * the name does not match any node.
 */
export interface PrototypeTarget {
  targetName: string
  targetId: string | null
}

export type PrototypeAction =
  | ({ type: 'NAVIGATE'; transition: PrototypeTransition } & PrototypeTarget)
  | { type: 'BACK'; transition: PrototypeTransition }
  | { type: 'CLOSE'; transition: PrototypeTransition }
  | ({
      type: 'OVERLAY'
      position: PrototypeOverlayPosition
      closeOnBackdrop: boolean
      transition: PrototypeTransition
    } & PrototypeTarget)
  | { type: 'OPEN_URL'; url: string; newTab: boolean }

export interface Reaction {
  id: string
  trigger: PrototypeTrigger
  /** Milliseconds to wait before firing. Only meaningful for `AFTER_DELAY`. */
  delay?: number
  action: PrototypeAction
}

export const DEFAULT_PROTOTYPE_DURATION = 300

export const DEFAULT_PROTOTYPE_TRANSITION: PrototypeTransition = {
  type: 'instant',
  duration: DEFAULT_PROTOTYPE_DURATION,
  easing: 'ease-out'
}

export function isPrototypeTargetAction(
  action: PrototypeAction
): action is Extract<PrototypeAction, PrototypeTarget> {
  return action.type === 'NAVIGATE' || action.type === 'OVERLAY'
}
