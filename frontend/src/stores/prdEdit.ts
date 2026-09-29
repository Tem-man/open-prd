import { defineStore } from 'pinia'
import { ref, computed, shallowRef, markRaw } from 'vue'

export interface PrdSection {
  id: string
  sectionId: string
  title: string
  html: string
  version: number
}

/** 当前 Tab 的模块操作，供顶栏渲染（编辑 / 保存 / 编辑态提示） */
export interface SectionToolbarState {
  sectionId: string
  editSubMode: 'select' | 'text'
  toastMsg: string
  saving: boolean
  startEdit: () => void
  cancelEdit: () => void
  save: () => void
}

export const usePrdEditStore = defineStore('prdEdit', () => {
  /** 所有模块列表（从 GET /prd/sections 拉取） */
  const sections = ref<PrdSection[]>([])

  /** 当前正处于编辑态的 sectionId，null 表示无编辑态 */
  const editingSection = ref<string | null>(null)

  /** contenteditable 区域当前 innerHTML（由组件同步写入，保存时读取） */
  const editingHtml = ref<string | null>(null)

  /** 正在进行 AI 重写的 sectionId */
  const aiEditingSection = ref<string | null>(null)

  /** AI 流式输出的临时 buffer（用于实时预览） */
  const aiStreamBuffer = ref<string>('')

  /**
   * 当前编辑模块的实时 HTML getter，由 PrdSectionItem 进入编辑时注册。
   * 侧边栏保存时通过 getHtml() 调用，无需直接访问 contenteditable DOM。
   */
  const htmlGetter = ref<(() => string) | null>(null)

  /**
   * 当前可见模块的顶栏操作。由 PrdSectionList 同步，NavBar 只读。
   * 用 shallowRef，避免把组件方法做成深层响应式。
   */
  const sectionToolbar = shallowRef<SectionToolbarState | null>(null)

  /** 当前编辑模块的标题，供侧边栏显示上下文 */
  const editingSectionTitle = computed(() => {
    if (!editingSection.value) return null
    return sections.value.find(s => s.sectionId === editingSection.value)?.title ?? null
  })

  // ── Actions ──────────────────────────────────────────────────────────────────

  function setSections(list: PrdSection[]) {
    sections.value = list
  }

  function setSectionToolbar(state: SectionToolbarState | null) {
    sectionToolbar.value = state ? markRaw(state) : null
  }

  /**
   * 从后端拉取当前工作区模块内容。
   * PrdPanel 初始化与版本切换/新建/删除后均通过它刷新；会同时清理进行中的编辑态。
   */
  async function loadSections(sessionId: string) {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/prd/sections`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSections(data.sections)
      editingSection.value = null
      editingHtml.value = null
      htmlGetter.value = null
    } catch (e) {
      console.error('Failed to load sections:', e)
    }
  }

  function startEdit(sectionId: string) {
    const sec = sections.value.find((s) => s.sectionId === sectionId)
    if (!sec) return
    editingSection.value = sectionId
    editingHtml.value = sec.html
  }

  function registerHtmlGetter(fn: () => string) {
    htmlGetter.value = fn
  }

  function unregisterHtmlGetter() {
    htmlGetter.value = null
  }

  /** 侧边栏调用：获取当前 contenteditable 的最新 HTML */
  function getHtml(): string {
    return htmlGetter.value?.() ?? editingHtml.value ?? ''
  }

  function cancelEdit() {
    editingSection.value = null
    editingHtml.value = null
    aiStreamBuffer.value = ''
    htmlGetter.value = null
  }

  function setEditingHtml(html: string) {
    editingHtml.value = html
  }

  /** AI 流式推送 delta 时调用：追加到 buffer 并同步到 sections 临时 html */
  function onAiEditDelta(sectionId: string, chunk: string) {
    if (aiEditingSection.value !== sectionId) {
      aiEditingSection.value = sectionId
      aiStreamBuffer.value = ''
    }
    aiStreamBuffer.value += chunk
    const sec = sections.value.find((s) => s.sectionId === sectionId)
    if (sec) sec.html = aiStreamBuffer.value
  }

  /**
   * Element Patch 模式开始：标记 AI 正在处理，但不更新 sections html
   * （section html 只在 onAiEditDone 收到完整 patched html 后更新）
   */
  function startAiEditing(sectionId: string) {
    aiEditingSection.value = sectionId
    aiStreamBuffer.value = ''
  }

  /** AI 重写完成时调用：落入正式 html，清空 buffer，退出编辑态 */
  function onAiEditDone(sectionId: string, newHtml: string, version: number) {
    const sec = sections.value.find((s) => s.sectionId === sectionId)
    if (sec) {
      sec.html = newHtml
      sec.version = version
    }
    if (editingSection.value === sectionId) cancelEdit()
    aiEditingSection.value = null
    aiStreamBuffer.value = ''
  }

  /** 直接保存内联编辑内容后更新本地 html */
  function onContentSaved(sectionId: string, html: string, version: number) {
    const sec = sections.value.find((s) => s.sectionId === sectionId)
    if (sec) {
      sec.html = html
      sec.version = version
    }
    if (editingSection.value === sectionId) cancelEdit()
  }

  /** rollback 成功后恢复 html */
  function onRollback(sectionId: string, html: string, version: number) {
    const sec = sections.value.find((s) => s.sectionId === sectionId)
    if (sec) {
      sec.html = html
      sec.version = version
    }
    if (editingSection.value === sectionId) cancelEdit()
  }

  function reset() {
    sections.value = []
    editingSection.value = null
    editingHtml.value = null
    aiEditingSection.value = null
    aiStreamBuffer.value = ''
    htmlGetter.value = null
    sectionToolbar.value = null
  }

  return {
    sections,
    sectionToolbar,
    editingSection,
    editingSectionTitle,
    editingHtml,
    aiEditingSection,
    aiStreamBuffer,
    htmlGetter,
    setSections,
    setSectionToolbar,
    loadSections,
    startEdit,
    cancelEdit,
    setEditingHtml,
    registerHtmlGetter,
    unregisterHtmlGetter,
    getHtml,
    onAiEditDelta,
    startAiEditing,
    onAiEditDone,
    onContentSaved,
    onRollback,
    reset,
  }
})
