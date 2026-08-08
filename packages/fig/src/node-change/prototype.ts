import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { DEFAULT_PROTOTYPE_DURATION } from '@open-pencil/scene-graph'
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
import type { GUID } from '@open-pencil/scene-graph/primitives'

/**
 * Prototype interactions in `.fig`.
 *
 * Kiwi keeps a hotspot's wiring in `NodeChange.prototypeInteractions`, but an overlay's
 * presentation — where it sits and whether the backdrop closes it — lives on the overlay frame
 * instead. `SceneNode.reactions` holds both, so the two halves are mapped separately.
 *
 * Reaction ids are not carried across: Kiwi identifies interactions by GUID and nothing in a
 * document points at a reaction id, so ids are regenerated on import.
 */

/** Kiwi stores durations in seconds; reactions use milliseconds. */
const MS_PER_SECOND = 1000

const TRIGGER_TO_FIG: Record<PrototypeTrigger, string> = {
  ON_CLICK: 'ON_CLICK',
  // Kiwi's ON_HOVER means "while hovering"; entering and leaving are separate events.
  ON_HOVER: 'MOUSE_ENTER',
  ON_HOVER_END: 'MOUSE_LEAVE',
  AFTER_DELAY: 'AFTER_TIMEOUT'
}

const FIG_TO_TRIGGER: Record<string, PrototypeTrigger | undefined> = {
  ON_CLICK: 'ON_CLICK',
  MOUSE_ENTER: 'ON_HOVER',
  MOUSE_IN: 'ON_HOVER',
  ON_HOVER: 'ON_HOVER',
  MOUSE_LEAVE: 'ON_HOVER_END',
  MOUSE_OUT: 'ON_HOVER_END',
  AFTER_TIMEOUT: 'AFTER_DELAY'
}

/**
 * Our transition names say where the incoming frame comes *from* the viewer's perspective
 * (`slide-left` slides the new frame in from the right edge), while Kiwi names the edge the
 * frame starts at. The two therefore cross over.
 */
const TRANSITION_TO_FIG: Record<PrototypeTransitionType, string> = {
  instant: 'INSTANT_TRANSITION',
  dissolve: 'DISSOLVE',
  fade: 'FADE',
  'slide-left': 'SLIDE_FROM_RIGHT',
  'slide-right': 'SLIDE_FROM_LEFT',
  'slide-up': 'SLIDE_FROM_BOTTOM',
  'slide-down': 'SLIDE_FROM_TOP',
  'push-left': 'PUSH_FROM_RIGHT',
  'push-right': 'PUSH_FROM_LEFT',
  'push-up': 'PUSH_FROM_BOTTOM',
  'push-down': 'PUSH_FROM_TOP',
  // Smart Animate is not implemented, so it is stored as the instant transition it behaves as.
  smart: 'INSTANT_TRANSITION'
}

const FIG_TO_TRANSITION: Record<string, PrototypeTransitionType | undefined> = {
  INSTANT_TRANSITION: 'instant',
  DISSOLVE: 'dissolve',
  FADE: 'fade',
  SLIDE_FROM_RIGHT: 'slide-left',
  SLIDE_FROM_LEFT: 'slide-right',
  SLIDE_FROM_BOTTOM: 'slide-up',
  SLIDE_FROM_TOP: 'slide-down',
  PUSH_FROM_RIGHT: 'push-left',
  PUSH_FROM_LEFT: 'push-right',
  PUSH_FROM_BOTTOM: 'push-up',
  PUSH_FROM_TOP: 'push-down'
}

const EASING_TO_FIG: Record<PrototypeEasing, string> = {
  linear: 'LINEAR',
  'ease-in': 'IN_CUBIC',
  'ease-out': 'OUT_CUBIC',
  'ease-in-out': 'INOUT_CUBIC',
  spring: 'GENTLE_SPRING'
}

const FIG_TO_EASING: Record<string, PrototypeEasing | undefined> = {
  LINEAR: 'linear',
  IN_CUBIC: 'ease-in',
  OUT_CUBIC: 'ease-out',
  INOUT_CUBIC: 'ease-in-out',
  SPRING: 'spring',
  GENTLE_SPRING: 'spring',
  CUSTOM_SPRING: 'spring'
}

const OVERLAY_POSITION_TO_FIG: Record<PrototypeOverlayPosition, string> = {
  center: 'CENTER',
  top: 'TOP_CENTER',
  bottom: 'BOTTOM_CENTER',
  'top-left': 'TOP_LEFT',
  'top-right': 'TOP_RIGHT',
  'bottom-left': 'BOTTOM_LEFT',
  'bottom-right': 'BOTTOM_RIGHT'
}

const FIG_TO_OVERLAY_POSITION: Record<string, PrototypeOverlayPosition | undefined> = {
  CENTER: 'center',
  TOP_CENTER: 'top',
  BOTTOM_CENTER: 'bottom',
  TOP_LEFT: 'top-left',
  TOP_RIGHT: 'top-right',
  BOTTOM_LEFT: 'bottom-left',
  BOTTOM_RIGHT: 'bottom-right'
}

export interface FigPrototypeEvent {
  interactionType: string
  transitionTimeout?: number
}

export interface FigPrototypeAction {
  connectionType: string
  navigationType?: string
  transitionNodeID?: GUID
  transitionType?: string
  transitionDuration?: number
  easingType?: string
  easingFunction?: number[]
  connectionURL?: string
  openUrlInNewTab?: boolean
}

export interface FigPrototypeInteraction {
  event: FigPrototypeEvent
  actions: FigPrototypeAction[]
}

/** Overlay presentation as Kiwi stores it: on the overlay frame, not on the hotspot. */
export interface FigOverlayTarget {
  position: PrototypeOverlayPosition
  closeOnBackdrop: boolean
}

/** What the importer has to know about a navigation target to rebuild a reaction. */
export interface FigReactionTarget {
  id: string
  name: string
  overlay?: FigOverlayTarget
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asGuid(value: unknown): GUID | null {
  const record = asRecord(value)
  if (!record) return null
  const { sessionID, localID } = record
  if (typeof sessionID !== 'number' || typeof localID !== 'number') return null
  return { sessionID, localID }
}

function asEasingCurve(value: unknown): PrototypeTransition['easingCurve'] {
  if (!Array.isArray(value)) return undefined
  const numbers = value.filter((entry): entry is number => typeof entry === 'number')
  if (numbers.length !== 4) return undefined
  return [numbers[0], numbers[1], numbers[2], numbers[3]]
}

type FigTransitionFields = Omit<FigPrototypeAction, 'connectionType'>

function transitionToFig(transition: PrototypeTransition): FigTransitionFields {
  const curve = transition.easingCurve
  return {
    transitionType: TRANSITION_TO_FIG[transition.type],
    transitionDuration: transition.duration / MS_PER_SECOND,
    easingType: curve ? 'CUSTOM_CUBIC' : EASING_TO_FIG[transition.easing],
    ...(curve ? { easingFunction: [...curve] } : {})
  }
}

function figToTransition(action: Record<string, unknown>): PrototypeTransition {
  const duration = action.transitionDuration
  const curve = asEasingCurve(action.easingFunction)
  return {
    type: FIG_TO_TRANSITION[asString(action.transitionType)] ?? 'instant',
    duration:
      typeof duration === 'number' ? duration * MS_PER_SECOND : DEFAULT_PROTOTYPE_DURATION,
    easing: FIG_TO_EASING[asString(action.easingType)] ?? 'ease-out',
    ...(curve ? { easingCurve: curve } : {})
  }
}

function actionToFig(
  action: PrototypeAction,
  resolveTargetGuid: (nodeId: string) => GUID | undefined
): FigPrototypeAction | null {
  switch (action.type) {
    case 'NAVIGATE':
    case 'OVERLAY': {
      // Kiwi addresses targets by GUID, so a reaction whose name never resolved to a node
      // cannot be expressed here at all.
      const guid = action.targetId ? resolveTargetGuid(action.targetId) : undefined
      if (!guid) return null
      return {
        connectionType: 'INTERNAL_NODE',
        navigationType: action.type === 'OVERLAY' ? 'OVERLAY' : 'NAVIGATE',
        transitionNodeID: guid,
        ...transitionToFig(action.transition)
      }
    }
    case 'BACK':
      return { connectionType: 'BACK', ...transitionToFig(action.transition) }
    case 'CLOSE':
      return { connectionType: 'CLOSE', ...transitionToFig(action.transition) }
    case 'OPEN_URL':
      return { connectionType: 'URL', connectionURL: action.url, openUrlInNewTab: action.newTab }
    default:
      return null
  }
}

function figToAction(
  raw: Record<string, unknown>,
  resolveTarget: (guid: GUID) => FigReactionTarget | null
): PrototypeAction | null {
  const connectionType = asString(raw.connectionType)
  if (connectionType === 'BACK') return { type: 'BACK', transition: figToTransition(raw) }
  if (connectionType === 'CLOSE') return { type: 'CLOSE', transition: figToTransition(raw) }
  if (connectionType === 'URL') {
    const url = asString(raw.connectionURL)
    if (!url) return null
    return { type: 'OPEN_URL', url, newTab: raw.openUrlInNewTab !== false }
  }
  if (connectionType !== 'INTERNAL_NODE') return null

  const guid = asGuid(raw.transitionNodeID)
  const target = guid ? resolveTarget(guid) : null
  if (!target) return null

  const transition = figToTransition(raw)
  if (asString(raw.navigationType) !== 'OVERLAY') {
    return { type: 'NAVIGATE', targetName: target.name, targetId: target.id, transition }
  }
  return {
    type: 'OVERLAY',
    targetName: target.name,
    targetId: target.id,
    position: target.overlay?.position ?? 'center',
    closeOnBackdrop: target.overlay?.closeOnBackdrop ?? true,
    transition
  }
}

/**
 * Collect overlay presentation keyed by the overlay frame's node id.
 *
 * It is authored on the hotspot but has to be written on the frame being opened, which may be
 * serialized before the hotspot is reached.
 */
export function buildOverlayTargetIndex(
  nodes: Iterable<SceneNode>
): Map<string, FigOverlayTarget> {
  const index = new Map<string, FigOverlayTarget>()
  for (const node of nodes) {
    for (const { action } of node.reactions) {
      if (action.type !== 'OVERLAY' || !action.targetId) continue
      // Kiwi has one slot per overlay frame, so the first hotspot to claim it wins.
      if (index.has(action.targetId)) continue
      index.set(action.targetId, {
        position: action.position,
        closeOnBackdrop: action.closeOnBackdrop
      })
    }
  }
  return index
}

export function writeOverlayTargetFields(target: FigOverlayTarget, nc: NodeChange): void {
  nc.overlayPositionType = OVERLAY_POSITION_TO_FIG[target.position]
  nc.overlayBackgroundInteraction = target.closeOnBackdrop ? 'CLOSE_ON_CLICK_OUTSIDE' : 'NONE'
}

export function readOverlayTargetFields(nc: NodeChange | undefined): FigOverlayTarget | undefined {
  const position = FIG_TO_OVERLAY_POSITION[asString(nc?.overlayPositionType)]
  if (!position) return undefined
  return { position, closeOnBackdrop: asString(nc?.overlayBackgroundInteraction) !== 'NONE' }
}

/** Reactions that cannot be addressed by GUID are skipped rather than written half-formed. */
export function reactionsToPrototypeInteractions(
  reactions: readonly Reaction[],
  resolveTargetGuid: (nodeId: string) => GUID | undefined
): FigPrototypeInteraction[] {
  const interactions: FigPrototypeInteraction[] = []
  for (const reaction of reactions) {
    const action = actionToFig(reaction.action, resolveTargetGuid)
    if (!action) continue
    const event: FigPrototypeEvent = { interactionType: TRIGGER_TO_FIG[reaction.trigger] }
    if (reaction.trigger === 'AFTER_DELAY') {
      event.transitionTimeout = (reaction.delay ?? 0) / MS_PER_SECOND
    }
    interactions.push({ event, actions: [action] })
  }
  return interactions
}

/** Interactions using triggers or actions the editor does not model are dropped. */
export function prototypeInteractionsToReactions(
  raw: unknown,
  resolveTarget: (guid: GUID) => FigReactionTarget | null
): Reaction[] {
  if (!Array.isArray(raw)) return []

  const reactions: Reaction[] = []
  for (const entry of raw) {
    const interaction = asRecord(entry)
    if (!interaction || interaction.isDeleted === true) continue

    const event = asRecord(interaction.event)
    const trigger = FIG_TO_TRIGGER[asString(event?.interactionType)]
    if (!trigger) continue

    const first = Array.isArray(interaction.actions) ? asRecord(interaction.actions[0]) : null
    if (!first) continue
    const action = figToAction(first, resolveTarget)
    if (!action) continue

    const reaction: Reaction = { id: `fig-${reactions.length}`, trigger, action }
    if (trigger === 'AFTER_DELAY') {
      const timeout = event?.transitionTimeout
      reaction.delay = typeof timeout === 'number' ? timeout * MS_PER_SECOND : 0
    }
    reactions.push(reaction)
  }
  return reactions
}
