import { params } from '@nanostores/i18n'

import { i18n } from '#vue/i18n/create'

export const homeMessageDefaults = {
  tabPrd: 'PRD',
  tabEval: 'Requirements',
  tabProto: 'Prototype',
  newPrd: 'New PRD',
  newEval: 'New requirements assessment',
  newProto: 'New prototype design',
  creating: 'Creating…',
  createProtoFailed: 'Failed to create prototype',
  untitledPrd: 'Untitled PRD',
  untitledProto: 'Untitled prototype',
  projectName: 'Project name',
  projectNamePlaceholder: 'Enter project name...',
  searchPlaceholder: 'Search...',
  gridView: 'Grid view',
  listView: 'List view',
  loading: 'Loading...',
  statusActive: 'In progress',
  statusCompleted: 'Completed',
  statusFailed: 'Failed',
  statusCancelled: 'Cancelled',
  justNow: 'Just now',
  minutesAgo: params('{n} min ago'),
  hoursAgo: params('{n} h ago'),
  daysAgo: params('{n} d ago'),
  weeksAgo: params('{n} w ago'),
  emptyPrd: 'No PRD documents yet. Click "New PRD" to start.',
  evalComingSoon: 'Requirements assessment is coming soon',
  emptyProto: 'No prototypes yet. Click "New prototype design" to start.',
  prdCover: 'PRD cover preview',
  protoPreview: 'Prototype preview',
  tagPrototype: 'Prototype',
  delete: 'Delete',
  deleteConfirm: params('Delete "{name}"? This cannot be undone.')
} as const

export const homeMessages = i18n('home', homeMessageDefaults)
