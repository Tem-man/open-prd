<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  text: string
  streaming: boolean
}>()

const container = ref<HTMLParagraphElement | null>(null)
const following = ref(true)

// Keep following the tail while reasoning streams, but stop as soon as the user
// scrolls up to read earlier lines. Rolling back to the bottom resumes it.
const BOTTOM_THRESHOLD = 24
let frame = 0
// The exact scrollTop our own rAF wrote. scrollHeight grows on every reasoning
// delta, so comparing scrollTop against it misreads our own (delayed) scroll
// events as the user scrolling away — that stopped the follow right when the
// box hit its max height. Compare against the position we wrote instead.
let lastAutoTop = -1

function onScroll() {
  const el = container.value
  if (!el) return
  const top = el.scrollTop
  if (!following.value) {
    // Only resume once the user actually scrolls back to the tail.
    if (el.scrollHeight - top - el.clientHeight <= BOTTOM_THRESHOLD) {
      following.value = true
    }
    return
  }
  if (lastAutoTop >= 0 && top < lastAutoTop - 2) {
    following.value = false
    lastAutoTop = -1
  }
}

function followTail() {
  if (!props.streaming || !following.value || frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    const el = container.value
    if (!el || !props.streaming || !following.value || !el.clientHeight) return
    // Layout is only read and written once per frame, never once per streamed delta.
    const bottom = el.scrollHeight - el.clientHeight
    if (bottom > el.scrollTop) {
      lastAutoTop = bottom
      el.scrollTop = bottom
    }
  })
}

function resume() {
  following.value = true
  lastAutoTop = -1
  followTail()
}

watch(() => props.text, followTail)
watch(
  () => props.streaming,
  (streaming) => {
    if (!streaming) return
    following.value = true
    lastAutoTop = -1
    followTail()
  }
)

onMounted(followTail)
onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame)
})
</script>

<template>
  <div class="relative mt-1">
    <p
      ref="container"
      data-test-id="chat-reasoning-text"
      class="max-h-40 overflow-y-auto rounded bg-input p-2 text-[10px] leading-relaxed whitespace-pre-wrap text-muted"
      @scroll.passive="onScroll"
    >
      {{ text }}
    </p>
    <button
      v-if="streaming && !following"
      type="button"
      data-test-id="chat-reasoning-follow-button"
      class="absolute bottom-2 right-2 rounded-full border border-border bg-panel px-2 py-0.5 text-[10px] text-surface hover:bg-hover"
      @click="resume"
    >
      ↓ 回到最新
    </button>
  </div>
</template>
