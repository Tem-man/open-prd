<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue'
import { useWindowSize } from '@vueuse/core'
import { tv } from 'tailwind-variants'

import { getFrameTransitionStyle } from '@open-pencil/core/prototype'
import { useI18n } from '@open-pencil/vue'

import { getActiveEditorStoreOrNull } from '@/app/editor/active-store'
import { exitPresentMode, type PresentZoomMode } from '@/app/prototype/present-mode'
import { usePresentSession } from '@/app/prototype/session'
import PrototypeFrame from '@/components/prototype/PrototypeFrame.vue'
import PrototypeOverlay from '@/components/prototype/PrototypeOverlay.vue'
import PrototypeToolbar from '@/components/prototype/PrototypeToolbar.vue'
import theme from '@/theme/prototype'

/** Breathing room between the presented frame and the window edges, in CSS pixels. */
const STAGE_MARGIN = 48

const { dialogs } = useI18n()

/*
 * Reuse the store already loaded by PencilEditor. A hard refresh on /present has no document, so
 * send those visitors back to the editor rather than showing an empty stage. Upstream used
 * @unhead/vue for the title; open-prd skips that dependency and writes document.title directly.
 */
const store = getActiveEditorStoreOrNull()

onMounted(() => {
  if (!store) void exitPresentMode()
})

watchEffect(() => {
  document.title = dialogs.value.present
})

onUnmounted(() => {
  document.title = 'Open PRD'
})

function exit() {
  void exitPresentMode()
}

const session = store ? usePresentSession(store, exit) : null

const { width: windowWidth, height: windowHeight } = useWindowSize()

const frames = computed(() => session?.frames.value ?? [])
const currentFrame = computed(() => session?.currentFrame.value ?? null)
const previousFrame = computed(() => session?.previousFrame.value ?? null)
const currentFrameId = computed(() => session?.state.value.currentFrameId ?? '')
const transition = computed(() => session?.state.value.transition ?? null)
const overlays = computed(() => session?.state.value.overlayStack ?? [])
const canGoBack = computed(() => (session?.state.value.history.length ?? 0) > 0)

const styles = computed(() =>
  tv(theme)({ interactive: session?.isInteractiveHover.value ?? false })
)

const zoomMode = ref<PresentZoomMode>('fit')
/** A manual pick in the toolbar pins the mode and stops the per-frame smart default. */
let zoomModePinned = false

function setZoomMode(mode: PresentZoomMode) {
  zoomMode.value = mode
  zoomModePinned = true
}

function availableStageSize() {
  return {
    width: Math.max(1, windowWidth.value - STAGE_MARGIN * 2),
    height: Math.max(1, windowHeight.value - STAGE_MARGIN * 2)
  }
}

/*
 * Frames still taller than the window at fit-width scale (long-scroll pages) default to
 * fill-width so they stay readable; everything else defaults to fitting the whole window.
 */
watch(
  currentFrameId,
  () => {
    if (zoomModePinned) return
    const frame = currentFrame.value
    if (!frame) return
    const available = availableStageSize()
    const fillWidthScale = Math.min(1, available.width / frame.width)
    zoomMode.value = frame.height * fillWidthScale > available.height ? 'fill-width' : 'fit'
  },
  { immediate: true }
)

/** Never upscales except in `actual` mode. Baked into the Skia transform, so still crisp. */
const scale = computed(() => {
  const frame = currentFrame.value
  if (!frame) return 1
  const available = availableStageSize()
  if (zoomMode.value === 'actual') return 1
  if (zoomMode.value === 'fill-width') return Math.min(1, available.width / frame.width)
  return Math.min(1, available.width / frame.width, available.height / frame.height)
})

const stageStyle = computed(() => {
  const frame = currentFrame.value
  if (!frame) return {}
  return {
    width: `${frame.width * scale.value}px`,
    height: `${frame.height * scale.value}px`
  }
})

/**
 * Transition offsets come back in frame units, so the size passed in has to be the on-screen
 * size for the translation distance to match what is drawn.
 */
function frameTransitionStyle(phase: 'from' | 'to') {
  const active = transition.value
  const frame = phase === 'to' ? currentFrame.value : previousFrame.value
  if (!active || !frame) return {}
  return getFrameTransitionStyle(
    phase,
    active.params.type,
    active.progress,
    frame.width * scale.value,
    frame.height * scale.value
  )
}

function onBaseFrameClick(x: number, y: number) {
  // Clicks on the base frame are swallowed by the overlay backdrop, matching Figma.
  if (overlays.value.length > 0) return
  session?.onFrameClick(currentFrameId.value, x, y)
}
</script>

<template>
  <div data-test-id="present-root" :class="styles.root()">
    <div :class="styles.scroll()">
      <div
        v-if="currentFrame"
        data-slot="prototype-stage"
        :class="styles.stage()"
        :style="stageStyle"
      >
        <PrototypeFrame
          v-if="previousFrame && transition"
          class="absolute top-0 left-0"
          :style="frameTransitionStyle('from')"
          :frame-id="previousFrame.id"
          :scale="scale"
          :width="previousFrame.width"
          :height="previousFrame.height"
        />
        <PrototypeFrame
          class="absolute top-0 left-0"
          :style="frameTransitionStyle('to')"
          :frame-id="currentFrame.id"
          :scale="scale"
          :width="currentFrame.width"
          :height="currentFrame.height"
          @frame-click="onBaseFrameClick"
          @frame-pointer-move="(x, y) => session?.onFramePointerMove(currentFrameId, x, y)"
          @frame-pointer-leave="session?.onFramePointerLeave()"
        />

        <PrototypeOverlay
          v-for="overlay in overlays"
          :key="overlay.frameId"
          :frame-id="overlay.frameId"
          :position="overlay.position"
          :scale="scale"
          @backdrop-click="session?.onBackdropClick()"
          @frame-click="(x, y) => session?.onFrameClick(overlay.frameId, x, y)"
          @frame-pointer-move="(x, y) => session?.onFramePointerMove(overlay.frameId, x, y)"
          @frame-pointer-leave="session?.onFramePointerLeave()"
        />
      </div>

      <p v-else class="text-sm text-muted">{{ dialogs.noPrototypeFrames }}</p>
    </div>

    <PrototypeToolbar
      v-if="session"
      :frames="frames"
      :current-frame-id="currentFrameId"
      :can-go-back="canGoBack"
      :zoom-mode="zoomMode"
      @show-frame="session.showFrame"
      @back="session.back"
      @exit="exit"
      @update-zoom-mode="setZoomMode"
    />
  </div>
</template>
