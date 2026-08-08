import type { PrototypeAction, Reaction, SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { isPrototypeTargetAction } from '@open-pencil/scene-graph'

function pageIdOf(graph: SceneGraph, node: SceneNode): string | null {
  let current: SceneNode | undefined = node
  while (current) {
    if (current.type === 'CANVAS') return current.id
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return null
}

/**
 * Name lookup for navigation targets. Top-level frames win over nested nodes with the same
 * name because that is what authors mean by a screen name.
 */
function register(index: Map<string, string>, name: string, id: string, topLevel: boolean): void {
  if (topLevel || !index.has(name)) index.set(name, id)
}

function buildNameIndex(graph: SceneGraph) {
  const byPage = new Map<string, Map<string, string>>()
  const global = new Map<string, string>()

  for (const node of graph.getAllNodes()) {
    if (!node.name || node.type === 'CANVAS' || node.id === graph.rootId) continue
    const parent = node.parentId ? graph.getNode(node.parentId) : undefined
    const topLevel = parent?.type === 'CANVAS'
    register(global, node.name, node.id, topLevel)

    const pageId = pageIdOf(graph, node)
    if (!pageId) continue
    let page = byPage.get(pageId)
    if (!page) {
      page = new Map<string, string>()
      byPage.set(pageId, page)
    }
    register(page, node.name, node.id, topLevel)
  }

  return { byPage, global }
}

function resolveAction(
  action: PrototypeAction,
  lookup: (name: string) => string | undefined
): PrototypeAction {
  if (!isPrototypeTargetAction(action)) return action
  const targetId = lookup(action.targetName) ?? null
  if (targetId === action.targetId) return action
  return { ...action, targetId }
}

/**
 * Fill in `targetId` for every reaction whose `targetName` matches a node.
 *
 * JSX authors reference frames by name because node ids only exist after rendering, so this
 * runs once the whole tree is materialized. It is idempotent and safe to re-run whenever
 * frames are renamed or added.
 *
 * @returns how many nodes were updated.
 */
export function resolveReactionTargets(graph: SceneGraph): number {
  const reactive: SceneNode[] = []
  for (const node of graph.getAllNodes()) {
    if (node.reactions.length > 0) reactive.push(node)
  }
  if (reactive.length === 0) return 0

  const { byPage, global } = buildNameIndex(graph)
  let updated = 0

  for (const node of reactive) {
    const pageId = pageIdOf(graph, node)
    const page = pageId ? byPage.get(pageId) : undefined
    const lookup = (name: string) => page?.get(name) ?? global.get(name)

    let changed = false
    const reactions: Reaction[] = node.reactions.map((reaction) => {
      const action = resolveAction(reaction.action, lookup)
      if (action === reaction.action) return reaction
      changed = true
      return { ...reaction, action }
    })

    if (!changed) continue
    graph.updateNode(node.id, { reactions })
    updated += 1
  }

  return updated
}
