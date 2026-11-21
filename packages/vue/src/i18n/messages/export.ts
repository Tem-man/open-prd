import { i18n } from '#vue/i18n/create'

export const exportMessageDefaults = {
  title: 'Export PRD',
  close: 'Close',
  desc: 'Choose a format and download the PRD locally:',
  htmlTitle: 'HTML page',
  htmlDesc: 'Full interactive page with all styles and charts',
  markdownDesc: 'Plain text, ideal for Notion, GitHub, etc.',
  pdfTitle: 'PDF document',
  pdfDesc: 'Formatted document for printing and formal delivery',
  docxTitle: 'Word document',
  docxDesc: 'Editable .docx with comments; charts are rendered as images',
  cancel: 'Cancel',
  exporting: 'Exporting…',
  confirm: 'Confirm export',
  sessionUnavailable: 'Current session is unavailable; cannot export',
  sectionsEmpty: 'PRD has no sections; cannot export',
  exportFailed: 'Failed to export Word document. Please retry.'
} as const

export const exportMessages = i18n('export', exportMessageDefaults)
