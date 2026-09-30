import type Database from "better-sqlite3";
import {
	CREATE_MODULE_TEMPLATES_TABLE,
	BUILTIN_MODULES,
	CREATE_PRD_SECTIONS_TABLE,
	CREATE_PRD_SECTIONS_INDEX,
	CREATE_PRD_VERSIONS_TABLE,
	CREATE_PRD_VERSIONS_INDEX,
	CREATE_PRD_VERSIONS_ACTIVE_INDEX,
	CREATE_SKILL_VERSIONS_TABLE,
	CREATE_SKILL_VERSIONS_INDEX,
	CREATE_PROTOTYPES_TABLE,
	CREATE_PROTOTYPES_UPDATED_INDEX,
} from "./schema.js";

export function runMigrations(db: Database.Database): void {
	const version = (db.pragma("user_version", { simple: true }) as number) ?? 0;

	if (version < 1) {
		db.exec(CREATE_MODULE_TEMPLATES_TABLE);

		const insert = db.prepare(
			"INSERT OR IGNORE INTO module_templates (id, name, is_builtin, created_at) VALUES (?, ?, 1, ?)",
		);
		const now = Date.now();
		const seedMany = db.transaction(() => {
			for (const m of BUILTIN_MODULES) {
				insert.run(m.id, m.name, now);
			}
		});
		seedMany();

		db.pragma("user_version = 1");
	}

	if (version < 2) {
		const cols = db.pragma("table_info(sessions)") as { name: string }[];
		if (!cols.find((c) => c.name === "selected_modules")) {
			db.exec("ALTER TABLE sessions ADD COLUMN selected_modules TEXT");
		}
		db.pragma("user_version = 2");
	}

	if (version < 3) {
		const cols = db.pragma("table_info(module_templates)") as {
			name: string;
		}[];
		if (!cols.find((c) => c.name === "description")) {
			db.exec("ALTER TABLE module_templates ADD COLUMN description TEXT");
		}
		// 回填内置模块的描述
		const updateDesc = db.prepare(
			"UPDATE module_templates SET description = ? WHERE id = ? AND is_builtin = 1",
		);
		const backfill = db.transaction(() => {
			for (const m of BUILTIN_MODULES) {
				if (m.description) updateDesc.run(m.description, m.id);
			}
		});
		backfill();
		db.pragma("user_version = 3");
	}

	if (version < 4) {
		db.exec(CREATE_PRD_SECTIONS_TABLE);
		db.exec(CREATE_PRD_SECTIONS_INDEX);
		db.pragma("user_version = 4");
	}

	if (version < 5) {
		// 清理历史数据中误存的 el-selected class（前端选中态被持久化的脏数据）
		type Row = { id: string; html_content: string };
		const rows = db
			.prepare(
				"SELECT id, html_content FROM prd_sections WHERE html_content LIKE '%el-selected%'",
			)
			.all() as Row[];
		const update = db.prepare(
			"UPDATE prd_sections SET html_content = ? WHERE id = ?",
		);
		const cleanup = db.transaction(() => {
			for (const row of rows) {
				const cleaned = row.html_content
					.replace(/\bel-selected\b\s*/g, "")
					.replace(/\s+el-selected\b/g, "")
					.replace(/class="\s+/g, 'class="')
					.replace(/\s+"/g, '"')
					.replace(/class=""/g, "");
				update.run(cleaned, row.id);
			}
		});
		cleanup();
		db.pragma("user_version = 5");
	}

	if (version < 6) {
		const cols = db.pragma("table_info(module_templates)") as {
			name: string;
		}[];
		if (!cols.find((c) => c.name === "skill_name")) {
			db.exec(
				"ALTER TABLE module_templates ADD COLUMN skill_name TEXT DEFAULT NULL",
			);
		}
		if (!cols.find((c) => c.name === "render_type")) {
			db.exec(
				"ALTER TABLE module_templates ADD COLUMN render_type TEXT DEFAULT NULL",
			);
		}
		db.pragma("user_version = 6");
	}

	if (version < 7) {
		db.exec(CREATE_SKILL_VERSIONS_TABLE);
		db.exec(CREATE_SKILL_VERSIONS_INDEX);
		db.pragma("user_version = 7");
	}

	if (version < 8) {
		db.exec(CREATE_PROTOTYPES_TABLE);
		db.exec(CREATE_PROTOTYPES_UPDATED_INDEX);
		db.pragma("user_version = 8");
	}

	if (version < 9) {
		// 播种第 8 个内置模块「原型设计依据」（老库补插；新库 v1 已播种 id/name）
		const description =
			"面向原型设计 AI 代理的结构化设计依据：页面清单、页面详情、导航关系与设计规范";
		db.prepare(
			"INSERT OR IGNORE INTO module_templates (id, name, description, skill_name, render_type, is_builtin, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
		).run(
			"prototypeBasis",
			"原型设计依据",
			description,
			"skill-prd-prototype",
			"html",
			Date.now(),
		);
		// 全新库路径：v1 播种仅写入 id/name，这里补齐 skill_name / render_type / description
		db.prepare(
			"UPDATE module_templates SET skill_name = ?, render_type = ?, description = ? WHERE id = ? AND is_builtin = 1",
		).run("skill-prd-prototype", "html", description, "prototypeBasis");
		db.pragma("user_version = 9");
	}

	if (version < 10) {
		db.exec(CREATE_PRD_VERSIONS_TABLE);
		db.exec(CREATE_PRD_VERSIONS_INDEX);
		db.exec(CREATE_PRD_VERSIONS_ACTIVE_INDEX);
		db.pragma("user_version = 10");
	}

	if (version < 11) {
		// prd_versions 增加对话快照列（对话随版本走）；全新库的建表语句已含该列，需防重
		const cols = db.prepare("PRAGMA table_info(prd_versions)").all() as Array<{
			name: string;
		}>;
		if (!cols.some((c) => c.name === "messages_json")) {
			db.exec(
				"ALTER TABLE prd_versions ADD COLUMN messages_json TEXT NOT NULL DEFAULT '[]'",
			);
			// 回填：存量版本行用其会话当前对话近似（仅影响升级前创建的版本）
			db.exec(`
				UPDATE prd_versions SET messages_json = COALESCE((
					SELECT json_group_array(json_object('role', m.role, 'content', m.content, 'created_at', m.created_at))
					FROM (SELECT role, content, created_at FROM messages m
					      WHERE m.session_id = prd_versions.session_id ORDER BY m.created_at ASC) AS m
				), '[]')
				WHERE messages_json = '[]'
			`);
		}
		db.pragma("user_version = 11");
	}

	if (version < 12) {
		const cols = db.prepare("PRAGMA table_info(messages)").all() as Array<{
			name: string;
		}>;
		if (!cols.some((c) => c.name === "thinking")) {
			db.exec(
				"ALTER TABLE messages ADD COLUMN thinking TEXT NOT NULL DEFAULT ''",
			);
		}
		db.pragma("user_version = 12");
	}

	if (version < 13) {
		// 消息元数据：编辑引用 / 待确认动作等（JSON）；全新库建表语句已含该列
		const cols = db.prepare("PRAGMA table_info(messages)").all() as Array<{
			name: string;
		}>;
		if (!cols.some((c) => c.name === "meta")) {
			db.exec("ALTER TABLE messages ADD COLUMN meta TEXT NOT NULL DEFAULT '{}'");
		}
		db.pragma("user_version = 13");
	}

	if (version < 14) {
		db.exec("UPDATE prd_versions SET source = 'snapshot' WHERE source = 'clone'");
		db.pragma("user_version = 14");
	}
}
