import { i18n } from '#vue/i18n/create'

export const shellMessageDefaults = {
  back: 'Back',
  untitledPrd: 'Untitled PRD',
  editTitle: 'Edit title',
  textEditHint: 'Text edit mode · ESC to exit',
  selectHint: 'Click to select · Ctrl/⌘+click multi-select · Double-click to edit',
  saveManual: 'Save manual changes',
  saving: 'Saving…',
  save: 'Save',
  exitEdit: 'Exit edit',
  editThis: 'Edit this section',
  edit: 'Edit',
  versions: 'Versions',
  export: 'Export',
  settings: 'Settings'
} as const

export const shellMessages = i18n('shell', shellMessageDefaults)
