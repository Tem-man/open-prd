import { i18n } from '#vue/i18n/create'

export const prdMessageDefaults = {
  emptyTitle: 'PRD content will appear here in real time',
  emptyDesc1: 'Describe your product requirements in the conversation on the left, and I will build a structured',
  emptyDesc2: 'PRD document. Support multi-round conversation to refine it step by step.',
  progressOverview: 'Progress overview',
  statusDone: 'Completed',
  statusActive: 'In progress',
  statusPending: 'Pending',
  mindmapNotFound: 'Mind map data not found',
  mermaidSyntaxError: 'Mermaid syntax error; original content restored',
  multiSelectSameRow: 'Multi-select is limited to the same row',
  defaultSectionTitle: 'Information architecture',
  exportMindmap: 'Export mind map as Markdown',
  confirmDelete: 'Confirm delete',
  deleteWarning: 'Deleted and saved immediately; this cannot be undone.',
  textMode: 'Text mode',
  editEntity: 'Edit entity',
  insertRow: 'Insert row',
  deleteRow: 'Delete row',
  elementAiPlaceholder: 'Tell AI how to modify the selected element…',
  tableAiPlaceholder: 'Tell AI how to modify the whole table…',
  aiRewriting: 'AI is rewriting…'
} as const

export const prdMessages = i18n('prd', prdMessageDefaults)
