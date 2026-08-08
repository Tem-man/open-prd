import type { SectionOutline } from '../../prdOutline.js';
import { invokeModule } from '../base.js';

export async function generate(section: SectionOutline): Promise<string> {
  const keyPoints = section.keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n');

  const sys = `你是一位资深产品经理，正在撰写 PRD 文档的「用户与场景」章节。
根据提供的关键要点，生成结构清晰的 HTML 内容。

输出规范：
- 只输出 HTML 片段，不含根标签
- 用户画像部分：用 <table class="prd-table"> 呈现，列：用户类型 | 核心特征 | 主要需求 | 核心痛点（2-4 类用户）
- 使用场景部分：每个场景用 <div class="scenario-card"> 包裹，内含：
  <div class="scenario-title">场景名</div>
  <p><strong>触发条件：</strong>...</p>
  <p><strong>操作路径：</strong>...</p>
  <p><strong>预期结果：</strong>...</p>
- 2-4 个核心使用场景
- 直接输出 HTML，不要加 Markdown 代码块`;

  const user = `「用户与场景」关键要点：\n\n${keyPoints}\n\n请生成完整的 HTML 内容。`;

  return invokeModule(sys, user);
}
