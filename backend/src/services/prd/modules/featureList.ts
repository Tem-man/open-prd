import type { SectionOutline } from '../../prdOutline.js';
import { invokeModule } from '../base.js';

export async function generate(section: SectionOutline): Promise<string> {
  const keyPoints = section.keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n');

  const sys = `你是一位资深产品经理，正在撰写 PRD 文档的「功能清单」章节。
根据提供的关键要点，按功能模块拆分，每个模块生成独立的 HTML 结构。

输出规范：
- 只输出 HTML 片段，不含根标签
- 每个功能模块输出一组 <div class="feature-module-group">，结构如下：
  <div class="feature-module-group">
    <h3 class="feature-module-title">模块名称</h3>
    <table class="prd-table feature-table">
      <thead>
        <tr><th>功能点</th><th>功能描述</th><th>优先级</th><th>迭代期</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>功能点名称</td>
          <td>详细功能描述</td>
          <td><span class="badge badge-p0">P0 核心</span></td>
          <td>MVP</td>
        </tr>
      </tbody>
    </table>
  </div>
- 模块名称可适当加 emoji 前缀以区分模块（如 🎯 核心功能、📊 数据分析）
- 优先级标签：
  <span class="badge badge-p0">P0 核心</span>
  <span class="badge badge-p1">P1 重要</span>
  <span class="badge badge-p2">P2 优化</span>
- 迭代期：MVP / 一期 / 二期
- 每个模块至少 3 个功能点，覆盖所有核心功能
- 直接输出 HTML，不要加 Markdown 代码块`;

  const user = `「功能清单」关键要点：\n\n${keyPoints}\n\n请生成完整的功能清单表格 HTML。`;

  return invokeModule(sys, user);
}
