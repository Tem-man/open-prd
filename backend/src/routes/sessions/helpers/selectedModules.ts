import { getDb } from "../../../db/client.js";

interface ModuleRow {
	id: string;
	name: string;
	description: string | null;
	is_builtin: 0 | 1;
}

export type SelectedModuleEntry = { id: string; name: string; description?: string };

/** 验证 selectedModules 数组，过滤掉 DB 中不存在的 id，并携带 description */
export function validateModuleIds(
	db: ReturnType<typeof getDb>,
	ids: string[],
): SelectedModuleEntry[] {
	const result: SelectedModuleEntry[] = [];
	for (const id of ids) {
		const row = db
			.prepare(
				"SELECT id, name, description FROM module_templates WHERE id = ?",
			)
			.get(id) as ModuleRow | undefined;
		if (row) {
			const entry: SelectedModuleEntry = { id: row.id, name: row.name };
			if (row.description) entry.description = row.description;
			result.push(entry);
		}
	}
	return result;
}

/** 将 session 行的 selected_modules 字段解析为前端格式 */
export function parseSelectedModules(
	raw: string | null,
): SelectedModuleEntry[] | undefined {
	if (!raw) return undefined;
	try {
		return JSON.parse(raw) as SelectedModuleEntry[];
	} catch {
		return undefined;
	}
}
