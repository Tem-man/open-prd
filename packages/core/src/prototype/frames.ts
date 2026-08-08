import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

const PRESENTABLE_TYPES = new Set<SceneNode['type']>(['FRAME', 'COMPONENT', 'INSTANCE'])

/**
 * How far a frame may sit below the top of a row and still belong to it, as a fraction of its
 * own height. Screens laid out side by side are often nudged apart by a few pixels, and those
 * should not read as separate rows.
 */
const ROW_BAND_RATIO = 0.5

/** Reading order: rows from top to bottom, and frames within a row from left to right. */
function sortInFlowOrder(frames: SceneNode[]): SceneNode[] {
  const rows: SceneNode[][] = []
  let rowBottom = Number.NEGATIVE_INFINITY

  for (const frame of [...frames].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = frame.y < rowBottom ? rows.at(-1) : undefined
    if (row) {
      row.push(frame)
      continue
    }
    rows.push([frame])
    rowBottom = frame.y + Math.max(frame.height, 1) * ROW_BAND_RATIO
  }

  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x))
}

/** Top-level frames of a page, in flow order. These are the screens a prototype can show. */
export function listPresentableFrames(graph: SceneGraph, pageId: string): SceneNode[] {
  const page = graph.getNode(pageId)
  if (!page) return []
  const frames: SceneNode[] = []
  for (const childId of page.childIds) {
    const child = graph.getNode(childId)
    if (child && PRESENTABLE_TYPES.has(child.type)) frames.push(child)
  }
  return sortInFlowOrder(frames)
}

/**
 * Pick the frame a presentation should open on: the topmost-leftmost screen of the page.
 *
 * Incoming navigation links deliberately play no part. A bottom tab bar or a back button wired
 * to the home screen makes nearly every frame a navigation target, so "nothing navigates here"
 * says little about where a flow begins.
 */
export function findStartFrameId(graph: SceneGraph, pageId: string): string | null {
  return listPresentableFrames(graph, pageId)[0]?.id ?? null
}

/** Whether a page contains any prototype wiring at all. */
export function hasPrototypeReactions(graph: SceneGraph, pageId: string): boolean {
  const walk = (nodeId: string): boolean => {
    const node = graph.getNode(nodeId)
    if (!node) return false
    if (node.reactions.length > 0) return true
    return node.childIds.some(walk)
  }
  return walk(pageId)
}
