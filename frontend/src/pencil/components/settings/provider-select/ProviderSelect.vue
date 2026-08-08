<script setup lang="ts">
import { computed } from 'vue'

import AppGroupedSelect from '@/components/ui/AppGroupedSelect.vue'
import { AI_PROVIDERS, type AIProviderID } from '@open-pencil/core/constants'

/*
 * Upstream also offers a "Your agents" group listing locally installed ACP agents, probed over the
 * automation HTTP port. Spawning those agents needs Tauri's sidecar API, so open-prd only offers
 * the API-key providers. The `allowAgents` prop is dropped along with that group.
 */
interface ProviderSelectProps {
  ui?: {
    trigger?: string
    content?: string
    item?: string
    label?: string
    separator?: string
  }
}

const { ui } = defineProps<ProviderSelectProps>()

const providerID = defineModel<AIProviderID>({ required: true })
const providerDef = computed(
  () => AI_PROVIDERS.find((provider) => provider.id === providerID.value) ?? AI_PROVIDERS[0]
)

const displayName = computed(() => providerDef.value.name)

const groups = computed(() => [
  {
    items: [...AI_PROVIDERS]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((provider) => ({
        value: provider.id,
        label: provider.name
      }))
  }
])
</script>

<template>
  <AppGroupedSelect v-model="providerID" :groups="groups" :display-value="displayName" :ui="ui" />
</template>
