import type { AIProviderID } from '@open-pencil/core/constants'
import { prototypeMessages } from '@open-pencil/vue'

import { resolveAIModelRole } from '@/app/ai/models/store'
import { resolveModelConnectionAPIKey } from '@/app/ai/models/runtime'
import { openSettingsDialog } from '@/app/settings/dialog'

/** Runtime LLM config sent with PRD Agent API requests (local backend only). */
export type PrdLlmPayload = {
  providerID: string
  model: string
  apiKey: string
  baseURL: string
  apiType: 'completions' | 'responses'
  maxOutputTokens: number
}

const OPENAI_FAMILY = new Set([
  'openai',
  'openrouter',
  'deepseek',
  'minimax',
  'openai-compatible',
])

const ANTHROPIC_FAMILY = new Set(['anthropic', 'anthropic-compatible', 'zai'])

const DEFAULT_BASE_URL: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  deepseek: 'https://api.deepseek.com',
  minimax: 'https://api.minimax.io/v1',
  anthropic: 'https://api.anthropic.com',
  zai: 'https://api.z.ai/api/anthropic',
}

export function isPrdSupportedProvider(providerID: string): boolean {
  if (providerID.startsWith('acp:')) return false
  return OPENAI_FAMILY.has(providerID) || ANTHROPIC_FAMILY.has(providerID)
}

export function defaultBaseURLForProvider(providerID: string, customBaseURL: string): string {
  const trimmed = customBaseURL.trim()
  if (trimmed) return trimmed
  return DEFAULT_BASE_URL[providerID] ?? ''
}

/**
 * Resolve the `prd` role assignment into a payload the backend can use with LangChain.
 * Throws a Chinese Error message suitable for toast display.
 */
export async function resolvePrdLlmPayload(): Promise<PrdLlmPayload> {
  const resolved = resolveAIModelRole('prd')
  if (!resolved) {
    openSettingsDialog('ai')
    throw new Error(prototypeMessages.get().configurePrdModel)
  }

  const { profile, connection } = resolved
  const providerID = connection.providerID as AIProviderID

  if (!isPrdSupportedProvider(providerID)) {
    openSettingsDialog('ai')
    throw new Error(
      prototypeMessages.get().prdProviderUnsupported,
    )
  }

  const apiKey = await resolveModelConnectionAPIKey(connection.id)
  if (!apiKey?.trim()) {
    openSettingsDialog('ai')
    throw new Error(prototypeMessages.get().configurePrdApiKey)
  }

  const model = profile.customModelID.trim() || profile.modelID
  if (!model) {
    openSettingsDialog('ai')
    throw new Error(prototypeMessages.get().selectPrdModelId)
  }

  const baseURL = defaultBaseURLForProvider(providerID, connection.customBaseURL)
  if (
    (providerID === 'openai-compatible' || providerID === 'anthropic-compatible') &&
    !baseURL
  ) {
    openSettingsDialog('ai')
    throw new Error(prototypeMessages.get().configureBaseUrl)
  }

  return {
    providerID,
    model,
    apiKey,
    baseURL,
    apiType: connection.customAPIType,
    maxOutputTokens: profile.maxOutputTokens,
  }
}
