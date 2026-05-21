/**
 * 智能工作流页面
 * 提供预设模板的多步骤任务编排：案例速读、SWOT分析、深度洞察、PPT大纲、全流程
 * 支持从微信命令触发，结果可推送到微信
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  BookOpen, BarChart3, Lightbulb, Presentation, Zap, Play, Upload,
  CheckCircle, XCircle, Clock, Loader2, ChevronDown, ChevronUp,
  Send, RefreshCw, Trash2, FileText, Smartphone, AlertCircle
} from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

// 图标映射
const iconMap: Record<string, React.FC<any>> = {
  BookOpen, BarChart3, Lightbulb, Presentation, Zap,
};

interface Template {
  id: string;
  name: string;
  description: string;
  icon: string;
  stepCount: number;
}

interface WorkflowStep {
  id: string;
  name: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: { preview?: string; length?: number };
  error?: string;
}

interface Workflow {
  id: string;
  name: string;
  templateId?: string;
  steps: WorkflowStep[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
  results?: Record<string, string>;
}

const statusConfig: Record<string, { icon: React.FC<any>; color: string; label: string }> = {
  pending: { icon: Clock, color: 'text-surface-400', label: '等待中' },
  running: { icon: Loader2, color: 'text-blue-500', label: '执行中' },
  completed: { icon: CheckCircle, color: 'text-emerald-500', label: '已完成' },
  failed: { icon: XCircle, color: 'text-red-500', label: '失败' },
};

const templateColors: Record<string, string> = {
  'quick-read': 'from-emerald-500 to-teal-600',
  'swot': 'from-blue-500 to-indigo-600',
  'deep-insight': 'from-amber-500 to-orange-600',
  'ppt-outline': 'from-fuchsia-500 to-purple-600',
  'full-pipeline': 'from-rose-500 to-red-600',
};

export default function WorkflowPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; text: string; pages: number } | null>(null);
  const [parsedText, setParsedText] = useState('');
  const [workflowName, setWorkflowName] = useState('');
  const [pushToWechat, setPushToWechat] = useState(false);
  const [currentWorkflow, setCurrentWorkflow] = useState<Workflow | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<Workflow[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [activeTab, setActiveTab] = useState<'workflow' | 'history'>('workflow');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 加载模板
  useEffect(() => {
    fetch(`${API_BASE}/workflow/templates`)
      .then(r => r.json())
      .then(data => setTemplates(data.templates || []))
      .catch(() => {});
  }, []);

  // 上传PDF
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const resp = await fetch(`${API_BASE}/parse/file`, {
        method: 'POST',
        body: formData,
      });
      if (!resp.ok) throw new Error(`解析失败: ${resp.status}`);
      const data = await resp.json();
      setUploadedFile({ name: data.filename, text: data.text, pages: data.pageCount || 0 });
      setParsedText(data.text);
      setWorkflowName(data.filename.replace(/\.[^.]+$/, ''));
    } catch (err) {
      alert(`文件上传失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // 执行工作流
  const runWorkflow = async () => {
    if (!selectedTemplate || !parsedText) return;

    setIsRunning(true);
    setExpandedSteps(new Set());

    try {
      // 创建工作流
      const createResp = await fetch(`${API_BASE}/workflow/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: selectedTemplate.id,
          name: workflowName || selectedTemplate.name,
          parsedText,
        }),
      });
      if (!createResp.ok) throw new Error('创建工作流失败');
      const { workflow } = await createResp.json();

      setCurrentWorkflow(workflow);

      // 执行
      const runResp = await fetch(`${API_BASE}/workflow/${workflow.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parsedText }),
      });
      if (!runResp.ok) throw new Error('启动工作流失败');

      // 轮询状态
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const resp = await fetch(`${API_BASE}/workflow/${workflow.id}`);
          if (resp.ok) {
            const data = await resp.json();
            setCurrentWorkflow(data.workflow);

            if (data.workflow.status === 'completed') {
              clearInterval(pollRef.current!);
              pollRef.current = null;
              setIsRunning(false);

              // 自动推送到微信
              if (pushToWechat) {
                handlePushToWechat(workflow.id);
              }
              // 刷新历史
              loadHistory();
            } else if (data.workflow.status === 'failed') {
              clearInterval(pollRef.current!);
              pollRef.current = null;
              setIsRunning(false);
              loadHistory();
            }
          }
        } catch { /* ignore poll errors */ }
      }, 2000);
    } catch (err) {
      alert(`执行失败: ${err instanceof Error ? err.message : '未知错误'}`);
      setIsRunning(false);
    }
  };

  // 推送到微信
  const handlePushToWechat = async (wfId?: string) => {
    const id = wfId || currentWorkflow?.id;
    if (!id) return;

    setPushing(true);
    try {
      const resp = await fetch(`${API_BASE}/workflow/${id}/push`, { method: 'POST' });
      const data = await resp.json();
      if (data.ok) {
        alert('已推送到微信');
      } else {
        alert(`推送失败: ${data.message || data.error || '未知错误'}`);
      }
    } catch (err) {
      alert(`推送失败: ${err instanceof Error ? err.message : '网络错误'}`);
    } finally {
      setPushing(false);
    }
  };

  // 加载历史
  const loadHistory = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/workflow`);
      if (resp.ok) {
        const data = await resp.json();
        setHistory(data.workflows || []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadHistory();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadHistory]);

  // 切换步骤展开
  const toggleStep = (stepId: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  // 重置
  const handleReset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setCurrentWorkflow(null);
    setSelectedTemplate(null);
    setIsRunning(false);
    setExpandedSteps(new Set());
  };

  const getStatusIcon = (status: string) => {
    const cfg = statusConfig[status] || statusConfig.pending;
    const Icon = cfg.icon;
    return <Icon className={`w-4 h-4 ${cfg.color} ${status === 'running' ? 'animate-spin' : ''}`} />;
  };

  return (
    <div className="h-full flex flex-col bg-surface-50">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-surface-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-surface-900 flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500" />
              智能工作流
            </h1>
            <p className="text-sm text-surface-500 mt-1">上传PDF，选择模板，一键完成多步分析</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab(activeTab === 'workflow' ? 'history' : 'workflow')}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                activeTab === 'history'
                  ? 'bg-surface-100 text-surface-700'
                  : 'text-surface-500 hover:bg-surface-100'
              }`}
            >
              <RefreshCw className="w-4 h-4 inline mr-1" />
              历史 ({history.length})
            </button>
            {currentWorkflow && (
              <button onClick={handleReset} className="px-3 py-1.5 text-sm text-surface-500 hover:bg-surface-100 rounded-lg transition-colors">
                重新开始
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {activeTab === 'history' ? (
          <HistoryView history={history} onViewWorkflow={setCurrentWorkflow} onPush={handlePushToWechat} pushing={pushing} />
        ) : (
          <div className="max-w-4xl mx-auto p-6 space-y-6">
            {/* Step 1: 选择模板 */}
            {!currentWorkflow && (
              <section>
                <h2 className="text-sm font-semibold text-surface-500 uppercase tracking-wider mb-3">
                  Step 1 — 选择分析模板
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {templates.map(tpl => {
                    const Icon = iconMap[tpl.icon] || Zap;
                    const gradient = templateColors[tpl.id] || 'from-gray-500 to-gray-600';
                    const isSelected = selectedTemplate?.id === tpl.id;
                    return (
                      <button
                        key={tpl.id}
                        onClick={() => setSelectedTemplate(tpl)}
                        className={`relative text-left p-4 rounded-xl border-2 transition-all duration-200 ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50 shadow-md shadow-blue-100'
                            : 'border-surface-200 bg-white hover:border-surface-300 hover:shadow-sm'
                        }`}
                      >
                        <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center mb-3`}>
                          <Icon className="w-5 h-5 text-white" />
                        </div>
                        <div className="font-semibold text-surface-900 text-sm">{tpl.name}</div>
                        <div className="text-xs text-surface-500 mt-1">{tpl.description}</div>
                        <div className="text-xs text-surface-400 mt-2">{tpl.stepCount} 个步骤</div>
                        {isSelected && (
                          <div className="absolute top-2 right-2">
                            <CheckCircle className="w-5 h-5 text-blue-500" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Step 2: 上传文件 */}
            {!currentWorkflow && selectedTemplate && (
              <section className="animate-fade-in-scale">
                <h2 className="text-sm font-semibold text-surface-500 uppercase tracking-wider mb-3">
                  Step 2 — 上传案例PDF
                </h2>
                <div className="bg-white rounded-xl border border-surface-200 p-6">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.doc,.txt,.md"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  {!uploadedFile ? (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="w-full border-2 border-dashed border-surface-300 rounded-xl p-8 text-center hover:border-blue-400 hover:bg-blue-50/30 transition-all group"
                    >
                      {uploading ? (
                        <Loader2 className="w-8 h-8 text-blue-500 mx-auto animate-spin mb-2" />
                      ) : (
                        <Upload className="w-8 h-8 text-surface-400 mx-auto mb-2 group-hover:text-blue-500 transition-colors" />
                      )}
                      <p className="text-sm text-surface-600 font-medium">
                        {uploading ? '正在解析...' : '点击或拖拽上传PDF文件'}
                      </p>
                      <p className="text-xs text-surface-400 mt-1">支持 PDF / DOCX / TXT / MD</p>
                    </button>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
                          <FileText className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div>
                          <div className="font-medium text-surface-900 text-sm">{uploadedFile.name}</div>
                          <div className="text-xs text-surface-500">
                            {uploadedFile.pages} 页 · {uploadedFile.text.length.toLocaleString()} 字符
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => { setUploadedFile(null); setParsedText(''); }}
                        className="text-surface-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Step 3: 配置 & 执行 */}
            {!currentWorkflow && selectedTemplate && uploadedFile && (
              <section className="animate-fade-in-scale">
                <h2 className="text-sm font-semibold text-surface-500 uppercase tracking-wider mb-3">
                  Step 3 — 配置并执行
                </h2>
                <div className="bg-white rounded-xl border border-surface-200 p-6 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1">工作流名称</label>
                    <input
                      type="text"
                      value={workflowName}
                      onChange={e => setWorkflowName(e.target.value)}
                      placeholder={selectedTemplate.name}
                      className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  {/* 步骤预览 */}
                  <div>
                    <div className="text-xs text-surface-500 mb-2">执行步骤预览</div>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { name: '解析文件', type: 'parse_file' },
                        { name: '构建知识库', type: 'rag_index' },
                        ...(selectedTemplate.id === 'quick-read' ? [{ name: '摘要分析', type: 'llm_analyze' }] : []),
                        ...(selectedTemplate.id === 'swot' ? [{ name: 'SWOT分析', type: 'llm_analyze' }] : []),
                        ...(selectedTemplate.id === 'deep-insight' ? [{ name: '深度分析', type: 'llm_analyze' }] : []),
                        ...(selectedTemplate.id === 'ppt-outline' ? [{ name: 'PPT大纲', type: 'ppt_outline' }] : []),
                        ...(selectedTemplate.id === 'full-pipeline' ? [
                          { name: '案例速读', type: 'llm_analyze' },
                          { name: 'SWOT分析', type: 'llm_analyze' },
                          { name: '深度洞察', type: 'llm_analyze' },
                          { name: 'PPT大纲', type: 'ppt_outline' },
                        ] : []),
                      ].map((step, i) => (
                        <span key={i} className="px-2.5 py-1 bg-surface-100 text-surface-600 rounded-full text-xs">
                          {i + 1}. {step.name}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* 推送开关 */}
                  <label className="flex items-center gap-3 cursor-pointer">
                    <div className={`relative w-10 h-5 rounded-full transition-colors ${pushToWechat ? 'bg-blue-500' : 'bg-surface-300'}`}
                      onClick={() => setPushToWechat(!pushToWechat)}>
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${pushToWechat ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </div>
                    <Smartphone className="w-4 h-4 text-surface-500" />
                    <span className="text-sm text-surface-700">完成后推送到微信</span>
                  </label>

                  <button
                    onClick={runWorkflow}
                    disabled={isRunning || !parsedText}
                    className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-medium hover:from-blue-700 hover:to-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isRunning ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        执行中...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" />
                        开始执行
                      </>
                    )}
                  </button>
                </div>
              </section>
            )}

            {/* 执行进度 */}
            {currentWorkflow && (
              <section className="animate-fade-in-scale">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-surface-900">{currentWorkflow.name}</h2>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(currentWorkflow.status)}
                    <span className={`text-sm font-medium ${currentWorkflow.status === 'completed' ? 'text-emerald-600' : currentWorkflow.status === 'failed' ? 'text-red-600' : 'text-blue-600'}`}>
                      {statusConfig[currentWorkflow.status]?.label || currentWorkflow.status}
                    </span>
                  </div>
                </div>

                {/* 步骤进度条 */}
                <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
                  {currentWorkflow.steps.map((step, i) => {
                    const cfg = statusConfig[step.status] || statusConfig.pending;
                    const isExpanded = expandedSteps.has(step.id);
                    const hasResult = currentWorkflow.results?.[step.name];

                    return (
                      <div key={step.id} className={`border-b border-surface-100 last:border-0 ${step.status === 'running' ? 'bg-blue-50/50' : ''}`}>
                        <button
                          onClick={() => hasResult ? toggleStep(step.id) : undefined}
                          className="w-full px-5 py-3.5 flex items-center gap-3 text-left hover:bg-surface-50 transition-colors"
                        >
                          {/* 步骤序号 */}
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                            step.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                            step.status === 'failed' ? 'bg-red-100 text-red-700' :
                            step.status === 'running' ? 'bg-blue-100 text-blue-700' :
                            'bg-surface-100 text-surface-500'
                          }`}>
                            {step.status === 'completed' ? '✓' : step.status === 'failed' ? '✗' : i + 1}
                          </div>

                          {getStatusIcon(step.status)}

                          <span className={`font-medium text-sm flex-1 ${
                            step.status === 'completed' ? 'text-surface-900' :
                            step.status === 'running' ? 'text-blue-700' :
                            step.status === 'failed' ? 'text-red-700' :
                            'text-surface-500'
                          }`}>
                            {step.name}
                          </span>

                          {step.result?.length && (
                            <span className="text-xs text-surface-400">{step.result.length}字</span>
                          )}

                          {hasResult && (
                            isExpanded ? <ChevronUp className="w-4 h-4 text-surface-400" /> : <ChevronDown className="w-4 h-4 text-surface-400" />
                          )}
                        </button>

                        {/* 展开的详细结果 */}
                        {isExpanded && hasResult && (
                          <div className="px-5 pb-4 pt-0">
                            <div className="bg-surface-50 rounded-lg p-4 text-sm text-surface-700 whitespace-pre-wrap max-h-96 overflow-y-auto scrollbar-thin border border-surface-200">
                              {currentWorkflow.results[step.name]}
                            </div>
                          </div>
                        )}

                        {/* 错误信息 */}
                        {step.status === 'failed' && step.error && (
                          <div className="px-5 pb-3">
                            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-center gap-2">
                              <AlertCircle className="w-4 h-4 flex-shrink-0" />
                              {step.error}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* 操作按钮 */}
                {currentWorkflow.status === 'completed' && (
                  <div className="mt-4 flex gap-3">
                    <button
                      onClick={() => handlePushToWechat()}
                      disabled={pushing}
                      className="flex-1 py-2.5 bg-white border border-surface-300 rounded-xl text-sm font-medium text-surface-700 hover:bg-surface-50 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      <Send className="w-4 h-4" />
                      {pushing ? '推送中...' : '推送到微信'}
                    </button>
                    <button
                      onClick={handleReset}
                      className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
                    >
                      <Play className="w-4 h-4" />
                      新建工作流
                    </button>
                  </div>
                )}

                {currentWorkflow.status === 'failed' && (
                  <div className="mt-4">
                    <button onClick={handleReset} className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-all">
                      重新开始
                    </button>
                  </div>
                )}
              </section>
            )}

            {/* 微信使用提示 */}
            {!currentWorkflow && (
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-5 border border-blue-100">
                <h3 className="font-semibold text-blue-800 text-sm flex items-center gap-2 mb-2">
                  <Smartphone className="w-4 h-4" />
                  也可以在微信中使用
                </h3>
                <p className="text-xs text-blue-700 leading-relaxed">
                  在微信中发送 PDF 文件给 Bot，然后发送「全流程分析」「SWOT分析」等命令即可触发工作流。
                  发送「查看结果」获取分析结果。发送「/help」查看完整命令列表。
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// 历史记录子组件
function HistoryView({ history, onViewWorkflow, onPush, pushing }: {
  history: Workflow[];
  onViewWorkflow: (wf: Workflow) => void;
  onPush: (id: string) => void;
  pushing: boolean;
}) {
  if (history.length === 0) {
    return (
      <div className="max-w-2xl mx-auto p-12 text-center">
        <Clock className="w-12 h-12 text-surface-300 mx-auto mb-4" />
        <p className="text-surface-500">暂无工作流记录</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-3">
      {history.map(wf => {
        const cfg = statusConfig[wf.status] || statusConfig.pending;
        const Icon = cfg.icon;
        const completedSteps = wf.steps.filter(s => s.status === 'completed').length;
        return (
          <div key={wf.id} className="bg-white rounded-xl border border-surface-200 p-4 hover:shadow-sm transition-shadow">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Icon className={`w-5 h-5 ${cfg.color} ${wf.status === 'running' ? 'animate-spin' : ''}`} />
                <div>
                  <div className="font-medium text-surface-900 text-sm">{wf.name}</div>
                  <div className="text-xs text-surface-400 mt-0.5">
                    {new Date(wf.createdAt).toLocaleString('zh-CN')}
                    {wf.completedAt && ` · 完成`}
                    {wf.templateId && ` · ${wf.templateId}`}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-surface-500">{completedSteps}/{wf.steps.length} 步骤</span>
                {wf.status === 'completed' && (
                  <button
                    onClick={() => onPush(wf.id)}
                    disabled={pushing}
                    className="px-2.5 py-1 text-xs bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
                  >
                    推送
                  </button>
                )}
                {(wf.status === 'completed' || wf.status === 'failed') && (
                  <button
                    onClick={() => onViewWorkflow(wf)}
                    className="px-2.5 py-1 text-xs bg-surface-100 text-surface-600 rounded-lg hover:bg-surface-200 transition-colors"
                  >
                    查看
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
