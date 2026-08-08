import { Router, type IRouter } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { customAlphabet } from 'nanoid';
import multer from 'multer';
import { rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../db/client.js';
import type { ModuleTemplateRow, SkillVersionRow } from '../db/schema.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 } });
import {
  suggestContentPoints,
  generateSkillContent,
  writeSkillFile,
  skillExists,
  type RenderType,
} from '../services/moduleBuilder.js';

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// backend/src/routes/ → backend/src/ → backend/ → open-prd/ → skills/
const SKILLS_ROOT = resolve(__dirname, '..', '..', '..', 'skills');

const router: IRouter = Router();

function toPublic(row: ModuleTemplateRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    skillName: row.skill_name ?? undefined,
    renderType: row.render_type ?? undefined,
    isBuiltin: row.is_builtin === 1,
  };
}

// GET /api/modules — 获取全部模块（内置 + 自定义）
router.get('/', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM module_templates ORDER BY is_builtin DESC, created_at ASC')
    .all() as ModuleTemplateRow[];
  res.json(rows.map(toPublic));
});

// POST /api/modules — 添加自定义模块
router.post('/', (req, res) => {
  const { name, description } = req.body as { name?: string; description?: string };

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: '模块名称不能为空' });
    return;
  }
  if (name.trim().length > 50) {
    res.status(400).json({ error: '模块名称不能超过 50 个字符' });
    return;
  }
  if (description && description.trim().length > 200) {
    res.status(400).json({ error: '模块描述不能超过 200 个字符' });
    return;
  }

  const db = getDb();
  const id = uuidv4();
  const now = Date.now();
  const descValue = description?.trim() || null;

  db.prepare(
    'INSERT INTO module_templates (id, name, description, is_builtin, created_at) VALUES (?, ?, ?, 0, ?)',
  ).run(id, name.trim(), descValue, now);

  const row = db
    .prepare('SELECT * FROM module_templates WHERE id = ?')
    .get(id) as ModuleTemplateRow;

  res.status(201).json(toPublic(row));
});

// DELETE /api/modules/:id — 删除自定义模块
router.delete('/:id', (req, res) => {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM module_templates WHERE id = ?')
    .get(req.params.id) as ModuleTemplateRow | undefined;

  if (!row) {
    res.status(404).json({ error: '模块不存在' });
    return;
  }
  if (row.is_builtin === 1) {
    res.status(403).json({ error: '内置模块不可删除' });
    return;
  }

  // 联动删除关联的 Skill 目录
  if (row.skill_name) {
    const skillDir = resolve(SKILLS_ROOT, row.skill_name);
    if (existsSync(skillDir)) {
      rmSync(skillDir, { recursive: true, force: true });
    }
  }

  db.prepare('DELETE FROM module_templates WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

// ─── POST /api/modules/import-skill ──────────────────────────────────────────
// 上传 SKILL.md 文件导入创建新模块
router.post('/import-skill', upload.single('file'), (req, res) => {
  const file = req.file;
  const moduleName = (req.body?.moduleName as string | undefined)?.trim() ?? '';

  if (!file) {
    res.status(400).json({ error: '请上传 SKILL.md 文件' });
    return;
  }
  if (!moduleName) {
    res.status(400).json({ error: '模块名称不能为空' });
    return;
  }

  const content = file.buffer.toString('utf-8').trim();
  const hasFrontmatter = /^---\r?\n[\s\S]+?\r?\n---/.test(content);
  if (!hasFrontmatter) {
    res.status(400).json({ error: '文件格式不正确，缺少 YAML frontmatter（---）' });
    return;
  }

  // 生成唯一 skillName
  let skillName = `skill-custom-${nanoid()}`;
  let attempts = 0;
  while (skillExists(skillName) && attempts < 5) {
    skillName = `skill-custom-${nanoid()}`;
    attempts++;
  }

  try {
    writeSkillFile(skillName, content);
  } catch (err) {
    res.status(400).json({ error: `Skill 文件写入失败：${String(err)}` });
    return;
  }

  const db = getDb();
  const id = uuidv4();
  const now = Date.now();

  db.prepare(
    'INSERT INTO module_templates (id, name, skill_name, is_builtin, created_at) VALUES (?, ?, ?, 0, ?)',
  ).run(id, moduleName, skillName, now);

  // 写入首个版本记录
  db.prepare(
    'INSERT INTO skill_versions (id, module_id, content, version, is_current, created_at) VALUES (?, ?, ?, 1, 1, ?)',
  ).run(uuidv4(), id, content, now);

  const row = db.prepare('SELECT * FROM module_templates WHERE id = ?').get(id) as ModuleTemplateRow;
  res.status(201).json(toPublic(row));
});

// ─── POST /api/modules/suggest-points ────────────────────────────────────────
// 第一轮：根据模块描述生成内容要点建议
router.post('/suggest-points', async (req, res) => {
  const { moduleName, userDescription } = req.body as {
    moduleName?: string;
    userDescription?: string;
  };

  if (!moduleName?.trim() || !userDescription?.trim()) {
    res.status(400).json({ error: '模块名称和描述不能为空' });
    return;
  }

  try {
    const points = await suggestContentPoints(moduleName.trim(), userDescription.trim());
    res.json({ points });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `要点生成失败：${msg}` });
  }
});

// ─── POST /api/modules/build-skill ───────────────────────────────────────────
// 第二轮完成后：生成 SKILL.md 草稿（不写文件，仅返回内容供预览）
router.post('/build-skill', async (req, res) => {
  const { moduleName, userDescription, confirmedPoints, renderType } = req.body as {
    moduleName?: string;
    userDescription?: string;
    confirmedPoints?: string[];
    renderType?: string;
  };

  const validRenderTypes: RenderType[] = ['html', 'table', 'html+table', 'mermaid', 'markmap'];
  if (
    !moduleName?.trim() ||
    !userDescription?.trim() ||
    !Array.isArray(confirmedPoints) ||
    confirmedPoints.length === 0 ||
    !renderType ||
    !validRenderTypes.includes(renderType as RenderType)
  ) {
    res.status(400).json({ error: '缺少必填字段或 renderType 无效' });
    return;
  }

  // 生成唯一 skillName，碰撞时重试
  let skillName = `skill-custom-${nanoid()}`;
  let attempts = 0;
  while (skillExists(skillName) && attempts < 5) {
    skillName = `skill-custom-${nanoid()}`;
    attempts++;
  }

  try {
    const skillContent = await generateSkillContent(
      {
        moduleName: moduleName.trim(),
        userDescription: userDescription.trim(),
        confirmedPoints,
        renderType: renderType as RenderType,
      },
      skillName,
    );
    res.json({ skillName, skillContent });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Skill 生成失败：${msg}` });
  }
});

// ─── POST /api/modules/confirm-skill ─────────────────────────────────────────
// 用户预览确认后：写入 Skill 文件 + 创建模块 DB 记录
router.post('/confirm-skill', (req, res) => {
  const { name, description, skillName, skillContent, renderType } = req.body as {
    name?: string;
    description?: string;
    skillName?: string;
    skillContent?: string;
    renderType?: string;
  };

  if (!name?.trim() || !skillName?.trim() || !skillContent?.trim()) {
    res.status(400).json({ error: '缺少必填字段' });
    return;
  }

  try {
    writeSkillFile(skillName.trim(), skillContent.trim());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: `Skill 文件写入失败：${msg}` });
    return;
  }

  const db = getDb();
  const id = uuidv4();
  const now = Date.now();

  db.prepare(
    'INSERT INTO module_templates (id, name, description, skill_name, render_type, is_builtin, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
  ).run(
    id,
    name.trim(),
    description?.trim() || null,
    skillName.trim(),
    renderType || null,
    now,
  );

  const row = db.prepare('SELECT * FROM module_templates WHERE id = ?').get(id) as ModuleTemplateRow;

  // 写入首个版本记录 v1
  db.prepare(
    'INSERT INTO skill_versions (id, module_id, content, version, is_current, created_at) VALUES (?, ?, ?, 1, 1, ?)',
  ).run(uuidv4(), id, skillContent.trim(), now);

  res.status(201).json(toPublic(row));
});

// ─── GET /api/modules/:id/skill ───────────────────────────────────────────────
// 获取当前 Skill 内容（优先 DB，兜底文件系统并补写 v1）
router.get('/:id/skill', (req, res) => {
  const db = getDb();
  const moduleRow = db
    .prepare('SELECT * FROM module_templates WHERE id = ?')
    .get(req.params.id) as ModuleTemplateRow | undefined;

  if (!moduleRow || !moduleRow.skill_name) {
    res.status(404).json({ error: '该模块没有关联 Skill' });
    return;
  }

  // 优先从 DB 读当前版本
  const versionRow = db
    .prepare('SELECT * FROM skill_versions WHERE module_id = ? AND is_current = 1')
    .get(req.params.id) as SkillVersionRow | undefined;

  if (versionRow) {
    res.json({ version: versionRow.version, content: versionRow.content, createdAt: versionRow.created_at });
    return;
  }

  // 兜底：从文件系统读，并补写 v1 记录
  const skillPath = resolve(SKILLS_ROOT, moduleRow.skill_name, 'SKILL.md');
  if (!existsSync(skillPath)) {
    res.status(404).json({ error: 'Skill 文件不存在' });
    return;
  }
  const content = readFileSync(skillPath, 'utf-8');
  const now = Date.now();
  db.prepare(
    'INSERT INTO skill_versions (id, module_id, content, version, is_current, created_at) VALUES (?, ?, ?, 1, 1, ?)',
  ).run(uuidv4(), req.params.id, content, now);
  res.json({ version: 1, content, createdAt: now });
});

// ─── PUT /api/modules/:id/skill ───────────────────────────────────────────────
// 保存新版本 Skill（DB + 文件系统双写）
router.put('/:id/skill', (req, res) => {
  const content = (req.body?.content as string | undefined)?.trim() ?? '';
  if (!content) {
    res.status(400).json({ error: 'content 不能为空' });
    return;
  }

  const db = getDb();
  const moduleRow = db
    .prepare('SELECT * FROM module_templates WHERE id = ?')
    .get(req.params.id) as ModuleTemplateRow | undefined;

  if (!moduleRow || !moduleRow.skill_name) {
    res.status(404).json({ error: '该模块没有关联 Skill' });
    return;
  }

  // 读当前最大 version 号
  const maxRow = db
    .prepare('SELECT MAX(version) as max_v FROM skill_versions WHERE module_id = ?')
    .get(req.params.id) as { max_v: number | null };
  const nextVersion = (maxRow.max_v ?? 0) + 1;

  const now = Date.now();
  const saveVersion = db.transaction(() => {
    // 旧版本归档
    db.prepare('UPDATE skill_versions SET is_current = 0 WHERE module_id = ?').run(req.params.id);
    // 写新版本
    db.prepare(
      'INSERT INTO skill_versions (id, module_id, content, version, is_current, created_at) VALUES (?, ?, ?, ?, 1, ?)',
    ).run(uuidv4(), req.params.id, content, nextVersion, now);
  });
  saveVersion();

  // 覆写文件系统（热副本）
  try {
    writeSkillFile(moduleRow.skill_name, content);
  } catch (err) {
    res.status(500).json({ error: `文件写入失败：${String(err)}` });
    return;
  }

  res.json({ version: nextVersion, savedAt: now });
});

// ─── GET /api/modules/:id/skill/versions ──────────────────────────────────────
// 获取版本列表（不含内容）
router.get('/:id/skill/versions', (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT id, version, is_current, created_at FROM skill_versions WHERE module_id = ? ORDER BY version DESC',
    )
    .all(req.params.id) as Pick<SkillVersionRow, 'id' | 'version' | 'is_current' | 'created_at'>[];
  res.json(rows.map((r) => ({ id: r.id, version: r.version, isCurrent: r.is_current === 1, createdAt: r.created_at })));
});

// ─── GET /api/modules/:id/skill/versions/:versionId ───────────────────────────
// 获取指定版本内容
router.get('/:id/skill/versions/:versionId', (req, res) => {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM skill_versions WHERE id = ? AND module_id = ?')
    .get(req.params.versionId, req.params.id) as SkillVersionRow | undefined;
  if (!row) {
    res.status(404).json({ error: '版本不存在' });
    return;
  }
  res.json({ version: row.version, content: row.content, isCurrent: row.is_current === 1, createdAt: row.created_at });
});

// ─── POST /api/modules/:id/skill/rollback ─────────────────────────────────────
// 回滚到指定版本
router.post('/:id/skill/rollback', (req, res) => {
  const versionId = (req.body?.versionId as string | undefined)?.trim() ?? '';
  if (!versionId) {
    res.status(400).json({ error: 'versionId 不能为空' });
    return;
  }

  const db = getDb();
  const moduleRow = db
    .prepare('SELECT * FROM module_templates WHERE id = ?')
    .get(req.params.id) as ModuleTemplateRow | undefined;

  if (!moduleRow || !moduleRow.skill_name) {
    res.status(404).json({ error: '该模块没有关联 Skill' });
    return;
  }

  const targetRow = db
    .prepare('SELECT * FROM skill_versions WHERE id = ? AND module_id = ?')
    .get(versionId, req.params.id) as SkillVersionRow | undefined;

  if (!targetRow) {
    res.status(404).json({ error: '版本不存在' });
    return;
  }

  const doRollback = db.transaction(() => {
    db.prepare('UPDATE skill_versions SET is_current = 0 WHERE module_id = ?').run(req.params.id);
    db.prepare('UPDATE skill_versions SET is_current = 1 WHERE id = ?').run(versionId);
  });
  doRollback();

  // 覆写文件系统热副本
  try {
    writeSkillFile(moduleRow.skill_name, targetRow.content);
  } catch (err) {
    res.status(500).json({ error: `文件写入失败：${String(err)}` });
    return;
  }

  res.json({ restoredVersion: targetRow.version });
});

// ─── GET /api/modules/:id/skill/export ────────────────────────────────────────
// 导出 SKILL.md 文件下载
router.get('/:id/skill/export', (req, res) => {
  const db = getDb();
  const moduleRow = db
    .prepare('SELECT * FROM module_templates WHERE id = ?')
    .get(req.params.id) as ModuleTemplateRow | undefined;

  if (!moduleRow) {
    res.status(404).json({ error: '模块不存在' });
    return;
  }

  let content = '';
  // 优先 DB 当前版本
  const versionRow = db
    .prepare('SELECT content FROM skill_versions WHERE module_id = ? AND is_current = 1')
    .get(req.params.id) as { content: string } | undefined;

  if (versionRow) {
    content = versionRow.content;
  } else if (moduleRow.skill_name) {
    const skillPath = resolve(SKILLS_ROOT, moduleRow.skill_name, 'SKILL.md');
    if (existsSync(skillPath)) content = readFileSync(skillPath, 'utf-8');
  }

  if (!content) {
    res.status(404).json({ error: '没有可导出的 Skill 内容' });
    return;
  }

  const fileName = `${moduleRow.name.replace(/[^\w\u4e00-\u9fa5]/g, '-')}-skill.md`;
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.send(content);
});

// ─── POST /api/modules/:id/skill/optimize ────────────────────────────────────
// AI 优化 Skill（返回预览内容，不写入）
router.post('/:id/skill/optimize', async (req, res) => {
  const instruction = (req.body?.instruction as string | undefined)?.trim() ?? '';
  if (!instruction) {
    res.status(400).json({ error: '优化指令不能为空' });
    return;
  }

  const db = getDb();
  const moduleRow = db
    .prepare('SELECT * FROM module_templates WHERE id = ?')
    .get(req.params.id) as ModuleTemplateRow | undefined;

  if (!moduleRow || !moduleRow.skill_name) {
    res.status(404).json({ error: '该模块没有关联 Skill' });
    return;
  }

  // 读当前 Skill 内容
  let currentContent = '';
  const versionRow = db
    .prepare('SELECT content FROM skill_versions WHERE module_id = ? AND is_current = 1')
    .get(req.params.id) as { content: string } | undefined;
  if (versionRow) {
    currentContent = versionRow.content;
  } else {
    const skillPath = resolve(SKILLS_ROOT, moduleRow.skill_name, 'SKILL.md');
    if (existsSync(skillPath)) currentContent = readFileSync(skillPath, 'utf-8');
  }

  if (!currentContent) {
    res.status(404).json({ error: '没有可优化的 Skill 内容' });
    return;
  }

  try {
    const { optimizeSkillContent } = await import('../services/moduleBuilder.js');
    const optimizedContent = await optimizeSkillContent(currentContent, instruction);
    res.json({ optimizedContent });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `AI 优化失败：${msg}` });
  }
});

export default router;
