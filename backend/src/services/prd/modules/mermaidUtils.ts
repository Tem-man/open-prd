/**
 * Mermaid 代码后处理工具。
 *
 * Mermaid 10 对 subgraph 标签中含非 ASCII 字符（如中文）的情况
 * 要求必须加双引号，否则报 "Syntax error in text"。
 * 同时处理 LLM 可能在单次输出中生成多个图表声明的情况。
 */

/**
 * 将 subgraph 标签中含非 ASCII 或特殊字符的未加引号标签自动补加双引号。
 *
 * e.g.  subgraph 用户层        →  subgraph "用户层"
 *       subgraph "已加引号"    →  保持不变
 *       subgraph LAYER["用户"] →  保持不变（ID[Title] 格式）
 */
export function sanitizeMermaidSubgraphs(code: string): string {
  return code.replace(
    /^(\s*subgraph\s+)([^\n"'\[{][^\n]*)$/gm,
    (_, prefix, label) => {
      const trimmed = label.trim();
      // 已有 ID[Title] 格式（全 ASCII ID + 方括号标题）→ 保持不变
      if (/^[A-Za-z0-9_]+\[/.test(trimmed)) return `${prefix}${label}`;
      // 含非 ASCII 字符或特殊字符 → 强制加引号
      if (/[^\x00-\x7F]/.test(trimmed) || /[^A-Za-z0-9_\-]/.test(trimmed)) {
        return `${prefix}"${trimmed.replace(/"/g, '\\"')}"`;
      }
      return `${prefix}${label}`;
    },
  );
}

/**
 * 将 LLM 输出中可能存在的多个 flowchart TD 声明拆分为独立代码块。
 * 每块独立包裹进 <div class="mermaid">，避免单 div 内多次声明图头报语法错误。
 */
export function splitAndWrapFlowcharts(raw: string): string {
  // 以行首 flowchart TD（大小写不敏感）为分隔点切割
  const parts = raw
    .split(/(?=^\s*flowchart\s+TD\b)/im)
    .map(p => p.trim())
    .filter(p => /^flowchart\s+TD/i.test(p));

  if (parts.length === 0) {
    // 兜底：原样包裹
    return `<div class="mermaid">\n${sanitizeMermaidSubgraphs(raw)}\n</div>`;
  }

  return parts
    .map(p => `<div class="mermaid">\n${sanitizeMermaidSubgraphs(p)}\n</div>`)
    .join('\n');
}
