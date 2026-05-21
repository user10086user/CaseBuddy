import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Send, Bot, User, FileText, Lightbulb, BarChart3, BookOpen, Sparkles,
  ChevronDown, ChevronUp, Play, Upload, Zap, AlertCircle, Trash2, Copy, Check,
  PlusCircle, Image as ImageIcon, Paperclip, X as XIcon, Download, FileDown,
  FileText as FileMd, Eye, MoreHorizontal, Presentation, MessageCircle
} from 'lucide-react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useSession } from '../contexts/SessionContext';
import AgentTools, { executeTool, type ToolCall } from '../components/AgentTools';
import MarkdownContent from '../components/MarkdownContent';
import MessagePreview from '../components/MessagePreview';
import { exportAsMarkdown, exportAsPDF, exportAsDocx, exportMessageAsMarkdown, exportMessageAsPDF } from '../utils/exportUtils';
import type { ChatMessage, ModelConfig } from '../types';

const builtinPrompts = [
  { id: 'summary', name: '案例速读', icon: BookOpen, color: 'emerald', prompt: '请阅读以下案例，完成：\n1. 生成200字核心摘要\n2. 提取关键事件时间线\n3. 识别3个核心决策点\n4. **提取所有关键数据，用Markdown表格整理呈现**（包括财务数据、市场规模、用户数据、增长率等）\n\n{{case}}' },
  { id: 'swot', name: 'SWOT分析', icon: BarChart3, color: 'blue', prompt: '请为以下案例中的企业进行SWOT分析，每个维度至少5个要点，并生成TOWS矩阵和战略建议。\n**要求：用Markdown表格呈现SWOT四象限对比，并单独列出关键数据指标表。**\n\n{{case}}' },
  { id: 'pestel', name: 'PESTEL分析', icon: BarChart3, color: 'violet', prompt: '请针对以下案例企业所在行业进行PESTEL分析，每个维度列出3个关键因素。\n**要求：用Markdown表格呈现6个维度的关键因素对比，并包含行业关键数据指标。**\n\n{{case}}' },
  { id: 'porter', name: '波特五力', icon: BarChart3, color: 'amber', prompt: '请对以下案例企业所在行业进行波特五力分析，给出1-5分评分和行业吸引力评估。\n**要求：用Markdown表格呈现五力评分和权重，并包含行业集中度、市场规模等数据。**\n\n{{case}}' },
  { id: 'insight', name: '深度洞察', icon: Lightbulb, color: 'rose', prompt: '基于以下案例，提供：\n1. 3个被忽略的关键视角\n2. 2个跨行业类比\n3. 1个颠覆性假设\n4. 对常规分析的3个挑战性质疑\n**要求：提取案例中的关键数据，用Markdown表格整理对比。**\n\n{{case}}' },
  { id: 'ppt', name: 'PPT大纲', icon: Sparkles, color: 'fuchsia', prompt: '请为以下分析内容设计PPT结构（15页以内），每页一个核心观点，并提供数据可视化建议。\n**要求：大纲中必须包含至少2页数据表格页（用Markdown表格呈现关键财务数据、市场数据等）。**\n\n{{case}}' },
  { id: 'agent', name: 'Agent分析', icon: Zap, color: 'orange', prompt: '请作为资深战略咨询顾问，对以下案例进行深度分析。要求：\n1. 识别核心商业问题\n2. 应用至少2个战略分析框架\n3. 提供数据驱动的洞察\n4. 给出可落地的战略建议\n5. 识别潜在风险\n**特别要求：提取案例中所有可量化的数据（财务、市场、运营、用户等），用Markdown表格系统整理呈现。数据表格至少3个。**\n\n{{case}}' },
];

// Streaming response state
interface StreamingState {
  isStreaming: boolean;
  content: string;
  messageId: string | null;
}

export default function WorkBench() {
  const navigate = useNavigate();
  const { session, setSession, newSession: createSession } = useSession();
  const [input, setInput] = useState('');
  const [showCase, setShowCase] = useState(true);
  const [models] = useLocalStorage<ModelConfig[]>('casebuddy-models', []);
  const [streaming, setStreaming] = useState<StreamingState>({
    isStreaming: false,
    content: '',
    messageId: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [useStream, setUseStream] = useLocalStorage('casebuddy-use-stream', true);
  const [agentEnabled, setAgentEnabled] = useLocalStorage('casebuddy-agent-enabled', false);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<{ name: string; type: string; data: string }[]>([]);
  const [previewMsg, setPreviewMsg] = useState<ChatMessage | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [msgActionId, setMsgActionId] = useState<string | null>(null);
  const [activeModelId, setActiveModelId] = useLocalStorage<string | null>('casebuddy-active-model', null);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [ragBuilding, setRagBuilding] = useState(false);  // RAG 索引构建中
  const [ragEnabled, setRagEnabled] = useLocalStorage('casebuddy-rag-enabled', false); // RAG 总开关
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll with smart detection
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [session.messages, streaming.content, scrollToBottom]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const currentModel = models.find(m => m.id === activeModelId) || models.find(m => m.isDefault) || models[0];

  // File Upload handler (PDF & DOCX via backend)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['pdf', 'docx'].includes(ext || '')) {
      setError('仅支持 PDF 和 DOCX 文件');
      return;
    }

    try {
      setError(null);
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('http://localhost:3001/api/parse/file', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || '解析失败');
      }

      const data = await response.json();
      const caseText = data.text || '文件解析失败，请手动粘贴案例文本';
      const caseTitle = file.name.replace(/\.(pdf|docx)$/i, '');
      const ragCaseId = `case_${Date.now()}`;

      setSession(prev => ({
        ...prev,
        caseText,
        title: caseTitle,
        ragCaseId,
        ragIndexed: false,
      }));

      // 后台自动构建 RAG 索引（非阻塞）
      if (ragEnabled && caseText.length > 500) {
        setRagBuilding(true);
        fetch('http://localhost:3001/api/rag/index', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caseId: ragCaseId, text: caseText }),
        }).then(async (r) => {
          if (r.ok) {
            const d = await r.json();
            setSession(prev => ({ ...prev, ragIndexed: true, ragTotalChunks: d.totalChunks }));
          }
        }).catch(() => {}).finally(() => setRagBuilding(false));
      }
    } catch (err) {
      setError(`文件上传失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const systemPrompt = `你是一位资深的MBA案例分析专家，拥有20年战略咨询经验。你的分析要深入、有洞察力，避免泛泛而谈。请用中文回答。

【数据呈现规范】
1. 在分析中主动提取案例中的关键数据（财务数据、市场规模、增长率、用户数据、运营指标等）
2. 所有数据必须用 Markdown 表格形式呈现，表格要有清晰的表头和单位
3. 数据表格不少于2个，分布在不同分析维度中
4. 如果案例中没有明确数据，可以标注"数据缺失"并给出合理估算范围
5. 表格示例如下：
| 指标 | 数值 | 单位 | 年份/说明 |
|:---|:---|:---|:---|
| 营业收入 | 120 | 亿元 | 2023年 |
| 用户增长率 | 35 | % | 同比 |`;

  // Build conversation memory context (like Hermes Agent's memory mechanism)
  const buildMemoryContext = (): string => {
    const parts: string[] = [];

    // Session memory: summarize past conversation for context
    if (session.messages.length > 0) {
      const recentMessages = session.messages.slice(-6); // Last 3 rounds
      const conversationSummary = recentMessages
        .map(m => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content.slice(0, 200)}${m.content.length > 200 ? '...' : ''}`)
        .join('\n');

      parts.push(`【近期对话记忆】\n${conversationSummary}`);

      // Add topic tracking
      const topics = [...new Set(
        session.messages
          .filter(m => m.role === 'user')
          .map(m => m.content.slice(0, 50))
      )];
      if (topics.length > 0) {
        parts.push(`【已讨论话题】\n${topics.map((t, i) => `${i + 1}. ${t}`).join('\n')}`);
      }
    }

    // Long-term memory from localStorage
    try {
      const savedMemory = localStorage.getItem('casebuddy-memory');
      if (savedMemory) {
        const memory = JSON.parse(savedMemory);
        if (memory.keyInsights?.length > 0) {
          parts.push(`【历史分析洞察】\n${memory.keyInsights.slice(-5).join('\n')}`);
        }
      }
    } catch { /* ignore */ }

    return parts.length > 0 ? parts.join('\n\n') : '';
  };

  // Save key insights to long-term memory
  const saveToMemory = (content: string) => {
    try {
      let memory: { keyInsights: string[] } = { keyInsights: [] };
      try {
        const saved = localStorage.getItem('casebuddy-memory');
        if (saved) memory = JSON.parse(saved);
      } catch { /* ignore */ }

      // Extract key sentences (simple heuristic: lines with numbers, conclusions, or key terms)
      const lines = content.split('\n').filter(l => l.trim().length > 20);
      const insights = lines
        .filter(l => /\d+[%万亿美元]|\b(核心|关键|重要|显著|突破)\b|结论|建议|总结/.test(l))
        .slice(0, 3);

      if (insights.length > 0) {
        memory.keyInsights = [...(memory.keyInsights || []), ...insights].slice(-20);
        localStorage.setItem('casebuddy-memory', JSON.stringify(memory));
      }
    } catch { /* ignore */ }
  };

  const agentSystemPrompt = `你是一位资深的MBA案例分析专家，拥有20年战略咨询经验。

【数据驱动分析要求】
1. 你必须主动从案例中提取所有可量化的数据，用Markdown表格系统整理
2. 数据表格必须包含：表头、数值、单位、时间/说明
3. 每张分析结果中至少包含2个数据表格
4. 如果案例数据不足，使用web_search工具搜索补充最新行业数据

你可以使用以下工具来辅助分析（仅在需要时调用）：

1. web_search - 网络搜索：搜索互联网获取最新行业数据、新闻和竞争情报
   参数：{"query": "搜索关键词"}
   **优先使用此工具补充案例缺失的最新财务数据、市场规模、竞争格局数据**

2. calculate - 数值计算：执行财务计算、比率分析、增长预测等数学运算
   参数：{"expression": "数学表达式"}

3. extract_data - 数据提取：从案例文本中提取结构化数据
   参数：{"data_type": "财务/时间线/人物/指标"}
   **优先提取：营收、利润、增长率、市场份额、用户数量、融资数据**

当你需要调用工具时，请使用以下格式（必须严格按此格式）：
<tool_call>
{"tool": "工具名", "arguments": {"参数名": "参数值"}}
</tool_call>

调用工具后，你将收到工具返回的结果，然后继续你的分析。
分析结果中必须包含Markdown数据表格。`;

  const callLLM = async (content: string): Promise<string> => {
    if (!currentModel) {
      return '错误：请先配置模型。请前往「模型配置」页面添加 API 信息。';
    }

    try {
      const response = await fetch('http://localhost:3001/api/proxy/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: currentModel.baseUrl,
          apiKey: currentModel.apiKey,
          model: currentModel.modelId,
          messages: [
            { role: 'system', content: agentEnabled ? agentSystemPrompt : systemPrompt },
            { role: 'user', content },
          ],
          temperature: 0.7,
          max_tokens: 4000,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        return `API 错误 (${response.status}): ${err}`;
      }

      const data = await response.json();
      let result = data.choices?.[0]?.message?.content || '无响应内容';

      if (agentEnabled) {
        result = await handleToolCalls(result);
      }

      return result;
    } catch (error) {
      return `请求失败: ${error instanceof Error ? error.message : String(error)}\n\n提示：请确保后端服务已启动（npm run dev）。`;
    }
  };

  const handleToolCalls = async (content: string): Promise<string> => {
    const toolCallRegex = /<tool_call>\s*({[\s\S]*?})\s*<\/tool_call>/g;
    let match;
    let processedContent = content;

    while ((match = toolCallRegex.exec(content)) !== null) {
      try {
        const callData = JSON.parse(match[1]);
        const toolCall: ToolCall = {
          id: Date.now().toString(),
          tool: callData.tool,
          arguments: callData.arguments,
          status: 'running',
        };

        setToolCalls(prev => [...prev, toolCall]);

        const result = await executeTool(toolCall, session.caseText, async (prompt) => {
          if (!currentModel) return 'LLM 未配置';
          try {
            const resp = await fetch('http://localhost:3001/api/proxy/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                baseUrl: currentModel.baseUrl,
                apiKey: currentModel.apiKey,
                model: currentModel.modelId,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
                max_tokens: 2000,
              }),
            });
            const data = await resp.json();
            return data.choices?.[0]?.message?.content || '无响应';
          } catch (e) {
            return `LLM调用失败: ${e}`;
          }
        });

        setToolCalls(prev => prev.map(tc =>
          tc.id === toolCall.id ? { ...tc, status: 'completed', result } : tc
        ));

        processedContent = processedContent.replace(
          match[0],
          `\n\n[工具调用: ${callData.tool}]\n${result}\n\n`
        );
      } catch {
        // Invalid tool call format, skip
      }
    }

    return processedContent;
  };

  const callLLMStream = async (content: string): Promise<void> => {
    if (!currentModel) {
      setError('请先配置模型');
      return;
    }

    const messageId = Date.now().toString();
    setStreaming({ isStreaming: true, content: '', messageId });
    setError(null);

    try {
      abortRef.current = new AbortController();

      const response = await fetch('http://localhost:3001/api/proxy/chat/completions/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: currentModel.baseUrl,
          apiKey: currentModel.apiKey,
          model: currentModel.modelId,
          messages: [
            { role: 'system', content: agentEnabled ? agentSystemPrompt : systemPrompt },
            { role: 'user', content },
          ],
          temperature: 0.7,
          max_tokens: 4000,
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        const err = await response.text();
        setError(`API 错误 (${response.status}): ${err}`);
        setStreaming({ isStreaming: false, content: '', messageId: null });
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        setError('无法读取响应流');
        setStreaming({ isStreaming: false, content: '', messageId: null });
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                setStreaming(prev => ({ ...prev, content: fullContent }));
              }
            } catch {
              // Ignore parse errors for incomplete chunks
            }
          }
        }
      }

      const assistantMsg: ChatMessage = {
        id: messageId,
        role: 'assistant',
        content: fullContent,
        timestamp: Date.now(),
      };

      setSession(prev => ({
        ...prev,
        messages: [...prev.messages, assistantMsg],
        updatedAt: Date.now(),
      }));
      // Save key insights to long-term memory
      saveToMemory(fullContent);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled
      } else {
        setError(`流式请求失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      setStreaming({ isStreaming: false, content: '', messageId: null });
      abortRef.current = null;
    }
  };

  const sendMessage = async (content: string, isPrompt = false) => {
    if (!content.trim() && attachments.length === 0) return;

    // Build display content (show attachment names if any)
    const attachmentInfo = attachments.length > 0
      ? `\n${attachments.map(a => `[📎 ${a.name}]`).join(' ')}`
      : '';
    const displayContent = isPrompt
      ? `[快捷分析] ${builtinPrompts.find(p => p.prompt === content)?.name || ''}`
      : content + attachmentInfo;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: displayContent,
      timestamp: Date.now(),
    };

    setSession(prev => ({
      ...prev,
      messages: [...prev.messages, userMsg],
      updatedAt: Date.now(),
    }));

    // Build full content with attachments
    const attachmentContent = attachments
      .filter(a => a.type.startsWith('text/') || a.type === 'text/plain')
      .map(a => a.data)
      .join('\n\n');

    // ————————————————————————————————————
    // RAG 上下文获取（替代全文注入）
    // ————————————————————————————————————
    const getRAGContext = async (query: string): Promise<string> => {
      if (ragEnabled && session.ragIndexed && session.ragCaseId) {
        try {
          const resp = await fetch('http://localhost:3001/api/rag/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              caseId: session.ragCaseId,
              query,
              topK: 8,
            }),
          });
          if (resp.ok) {
            const d = await resp.json();
            if (d.contextForPrompt && d.contextForPrompt.length > 100) {
              return d.contextForPrompt;
            }
          }
        } catch { /* 降级到全文 */ }
      }
      // 降级：返回全文（最多 6000 字）
      return session.caseText.length > 6000
        ? session.caseText.slice(0, 6000) + '\n\n[...文本较长，已截取前6000字符]'
        : session.caseText;
    };

    // 查询意图提取（用于 RAG 检索）
    const queryIntent = isPrompt
      ? (builtinPrompts.find(p => p.prompt === content)?.name || content.slice(0, 100))
      : content.slice(0, 200);

    const caseContext = await getRAGContext(queryIntent);

    let fullContent = isPrompt
      ? content.replace(/\{\{case\}\}/g, caseContext)
      : content;

    if (attachmentContent) {
      fullContent += '\n\n【附件内容】\n' + attachmentContent;
    }

    // 注入案例背景（RAG 模式下已通过 getRAGContext 获取相关片段）
    if (!isPrompt) {
      fullContent += '\n\n【案例背景】\n' + caseContext;
    }

    // Inject memory context
    const memoryContext = buildMemoryContext();
    if (memoryContext) {
      fullContent = memoryContext + '\n\n---\n\n' + fullContent;
    }

    // Clear attachments after sending
    setAttachments([]);

    if (useStream) {
      await callLLMStream(fullContent);
    } else {
      const reply = await callLLM(fullContent);
      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: reply,
        timestamp: Date.now(),
      };
      setSession(prev => ({
        ...prev,
        messages: [...prev.messages, assistantMsg],
        updatedAt: Date.now(),
      }));
      // Save key insights to long-term memory
      saveToMemory(reply);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
    setInput('');
  };

  const applyPrompt = (template: string) => {
    sendMessage(template, true);
  };

  const cancelStream = () => {
    abortRef.current?.abort();
  };

  const clearMessages = () => {
    if (window.confirm('确定要清空所有对话吗？此操作不可撤销。')) {
      setSession(prev => ({ ...prev, messages: [] }));
      setToolCalls([]);
    }
  };

  const newSession = () => {
    const title = window.prompt('输入新会话标题', '新建案例分析');
    if (title === null) return;
    createSession(title || '新建案例分析');
    setToolCalls([]);
    setAttachments([]);
    inputRef.current?.focus();
  };

  const copyMessage = async (content: string, id: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard not supported
    }
  };

  // Keyboard shortcut: Cmd/Ctrl + Enter to submit
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      if (input.trim() && !streaming.isStreaming) {
        handleSubmit(e as unknown as React.FormEvent);
      }
    }
  };

  // Attachment handling
  const handleAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        // Convert image to base64 for multimodal models
        const reader = new FileReader();
        reader.onload = (event) => {
          const data = event.target?.result as string;
          if (data) {
            setAttachments(prev => [...prev, { name: file.name, type: file.type, data }]);
          }
        };
        reader.readAsDataURL(file);
      } else {
        // For non-image files, upload to backend and get extracted text
        try {
          setError(null);
          const formData = new FormData();
          formData.append('file', file);
          const response = await fetch('http://localhost:3001/api/parse/file', {
            method: 'POST',
            body: formData,
          });
          if (!response.ok) {
            const err = await response.json();
            setError(`附件上传失败: ${err.error || '解析失败'}`);
            continue;
          }
          const data = await response.json();
          setAttachments(prev => [...prev, {
            name: file.name,
            type: 'text/plain',
            data: `[文件内容: ${file.name}]\n${data.text?.slice(0, 5000) || '（解析失败）'}`,
          }]);
        } catch (err) {
          setError(`附件上传失败: ${err}`);
        }
      }
    }
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="h-full min-h-0 flex overflow-hidden">
      {/* Left Panel - Case & Prompts */}
      <div className="w-72 bg-white border-r border-surface-200 flex flex-col flex-shrink-0 h-full overflow-hidden">
        {/* Case Input */}
        <div className="border-b border-surface-200 flex-shrink-0">
          <button
            onClick={() => setShowCase(!showCase)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary-500" />
              <span className="font-medium text-sm text-surface-800">案例正文</span>
            </div>
            <div className="flex items-center gap-1">
              <label
                className="cursor-pointer touch-target flex items-center justify-center hover:bg-surface-100 rounded-lg transition-colors"
                title="上传 PDF / DOCX"
                aria-label="上传PDF或DOCX文件"
              >
                <Upload className="w-4 h-4 text-surface-400" aria-hidden="true" />
                <input
                  type="file"
                  accept=".pdf,.docx"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
              {showCase ? (
                <ChevronUp className="w-4 h-4 text-surface-400 touch-target" aria-hidden="true" />
              ) : (
                <ChevronDown className="w-4 h-4 text-surface-400 touch-target" aria-hidden="true" />
              )}
            </div>
          </button>
          {showCase && (
            <textarea
              value={session.caseText}
              onChange={e => setSession(prev => ({ ...prev, caseText: e.target.value }))}
              className="w-full h-40 px-4 py-2 text-xs text-surface-600 bg-surface-50 border-0 resize-none focus:ring-0 scrollbar-thin overscroll-contain"
              placeholder="在此粘贴案例正文，或上传PDF..."
            />
          )}
          {/* RAG 状态栏 */}
          <div className="px-4 py-2 flex items-center justify-between border-t border-surface-100 bg-surface-50">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  const next = !ragEnabled;
                  setRagEnabled(next);
                  // 开启RAG且有文本但未索引，立即构建索引
                  if (next && session.caseText.length > 500 && !session.ragIndexed) {
                    const ragCaseId = session.ragCaseId || `case_${Date.now()}`;
                    setSession(prev => ({ ...prev, ragCaseId, ragIndexed: false }));
                    setRagBuilding(true);
                    fetch('http://localhost:3001/api/rag/index', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ caseId: ragCaseId, text: session.caseText }),
                    }).then(async r => {
                      if (r.ok) {
                        const d = await r.json();
                        setSession(prev => ({ ...prev, ragIndexed: true, ragTotalChunks: d.totalChunks }));
                      }
                    }).catch(() => {}).finally(() => setRagBuilding(false));
                  }
                }}
                className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${ragEnabled ? 'bg-emerald-500' : 'bg-surface-300'}`}
                title={ragEnabled ? '智能RAG检索：开启' : '智能RAG检索：关闭（当前全文注入）'}
              >
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${ragEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
              <span className="text-xs text-surface-500">
                {ragBuilding ? '索引中...' : ragEnabled ? (session.ragIndexed ? `RAG✓ ${session.ragTotalChunks || ''}块` : 'RAG未索引') : '全文模式'}
              </span>
            </div>
            {ragEnabled && session.ragIndexed && (
              <span className="text-xs text-emerald-600 font-medium">按需检索</span>
            )}
          </div>
        </div>

        {/* Agent Tools */}
        <div className="px-3 pt-3 flex-shrink-0">
          <AgentTools
            toolCalls={toolCalls}
            enabled={agentEnabled}
            onToggle={() => setAgentEnabled(!agentEnabled)}
          />
        </div>

        {/* Quick Prompts */}
        <div className="flex-1 min-h-0 overflow-auto overscroll-contain p-3 scrollbar-thin">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-4 w-0.5 rounded-full bg-gradient-to-b from-primary-400 to-primary-600" />
            <div className="text-xs font-semibold text-surface-500 uppercase tracking-wider">快捷分析</div>
          </div>
          <div className="space-y-1.5">
            {builtinPrompts.map(p => {
              const Icon = p.icon;
              const colorMap: Record<string, string> = {
                emerald: 'bg-emerald-500 shadow-emerald-500/30',
                blue: 'bg-blue-500 shadow-blue-500/30',
                violet: 'bg-violet-500 shadow-violet-500/30',
                amber: 'bg-amber-500 shadow-amber-500/30',
                rose: 'bg-rose-500 shadow-rose-500/30',
                fuchsia: 'bg-fuchsia-500 shadow-fuchsia-500/30',
                orange: 'bg-orange-500 shadow-orange-500/30',
              };
              const hoverMap: Record<string, string> = {
                emerald: 'hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700',
                blue: 'hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700',
                violet: 'hover:bg-violet-50 hover:border-violet-200 hover:text-violet-700',
                amber: 'hover:bg-amber-50 hover:border-amber-200 hover:text-amber-700',
                rose: 'hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700',
                fuchsia: 'hover:bg-fuchsia-50 hover:border-fuchsia-200 hover:text-fuchsia-700',
                orange: 'hover:bg-orange-50 hover:border-orange-200 hover:text-orange-700',
              };
              const iconColorMap: Record<string, string> = {
                emerald: 'text-emerald-500',
                blue: 'text-blue-500',
                violet: 'text-violet-500',
                amber: 'text-amber-500',
                rose: 'text-rose-500',
                fuchsia: 'text-fuchsia-500',
                orange: 'text-orange-500',
              };
              return (
                <button
                  key={p.id}
                  onClick={() => applyPrompt(p.prompt)}
                  disabled={streaming.isStreaming}
                  className={`group w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-xl
                    text-sm text-surface-600 bg-surface-50/60
                    transition-all duration-200 disabled:opacity-50 btn-press min-h-[44px]
                    border border-surface-200/60 hover:border-surface-300 hover:shadow-md ${hoverMap[p.color]}`}
                >
                  <div className={`w-1 h-6 rounded-full ${colorMap[p.color]} flex-shrink-0`} />
                  <Icon className={`w-4 h-4 flex-shrink-0 ${iconColorMap[p.color]}`} />
                  <span className="truncate flex-1 font-medium">{p.name}</span>
                  <Play className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 text-surface-400 group-hover:text-surface-600" />
                </button>
              );
            })}
          </div>
        </div>

      </div>

      {/* Right Panel - Chat */}
      <div className="flex-1 flex flex-col bg-surface-50 min-w-0 h-full overflow-hidden">
        {/* Header */}
        <div className="h-14 bg-white/90 backdrop-blur-md border-b border-surface-200/80 flex items-center px-6 justify-between flex-shrink-0 z-10">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="font-semibold text-surface-800 truncate">{session.title}</h2>
            <span className="text-xs text-surface-400 flex-shrink-0">
              {session.messages.filter(m => m.role === 'assistant').length} 轮分析
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={newSession}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors font-medium"
              aria-label="新开会话"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">新开会话</span>
            </button>
            {session.messages.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors font-medium"
                  aria-label="导出报告"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">导出</span>
                </button>
                {showExportMenu && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setShowExportMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-xl border border-surface-200 py-1.5 w-48 z-30 animate-fade-in-scale">
                      <button
                        onClick={() => { exportAsMarkdown(session); setShowExportMenu(false); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-surface-700 hover:bg-surface-50 transition-colors"
                      >
                        <FileMd className="w-4 h-4 text-surface-500" />
                        导出 Markdown
                      </button>
                      <button
                        onClick={() => { void exportAsPDF(session); setShowExportMenu(false); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-surface-700 hover:bg-surface-50 transition-colors"
                      >
                        <FileDown className="w-4 h-4 text-rose-500" />
                        导出 PDF
                      </button>
                      <button
                        onClick={() => { exportAsDocx(session); setShowExportMenu(false); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-surface-700 hover:bg-surface-50 transition-colors"
                      >
                        <FileText className="w-4 h-4 text-blue-500" />
                        导出 Word
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            {session.messages.length > 0 && (
              <button
                onClick={clearMessages}
                className="touch-target flex items-center justify-center text-surface-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                aria-label="清空所有对话"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
            {streaming.isStreaming && (
              <button
                onClick={cancelStream}
                className="px-4 py-2 text-xs bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-100 transition-colors font-medium touch-target"
              >
                停止生成
              </button>
            )}
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="px-6 py-2.5 bg-rose-50 border-b border-rose-100 flex items-center gap-2 flex-shrink-0 animate-message-in">
            <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />
            <span className="text-sm text-rose-600">{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-xs text-rose-400 hover:text-rose-600 px-2 py-0.5 rounded hover:bg-rose-100 transition-colors"
            >
              关闭
            </button>
          </div>
        )}

        {/* Messages */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-auto overscroll-contain px-4 md:px-6 py-4 space-y-4 scrollbar-thin"
        >
          {session.messages.length === 0 && !streaming.isStreaming && (
            <div className="flex flex-col items-center justify-center h-full text-surface-400 animate-fade-in-scale">
              <div className="w-16 h-16 bg-primary-50 rounded-2xl flex items-center justify-center mb-5">
                <Bot className="w-8 h-8 text-primary-400" />
              </div>
              <p className="text-lg font-medium text-surface-600 mb-1">开始案例分析</p>
              <p className="text-sm text-surface-400">在左侧选择快捷分析，或直接在下方输入问题</p>
              <p className="text-xs text-surface-400 mt-2">支持上传PDF/DOCX自动提取文本 · Ctrl+Enter 快捷发送</p>
            </div>
          )}

          {session.messages.map((msg, idx) => (
            <div
              key={msg.id}
              className={`flex gap-3 animate-message-in ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
              style={{ animationDelay: `${Math.min(idx * 0.03, 0.15)}s` }}
            >
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md ring-2 ring-white
                ${msg.role === 'user' ? 'bg-gradient-to-br from-primary-500 to-primary-600' : 'bg-gradient-to-br from-accent-500 to-accent-600'}`}>
                {msg.role === 'user' ? <User className="w-4 h-4 text-white" /> : <Bot className="w-4 h-4 text-white" />}
              </div>
              <div className={`relative group max-w-[85%] md:max-w-[80%] rounded-2xl px-5 py-4 text-sm leading-relaxed
                ${msg.role === 'user'
                  ? 'bg-gradient-to-br from-primary-500 to-primary-600 text-white shadow-lg shadow-primary-500/20'
                  : 'bg-white/80 backdrop-blur-sm border border-surface-200/80 text-surface-700 shadow-sm hover:shadow-md transition-shadow duration-300'
                }`}>
                {msg.role === 'assistant' ? (
                  <MarkdownContent content={msg.content} />
                ) : (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                )}
                {msg.role === 'assistant' && (
                  <div className="absolute -bottom-2 right-3 opacity-0 group-hover:opacity-100 transition-all duration-200
                      flex items-center gap-1">
                    <button
                      onClick={() => copyMessage(msg.content, msg.id)}
                      className="touch-target flex items-center justify-center bg-white border border-surface-200 rounded-lg shadow-md
                      hover:bg-surface-50 text-surface-400 hover:text-surface-600 hover:scale-105 px-1.5 py-1"
                      aria-label={copiedId === msg.id ? '已复制' : '复制内容'}
                    >
                      {copiedId === msg.id ? <Check className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
                    </button>
                    <button
                      onClick={() => setPreviewMsg(msg)}
                      className="touch-target flex items-center justify-center bg-white border border-surface-200 rounded-lg shadow-md
                      hover:bg-surface-50 text-surface-400 hover:text-primary-600 hover:scale-105 px-1.5 py-1"
                      aria-label="预览"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => setMsgActionId(msgActionId === msg.id ? null : msg.id)}
                        className="touch-target flex items-center justify-center bg-white border border-surface-200 rounded-lg shadow-md
                        hover:bg-surface-50 text-surface-400 hover:text-accent-600 hover:scale-105 px-1.5 py-1"
                        aria-label="更多操作"
                      >
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </button>
                      {msgActionId === msg.id && (
                        <>
                          <div className="fixed inset-0 z-20" onClick={() => setMsgActionId(null)} />
                          <div className="absolute bottom-full right-0 mb-1 bg-white rounded-xl shadow-xl border border-surface-200 py-1 w-40 z-30 animate-fade-in-scale">
                            <button
                              onClick={() => { exportMessageAsMarkdown(msg, session.title); setMsgActionId(null); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-surface-700 hover:bg-surface-50 transition-colors"
                            >
                              <FileMd className="w-3.5 h-3.5 text-surface-500" />
                              导出 Markdown
                            </button>
                            <button
                              onClick={() => { void exportMessageAsPDF(msg, session.title); setMsgActionId(null); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-surface-700 hover:bg-surface-50 transition-colors"
                            >
                              <FileDown className="w-3.5 h-3.5 text-rose-500" />
                              导出 PDF
                            </button>
                            <button
                              onClick={() => { navigate('/ppt-assistant'); setMsgActionId(null); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-surface-700 hover:bg-surface-50 transition-colors"
                            >
                              <Presentation className="w-3.5 h-3.5 text-primary-500" />
                              AI PPT助手
                            </button>
                            <button
                              onClick={async () => {
                                try {
                                  const res = await fetch(`${'http://localhost:3001/api'}/gateway/push-wechat`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ content: msg.content, title: `【${session.title}】AI 分析` }),
                                  });
                                  if (res.ok) {
                                    alert('✅ 已推送到微信！');
                                  } else {
                                    const d = await res.json();
                                    alert(`❌ 推送失败: ${d.error || '请确认微信已登录'}`);
                                  }
                                } catch {
                                  alert('❌ 网络错误，请确认后端和微信网关已启动');
                                }
                                setMsgActionId(null);
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-surface-700 hover:bg-surface-50 transition-colors"
                            >
                              <MessageCircle className="w-3.5 h-3.5 text-green-500" />
                              发送到微信
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Streaming message */}
          {streaming.isStreaming && streaming.content && (
            <div className="flex gap-3 animate-message-in">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent-500 to-accent-600 flex items-center justify-center shadow-md ring-2 ring-white">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div className="max-w-[85%] md:max-w-[80%] rounded-2xl px-5 py-4 text-sm leading-relaxed bg-white/80 backdrop-blur-sm border border-surface-200/80 text-surface-700 shadow-sm">
                <MarkdownContent content={streaming.content} />
                <span className="inline-block w-1.5 h-4 bg-accent-400 ml-0.5 animate-pulse align-middle rounded-sm mt-1" />
              </div>
            </div>
          )}

          {/* Loading skeleton when waiting for first chunk */}
          {streaming.isStreaming && !streaming.content && (
            <div className="flex gap-3 animate-message-in">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent-500 to-accent-600 flex items-center justify-center shadow-md ring-2 ring-white">
                <Bot className="w-4 h-4 text-white" aria-hidden="true" />
              </div>
              <div className="bg-white/80 backdrop-blur-sm border border-surface-200/80 rounded-2xl px-5 py-4 shadow-sm max-w-[80%]">
                <div className="space-y-2 w-48">
                  <div className="h-3 bg-surface-200 rounded-full skeleton-shimmer w-full" />
                  <div className="h-3 bg-surface-200 rounded-full skeleton-shimmer w-4/5" />
                  <div className="h-3 bg-surface-200 rounded-full skeleton-shimmer w-2/3" />
                </div>
                <p className="text-xs text-surface-400 mt-2">AI 正在分析...</p>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="bg-white/90 backdrop-blur-md border-t border-surface-200/80 p-4 flex-shrink-0">
          {/* Attachment preview */}
          {attachments.length > 0 && (
            <div className="flex gap-2 mb-3 flex-wrap max-w-4xl mx-auto">
              {attachments.map((att, i) => (
                <div key={i} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-surface-100 rounded-lg text-xs group">
                  {att.type.startsWith('image/') ? (
                    <ImageIcon className="w-3.5 h-3.5 text-primary-500" />
                  ) : (
                    <Paperclip className="w-3.5 h-3.5 text-surface-400" />
                  )}
                  <span className="text-surface-600 max-w-[120px] truncate">{att.name}</span>
                  <button
                    onClick={() => removeAttachment(i)}
                    className="text-surface-400 hover:text-rose-500 transition-colors"
                  >
                    <XIcon className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex gap-3 max-w-4xl mx-auto">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleAttachment}
              className="hidden"
              accept="image/*,.pdf,.docx,.txt,.md"
              multiple
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-3 text-surface-400 hover:text-primary-500 hover:bg-primary-50 rounded-2xl transition-colors flex-shrink-0"
              aria-label="添加附件"
              title="添加图片或文件附件"
            >
              <Paperclip className="w-5 h-5" />
            </button>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={streaming.isStreaming ? 'AI正在生成回答...' : '输入分析指令... (Ctrl+Enter 发送)'}
              disabled={streaming.isStreaming}
              className="flex-1 px-5 py-3 bg-surface-50 border border-surface-200 rounded-2xl
                focus:ring-2 focus:ring-primary-500/25 focus:border-primary-400 focus:bg-white outline-none
                text-sm disabled:bg-surface-100 transition-all duration-200 placeholder:text-surface-400
                shadow-inner"
            />
            <button
              type="submit"
              disabled={streaming.isStreaming || (!input.trim() && attachments.length === 0)}
              className="px-5 py-3 bg-gradient-to-br from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 disabled:from-surface-300 disabled:to-surface-300
                text-white rounded-2xl transition-all duration-200 flex items-center gap-2 font-semibold btn-press
                shadow-lg shadow-primary-500/25 hover:shadow-xl hover:shadow-primary-500/30 hover:-translate-y-0.5"
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">发送</span>
            </button>
          </form>
          {/* Stream toggle & Model selector */}
          <div className="flex items-center gap-4 max-w-4xl mx-auto mt-2">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={useStream}
                onChange={e => setUseStream(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-surface-300 text-primary-500"
              />
              <span className="text-surface-500">流式输出</span>
            </label>
            <div className="relative">
              <button
                onClick={() => setShowModelMenu(!showModelMenu)}
                className="flex items-center gap-1.5 text-xs hover:bg-surface-100 rounded-lg px-2 py-1 transition-colors"
              >
                <div className={`w-2 h-2 rounded-full ${currentModel ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                <span className="text-surface-600 font-medium max-w-[180px] truncate">
                  {currentModel ? currentModel.name : '未配置'}
                </span>
                <ChevronDown className="w-3 h-3 text-surface-400" />
              </button>
              {showModelMenu && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setShowModelMenu(false)} />
                  <div className="absolute bottom-full left-0 mb-1 bg-white rounded-xl shadow-xl border border-surface-200 py-1 w-56 z-30 animate-fade-in-scale">
                    {models.map(m => (
                      <button
                        key={m.id}
                        onClick={() => { setActiveModelId(m.id); setShowModelMenu(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors
                          ${m.id === currentModel?.id ? 'bg-primary-50 text-primary-700' : 'text-surface-700 hover:bg-surface-50'}`}
                      >
                        <div className={`w-2 h-2 rounded-full ${m.id === currentModel?.id ? 'bg-primary-500' : 'bg-surface-300'}`} />
                        <span className="font-medium truncate">{m.name}</span>
                        <span className="text-surface-400 ml-auto flex-shrink-0">{m.modelId}</span>
                      </button>
                    ))}
                    {models.length === 0 && (
                      <div className="px-3 py-2 text-xs text-surface-400 text-center">未配置模型</div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      {/* Message Preview Modal */}
      {previewMsg && (
        <MessagePreview
          message={previewMsg}
          sessionTitle={session.title}
          onClose={() => setPreviewMsg(null)}
        />
      )}
    </div>
  );
}
