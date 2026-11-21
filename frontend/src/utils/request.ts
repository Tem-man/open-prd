import { locale } from '@open-pencil/vue'

/** 当前界面语言对应的 BCP 47 标签；非 zh-CN 一律回退 en。 */
function currentLanguage(): string {
  return locale.get() === 'zh-CN' ? 'zh-CN' : 'en'
}

/**
 * 统一 fetch 封装：自动注入 Accept-Language，让后端按界面语言返回文案。
 * 返回原始 Response，调用方可沿用现有的 res.ok / res.json() 逻辑。
 */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (!headers.has('Accept-Language')) {
    headers.set('Accept-Language', currentLanguage())
  }
  return fetch(input, { ...init, headers })
}
