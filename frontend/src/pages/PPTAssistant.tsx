import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useSession } from '../contexts/SessionContext';
import { useLocalStorage } from '../hooks/useLocalStorage';
import type { ModelConfig } from '../types';
import { parseSlidesFromText, type SlideData } from '../utils/slideParser';
import { generatePPTX } from '../utils/pptxUtils';
import MarkdownContent from '../components/MarkdownContent';
import {
  Sparkles, Send, Bot, User, Check, Download, RefreshCw,
  Image, Settings2, Palette, Loader2, AlertCircle, Presentation,
  Eye, Wand2, ChevronRight, ChevronLeft, X, Copy, CheckCircle2,
  FileText, MessageSquare, Type, Layout, Table2, BarChart3,
  Quote, Lightbulb, BookOpen, Layers, Share2, FileUp,
  Monitor, Smartphone, PanelLeft, Hash, AlignLeft, Trash2,
  MessageCircle,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────

interface SlideOutline {
  page: number;
  title: string;
  subtitle?: string;
  layout: 'title' | 'toc' | 'section' | 'content' | 'twoColumn' | 'data' | 'chart' | 'quote';
  keyPoints: string[];
  visualSuggestion: string;
  speakerNote?: string;
}

interface StyleGuide {
  theme: string;
  themeDesc: string;
  colorScheme: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
  };
  fonts: { heading: string; body: string };
  imageStyle: string;
  chartStyle: string;
  layoutPrinciples: string[];
}

interface PlatformPrompts {
  doubao: string;
  gamma: string;
  canva: string;
}

interface PPTResult {
  title: string;
  subtitle: string;
  totalSlides: number;
  slides: SlideOutline[];
  styleGuide: StyleGuide;
  platformPrompts: PlatformPrompts;
}

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

type DataSource = 'session' | 'file' | 'topic';
type OutputTab = 'outline' | 'style' | 'doubao' | 'preview' | 'export';

const defaultModels: ModelConfig[] = [
  {
    id: 'ecnu-plus',
    name: 'ECNU Plus',
    baseUrl: 'https://chat.ecnu.edu.cn/open/api/v1',
    apiKey: '',
    modelId: 'ecnu-plus',
    isDefault: true,
  },
  {
    id: 'ecnu-max',
    name: 'ECNU Max',
    baseUrl: 'https://chat.ecnu.edu.cn/open/api/v1',
    apiKey: '',
    modelId: 'ecnu-max',
    isDefault: false,
  },
];

const STYLE_PRESETS = [
  { id: 'businessBlue', name: '商务蓝', desc: '专业商务风格，适合企业汇报和咨询分析', colors: ['#1E3A8A', '#3B82F6', '#0D9488', '#F8FAFC', '#1F2937'] },
  { id: 'academic', name: '学术风', desc: '结构化数据展示，严谨专业，适合学术答辩', colors: ['#374151', '#6B7280', '#0369A1', '#F9FAFB', '#111827'] },
  { id: 'minimalWhite', name: '极简白', desc: '极简设计，留白充分，适合高端品牌提案', colors: ['#18181B', '#52525B', '#E11D48', '#FAFAFA', '#27272A'] },
  { id: 'techDark', name: '科技暗黑', desc: '深色背景科技感，适合科技公司和产品发布', colors: ['#60A5FA', '#3B82F6', '#22D3EE', '#0F172A', '#F3F4F6'] },
  { id: 'magazine', name: '杂志风', desc: '暖色调，照片丰富，视觉冲击力强', colors: ['#92400E', '#D97706', '#DC2626', '#FFFBEB', '#292524'] },
];

const LAYOUT_ICONS: Record<string, React.ElementType> = {
  title: Type,
  toc: BookOpen,
  section: Layers,
  content: AlignLeft,
  twoColumn: PanelLeft,
  data: Table2,
  chart: BarChart3,
  quote: Quote,
};

const LAYOUT_NAMES: Record<string, string> = {
  title: '标题页', toc: '目录页', section: '章节页',
  content: '内容页', twoColumn: '双栏页', data: '数据页',
  chart: '图表页', quote: '引用页',
};

// ─── Helpers ─────────────────────────────────────────────────────────

function buildDoubaoPrompt(result: PPTResult): string {
  const sg = result.styleGuide;
  const lines: string[] = [
    `请为我生成一份关于「${result.title}」的PPT，共${result.totalSlides}页。`,
    ``,
    `=== 整体风格要求 ===`,
    `主题：${sg.theme}`,
    `配色：主色 ${sg.colorScheme.primary}，辅色 ${sg.colorScheme.secondary}，强调色 ${sg.colorScheme.accent}，背景 ${sg.colorScheme.background}`,
    `字体：标题用 ${sg.fonts.heading}，正文用 ${sg.fonts.body}`,
    `图片风格：${sg.imageStyle}`,
    `图表风格：${sg.chartStyle}`,
    `设计原则：${sg.layoutPrinciples.join('；')}`,
    ``,
    `=== 每页详细内容 ===`,
  ];

  for (const slide of result.slides) {
    lines.push(`\n【第${slide.page}页 | ${LAYOUT_NAMES[slide.layout]}】`);
    lines.push(`标题：${slide.title}`);
    if (slide.subtitle) lines.push(`副标题：${slide.subtitle}`);
    lines.push(`要点：`);
    for (const pt of slide.keyPoints) {
      lines.push(`  · ${pt}`);
    }
    lines.push(`可视化建议：${slide.visualSuggestion}`);
    if (slide.speakerNote) lines.push(`演讲备注：${slide.speakerNote}`);
  }

  lines.push(`\n=== 输出要求 ===`);
  lines.push(`1. 每页标题必须是完整的观点句（Action Title），不是名词短语`);
  lines.push(`2. 使用麦肯锡金字塔原理，结论先行`);
  lines.push(`3. 每页不超过5个要点，遵循MECE原则`);
  lines.push(`4. 数据页要有具体数字和百分比`);
  lines.push(`5. 配色严格使用我指定的颜色方案`);
  lines.push(`6. 字体大小层次分明：标题32-40pt，正文18-24pt`);
  lines.push(`7. 适当留白，不要拥挤`);
  lines.push(`8. 使用高质量配图，与内容相关`);

  return lines.join('\n');
}

function buildGammaPrompt(result: PPTResult): string {
  return `Create a professional presentation titled "${result.title}" with ${result.totalSlides} slides.\n\n` +
    `Theme: ${result.styleGuide.theme}\n` +
    `Color palette: Primary ${result.styleGuide.colorScheme.primary}, Secondary ${result.styleGuide.colorScheme.secondary}, Accent ${result.styleGuide.colorScheme.accent}\n` +
    `Fonts: ${result.styleGuide.fonts.heading} for headings, ${result.styleGuide.fonts.body} for body text\n\n` +
    `Slide outline:\n` +
    result.slides.map(s =>
      `Slide ${s.page} (${s.layout}): ${s.title}\n` +
      s.keyPoints.map(p => `  - ${p}`).join('\n')
    ).join('\n\n');
}

function buildCanvaPrompt(result: PPTResult): string {
  return `Design a presentation about "${result.title}". ${result.totalSlides} slides.\n\n` +
    `Style: ${result.styleGuide.theme} - ${result.styleGuide.themeDesc}\n` +
    `Colors: ${result.styleGuide.colorScheme.primary} / ${result.styleGuide.colorScheme.secondary} / ${result.styleGuide.colorScheme.accent}\n\n` +
    result.slides.map(s =>
      `Slide ${s.page}: ${s.title}\n` +
      `${s.keyPoints.map(p => `- ${p}`).join('\n')}`
    ).join('\n\n');
}

function buildMarkdownExport(result: PPTResult): string {
  const lines: string[] = [
    `# ${result.title}`,
    ``,
    `> ${result.subtitle}`,
    `> 共 ${result.totalSlides} 页 | 风格：${result.styleGuide.theme}`,
    ``,
    `---`,
    ``,
  ];

  for (const slide of result.slides) {
    lines.push(`## 第 ${slide.page} 页 · ${slide.title}`);
    lines.push(`**布局类型**：${LAYOUT_NAMES[slide.layout]}`);
    if (slide.subtitle) lines.push(`**副标题**：${slide.subtitle}`);
    lines.push('');
    lines.push('**要点**：');
    for (const pt of slide.keyPoints) {
      lines.push(`- ${pt}`);
    }
    lines.push('');
    lines.push(`**可视化建议**：${slide.visualSuggestion}`);
    if (slide.speakerNote) lines.push(`**演讲备注**：${slide.speakerNote}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  lines.push('## 风格指南');
  lines.push('');
  lines.push(`- **主题**：${result.styleGuide.theme}`);
  lines.push(`- **配色**：主色 ${result.styleGuide.colorScheme.primary} | 辅色 ${result.styleGuide.colorScheme.secondary} | 强调色 ${result.styleGuide.colorScheme.accent} | 背景 ${result.styleGuide.colorScheme.background}`);
  lines.push(`- **字体**：标题 ${result.styleGuide.fonts.heading} | 正文 ${result.styleGuide.fonts.body}`);
  lines.push(`- **图片风格**：${result.styleGuide.imageStyle}`);
  lines.push(`- **图表风格**：${result.styleGuide.chartStyle}`);
  lines.push('');
  lines.push('### 布局原则');
  for (const p of result.styleGuide.layoutPrinciples) {
    lines.push(`- ${p}`);
  }

  return lines.join('\n');
}

function buildJSONExport(result: PPTResult): string {
  return JSON.stringify(result, null, 2);
}

// Convert SlideOutline[] to SlideData[] for preview
function toSlideData(outlines: SlideOutline[]): SlideData[] {
  return outlines.map(o => ({
    title: o.title,
    layout: o.layout === 'toc' ? 'section' : o.layout,
    bullets: o.keyPoints,
    subTitle: o.subtitle,
    quote: o.layout === 'quote' ? o.keyPoints[0] : undefined,
    author: o.layout === 'quote' ? o.title : undefined,
  } as SlideData));
}

// ─── Slide Preview Component (from PPTGenerator) ─────────────────────

function SlidePreview({ slide, styleId }: { slide: SlideData; styleId: string }) {
  const STYLE = {
    businessBlue: {
      primary: 'bg-[#1e3a8a]', primaryFrom: 'from-[#1e3a8a]', primaryTo: 'to-[#0f2660]',
      light: 'bg-[#3b82f6]', lightText: 'text-[#3b82f6]',
      accent: 'bg-[#0d9488]', accentText: 'text-[#0d9488]',
      text: 'text-[#1e3a8a]', subText: 'text-blue-200',
      bg: 'bg-white', bgLight: 'bg-slate-50',
      bullet: 'bg-[#1e3a8a]', bar: 'bg-[#3b82f6]',
      titleAccent: 'text-blue-200', footer: 'text-blue-300',
      quote: 'text-blue-200', divider: 'bg-gray-200',
      thead: 'bg-[#1e3a8a]',
    },
    academic: {
      primary: 'bg-[#374151]', primaryFrom: 'from-[#374151]', primaryTo: 'to-[#1f2937]',
      light: 'bg-[#6b7280]', lightText: 'text-[#6b7280]',
      accent: 'bg-[#0369a1]', accentText: 'text-[#0369a1]',
      text: 'text-[#111827]', subText: 'text-slate-300',
      bg: 'bg-white', bgLight: 'bg-gray-50',
      bullet: 'bg-[#374151]', bar: 'bg-[#0369a1]',
      titleAccent: 'text-slate-200', footer: 'text-slate-300',
      quote: 'text-slate-300', divider: 'bg-gray-200',
      thead: 'bg-[#374151]',
    },
    minimalWhite: {
      primary: 'bg-[#18181b]', primaryFrom: 'from-[#18181b]', primaryTo: 'to-[#27272a]',
      light: 'bg-[#52525b]', lightText: 'text-[#52525b]',
      accent: 'bg-[#e11d48]', accentText: 'text-[#e11d48]',
      text: 'text-[#27272a]', subText: 'text-zinc-300',
      bg: 'bg-white', bgLight: 'bg-zinc-50',
      bullet: 'bg-[#18181b]', bar: 'bg-[#e11d48]',
      titleAccent: 'text-zinc-200', footer: 'text-zinc-400',
      quote: 'text-zinc-200', divider: 'bg-zinc-200',
      thead: 'bg-[#18181b]',
    },
    techDark: {
      primary: 'bg-slate-900', primaryFrom: 'from-slate-800', primaryTo: 'to-slate-900',
      light: 'bg-blue-400', lightText: 'text-blue-400',
      accent: 'bg-cyan-400', accentText: 'text-cyan-400',
      text: 'text-slate-100', subText: 'text-slate-300',
      bg: 'bg-slate-800', bgLight: 'bg-slate-900',
      bullet: 'bg-blue-400', bar: 'bg-blue-500',
      titleAccent: 'text-slate-300', footer: 'text-slate-400',
      quote: 'text-slate-600', divider: 'bg-slate-700',
      thead: 'bg-slate-700',
    },
    magazine: {
      primary: 'bg-amber-900', primaryFrom: 'from-amber-900', primaryTo: 'to-amber-950',
      light: 'bg-amber-400', lightText: 'text-amber-400',
      accent: 'bg-red-600', accentText: 'text-red-600',
      text: 'text-[#292524]', subText: 'text-amber-200',
      bg: 'bg-amber-50', bgLight: 'bg-amber-100',
      bullet: 'bg-amber-500', bar: 'bg-amber-500',
      titleAccent: 'text-amber-200', footer: 'text-amber-300',
      quote: 'text-amber-200', divider: 'bg-amber-200',
      thead: 'bg-amber-900',
    },
  } as const;

  const s = STYLE[styleId as keyof typeof STYLE] || STYLE.businessBlue;
  const isDark = styleId === 'techDark';
  const isTitle = slide.layout === 'title';

  const getBg = () => {
    if (isTitle) return `bg-gradient-to-br ${s.primaryFrom} ${s.primaryTo}`;
    if (isDark) return s.bg;
    if (styleId === 'magazine') return s.bg;
    return s.bgLight;
  };

  const getTextColor = () => {
    if (isTitle) return 'text-white';
    if (isDark) return s.text;
    return s.text;
  };

  const getSubTextColor = () => {
    if (isTitle) return s.subText;
    if (isDark) return 'text-slate-400';
    return 'text-gray-500';
  };

  const barColor = s.bar;
  const bulletColor = s.bullet;

  if (slide.layout === 'title') {
    return (
      <div className={`h-full flex flex-col items-center justify-center ${getBg()} text-white p-10 rounded-xl`}>
        <div className={`w-1 h-16 rounded-full mb-6 ${s.light}`} />
        <h1 className="text-3xl font-bold mb-4 text-center leading-tight">{slide.title}</h1>
        {slide.subTitle && <p className={`text-lg ${s.titleAccent} mb-4 text-center`}>{slide.subTitle}</p>}
        <div className={`text-sm ${s.footer} mt-2`}>{slide.bullets.join(' · ')}</div>
        <div className={`w-24 h-1 rounded-full mt-6 ${s.light}`} />
      </div>
    );
  }

  if (slide.layout === 'section') {
    return (
      <div className={`h-full flex flex-col items-center justify-center ${isDark ? 'bg-slate-800' : s.bgLight} p-10 rounded-xl`}>
        <div className={`w-1 h-16 rounded-full mb-6 ${s.primary}`} />
        <h1 className={`text-4xl font-bold text-center mb-3 ${getTextColor()}`}>{slide.title}</h1>
        {slide.subTitle && <p className={`text-base text-center ${getSubTextColor()}`}>{slide.subTitle}</p>}
      </div>
    );
  }

  if (slide.layout === 'quote') {
    return (
      <div className={`h-full flex flex-col items-center justify-center ${getBg()} p-10 rounded-xl`}>
        <div className={`text-7xl leading-none mb-4 ${isDark ? 'text-slate-600' : s.quote} font-serif`}>"</div>
        <p className={`text-lg italic text-center max-w-[80%] leading-relaxed mb-4 ${getTextColor()}`}>
          {slide.quote || slide.bullets[0] || slide.title}
        </p>
        <p className={`text-sm ${getSubTextColor()}`}>— {slide.author || slide.title}</p>
        <div className={`w-24 h-1 rounded-full mt-6 ${s.light}`} />
      </div>
    );
  }

  if (slide.layout === 'chart' && slide.chartData) {
    const maxVal = Math.max(...slide.chartData.map(d => d.value), 1);
    return (
      <div className={`h-full flex flex-col ${getBg()} p-8 rounded-xl`}>
        <div className={`w-full h-1 rounded-full mb-4 ${s.primary}`} />
        <h2 className={`text-2xl font-bold mb-2 ${getTextColor()}`}>{slide.title}</h2>
        <div className={`w-10 h-1 rounded-full mb-5 ${s.light}`} />
        <div className="flex-1 flex flex-col justify-center gap-3 overflow-auto">
          {slide.chartData.map((d, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className={`text-sm w-32 text-right truncate flex-shrink-0 ${isDark ? 'text-slate-300' : 'text-gray-600'}`}>{d.label}</span>
              <div className="flex-1 h-8 bg-gray-100 rounded-md overflow-hidden">
                <div className={`h-full rounded-md flex items-center justify-end pr-2 transition-all duration-500 ${barColor}`} style={{ width: `${Math.max((d.value / maxVal) * 100, 5)}%` }}>
                  <span className="text-xs text-white font-medium">{d.value}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (slide.layout === 'twoColumn') {
    const left = slide.leftColumn || slide.bullets.slice(0, Math.ceil(slide.bullets.length / 2));
    const right = slide.rightColumn || slide.bullets.slice(Math.ceil(slide.bullets.length / 2));
    return (
      <div className={`h-full flex flex-col ${getBg()} p-8 rounded-xl`}>
        <div className={`w-full h-1 rounded-full mb-4 ${s.primary}`} />
        <h2 className={`text-2xl font-bold mb-2 ${getTextColor()}`}>{slide.title}</h2>
        <div className={`w-10 h-1 rounded-full mb-5 ${s.light}`} />
        <div className="flex-1 flex gap-6 overflow-auto">
          <ul className="flex-1 space-y-2">
            {left.map((b, i) => (
              <li key={i} className={`flex items-start gap-2 text-sm leading-relaxed ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-2 ${s.light}`} />
                <span>{b}</span>
              </li>
            ))}
          </ul>
          <div className={`w-px ${isDark ? 'bg-slate-700' : s.divider}`} />
          <ul className="flex-1 space-y-2">
            {right.map((b, i) => (
              <li key={i} className={`flex items-start gap-2 text-sm leading-relaxed ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-2 ${s.light}`} />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  // Default content / data
  return (
    <div className={`h-full flex flex-col ${getBg()} p-8 rounded-xl`}>
      <div className={`w-full h-1 rounded-full mb-4 ${s.primary}`} />
      <h2 className={`text-2xl font-bold mb-2 ${getTextColor()}`}>{slide.title}</h2>
      <div className={`w-10 h-1 rounded-full mb-5 ${s.light}`} />
      {slide.highlight && (
        <div className="text-center py-4 mb-3">
          <p className={`text-xl font-semibold ${getTextColor()}`}>{slide.highlight}</p>
        </div>
      )}
      {slide.tableData && slide.tableData.length > 0 ? (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={`${s.thead} text-white`}>
                {slide.tableData[0].map((cell, i) => (
                  <th key={i} className="px-3 py-2 text-left font-medium">{cell}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slide.tableData.slice(1).map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? (isDark ? 'bg-slate-800' : s.bgLight) : (isDark ? 'bg-slate-900' : 'bg-white')}>
                  {row.map((cell, ci) => (
                    <td key={ci} className={`px-3 py-2 border-b ${isDark ? 'text-slate-300 border-slate-700' : 'text-gray-700 border-gray-100'}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="flex-1 space-y-3 overflow-auto">
          {slide.bullets.map((b, i) => (
            <li key={i} className={`flex items-start gap-3 text-[15px] leading-relaxed ${isDark ? 'text-slate-300' : 'text-gray-700'}`}>
              <span className={`w-6 h-6 rounded-full text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-medium ${bulletColor}`}>
                {i + 1}
              </span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────

// localStorage 持久化
const PPT_CHAT_KEY = 'casebuddy-ppt-chat';
const PPT_RESULT_KEY = 'casebuddy-ppt-result';

function loadPPTChat(): ChatMsg[] {
  try { return JSON.parse(localStorage.getItem(PPT_CHAT_KEY) || '[]'); }
  catch { return []; }
}
function loadPPTResult(): PPTResult | null {
  try { return JSON.parse(localStorage.getItem(PPT_RESULT_KEY) || 'null'); }
  catch { return null; }
}

export default function PPTAssistant() {
  const { session } = useSession();
  const [models] = useLocalStorage<ModelConfig[]>('casebuddy-models', defaultModels);
  const [activeModelId, setActiveModelId] = useLocalStorage<string | null>('casebuddy-active-model', null);

  // Data source
  const [dataSource, setDataSource] = useState<DataSource>('session');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [topicText, setTopicText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Output — 从 localStorage 恢复
  const [result, setResult] = useState<PPTResult | null>(loadPPTResult);
  const [activeTab, setActiveTab] = useState<OutputTab>('outline');
  const [currentSlide, setCurrentSlide] = useState(0);
  const [showFullscreenPreview, setShowFullscreenPreview] = useState(false);

  // Chat — 从 localStorage 恢复
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>(loadPPTChat);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Config
  const [selectedStyle, setSelectedStyle] = useState('businessBlue');
  const [nSlides, setNSlides] = useState(10);
  const [showConfig, setShowConfig] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentModel = models.find(m => m.id === activeModelId) || models.find(m => m.isDefault) || models[0];

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // 持久化聊天记录到 localStorage
  useEffect(() => {
    try {
      const trimmed = chatMessages.slice(-100);
      localStorage.setItem(PPT_CHAT_KEY, JSON.stringify(trimmed));
    } catch { /* ignore quota errors */ }
  }, [chatMessages]);

  // 持久化 PPT 结果到 localStorage
  useEffect(() => {
    try {
      if (result) {
        localStorage.setItem(PPT_RESULT_KEY, JSON.stringify(result));
      }
    } catch { /* ignore quota errors */ }
  }, [result]);

  // Build context from selected data source
  const buildContext = useCallback((): { text: string; sourceName: string } => {
    if (dataSource === 'session') {
      const parts: string[] = [];
      if (session.caseText) {
        parts.push(`【案例正文】\n${session.caseText.slice(0, 2500)}`);
      }
      if (session.messages.length > 0) {
        const summary = session.messages
          .filter(m => m.role === 'assistant')
          .slice(-5)
          .map((m, i) => `分析${i + 1}:\n${m.content.slice(0, 1000)}`)
          .join('\n\n');
        parts.push(`【分析内容】\n${summary}`);
      }
      return { text: parts.join('\n\n---\n\n'), sourceName: `会话：${session.title}` };
    }

    if (dataSource === 'topic') {
      return { text: topicText, sourceName: `主题：${topicText.slice(0, 30)}...` };
    }

    // file - will be handled separately via FormData
    return { text: '', sourceName: `文件：${uploadedFile?.name || ''}` };
  }, [dataSource, session, topicText, uploadedFile]);

  // Initial welcome message
  useEffect(() => {
    if (chatMessages.length === 0) {
      setChatMessages([{
        id: 'welcome',
        role: 'assistant',
        content: `你好！我是你的 **AI PPT助手**。\n\n我可以帮你：\n1. **生成结构化PPT大纲** — 每页都有 Action Title 和要点\n2. **输出风格指南** — 配色、字体、图表规范\n3. **生成豆包/Gamma/Canva 提示词** — 一键复制到AI平台生成精美PPT\n\n请先选择数据源（上方标签），然后告诉我你的需求，比如：\n- "生成10页案例分析PPT"\n- "用SWOT框架做PPT"\n- "生成商务风格的汇报PPT"`,
        timestamp: Date.now(),
      }]);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFile(file);

    // Read text files directly
    if (file.type === 'text/plain' || file.name.endsWith('.md') || file.name.endsWith('.txt')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string || '';
        setChatMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          content: `已读取文件 **${file.name}**（${text.length} 字符）。\n\n可以直接说"生成PPT大纲"开始。`,
          timestamp: Date.now(),
        }]);
        // Store file content for later use
        (window as unknown as Record<string, string>).__pptFileContent = text;
      };
      reader.readAsText(file);
    } else {
      setChatMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `已选择文件 **${file.name}**。非文本文件将在生成时通过后端解析。\n\n可以直接说"生成PPT大纲"开始。`,
        timestamp: Date.now(),
      }]);
    }
  };

  const sendMessage = async (content: string) => {
    if (!content.trim()) return;
    if (!currentModel) {
      setError('请先配置模型');
      return;
    }

    const userMsg: ChatMsg = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    setChatMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const isGenerateRequest = /生成|做|创建|制作|大纲|ppt|PPT/.test(content);

      if (isGenerateRequest) {
        // Build context based on data source
        let contextText = '';
        if (dataSource === 'file' && uploadedFile) {
          const cached = (window as unknown as Record<string, string>).__pptFileContent;
          contextText = cached || `文件：${uploadedFile.name}`;
        } else {
          const ctx = buildContext();
          contextText = ctx.text;
        }

        const styleInfo = STYLE_PRESETS.find(s => s.id === selectedStyle);

        const response = await fetch('/api/ppt/generate-outline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseUrl: currentModel.baseUrl,
            apiKey: currentModel.apiKey,
            model: currentModel.modelId,
            content: contextText,
            style: selectedStyle,
            nSlides,
            instructions: content,
            conversationHistory: chatMessages.slice(-6).map(m => ({ role: m.role, content: m.content })),
          }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: '生成失败' }));
          throw new Error(err.error || '生成失败');
        }

        const data = await response.json();

        if (data.result) {
          setResult(data.result);
          setActiveTab('outline');
          const assistantMsg: ChatMsg = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `PPT大纲已生成！\n\n**${data.result.title}**\n共 ${data.result.totalSlides} 页 · ${styleInfo?.name || '商务蓝'}风格\n\n你可以在右侧查看：\n- **大纲** — 每页结构和要点\n- **风格** — 配色/字体/图表规范\n- **豆包** — 复制提示词到豆包AI生成PPT\n- **预览** — 视觉参考\n\n需要修改的话直接告诉我，比如"把第3页改成SWOT分析"。`,
            timestamp: Date.now(),
          };
          setChatMessages(prev => [...prev, assistantMsg]);
        } else if (data.outline) {
          // Fallback for old API format - convert to new format
          const converted = convertOldFormat(data.outline, selectedStyle);
          setResult(converted);
          setActiveTab('outline');
          const assistantMsg: ChatMsg = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `PPT大纲已生成！\n\n**${converted.title}**\n共 ${converted.totalSlides} 页\n\n你可以在右侧查看大纲、风格和豆包提示词。`,
            timestamp: Date.now(),
          };
          setChatMessages(prev => [...prev, assistantMsg]);
        } else {
          throw new Error('返回数据中没有大纲');
        }
      } else {
        // General chat
        const ctx = buildContext();
        const response = await fetch('/api/proxy/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseUrl: currentModel.baseUrl,
            apiKey: currentModel.apiKey,
            model: currentModel.modelId,
            messages: [
              {
                role: 'system',
                content: `你是一位PPT设计专家和MBA案例分析顾问。当前正在为"${session.title || '案例分析'}"设计PPT。风格：${STYLE_PRESETS.find(s => s.id === selectedStyle)?.name || '商务蓝'}，页数：${nSlides}页。请简洁回答用户关于PPT设计的问题。`,
              },
              {
                role: 'user',
                content: `上下文：\n${ctx.text.slice(0, 1500)}\n\n用户问题：${content}`,
              },
            ],
            temperature: 0.7,
            max_tokens: 2000,
          }),
        });

        if (!response.ok) {
          const err = await response.text();
          throw new Error(`API错误: ${err}`);
        }

        const data = await response.json();
        const reply = data.choices?.[0]?.message?.content || '无响应';

        setChatMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: reply,
          timestamp: Date.now(),
        }]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { /* ignore */ }
  };

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPPTX = async () => {
    if (!result) return;
    setExporting(true);
    try {
      const slides = toSlideData(result.slides);
      await generatePPTX(slides, result.title, selectedStyle);
    } catch (err) {
      setError('导出失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setExporting(false);
    }
  };

  // Preview slides
  const previewSlides = useMemo(() => {
    if (!result) return [];
    return toSlideData(result.slides);
  }, [result]);

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="h-14 bg-white/90 backdrop-blur-md border-b border-surface-200/80 flex items-center px-6 justify-between flex-shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-accent-500 rounded-lg flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-surface-800">AI PPT助手</h1>
            <p className="text-[11px] text-surface-400">大纲 · 风格 · 提示词 · 一站式PPT设计</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {result && (
            <button
              onClick={handleExportPPTX}
              disabled={exporting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent-500 hover:bg-accent-600 disabled:opacity-50 text-white rounded-lg transition-colors font-medium"
            >
              <Download className="w-3.5 h-3.5" />
              {exporting ? '导出中...' : '导出 PPTX'}
            </button>
          )}
          <button
            onClick={() => setShowConfig(!showConfig)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors font-medium ${showConfig ? 'bg-primary-50 text-primary-600' : 'text-surface-500 hover:bg-surface-100'}`}
          >
            <Settings2 className="w-3.5 h-3.5" />
            配置
          </button>
        </div>
      </div>

      {/* Config Panel */}
      {showConfig && (
        <div className="bg-white border-b border-surface-200 p-4 flex-shrink-0 animate-message-in">
          <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Model Selection */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-surface-600 mb-2">
                <Bot className="w-3.5 h-3.5" />
                LLM 模型
              </label>
              <div className="space-y-1.5">
                {models.map(m => (
                  <button
                    key={m.id}
                    onClick={() => setActiveModelId(m.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg transition-colors text-left ${
                      m.id === currentModel?.id
                        ? 'bg-primary-50 text-primary-700 border border-primary-200'
                        : 'text-surface-600 hover:bg-surface-50 border border-transparent'
                    }`}
                  >
                    <div className={`w-2 h-2 rounded-full ${m.id === currentModel?.id ? 'bg-primary-500' : 'bg-surface-300'}`} />
                    <span className="font-medium truncate">{m.name}</span>
                    <span className="text-surface-400 ml-auto flex-shrink-0">{m.modelId}</span>
                  </button>
                ))}
                {models.length === 0 && (
                  <p className="text-xs text-surface-400">未配置模型，请前往「模型配置」</p>
                )}
              </div>
            </div>

            {/* Style Selection */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-surface-600 mb-2">
                <Palette className="w-3.5 h-3.5" />
                设计风格
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {STYLE_PRESETS.map(s => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedStyle(s.id)}
                    className={`px-3 py-2 text-xs rounded-lg transition-colors text-left ${
                      s.id === selectedStyle
                        ? 'bg-primary-50 text-primary-700 border border-primary-200'
                        : 'text-surface-600 hover:bg-surface-50 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <div className="flex gap-0.5">
                        {s.colors.slice(0, 3).map((c, i) => (
                          <div key={i} className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c }} />
                        ))}
                      </div>
                      <span className="font-medium">{s.name}</span>
                    </div>
                    <div className="text-[10px] text-surface-400 mt-0.5">{s.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Slide count & Other */}
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-surface-600 mb-1.5 flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5" />
                  页数
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range" min={5} max={20} value={nSlides}
                    onChange={e => setNSlides(Number(e.target.value))}
                    className="w-24"
                  />
                  <span className="text-xs font-medium text-surface-700 w-6">{nSlides}</span>
                </div>
              </div>
              <div className="bg-surface-50 rounded-lg border border-surface-200 p-2.5">
                <p className="text-[11px] text-surface-500">
                  <Lightbulb className="w-3 h-3 inline mr-1 text-amber-500" />
                  提示：输出内容可直接复制到豆包AI、Gamma、Canva等平台生成精美PPT
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="px-6 py-2.5 bg-rose-50 border-b border-rose-100 flex items-center gap-2 flex-shrink-0 animate-message-in">
          <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />
          <span className="text-sm text-rose-600">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-xs text-rose-400 hover:text-rose-600">关闭</button>
        </div>
      )}

      {/* Data Source Selector */}
      <div className="bg-white border-b border-surface-200 px-6 py-2 flex-shrink-0">
        <div className="flex items-center gap-1 bg-surface-100 rounded-lg p-1 w-fit">
          {([
            { id: 'session' as DataSource, label: '从会话生成', icon: MessageSquare },
            { id: 'file' as DataSource, label: '上传文件', icon: FileUp },
            { id: 'topic' as DataSource, label: '自定义主题', icon: Type },
          ]).map(item => (
            <button
              key={item.id}
              onClick={() => setDataSource(item.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
                dataSource === item.id
                  ? 'bg-white text-primary-700 shadow-sm font-medium'
                  : 'text-surface-500 hover:text-surface-700'
              }`}
            >
              <item.icon className="w-3.5 h-3.5" />
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left - Chat & Input */}
        <div className="w-[40%] min-w-[360px] flex flex-col border-r border-surface-200 bg-surface-50">
          {/* Data Source Detail */}
          <div className="px-4 pt-3 pb-2 flex-shrink-0">
            {dataSource === 'session' && (
              <div className="bg-primary-50 rounded-lg border border-primary-100 p-2.5">
                <div className="flex items-center gap-2 text-xs text-primary-700">
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span className="font-medium">当前会话：{session.title}</span>
                </div>
                <p className="text-[11px] text-primary-500 mt-1">
                  {session.caseText ? `案例正文 ${session.caseText.length} 字符` : '无案例正文'} ·
                  {session.messages.filter(m => m.role === 'assistant').length} 轮分析
                </p>
              </div>
            )}
            {dataSource === 'file' && (
              <div>
                <input ref={fileInputRef} type="file" accept=".md,.txt" onChange={handleFileSelect} className="hidden" />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className={`w-full border-2 border-dashed rounded-lg p-3 text-center transition-all ${
                    uploadedFile ? 'border-primary-300 bg-primary-50' : 'border-surface-300 hover:border-surface-400'
                  }`}
                >
                  <FileUp className={`w-5 h-5 mx-auto mb-1 ${uploadedFile ? 'text-primary-500' : 'text-surface-400'}`} />
                  {uploadedFile ? (
                    <p className="text-xs text-primary-700 font-medium">{uploadedFile.name}</p>
                  ) : (
                    <p className="text-xs text-surface-500">点击上传 Markdown / 文本文件</p>
                  )}
                </button>
              </div>
            )}
            {dataSource === 'topic' && (
              <textarea
                value={topicText}
                onChange={e => setTopicText(e.target.value)}
                placeholder="输入PPT主题或粘贴内容..."
                className="w-full h-20 rounded-lg border border-surface-200 p-2.5 text-xs resize-none focus:ring-2 focus:ring-primary-500/25 focus:border-primary-400 outline-none"
              />
            )}
          </div>

          {/* Chat Messages */}
          <div className="flex-1 overflow-auto overscroll-contain px-4 py-3 space-y-3 scrollbar-thin">
            {chatMessages.map((msg) => (
              <div key={msg.id} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  msg.role === 'user' ? 'bg-gradient-to-br from-primary-500 to-primary-600' : 'bg-gradient-to-br from-accent-500 to-accent-600'
                }`}>
                  {msg.role === 'user' ? <User className="w-3 h-3 text-white" /> : <Bot className="w-3 h-3 text-white" />}
                </div>
                <div className={`relative group max-w-[88%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-br from-primary-500 to-primary-600 text-white shadow-md'
                    : 'bg-white border border-surface-200/80 text-surface-700 shadow-sm'
                }`}>
                  {msg.role === 'assistant' ? (
                    <MarkdownContent content={msg.content} />
                  ) : (
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex gap-2.5">
                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-accent-500 to-accent-600 flex items-center justify-center">
                  <Bot className="w-3 h-3 text-white" />
                </div>
                <div className="bg-white border border-surface-200/80 rounded-xl px-3 py-2 shadow-sm">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 text-accent-500 animate-spin" />
                    <span className="text-xs text-surface-500">AI 正在生成...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Actions */}
          {chatMessages.length <= 2 && !loading && (
            <div className="px-4 pb-2 flex-shrink-0">
              <p className="text-[10px] text-surface-400 mb-1.5 uppercase tracking-wider">快捷指令</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  '生成10页PPT大纲',
                  '用SWOT框架做PPT',
                  '生成汇报总结PPT',
                  '做一份竞品分析PPT',
                ].map(cmd => (
                  <button
                    key={cmd}
                    onClick={() => sendMessage(cmd)}
                    className="px-2 py-1 text-[11px] bg-white border border-surface-200 hover:border-primary-300 hover:text-primary-600 rounded-md transition-colors"
                  >
                    {cmd}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="bg-white border-t border-surface-200 p-3 flex-shrink-0">
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={loading ? 'AI 正在生成...' : '描述你想要的PPT...'}
                disabled={loading}
                className="flex-1 px-3 py-2 bg-surface-50 border border-surface-200 rounded-lg text-xs focus:ring-2 focus:ring-primary-500/25 focus:border-primary-400 outline-none disabled:bg-surface-100"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="px-3 py-2 bg-gradient-to-br from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 disabled:from-surface-300 disabled:to-surface-300 text-white rounded-lg transition-all flex items-center gap-1 font-medium btn-press"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </div>

        {/* Right - Output Tabs */}
        <div className="flex-1 flex flex-col bg-surface-100 min-w-0">
          {result ? (
            <>
              {/* Tab Bar */}
              <div className="h-11 bg-white border-b border-surface-200 flex items-center px-4 gap-0.5 flex-shrink-0">
                {([
                  { id: 'outline' as OutputTab, label: '大纲', icon: BookOpen },
                  { id: 'style' as OutputTab, label: '风格', icon: Palette },
                  { id: 'doubao' as OutputTab, label: '豆包提示词', icon: Smartphone },
                  { id: 'preview' as OutputTab, label: '预览', icon: Eye },
                  { id: 'export' as OutputTab, label: '导出', icon: Share2 },
                ]).map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg transition-colors ${
                      activeTab === tab.id
                        ? 'bg-primary-50 text-primary-700 font-medium'
                        : 'text-surface-500 hover:text-surface-700 hover:bg-surface-50'
                    }`}
                  >
                    <tab.icon className="w-3.5 h-3.5" />
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <div className="flex-1 overflow-auto p-5">
                {/* Outline Tab */}
                {activeTab === 'outline' && (
                  <div className="max-w-3xl mx-auto space-y-4 animate-fade-in-scale">
                    <div className="bg-white rounded-xl border border-surface-200 p-5">
                      <h2 className="text-lg font-bold text-surface-800">{result.title}</h2>
                      <p className="text-sm text-surface-500 mt-1">{result.subtitle}</p>
                      <div className="flex items-center gap-3 mt-3">
                        <span className="text-xs bg-primary-50 text-primary-700 px-2 py-1 rounded-md font-medium">{result.totalSlides} 页</span>
                        <span className="text-xs bg-surface-100 text-surface-600 px-2 py-1 rounded-md">{result.styleGuide.theme}</span>
                      </div>
                    </div>

                    {result.slides.map((slide) => {
                      const Icon = LAYOUT_ICONS[slide.layout] || Layout;
                      return (
                        <div key={slide.page} className="bg-white rounded-xl border border-surface-200 p-4 card-hover">
                          <div className="flex items-center gap-2 mb-3">
                            <div className="w-7 h-7 rounded-lg bg-primary-50 flex items-center justify-center">
                              <span className="text-xs font-bold text-primary-700">{slide.page}</span>
                            </div>
                            <Icon className="w-3.5 h-3.5 text-surface-400" />
                            <span className="text-[11px] text-surface-400">{LAYOUT_NAMES[slide.layout]}</span>
                            <span className="ml-auto text-[10px] text-surface-300">Action Title</span>
                          </div>
                          <h3 className="text-sm font-semibold text-surface-800 mb-2">{slide.title}</h3>
                          {slide.subtitle && <p className="text-xs text-surface-500 mb-2">{slide.subtitle}</p>}
                          <ul className="space-y-1.5 mb-3">
                            {slide.keyPoints.map((pt, i) => (
                              <li key={i} className="flex items-start gap-2 text-xs text-surface-600">
                                <span className="w-1 h-1 rounded-full bg-primary-400 flex-shrink-0 mt-1.5" />
                                <span>{pt}</span>
                              </li>
                            ))}
                          </ul>
                          <div className="bg-amber-50 rounded-lg p-2.5 border border-amber-100">
                            <div className="flex items-center gap-1.5 text-[11px] text-amber-700">
                              <Lightbulb className="w-3 h-3" />
                              <span className="font-medium">可视化建议</span>
                            </div>
                            <p className="text-[11px] text-amber-600 mt-0.5">{slide.visualSuggestion}</p>
                          </div>
                          {slide.speakerNote && (
                            <div className="mt-2 text-[11px] text-surface-400 italic">
                              备注：{slide.speakerNote}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Style Tab */}
                {activeTab === 'style' && (
                  <div className="max-w-2xl mx-auto space-y-5 animate-fade-in-scale">
                    <div className="bg-white rounded-xl border border-surface-200 p-5">
                      <h3 className="text-sm font-bold text-surface-800 mb-1">{result.styleGuide.theme}</h3>
                      <p className="text-xs text-surface-500">{result.styleGuide.themeDesc}</p>
                    </div>

                    <div className="bg-white rounded-xl border border-surface-200 p-5">
                      <h3 className="text-sm font-bold text-surface-800 mb-3">配色方案</h3>
                      <div className="grid grid-cols-5 gap-3">
                        {Object.entries(result.styleGuide.colorScheme).map(([key, color]) => (
                          <div key={key} className="text-center">
                            <div className="w-12 h-12 rounded-xl mx-auto mb-1.5 border border-surface-200 shadow-sm" style={{ backgroundColor: color }} />
                            <p className="text-[10px] text-surface-400 capitalize">{key === 'background' ? 'bg' : key}</p>
                            <p className="text-[10px] font-mono text-surface-600">{color}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border border-surface-200 p-5">
                      <h3 className="text-sm font-bold text-surface-800 mb-3">字体规范</h3>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-surface-50 rounded-lg p-3">
                          <p className="text-[10px] text-surface-400 uppercase tracking-wider mb-1">标题字体</p>
                          <p className="text-sm font-semibold text-surface-800">{result.styleGuide.fonts.heading}</p>
                          <p className="text-[11px] text-surface-500 mt-1">32-40pt / Bold</p>
                        </div>
                        <div className="bg-surface-50 rounded-lg p-3">
                          <p className="text-[10px] text-surface-400 uppercase tracking-wider mb-1">正文字体</p>
                          <p className="text-sm font-semibold text-surface-800">{result.styleGuide.fonts.body}</p>
                          <p className="text-[11px] text-surface-500 mt-1">18-24pt / Regular</p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border border-surface-200 p-5">
                      <h3 className="text-sm font-bold text-surface-800 mb-3">视觉规范</h3>
                      <div className="space-y-2.5">
                        <div className="flex items-start gap-2">
                          <Image className="w-3.5 h-3.5 text-surface-400 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-medium text-surface-700">图片风格</p>
                            <p className="text-xs text-surface-500">{result.styleGuide.imageStyle}</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <BarChart3 className="w-3.5 h-3.5 text-surface-400 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-medium text-surface-700">图表风格</p>
                            <p className="text-xs text-surface-500">{result.styleGuide.chartStyle}</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border border-surface-200 p-5">
                      <h3 className="text-sm font-bold text-surface-800 mb-3">布局原则</h3>
                      <ul className="space-y-2">
                        {result.styleGuide.layoutPrinciples.map((p, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-surface-600">
                            <span className="w-4 h-4 rounded-full bg-primary-50 text-primary-600 text-[10px] flex items-center justify-center flex-shrink-0 font-bold">{i + 1}</span>
                            <span>{p}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {/* Doubao Tab */}
                {activeTab === 'doubao' && (
                  <div className="max-w-3xl mx-auto space-y-4 animate-fade-in-scale">
                    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-100 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Smartphone className="w-4 h-4 text-blue-600" />
                        <h3 className="text-sm font-bold text-blue-800">豆包 AI 提示词</h3>
                      </div>
                      <p className="text-xs text-blue-600">复制以下内容，粘贴到豆包AI对话框，即可生成精美PPT</p>
                    </div>

                    <div className="relative">
                      <pre className="bg-surface-900 text-surface-200 rounded-xl p-4 text-xs leading-relaxed overflow-auto max-h-[60vh] font-mono whitespace-pre-wrap">
                        {result.platformPrompts.doubao}
                      </pre>
                      <button
                        onClick={() => copyToClipboard(result.platformPrompts.doubao, 'doubao')}
                        className="absolute top-3 right-3 flex items-center gap-1 px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs transition-colors"
                      >
                        {copiedId === 'doubao' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedId === 'doubao' ? '已复制' : '复制'}
                      </button>
                    </div>

                    <div className="bg-amber-50 rounded-xl border border-amber-100 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Lightbulb className="w-4 h-4 text-amber-600" />
                        <h3 className="text-sm font-bold text-amber-800">使用步骤</h3>
                      </div>
                      <ol className="space-y-1.5 text-xs text-amber-700">
                        <li>1. 点击上方「复制」按钮复制提示词</li>
                        <li>2. 打开豆包APP或网页版（doubao.com）</li>
                        <li>3. 粘贴提示词并发送</li>
                        <li>4. 根据豆包生成的内容，选择「生成PPT」功能</li>
                        <li>5. 在豆包中选择喜欢的模板，微调即可</li>
                      </ol>
                    </div>
                  </div>
                )}

                {/* Preview Tab */}
                {activeTab === 'preview' && (
                  <div className="h-full flex flex-col animate-fade-in-scale">
                    {previewSlides.length > 0 ? (
                      <>
                        {/* Slide thumbnails */}
                        <div className="bg-white border border-surface-200 rounded-xl p-3 mb-4 flex-shrink-0">
                          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
                            {previewSlides.map((slide, i) => (
                              <button
                                key={i}
                                onClick={() => setCurrentSlide(i)}
                                className={`flex-shrink-0 w-28 h-16 rounded-lg border-2 overflow-hidden transition-all btn-press ${
                                  i === currentSlide ? 'border-primary-500 shadow-sm' : 'border-surface-200 hover:border-surface-300'
                                }`}
                              >
                                <div className="w-full h-full p-1.5 bg-surface-50">
                                  <div className={`text-[8px] font-medium truncate ${i === currentSlide ? 'text-primary-700' : 'text-surface-500'}`}>
                                    {slide.title}
                                  </div>
                                  <div className="text-[7px] text-surface-400 mt-0.5">{slide.layout}</div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Main preview */}
                        <div className="flex-1 flex items-center justify-center min-h-0">
                          <div className="w-full max-w-3xl aspect-video">
                            <SlidePreview slide={previewSlides[currentSlide]} styleId={selectedStyle} />
                          </div>
                        </div>

                        {/* Bottom nav */}
                        <div className="h-10 flex items-center justify-center gap-4 mt-3 flex-shrink-0">
                          <button
                            onClick={() => setCurrentSlide(prev => Math.max(0, prev - 1))}
                            disabled={currentSlide === 0}
                            className="p-1.5 rounded-lg hover:bg-surface-200 disabled:opacity-30 transition-colors"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          <span className="text-xs text-surface-600 font-medium">{currentSlide + 1} / {previewSlides.length}</span>
                          <button
                            onClick={() => setCurrentSlide(prev => Math.min(previewSlides.length - 1, prev + 1))}
                            disabled={currentSlide === previewSlides.length - 1}
                            className="p-1.5 rounded-lg hover:bg-surface-200 disabled:opacity-30 transition-colors"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setShowFullscreenPreview(true)}
                            className="ml-4 flex items-center gap-1 px-2.5 py-1 text-xs text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors"
                          >
                            <Eye className="w-3 h-3" />
                            全屏
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-surface-400">
                        <p>暂无预览内容</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Export Tab */}
                {activeTab === 'export' && (
                  <div className="max-w-2xl mx-auto space-y-4 animate-fade-in-scale">
                    <div className="bg-white rounded-xl border border-surface-200 p-5">
                      <h3 className="text-sm font-bold text-surface-800 mb-4">导出选项</h3>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={() => downloadFile(buildMarkdownExport(result), `${result.title}.md`, 'text/markdown')}
                          className="flex items-center gap-3 p-4 rounded-xl border border-surface-200 hover:border-primary-300 hover:bg-primary-50 transition-all text-left"
                        >
                          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                            <FileText className="w-5 h-5 text-blue-600" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-surface-800">Markdown</p>
                            <p className="text-[11px] text-surface-400">结构化大纲文本</p>
                          </div>
                        </button>

                        <button
                          onClick={() => downloadFile(buildJSONExport(result), `${result.title}.json`, 'application/json')}
                          className="flex items-center gap-3 p-4 rounded-xl border border-surface-200 hover:border-primary-300 hover:bg-primary-50 transition-all text-left"
                        >
                          <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                            <Hash className="w-5 h-5 text-emerald-600" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-surface-800">JSON</p>
                            <p className="text-[11px] text-surface-400">结构化数据格式</p>
                          </div>
                        </button>

                        <button
                          onClick={() => copyToClipboard(buildDoubaoPrompt(result), 'export-doubao')}
                          className="flex items-center gap-3 p-4 rounded-xl border border-surface-200 hover:border-primary-300 hover:bg-primary-50 transition-all text-left"
                        >
                          <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
                            <Smartphone className="w-5 h-5 text-purple-600" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-surface-800">豆包提示词</p>
                            <p className="text-[11px] text-surface-400">{copiedId === 'export-doubao' ? '已复制到剪贴板' : '复制到剪贴板'}</p>
                          </div>
                        </button>

                        <button
                          onClick={handleExportPPTX}
                          disabled={exporting}
                          className="flex items-center gap-3 p-4 rounded-xl border border-surface-200 hover:border-primary-300 hover:bg-primary-50 transition-all text-left disabled:opacity-50"
                        >
                          <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center">
                            <Presentation className="w-5 h-5 text-orange-600" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-surface-800">PPTX 文件</p>
                            <p className="text-[11px] text-surface-400">{exporting ? '生成中...' : '基础样式PPTX'}</p>
                          </div>
                        </button>

                        <button
                          onClick={async () => {
                            const mdContent = buildMarkdownExport(result);
                            try {
                              const res = await fetch('http://localhost:3001/api/gateway/push-wechat', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ content: mdContent, title: `【${result.title}】PPT大纲` }),
                              });
                              if (res.ok) {
                                alert('✅ PPT大纲已推送到微信！');
                              } else {
                                const d = await res.json();
                                alert(`❌ 推送失败: ${d.error || '请确认微信已登录'}`);
                              }
                            } catch {
                              alert('❌ 网络错误，请确认后端和微信网关已启动');
                            }
                          }}
                          className="flex items-center gap-3 p-4 rounded-xl border border-green-200 hover:border-green-400 hover:bg-green-50 transition-all text-left"
                        >
                          <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
                            <MessageCircle className="w-5 h-5 text-green-600" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-surface-800">发送到微信</p>
                            <p className="text-[11px] text-surface-400">推送大纲到微信</p>
                          </div>
                        </button>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border border-surface-200 p-5">
                      <h3 className="text-sm font-bold text-surface-800 mb-3">第三方平台</h3>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between p-3 bg-surface-50 rounded-lg">
                          <div className="flex items-center gap-2">
                            <Monitor className="w-4 h-4 text-surface-500" />
                            <span className="text-xs text-surface-700">Gamma.app</span>
                          </div>
                          <button
                            onClick={() => copyToClipboard(result.platformPrompts.gamma, 'gamma')}
                            className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                          >
                            {copiedId === 'gamma' ? '已复制' : '复制提示词'}
                          </button>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-surface-50 rounded-lg">
                          <div className="flex items-center gap-2">
                            <Image className="w-4 h-4 text-surface-500" />
                            <span className="text-xs text-surface-700">Canva</span>
                          </div>
                          <button
                            onClick={() => copyToClipboard(result.platformPrompts.canva, 'canva')}
                            className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                          >
                            {copiedId === 'canva' ? '已复制' : '复制提示词'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-surface-400">
              <div className="w-16 h-16 bg-surface-200/60 rounded-2xl flex items-center justify-center mb-4">
                <Presentation className="w-8 h-8 text-surface-400" />
              </div>
              <p className="text-base font-medium text-surface-600 mb-1">PPT 输出区</p>
              <p className="text-xs text-surface-400 text-center max-w-[320px] leading-relaxed">
                在左侧与AI对话生成PPT大纲后<br />
                这里将展示结构化大纲、风格指南和平台提示词
              </p>
              <div className="mt-6 flex gap-2">
                <span className="px-2.5 py-1 bg-surface-200/50 rounded-md text-[10px] text-surface-500">大纲</span>
                <span className="px-2.5 py-1 bg-surface-200/50 rounded-md text-[10px] text-surface-500">风格</span>
                <span className="px-2.5 py-1 bg-surface-200/50 rounded-md text-[10px] text-surface-500">豆包</span>
                <span className="px-2.5 py-1 bg-surface-200/50 rounded-md text-[10px] text-surface-500">预览</span>
                <span className="px-2.5 py-1 bg-surface-200/50 rounded-md text-[10px] text-surface-500">导出</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Full Screen Preview */}
      {showFullscreenPreview && previewSlides.length > 0 && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 md:p-8 animate-fade-in-scale">
          <button onClick={() => setShowFullscreenPreview(false)} className="absolute top-4 right-4 p-2.5 bg-white/10 hover:bg-white/20 rounded-xl text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
          <div className="w-full max-w-4xl aspect-video">
            <SlidePreview slide={previewSlides[currentSlide]} styleId={selectedStyle} />
          </div>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-4">
            <button onClick={() => setCurrentSlide(prev => Math.max(0, prev - 1))} disabled={currentSlide === 0} className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white disabled:opacity-30 transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="px-4 py-2.5 bg-white/10 rounded-full text-white text-sm font-medium min-w-[80px] text-center">
              {currentSlide + 1} / {previewSlides.length}
            </span>
            <button onClick={() => setCurrentSlide(prev => Math.min(previewSlides.length - 1, prev + 1))} disabled={currentSlide === previewSlides.length - 1} className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white disabled:opacity-30 transition-colors">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Convert old API format to new format ────────────────────────────

function convertOldFormat(oldOutline: { title: string; subtitle?: string; slides: Array<Record<string, unknown>> }, styleId: string): PPTResult {
  const stylePreset = STYLE_PRESETS.find(s => s.id === styleId) || STYLE_PRESETS[0];
  const colors = stylePreset.colors;

  const slides: SlideOutline[] = (oldOutline.slides || []).map((s, i) => {
    const layout = (s.layout as string) || 'content';
    const bullets = (s.bullets as string[]) || [];
    return {
      page: i + 1,
      title: (s.title as string) || '无标题',
      subtitle: (s.subTitle as string) || (s.subtitle as string) || undefined,
      layout: (['title', 'toc', 'section', 'content', 'twoColumn', 'data', 'chart', 'quote'].includes(layout) ? layout : 'content') as SlideOutline['layout'],
      keyPoints: bullets,
      visualSuggestion: layout === 'chart' ? '柱状图或折线图展示数据对比' :
        layout === 'data' ? '表格或高亮数字展示关键指标' :
        layout === 'twoColumn' ? '左右双栏对比布局' :
        layout === 'quote' ? '大号引号+居中文字' :
        '要点列表配图标',
      speakerNote: undefined,
    };
  });

  return {
    title: oldOutline.title || 'PPT大纲',
    subtitle: oldOutline.subtitle || '',
    totalSlides: slides.length,
    slides,
    styleGuide: {
      theme: stylePreset.name,
      themeDesc: stylePreset.desc,
      colorScheme: {
        primary: colors[0],
        secondary: colors[1],
        accent: colors[2],
        background: colors[3],
        text: colors[4],
      },
      fonts: { heading: 'Microsoft YaHei', body: 'Microsoft YaHei' },
      imageStyle: '商务场景照片、数据可视化图表、简洁图标',
      chartStyle: '扁平化设计，与主色调一致，数据标签清晰',
      layoutPrinciples: [
        '一页一观点（Action Title）',
        '结论先行，金字塔结构',
        '每页不超过5个要点',
        '适当留白，避免信息过载',
        '数据驱动，用数字说话',
      ],
    },
    platformPrompts: {
      doubao: '',
      gamma: '',
      canva: '',
    },
  };
}
