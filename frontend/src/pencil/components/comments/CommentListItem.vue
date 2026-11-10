<script setup lang="ts">
import { computed } from 'vue'

import type { Color } from '@open-pencil/scene-graph/primitives'
import type { CommentThread } from '@open-pencil/scene-graph/comments'
import { liveReplies } from '@open-pencil/scene-graph/comments'
import { useCommentMessages } from '@open-pencil/vue'

import { commentPreview } from '@/app/comments/format'

import { useCommentAuthor } from './author'
import CommentAvatar from './CommentAvatar.vue'
import CommentTime from './CommentTime.vue'
import { comments } from './ui'

/** A thread in the comments list: who took part, where it is, and how it starts. */
const {
  thread,
  number,
  pageName = '',
  active = false
} = defineProps<{
  thread: CommentThread
  /** Its place among the document's threads, as Figma numbers them. */
  number: number
  pageName?: string
  active?: boolean
}>()

const emit = defineEmits<{ select: [] }>()

defineSlots<{ actions?(): unknown }>()

const messages = useCommentMessages()
const author = useCommentAuthor()
const ui = comments()

/**
 * Everyone who took part, first to speak first, without their distinct colors: the same person
 * appears once. Upstream draws them through the presence avatar stack; this shell has none, so
 * the row draws its own small overlap.
 */
interface Participant {
  name: string
  color: Color
}

const replies = computed(() => liveReplies(thread))
const people = computed<Participant[]>(() => {
  const entries = [thread, ...replies.value]
  const seen = new Map<string, Participant>()
  for (const entry of entries) {
    if (seen.has(entry.author)) continue
    seen.set(entry.author, {
      name: author.name(entry.author),
      color: author.color(entry.authorColor)
    })
  }
  return [...seen.values()]
})
</script>

<template>
  <li
    data-slot="comment-list-item"
    :data-active="active || undefined"
    :data-resolved="thread.resolved || undefined"
    :class="ui.item()"
  >
    <button type="button" :class="ui.itemButton()" @click="emit('select')">
      <span :class="ui.itemTop()">
        <span class="flex items-center" :aria-label="people.map((p) => p.name).join(', ')">
          <CommentAvatar
            v-for="(person, index) in people.slice(0, 3)"
            :key="person.name"
            :name="person.name"
            :color="person.color"
            :class="index > 0 && '-ml-1.5 rounded-full ring-2 ring-panel'"
          />
          <span
            v-if="people.length > 3"
            class="z-1 -ml-1.5 flex size-6 items-center justify-center rounded-full bg-muted text-2xs text-white ring-2 ring-panel"
          >
            +{{ people.length - 3 }}
          </span>
        </span>
        <span :class="ui.itemPlace()">#{{ number }} · {{ pageName }}</span>
      </span>
      <span :class="ui.itemMeta()">
        <span :class="ui.messageAuthor()">{{ author.name(thread.author) }}</span>
        <CommentTime :at="thread.createdAt" :class="ui.messageTime()" />
      </span>
      <span :class="ui.itemText()">{{ commentPreview(thread.text) }}</span>
      <span v-if="replies.length" :class="ui.itemReplies()">
        {{ messages.replyCount({ count: replies.length }) }}
      </span>
    </button>
    <span v-if="$slots.actions" :class="ui.itemActions()"><slot name="actions" /></span>
  </li>
</template>
