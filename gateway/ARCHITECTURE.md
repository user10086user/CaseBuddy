# CaseBuddy 消息网关架构设计

> 版本：v1.0
> 日期：2026-05-20
> 基于：GenericAgent 消息网关实现模式

---

## 一、设计目标

为 CaseBuddy 添加多平台消息网关功能，让用户可以通过微信、QQ、飞书、企业微信、钉钉、Telegram 等平台与 AI 进行 MBA 案例分析交互。

### 1.1 核心需求
- **多平台支持**：企业微信、飞书、Telegram（优先级排序）
- **统一消息处理**：标准化消息格式，统一回复处理
- **流式响应**：支持 AI 回复的流式输出
- **会话管理**：与现有 CaseBuddy 会话系统整合
- **配置简化**：通过 Web UI 配置，无需修改代码

### 1.2 非目标
- 个人微信 Bot（政策风险高）
- 个人 QQ Bot（需要官方审核）
- 复杂的多轮对话状态管理（V2）

---

## 二、架构设计

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CaseBuddy Gateway                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                    Gateway Manager                             │ │
│  │  • 配置加载 (gateways.json)                                    │ │
│  │  • 平台启动/停止                                               │ │
│  │  • 健康检查                                                    │ │
│  │  • 日志管理                                                    │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                              │                                      │
│  ┌───────────────────────────┼───────────────────────────────────┐ │
│  │                    Platform Bots                               │ │
│  │                                                               │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │ │
│  │  │ 企业微信     │  │   飞书      │  │  Telegram   │        │ │
│  │  │ WecomBot    │  │  FeishuBot  │  │  TelegramBot│        │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘        │ │
│  │                                                               │ │
│  └───────────────────────────┬───────────────────────────────────┘ │
│                              │                                      │
│  ┌───────────────────────────┼───────────────────────────────────┐ │
│  │                  Unified Handler                                │ │
│  │                                                               │ │
│  │  • 消息标准化 (toAgentFormat)                                  │ │
│  │  • Markdown 清洗 (适配各平台)                                  │ │
│  │  • 消息分片 (splitByLimit)                                    │ │
│  │  • 流式处理 (streamResponse)                                  │ │
│  │  • 命令处理 (/help, /stop, /new)                             │ │
│  │                                                               │ │
│  └───────────────────────────┬───────────────────────────────────┘ │
│                              │                                      │
│  ┌───────────────────────────┼───────────────────────────────────┐ │
│  │              CaseBuddy LLM Proxy                               │ │
│  │                                                               │ │
│  │            /api/proxy/chat/completions/stream                  │ │
│  │                                                               │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 三、目录结构

```
casebuddy/gateway/
├── index.js                    # 网关入口，管理所有 Bot
├── config.js                   # 配置加载和管理
├── handler.js                  # 统一消息处理器
├── platforms/
│   ├── wecom.js               # 企业微信 Bot
│   ├── feishu.js             # 飞书 Bot
│   └── telegram.js           # Telegram Bot
├── utils/
│   ├── markdown.js           # Markdown 适配工具
│   └── splitter.js           # 消息分片工具
├── config/
│   └── gateways.json         # 网关配置文件
└── logs/                      # 日志目录
```

---

## 四、配置设计

### 4.1 gateways.json 结构

```json
{
  "gateways": {
    "wecom": {
      "enabled": true,
      "botId": "your_bot_id",
      "secret": "your_secret",
      "welcomeMessage": "您好！我是 CaseBuddy MBA 案例分析助手",
      "allowedUsers": ["user_id_1", "user_id_2"],
      "port": 19531
    },
    "feishu": {
      "enabled": false,
      "appId": "your_app_id",
      "appSecret": "your_app_secret",
      "verificationToken": "your_token",
      "encryptKey": "your_encrypt_key",
      "allowedUsers": ["user_id_1"],
      "port": 19529
    },
    "telegram": {
      "enabled": false,
      "botToken": "your_bot_token",
      "allowedUsers": [123456789],
      "webhookUrl": "https://your-domain.com/telegram"
    }
  },
  "llm": {
    "defaultModel": "ecnu-plus",
    "streamDelay": 500,        // 流式消息间隔(ms)
    "maxRetries": 3
  },
  "session": {
    "timeout": 300,            // 会话超时(秒)
    "maxHistory": 20           // 最大历史消息数
  }
}
```

### 4.2 统一 Handler 接口

```typescript
interface GatewayBot {
  /** 平台标识 */
  platform: string;

  /** 启动 Bot */
  start(): Promise<void>;

  /** 停止 Bot */
  stop(): void;

  /** 发送文本消息 */
  sendText(chatId: string, text: string): Promise<void>;

  /** 发送图片 */
  sendImage(chatId: string, imagePath: string): Promise<void>;

  /** 发送文件 */
  sendFile(chatId: string, filePath: string): Promise<void>;
}

interface UnifiedMessage {
  platform: string;           // 来源平台
  chatId: string;            // 对话 ID
  userId: string;            // 用户 ID
  userName?: string;          // 用户名称
  content: string;           // 消息内容
  messageId: string;          // 消息 ID（用于去重）
  timestamp: number;          // 时间戳
  isGroup: boolean;           // 是否群聊
}

interface GatewayHandler {
  /** 处理收到的消息 */
  handleMessage(msg: UnifiedMessage): Promise<void>;

  /** 处理命令 */
  handleCommand(msg: UnifiedMessage, cmd: string): Promise<void>;

  /** 格式化回复（适配平台） */
  formatReply(text: string, platform: string): string;
}
```

---

## 五、平台实现要点

### 5.1 企业微信 (wecom.js)

**技术选型**：`wecom_aibot_sdk` (WebSocket 模式)

```javascript
// 核心流程
import { WSClient } from 'wecom_aibot_sdk';

class WecomBot implements GatewayBot {
  platform = 'wecom';
  private client: WSClient;

  async start() {
    this.client = new WSClient();
    this.client.on('message', this.handleMessage.bind(this));
    await this.client.connect();
  }

  async handleMessage(frame) {
    const unified = this.toUnifiedFormat(frame);
    await gatewayHandler.handleMessage(unified);
  }
}
```

**功能清单**：
- [x] 文本消息收发
- [x] 图片/文件发送
- [x] 用户白名单验证
- [x] Markdown 清洗
- [x] 消息分片
- [x] 流式响应

### 5.2 飞书 (feishu.js)

**技术选型**：`lark-oapi` (WebSocket 长连接)

```javascript
// 核心流程
import * as lark from '@larksuiteoapi/node-sdk';

class FeishuBot implements GatewayBot {
  platform = 'feishu';
  private client: lark.Client;

  async start() {
    this.client = new lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
      loggerLevel: lark.LoggerLevel.info
    });
    // 注册事件处理器
  }
}
```

**功能清单**：
- [x] 文本消息收发
- [x] Markdown 消息
- [x] 消息卡片
- [x] 媒体上传
- [x] 消息去重

### 5.3 Telegram (telegram.js)

**技术选型**：`node-telegram-bot-api` 或 `telegraf`

```javascript
// 核心流程
import TelegramBot from 'node-telegram-bot-api';

class TelegramBotImpl implements GatewayBot {
  platform = 'telegram';
  private bot: TelegramBot;

  async start() {
    this.bot = new TelegramBot(config.botToken, { polling: true });
    this.bot.on('message', this.handleMessage.bind(this));
  }
}
```

**功能清单**：
- [x] 文本消息收发
- [x] MarkdownV2 格式化
- [x] Inline Keyboard
- [x] 命令处理 (/start, /help, /new)
- [x] 流式响应（编辑消息）

---

## 六、Markdown 适配策略

### 6.1 各平台支持对比

| Markdown 特性 | 企业微信 | 飞书 | Telegram | 微信 |
|--------------|---------|------|----------|------|
| **加粗** `**text**` | ✅ | ✅ | ✅ (MarkdownV2) | ✅ |
| *斜体* `*text*` | ✅ | ✅ | ✅ | ✅ |
| `行内代码` | ✅ | ✅ | ✅ | ✅ |
| 代码块 ``` | ✅ | ✅ | ✅ | ⚠️ 渲染差 |
| 链接 `[text](url)` | ✅ | ✅ | ✅ | ⚠️ 显示文本 |
| 图片 `![alt](url)` | ❌ | ✅ | ✅ | ❌ |
| 列表 | ✅ | ✅ | ✅ | ⚠️ |
| 引用 `>` | ✅ | ✅ | ✅ | ✅ |
| 水平线 `---` | ✅ | ✅ | ✅ | ✅ |

### 6.2 清洗函数

```javascript
function cleanMarkdown(text, platform) {
  switch (platform) {
    case 'wecom':
      // 企业微信：移除图片链接
      return text
        .replace(/!\[.*?\]\(.*?\)/g, '')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');

    case 'telegram':
      // Telegram：使用 MarkdownV2 格式
      return text
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '[$1]($2)')
        .replace(/\|/g, '\\|');  // 转义管道符

    case 'feishu':
      // 飞书：使用 Lark 消息格式
      return text;

    default:
      return text;
  }
}
```

---

## 七、消息分片策略

```javascript
function splitMessage(text, limit = 1500) {
  const parts = [];
  while (text.length > limit) {
    // 优先在换行处切割
    let cut = text.lastIndexOf('\n', limit);
    if (cut < limit * 0.6) {
      cut = limit;
    }
    parts.push(text.slice(0, cut).trim());
    text = text.slice(cut).trim();
  }
  if (text) {
    parts.push(text);
  }
  return parts;
}
```

---

## 八、流式响应处理

```javascript
async function streamResponse(chatId, stream, sender) {
  let buffer = '';
  const streamDelay = config.llm.streamDelay || 500;

  for await (const chunk of stream) {
    buffer += chunk;
    // 每 500ms 或积累足够字符再发送
    if (buffer.length >= 200) {
      const parts = splitMessage(buffer, 1500);
      for (const part of parts) {
        await sender.sendText(chatId, cleanMarkdown(part, platform));
        await sleep(streamDelay);
      }
      buffer = '';
    }
  }

  // 发送剩余内容
  if (buffer) {
    const parts = splitMessage(buffer, 1500);
    for (const part of parts) {
      await sender.sendText(chatId, cleanMarkdown(part, platform));
      await sleep(streamDelay);
    }
  }
}
```

---

## 九、命令系统

| 命令 | 说明 | 示例 |
|------|------|------|
| `/help` | 显示帮助 | `/help` |
| `/new` | 开启新会话 | `/new` |
| `/stop` | 停止当前任务 | `/stop` |
| `/status` | 查看状态 | `/status` |
| `/model <name>` | 切换模型 | `/model ecnu-plus` |

---

## 十、实施计划

### Phase 1: 核心框架 (1-2天)
- [ ] 创建目录结构
- [ ] 实现配置加载
- [ ] 实现统一 Handler
- [ ] 实现 Markdown 清洗
- [ ] 实现消息分片

### Phase 2: 企业微信 Bot (2-3天)
- [ ] 安装 wecom_aibot_sdk
- [ ] 实现 WecomBot 类
- [ ] 实现消息收发
- [ ] 实现流式响应
- [ ] 集成测试

### Phase 3: 飞书 Bot (2-3天)
- [ ] 安装 lark-oapi
- [ ] 实现 FeishuBot 类
- [ ] 实现消息卡片
- [ ] 集成测试

### Phase 4: Web UI 配置 (2天)
- [ ] 添加网关配置页面
- [ ] 实现配置持久化
- [ ] 实现启动/停止按钮
- [ ] 实现状态显示

### Phase 5: Telegram Bot (可选)
- [ ] 安装 node-telegram-bot-api
- [ ] 实现 TelegramBot 类
- [ ] Webhook 配置

---

## 十一、依赖清单

```json
{
  "dependencies": {
    "wecom_aibot_sdk": "^1.0.0",
    "@larksuiteoapi/node-sdk": "^1.5.0",
    "node-telegram-bot-api": "^0.64.0"
  }
}
```

---

*文档版本：v1.0*
*最后更新：2026-05-20*
