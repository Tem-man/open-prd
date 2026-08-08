import { BrowserCredentialStore } from '@pencil/app/settings/credentials/browser'
import { MemoryCredentialStore } from '@pencil/app/settings/credentials/memory'
import { createCredentialServices } from '@pencil/app/settings/credentials/services'
import type { CredentialStore } from '@pencil/app/settings/credentials/types'

export type BrowserCredentialPersistence = 'session' | 'remembered'

/*
 * Upstream prefers a NativeCredentialStore backed by the OS keychain through Tauri `invoke`
 * commands implemented in Rust. open-prd's Electron shell exposes no such commands, so credentials
 * live in localStorage when remembered and in memory otherwise.
 */
export function createCredentialStore(
  browserPersistence: BrowserCredentialPersistence = 'session'
): CredentialStore {
  return browserPersistence === 'remembered'
    ? new BrowserCredentialStore()
    : new MemoryCredentialStore()
}

export const sessionCredentialServices = createCredentialServices(createCredentialStore())

export { credentialRef } from '@pencil/app/settings/credentials/reference'
export { createCredentialServices } from '@pencil/app/settings/credentials/services'
export type {
  CredentialBackend,
  CredentialErrorCode,
  CredentialManager,
  CredentialRef,
  CredentialResolver,
  CredentialStatus,
  CredentialStore,
  CredentialStoreAvailability
} from '@pencil/app/settings/credentials/types'
export { CredentialStoreError } from '@pencil/app/settings/credentials/types'
