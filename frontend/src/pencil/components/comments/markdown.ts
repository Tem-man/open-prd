import { Marked } from 'marked'

/**
 * A comment's Markdown as HTML fragments for the message body: Figma's comment subset (bold,
 * italic, strikethrough, links, ordered and unordered lists). The shell has no markdown
 * renderer, so comments render through `marked` here instead of upstream's `MarkdownContent`.
 *
 * Rendering escapes the text first, so comments only contain their Markdown, not HTML; link
 * addresses are then restricted to web and mail URLs, with external links flagged.
 */

// Single newlines break lines, as commenting does, and wise quotes stay literal.
const instance = new Marked({ breaks: true })

const ALLOWED_LINK_PROTOCOLS = /^(https?:|mailto:)/i

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** Renders a comment's text to an HTML fragment. Input comes from the document's own comments. */
export function renderCommentMarkdown(text: string): string {
  const html = instance.parse(escapeHtml(text), { async: false })
  // Restrict link addresses and tag external ones; comments are the only input.
  return html.replaceAll(/<a href="([^"]*)"/gu, (match: string, href: string) =>
    ALLOWED_LINK_PROTOCOLS.test(href)
      ? `${match} target="_blank" rel="noopener noreferrer"`
      : '<a href="#">'
  )
}
