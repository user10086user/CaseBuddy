/**
 * 企业微信 Bot
 * 基于 @wecom/aibot-node-sdk
 */

import { WSClient, WsFrame } from '@wecom/aibot-node-sdk';
import { UnifiedMessage } from '../handler';

export interface WecomConfig {
  enabled: boolean;
  botId: string;
  secret: string;
  welcomeMessage?: string;
  allowedUsers?: string[];
  onMessage?: (msg: UnifiedMessage) => Promise<void>;
}

export class WecomBot {
  private client: WSClient | null = null;
  private config: WecomConfig;
  private sender: (chatId: string, text: string) => Promise<void>;
  private connected: boolean = false;
  // 存储每个用户的 frame，用于回复
  private userFrames: Map<string, WsFrame> = new Map();

  constructor(config: WecomConfig) {
    this.config = config;
    this.sender = async () => {}; // 占位，实际在 start 后设置
  }

  /**
   * 启动 Bot
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      console.log('[WecomBot] Bot 已禁用');
      return;
    }

    if (!this.config.botId || !this.config.secret) {
      console.error('[WecomBot] 配置不完整：需要 botId 和 secret');
      return;
    }

    console.log(`[WecomBot] 正在连接... botId=${this.config.botId}`);

    try {
      // 创建客户端
      this.client = new WSClient({
        botId: this.config.botId,
        secret: this.config.secret
      });

      // 设置事件处理器
      this.setupEventHandlers();

      // 连接
      this.client.connect();

      console.log('[WecomBot] 启动成功');
    } catch (error) {
      console.error('[WecomBot] 启动失败:', error);
      throw error;
    }
  }

  /**
   * 设置事件处理器
   */
  private setupEventHandlers(): void {
    if (!this.client) return;

    // 认证成功
    this.client.on('authenticated', () => {
      console.log('[WecomBot] 🔐 认证成功');
      this.connected = true;
    });

    // 连接错误
    this.client.on('error', (error: Error) => {
      console.error('[WecomBot] 连接错误:', error);
    });

    // 文本消息
    this.client.on('message.text', (frame: WsFrame) => {
      this.handleTextMessage(frame);
    });

    // 图片消息
    this.client.on('message.image', (frame: WsFrame) => {
      this.handleImageMessage(frame);
    });

    // 文件消息
    this.client.on('message.file', (frame: WsFrame) => {
      this.handleFileMessage(frame);
    });

    // 进入会话事件（用户打开对话）
    this.client.on('event.enter_chat', (frame: WsFrame) => {
      this.handleEnterChat(frame);
    });
  }

  /**
   * 处理文本消息
   */
  private async handleTextMessage(frame: WsFrame): Promise<void> {
    const content = (frame.body as any)?.text?.content;
    if (!content) return;

    const userId = (frame.body as any)?.fromInfo?.userId || '';
    const chatId = (frame.body as any)?.chatId || userId;

    // 存储 frame 用于后续回复
    this.userFrames.set(userId, frame);

    // 白名单检查
    if (this.config.allowedUsers && this.config.allowedUsers.length > 0) {
      if (!this.config.allowedUsers.includes(userId)) {
        console.log(`[WecomBot] 用户 ${userId} 不在白名单中`);
        return;
      }
    }

    console.log(`[WecomBot] 收到文本消息 from ${userId}: ${content.slice(0, 50)}`);

    // 构造成统一消息格式
    const msg: UnifiedMessage = {
      platform: 'wecom',
      chatId,
      userId,
      userName: (frame.body as any)?.fromInfo?.userName || '',
      content,
      messageId: (frame.headers as any)?.req_id || `wecom-${Date.now()}`,
      timestamp: Date.now(),
      isGroup: false,
      raw: frame
    };

    // 回调处理
    if (this.config.onMessage) {
      await this.config.onMessage(msg);
    }
  }

  /**
   * 处理图片消息
   */
  private async handleImageMessage(frame: WsFrame): Promise<void> {
    console.log('[WecomBot] 收到图片消息');
    // 图片消息暂时忽略
  }

  /**
   * 处理文件消息
   */
  private async handleFileMessage(frame: WsFrame): Promise<void> {
    console.log('[WecomBot] 收到文件消息');
    // 文件消息暂时忽略
  }

  /**
   * 处理进入会话事件
   */
  private handleEnterChat(frame: WsFrame): void {
    const userId = (frame.body as any)?.fromInfo?.userId || '';

    // 白名单检查
    if (this.config.allowedUsers && this.config.allowedUsers.length > 0) {
      if (!this.config.allowedUsers.includes(userId)) {
        console.log(`[WecomBot] 用户 ${userId} 不在白名单中，跳过欢迎消息`);
        return;
      }
    }

    const welcomeMsg = this.config.welcomeMessage || '您好！我是 CaseBuddy MBA 案例分析助手，请直接发送您的问题。';

    // 存储 frame
    this.userFrames.set(userId, frame);

    // 发送欢迎消息
    if (this.client) {
      try {
        this.client.replyWelcome(
          { headers: frame.headers },
          {
            msgtype: 'text',
            text: { content: welcomeMsg }
          }
        );
        console.log(`[WecomBot] 发送欢迎消息给 ${userId}`);
      } catch (error) {
        console.error(`[WecomBot] 发送欢迎消息失败:`, error);
      }
    }
  }

  /**
   * 发送文本消息
   */
  async sendText(chatId: string, text: string): Promise<void> {
    if (!this.client) {
      console.error('[WecomBot] 客户端未初始化');
      return;
    }

    const frame = this.userFrames.get(chatId);
    if (!frame) {
      console.error(`[WecomBot] 未找到用户 ${chatId} 的会话信息`);
      return;
    }

    try {
      // 使用 reply 方法发送文本
      await this.client.reply(
        { headers: frame.headers },
        { msgtype: 'text', text: { content: text } }
      );
      console.log(`[WecomBot] 发送消息给 ${chatId}: ${text.slice(0, 50)}`);
    } catch (error) {
      console.error(`[WecomBot] 发送消息失败:`, error);
      throw error;
    }
  }

  /**
   * 发送流式回复
   */
  async sendStream(chatId: string, streamId: string, content: string, isEnd: boolean): Promise<void> {
    if (!this.client) {
      console.error('[WecomBot] 客户端未初始化');
      return;
    }

    const frame = this.userFrames.get(chatId);
    if (!frame) {
      console.error(`[WecomBot] 未找到用户 ${chatId} 的会话信息`);
      return;
    }

    try {
      await this.client.replyStream(
        { headers: frame.headers },
        streamId,
        content,
        isEnd
      );
    } catch (error) {
      console.error(`[WecomBot] 发送流式消息失败:`, error);
      throw error;
    }
  }

  /**
   * 停止 Bot
   */
  stop(): void {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
      this.connected = false;
      this.userFrames.clear();
      console.log('[WecomBot] 已停止');
    }
  }

  /**
   * 获取连接状态
   */
  isConnected(): boolean {
    return this.connected;
  }
}

export default WecomBot;
