export const CREATE_SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS sessions (
  id               TEXT    PRIMARY KEY,
  title            TEXT    NOT NULL DEFAULT '',
  outline          TEXT,
  selected_modules TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
)
`;

export const CREATE_MODULE_TEMPLATES_TABLE = `
CREATE TABLE IF NOT EXISTS module_templates (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL,
  description TEXT,
  skill_name  TEXT    DEFAULT NULL,
  render_type TEXT    DEFAULT NULL,
  is_builtin  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
)
`;

export const BUILTIN_MODULES: Array<{
	id: string;
	name: string;
	description?: string;
}> = [
	{
		id: "background",
		name: "背景与目标",
		description: "业务痛点分析、SMART 目标设定、项目背景说明",
	},
	{
		id: "userScenario",
		name: "用户与场景",
		description: "目标用户画像、典型使用场景、用户旅程描述",
	},
	{
		id: "featureList",
		name: "功能清单",
		description: "功能模块划分、功能点列表、优先级（P0/P1/P2）",
	},
	{
		id: "architecture",
		name: "产品架构",
		description: "系统分层架构图（Mermaid graph TB），展示前后端、数据层关系",
	},
	{
		id: "flowchart",
		name: "业务流程",
		description: "核心业务流程图（Mermaid flowchart TD），展示关键操作路径",
	},
	{
		id: "infoArch",
		name: "信息架构",
		description: "产品信息层级结构思维导图（markmap.js），展示页面/功能组织",
	},
	{
		id: "dataModel",
		name: "数据模型",
		description: "核心实体 ER 图（Mermaid erDiagram）及字段说明表格",
	},
	{
		id: "prototypeBasis",
		name: "原型设计依据",
		description:
			"面向原型设计 AI 代理的结构化设计依据：页面清单、页面详情、导航关系与设计规范",
	},
];

export interface ModuleTemplateRow {
	id: string;
	name: string;
	description: string | null;
	skill_name: string | null;
	render_type: string | null;
	is_builtin: 0 | 1;
	created_at: number;
}

export const CREATE_MESSAGES_TABLE = `
CREATE TABLE IF NOT EXISTS messages (
  id         TEXT    PRIMARY KEY,
  session_id TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role       TEXT    NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content    TEXT    NOT NULL,
  thinking   TEXT    NOT NULL DEFAULT '',
  meta       TEXT    NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
)
`;

export const CREATE_PRDS_TABLE = `
CREATE TABLE IF NOT EXISTS prds (
  id         TEXT    PRIMARY KEY,
  session_id TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  html       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
`;

/**
 * 每个 PRD 模块的独立内容记录表，支持版本追溯。
 * is_current = 1 表示当前展示版本；编辑后旧版本 is_current 置 0，新版本写入并置 1。
 */
export const CREATE_PRD_SECTIONS_TABLE = `
CREATE TABLE IF NOT EXISTS prd_sections (
  id           TEXT    PRIMARY KEY,
  prd_id       TEXT    NOT NULL REFERENCES prds(id) ON DELETE CASCADE,
  session_id   TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  section_id   TEXT    NOT NULL,
  title        TEXT    NOT NULL,
  html_content TEXT    NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  is_current   INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
)
`;

export const CREATE_PRD_SECTIONS_INDEX = `
CREATE INDEX IF NOT EXISTS idx_prd_sections_lookup
ON prd_sections (prd_id, section_id, is_current)
`;

/**
 * PRD 版本表（Figma Page 模型：每个版本是一份独立文档）。
 * is_active = 1 表示当前打开在工作区（prds.html + prd_sections）的版本；
 * 非激活版本的权威内容存放于本行的 html + sections_json。
 * 详见 docs/plan-prd-version-management.md。
 */
export const CREATE_PRD_VERSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS prd_versions (
  id            TEXT    PRIMARY KEY,
  prd_id        TEXT    NOT NULL REFERENCES prds(id) ON DELETE CASCADE,
  session_id    TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  label         TEXT    NOT NULL DEFAULT '',
  source        TEXT    NOT NULL,
  html          TEXT    NOT NULL,
  sections_json TEXT    NOT NULL,
  messages_json TEXT    NOT NULL DEFAULT '[]',
  is_active     INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
)
`;

export const CREATE_PRD_VERSIONS_INDEX = `
CREATE INDEX IF NOT EXISTS idx_prd_versions_lookup
ON prd_versions (prd_id, version DESC)
`;

/** 每篇 PRD 至多一个激活版本（部分唯一索引） */
export const CREATE_PRD_VERSIONS_ACTIVE_INDEX = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_prd_versions_active
ON prd_versions (prd_id) WHERE is_active = 1
`;

export interface PrdVersionRow {
	id: string;
	prd_id: string;
	session_id: string;
	version: number;
	label: string;
	source: "snapshot" | "blank" | "clone";
	html: string;
	sections_json: string;
	/** 该版本的对话记录快照（对话随版本走，切换时随工作区一起重建） */
	messages_json: string;
	is_active: 0 | 1;
	created_at: number;
	updated_at: number;
}

/**
 * Skill 版本历史表。
 * 文件系统 SKILL.md 是运行时热副本；DB 存完整版本快照，支持回滚。
 * is_current=1 的记录与文件系统内容始终保持一致。
 */
export const CREATE_SKILL_VERSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS skill_versions (
  id          TEXT    PRIMARY KEY,
  module_id   TEXT    NOT NULL REFERENCES module_templates(id) ON DELETE CASCADE,
  content     TEXT    NOT NULL,
  version     INTEGER NOT NULL,
  is_current  INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
)
`;

export const CREATE_SKILL_VERSIONS_INDEX = `
CREATE INDEX IF NOT EXISTS idx_skill_versions_lookup
ON skill_versions (module_id, is_current)
`;

export interface SkillVersionRow {
	id: string;
	module_id: string;
	content: string;
	version: number;
	is_current: 0 | 1;
	created_at: number;
}

/**
 * Prototype documents: SQLite holds index metadata only; .fig binary lives on disk
 * under `<DATA_DIR>/prototypes/` (see services/prototypeStore.ts).
 */
export const CREATE_PROTOTYPES_TABLE = `
CREATE TABLE IF NOT EXISTS prototypes (
  id         TEXT    PRIMARY KEY,
  session_id TEXT    REFERENCES sessions(id) ON DELETE SET NULL,
  title      TEXT    NOT NULL DEFAULT '',
  file_name  TEXT    NOT NULL,
  file_size  INTEGER NOT NULL DEFAULT 0,
  thumbnail  TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
`;

export const CREATE_PROTOTYPES_UPDATED_INDEX = `
CREATE INDEX IF NOT EXISTS idx_prototypes_updated
ON prototypes (updated_at DESC)
`;

export interface PrototypeRow {
	id: string;
	session_id: string | null;
	title: string;
	file_name: string;
	file_size: number;
	thumbnail: string | null;
	created_at: number;
	updated_at: number;
}
