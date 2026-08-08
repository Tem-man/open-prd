<script setup lang="ts">
import { computed } from 'vue'

import { listPresentableFrames } from '@open-pencil/core/prototype'
import { useI18n } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { enterPresentMode } from '@/app/prototype/present-mode'
import IconButton from '@/components/ui/IconButton.vue'

const { dialogs } = useI18n()
const store = useEditorStore()

const canPresent = computed(() => {
  void store.state.sceneVersion
  return listPresentableFrames(store.graph, store.state.currentPageId).length > 0
})
</script>

<template>
  <IconButton
    :label="dialogs.present"
    :disabled="!canPresent"
    size="md"
    class="size-7"
    side="bottom"
    data-command="prototype.present"
    @click="enterPresentMode()"
  >
    <icon-lucide-play class="size-4" />
  </IconButton>
</template>
