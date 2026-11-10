import type { SceneGraph } from '../index'
import type { PluginDataEntry } from '../types'
import { parseCommentThreads, type CommentThread } from './schema'

/**
 * OpenPencil's plugin-data namespace, as `packages/fig/src/node-change/plugin-data.ts` writes it
 * into `.fig` files; comment threads are one entry under this plugin id.
 */
export const OPEN_PENCIL_PLUGIN_ID = 'open-pencil'

/** The plugin-data key on the document node that holds the comment threads list. */
export const COMMENTS_PLUGIN_KEY = 'comments'

function findCommentsEntry(
  pluginData: readonly PluginDataEntry[] | undefined
): PluginDataEntry | undefined {
  return pluginData?.find(
    (entry) =>
      entry.pluginId === OPEN_PENCIL_PLUGIN_ID &&
      entry.key === COMMENTS_PLUGIN_KEY &&
      typeof entry.value === 'string'
  )
}

/**
 * A document's comment threads, deleted ones included. Comments are part of the document: they
 * live in plugin data on the document node, so they travel with the `.fig` file and its storage
 * copy, and Figma or an older version opens the file as before.
 */
export function readComments(graph: SceneGraph): CommentThread[] {
  const root = graph.getNode(graph.rootId)
  if (!root) return []
  const entry = findCommentsEntry(root.pluginData)
  if (!entry) return []
  let raw: unknown
  try {
    raw = JSON.parse(entry.value) as unknown
  } catch {
    return []
  }
  return Array.isArray(raw) ? parseCommentThreads(raw) : []
}

/**
 * Stores the threads on the document node. This is a document change, so the document asks to be
 * saved, but not an undo step: undoing a layer edit never takes back a comment. The write is an
 * ordinary `updateNode`, so no undo entry is created behind this module's back.
 */
export function writeComments(graph: SceneGraph, threads: readonly CommentThread[]): void {
  const root = graph.getNode(graph.rootId)
  if (!root) return
  const kept: PluginDataEntry[] = (root.pluginData ?? []).filter(
    (entry) => !(entry.pluginId === OPEN_PENCIL_PLUGIN_ID && entry.key === COMMENTS_PLUGIN_KEY)
  )
  if (threads.length > 0) {
    kept.push({
      pluginId: OPEN_PENCIL_PLUGIN_ID,
      key: COMMENTS_PLUGIN_KEY,
      value: JSON.stringify(threads)
    })
  }
  graph.updateNode(root.id, { pluginData: kept })
}
