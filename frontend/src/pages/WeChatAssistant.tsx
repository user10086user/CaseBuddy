/**
 * 微信助手页面
 * 提供：
 * 1. AI 对话 - 直接和 AI 聊天
 * 2. 内容推送 - 将分析结果一键发送到微信
 * 3. 推送记录 - 查看历史推送内容
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send, Bot, User, RefreshCw, CheckCircle, XCircle, Smartphone,
  MessageSquare, AlertCircle, Copy, Check, Upload, FileText, Loader2,
  Wifi, WifiOff, ChevronDown, ChevronUp, Paperclip, X as XIcon, Trash2,
  History, Clock, Eye, SendHorizonal
} from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';
const STORAGE_KEY = 'casebuddy_wx_messages';

// 从 localStorage 加载聊天记录
function loadMessages(): WxMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

// 保存聊天记录到 localStorage
function saveMessages(msgs: WxMessage[]) {
  try {
    const trimmed = msgs.slice(-200);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch { /* ignore */ }
}

interface WxMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  time: string;
}

interface PushRecord {
  id: string;
  time: string;
  title: string;
  content: string;
  contentFull?: string;
  to_user_id?: string;
  status: 'ok' | 'failed';
  segments?: number;
  message?: string;
}

export default function WeChatAssistant() {
  const [messages, setMessages] = useState<WxMessage[]>(loadMessages);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [wxStatus, setWxStatus] = useState<'unknown' | 'logged_in' | 'not_logged_in'>('unknown');
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pushMode, setPushMode] = useState<'chat' | 'push' | 'history'>('chat');
  const [pushContent, setPushContent] = useState('');
  const [pushTitle, setPushTitle] = useState('');
  const [pushSending, setPushSending] = useState(false);
  const [pushResult, setPushResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 推送记录
  const [pushHistory, setPushHistory] = useState<PushRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<PushRecord | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 加载微信状态
  const loadWxStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/gateway/status`);
      if (res.ok) {
        const data = await res.json();
        const loggedIn = data?.bots?.wechat?.logged_in;
        setWxStatus(loggedIn ? 'logged_in' : 'not_logged_in');
      }
    } catch {
      setWxStatus('not_logged_in');
    } finally {
      setLoading(false);
    }
  }, []);

  // 加载推送历史
  const loadPushHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/gateway/push-history`);
      if (res.ok) {
        const data = await res.json();
        setPushHistory(Array.isArray(data) ? data : []);
      }
    } catch {
      // 静默失败
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWxStatus();
    const interval = setInterval(loadWxStatus, 10000);
    return () => clearInterval(interval);
  }, [loadWxStatus]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 切换到 history tab 时自动加载
  useEffect(() => {
    if (pushMode === 'history') {
      loadPushHistory();
    }
  }, [pushMode, loadPushHistory]);

  // 持久化聊天记录
  useEffect(() => {
    if (messages.length > 0) {
      saveMessages(messages);
    }
  }, [messages]);

  // 发送聊天消息
  const handleSend = async () => {
    if (!input.trim() || sending) return;
    const text = input.trim();
    setInput('');
    setSending(true);

    const userMsg: WxMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages(prev => [...prev, userMsg]);

    try {
      const res = await fetch(`${API_BASE}/gateway/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });

      let replyText = '处理失败，请重试。';
      if (res.ok) {
        const data = await res.json();
        replyText = data.response || data.error || replyText;
      } else {
        try {
          const errData = await res.json();
          replyText = `错误: ${errData.error || res.statusText}`;
        } catch {
          replyText = `请求失败 (${res.status})，请检查后端服务是否运行。`;
        }
      }

      if (wxStatus !== 'logged_in') {
        replyText += '\n\n---\n💡 *当前为本地预览模式，消息未推送到微信。扫码登录后可自动推送。*';
      }

      const aiMsg: WxMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: replyText,
        time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch {
      const aiMsg: WxMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: '网络错误，请检查后端服务（localhost:3001）是否运行。',
        time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages(prev => [...prev, aiMsg]);
    }

    setSending(false);
    inputRef.current?.focus();
  };

  // 推送内容到微信
  const handlePush = async () => {
    if (!pushContent.trim() || pushSending) return;
    if (wxStatus !== 'logged_in') {
      setPushResult({ type: 'error', text: '请先在「消息网关」页面扫码登录微信' });
      return;
    }

    setPushSending(true);
    setPushResult(null);

    try {
      const res = await fetch(`${API_BASE}/gateway/push-wechat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: pushContent.trim(),
          title: pushTitle.trim() || undefined,
        }),
      });

      if (res.ok) {
        setPushResult({ type: 'success', text: '推送成功！微信已收到消息' });
        setPushContent('');
        setPushTitle('');
      } else {
        const data = await res.json();
        setPushResult({ type: 'error', text: `推送失败: ${data.error || '未知错误'}` });
      }
    } catch {
      setPushResult({ type: 'error', text: '网络错误，请检查服务是否运行' });
    }

    setPushSending(false);
  };

  const copyMessage = (id: string, content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-surface-200 bg-white flex-shrink-0">
        <h1 className="text-xl font-bold text-surface-900 flex items-center gap-3">
          <MessageSquare className="w-6 h-6 text-green-500" />
          微信助手
        </h1>
        <p className="text-surface-600 text-sm mt-1">
          在此对话，自动推送到微信 · 也可将分析结果一键发送到微信
        </p>
      </div>

      {/* 微信状态栏 */}
      <div className="px-6 py-3 bg-surface-50 border-b border-surface-200 flex items-center gap-3 flex-shrink-0">
        <div className={`w-2.5 h-2.5 rounded-full ${wxStatus === 'logged_in' ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
        {loading ? (
          <span className="text-sm text-surface-500 flex items-center gap-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> 检测微信状态...
          </span>
        ) : wxStatus === 'logged_in' ? (
          <span className="text-sm text-green-700 flex items-center gap-1">
            <Smartphone className="w-3.5 h-3.5" /> 微信已连接 · 消息将自动推送
          </span>
        ) : (
          <span className="text-sm text-amber-700 flex items-center gap-1">
            <WifiOff className="w-3.5 h-3.5" />
            本地预览模式（AI对话可用，推送需
            <a href="/gateway" className="text-blue-600 underline font-medium" onClick={(e) => { e.preventDefault(); window.location.href = '/gateway'; }}>扫码登录微信</a>
            ）
          </span>
        )}
        <button
          onClick={() => {
            setMessages([]);
            localStorage.removeItem(STORAGE_KEY);
          }}
          className="text-surface-400 hover:text-red-500 transition-colors mr-1"
          title="清空聊天记录"
        >
          <Trash2 className="w-4 h-4" />
        </button>
        <button
          onClick={loadWxStatus}
          className="ml-auto text-surface-400 hover:text-surface-600 transition-colors"
          title="刷新状态"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Tab 切换 */}
      <div className="px-6 py-2 border-b border-surface-200 bg-white flex gap-2 flex-shrink-0">
        <button
          onClick={() => setPushMode('chat')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            pushMode === 'chat'
              ? 'bg-green-100 text-green-700 border border-green-200'
              : 'text-surface-600 hover:bg-surface-100'
          }`}
        >
          <span className="flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5" /> AI 对话</span>
        </button>
        <button
          onClick={() => setPushMode('push')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            pushMode === 'push'
              ? 'bg-blue-100 text-blue-700 border border-blue-200'
              : 'text-surface-600 hover:bg-surface-100'
          }`}
        >
          <span className="flex items-center gap-1.5"><SendHorizonal className="w-3.5 h-3.5" /> 推送内容</span>
        </button>
        <button
          onClick={() => setPushMode('history')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            pushMode === 'history'
              ? 'bg-purple-100 text-purple-700 border border-purple-200'
              : 'text-surface-600 hover:bg-surface-100'
          }`}
        >
          <span className="flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> 推送记录</span>
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {pushMode === 'chat' ? (
          /* ========== AI 对话模式 ========== */
          <>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <Bot className="w-12 h-12 text-surface-300 mb-3" />
                  <p className="text-surface-500 font-medium">开始对话</p>
                  <p className="text-surface-400 text-sm mt-1">
                    {wxStatus === 'logged_in'
                      ? '发送消息会自动推送到已登录的微信'
                      : '当前为本地预览模式，AI 对话正常可用'}
                  </p>
                  <div className="mt-4 bg-surface-50 rounded-lg p-4 text-sm text-surface-600 max-w-md">
                    <p className="font-medium text-surface-700 mb-2">快捷问题示例：</p>
                    <ul className="space-y-1 text-left">
                      <li>• "帮我分析这个公司的商业模式"</li>
                      <li>• "生成一份 SWOT 分析"</li>
                      <li>• "给我讲讲波特五力模型"</li>
                    </ul>
                  </div>
                </div>
              )}

              {messages.map((msg) => (
                <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    msg.role === 'user' ? 'bg-blue-500 text-white' : 'bg-green-100 text-green-600'
                  }`}>
                    {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                  </div>
                  <div className={`max-w-[75%] ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col`}>
                    <div className={`rounded-2xl px-4 py-2.5 ${
                      msg.role === 'user'
                        ? 'bg-blue-500 text-white rounded-tr-sm'
                        : 'bg-surface-100 text-surface-800 rounded-tl-sm'
                    }`}>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-surface-400">{msg.time}</span>
                      <button
                        onClick={() => copyMessage(msg.id, msg.content)}
                        className="text-surface-400 hover:text-surface-600 transition-colors"
                        title="复制"
                      >
                        {copiedId === msg.id ? (
                          <Check className="w-3 h-3 text-green-500" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {sending && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div className="bg-surface-100 rounded-2xl rounded-tl-sm px-4 py-3">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-surface-400 rounded-full animate-bounce" />
                      <span className="w-1.5 h-1.5 bg-surface-400 rounded-full animate-bounce [animation-delay:0.15s]" />
                      <span className="w-1.5 h-1.5 bg-surface-400 rounded-full animate-bounce [animation-delay:0.3s]" />
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <div className="px-6 py-4 border-t border-surface-200 bg-white flex-shrink-0">
              <div className="flex gap-3 items-end">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="输入消息，按 Enter 发送..."
                  rows={2}
                  className="flex-1 px-4 py-2.5 border border-surface-300 rounded-xl resize-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors text-sm"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || sending}
                  className="px-5 py-2.5 bg-green-500 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl transition-colors flex items-center gap-2 flex-shrink-0"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {sending ? '发送中' : '发送'}
                </button>
              </div>
              <p className="text-xs text-surface-400 mt-2">
                Enter 发送 · Shift+Enter 换行
              </p>
            </div>
          </>
        ) : pushMode === 'push' ? (
          /* ========== 内容推送模式 ========== */
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="max-w-2xl mx-auto">
              <div className="bg-blue-50 rounded-xl p-4 mb-4 border border-blue-100 flex gap-3">
                <AlertCircle className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-800">
                  <p className="font-medium">一键推送到微信</p>
                  <p className="mt-1">将分析报告、PPT 内容或任意文本快速发送到微信。</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-surface-700 mb-1.5">
                    标题（可选，发送时作为前缀）
                  </label>
                  <input
                    type="text"
                    value={pushTitle}
                    onChange={e => setPushTitle(e.target.value)}
                    placeholder="例如：亿航智能案例分析报告"
                    className="w-full px-4 py-2.5 border border-surface-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-surface-700 mb-1.5">
                    内容
                  </label>
                  <textarea
                    value={pushContent}
                    onChange={e => setPushContent(e.target.value)}
                    placeholder="粘贴要发送的内容（支持 Markdown）..."
                    rows={14}
                    className="w-full px-4 py-2.5 border border-surface-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-sm resize-none font-mono"
                  />
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-xs text-surface-400">
                      {pushContent.length} 字符 · 将自动分段发送（每段≤1800字）
                    </span>
                  </div>
                </div>

                {pushResult && (
                  <div className={`p-4 rounded-lg flex items-center gap-3 ${
                    pushResult.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
                  }`}>
                    {pushResult.type === 'success' ? (
                      <CheckCircle className="w-5 h-5 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-5 h-5 flex-shrink-0" />
                    )}
                    {pushResult.text}
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={handlePush}
                    disabled={!pushContent.trim() || pushSending || wxStatus !== 'logged_in'}
                    className="flex-1 px-6 py-3 bg-green-500 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl transition-colors flex items-center justify-center gap-2 font-medium"
                  >
                    {pushSending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        推送中...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        发送到微信
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => { setPushContent(''); setPushTitle(''); setPushResult(null); }}
                    className="px-4 py-3 border border-surface-300 rounded-xl hover:bg-surface-50 transition-colors text-surface-600 text-sm"
                  >
                    清空
                  </button>
                </div>

                {wxStatus !== 'logged_in' && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    请先在「消息网关」页面扫码登录微信，才能推送消息
                  </div>
                )}

                <div className="border border-dashed border-surface-300 rounded-lg p-4 text-center">
                  <p className="text-sm text-surface-500 mb-2">快速粘贴</p>
                  <button
                    onClick={async () => {
                      try {
                        const text = await navigator.clipboard.readText();
                        if (text) {
                          setPushContent(text);
                          setPushResult(null);
                        }
                      } catch {
                        setPushResult({ type: 'error', text: '无法读取剪贴板，请手动粘贴' });
                      }
                    }}
                    className="px-4 py-2 bg-surface-100 hover:bg-surface-200 rounded-lg text-sm text-surface-700 transition-colors flex items-center gap-2 mx-auto"
                  >
                    <Paperclip className="w-4 h-4" />
                    从剪贴板粘贴
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ========== 推送记录模式 ========== */
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="max-w-2xl mx-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-surface-800 flex items-center gap-2">
                  <History className="w-5 h-5 text-purple-500" />
                  推送记录
                </h2>
                <button
                  onClick={loadPushHistory}
                  disabled={historyLoading}
                  className="text-sm text-surface-500 hover:text-surface-700 transition-colors flex items-center gap-1"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${historyLoading ? 'animate-spin' : ''}`} />
                  刷新
                </button>
              </div>

              {historyLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 text-surface-400 animate-spin" />
                </div>
              ) : pushHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <FileText className="w-12 h-12 text-surface-300 mb-3" />
                  <p className="text-surface-500 font-medium">暂无推送记录</p>
                  <p className="text-surface-400 text-sm mt-1">推送内容到微信后，记录会显示在这里</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {[...pushHistory].reverse().map((record) => (
                    <div
                      key={record.id}
                      className="bg-white border border-surface-200 rounded-xl p-4 hover:shadow-md hover:border-purple-200 transition-all cursor-pointer group"
                      onClick={() => setSelectedRecord(record)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              record.status === 'ok'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-red-100 text-red-700'
                            }`}>
                              {record.status === 'ok' ? (
                                <><CheckCircle className="w-3 h-3 mr-0.5" /> 成功</>
                              ) : (
                                <><XCircle className="w-3 h-3 mr-0.5" /> 失败</>
                              )}
                            </span>
                            <span className="text-xs text-surface-400 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {record.time}
                            </span>
                            {record.segments && (
                              <span className="text-xs text-surface-400">
                                {record.segments} 段
                              </span>
                            )}
                          </div>
                          <p className="text-sm font-medium text-surface-800 truncate">
                            {record.title}
                          </p>
                          <p className="text-xs text-surface-500 mt-1 line-clamp-2">
                            {record.content}
                          </p>
                        </div>
                        <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Eye className="w-4 h-4 text-purple-500" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 推送记录详情弹窗 */}
      {selectedRecord && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedRecord(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-2xl w-full max-h-[80vh] flex flex-col shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200">
              <div>
                <h3 className="text-lg font-semibold text-surface-900">{selectedRecord.title}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    selectedRecord.status === 'ok'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-red-100 text-red-700'
                  }`}>
                    {selectedRecord.status === 'ok' ? '推送成功' : '推送失败'}
                  </span>
                  <span className="text-xs text-surface-400">{selectedRecord.time}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedRecord(null)}
                className="p-2 hover:bg-surface-100 rounded-lg transition-colors"
              >
                <XIcon className="w-5 h-5 text-surface-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="bg-surface-50 rounded-xl p-4 border border-surface-200">
                <p className="text-sm text-surface-800 whitespace-pre-wrap leading-relaxed">
                  {selectedRecord.contentFull || selectedRecord.content}
                </p>
              </div>
            </div>
            <div className="px-6 py-3 border-t border-surface-200 flex justify-end gap-2">
              <button
                onClick={() => {
                  copyMessage(selectedRecord.id, selectedRecord.contentFull || selectedRecord.content);
                }}
                className="px-4 py-2 bg-surface-100 hover:bg-surface-200 rounded-lg text-sm text-surface-700 transition-colors flex items-center gap-2"
              >
                {copiedId === selectedRecord.id ? (
                  <><Check className="w-4 h-4 text-green-500" /> 已复制</>
                ) : (
                  <><Copy className="w-4 h-4" /> 复制内容</>
                )}
              </button>
              <button
                onClick={() => setSelectedRecord(null)}
                className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg text-sm transition-colors"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
