<script setup lang="ts">
import { useTextareaAutosize } from '@vueuse/core'
import { computed, nextTick, useTemplateRef } from 'vue'

import { useCommentMessages } from '@open-pencil/vue'

import { useButtonUI } from '@/components/ui/button'

import type { Color } from '@open-pencil/scene-graph/primitives'

import {
  commentFormatForKey,
  continueList,
  formatComment,
  type CommentEdit
} from '@/app/comments/format'

import { useCommentAuthor } from './author'
import CommentAvatar from './CommentAvatar.vue'
import { comments } from './ui'

/**
 * Where a comment or reply is written. Enter sends and Shift+Enter starts a new line or list
 * item; Figma's shortcuts format the selection as Markdown (`format.ts`).
 */
const { label, bare = false, author = '', authorColor } = defineProps<{
  label: string
  /** The composer is its card's whole content, as a new comment's is. */
  bare?: boolean
  /** Who is writing: their avatar leads the composer, as in Figma's new-comment bubble. */
  author?: string
  authorColor?: Color
}>()

const emit = defineEmits<{ submit: [text: string]; cancel: [] }>()

const text = defineModel<string>({ default: '' })
const input = useTemplateRef<HTMLTextAreaElement>('input')
useTextareaAutosize({ element: input, input: text })

const messages = useCommentMessages()
const ui = computed(() => comments({ bare }))
const send = useButtonUI({ tone: 'accent', shape: 'pill', size: 'sm' })
const empty = computed(() => text.value.trim() === '')

const who = useCommentAuthor()

function submit() {
  if (empty.value) return
  emit('submit', text.value.trim())
}

function apply(next: CommentEdit) {
  text.value = next.value
  void nextTick(() => input.value?.setSelectionRange(next.start, next.end))
}

function onKeydown(event: KeyboardEvent) {
  const element = input.value
  // Enter also confirms a word in an input method; that is not sending.
  if (!element || event.isComposing) return
  const current = {
    value: text.value,
    start: element.selectionStart,
    end: element.selectionEnd
  }
  if (event.code === 'Enter' || event.code === 'NumpadEnter') {
    if (event.altKey || event.metaKey || event.ctrlKey) return
    if (!event.shiftKey) {
      event.preventDefault()
      submit()
      return
    }
    const next = continueList(current)
    if (!next) return
    event.preventDefault()
    apply(next)
    return
  }
  const format = commentFormatForKey(event)
  if (!format) return
  // The editor binds some of these keys too, such as Cmd+K for the command palette.
  event.preventDefault()
  event.stopPropagation()
  apply(formatComment(current, format))
}

function focus() {
  input.value?.focus()
}

defineExpose({ focus })
</script>

<template>
  <form data-slot="comment-composer" :class="ui.composer()" @submit.prevent="submit">
    <CommentAvatar
      v-if="author"
      :name="who.name(author)"
      :color="who.color(authorColor)"
      :class="'ml-0.5'"
    />
    <textarea
      ref="input"
      v-model="text"
      rows="1"
      :aria-label="label"
      :placeholder="label"
      :class="ui.composerInput()"
      @keydown="onKeydown"
      @keydown.escape.stop.prevent="emit('cancel')"
    />
    <button
      type="submit"
      :disabled="empty"
      :aria-label="messages.send"
      :class="[send.base, 'size-7 shrink-0 px-0']"
    >
      <icon-lucide-arrow-up class="size-4 shrink-0" />
    </button>
  </form>
</template>
