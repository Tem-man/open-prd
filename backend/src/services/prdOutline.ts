import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { getDb } from '../db/client.js';
import { BUILTIN_MODULES } from '../db/schema.js';
import { createChatModel } from './llm.js';
import { DIAGRAM_SKILL_MAP } from './skillLoader.js';
import type { SelectedModule } from './prompts.js';

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

// SectionId 现在可以是内置 id 或任意自定义 UUID 字符串
export type SectionId = string;

export interface SectionOutline {
  id: SectionId;
  title: string;
  /** 从需求对话中提炼的核心要点，Phase 5 各模块生成时直接使用 */
  keyPoints: string[];
  /** 需要注入的 Skill 名称，仅图表类模块有值 */
  skillRequired?: string;
  /** 断点续传状态，Phase 5 使用 */
  status: 'pending' | 'generating' | 'done' | 'error';
}

export interface PrdOutline {
  sessionId: string;
  sections: SectionOutline[];
  createdAt: number;
}

// ─── 内部工具 ─────────────────────────────────────────────────────────────────

type MsgRow = { role: string; content: string };
type SessionModuleRow = { selected_modules: string | null };

/**
 * 从 session 的 selected_modules 字段读取模块列表。
 * 若为 NULL 则 fallback 到内置 7 个模块默认顺序（向后兼容）。
 */
export function getSessionModules(sessionId: string): SelectedModule[] {
  const db = getDb();
  const row = db
    .prepare('SELECT selected_modules FROM sessions WHERE id = ?')
    .get(sessionId) as SessionModuleRow | undefined;

  if (row?.selected_modules) {
    try {
      return JSON.parse(row.selected_modules) as SelectedModule[];
    } catch { /* fallthrough */ }
  }

  return BUILTIN_MODULES.map((m) => ({ id: m.id, name: m.name, description: m.description, isBuiltin: true }));
}

// ─── 主函数 ───────────────────────────────────────────────────────────────────

/**
 * 基于已收集的对话历史，发起一次非流式 LLM 调用生成 PRD Outline。
 *
 * 返回值包含各选定模块的 keyPoints（Phase 5 各模块直接使用，无需重读历史）。
 * 生成结果持久化到 sessions.outline 字段（JSON 字符串）。
 */
export async function generatePrdOutline(sessionId: string): Promise<PrdOutline> {
  const db = getDb();

  // 读取本次选定的模块列表
  const selectedModules = getSessionModules(sessionId);

  // 加载完整对话历史
  const rows = db
    .prepare(
      'SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC',
    )
    .all(sessionId) as MsgRow[];

  const historyText = rows
    .map((m) => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`)
    .join('\n\n');

  // 构建 Outline 生成提示词
  const systemMsg = new SystemMessage(
    '你是一位资深产品经理，擅长从对话中提炼产品需求。' +
      '请根据以下对话记录，输出一个 JSON 对象，严格遵守给定的 schema，不要添加任何额外文字。\n\n' +
      '对于自定义模块（非标准PRD模块），请根据模块名称的语义从对话历史中提炼相关要点；' +
      '若对话中无相关信息，可基于模块名称生成合理的通用建议性要点（3条以上）。',
  );

  const schemaDesc = selectedModules
    .map((m) => {
      const skillRequired = DIAGRAM_SKILL_MAP[m.id as keyof typeof DIAGRAM_SKILL_MAP];
      const descHint = m.description ? ` /* 描述参考：${m.description} */` : '';
      return `  {
    "id": "${m.id}",
    "title": "${m.name}",${descHint}
    "keyPoints": ["<核心要点1>", "<核心要点2>", "..."],
    ${skillRequired ? `"skillRequired": "${skillRequired}",` : ''}"status": "pending"
  }`;
    })
    .join(',\n');

  const userMsg = new HumanMessage(
    `对话记录：\n\n${historyText}\n\n` +
      `请输出以下 JSON schema 的内容（sections 数组包含全部 ${selectedModules.length} 个模块，每个模块至少 3 条 keyPoints）：\n\n` +
      `{\n  "sections": [\n${schemaDesc}\n  ]\n}\n\n` +
      `要求：\n` +
      `- 每个模块的 keyPoints 必须源自对话中的真实信息，禁止虚构\n` +
      `- 图表类模块（architecture/flowchart/infoArch/dataModel）必须填写 skillRequired 字段\n` +
      `- 非图表类模块不要包含 skillRequired 字段\n` +
      `- 直接输出 JSON，不要加 markdown 代码块包裹`,
  );

  // 非流式调用 + JSON 解析
  const model = createChatModel();
  const parser = new JsonOutputParser();
  const chain = model.pipe(parser);

  let parsed: { sections: SectionOutline[] };
  try {
    parsed = (await chain.invoke([systemMsg, userMsg])) as { sections: SectionOutline[] };
  } catch (err) {
    throw new Error(
      `[prdOutline] JSON 解析失败，LLM 返回格式不符合预期。原始错误：${String(err)}`,
    );
  }

  if (!Array.isArray(parsed?.sections) || parsed.sections.length === 0) {
    throw new Error('[prdOutline] 生成的 Outline 缺少 sections 数组或为空');
  }

  // 补全 status 字段并校验 skillRequired
  const sections: SectionOutline[] = parsed.sections.map((s) => ({
    ...s,
    status: 'pending' as const,
    skillRequired: DIAGRAM_SKILL_MAP[s.id as keyof typeof DIAGRAM_SKILL_MAP] ?? s.skillRequired,
  }));

  const outline: PrdOutline = {
    sessionId,
    sections,
    createdAt: Date.now(),
  };

  // 持久化到 sessions.outline 字段
  db.prepare('UPDATE sessions SET outline = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(outline),
    Date.now(),
    sessionId,
  );

  return outline;
}

/**
 * 从数据库读取已生成的 Outline（若存在）。
 */
export function getOutline(sessionId: string): PrdOutline | null {
  const db = getDb();
  const row = db
    .prepare('SELECT outline FROM sessions WHERE id = ?')
    .get(sessionId) as { outline: string | null } | undefined;

  if (!row?.outline) return null;

  try {
    return JSON.parse(row.outline) as PrdOutline;
  } catch {
    return null;
  }
}

/**
 * 更新指定模块的生成状态（Phase 5 断点续传使用）。
 */
export function updateSectionStatus(
  sessionId: string,
  sectionId: SectionId,
  status: SectionOutline['status'],
): void {
  const outline = getOutline(sessionId);
  if (!outline) return;

  const sections = outline.sections.map((s) =>
    s.id === sectionId ? { ...s, status } : s,
  );

  saveOutline(sessionId, { ...outline, sections });
}

export function saveOutline(sessionId: string, outline: PrdOutline): void {
  const db = getDb();
  db.prepare('UPDATE sessions SET outline = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(outline),
    Date.now(),
    sessionId,
  );
}

/**
 * 往已有大纲中插入一个模块（不清空其他模块的断点续传状态）。
 * afterSectionId 为空或不存在时追加到末尾。
 */
export function appendSectionOutline(
  sessionId: string,
  section: Omit<SectionOutline, 'status'>,
  afterSectionId?: string,
): void {
  const outline = getOutline(sessionId);
  if (!outline) throw new Error('当前 PRD 缺少大纲');
  const sections = outline.sections.filter((s) => s.id !== section.id);
  const entry: SectionOutline = {
    ...section,
    skillRequired:
      DIAGRAM_SKILL_MAP[section.id as keyof typeof DIAGRAM_SKILL_MAP] ?? section.skillRequired,
    status: 'pending',
  };
  const idx = afterSectionId ? sections.findIndex((s) => s.id === afterSectionId) : -1;
  if (idx === -1) sections.push(entry);
  else sections.splice(idx + 1, 0, entry);
  saveOutline(sessionId, { ...outline, sections });
}

/** 基于对话历史为单个新增模块提炼要点（add_section 未提供 keyPoints 时使用）。 */
export async function planSectionKeyPoints(
  sessionId: string,
  title: string,
  description?: string,
): Promise<string[]> {
  const db = getDb();
  const rows = db
    .prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC')
    .all(sessionId) as MsgRow[];
  const historyText = rows
    .map((m) => `${m.role === 'user' ? '用户' : 'AI'}：${m.content.slice(0, 800)}`)
    .join('\n\n')
    .slice(-12000);

  const model = createChatModel();
  const chain = model.pipe(new JsonOutputParser());
  const parsed = (await chain.invoke([
    new SystemMessage(
      '你是一位资深产品经理。根据对话记录，为 PRD 的一个新增章节提炼 3-6 条核心要点。' +
        '只输出 JSON 对象 {"keyPoints": ["..."]}，不要输出任何其他文字。',
    ),
    new HumanMessage(
      `对话记录：\n\n${historyText}\n\n新增章节：${title}${description ? `（${description}）` : ''}`,
    ),
  ])) as { keyPoints?: unknown };

  const points = Array.isArray(parsed?.keyPoints)
    ? parsed.keyPoints.filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    : [];
  return points.length > 0 ? points : [`围绕「${title}」结合产品背景给出完整内容`];
}
