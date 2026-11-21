import { params } from '@nanostores/i18n'

import { i18n } from '#vue/i18n/create'

export const historyMessageDefaults = {
  title: 'Conversation history',
  emptyMessage: 'Empty message',
  justNow: 'Just now',
  minutesAgo: params('{n} min ago'),
  hoursAgo: params('{n} h ago'),
  daysAgo: params('{n} d ago'),
  currentRound: 'This conversation',
  empty: 'No conversation records yet',
  replying: 'Replying…',
  aiLabel: 'AI'
} as const

export const historyMessages = i18n('history', historyMessageDefaults)
