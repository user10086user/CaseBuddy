/**
 * Markdown 适配工具
 * 将 Markdown 转换为各平台支持的格式
 */

/**
 * 各平台支持的 Markdown 特性对比
 *
 * | 特性         | 企业微信 | 飞书 | Telegram | 说明           |
 * |-------------|--------|------|----------|----------------|
 * | 加粗 **     | ✅     | ✅   | ✅       |                |
 * | 斜体 *      | ✅     | ✅   | ✅       | Telegram用MarkdownV2 |
 * | 行内代码 `  | ✅     | ✅   | ✅       |                |
 * | 代码块 ```  | ✅     | ✅   | ✅       |                |
 * | 链接        | ✅     | ✅   | ✅       |                |
 * | 图片        | ❌     | ✅   | ✅       | 企业微信不支持   |
 * | 列表        | ✅     | ✅   | ✅       |                |
 * | 引用 >      | ✅     | ✅   | ✅       |                |
 */

/**
 * 企业微信 Markdown 清洗
 * 企业微信支持大部分 Markdown，但有部分限制
 */
export function cleanForWecom(text: string): string {
  let result = text;

  // 移除图片（企业微信不支持）
  result = result.replace(/!\[.*?\]\(.*?\)/g, '');

  // 链接转换为文本（可选：保留链接格式）
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '[$1]($2)');

  // 移除多余的空行
  result = result.replace(/\n{3,}/g, '\n\n');

  // 截断超长代码块（保留头部）
  result = result.replace(/```(\w*)\n([\s\S]{2000,})```/g, (match, lang, code) => {
    const truncated = code.slice(0, 1000);
    return '```' + lang + '\n' + truncated + '\n... (内容过长已截断)\n```';
  });

  return result.trim();
}

/**
 * 飞书 Markdown 清洗
 * 飞书支持丰富的 Markdown，直接使用
 */
export function cleanForFeishu(text: string): string {
  let result = text;

  // 飞书对图片支持良好，但需要注意格式
  // 保留图片语法

  // 移除多余的空行
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}

/**
 * Telegram MarkdownV2 清洗
 * Telegram 使用 MarkdownV2，需要转义特殊字符
 */
export function cleanForTelegram(text: string): string {
  let result = text;

  // MarkdownV2 需要转义的字符
  const escapeChars = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'];

  // 转义特殊字符（但不破坏已有的格式）
  escapeChars.forEach(char => {
    // 不转义已经在格式中的字符
    const regex = new RegExp('\\' + char, 'g');
    result = result.replace(regex, '\\' + char);
  });

  // Telegram 不支持图片语法（需要用 InputMediaPhoto）
  // 但我们会将图片链接转为提示
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '[图片: $1]');

  // 移除多余的空行
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}

/**
 * 通用 Markdown 清洗
 * 用于不支持 Markdown 的平台，转换为纯文本
 */
export function cleanToPlainText(text: string): string {
  let result = text;

  // 移除图片语法
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, '[$1]');

  // 链接转换为文本
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  // 移除代码块标记（保留内容）
  result = result.replace(/```(\w*)\n([\s\S]*?)```/g, '\n$2\n');

  // 移除行内代码标记
  result = result.replace(/`([^`]+)`/g, '$1');

  // 移除加粗标记
  result = result.replace(/\*\*([^*]+)\*\*/g, '$1');
  result = result.replace(/__([^_]+)__/g, '$1');

  // 移除斜体标记
  result = result.replace(/\*([^*]+)\*/g, '$1');
  result = result.replace(/_([^_]+)_/g, '$1');

  // 移除标题标记
  result = result.replace(/^#{1,6}\s+/gm, '');

  // 移除引用标记
  result = result.replace(/^>\s+/gm, '');

  // 移除列表标记
  result = result.replace(/^[-*+]\s+/gm, '• ');
  result = result.replace(/^\d+\.\s+/gm, '');

  // 移除水平线
  result = result.replace(/^[-*_]{3,}$/gm, '');

  // 移除多余的空行
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}

/**
 * 根据平台清洗 Markdown
 */
export function cleanMarkdown(text: string, platform: string): string {
  switch (platform) {
    case 'wecom':
      return cleanForWecom(text);
    case 'feishu':
      return cleanForFeishu(text);
    case 'telegram':
      return cleanForTelegram(text);
    default:
      return cleanToPlainText(text);
  }
}

export default cleanMarkdown;
