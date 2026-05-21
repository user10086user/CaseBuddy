import { Download, Check, Sparkles, BookOpen, BarChart3, Presentation, MessageSquare, Search, Lightbulb, TrendingUp, Target, DollarSign, Network, Layers, Compass } from 'lucide-react';
import { useState } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import type { Skill } from '../types';

const builtinSkills: Skill[] = [
  {
    id: 'case-deconstructor',
    name: '案例解构引擎',
    description: '自动提取案例时间线、关键决策点、人物关系、核心数据，生成结构化摘要',
    icon: 'BookOpen',
    category: '分析',
    installed: true,
    version: '1.0.0',
    author: 'CaseBuddy',
    prompts: [
      {
        id: 'timeline',
        name: '提取时间线',
        description: '提取案例中的关键事件时间线',
        template: '请阅读以下案例，按时间顺序提取所有关键事件，形成结构化时间线：\n\n{{caseText}}',
        variables: ['caseText'],
      },
      {
        id: 'summary',
        name: '生成摘要',
        description: '生成200字核心摘要',
        template: '请用200字概括以下案例的核心矛盾和关键决策点：\n\n{{caseText}}',
        variables: ['caseText'],
      },
    ],
  },
  {
    id: 'framework-recommender',
    name: '框架推荐系统',
    description: '基于案例行业特征智能匹配SWOT、波特五力、价值链等分析框架',
    icon: 'BarChart3',
    category: '分析',
    installed: true,
    version: '1.0.0',
    author: 'CaseBuddy',
    prompts: [
      {
        id: 'recommend',
        name: '推荐框架',
        description: '推荐最适合的分析框架',
        template: '基于以下案例摘要，推荐3个最适合的分析框架，并说明理由：\n\n{{caseSummary}}',
        variables: ['caseSummary'],
      },
    ],
  },
  {
    id: 'insight-generator',
    name: '洞察生成器',
    description: '提供多角度分析、跨行业类比、红队质疑、颠覆性假设等深度洞察',
    icon: 'Lightbulb',
    category: '洞察',
    installed: false,
    version: '1.0.0',
    author: 'CaseBuddy',
    prompts: [
      {
        id: 'multiview',
        name: '多角度分析',
        description: '提供5-8个不同分析角度',
        template: '针对以下分析结论，提供3个被忽略的关键视角和2个跨行业类比：\n\n{{analysis}}',
        variables: ['analysis'],
      },
    ],
  },
  {
    id: 'ppt-assistant',
    name: 'PPT助手',
    description: '生成PPT结构大纲、数据可视化建议、配色排版方案、演讲者备注',
    icon: 'Presentation',
    category: '呈现',
    installed: false,
    version: '1.0.0',
    author: 'CaseBuddy',
    prompts: [
      {
        id: 'outline',
        name: '生成大纲',
        description: '生成15页以内的PPT结构',
        template: '请为以下分析内容设计PPT结构（15页以内，每页一个核心观点）：\n\n{{content}}',
        variables: ['content'],
      },
    ],
  },
  {
    id: 'qa-simulator',
    name: '答辩模拟器',
    description: '模拟评委提问，预测高概率问题，提供回答框架，训练应变能力',
    icon: 'MessageSquare',
    category: '答辩',
    installed: false,
    version: '1.0.0',
    author: 'CaseBuddy',
    prompts: [
      {
        id: 'predict',
        name: '预测问题',
        description: '预测评委可能提出的问题',
        template: '基于以下案例分析，预测评委可能提出的10个问题（按概率排序）：\n\n{{analysis}}',
        variables: ['analysis'],
      },
    ],
  },
  {
    id: 'prompt-manager',
    name: 'Prompt管理器',
    description: '管理Prompt模板库，记录迭代过程，生成AI使用说明报告',
    icon: 'Sparkles',
    category: '工具',
    installed: false,
    version: '1.0.0',
    author: 'CaseBuddy',
    prompts: [],
  },
  // ── MBA分析框架技能 ──────────────────────────────────────────
  {
    id: 'mba-swot',
    name: 'SWOT + TOWS战略推导',
    description: '标准SWOT四象限分析，并进阶推导TOWS战略矩阵（SO进攻/ST防御/WO转型/WT规避），生成可执行战略建议',
    icon: 'Target',
    category: 'MBA框架',
    installed: false,
    version: '1.0.0',
    author: 'CaseBuddy',
    prompts: [
      {
        id: 'swot-full',
        name: 'SWOT完整分析',
        description: '生成SWOT四象限 + TOWS战略矩阵',
        template: '请对以下企业案例进行完整的SWOT分析，包含SWOT四象限和TOWS战略推导矩阵，每条要素须有案例数据支撑，最终给出战略优先级建议：\n\n{{caseText}}',
        variables: ['caseText'],
      },
      {
        id: 'tows-strategy',
        name: 'TOWS战略矩阵',
        description: '基于已有SWOT推导四类战略',
        template: '基于以下SWOT分析结果，推导TOWS战略矩阵，分别给出SO（进攻型）、ST（防御型）、WO（转型型）、WT（规避型）各2-3条具体可执行战略：\n\n{{swotResult}}',
        variables: ['swotResult'],
      },
    ],
  },
  {
    id: 'mba-porter5',
    name: '波特五力模型',
    description: '系统评估行业竞争格局：现有竞争强度、新进入者威胁、替代品威胁、买方议价能力、供应商议价能力，输出五力评分表和行业吸引力判断',
    icon: 'Network',
    category: 'MBA框架',
    installed: false,
    version: '1.0.0',
    author: 'CaseBuddy',
    prompts: [
      {
        id: 'porter5-full',
        name: '五力完整分析',
        description: '输出五力逐项分析 + 评分表 + 战略启示',
        template: '请对以下企业所在行业进行波特五力分析，逐一分析五种力量（现有竞争/新进入者/替代品/买方议价/供应商议价），给出评分表（强/中/弱，1-5分），并判断行业整体吸引力，最后提出3条战略启示：\n\n{{caseText}}',
        variables: ['caseText'],
      },
      {
        id: 'porter5-quick',
        name: '行业吸引力速判',
        description: '快速判断行业进入价值',
        template: '请快速评估以下行业的进入价值：用波特五力框架各给一句判断（强/中/弱+理由），最终给出进入/维持/退出建议：\n\n行业：{{industry}}\n背景：{{context}}',
        variables: ['industry', 'context'],
      },
    ],
  },
  {
    id: 'mba-bmc',
    name: '商业模式画布（BMC）',
    description: '解构企业9要素商业模式：客户细分、价值主张、渠道通路、客户关系、收入来源、核心资源、关键活动、关键合作、成本结构，判断商业模式类型和创新机会',
    icon: 'Layers',
    category: 'MBA框架',
    installed: false,
    version: '1.0.0',
    author: 'CaseBuddy',
    prompts: [
      {
        id: 'bmc-full',
        name: 'BMC完整解构',
        description: '输出9要素 + 商业模式类型 + 创新机会',
        template: '请对以下企业进行商业模式画布（BMC）分析，逐一填写9个要素（CS/VP/CH/CR/RS/KR/KA/KP/成本结构），以VP（价值主张）为核心，判断商业模式类型，并指出最脆弱的模块和最大的创新机会：\n\n{{caseText}}',
        variables: ['caseText'],
      },
      {
        id: 'bmc-vp',
        name: '价值主张深析',
        description: '深度解析企业核心价值主张',
        template: '请深度解析以下企业的价值主张：它为哪类客户解决了什么痛点（Pain Reliever），创造了什么增益（Gain Creator），核心差异化是什么，用一句话表述其价值主张公式：\n\n{{caseText}}',
        variables: ['caseText'],
      },
    ],
  },
  {
    id: 'mba-finance',
    name: '财务三表深度分析',
    description: '系统分析利润表（盈利能力）、资产负债表（偿债能力）、现金流量表（现金流质量），结合杜邦分析和财务比率，输出企业财务画像',
    icon: 'DollarSign',
    category: 'MBA框架',
    installed: false,
    version: '1.0.0',
    author: 'CaseBuddy',
    prompts: [
      {
        id: 'finance-full',
        name: '财务三表综合分析',
        description: '完整财务分析 + 杜邦分析 + 财务画像',
        template: '请对以下企业的财务数据进行三表联动分析：分析利润表（毛利率/净利率/ROE/ROA）、资产负债表（资产负债率/流动比率）、现金流量表（CFO/净利润含现率），做杜邦分析拆解ROE，最终给出综合财务画像和主要财务风险：\n\n{{financialData}}',
        variables: ['financialData'],
      },
      {
        id: 'cashflow-quality',
        name: '现金流质量评估',
        description: '判断利润是否"真实"，识别财务风险',
        template: '请分析以下企业的现金流质量：计算净利润含现率（CFO/净利润）、收现比（销售收现/收入），判断利润质量高低，识别应收账款/存货/商誉等财务风险信号：\n\n{{financialData}}',
        variables: ['financialData'],
      },
    ],
  },
  {
    id: 'mba-mece',
    name: 'MECE + 金字塔原理',
    description: '用MECE原则（不重叠不遗漏）和金字塔原理（结论先行）构建结构化分析框架，生成逻辑清晰的汇报大纲和Action Title，适合PPT汇报准备',
    icon: 'TrendingUp',
    category: 'MBA框架',
    installed: false,
    version: '1.0.0',
    author: 'CaseBuddy',
    prompts: [
      {
        id: 'mece-structure',
        name: '构建MECE分析框架',
        description: '将问题拆解为不重叠不遗漏的逻辑树',
        template: '请用MECE原则将以下问题拆解为逻辑树，确保各分支相互独立且完全穷尽，选择最合适的拆解方式（公式法/流程法/组成法/维度法），并做MECE检验：\n\n问题：{{problem}}\n背景：{{context}}',
        variables: ['problem', 'context'],
      },
      {
        id: 'pyramid-outline',
        name: '金字塔汇报大纲',
        description: '生成结论先行的PPT汇报结构',
        template: '请用金字塔原理为以下分析内容生成汇报大纲：结论先行，每个论点配2-3个支撑依据，每张PPT用Action Title（观点句，而非描述性标题），按SCR结构（Situation/Complication/Resolution）组织：\n\n{{analysisContent}}',
        variables: ['analysisContent'],
      },
    ],
  },
  {
    id: 'mba-strategy',
    name: '战略综合分析',
    description: '整合安索夫增长矩阵、波特三大竞争战略、SAFe战略评估框架，从战略诊断→选项生成→评估决策→实施路径，输出完整战略建议报告',
    icon: 'Compass',
    category: 'MBA框架',
    installed: false,
    version: '1.0.0',
    author: 'CaseBuddy',
    prompts: [
      {
        id: 'strategy-full',
        name: '完整战略分析报告',
        description: '诊断→选项→评估→路径全流程',
        template: '请对以下企业案例进行完整战略分析：①识别核心战略矛盾；②用安索夫矩阵生成3个战略选项；③用SAFe框架（适宜性/可接受性/可行性）评估并推荐；④给出短中长期实施路径和主要风险应对：\n\n{{caseText}}',
        variables: ['caseText'],
      },
      {
        id: 'strategy-options',
        name: '战略选项生成',
        description: '生成多个差异化战略方向',
        template: '请基于以下企业现状，用安索夫增长矩阵和波特三大竞争战略，生成3-4个差异化的战略选项，每个选项包含：战略方向、核心假设、所需资源、主要风险：\n\n{{companyContext}}',
        variables: ['companyContext'],
      },
    ],
  },
];

const iconMap: Record<string, React.ElementType> = {
  BookOpen,
  BarChart3,
  Lightbulb,
  Presentation,
  MessageSquare,
  Sparkles,
  Search,
  TrendingUp,
  Target,
  DollarSign,
  Network,
  Layers,
  Compass,
};

const categoryColors: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  '分析': { bg: 'bg-primary-50', text: 'text-primary-600', border: 'border-primary-200', dot: 'bg-primary-500' },
  '洞察': { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200', dot: 'bg-amber-500' },
  '呈现': { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  '答辩': { bg: 'bg-rose-50', text: 'text-rose-600', border: 'border-rose-200', dot: 'bg-rose-500' },
  '工具': { bg: 'bg-violet-50', text: 'text-violet-600', border: 'border-violet-200', dot: 'bg-violet-500' },
  'MBA框架': { bg: 'bg-indigo-50', text: 'text-indigo-600', border: 'border-indigo-200', dot: 'bg-indigo-500' },
};

export default function SkillMarket() {
  const [installedSkills, setInstalledSkills] = useLocalStorage<string[]>('casebuddy-skills', ['case-deconstructor', 'framework-recommender']);
  const [animatingId, setAnimatingId] = useState<string | null>(null);

  const toggleSkill = (skillId: string) => {
    setAnimatingId(skillId);
    setTimeout(() => setAnimatingId(null), 400);

    if (installedSkills.includes(skillId)) {
      setInstalledSkills(installedSkills.filter(id => id !== skillId));
    } else {
      setInstalledSkills([...installedSkills, skillId]);
    }
  };

  const categories = [...new Set(builtinSkills.map(s => s.category))];

  return (
    <div className="p-6 md:p-8 max-w-5xl animate-fade-in-scale">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-surface-900 mb-2">技能市场</h1>
        <p className="text-surface-500">安装和管理 AI 分析技能，扩展 CaseBuddy 的能力</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-surface-200 p-5 card-hover">
          <div className="text-2xl font-bold text-primary-600">{installedSkills.length}</div>
          <div className="text-sm text-surface-500 mt-0.5">已安装技能</div>
        </div>
        <div className="bg-white rounded-xl border border-surface-200 p-5 card-hover">
          <div className="text-2xl font-bold text-accent-600">{builtinSkills.length}</div>
          <div className="text-sm text-surface-500 mt-0.5">可用技能</div>
        </div>
        <div className="bg-white rounded-xl border border-surface-200 p-5 card-hover">
          <div className="text-2xl font-bold text-emerald-600">
            {builtinSkills.reduce((sum, s) => sum + s.prompts.length, 0)}
          </div>
          <div className="text-sm text-surface-500 mt-0.5">Prompt 模板</div>
        </div>
      </div>

      {/* Skills by Category */}
      {categories.map(category => {
        const skills = builtinSkills.filter(s => s.category === category);
        const colors = categoryColors[category] || categoryColors['分析'];
        return (
          <div key={category} className="mb-8">
            <h2 className="text-lg font-semibold text-surface-800 mb-4 flex items-center gap-2">
              <span className={`w-1.5 h-5 ${colors.dot} rounded-full`} />
              {category}
              <span className="text-xs font-normal text-surface-400 ml-1">({skills.length})</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {skills.map(skill => {
                const Icon = iconMap[skill.icon] || Sparkles;
                const isInstalled = installedSkills.includes(skill.id);
                const isAnimating = animatingId === skill.id;
                return (
                  <div
                    key={skill.id}
                    className={`bg-white rounded-xl border p-5 transition-all duration-200 card-hover
                      ${isInstalled ? `${colors.border} shadow-sm` : 'border-surface-200'}
                      ${isAnimating ? 'scale-[1.02]' : ''}`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors
                          ${isInstalled ? colors.bg : 'bg-surface-100'}`}>
                          <Icon className={`w-5 h-5 ${isInstalled ? colors.text : 'text-surface-400'}`} />
                        </div>
                        <div>
                          <h3 className="font-semibold text-surface-900">{skill.name}</h3>
                          <span className="text-xs text-surface-400">v{skill.version} · {skill.author}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => toggleSkill(skill.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 btn-press
                          ${isInstalled
                            ? `${colors.bg} ${colors.text} hover:brightness-95`
                            : 'bg-surface-100 text-surface-600 hover:bg-surface-200'
                          }`}
                      >
                        {isInstalled ? (
                          <><Check className={`w-3.5 h-3.5 ${isAnimating ? 'animate-bounce' : ''}`} /> 已安装</>
                        ) : (
                          <><Download className={`w-3.5 h-3.5 ${isAnimating ? 'animate-bounce' : ''}`} /> 安装</>
                        )}
                      </button>
                    </div>
                    <p className="text-sm text-surface-500 leading-relaxed">{skill.description}</p>
                    {skill.prompts.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-surface-100">
                        <div className="text-xs text-surface-400 mb-2">包含 {skill.prompts.length} 个 Prompt 模板</div>
                        <div className="flex flex-wrap gap-1.5">
                          {skill.prompts.map(p => (
                            <span key={p.id} className={`px-2.5 py-1 text-xs rounded-md font-medium
                              ${isInstalled ? `${colors.bg} ${colors.text}` : 'bg-surface-100 text-surface-500'}`}>
                              {p.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
