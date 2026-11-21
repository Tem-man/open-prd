import { ref } from 'vue'

// Upstream also has a 'storage' section for remote S3 sync, which open-prd does not migrate.
export type SettingsSection = 'ai' | 'media' | 'general'

export const settingsDialogOpen = ref(false)
export const settingsDialogSection = ref<SettingsSection>('ai')

export function openSettingsDialog(section: SettingsSection = 'ai'): void {
  settingsDialogSection.value = section
  settingsDialogOpen.value = true
}
