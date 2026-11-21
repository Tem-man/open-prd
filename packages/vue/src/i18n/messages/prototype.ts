import { i18n } from '#vue/i18n/create'

export const prototypeMessageDefaults = {
  notFound: 'Prototype not found or has been deleted',
  untitled: 'Untitled prototype',
  loadFailed: 'Failed to load prototype',
  opening: 'Opening prototype…',
  saveFailed: 'Failed to save',
  backHome: 'Back to home',
  backToLatest: 'Back to latest',
  truncated: '(content truncated)',
  zoomMode: 'Zoom mode',
  zoomFit: 'Fit to window',
  zoomFillWidth: 'Fit to width',
  zoomActual: 'Actual size',
  configurePrdModel: 'Please configure a model for the "PRD agent" in Settings first',
  prdProviderUnsupported:
    'The current "PRD agent" provider is not supported (ACP / Google). Please use an OpenAI-compatible or Anthropic-compatible provider',
  configurePrdApiKey: 'Please enter the API key for the "PRD agent" model in Settings first',
  selectPrdModelId: 'Please select a model ID for the "PRD agent" in Settings first',
  configureBaseUrl: 'Please enter the Base URL for the compatible provider in Settings first',
  basisBadge: 'Linked to PRD "Prototype design basis"',
  basisBadgeTitle:
    'AI will follow the page list, structure and design specs in the PRD "Prototype design basis" when generating prototypes',
  basisReady: 'PRD "Prototype design basis" is ready',
  regen: 'Regenerate',
  generating: 'Generating…',
  generateFromPrd: 'Generate prototype from PRD',
  generateHint: 'You can also describe the pages you want in the input box below or request changes'
} as const

export const prototypeMessages = i18n('prototype', prototypeMessageDefaults)
