import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUILTIN_SKILLS_ROOT, getUserSkillsDir } from './skillDirs.js';

/**
 * 定位 Skill 文件：用户目录优先（用户自定义 Skill，以及未来对内置 Skill 的覆盖定制），
 * 未命中时回退到内置目录。
 */
export function getSkillFilePath(skillName: string): string {
  const userPath = resolve(getUserSkillsDir(), skillName, 'SKILL.md');
  if (existsSync(userPath)) return userPath;
  return resolve(BUILTIN_SKILLS_ROOT, skillName, 'SKILL.md');
}

/**
 * 同步读取指定 Skill 的 SKILL.md 内容（用户目录优先，内置兜底）。
 * @param skillName  例如 "skill-prd-architecture"
 */
export function loadSkill(skillName: string): string {
  const filePath = getSkillFilePath(skillName);
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
