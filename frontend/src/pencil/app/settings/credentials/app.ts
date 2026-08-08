import { ref } from 'vue'

import { IS_TAURI } from '@open-pencil/core/constants'

import { BrowserCredentialStore } from '@pencil/app/settings/credentials/browser'
import { MemoryCredentialStore } from '@pencil/app/settings/credentials/memory'
import { createCredentialServices } from '@pencil/app/settings/credentials/services'
import {
  browserRemembersCredentials,
  hasLegacyCredentialStorage,
  setBrowserRemembersCredentials
} from '@pencil/app/settings/credentials/storage'
import { SwitchableCredentialStore } from '@pencil/app/settings/credentials/switchable'
import type { CredentialRef, CredentialStore } from '@pencil/app/settings/credentials/types'

const legacyCredentialsPresent = hasLegacyCredentialStorage()
if (legacyCredentialsPresent) setBrowserRemembersCredentials(true)

export const browserCredentialsRemembered = ref(
  !IS_TAURI && (browserRemembersCredentials() || legacyCredentialsPresent)
)

// Upstream prefers the OS keyring through Tauri. Electron's `safeStorage` could take that role
// later; for now credentials live in the browser's encrypted store or only in memory.
function initialCredentialStore(): CredentialStore {
  if (browserCredentialsRemembered.value) return new BrowserCredentialStore()
  return new MemoryCredentialStore()
}

export const appCredentialStore = new SwitchableCredentialStore(initialCredentialStore())
export const appCredentialServices = createCredentialServices(appCredentialStore)

export async function setBrowserCredentialPersistence(
  remembered: boolean,
  references: CredentialRef[]
): Promise<void> {
  if (IS_TAURI) return

  const next = remembered ? new BrowserCredentialStore() : new MemoryCredentialStore()
  await appCredentialStore.switchTo(next, references, { clearPrevious: !remembered })

  browserCredentialsRemembered.value = remembered
  setBrowserRemembersCredentials(remembered)
}
