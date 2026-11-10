import type { SceneGraph } from '../index'
import type { Vector } from '../primitives'
import type { SceneNode } from '../types'
import type { CommentThread, CommentAuthor, CommentReply } from './schema'

function newCommentId(prefix: 'c' | 'r'): string {
  // Made of crypto directly: the crypto hex helper lives in `#core/random`, and this engine
  // package cannot depend on core. Same shape as the upstream comment ids.
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return `${prefix}_${hex}`
}

/** When a comment is written or changed, as stored: an ISO timestamp. */
export function commentTimestamp(): string {
  return new Date().toISOString()
}

/** Oldest first, the order threads and replies are shown and numbered in. */
export function byCreatedAt(a: { createdAt: string }, b: { createdAt: string }): number {
  return a.createdAt.localeCompare(b.createdAt)
}

/** A thread's replies, without the deleted ones kept as tombstones. */
export function liveReplies(thread: CommentThread): CommentReply[] {
  return thread.replies.filter((entry) => !entry.deleted)
}

/** Whether `author` started the thread or replied to it, as "Only my threads" counts. */
export function takesPartInThread(thread: CommentThread, author: string): boolean {
  return thread.author === author || liveReplies(thread).some((entry) => entry.author === author)
}

/** The thread with `id`, unless it is missing or deleted. */
export function findLiveCommentThread(
  threads: readonly CommentThread[],
  id: string
): CommentThread | undefined {
  return threads.find((thread) => thread.id === id && !thread.deleted)
}

/**
 * The top-level layer for a comment on `node`: the layer whose parent is the page, or within a
 * section the section's own child, as comments attach comments. Walks up the parent chain with a
 * cycle guard instead of a graph helper, so the comment module stays self-contained.
 */
function commentLayer(graph: SceneGraph, node: SceneNode, pageId: string): SceneNode {
  const isSection = (id: string | null) => !!id && graph.getNode(id)?.type === 'SECTION'
  let current: SceneNode | undefined = node
  const visited = new Set<string>([node.id])
  while (current) {
    const parentId = current.parentId
    if (parentId === pageId || isSection(parentId)) return current
    if (parentId === null) return node
    const parent = graph.getNode(parentId)
    if (!parent || visited.has(parent.id)) return node
    visited.add(parent.id)
    current = parent
  }
  return node
}

/**
 * Where a pin at a canvas point is kept: on the top-level layer under it, or on `node`'s when
 * given, so it follows that layer; on the canvas when nothing is there.
 */
export function commentAnchor(graph: SceneGraph, pageId: string, at: Vector, node?: SceneNode) {
  const target = node ?? graph.hitTest(at.x, at.y, pageId)
  const layer = target ? commentLayer(graph, target, pageId) : null
  const abs = layer ? graph.getAbsolutePosition(layer.id) : null
  return {
    nodeId: layer?.id ?? null,
    nodeName: layer?.name ?? null,
    offsetX: abs ? at.x - abs.x : 0,
    offsetY: abs ? at.y - abs.y : 0,
    x: at.x,
    y: at.y
  }
}

/** Where a thread's pin is now: on its layer while that layer exists, else where it was left. */
export function commentPosition(graph: SceneGraph, thread: CommentThread): Vector {
  const node = thread.nodeId ? graph.getNode(thread.nodeId) : undefined
  if (!node) return { x: thread.x, y: thread.y }
  const abs = graph.getAbsolutePosition(node.id)
  return { x: abs.x + (thread.offsetX ?? 0), y: abs.y + (thread.offsetY ?? 0) }
}

/** A new thread pinned at a canvas point of a page. */
export function createCommentThread(
  graph: SceneGraph,
  options: {
    pageId: string
    at: Vector
    /** Pin it on this layer's top-level layer rather than on whatever is at `at`. */
    node?: SceneNode
    author: CommentAuthor
    text: string
    now: string
  }
): CommentThread {
  const { pageId, at, node, author, text, now } = options
  return {
    id: newCommentId('c'),
    pageId,
    pageName: graph.getNode(pageId)?.name,
    ...commentAnchor(graph, pageId, at, node),
    author: author.name,
    authorColor: author.color,
    text,
    createdAt: now,
    updatedAt: now,
    resolved: false,
    replies: []
  }
}

export function createCommentReply(author: CommentAuthor, text: string, now: string): CommentReply {
  return {
    id: newCommentId('r'),
    author: author.name,
    authorColor: author.color,
    text,
    createdAt: now
  }
}

/** The threads with one changed and marked as edited at `now`, for keeping track of edits. */
export function editCommentThread(
  threads: readonly CommentThread[],
  id: string,
  now: string,
  edit: (thread: CommentThread) => CommentThread
): CommentThread[] {
  return threads.map((thread) => (thread.id === id ? { ...edit(thread), updatedAt: now } : thread))
}

/** A reply ends up in the thread and reopens it, as answering a resolved comment does. */
export function replyToCommentThread(thread: CommentThread, reply: CommentReply): CommentThread {
  return { ...thread, resolved: false, resolvedAt: null, replies: [...thread.replies, reply] }
}

export function resolveCommentThread(
  thread: CommentThread,
  resolved: boolean,
  now: string
): CommentThread {
  return { ...thread, resolved, resolvedAt: resolved ? now : null }
}

/** Deleted threads and replies stay as tombstones, so a stale copy cannot bring them back. */
export function deleteCommentThread(thread: CommentThread): CommentThread {
  return { ...thread, deleted: true }
}

export function deleteCommentReply(thread: CommentThread, replyId: string): CommentThread {
  return {
    ...thread,
    replies: thread.replies.map((entry) => (entry.id === replyId ? { ...entry, deleted: true } : entry))
  }
}
