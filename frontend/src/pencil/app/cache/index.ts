const STORAGE_PREFIX = 'open-pencil:cache:v1:'

/*
 * Upstream writes this cache to disk under Tauri's AppLocalData and falls back to localStorage in
 * the browser. Only the browser half is kept (see app/tauri/env.ts), so the byte-oriented entries
 * — which had no localStorage fallback upstream either — are inert.
 */

function isStorageAvailable() {
  return 'window' in globalThis && !!window.localStorage
}

function storageKey(key: string) {
  return `${STORAGE_PREFIX}${key}`
}

export async function readCacheText(key: string): Promise<string | null> {
  if (!isStorageAvailable()) return null
  return window.localStorage.getItem(storageKey(key))
}

export async function writeCacheText(key: string, value: string): Promise<void> {
  if (!isStorageAvailable()) return
  window.localStorage.setItem(storageKey(key), value)
}

export async function removeCacheEntry(key: string): Promise<void> {
  if (!isStorageAvailable()) return
  window.localStorage.removeItem(storageKey(key))
}

export async function readCacheBytes(_key: string): Promise<ArrayBuffer | null> {
  return null
}

export async function writeCacheBytes(_key: string, _value: ArrayBuffer): Promise<void> {}

export async function removeCachePrefix(prefix: string): Promise<void> {
  if (!isStorageAvailable()) return
  for (let i = window.localStorage.length - 1; i >= 0; i--) {
    const key = window.localStorage.key(i)
    if (key?.startsWith(storageKey(prefix))) window.localStorage.removeItem(key)
  }
}

type JsonCacheEnvelope<T> = {
  updatedAt: number
  value: T
}

export async function readCacheJson<T>(key: string, maxAgeMs?: number): Promise<T | null> {
  const raw = await readCacheText(key)
  if (!raw) return null

  try {
    const envelope = JSON.parse(raw) as Partial<JsonCacheEnvelope<T>>
    if (typeof envelope.updatedAt !== 'number' || !('value' in envelope)) return null
    if (maxAgeMs !== undefined && Date.now() - envelope.updatedAt > maxAgeMs) return null
    return envelope.value as T
  } catch {
    return null
  }
}

export async function writeCacheJson(key: string, value: unknown): Promise<void> {
  await writeCacheText(key, JSON.stringify({ updatedAt: Date.now(), value }))
}
