<script setup lang="ts">
import { computed } from 'vue'

import type { PrototypeOverlayPosition } from '@open-pencil/scene-graph'
import { getOverlayAnchorStyle } from '@open-pencil/core/prototype'

import { useEditorStore } from '@/app/editor/active-store'
import PrototypeFrame from '@/components/prototype/PrototypeFrame.vue'

const props = defineProps<{
  frameId: string
  position: PrototypeOverlayPosition
  scale: number
}>()

const emit = defineEmits<{
  backdropClick: []
  frameClick: [x: number, y: number]
  framePointerMove: [x: number, y: number]
  framePointerLeave: []
}>()

const store = useEditorStore()
const frame = computed(() => store.graph.getNode(props.frameId) ?? null)
const anchorStyle = computed(() => getOverlayAnchorStyle(props.position))
</script>

<template>
  <div
    data-slot="prototype-overlay-backdrop"
    class="absolute inset-0 bg-black/40"
    @click="emit('backdropClick')"
  />
  <div
    v-if="frame"
    data-slot="prototype-overlay"
    class="absolute overflow-hidden"
    :style="anchorStyle"
  >
    <PrototypeFrame
      :frame-id="frame.id"
      :scale="scale"
      :width="frame.width"
      :height="frame.height"
      @frame-click="(x, y) => emit('frameClick', x, y)"
      @frame-pointer-move="(x, y) => emit('framePointerMove', x, y)"
      @frame-pointer-leave="emit('framePointerLeave')"
    />
  </div>
</template>
