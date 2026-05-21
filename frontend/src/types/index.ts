export interface ModelConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  isDefault: boolean;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  installed: boolean;
  prompts: PromptTemplate[];
  version: string;
  author: string;
}

export interface PromptTemplate {
  id: string;
  name: string;
  template: string;
  description: string;
  variables: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  skillId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
}

export interface AnalysisSession {
  id: string;
  title: string;
  caseText: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  activeSkills: string[];
  // RAG 扩展字段
  ragCaseId?: string;      // 案例唯一ID（RAG索引用）
  ragEnabled?: boolean;    // 是否启用 RAG 检索
  ragIndexed?: boolean;    // 是否已完成索引构建
  ragTotalChunks?: number; // 索引中的分块总数
}
