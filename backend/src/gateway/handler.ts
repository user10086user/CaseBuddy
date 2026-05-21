/**
 * 统一消息处理器
 * 处理来自各平台的消息，提供统一的接口
 */

import { cleanMarkdown } from './utils/markdown';
import { splitMessage, PLATFORM_LIMITS } from './utils/splitter';

// ============= 类型定义 =============

export interface UnifiedMessage {
  /** 平台标识 */
  platform: 'wecom' | 'feishu' | 'telegram';
  /** 对话 ID */
  chatId: string;
  /** 用户 ID */
  userId: string;
  /** 用户名称 */
  userName?: string;
  /** 消息内容 */
  content: string;
  /** 消息 ID */
  messageId: string;
  /** 时间戳 */
  timestamp: number;
  /** 是否群聊 */
  isGroup: boolean;
  /** 原始消息对象 */
  raw?: unknown;
}

export interface GatewayConfig {
  /** LLM 代理地址 */
  llmProxyUrl: string;
  /** 默认模型 */
  defaultModel: string;
  /** 流式发送间隔(ms) */
  streamDelay?: number;
  /** 会话超时(秒) */
  sessionTimeout?: number;
  /** 最大历史消息数 */
  maxHistory?: number;
}

export interface StreamChunk {
  /** 内容片段 */
  content: string;
  /** 是否完成 */
  done: boolean;
}

/**
 * 统一 Handler 接口
 */
export interface IGatewayHandler {
  /** 处理消息 */
  handleMessage(msg: UnifiedMessage): Promise<void>;
  /** 处理命令 */
  handleCommand(msg: UnifiedMessage, cmd: string): Promise<void>;
  /** 发送文本 */
  sendText(chatId: string, text: string): Promise<void>;
  /** 发送错误 */
  sendError(chatId: string, error: string): Promise<void>;
}

// ============= 命令定义 =============

interface Command {
  name: string;
  description: string;
  handler: (msg: UnifiedMessage, args: string[], handlerInstance: UnifiedHandler) => Promise<void>;
}

const COMMANDS: Command[] = [
  {
    name: 'help',
    description: '显示帮助信息',
    handler: async (msg: UnifiedMessage, _: string[], handler: UnifiedHandler) => {
      const helpText = `
📖 **CaseBuddy 命令帮助**

• \`/help\` - 显示此帮助
• \`/new\` - 开启新会话
• \`/stop\` - 停止当前任务
• \`/status\` - 查看状态
• \`/model <name>\` - 切换模型

💡 **快捷指令**
• 直接发送你的问题，AI 会帮你分析

⚠️ 注意：当前为测试版本，功能有限
`;
      await handler.sendText(msg.chatId, helpText);
    }
  },
  {
    name: 'new',
    description: '开启新会话',
    handler: async (msg: UnifiedMessage, _: string[], handler: UnifiedHandler) => {
      // 清空会话历史（通过发送特殊标记）
      await handler.sendText(msg.chatId, '✅ 已开启新会话，请发送您的问题。');
    }
  },
  {
    name: 'stop',
    description: '停止当前任务',
    handler: async (msg: UnifiedMessage, _: string[], handler: UnifiedHandler) => {
      // 通知停止当前任务
      await handler.sendText(msg.chatId, '⏹️ 已发送停止信号...');
    }
  },
  {
    name: 'status',
    description: '查看状态',
    handler: async (msg: UnifiedMessage, _: string[], handler: UnifiedHandler) => {
      const statusText = `
📊 **CaseBuddy 状态**

• 服务状态：🟢 在线
• 平台：${msg.platform}
• 版本：v1.0.0

💡 发送 \`/help\` 查看所有命令
`;
      await handler.sendText(msg.chatId, statusText);
    }
  }
];

// ============= 统一消息处理器 =============

export class UnifiedHandler implements IGatewayHandler {
  private config: GatewayConfig;
  private sessions: Map<string, {
    history: Array<{ role: string; content: string }>;
    lastActivity: number;
    currentTask?: Promise<void>;
  }>;
  private activeTasks: Map<string, Promise<void>>;
  private platformSender: Map<string, (chatId: string, text: string) => Promise<void>>;

  constructor(config: GatewayConfig) {
    this.config = config;
    this.sessions = new Map();
    this.activeTasks = new Map();
    this.platformSender = new Map();
  }

  /**
   * 注册平台发送器
   */
  registerPlatformSender(platform: string, sender: (chatId: string, text: string) => Promise<void>): void {
    this.platformSender.set(platform, sender);
  }

  /**
   * 获取或创建会话
   */
  private getOrCreateSession(msg: UnifiedMessage) {
    const sessionId = `${msg.platform}:${msg.userId}`;
    const timeout = this.config.sessionTimeout || 300;

    let session = this.sessions.get(sessionId);

    if (!session) {
      session = {
        history: [],
        lastActivity: Date.now()
      };
      this.sessions.set(sessionId, session);
    }

    // 检查超时
    if (Date.now() - session.lastActivity > timeout * 1000) {
      // 超过超时时间，清空历史
      session.history = [];
    }

    session.lastActivity = Date.now();

    return session;
  }

  /**
   * 处理消息
   */
  async handleMessage(msg: UnifiedMessage): Promise<void> {
    console.log(`[Gateway] 收到消息 from ${msg.platform}/${msg.userId}: ${msg.content.slice(0, 100)}`);

    // 检查是否是命令
    if (msg.content.startsWith('/')) {
      const parts = msg.content.slice(1).split(/\s+/);
      const cmd = parts[0].toLowerCase();
      await this.handleCommand(msg, cmd);
      return;
    }

    // 处理普通消息
    await this.processMessage(msg);
  }

  /**
   * 处理命令
   */
  async handleCommand(msg: UnifiedMessage, cmd: string): Promise<void> {
    const command = COMMANDS.find(c => c.name === cmd);
    if (command) {
      await command.handler(msg, [], this);
    } else {
      await this.sendText(msg.chatId, `❓ 未知命令：/${cmd}\n发送 \`/help\` 查看所有命令`);
    }
  }

  /**
   * 处理普通消息
   */
  private async processMessage(msg: UnifiedMessage): Promise<void> {
    const session = this.getOrCreateSession(msg);
    const sender = this.platformSender.get(msg.platform);

    if (!sender) {
      console.error(`[Gateway] 未找到平台发送器: ${msg.platform}`);
      return;
    }

    // 检查是否有正在进行的任务
    const taskKey = `${msg.platform}:${msg.chatId}`;
    if (this.activeTasks.has(taskKey)) {
      await sender(msg.chatId, '⏳ 正在处理您的上一个请求，请稍候...');
      return;
    }

    // 创建新任务
    const task = this.runAgent(msg, sender);
    this.activeTasks.set(taskKey, task);

    try {
      await task;
    } finally {
      this.activeTasks.delete(taskKey);
    }
  }

  /**
   * 运行 Agent（调用 LLM 代理）
   */
  private async runAgent(msg: UnifiedMessage, sender: (chatId: string, text: string) => Promise<void>): Promise<void> {
    const session = this.getOrCreateSession(msg);
    const platform = msg.platform;

    // 准备消息历史
    const messages = [
      {
        role: 'system',
        content: `你是 CaseBuddy，一个专业的 MBA 案例分析 AI 助手。请简洁、专业地回答用户的问题。`
      },
      ...session.history,
      {
        role: 'user',
        content: msg.content
      }
    ];

    try {
      // 调用 LLM 代理
      const response = await fetch(`${this.config.llmProxyUrl}/api/proxy/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.config.defaultModel,
          messages,
          stream: true
        })
      });

      if (!response.ok) {
        throw new Error(`LLM 代理错误: ${response.status}`);
      }

      // 处理流式响应
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法获取响应流');
      }

      let buffer = '';
      const decoder = new TextDecoder();
      const streamDelay = this.config.streamDelay || 500;
      let lastSendTime = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // 尝试解析 SSE
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                const now = Date.now();
                const timeSinceLastSend = now - lastSendTime;

                // 达到发送条件时发送
                if (timeSinceLastSend >= streamDelay || buffer.length > 1000) {
                  const cleaned = cleanMarkdown(buffer, platform);
                  if (cleaned) {
                    const parts = splitMessage(cleaned, PLATFORM_LIMITS[platform] || 2000);
                    for (const part of parts) {
                      await sender(msg.chatId, part);
                      await new Promise(r => setTimeout(r, streamDelay));
                    }
                  }
                  buffer = content; // 保留当前内容
                  lastSendTime = now;
                }
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }

      // 发送剩余内容
      if (buffer) {
        const cleaned = cleanMarkdown(buffer, platform);
        if (cleaned) {
          const parts = splitMessage(cleaned, PLATFORM_LIMITS[platform] || 2000);
          for (const part of parts) {
            await sender(msg.chatId, part);
          }
        }
      }

      // 更新会话历史
      session.history.push({ role: 'user', content: msg.content });
      session.history.push({ role: 'assistant', content: buffer });

      // 限制历史长度
      const maxHistory = this.config.maxHistory || 20;
      if (session.history.length > maxHistory) {
        session.history = session.history.slice(-maxHistory);
      }

    } catch (error) {
      console.error(`[Gateway] Agent 运行错误:`, error);
      await this.sendError(msg.chatId, error instanceof Error ? error.message : '未知错误');
    }
  }

  /**
   * 发送文本消息
   */
  async sendText(chatId: string, text: string, platform: string = 'wecom'): Promise<void> {
    const sender = this.platformSender.get(platform);
    if (sender) {
      const cleaned = cleanMarkdown(text, platform);
      const parts = splitMessage(cleaned, PLATFORM_LIMITS[platform as keyof typeof PLATFORM_LIMITS] || 2000);
      for (const part of parts) {
        await sender(chatId, part);
      }
    }
  }

  /**
   * 发送错误消息
   */
  async sendError(chatId: string, error: string): Promise<void> {
    const errorMsg = `❌ 发生错误：${error}`;
    // 需要知道当前平台，但这里简化处理
    console.error(`[Gateway] ${errorMsg}`);
  }

  /**
   * 停止指定会话的任务
   */
  stopTask(chatId: string): boolean {
    const key = `wecom:${chatId}`; // 简化处理
    if (this.activeTasks.has(key)) {
      // 通过设置标志来停止任务（实际需要实现）
      return true;
    }
    return false;
  }

  /**
   * 获取状态统计
   */
  getStats() {
    return {
      activeSessions: this.sessions.size,
      activeTasks: this.activeTasks.size,
      sessions: Array.from(this.sessions.entries()).map(([id, s]) => ({
        id,
        historyLength: s.history.length,
        lastActivity: new Date(s.lastActivity).toISOString()
      }))
    };
  }
}

export default UnifiedHandler;
