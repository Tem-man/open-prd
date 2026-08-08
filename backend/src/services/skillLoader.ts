import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * skills/ 目录位于 monorepo 根，相对于 backend/src/services/ 向上三级。
 * backend/src/services/ → backend/src/ → backend/ → open-prd/ → skills/
 */
const SKILLS_ROOT = resolve(__dirname, '..', '..', '..', 'skills');

/**
 * 同步读取指定 Skill 的 SKILL.md 内容。
 * @param skillName  例如 "skill-prd-architecture"
 */
export function loadSkill(skillName: string): string {
  const filePath = resolve(SKILLS_ROOT, skillName, 'SKILL.md');
  try {
    return readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(
      `[skillLoader] 找不到 Skill 文件：${filePath}。` +
        `请确认 skills/${skillName}/SKILL.md 存在。原始错误：${String(err)}`,
    );
  }
}

/**
 * 将 Skill 内容包裹为 XML 块，注入 System Prompt 时结构清晰。
 * @param skillName  例如 "skill-prd-architecture"
 */
export function buildSkillBlock(skillName: string): string {
  const content = loadSkill(skillName);
  return `<skill name="${skillName}">\n${content}\n</skill>`;
}

/** PRD 图表类模块对应的 Skill 名称映射 */
export const DIAGRAM_SKILL_MAP: Record<string, string> = {
  architecture: 'skill-prd-architecture',
  flowchart: 'skill-prd-flowchart',
  infoArch: 'skill-prd-infoarch',
  dataModel: 'skill-prd-datamodel',
};
