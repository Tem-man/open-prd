<script setup lang="ts">
import type { Color } from '@open-pencil/scene-graph/primitives'

import { useCommentAuthor } from './author'
import CommentAvatar from './CommentAvatar.vue'
import CommentTime from './CommentTime.vue'
import { renderCommentMarkdown } from './markdown'
import { comments } from './ui'

/** One message of a thread: who wrote it, when, and what. */
const { author, color, at, text } = defineProps<{
  author: string
  color?: Color
  at: string
  text: string
}>()

defineSlots<{ actions?(): unknown }>()

const who = useCommentAuthor()
const ui = comments()
</script>

<template>
  <article data-slot="comment-message" :class="ui.message()">
    <CommentAvatar :name="who.name(author)" :color="who.color(color)" />
    <div :class="ui.messageMeta()">
      <span :class="ui.messageAuthor()">{{ who.name(author) }}</span>
      <CommentTime :at="at" :class="ui.messageTime()" />
      <span v-if="$slots.actions" :class="ui.messageActions()"><slot name="actions" /></span>
    </div>
    <!-- eslint-disable-next-line vue/no-v-html -- rendered from the document's own comments. -->
    <div
      data-slot="comment-markdown"
      :class="[
        ui.messageText(),
        '[&_a]:text-accent [&_a]:underline [&_ol]:mt-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:m-0 [&_ul]:mt-1 [&_ul]:list-disc [&_ul]:pl-4'
      ]"
      v-html="renderCommentMarkdown(text)"
    />
  </article>
</template>
