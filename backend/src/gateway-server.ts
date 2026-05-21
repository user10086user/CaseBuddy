/**
 * 独立网关启动脚本
 * 用于单独启动消息网关（不依赖后端服务器）
 */

import express from 'express';
import cors from 'cors';
import { GatewayManager, loadGatewayConfig, GatewayConfigFile } from './gateway';
import gatewayRoutes from './routes/gateway';

const app = express();
const PORT = process.env.GATEWAY_PORT || 3002;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/gateway', gatewayRoutes);

// Gateway Manager instance (共享)
let gatewayManager: GatewayManager | null = null;

// 导出管理器供路由使用
export function getGatewayManager(): GatewayManager | null {
  return gatewayManager;
}

export function setGatewayManager(manager: GatewayManager | null): void {
  gatewayManager = manager;
}

// 启动函数
async function start() {
  // 加载配置
  const config = loadGatewayConfig();

  if (!config.gateways) {
    console.log('[Gateway Server] 未找到网关配置，请先通过 API 配置网关');
  } else {
    // 创建网关管理器
    gatewayManager = new GatewayManager(config.gateways, {
      llmProxyUrl: config.llm?.proxyUrl || 'http://localhost:3001',
      defaultModel: config.llm?.defaultModel || 'ecnu-plus',
      streamDelay: config.llm?.streamDelay || 500,
      sessionTimeout: config.llm?.sessionTimeout || 300,
      maxHistory: config.llm?.maxHistory || 20
    });

    try {
      await gatewayManager.start();
      console.log('[Gateway Server] ✅ 消息网关已启动');
    } catch (error) {
      console.error('[Gateway Server] ❌ 网关启动失败:', error);
    }
  }

  // 启动 HTTP 服务器（仅用于管理 API）
  app.listen(PORT, () => {
    console.log(`[Gateway Server] HTTP API 运行在 http://localhost:${PORT}`);
    console.log(`[Gateway Server] 管理接口: http://localhost:${PORT}/api/gateway/status`);
  });
}

// 优雅退出
process.on('SIGINT', async () => {
  console.log('\n[Gateway Server] 正在关闭...');
  if (gatewayManager) {
    await gatewayManager.stop();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[Gateway Server] 正在关闭...');
  if (gatewayManager) {
    await gatewayManager.stop();
  }
  process.exit(0);
});

// 启动
start().catch(console.error);
