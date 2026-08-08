<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useCanvas } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'

const props = defineProps<{
  /** Frame to draw. The rendering surface is reused when this changes. */
  frameId: string
  /** Zoom baked into the Skia transform so fitted frames stay crisp. */
  scale: number
  width: number
  height: number
}>()

const emit = defineEmits<{
  frameClick: [x: number, y: number]
  framePointerMove: [x: number, y: number]
  framePointerLeave: []
}>()

const store = useEditorStore()
const canvasRef = ref<HTMLCanvasElement | null>(null)

const { render } = useCanvas(canvasRef, store, {
  layer: 'scene',
  showRulers: false,
  frameId: () => props.frameId,
  frameScale: () => props.scale
})

// Navigating between frames never touches the scene graph, so nothing in the editor asks for
// a repaint — the presenter has to.
watch(() => [props.frameId, props.scale, props.width, props.height], render)

const style = computed(() => ({
  width: `${props.width * props.scale}px`,
  height: `${props.height * props.scale}px`
}))

/** Convert a viewport position into frame-local coordinates. */
function toLocal(event: MouseEvent): [number, number] | null {
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return null
  return [(event.clientX - rect.left) / props.scale, (event.clientY - rect.top) / props.scale]
}

function onClick(event: MouseEvent) {
  const local = toLocal(event)
  if (local) emit('frameClick', ...local)
}

function onPointerMove(event: MouseEvent) {
  const local = toLocal(event)
  if (local) emit('framePointerMove', ...local)
}
</script>

<template>
  <canvas
    ref="canvasRef"
    data-slot="prototype-frame"
    :data-frame-id="frameId"
    class="block"
    :style="style"
    @click="onClick"
    @mousemove="onPointerMove"
    @mouseleave="emit('framePointerLeave')"
  />
</template>
