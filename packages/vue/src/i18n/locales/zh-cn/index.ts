import type { ComponentsJSON } from '@nanostores/i18n'

import commands from './commands.json'
import comments from './comments.json'
import dialogs from './dialogs.json'
import menu from './menu.json'
import pages from './pages.json'
import panels from './panels.json'
import tools from './tools.json'
import variableTypes from './variable-types.json'
import shell from './shell.json'
import home from './home.json'
import session from './session.json'
import version from './version.json'
import exp from './export.json'
import module from './module.json'
import prd from './prd.json'
import history from './history.json'
import prototype from './prototype.json'
import editor from './editor.json'

export default {
  menu: menu,
  commands: commands,
  comments: comments,
  tools: tools,
  panels: panels,
  variableTypes: variableTypes,
  pages: pages,
  dialogs: dialogs,
  shell: shell,
  home: home,
  session: session,
  version: version,
  export: exp,
  module: module,
  prd: prd,
  history: history,
  prototype: prototype,
  editor: editor
} satisfies ComponentsJSON
