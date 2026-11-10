import { createGlobalState, useLocalStorage } from '@vueuse/core'
import { computed } from 'vue'

import type { Color } from '@open-pencil/scene-graph/primitives'

/**
 * Canvas comments have no collaboration rooms here, so one local identity signs every thread and
 * reply: a chosen name, defaulting to "Me", and a color from the palette upstream assigns peers
 * from, kept in storage so a person's comments keep their color across threads.
 */
export const COMMENT_NAME_STORAGE_KEY = 'open-pencil:comments:name:v1'
export const COMMENT_COLOR_STORAGE_KEY = 'open-pencil:comments:color:v1'

/** The palette upstream assigns peer cursors and identities from, in the same order. */
export const AUTHOR_COLORS: Color[] = [
  { r: 0.96, g: 0.26, b: 0.21, a: 1 },
  { r: 0.13, g: 0.59, b: 0.95, a: 1 },
  { r: 0.3, g: 0.69, b: 0.31, a: 1 },
  { r: 1.0, g: 0.76, b: 0.03, a: 1 },
  { r: 0.61, g: 0.15, b: 0.69, a: 1 },
  { r: 1.0, g: 0.34, b: 0.13, a: 1 },
  { r: 0.0, g: 0.74, b: 0.83, a: 1 },
  { r: 0.91, g: 0.12, b: 0.39, a: 1 }
]

export const useCommentIdentity = createGlobalState(() => {
  const storedName = useLocalStorage(COMMENT_NAME_STORAGE_KEY, '')
  const storedColor = useLocalStorage<Color>(
    COMMENT_COLOR_STORAGE_KEY,
    AUTHOR_COLORS[1] ?? AUTHOR_COLORS[0]
  )

  const name = computed(() => storedName.value.trim() || 'Me')
  const color = computed(() => storedColor.value)

  function setName(next: string) {
    storedName.value = next.trim()
  }

  return { name, color, setName }
})
