<script setup lang="ts">
import { computed } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'

import AppSelect from '@/components/ui/AppSelect.vue'
import IconButton from '@/components/ui/IconButton.vue'
import type { PresentZoomMode } from '@/app/prototype/present-mode'

const props = defineProps<{
  frames: SceneNode[]
  currentFrameId: string
  canGoBack: boolean
  zoomMode: PresentZoomMode
}>()

const emit = defineEmits<{
  showFrame: [frameId: string]
  back: []
  exit: []
  updateZoomMode: [mode: PresentZoomMode]
}>()

const { dialogs, prototype: t } = useI18n()

const options = computed(() => props.frames.map((frame) => ({ value: frame.id, label: frame.name })))

const selected = computed({
  get: () => props.currentFrameId,
  set: (frameId: string) => emit('showFrame', frameId)
})

const zoomOptions = computed<{ value: PresentZoomMode; label: string }[]>(() => [
  { value: 'fit', label: t.value.zoomFit },
  { value: 'fill-width', label: t.value.zoomFillWidth },
  { value: 'actual', label: t.value.zoomActual }
])

const zoom = computed({
  get: () => props.zoomMode,
  set: (mode: PresentZoomMode) => emit('updateZoomMode', mode)
})
</script>

<template>
  <div
    data-slot="prototype-toolbar"
    class="fixed top-4 right-4 flex items-center gap-1.5 rounded-lg border border-border bg-panel px-2 py-1.5 shadow-lg"
  >
    <AppSelect
      v-model="zoom"
      :options="zoomOptions"
      :label="t.zoomMode"
      data-property="present-zoom"
    />
    <AppSelect
      v-if="options.length > 0"
      v-model="selected"
      :options="options"
      :label="dialogs.prototypeFlow"
      data-property="prototype-frame"
    />
    <IconButton
      :label="dialogs.back"
      :disabled="!canGoBack"
      side="bottom"
      data-command="prototype.back"
      @click="emit('back')"
    >
      <icon-lucide-arrow-left class="size-3.5" />
    </IconButton>
    <IconButton
      :label="dialogs.exitPresent"
      side="bottom"
      data-command="prototype.exit"
      @click="emit('exit')"
    >
      <icon-lucide-x class="size-3.5" />
    </IconButton>
  </div>
</template>
