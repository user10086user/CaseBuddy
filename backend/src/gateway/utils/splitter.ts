/**
 * 消息分片工具
 * 将长消息拆分为多个短消息，避免超过平台限制
 */

/**
 * 各平台消息限制
 */
export const PLATFORM_LIMITS = {
  wecom: 1500,       // 企业微信
  feishu: 4000,      // 飞书
  telegram: 4096,     // Telegram
  default: 2000      // 默认
};

/**
 * 消息分片选项
 */
export interface SplitOptions {
  /** 最大字符数 */
  limit?: number;
  /** 保留尾部字符数（截断兜底） */
  keepTail?: number;
  /** 优先在换行处切割 */
  preferNewline?: boolean;
}

/**
 * 分割消息文本
 *
 * @param text - 待分割的文本
 * @param limit - 最大字符数
 * @param options - 额外选项
 * @returns 分割后的文本数组
 */
export function splitMessage(
  text: string,
  limit: number = 2000,
  options: SplitOptions = {}
): string[] {
  const { keepTail = 100, preferNewline = true } = options;

  if (!text || text.length <= limit) {
    return text ? [text] : [];
  }

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    let cut: number;

    if (preferNewline) {
      // 优先在换行处切割
      // 从 limit 位置向前找最近的换行符
      cut = remaining.lastIndexOf('\n', limit);

      // 如果在 60% limit 范围内找不到换行符，直接截断
      if (cut < limit * 0.6) {
        cut = limit;
      }
    } else {
      cut = limit;
    }

    // 提取这一部分
    let part = remaining.slice(0, cut).trim();

    // 如果这部分为空（全是空白字符），直接截断
    if (!part) {
      part = remaining.slice(0, limit).trim();
    }

    parts.push(part);

    // 剩余部分
    remaining = remaining.slice(cut).trim();

    // 防止死循环
    if (cut === limit && remaining.length === 0) {
      break;
    }
  }

  // 添加剩余部分
  if (remaining) {
    parts.push(remaining);
  }

  return parts;
}

/**
 * 智能分割消息（保留格式）
 * 尝试按段落分割
 */
export function splitByParagraph(
  text: string,
  limit: number = 2000
): string[] {
  // 按双换行分割段落
  const paragraphs = text.split(/\n\n+/);
  const parts: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    // 如果单个段落就超限
    if (para.length > limit) {
      // 先保存当前段落
      if (current) {
        parts.push(current.trim());
        current = '';
      }
      // 递归分割超长段落
      parts.push(...splitMessage(para, limit));
      continue;
    }

    // 尝试添加这个段落
    const test = current ? current + '\n\n' + para : para;
    if (test.length <= limit) {
      current = test;
    } else {
      // 保存当前并开始新段落
      if (current) {
        parts.push(current.trim());
      }
      current = para;
    }
  }

  // 添加最后的段落
  if (current) {
    parts.push(current.trim());
  }

  return parts;
}

/**
 * 按字符数均匀分割（用于代码等无格式文本）
 */
export function splitEvenly(
  text: string,
  limit: number = 2000
): string[] {
  const parts: string[] = [];

  for (let i = 0; i < text.length; i += limit) {
    parts.push(text.slice(i, i + limit));
  }

  return parts;
}

/**
 * 创建带序号的分片消息
 */
export function splitWithCounter(
  text: string,
  limit: number = 2000,
  options: SplitOptions = {}
): string[] {
  const parts = splitMessage(text, limit - 50, options); // 预留序号空间

  return parts.map((part, index) => {
    return `[${index + 1}/${parts.length}]\n${part}`;
  });
}

/**
 * 格式化错误消息
 */
export function formatError(error: string | Error, limit: number = 500): string {
  const message = typeof error === 'string' ? error : error.message;
  const truncated = message.length > limit ? message.slice(0, limit) + '...' : message;
  return `❌ 发生错误：${truncated}`;
}

/**
 * 格式化超时消息
 */
export function formatTimeout(seconds: number = 300): string {
  return `⏰ 请求超时（${seconds}秒），请稍后重试`;
}

/**
 * 格式化完成消息
 */
export function formatDone(taskId?: string): string {
  if (taskId) {
    return `\n\n✅ 任务完成 (ID: ${taskId})`;
  }
  return '\n\n✅ 任务完成';
}

export default splitMessage;
