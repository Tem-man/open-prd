import type { PrototypeTrigger, Reaction, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { DelayedReaction } from './types'

export function findReaction(node: SceneNode, trigger: PrototypeTrigger): Reaction | undefined {
  return node.reactions.find((reaction) => reaction.trigger === trigger)
}

function hasAnyTrigger(node: SceneNode, triggers: readonly PrototypeTrigger[]): boolean {
  return node.reactions.some((reaction) => triggers.includes(reaction.trigger))
}

/**
 * Resolve a pointer position inside a presented frame to the node whose reaction should
 * fire. Coordinates are frame-local, matching how the presenter draws frames.
 *
 * Reuses the scene graph hit test so rotation, clipping, and empty-container rules match
 * the editor, then walks ancestors up to the frame because the visually topmost node is
 * usually a decorative child of the interactive one (a label inside a button).
 *
 * Several triggers can be requested at once so a single hit test can drive both hover state
 * and cursor feedback.
 */
export function findReactionNode(
  graph: SceneGraph,
  frameId: string,
  localX: number,
  localY: number,
  triggers: readonly PrototypeTrigger[]
): SceneNode | null {
  const frame = graph.getNode(frameId)
  if (!frame) return null
  if (localX < 0 || localY < 0 || localX > frame.width || localY > frame.height) return null

  const origin = graph.getAbsolutePosition(frameId)
  let candidate = graph.hitTestDeep(origin.x + localX, origin.y + localY, frameId) ?? frame

  while (!hasAnyTrigger(candidate, triggers)) {
    if (candidate.id === frame.id) return null
    const parent = candidate.parentId ? graph.getNode(candidate.parentId) : undefined
    if (!parent) return null
    candidate = parent
  }
  return candidate
}

/** All `AFTER_DELAY` reactions inside a frame subtree, used to arm timers on frame entry. */
export function collectDelayedReactions(graph: SceneGraph, frameId: string): DelayedReaction[] {
  const found: DelayedReaction[] = []

  const walk = (nodeId: string) => {
    const node = graph.getNode(nodeId)
    if (!node?.visible) return
    for (const reaction of node.reactions) {
      if (reaction.trigger !== 'AFTER_DELAY') continue
      found.push({ nodeId: node.id, delay: reaction.delay ?? 0, reaction })
    }
    for (const childId of node.childIds) {
      walk(childId)
    }
  }

  walk(frameId)
  return found
}
