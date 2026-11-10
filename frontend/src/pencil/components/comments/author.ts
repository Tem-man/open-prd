import type { Color } from '@open-pencil/scene-graph/primitives'

import { useCommentMessages } from '@open-pencil/vue'

import { AUTHOR_COLORS } from '@/app/comments/identity'

/**
 * How a comment's author is shown: their name, or "Someone" for comments other tools wrote
 * without one, on the color they had, or the first author color as upstream guests do.
 */
export function useCommentAuthor() {
  const messages = useCommentMessages()
  return {
    name: (author: string) => author || messages.value.someone,
    color: (color: Color | undefined): Color => color ?? AUTHOR_COLORS[0]
  }
}
