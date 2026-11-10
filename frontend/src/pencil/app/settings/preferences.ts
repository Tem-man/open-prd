import { useLocalStorage } from '@vueuse/core'
import { computed } from 'vue'

import type { CommentSort } from '@open-pencil/scene-graph/comments'

/**
 * One user's comment list and canvas settings. Upstream keeps these in its app-wide
 * preferences tree; open-prd has no preferences interface yet, so the comments section stands
 * alone in its own record until more of that system is migrated.
 */
export interface CommentPreferences {
  /** Whether pins show on the canvas outside the Comment tool itself. */
  showOnCanvas: boolean
  /** Whether resolved threads appear in the canvas and the list. */
  showResolved: boolean
  /** Whether the list only shows threads of the page on display. */
  onlyPage: boolean
  /** Whether the list only shows threads this author started or replied to. */
  onlyMine: boolean
  /** How the list orders threads. */
  sort: CommentSort
}

export const COMMENT_PREFERENCES_KEY = 'open-pencil:preferences:comments:v1'

const DEFAULTS: CommentPreferences = {
  showOnCanvas: true,
  showResolved: false,
  onlyPage: false,
  onlyMine: false,
  sort: 'newest'
}

const store = useLocalStorage<{ comments?: Partial<CommentPreferences> }>(COMMENT_PREFERENCES_KEY, {
  comments: DEFAULTS
})

/** The comment preferences in effect, with defaults filled in for anything missing. */
export const commentPreferences = computed<CommentPreferences>(() => ({
  ...DEFAULTS,
  ...store.value.comments
}))

/** Changes the comment preferences in place, so every list and layer sees the new value. */
export function updateCommentPreferences(changes: Partial<CommentPreferences>): void {
  store.value = { comments: { ...store.value.comments, ...changes } }
}
