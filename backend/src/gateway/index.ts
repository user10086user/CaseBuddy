/**
 * CaseBuddy 消息网关管理器
 * 统一管理所有平台的 Bot
 */

import { WecomBot, WecomConfig } from './platforms/wecom';
import { UnifiedHandler, GatewayConfig, UnifiedMessage } from './handler';

/** 完整网关配置（包含 LLM 配置） */
export interface GatewayConfigFile {
  gateways?: {
    wecom?: WecomConfig;
    feishu?: FeishuConfig;
    telegram?: TelegramConfig;
  };
  llm?: {
    proxyUrl?: string;
    defaultModel?: string;
    streamDelay?: number;
    sessionTimeout?: number;
    maxHistory?: number;
  };
}

/** 平台配置 */
export interface GatewayConfigs {
  wecom?: WecomConfig;
  feishu?: FeishuConfig;
  telegram?: TelegramConfig;
}

export interface FeishuConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
  allowedUsers?: string[];
}

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  allowedUsers?: number[];
}

export interface GatewayStats {
  running: boolean;
  platforms: {
    wecom?: {
      enabled: boolean;
      connected: boolean;
    };
    feishu?: {
      enabled: boolean;
      connected: boolean;
    };
    telegram?: {
      enabled: boolean;
      connected: boolean;
    };
  };
  handler: {
    activeSessions: number;
    activeTasks: number;
  };
}

export class GatewayManager {
  private bots: Map<string, unknown> = new Map();
  private handler: UnifiedHandler;
  private config: GatewayConfigs;
  private running: boolean = false;

  constructor(config: GatewayConfigs, llmConfig: GatewayConfig) {
    this.config = config;
    this.handler = new UnifiedHandler(llmConfig);
  }

  /**
   * 启动所有已启用的 Bot
   */
  async start(): Promise<void> {
    if (this.running) {
      console.log('[Gateway] 网关已在运行中');
      return;
    }

    console.log('[Gateway] 正在启动消息网关...');

    try {
      // 启动企业微信 Bot
      if (this.config.wecom?.enabled) {
        await this.startWecom();
      }

      // 启动飞书 Bot（如果配置了）
      if (this.config.feishu?.enabled) {
        await this.startFeishu();
      }

      // 启动 Telegram Bot（如果配置了）
      if (this.config.telegram?.enabled) {
        await this.startTelegram();
      }

      this.running = true;
      console.log('[Gateway] ✅ 网关启动完成');
    } catch (error) {
      console.error('[Gateway] ❌ 网关启动失败:', error);
      throw error;
    }
  }

  /**
   * 启动企业微信 Bot
   */
  private async startWecom(): Promise<void> {
    const config = this.config.wecom!;

    // 设置消息回调
    config.onMessage = async (msg: UnifiedMessage) => {
      await this.handler.handleMessage(msg);
    };

    const bot = new WecomBot(config);

    // 注册发送器
    this.handler.registerPlatformSender('wecom', async (chatId, text) => {
      await bot.sendText(chatId, text);
    });

    await bot.start();
    this.bots.set('wecom', bot);

    console.log('[Gateway] ✅ 企业微信 Bot 已启动');
  }

  /**
   * 启动飞书 Bot
   */
  private async startFeishu(): Promise<void> {
    // TODO: 实现飞书 Bot
    console.log('[Gateway] ⏳ 飞书 Bot 待实现');
  }

  /**
   * 启动 Telegram Bot
   */
  private async startTelegram(): Promise<void> {
    // TODO: 实现 Telegram Bot
    console.log('[Gateway] ⏳ Telegram Bot 待实现');
  }

  /**
   * 停止所有 Bot
   */
  async stop(): Promise<void> {
    console.log('[Gateway] 正在停止网关...');

    for (const [name, bot] of this.bots.entries()) {
      try {
        if (name === 'wecom') {
          (bot as WecomBot).stop();
        }
        console.log(`[Gateway] ${name} Bot 已停止`);
      } catch (error) {
        console.error(`[Gateway] 停止 ${name} Bot 失败:`, error);
      }
    }

    this.bots.clear();
    this.running = false;
    console.log('[Gateway] ✅ 网关已停止');
  }

  /**
   * 获取网关状态
   */
  getStats(): GatewayStats {
    const wecom = this.bots.get('wecom') as WecomBot | undefined;

    return {
      running: this.running,
      platforms: {
        wecom: {
          enabled: !!this.config.wecom?.enabled,
          connected: wecom?.isConnected() || false
        },
        feishu: {
          enabled: !!this.config.feishu?.enabled,
          connected: false // TODO
        },
        telegram: {
          enabled: !!this.config.telegram?.enabled,
          connected: false // TODO
        }
      },
      handler: this.handler.getStats()
    };
  }

  /**
   * 发送消息（通过指定平台）
   */
  async sendMessage(platform: string, chatId: string, text: string): Promise<void> {
    const sender = this.getSender(platform);
    if (sender) {
      await sender(chatId, text);
    } else {
      throw new Error(`未找到平台: ${platform}`);
    }
  }

  /**
   * 获取平台发送器
   */
  private getSender(platform: string): ((chatId: string, text: string) => Promise<void>) | null {
    switch (platform) {
      case 'wecom':
        const wecom = this.bots.get('wecom') as WecomBot;
        return wecom ? wecom.sendText.bind(wecom) : null;
      // TODO: 其他平台
      default:
        return null;
    }
  }
}

// ============= 配置加载 =============

import * as fs from 'fs';
import * as path from 'path';

export function loadGatewayConfig(configPath?: string): GatewayConfigFile {
  const defaultPath = path.join(process.cwd(), 'gateway', 'config.json');

  if (configPath && fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(content);
  }

  if (fs.existsSync(defaultPath)) {
    const content = fs.readFileSync(defaultPath, 'utf-8');
    return JSON.parse(content);
  }

  // 返回空配置
  return {};
}

export function saveGatewayConfig(config: GatewayConfigFile, configPath?: string): void {
  const defaultPath = path.join(process.cwd(), 'gateway', 'config.json');
  const filePath = configPath || defaultPath;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
}

export default GatewayManager;
