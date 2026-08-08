import { AI_PROVIDERS } from '@open-pencil/core/constants'

import { aiModelSettings, modelConnectionCredentialRef } from '@pencil/app/ai/models'
import { VECTORIZE_CREDENTIAL_REFS } from '@pencil/app/editor/vectorize/credentials'
import {
  PEXELS_CREDENTIAL,
  UNSPLASH_CREDENTIAL,
  providerCredentialRef
} from '@pencil/app/settings/credentials/migration'
import { credentialKey } from '@pencil/app/settings/credentials/reference'

import { setBrowserCredentialPersistence } from './app'
import type { CredentialRef } from './types'

function uniqueCredentialRefs(references: CredentialRef[]): CredentialRef[] {
  return [...new Map(references.map((reference) => [credentialKey(reference), reference])).values()]
}

// Upstream also aggregates S3 storage credentials here; remote storage was not migrated.
export function appCredentialRefs(): CredentialRef[] {
  const legacyAIRefs = AI_PROVIDERS.map((provider) => providerCredentialRef(provider.id))
  const modelConnectionRefs = aiModelSettings.value.connections.map(modelConnectionCredentialRef)
  return uniqueCredentialRefs([
    ...legacyAIRefs,
    ...modelConnectionRefs,
    PEXELS_CREDENTIAL,
    UNSPLASH_CREDENTIAL,
    ...VECTORIZE_CREDENTIAL_REFS
  ])
}

export function setAppCredentialPersistence(remembered: boolean): Promise<void> {
  return setBrowserCredentialPersistence(remembered, appCredentialRefs())
}
