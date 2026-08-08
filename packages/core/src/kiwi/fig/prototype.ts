import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { guidToString } from '@open-pencil/kiwi/fig/guid'
import type { FigReactionTarget } from '@open-pencil/fig/node-change'
import {
  prototypeInteractionsToReactions,
  readOverlayTargetFields
} from '@open-pencil/fig/node-change'
import type { SceneGraph } from '@open-pencil/scene-graph'
import type { GUID } from '@open-pencil/scene-graph/primitives'

/**
 * Rebuild `SceneNode.reactions` from Kiwi prototype interactions.
 *
 * This runs once the tree exists: interactions address their targets by GUID, and the overlay
 * presentation a reaction needs is stored on the target frame rather than on the hotspot.
 * Instance children materialized later by the lazy import path are not covered.
 */
export function importPrototypeInteractions(
  graph: SceneGraph,
  changeMap: ReadonlyMap<string, NodeChange>,
  guidToNodeId: ReadonlyMap<string, string>
): void {
  const resolveTarget = (guid: GUID): FigReactionTarget | null => {
    const ncId = guidToString(guid)
    const nodeId = guidToNodeId.get(ncId)
    const target = nodeId ? graph.getNode(nodeId) : undefined
    if (!target) return null
    const overlay = readOverlayTargetFields(changeMap.get(ncId))
    return { id: target.id, name: target.name, ...(overlay ? { overlay } : {}) }
  }

  for (const [ncId, nodeId] of guidToNodeId) {
    const interactions = changeMap.get(ncId)?.prototypeInteractions
    if (!interactions) continue
    const reactions = prototypeInteractionsToReactions(interactions, resolveTarget)
    if (reactions.length > 0) graph.updateNode(nodeId, { reactions })
  }
}
