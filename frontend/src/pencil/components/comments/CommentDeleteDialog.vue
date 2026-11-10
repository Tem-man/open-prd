<script setup lang="ts">
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogTitle
} from 'reka-ui'
import { ref } from 'vue'

import { useCommentMessages } from '@open-pencil/vue'

import { useComments } from '@/app/comments/use'
import { useActionToast } from '@/app/shell/toast/action'
import { AppAlertDialogRoot, AppDialogBody, AppDialogFooter } from '@/components/ui/dialog'

/** Asks before a comment is deleted for everyone, wherever the deletion was asked for. */
const comments = useComments()
const messages = useCommentMessages()
const { showActionToast } = useActionToast()

// The dialog closes itself before it confirms, so it keeps which comment it was asked about.
const open = ref(false)
const target = ref<string | null>(null)

comments.onDeleteRequested((id) => {
  target.value = id
  open.value = true
})

function confirm() {
  if (!target.value) return
  comments.confirmDelete(target.value)
  target.value = null
  showActionToast(messages.value.commentDeleted)
}
</script>

<template>
  <AppAlertDialogRoot v-model:open="open">
    <div class="border-b border-border px-4 py-3">
      <AlertDialogTitle class="text-sm font-semibold text-surface">
        {{ messages.deleteComment }}
      </AlertDialogTitle>
    </div>
    <AppDialogBody>
      <AlertDialogDescription class="text-xs text-muted">
        {{ messages.deleteCommentDescription }}
      </AlertDialogDescription>
    </AppDialogBody>
    <AppDialogFooter>
      <AlertDialogCancel as-child>
        <button class="rounded px-3 py-1.5 text-xs text-muted hover:bg-hover">
          {{ messages.cancel }}
        </button>
      </AlertDialogCancel>
      <AlertDialogAction as-child>
        <button class="rounded bg-danger px-3 py-1.5 text-xs text-white" @click="confirm">
          {{ messages.delete }}
        </button>
      </AlertDialogAction>
    </AppDialogFooter>
  </AppAlertDialogRoot>
</template>
