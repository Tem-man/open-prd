import { createEventHook, createGlobalState } from '@vueuse/core'
import { computed, ref, type WritableComputedRef } from 'vue'

import {
  commentAnchor,
  commentTimestamp as now,
  createCommentReply,
  createCommentThread,
  deleteCommentReply,
  deleteCommentThread,
  replyToCommentThread,
  resolveCommentThread
} from '@open-pencil/scene-graph/comments'
import type { Vector } from '@open-pencil/scene-graph/primitives'

import { useActiveEditorStoreRef } from '@/app/editor/active-store'
import { useCommentIdentity } from '@/app/comments/identity'
import {
  commentPreferences,
  updateCommentPreferences,
  type CommentPreferences
} from '@/app/settings/preferences'

import { followDocumentComments } from './document'

/** Where a comment is being put: the page and the canvas point of the click. */
export interface PagePoint {
  pageId: string
  x: number
  y: number
}

/** A comment preference the list and menus read and change in place. */
function preference<K extends keyof CommentPreferences>(
  key: K
): WritableComputedRef<CommentPreferences[K]> {
  return computed({
    get: () => commentPreferences.value[key],
    set: (value) => updateCommentPreferences({ [key]: value })
  })
}

/** How far around a pin `focusThread` centers the viewport, as upstream centers on one. */
const FOCUS_PADDING = 80

/**
 * The active document's comments and the comment UI's state, one for the whole app: the canvas
 * layer, the sidebar list, menus and shortcuts share it, and it follows whichever document is
 * active. Changes are document changes but never undo steps, as in Figma.
 *
 * Escape closes things in order: the composer and the card's popover close themselves, and the
 * editor's Escape asks `closeCard` before it leaves the Comment tool.
 */
export const useComments = createGlobalState(() => {
  const identity = useCommentIdentity()
  const storeRef = useActiveEditorStoreRef()

  const activeThreadId = ref<string | null>(null)
  const draft = ref<PagePoint | null>(null)
  /** Deleting asks first; the confirmation dialog listens for which thread. */
  const deleteRequested = createEventHook<string>()
  const listQuery = ref('')
  const showOnCanvas = computed(() => commentPreferences.value.showOnCanvas)
  const listShowResolved = preference('showResolved')
  const listOnlyPage = preference('onlyPage')
  const listOnlyMine = preference('onlyMine')
  const listSort = preference('sort')

  // Another document is open: nothing from the last one stays open or half-written.
  const documentComments = followDocumentComments(storeRef, () => {
    activeThreadId.value = null
    draft.value = null
  })
  const { threads, mutate, update, pinPosition } = documentComments

  /** Who writes here: the local comment identity; every thread and reply gets it. */
  const me = computed(() => ({ name: identity.name.value, color: identity.color.value }))

  function startDraft(at: PagePoint) {
    activeThreadId.value = null
    draft.value = at
  }

  function toggleThread(threadId: string) {
    draft.value = null
    activeThreadId.value = activeThreadId.value === threadId ? null : threadId
  }

  /** Close an unsent comment or an open thread; false when neither was open. */
  function closeCard(): boolean {
    const open = draft.value !== null || activeThreadId.value !== null
    draft.value = null
    activeThreadId.value = null
    return open
  }

  function addThread(text: string) {
    const place = draft.value
    const body = text.trim()
    const store = documentComments.store()
    if (!store || !place || !body) return
    const thread = createCommentThread(store.graph, {
      pageId: place.pageId,
      at: place,
      author: me.value,
      text: body,
      now: now()
    })
    draft.value = null
    activeThreadId.value = thread.id
    mutate((current) => [...current, thread])
  }

  /** A dragged pin lands on whatever is under it now, as in Figma. */
  function movePin(threadId: string, at: Vector) {
    const store = documentComments.store()
    if (!store) return
    update(threadId, (thread) => ({ ...thread, ...commentAnchor(store.graph, thread.pageId, at) }))
  }

  function reply(threadId: string, text: string) {
    const body = text.trim()
    if (!body) return
    const entry = createCommentReply(me.value, body, now())
    update(threadId, (thread) => replyToCommentThread(thread, entry))
  }

  function setResolved(threadId: string, resolved: boolean) {
    update(threadId, (thread) => resolveCommentThread(thread, resolved, now()))
    // A resolved thread leaves the canvas unless resolved comments are shown.
    if (resolved && !listShowResolved.value && activeThreadId.value === threadId) {
      activeThreadId.value = null
    }
  }

  /** Ask before deleting; the confirmation dialog answers with `confirmDelete`. */
  function requestDelete(threadId: string) {
    void deleteRequested.trigger(threadId)
  }

  function confirmDelete(threadId: string) {
    update(threadId, deleteCommentThread)
    if (activeThreadId.value === threadId) activeThreadId.value = null
  }

  function deleteReply(threadId: string, replyId: string) {
    update(threadId, (thread) => deleteCommentReply(thread, replyId))
  }

  /** Show a thread: its page, centered on its pin, with its card open. */
  async function focusThread(threadId: string) {
    const store = documentComments.store()
    const thread = threads.value.find((entry) => entry.id === threadId)
    if (!store || !thread) return
    if (store.state.currentPageId !== thread.pageId && store.graph.getNode(thread.pageId)) {
      await store.switchPage(thread.pageId)
    }
    const { x, y } = pinPosition(thread)
    store.zoomToBounds(x - FOCUS_PADDING, y - FOCUS_PADDING, x + FOCUS_PADDING, y + FOCUS_PADDING)
    draft.value = null
    activeThreadId.value = threadId
  }

  function toggleOnCanvas() {
    updateCommentPreferences({ showOnCanvas: !showOnCanvas.value })
  }

  return {
    threads,
    activeThreadId,
    draft,
    onDeleteRequested: deleteRequested.on,
    author: computed(() => me.value.name),
    showOnCanvas,
    listQuery,
    listShowResolved,
    listOnlyPage,
    listOnlyMine,
    listSort,
    pinPosition,
    startDraft,
    toggleThread,
    closeCard,
    addThread,
    movePin,
    reply,
    setResolved,
    requestDelete,
    confirmDelete,
    deleteReply,
    focusThread,
    toggleOnCanvas
  }
})
