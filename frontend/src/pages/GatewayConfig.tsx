/**
 * 消息网关配置页面
 * 支持微信、QQ、飞书、企业微信四个平台
 */

import { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Power,
  Save,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertCircle,
  Zap,
  Hash,
  Key,
  User,
  QrCode,
  LogOut,
  Smartphone,
  MessageCircle,
  Send
} from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

interface BotStatus {
  enabled: boolean;
  logged_in: boolean;
  appId?: string;
  allowedUsers?: string[];
}

interface GatewayStatus {
  running: boolean;
  connectedPlatforms: string[];
  totalMessages: number;
  bots: {
    wechat: BotStatus;
    qq: BotStatus;
    feishu: BotStatus;
    wecom: BotStatus;
  };
}

interface GatewayConfig {
  gateways: {
    wechat: BotStatus;
    qq: { enabled: boolean; appId?: string; allowedUsers?: string[] };
    feishu: { enabled: boolean; appId?: string; allowedUsers?: string[] };
    wecom: { enabled: boolean; hasCredentials?: boolean };
  };
}

export default function GatewayConfig() {
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [config, setConfig] = useState<GatewayConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const qrPollingRef = useRef<NodeJS.Timeout | null>(null);

  // 各平台配置状态
  const [qqConfig, setQqConfig] = useState({
    enabled: false,
    appId: '',
    secret: '',
    allowedUsers: ''
  });

  const [feishuConfig, setFeishuConfig] = useState({
    enabled: false,
    appId: '',
    secret: '',
    allowedUsers: ''
  });

  const [wecomConfig, setWecomConfig] = useState({
    enabled: false,
    botId: '',
    secret: '',
    welcomeMessage: '您好！我是 CaseBuddy MBA 案例分析助手，请问有什么可以帮您？'
  });

  // 加载数据
  useEffect(() => {
    loadData();
    return () => {
      if (qrPollingRef.current) {
        clearInterval(qrPollingRef.current);
      }
    };
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [statusRes, configRes] = await Promise.all([
        fetch(`${API_BASE}/gateway/status`),
        fetch(`${API_BASE}/gateway/config`)
      ]);

      if (statusRes.ok) {
        setStatus(await statusRes.json());
      }
      if (configRes.ok) {
        const cfg = await configRes.json();
        setConfig(cfg);
        // 填充表单
        if (cfg.gateways?.qq) {
          setQqConfig(prev => ({
            ...prev,
            enabled: cfg.gateways.qq.enabled,
            appId: cfg.gateways.qq.appId || ''
          }));
        }
        if (cfg.gateways?.feishu) {
          setFeishuConfig(prev => ({
            ...prev,
            enabled: cfg.gateways.feishu.enabled,
            appId: cfg.gateways.feishu.appId || ''
          }));
        }
        if (cfg.gateways?.wecom) {
          setWecomConfig(prev => ({
            ...prev,
            enabled: cfg.gateways.wecom.enabled
          }));
        }
      }
    } catch (error) {
      console.error('加载网关数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  // 通用保存函数
  const saveConfig = async (platform: string, data: any) => {
    setSaving(platform);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/gateway/config/${platform}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (res.ok) {
        setMessage({ type: 'success', text: '✅ 配置保存成功！' });
        await loadData();
      } else {
        const error = await res.json();
        setMessage({ type: 'error', text: `❌ 保存失败: ${error.error}` });
      }
    } catch (error) {
      setMessage({ type: 'error', text: '❌ 网络错误，请检查后端服务是否运行' });
    } finally {
      setSaving(null);
    }
  };

  // 启动网关
  const startGateway = async () => {
    try {
      const res = await fetch(`${API_BASE}/gateway/start`, { method: 'POST' });
      if (res.ok) {
        setMessage({ type: 'success', text: '✅ 网关启动成功！' });
        await loadData();
      }
    } catch (error) {
      setMessage({ type: 'error', text: '❌ 启动失败' });
    }
  };

  // 停止网关
  const stopGateway = async () => {
    try {
      const res = await fetch(`${API_BASE}/gateway/stop`, { method: 'POST' });
      if (res.ok) {
        setMessage({ type: 'success', text: '✅ 网关已停止' });
        await loadData();
      }
    } catch (error) {
      setMessage({ type: 'error', text: '❌ 停止失败' });
    }
  };

  // 微信扫码登录
  const handleWechatLogin = async () => {
    setQrLoading(true);
    setMessage(null);
    try {
      // 先保存微信配置
      await saveConfig('wechat', { enabled: true });

      // 启动微信 Bot
      const res = await fetch(`${API_BASE}/gateway/start/wechat`, { method: 'POST' });
      if (res.ok) {
        setMessage({ type: 'success', text: '✅ 请用微信扫描弹出的二维码' });
        // 启动轮询获取二维码
        startQrPolling();
      }
    } catch (error) {
      setMessage({ type: 'error', text: '❌ 启动微信 Bot 失败' });
    } finally {
      setQrLoading(false);
    }
  };

  // 轮询获取二维码
  const startQrPolling = () => {
    qrPollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/gateway/qrcode`);
        if (res.ok && res.headers.get('content-type')?.includes('image')) {
          // 是图片，直接设置 URL（浏览器会自动处理缓存）
          setQrCodeUrl(`${API_BASE}/gateway/qrcode?t=${Date.now()}`);
        }
      } catch {
        // ignore
      }
    }, 3000);
  };

  // 退出微信登录
  const handleWechatLogout = async () => {
    try {
      await fetch(`${API_BASE}/gateway/logout/wechat`, { method: 'POST' });
      setQrCodeUrl(null);
      setMessage({ type: 'success', text: '✅ 已退出微信登录' });
      await loadData();
    } catch (error) {
      setMessage({ type: 'error', text: '❌ 退出失败' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-accent-500 mx-auto mb-4" />
          <p className="text-surface-600">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-surface-900 flex items-center gap-3">
          <MessageSquare className="w-7 h-7 text-accent-500" />
          消息网关配置
        </h1>
        <p className="text-surface-600 mt-2">
          配置微信、QQ、飞书等消息平台，接收消息并自动回复
        </p>
      </div>

      {/* 消息提示 */}
      {message && (
        <div
          className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
            message.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
          ) : (
            <XCircle className="w-5 h-5 flex-shrink-0" />
          )}
          {message.text}
        </div>
      )}

      {/* 网关状态卡片 */}
      <div className="bg-white rounded-xl shadow-sm border border-surface-200 p-6 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div
              className={`w-12 h-12 rounded-full flex items-center justify-center ${
                status?.running
                  ? 'bg-green-100 text-green-600'
                  : 'bg-surface-100 text-surface-400'
              }`}
            >
              {status?.running ? (
                <Zap className="w-6 h-6" />
              ) : (
                <Power className="w-6 h-6" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-surface-900">网关状态</h2>
              <p className="text-surface-600">
                {status?.running ? (
                  <span className="text-green-600 font-medium">运行中</span>
                ) : (
                  <span className="text-surface-500">已停止</span>
                )}
                {status?.connectedPlatforms?.length > 0 && (
                  <span className="ml-2">
                    · 已连接: {status.connectedPlatforms.join(', ')}
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            {status?.running ? (
              <button
                onClick={stopGateway}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                <XCircle className="w-4 h-4" />
                停止
              </button>
            ) : (
              <button
                onClick={startGateway}
                className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                <Power className="w-4 h-4" />
                启动
              </button>
            )}
            <button
              onClick={loadData}
              className="px-4 py-2 bg-surface-100 hover:bg-surface-200 text-surface-700 rounded-lg transition-colors flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              刷新
            </button>
          </div>
        </div>
      </div>

      {/* 平台配置卡片 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 微信配置 */}
        <div className="bg-white rounded-xl shadow-sm border border-surface-200 overflow-hidden">
          <div className="p-5 border-b border-surface-200 bg-gradient-to-r from-green-50 to-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-500 text-white flex items-center justify-center">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-surface-900 flex items-center gap-2">
                    微信
                    {status?.bots?.wechat?.logged_in && (
                      <span className="w-2 h-2 rounded-full bg-green-500" title="已登录" />
                    )}
                  </h3>
                  <p className="text-sm text-surface-600">扫码登录个人微信</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={status?.bots?.wechat?.logged_in || false}
                  onChange={() => {}}
                  disabled
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-surface-200 rounded-full peer peer-checked:bg-green-500"></div>
              </label>
            </div>
          </div>

          <div className="p-5">
            {status?.bots?.wechat?.logged_in ? (
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-green-100 text-green-500 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8" />
                </div>
                <p className="text-green-600 font-medium mb-4">已登录微信</p>
                <button
                  onClick={handleWechatLogout}
                  className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-colors flex items-center gap-2 mx-auto"
                >
                  <LogOut className="w-4 h-4" />
                  退出登录
                </button>
              </div>
            ) : (
              <div className="text-center">
                {qrCodeUrl ? (
                  <div className="mb-4">
                    <img
                      src={qrCodeUrl}
                      alt="微信登录二维码"
                      className="w-48 h-48 mx-auto border border-surface-200 rounded-lg"
                    />
                    <p className="text-sm text-surface-500 mt-2">请用微信扫描上方二维码</p>
                  </div>
                ) : (
                  <div className="mb-4">
                    <QrCode className="w-16 h-16 text-surface-300 mx-auto mb-3" />
                    <p className="text-sm text-surface-500">点击下方按钮获取登录二维码</p>
                  </div>
                )}
                <button
                  onClick={handleWechatLogin}
                  disabled={qrLoading}
                  className="px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors flex items-center gap-2 mx-auto disabled:opacity-50"
                >
                  {qrLoading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <QrCode className="w-4 h-4" />
                  )}
                  {qrLoading ? '准备中...' : '扫码登录'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* QQ 配置 */}
        <div className="bg-white rounded-xl shadow-sm border border-surface-200 overflow-hidden">
          <div className="p-5 border-b border-surface-200 bg-gradient-to-r from-blue-50 to-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500 text-white flex items-center justify-center">
                  <MessageCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-surface-900 flex items-center gap-2">
                    QQ
                    {status?.bots?.qq?.logged_in && (
                      <span className="w-2 h-2 rounded-full bg-green-500" title="已登录" />
                    )}
                  </h3>
                  <p className="text-sm text-surface-600">WebSocket 长连接</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={qqConfig.enabled}
                  onChange={(e) => setQqConfig({ ...qqConfig, enabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-surface-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-blue-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all"></div>
              </label>
            </div>
          </div>

          <div className="p-5 space-y-4">
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-surface-700 mb-2">
                <Hash className="w-4 h-4" />
                App ID
              </label>
              <input
                type="text"
                value={qqConfig.appId}
                onChange={(e) => setQqConfig({ ...qqConfig, appId: e.target.value })}
                placeholder="在 QQ 开放平台创建机器人获取"
                className="w-full px-4 py-2.5 border border-surface-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-sm"
              />
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-surface-700 mb-2">
                <Key className="w-4 h-4" />
                App Secret
              </label>
              <input
                type="password"
                value={qqConfig.secret}
                onChange={(e) => setQqConfig({ ...qqConfig, secret: e.target.value })}
                placeholder="应用密钥"
                className="w-full px-4 py-2.5 border border-surface-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-sm"
              />
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-surface-700 mb-2">
                <User className="w-4 h-4" />
                允许的用户 OpenID（逗号分隔，留空公开）
              </label>
              <input
                type="text"
                value={qqConfig.allowedUsers}
                onChange={(e) => setQqConfig({ ...qqConfig, allowedUsers: e.target.value })}
                placeholder="ou_xxx, ou_yyy 或留空"
                className="w-full px-4 py-2.5 border border-surface-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-sm"
              />
            </div>
            <button
              onClick={() => saveConfig('qq', {
                enabled: qqConfig.enabled,
                appId: qqConfig.appId,
                secret: qqConfig.secret,
                allowedUsers: qqConfig.allowedUsers ? qqConfig.allowedUsers.split(',').map(s => s.trim()) : []
              })}
              disabled={saving === 'qq' || !qqConfig.appId}
              className="w-full px-4 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {saving === 'qq' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              保存配置
            </button>
          </div>
        </div>

        {/* 飞书配置 */}
        <div className="bg-white rounded-xl shadow-sm border border-surface-200 overflow-hidden">
          <div className="p-5 border-b border-surface-200 bg-gradient-to-r from-blue-50 to-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-600 text-white flex items-center justify-center">
                  <Send className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-surface-900 flex items-center gap-2">
                    飞书
                    {status?.bots?.feishu?.logged_in && (
                      <span className="w-2 h-2 rounded-full bg-green-500" title="已登录" />
                    )}
                  </h3>
                  <p className="text-sm text-surface-600">Lark 开放平台</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={feishuConfig.enabled}
                  onChange={(e) => setFeishuConfig({ ...feishuConfig, enabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-surface-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all"></div>
              </label>
            </div>
          </div>

          <div className="p-5 space-y-4">
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-surface-700 mb-2">
                <Hash className="w-4 h-4" />
                App ID (cli_xxx)
              </label>
              <input
                type="text"
                value={feishuConfig.appId}
                onChange={(e) => setFeishuConfig({ ...feishuConfig, appId: e.target.value })}
                placeholder="cli_xxxxxxxxxxxxxxxx"
                className="w-full px-4 py-2.5 border border-surface-300 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-blue-600 transition-colors text-sm"
              />
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-surface-700 mb-2">
                <Key className="w-4 h-4" />
                App Secret
              </label>
              <input
                type="password"
                value={feishuConfig.secret}
                onChange={(e) => setFeishuConfig({ ...feishuConfig, secret: e.target.value })}
                placeholder="应用密钥"
                className="w-full px-4 py-2.5 border border-surface-300 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-blue-600 transition-colors text-sm"
              />
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-surface-700 mb-2">
                <User className="w-4 h-4" />
                允许的用户 OpenID（逗号分隔，留空公开）
              </label>
              <input
                type="text"
                value={feishuConfig.allowedUsers}
                onChange={(e) => setFeishuConfig({ ...feishuConfig, allowedUsers: e.target.value })}
                placeholder="ou_xxx, ou_yyy 或留空"
                className="w-full px-4 py-2.5 border border-surface-300 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-blue-600 transition-colors text-sm"
              />
            </div>
            <button
              onClick={() => saveConfig('feishu', {
                enabled: feishuConfig.enabled,
                appId: feishuConfig.appId,
                secret: feishuConfig.secret,
                allowedUsers: feishuConfig.allowedUsers ? feishuConfig.allowedUsers.split(',').map(s => s.trim()) : []
              })}
              disabled={saving === 'feishu' || !feishuConfig.appId}
              className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {saving === 'feishu' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              保存配置
            </button>
          </div>
        </div>

        {/* 企业微信配置 */}
        <div className="bg-white rounded-xl shadow-sm border border-surface-200 overflow-hidden">
          <div className="p-5 border-b border-surface-200 bg-gradient-to-r from-green-50 to-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-600 text-white flex items-center justify-center">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-surface-900 flex items-center gap-2">
                    企业微信
                    {status?.bots?.wecom?.logged_in && (
                      <span className="w-2 h-2 rounded-full bg-green-500" title="已登录" />
                    )}
                  </h3>
                  <p className="text-sm text-surface-600">企业微信机器人</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={wecomConfig.enabled}
                  onChange={(e) => setWecomConfig({ ...wecomConfig, enabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-surface-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-green-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all"></div>
              </label>
            </div>
          </div>

          <div className="p-5 space-y-4">
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-surface-700 mb-2">
                <Hash className="w-4 h-4" />
                应用 AgentId
              </label>
              <input
                type="text"
                value={wecomConfig.botId}
                onChange={(e) => setWecomConfig({ ...wecomConfig, botId: e.target.value })}
                placeholder="wwxxxxxxxxxxxxxxx"
                className="w-full px-4 py-2.5 border border-surface-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors text-sm"
              />
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-surface-700 mb-2">
                <Key className="w-4 h-4" />
                应用 Secret
              </label>
              <input
                type="password"
                value={wecomConfig.secret}
                onChange={(e) => setWecomConfig({ ...wecomConfig, secret: e.target.value })}
                placeholder="应用密钥"
                className="w-full px-4 py-2.5 border border-surface-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors text-sm"
              />
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-surface-700 mb-2">
                <User className="w-4 h-4" />
                欢迎消息
              </label>
              <textarea
                value={wecomConfig.welcomeMessage}
                onChange={(e) => setWecomConfig({ ...wecomConfig, welcomeMessage: e.target.value })}
                rows={2}
                placeholder="首次消息自动回复"
                className="w-full px-4 py-2.5 border border-surface-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors text-sm resize-none"
              />
            </div>
            <button
              onClick={() => saveConfig('wecom', wecomConfig)}
              disabled={saving === 'wecom' || !wecomConfig.botId}
              className="w-full px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {saving === 'wecom' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              保存配置
            </button>
          </div>
        </div>
      </div>

      {/* 配置说明 */}
      <div className="mt-8 bg-blue-50 rounded-xl border border-blue-100 p-6">
        <div className="flex gap-3">
          <AlertCircle className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="font-medium text-blue-900 mb-3">快速配置指南</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-blue-800">
              <div>
                <h5 className="font-medium mb-1">🐧 微信</h5>
                <p>点击「扫码登录」按钮，用微信扫描弹出的二维码即可完成绑定</p>
              </div>
              <div>
                <h5 className="font-medium mb-1">💬 QQ</h5>
                <p>在 <a href="https://q.qq.com" target="_blank" className="underline">QQ开放平台</a> 创建机器人，获取 AppID 和 AppSecret</p>
              </div>
              <div>
                <h5 className="font-medium mb-1">📱 飞书</h5>
                <p>在 <a href="https://open.feishu.cn" target="_blank" className="underline">飞书开放平台</a> 创建应用，开启机器人能力</p>
              </div>
              <div>
                <h5 className="font-medium mb-1">🏢 企业微信</h5>
                <p>在企业微信管理后台创建「企业微信机器人」应用</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
