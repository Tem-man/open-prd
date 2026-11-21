import { commandMessageDefaults } from '#vue/i18n/messages/commands'
import { commentMessageDefaults } from '#vue/i18n/messages/comments'
import { dialogMessageDefaults } from '#vue/i18n/messages/dialogs'
import { menuMessageDefaults } from '#vue/i18n/messages/menu'
import { pageMessageDefaults } from '#vue/i18n/messages/pages'
import { panelMessageDefaults } from '#vue/i18n/messages/panels'
import { toolMessageDefaults } from '#vue/i18n/messages/tools'
import { variableTypeMessageDefaults } from '#vue/i18n/messages/variable-types'
import { shellMessageDefaults } from '#vue/i18n/messages/shell'
import { homeMessageDefaults } from '#vue/i18n/messages/home'
import { sessionMessageDefaults } from '#vue/i18n/messages/session'
import { versionMessageDefaults } from '#vue/i18n/messages/version'
import { exportMessageDefaults } from '#vue/i18n/messages/export'
import { moduleMessageDefaults } from '#vue/i18n/messages/module'
import { prdMessageDefaults } from '#vue/i18n/messages/prd'
import { historyMessageDefaults } from '#vue/i18n/messages/history'
import { prototypeMessageDefaults } from '#vue/i18n/messages/prototype'
import { editorMessageDefaults } from '#vue/i18n/messages/editor'

export { menuMessages, menuMessageDefaults } from '#vue/i18n/messages/menu'
export { commandMessages, commandMessageDefaults } from '#vue/i18n/messages/commands'
export { toolMessages, toolMessageDefaults } from '#vue/i18n/messages/tools'
export { panelMessages, panelMessageDefaults } from '#vue/i18n/messages/panels'
export {
  variableTypeMessages,
  variableTypeMessageDefaults
} from '#vue/i18n/messages/variable-types'
export { pageMessages, pageMessageDefaults } from '#vue/i18n/messages/pages'
export { dialogMessages, dialogMessageDefaults } from '#vue/i18n/messages/dialogs'
export { commentMessages, commentMessageDefaults } from '#vue/i18n/messages/comments'
export { shellMessages, shellMessageDefaults } from '#vue/i18n/messages/shell'
export { homeMessages, homeMessageDefaults } from '#vue/i18n/messages/home'
export { sessionMessages, sessionMessageDefaults } from '#vue/i18n/messages/session'
export { versionMessages, versionMessageDefaults } from '#vue/i18n/messages/version'
export { exportMessages, exportMessageDefaults } from '#vue/i18n/messages/export'
export { moduleMessages, moduleMessageDefaults } from '#vue/i18n/messages/module'
export { prdMessages, prdMessageDefaults } from '#vue/i18n/messages/prd'
export { historyMessages, historyMessageDefaults } from '#vue/i18n/messages/history'
export { prototypeMessages, prototypeMessageDefaults } from '#vue/i18n/messages/prototype'
export { editorMessages, editorMessageDefaults } from '#vue/i18n/messages/editor'

export const messageDefaults = {
  menu: menuMessageDefaults,
  commands: commandMessageDefaults,
  tools: toolMessageDefaults,
  panels: panelMessageDefaults,
  variableTypes: variableTypeMessageDefaults,
  pages: pageMessageDefaults,
  dialogs: dialogMessageDefaults,
  comments: commentMessageDefaults,
  shell: shellMessageDefaults,
  home: homeMessageDefaults,
  session: sessionMessageDefaults,
  version: versionMessageDefaults,
  export: exportMessageDefaults,
  module: moduleMessageDefaults,
  prd: prdMessageDefaults,
  history: historyMessageDefaults,
  prototype: prototypeMessageDefaults,
  editor: editorMessageDefaults
} as const
