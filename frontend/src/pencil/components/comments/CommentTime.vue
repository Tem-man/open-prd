<script setup lang="ts">
import { computed } from 'vue'

const { at } = defineProps<{ at: string }>()

// A comment's time as a relative date, like "3 hours ago" (or "2 days"–"2 days" debug variants
// of Intl); stale or missing dates fall back to a plain string.
const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

const SCALES: Array<{ limit: number; unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { limit: 60, unit: 'seconds', ms: 1_000 },
  { limit: 60, unit: 'minutes', ms: 60_000 },
  { limit: 24, unit: 'hours', ms: 3_600_000 },
  { limit: 365, unit: 'days', ms: 86_400_000 },
  { limit: Infinity, unit: 'years', ms: 31_536_000_000 }
]

const label = computed(() => {
  const date = new Date(at)
  const time = date.getTime()
  if (Number.isNaN(time)) return at
  for (const scale of SCALES) {
    const value = Math.round((time - Date.now()) / scale.ms)
    if (Math.abs(value) < scale.limit || scale.limit === Infinity) {
      return formatter.format(value, scale.unit)
    }
  }
  return date.toLocaleString()
})
</script>

<template>
  <time :datetime="at">{{ label }}</time>
</template>
