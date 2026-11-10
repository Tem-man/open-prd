<script setup lang="ts">
import { computed } from 'vue'

import { colorToCSS } from '@open-pencil/core/color'
import type { Color } from '@open-pencil/scene-graph/primitives'

/** A person's initials, at most two, as presence avatars draw them. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean)
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toLocaleUpperCase() ?? '')
    .join('')
}

/** Who wrote a comment: their initials on their color. */
const { name, color } = defineProps<{
  name: string
  color: Color
}>()

const background = computed(() => colorToCSS(color))
const label = computed(() => initials(name) || '?')
</script>

<template>
  <span
    role="img"
    :aria-label="name"
    :class="'flex size-6 shrink-0 select-none items-center justify-center rounded-full text-2xs font-medium text-white'"
    :style="{ background }"
  >
    {{ label }}
  </span>
</template>
