import type {
  PrototypeAction,
  PrototypeEasing,
  PrototypeOverlayPosition,
  PrototypeTransition,
  PrototypeTransitionType,
  PrototypeTrigger,
  Reaction,
  SceneNode
} from '@open-pencil/scene-graph'
import { DEFAULT_PROTOTYPE_DURATION } from '@open-pencil/scene-graph'

import { randomHex } from '#core/random'

/** Supported CSS/frame transitions. `smart` is reserved for a future Smart Animate path. */
const TRANSITION_TYPES = new Set<string>([
  'instant',
  'dissolve',
  'fade',
  'slide-left',
  'slide-right',
  'slide-up',
  'slide-down',
  'push-left',
  'push-right',
  'push-up',
  'push-down'
])

const EASINGS = new Set<string>(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'spring'])

const OVERLAY_POSITIONS = new Set<string>([
  'center',
  'top',
  'bottom',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right'
])

const TRIGGER_PROPS: Array<[string, PrototypeTrigger]> = [
  ['onClick', 'ON_CLICK'],
  ['onHover', 'ON_HOVER'],
  ['onHoverEnd', 'ON_HOVER_END']
]

function parseTransition(raw: Record<string, unknown>): PrototypeTransition {
  const type = raw.transition
  const easing = raw.easing
  const duration = raw.duration
  return {
    type:
      typeof type === 'string' && TRANSITION_TYPES.has(type)
        ? (type as PrototypeTransitionType)
        : 'instant',
    duration: typeof duration === 'number' && duration >= 0 ? duration : DEFAULT_PROTOTYPE_DURATION,
    easing:
      typeof easing === 'string' && EASINGS.has(easing) ? (easing as PrototypeEasing) : 'ease-out'
  }
}

function parseOverlayPosition(value: unknown): PrototypeOverlayPosition {
  return typeof value === 'string' && OVERLAY_POSITIONS.has(value)
    ? (value as PrototypeOverlayPosition)
    : 'center'
}

function parseAction(raw: Record<string, unknown>): PrototypeAction | null {
  if (typeof raw.navigate === 'string' && raw.navigate.length > 0) {
    return {
      type: 'NAVIGATE',
      targetName: raw.navigate,
      targetId: null,
      transition: parseTransition(raw)
    }
  }
  if (typeof raw.overlay === 'string' && raw.overlay.length > 0) {
    return {
      type: 'OVERLAY',
      targetName: raw.overlay,
      targetId: null,
      position: parseOverlayPosition(raw.position),
      closeOnBackdrop: raw.closeOnBackdrop !== false,
      transition: parseTransition(raw)
    }
  }
  if (typeof raw.url === 'string' && raw.url.length > 0) {
    return { type: 'OPEN_URL', url: raw.url, newTab: raw.newTab !== false }
  }
  if (raw.back === true) return { type: 'BACK', transition: parseTransition(raw) }
  if (raw.close === true) return { type: 'CLOSE', transition: parseTransition(raw) }
  return null
}

/** `onClick="HomeScreen"` is accepted as shorthand for `onClick={{ navigate: 'HomeScreen' }}`. */
function parseActionProp(value: unknown): PrototypeAction | null {
  if (typeof value === 'string') return parseAction({ navigate: value })
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return parseAction(value as Record<string, unknown>)
}

function reaction(trigger: PrototypeTrigger, action: PrototypeAction, delay?: number): Reaction {
  return { id: `r${randomHex(8)}`, trigger, ...(delay === undefined ? {} : { delay }), action }
}

/**
 * Translate JSX interaction props into `SceneNode.reactions`.
 *
 * Navigation targets stay as names here; `resolveReactionTargets()` fills in node ids once
 * every frame in the render has been created.
 */
export function applyReactionOverrides(
  props: Record<string, unknown>,
  o: Partial<SceneNode>
): void {
  const reactions: Reaction[] = []

  for (const [propKey, trigger] of TRIGGER_PROPS) {
    const action = parseActionProp(props[propKey])
    if (action) reactions.push(reaction(trigger, action))
  }

  const afterDelay = props.afterDelay
  if (typeof afterDelay === 'number' && afterDelay >= 0) {
    const action = parseActionProp(props.do)
    if (action) reactions.push(reaction('AFTER_DELAY', action, afterDelay))
  }

  if (reactions.length > 0) o.reactions = reactions
}
