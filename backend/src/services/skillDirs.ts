import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 内置 Skill 根目录（只读，随应用分发）：
 * - 开发模式（pnpm dev）：backend/src/services → backend/src → backend → open-prd/ → skills/
 * - Electron 打包（__dirname = <resources>/backend/dist/services）：向上三级 → <resources>/skills/
 *   由 electron-builder extraResources 保证存在。
 */
export const BUILTIN_SKILLS_ROOT = resolve(__dirname, '..', '..', '..', 'skills');

/**
 * 用户 Skill 根目录（可写，用户自定义 Skill 的唯一落盘位置）：
 * - Electron 生产环境：主进程注入 USER_SKILLS_DIR = app.getPath('userData')/skills
 *   （Windows: %APPDATA%/OpenPRD/skills，macOS: ~/Library/Application Support/OpenPRD/skills；
 *   应用更新不触碰、卸载默认保留）。
 * - 纯 Web 开发模式：未注入时回落到内置目录，保持旧版开发体验（项目 skills/ 可写）。
 */
export function getUserSkillsDir(): string {
  return process.env.USER_SKILLS_DIR?.trim() || BUILTIN_SKILLS_ROOT;
}
