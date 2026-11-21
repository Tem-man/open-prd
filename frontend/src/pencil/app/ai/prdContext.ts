import { readonly, ref } from 'vue'
import { prototypeMessages } from '@open-pencil/vue'

/**
 * PRD「原型设计依据」上下文。
 *
 * 当原型与某个 PRD 会话关联（prototypes.session_id 非空）时，PencilEditor 在挂载后
 * 拉取该会话 PRD 的 prototypeBasis 章节，转为纯文本后由 transports.ts 注入设计代理的
 * instructions，使 AI 生成原型时有据可依（打通 PRD → 原型的信息孤岛）。
 */

export interface PrdBasisContext {
  sessionId: string
  /** 纯文本形式的依据内容（表格已转为 | 分隔，已截断） */
  basisText: string
}

/** 注入设计代理的依据上限，避免上下文膨胀 */
const MAX_BASIS_CHARS = 6000

const current = ref<PrdBasisContext | null>(null)

/** 组件侧只读访问（如「已关联 PRD」徽标） */
export const prdBasis = readonly(current)

let readyResolve: () => void = () => {}
let readyPromise: Promise<void> = Promise.resolve()
let loading = false

export function getPrdBasis(): PrdBasisContext | null {
  return current.value
}

/**
 * 设计代理创建 transport 前 await 此 Promise，
 * 保证依据已加载完成（或已确认不存在），避免 agent 以无上下文状态启动。
 */
export function prdBasisReady(): Promise<void> {
  return readyPromise
}

/**
 * 标记「即将开始加载依据」，使 prdBasisReady() 进入挂起状态。
 * 必须在 PencilEditor setup 阶段同步调用：ChatPanel 挂载时会立即创建设计代理
 * transport，若此时加载尚未开始，readyPromise 处于已解决状态会导致 agent
 * 以无上下文状态启动（依据永远注入不进来）。
 */
export function beginPrdBasisLoad(): void {
  if (loading) return
  loading = true
  current.value = null
  readyPromise = new Promise<void>((resolve) => {
    readyResolve = resolve
  })
}

function endPrdBasisLoad(): void {
  loading = false
  readyResolve()
}

export function clearPrdBasis(): void {
  current.value = null
  endPrdBasisLoad()
}

/** HTML → 纯文本：表格转为 | 分隔行以保留结构，块级元素换行，其余标签剥除。 */
export function htmlToBasisText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  doc.querySelectorAll('table').forEach((table) => {
    const rows = Array.from(table.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.querySelectorAll('th,td'))
        .map((cell) => (cell.textContent ?? '').trim().replace(/\s+/g, ' '))
        .join(' | ')
    )
    table.replaceWith(doc.createTextNode(`\n${rows.join('\n')}\n`))
  })

  doc
    .querySelectorAll('h1,h2,h3,h4,h5,p,li,tr,div,section,article,br')
    .forEach((el) => el.append(doc.createTextNode('\n')))

  return (doc.body.textContent ?? '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n${prototypeMessages.get().truncated}` : text
}

/**
 * 拉取指定会话 PRD 的「原型设计依据」章节并缓存。
 * 会话无 PRD 或未包含该章节时返回 null（视为无依据，属正常情况）。
 */
export async function loadPrdBasis(sessionId: string): Promise<PrdBasisContext | null> {
  beginPrdBasisLoad()
  try {
    const res = await fetch(`/api/sessions/${sessionId}/prd/sections`)
    if (!res.ok) return null
    const data = (await res.json()) as {
      sections?: Array<{ sectionId?: string; title?: string; html?: string }>
    }
    const section = (data.sections ?? []).find((s) => s.sectionId === 'prototypeBasis')
    if (!section?.html) return null
    current.value = {
      sessionId,
      basisText: truncate(htmlToBasisText(section.html), MAX_BASIS_CHARS)
    }
    console.debug('[prdContext] PRD 依据已加载，字符数:', current.value.basisText.length)
    return current.value
  } catch (e) {
    console.warn('[prdContext] loadPrdBasis failed:', e)
    return null
  } finally {
    endPrdBasisLoad()
  }
}
