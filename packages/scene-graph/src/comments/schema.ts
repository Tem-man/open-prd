import type { Color } from '../primitives'

/**
 * Who writes a comment: their name and, in a collaboration room, their color.
 */
export interface CommentAuthor {
  name: string
  color?: Color
}

/** A reply in a canvas comment thread. */
export interface CommentReply {
  id: string
  author: string
  authorColor?: Color
  /** Markdown: bold, italic, strikethrough, links and lists. */
  text: string
  createdAt: string
  deleted?: boolean
}

/** A canvas comment thread, kept in the document's root plugin data. */
export interface CommentThread {
  id: string
  pageId: string
  /** Page name when the pin was placed, for readers of the raw data. */
  pageName?: string
  /** Top-level layer under the pin; the pin follows it when it moves. */
  nodeId?: string | null
  nodeName?: string | null
  /** Offset from the layer's top-left corner, in canvas units. */
  offsetX?: number
  offsetY?: number
  /** Canvas position when the pin was last saved; used when the layer is gone. */
  x: number
  y: number
  author: string
  authorColor?: Color
  /** Markdown: bold, italic, strikethrough, links and links. */
  text: string
  createdAt: string
  /** Bumped on every change. */
  updatedAt: string
  resolved: boolean
  resolvedAt?: string | null
  /** Deleted threads stay as tombstones so a stale copy cannot bring them back. */
  deleted?: boolean
  replies: CommentReply[]
}

/** Valibot-like lenient reader: missing fields fall back, malformed entries are skipped. */
export type ThreadLike = unknown

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function string(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function color(value: unknown): Color | undefined {
  if (!isPlainObject(value)) return undefined
  const { r, g, b, a } = value
  if (![r, g, b, a].every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined
  return { r, g, b, a } as Color
}

/**
 * Lenient on purpose: other tools may write comments, so missing fields get defaults and one
 * malformed thread is skipped instead of hiding every comment.
 * A list of comment threads as files and rooms hold them; threads that cannot be read are left out.
 */
export function parseCommentThreads(items: readonly unknown[]): CommentThread[] {
  const threads: CommentThread[] = []
  for (const item of items) {
    if (!isPlainObject(item)) continue
    const rawReplies = Array.isArray(item.replies) ? item.replies : []
    const replies: CommentReply[] = []
    for (const rawReply of rawReplies) {
      if (!isPlainObject(rawReply)) continue
      if (typeof rawReply.id !== 'string' || rawReply.id === '') continue
      replies.push({
        id: rawReply.id,
        author: string(rawReply.author, ''),
        ...(color(rawReply.authorColor) ? { authorColor: color(rawReply.authorColor) } : {}),
        text: string(rawReply.text, ''),
        createdAt: string(rawReply.createdAt, ''),
        ...(optionalBoolean(rawReply.deleted) ? { deleted: optionalBoolean(rawReply.deleted) } : {})
      })
    }
    if (typeof item.id !== 'string' || item.id === '') continue
    if (typeof item.pageId !== 'string' || item.pageId === '') continue
    const createdAt = string(item.createdAt, '')
    threads.push({
      id: item.id,
      pageId: item.pageId,
      ...(optionalString(item.pageName) ? { pageName: optionalString(item.pageName) } : {}),
      nodeId: typeof item.nodeId === 'string' && item.nodeId !== '' ? item.nodeId : null,
      nodeName: typeof item.nodeName === 'string' && item.nodeName !== '' ? item.nodeName : null,
      offsetX: typeof item.offsetX === 'number' && Number.isFinite(item.offsetX) ? item.offsetX : undefined,
      offsetY: typeof item.offsetY === 'number' && Number.isFinite(item.offsetY) ? item.offsetY : undefined,
      x: number(item.x, 0),
      y: number(item.y, 0),
      author: string(item.author, ''),
      ...(color(item.authorColor) ? { authorColor: color(item.authorColor) } : {}),
      text: string(item.text, ''),
      createdAt,
      updatedAt: string(item.updatedAt, '') || createdAt,
      resolved: boolean(item.resolved, false),
      resolvedAt: optionalString(item.resolvedAt) ?? null,
      ...(optionalBoolean(item.deleted) ? { deleted: optionalBoolean(item.deleted) } : {}),
      replies
    })
  }
  return threads
}
