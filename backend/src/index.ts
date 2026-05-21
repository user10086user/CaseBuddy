import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import chatRoutes from './routes/chat';
import pptMasterRoutes from './routes/pptMaster';
import gatewayRoutes from './routes/gateway';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Routes
app.use('/api/chat', chatRoutes);
app.use('/api/ppt-master', pptMasterRoutes);
app.use('/api/gateway', gatewayRoutes);

// Proxy route for LLM APIs (non-streaming)
app.post('/api/proxy/chat/completions', async (req, res) => {
  try {
    const { baseUrl, apiKey, model, messages, temperature = 0.7, max_tokens = 4000 } = req.body;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await response.text();
      res.status(response.status).json({ error: text || `HTTP ${response.status}` });
      return;
    }

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: errMsg });
  }
});

// Proxy route for LLM APIs (SSE streaming)
app.post('/api/proxy/chat/completions/stream', async (req, res) => {
  try {
    const { baseUrl, apiKey, model, messages, temperature = 0.7, max_tokens = 4000 } = req.body;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens,
        stream: true,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      res.status(response.status).json({ error: err });
      return;
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Forward the stream using Node.js compatible approach
    if (!response.body) {
      res.status(500).json({ error: 'No response body' });
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    // Node.js fetch returns a NodeJS.ReadableStream, use for-await-of
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
          res.write(`data: ${data}\n\n`);
        }
      }
    }

    res.end();
  } catch (error) {
    console.error('Stream error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: String(error) });
    } else {
      res.write(`data: ${JSON.stringify({ error: String(error) })}\n\n`);
      res.end();
    }
  }
});

// File upload and parse endpoints
import multer from 'multer';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  BorderStyle, TabStopType, TabStopPosition
} from 'docx';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    // Fallback: check file extension for clients that don't set correct mimetype
    const ext = (file.originalname || '').split('.').pop()?.toLowerCase();
    if (ext === 'pdf' || ext === 'docx') {
      // Override mimetype based on extension
      file.mimetype = ext === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      cb(null, true);
      return;
    }
    cb(new Error(`Unsupported file type: ${file.mimetype}. Only PDF and DOCX are supported.`));
  },
});

app.post('/api/parse/file', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const buffer = req.file.buffer;
    const mimetype = req.file.mimetype;
    let text = '';
    let pageCount = 0;

    if (mimetype === 'application/pdf') {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();
      text = result.text;
      pageCount = result.total;
      await parser.destroy();
    } else if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
      pageCount = 1;
    }

    // Clean up text
    text = text
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Limit to 30K characters
    if (text.length > 30000) {
      text = text.slice(0, 30000) + '\n\n[... 文本已截断，共 ' + text.length + ' 字符 ...]';
    }

    res.json({
      filename: req.file.originalname,
      size: req.file.size,
      mimetype,
      pageCount,
      text,
    });
  } catch (error) {
    console.error('File parse error:', error);
    res.status(500).json({ error: `文件解析失败: ${error instanceof Error ? error.message : String(error)}` });
  }
});

// DOCX export endpoint
app.post('/api/export/docx', async (req, res) => {
  try {
    const { title, messages } = req.body as {
      title: string;
      messages: { role: string; content: string }[];
    };

    if (!messages || messages.length === 0) {
      res.status(400).json({ error: 'No messages to export' });
      return;
    }

    // Build document sections
    const children: Paragraph[] = [];

    // Title
    children.push(
      new Paragraph({
        text: title || '案例分析报告',
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      })
    );

    // Subtitle
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
        children: [
          new TextRun({
            text: `由 CaseBuddy AI 生成 · ${new Date().toLocaleDateString('zh-CN')}`,
            color: '888888',
            size: 20,
          }),
        ],
      })
    );

    // Separator
    children.push(
      new Paragraph({
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' },
        },
        spacing: { after: 300 },
      })
    );

    // Messages
    for (const msg of messages) {
      const isUser = msg.role === 'user';

      // Role header
      children.push(
        new Paragraph({
          spacing: { before: 300, after: 100 },
          children: [
            new TextRun({
              text: isUser ? '👤 用户' : '🤖 AI 分析',
              bold: true,
              color: isUser ? '1E40AF' : '166534',
              size: 24,
            }),
          ],
        })
      );

      // Content - split by lines and create paragraphs
      const lines = msg.content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '') {
          children.push(new Paragraph({ spacing: { after: 100 } }));
        } else if (trimmed.startsWith('# ')) {
          children.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_1,
              spacing: { before: 240, after: 120 },
              children: [new TextRun({ text: trimmed.slice(2), bold: true, size: 32 })],
            })
          );
        } else if (trimmed.startsWith('## ')) {
          children.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 200, after: 100 },
              children: [new TextRun({ text: trimmed.slice(3), bold: true, size: 28 })],
            })
          );
        } else if (trimmed.startsWith('### ')) {
          children.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_3,
              spacing: { before: 160, after: 80 },
              children: [new TextRun({ text: trimmed.slice(4), bold: true, size: 24 })],
            })
          );
        } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          children.push(
            new Paragraph({
              bullet: { level: 0 },
              spacing: { after: 40 },
              children: [new TextRun({ text: trimmed.slice(2), size: 21 })],
            })
          );
        } else if (/^\d+\.\s/.test(trimmed)) {
          children.push(
            new Paragraph({
              numbering: { reference: 'default-numbering', level: 0 },
              spacing: { after: 40 },
              children: [new TextRun({ text: trimmed.replace(/^\d+\.\s/, ''), size: 21 })],
            })
          );
        } else if (trimmed.startsWith('> ')) {
          children.push(
            new Paragraph({
              spacing: { before: 80, after: 80 },
              indent: { left: 400 },
              border: {
                left: { style: BorderStyle.SINGLE, size: 12, color: '3B82F6' },
              },
              children: [new TextRun({ text: trimmed.slice(2), italics: true, color: '64748B', size: 21 })],
            })
          );
        } else {
          // Handle bold markdown inline
          const parts = trimmed.split(/\*\*(.+?)\*\*/g);
          const runs = parts.map((part, i) => {
            if (i % 2 === 1) {
              return new TextRun({ text: part, bold: true, size: 21 });
            }
            return new TextRun({ text: part, size: 21 });
          });
          children.push(
            new Paragraph({
              spacing: { after: 80 },
              children: runs,
            })
          );
        }
      }

      // Separator between messages
      children.push(
        new Paragraph({
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 3, color: 'E2E8F0' },
          },
          spacing: { before: 200, after: 100 },
        })
      );
    }

    // Footer
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 400 },
        children: [
          new TextRun({
            text: 'CaseBuddy · AI 赋能 MBA 案例分析',
            color: '94A3B8',
            size: 18,
          }),
        ],
      })
    );

    const doc = new Document({
      numbering: {
        config: [{
          reference: 'default-numbering',
          levels: [{
            level: 0,
            format: 'decimal' as const,
            text: '%1.',
            alignment: AlignmentType.START,
          }],
        }],
      },
      sections: [{
        properties: {
          page: {
            margin: {
              top: 1440,    // 1 inch = 1440 twips
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        children,
      }],
    });

    const buffer = await Packer.toBuffer(doc);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(title || '分析报告')}.docx`);
    res.send(buffer);
  } catch (error) {
    console.error('DOCX export error:', error);
    res.status(500).json({ error: `导出失败: ${error instanceof Error ? error.message : String(error)}` });
  }
});

// ─── PPT Generation API ──────────────────────────────────────────────

const pptDesignStyles: Record<string, { name: string; desc: string; colors: Record<string, string> }> = {
  businessBlue: {
    name: '商务蓝',
    desc: '专业商务风格，适合企业汇报',
    colors: { primary: '1E3A8A', primaryLight: '3B82F6', accent: '0D9488', text: '1F2937', textLight: '6B7280', bg: 'FFFFFF', bgLight: 'F8FAFC' },
  },
  magazine: {
    name: '杂志风',
    desc: '暖色调，照片丰富，视觉冲击力',
    colors: { primary: '92400E', primaryLight: 'D97706', accent: 'DC2626', text: '292524', textLight: '78716C', bg: 'FFFBEB', bgLight: 'FEF3C7' },
  },
  academic: {
    name: '学术风',
    desc: '结构化数据展示，严谨专业',
    colors: { primary: '374151', primaryLight: '6B7280', accent: '0369A1', text: '111827', textLight: '4B5563', bg: 'FFFFFF', bgLight: 'F9FAFB' },
  },
  techDark: {
    name: '科技暗黑',
    desc: '深色背景，科技感十足',
    colors: { primary: '60A5FA', primaryLight: '3B82F6', accent: '22D3EE', text: 'F3F4F6', textLight: '9CA3AF', bg: '0F172A', bgLight: '1E293B' },
  },
  minimalWhite: {
    name: '极简白',
    desc: '极简设计，留白充分',
    colors: { primary: '18181B', primaryLight: '52525B', accent: 'E11D48', text: '27272A', textLight: 'A1A1AA', bg: 'FFFFFF', bgLight: 'FAFAFA' },
  },
};

// Get PPT design styles
app.get('/api/ppt/styles', (_req, res) => {
  res.json({
    styles: Object.entries(pptDesignStyles).map(([id, s]) => ({
      id,
      name: s.name,
      desc: s.desc,
    })),
  });
});

// Search images via Pexels
app.get('/api/ppt/search-images', async (req, res) => {
  try {
    const { query, perPage = '6', apiKey: reqApiKey } = req.query;
    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'query parameter is required' });
      return;
    }

    const apiKey = typeof reqApiKey === 'string' && reqApiKey.trim()
      ? reqApiKey.trim()
      : process.env.PEXELS_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: 'Pexels API Key 未配置，请在「模型配置」页面或环境变量中设置' });
      return;
    }

    const response = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`,
      {
        headers: { Authorization: apiKey },
      }
    );

    if (!response.ok) {
      const err = await response.text();
      res.status(response.status).json({ error: `Pexels API 错误: ${err}` });
      return;
    }

    const data = await response.json() as Record<string, unknown>;
    const images = ((data.photos as unknown[]) || []).map((p: unknown) => {
      const photo = p as { src: { medium: string; large: string; }; photographer: string; alt: string; };
      return {
        thumb: photo.src.medium,
        url: photo.src.large,
        photographer: photo.photographer,
        alt: photo.alt,
      };
    });

    res.json({ images, total: (data.total_results as number) || 0 });
  } catch (error) {
    console.error('Image search error:', error);
    res.status(500).json({ error: `图片搜索失败: ${error instanceof Error ? error.message : String(error)}` });
  }
});

// Search images via Pixabay (fallback)
app.get('/api/ppt/search-images-pixabay', async (req, res) => {
  try {
    const { query, perPage = '6', apiKey: reqApiKey } = req.query;
    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'query parameter is required' });
      return;
    }

    const apiKey = typeof reqApiKey === 'string' && reqApiKey.trim()
      ? reqApiKey.trim()
      : process.env.PIXABAY_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: 'Pixabay API Key 未配置，请在「模型配置」页面或环境变量中设置' });
      return;
    }

    const response = await fetch(
      `https://pixabay.com/api/?key=${apiKey}&q=${encodeURIComponent(query)}&per_page=${perPage}&orientation=horizontal&image_type=photo&lang=zh`
    );

    if (!response.ok) {
      const err = await response.text();
      res.status(response.status).json({ error: `Pixabay API 错误: ${err}` });
      return;
    }

    const data = await response.json() as Record<string, unknown>;
    const images = ((data.hits as unknown[]) || []).map((h: unknown) => {
      const hit = h as { webformatURL: string; largeImageURL: string; user: string; tags: string; };
      return {
        thumb: hit.webformatURL,
        url: hit.largeImageURL,
        photographer: hit.user,
        alt: hit.tags,
      };
    });

    res.json({ images, total: (data.totalHits as number) || 0 });
  } catch (error) {
    console.error('Pixabay search error:', error);
    res.status(500).json({ error: `图片搜索失败: ${error instanceof Error ? error.message : String(error)}` });
  }
});

// Generate PPT outline via LLM
app.post('/api/ppt/generate-outline', async (req, res) => {
  try {
    const { baseUrl, apiKey, model, content, style, nSlides = 10, instructions, conversationHistory } = req.body;

    if (!baseUrl || !apiKey || !model || !content) {
      res.status(400).json({ error: 'Missing required parameters: baseUrl, apiKey, model, content' });
      return;
    }

    const styleInfo = pptDesignStyles[style || 'businessBlue'] || pptDesignStyles.businessBlue;

    // Build prompt - ECNU API doesn't support system role well, merge into user message
    const promptHeader = `你是一位专业的PPT设计专家和MBA案例分析顾问。请根据用户提供的分析内容，生成一份结构化的PPT大纲。

请严格按以下JSON格式输出（不要输出任何其他内容，只输出JSON）：

{\n  "title": "PPT标题",\n  "subtitle": "副标题",\n  "slides": [\n    {\n      "layout": "title|content|twoColumn|data|quote|chart|section",\n      "title": "页面标题（必须是完整观点句，不是名词短语）",\n      "bullets": ["要点1", "要点2", "要点3"],\n      "tableData": [["列1", "列2", "列3"], ["数据1", "数据2", "数据3"]]\n    }\n  ]\n}

设计规范：
- 风格：${styleInfo.name} - ${styleInfo.desc}
- 总页数：${nSlides}页以内
- 布局说明：
  - title: 封面页
  - section: 章节过渡页
  - content: 标准内容页（要点列表）
  - twoColumn: 双栏对比页
  - data: 数据展示页（必须包含tableData表格或高亮数字）
  - chart: 图表页（柱状图数据）
  - quote: 引用/结论页
- 每页bullet不超过5个
- 内容要精炼、有洞察力，避免大段文字
- 标题要简洁有力，必须是完整的观点句（Action Title），不超过20个字
- 遵循麦肯锡金字塔原理，结论先行
- MBA案例分析标准结构：封面→执行摘要→目录→情境分析→问题诊断→解决方案→实施路径→财务预测→结论

【数据表格要求】
1. 至少2页必须使用data布局，包含tableData表格
2. tableData格式：二维数组，第一行为表头，后续为数据行
3. 必须提取案例中的关键数据填入表格（财务数据、市场规模、增长率、用户数据等）
4. 如果原始内容没有具体数据，基于合理推断填写估算值并标注"估算"
5. 表格要有清晰的表头和单位

示例tableData：
[["指标", "数值", "单位", "年份"], ["营业收入", "120", "亿元", "2023"], ["用户增长率", "35", "%", "同比"]]
`;

    const conversationContext = conversationHistory
      ? `【对话历史】\n${conversationHistory.slice(-10).map((m: { role: string; content: string; }) => `${m.role}: ${m.content.slice(0, 300)}`).join('\n\n')}\n\n`
      : '';

    const userPrompt = `${promptHeader}\n\n${conversationContext}【分析内容】\n${content.slice(0, 3000)}\n\n${instructions ? `【用户要求】\n${instructions}\n\n` : ''}请根据以上内容生成PPT大纲。只输出JSON，不要其他内容。`;

    // Use Node.js https for ECNU API compatibility
    const { hostname, pathname, protocol, port } = new URL(baseUrl);
    const https = await import('https');
    const http = await import('http');
    const apiModule = protocol === 'https:' ? https : http;

    const apiResponse = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const apiReq = apiModule.request(
        {
          hostname,
          path: `${pathname}/chat/completions`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          port: port || (protocol === 'https:' ? 443 : 80),
        },
        (apiRes) => {
          let data = '';
          apiRes.on('data', chunk => data += chunk);
          apiRes.on('end', () => resolve({ statusCode: apiRes.statusCode || 0, body: data }));
        }
      );
      apiReq.on('error', reject);
      apiReq.write(JSON.stringify({
        model,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.7,
        max_tokens: 3000,
        stream: false,
      }));
      apiReq.end();
    });

    if (apiResponse.statusCode < 200 || apiResponse.statusCode >= 300) {
      res.status(apiResponse.statusCode).json({ error: `LLM API 错误: ${apiResponse.body.slice(0, 500)}` });
      return;
    }

    const llmData = JSON.parse(apiResponse.body);
    const rawContent = llmData.choices?.[0]?.message?.content || '';

    // Multi-layer JSON extraction
    let outline: Record<string, unknown> | null = null;
    const extractionStrategies = [
      // 1. Code block
      () => {
        const m = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
        return m ? JSON.parse(m[1].trim()) : null;
      },
      // 2. Direct JSON
      () => JSON.parse(rawContent.trim()),
      // 3. Find JSON object in text
      () => {
        const m = rawContent.match(/\{[\s\S]*"slides"[\s\S]*\}/);
        return m ? JSON.parse(m[0]) : null;
      },
      // 4. Truncation fix - missing closing brackets
      () => {
        const fixed = rawContent.trim() + ']}';
        return JSON.parse(fixed);
      },
    ];

    for (const strategy of extractionStrategies) {
      try {
        outline = strategy();
        if (outline && outline.slides) break;
      } catch { /* continue */ }
    }

    if (!outline || !outline.slides) {
      res.status(422).json({ error: 'LLM 返回内容不是有效 JSON', raw: rawContent.slice(0, 2000) });
      return;
    }

    // Build full PPTResult with styleGuide and platform prompts
    const result = buildPPTResult(outline, style || 'businessBlue', styleInfo);
    res.json({ result, raw: rawContent });

  } catch (error) {
    console.error('PPT outline generation error:', error);
    res.status(500).json({ error: `生成失败: ${error instanceof Error ? error.message : String(error)}` });
  }
});

// Build full PPTResult from AI outline
function buildPPTResult(
  outline: Record<string, unknown>,
  styleId: string,
  styleInfo: { name: string; desc: string; colors: Record<string, string> }
): Record<string, unknown> {
  const c = styleInfo.colors;
  const slides = (outline.slides as Array<Record<string, unknown>> || []).map((s, i) => {
    const layout = (s.layout as string) || 'content';
    const bullets = (s.bullets as string[]) || [];
    const visualMap: Record<string, string> = {
      title: '全屏背景图+居中标题+副标题',
      toc: '章节列表配编号和图标',
      section: '大号章节编号+章节名+过渡背景',
      content: '标题+要点列表+右侧配图或图标',
      twoColumn: '左右双栏对比布局，各配要点列表',
      data: '数据表格或KPI卡片展示',
      chart: '柱状图/折线图/饼图展示数据',
      quote: '大号引号+居中引用文字+出处',
    };
    return {
      page: i + 1,
      title: (s.title as string) || '无标题',
      subtitle: (s.subTitle as string) || (s.subtitle as string) || undefined,
      layout: ['title', 'toc', 'section', 'content', 'twoColumn', 'data', 'chart', 'quote'].includes(layout) ? layout : 'content',
      keyPoints: bullets,
      visualSuggestion: visualMap[layout] || '要点列表配图标',
      speakerNote: undefined,
    };
  });

  const title = (outline.title as string) || '案例分析PPT';
  const subtitle = (outline.subtitle as string) || '';

  // Build platform prompts
  const doubaoPrompt = buildDoubaoPromptBackend(title, subtitle, slides, styleInfo, c);
  const gammaPrompt = buildGammaPromptBackend(title, slides, styleInfo);
  const canvaPrompt = buildCanvaPromptBackend(title, slides, styleInfo);

  return {
    title,
    subtitle,
    totalSlides: slides.length,
    slides,
    styleGuide: {
      theme: styleInfo.name,
      themeDesc: styleInfo.desc,
      colorScheme: {
        primary: '#' + c.primary,
        secondary: '#' + c.primaryLight,
        accent: '#' + c.accent,
        background: '#' + c.bg,
        text: '#' + c.text,
      },
      fonts: { heading: 'Microsoft YaHei', body: 'Microsoft YaHei' },
      imageStyle: styleId === 'magazine' ? '高质量摄影图片，暖色调，生活场景' :
        styleId === 'techDark' ? '深色背景科技图，霓虹光效，抽象几何' :
        styleId === 'academic' ? '简洁数据图表，专业示意图，留白充分' :
        styleId === 'minimalWhite' ? '极简几何图形，单色摄影，大量留白' :
        '商务场景摄影，蓝色调，专业人物',
      chartStyle: styleId === 'techDark' ? '深色主题图表，发光效果，对比鲜明' :
        styleId === 'magazine' ? '暖色图表，圆角设计，视觉冲击力' :
        '扁平化设计，与主色调一致，数据标签清晰',
      layoutPrinciples: [
        '一页一观点（Action Title），标题必须是完整观点句',
        '结论先行，金字塔结构，从上到下论证',
        '每页不超过5个要点，遵循MECE原则',
        '适当留白，避免信息过载，行距1.5倍',
        '数据驱动，用具体数字和百分比说话',
        '字体大小层次分明：标题32-40pt，正文18-24pt',
      ],
    },
    platformPrompts: {
      doubao: doubaoPrompt,
      gamma: gammaPrompt,
      canva: canvaPrompt,
    },
  };
}

function buildDoubaoPromptBackend(title: string, subtitle: string, slides: Array<Record<string, unknown>>, styleInfo: { name: string; desc: string }, colors: Record<string, string>): string {
  const lines: string[] = [
    `请为我生成一份关于「${title}」的PPT，共${slides.length}页。`,
    ``,
    `=== 整体风格要求 ===`,
    `主题：${styleInfo.name}`,
    `配色：主色 #${colors.primary}，辅色 #${colors.primaryLight}，强调色 #${colors.accent}，背景 #${colors.bg}`,
    `字体：标题用 Microsoft YaHei，正文用 Microsoft YaHei`,
    ``,
    `=== 每页详细内容 ===`,
  ];

  for (const slide of slides) {
    const layoutName: Record<string, string> = {
      title: '标题页', toc: '目录页', section: '章节页',
      content: '内容页', twoColumn: '双栏页', data: '数据页',
      chart: '图表页', quote: '引用页',
    };
    lines.push(`\n【第${slide.page}页 | ${layoutName[slide.layout as string] || '内容页'}】`);
    lines.push(`标题：${slide.title}`);
    if (slide.subtitle) lines.push(`副标题：${slide.subtitle}`);
    lines.push(`要点：`);
    for (const pt of (slide.keyPoints as string[]) || []) {
      lines.push(`  · ${pt}`);
    }
    lines.push(`可视化建议：${slide.visualSuggestion}`);
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

function buildGammaPromptBackend(title: string, slides: Array<Record<string, unknown>>, styleInfo: { name: string; desc: string }): string {
  return `Create a professional presentation titled "${title}" with ${slides.length} slides.\n\n` +
    `Theme: ${styleInfo.name}\n` +
    `Style: ${styleInfo.desc}\n\n` +
    `Slide outline:\n` +
    slides.map(s =>
      `Slide ${s.page}: ${s.title}\n` +
      ((s.keyPoints as string[]) || []).map((p: string) => `  - ${p}`).join('\n')
    ).join('\n\n');
}

function buildCanvaPromptBackend(title: string, slides: Array<Record<string, unknown>>, styleInfo: { name: string; desc: string }): string {
  return `Design a presentation about "${title}". ${slides.length} slides.\n\n` +
    `Style: ${styleInfo.name} - ${styleInfo.desc}\n\n` +
    slides.map(s =>
      `Slide ${s.page}: ${s.title}\n` +
      ((s.keyPoints as string[]) || []).map((p: string) => `- ${p}`).join('\n')
    ).join('\n\n');
}

// ============================================================
// RAG 接口 — 案例知识库构建与检索
// ============================================================
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fsSync from 'fs';
import * as pathMod from 'path';
import * as os from 'os';

const execFileAsync = promisify(execFile);

// Python 可执行路径（优先系统Python）
const PYTHON_BIN = process.env.PYTHON_BIN || 'python';
// case-rag skill 脚本目录
const RAG_SKILLS_DIR = pathMod.join(os.homedir(), '.workbuddy', 'skills', 'case-rag', 'scripts');
const PDF_READER_SKILLS_DIR = pathMod.join(os.homedir(), '.workbuddy', 'skills', 'pdf-case-reader', 'scripts');
// RAG 索引存储目录
const RAG_INDEX_DIR = pathMod.join(os.homedir(), '.casebuddy', 'rag');

/** 将文本分块（Node.js 实现，作为Python不可用时的回退） */
function chunkTextNode(text: string, chunkSize = 1000, overlap = 100): Array<{ id: number; text: string; section: string; page: number; char_count: number }> {
  const chunks: Array<{ id: number; text: string; section: string; page: number; char_count: number }> = [];
  const lines = text.split('\n');
  let current: string[] = [];
  let currentSize = 0;
  let chunkId = 0;
  let currentSection = '正文';
  let currentPage = 1;

  for (const line of lines) {
    const pageMatch = line.match(/^--- 第(\d+)页 ---/);
    if (pageMatch) {
      currentPage = parseInt(pageMatch[1]);
      continue;
    }

    // 章节标题检测
    const isSectionBoundary =
      /^#{1,4}\s+/.test(line) ||
      /^第[一二三四五六七八九十\d]+[章节部分]/.test(line) ||
      /^[一二三四五六七八九十]+、/.test(line);

    if (isSectionBoundary && currentSize > 100) {
      const t = current.join('\n').trim();
      if (t) chunks.push({ id: chunkId++, text: t, section: currentSection, page: currentPage, char_count: t.length });
      current = [];
      currentSize = 0;
    }

    if (isSectionBoundary) currentSection = line.trim();
    current.push(line);
    currentSize += line.length + 1;

    // 超过 chunk_size 且句子结束处强制分块
    const endsWithSentence = /[。！？.!?；;]$/.test(line.trim());
    if (currentSize >= chunkSize && endsWithSentence) {
      const t = current.join('\n').trim();
      if (t) chunks.push({ id: chunkId++, text: t, section: currentSection, page: currentPage, char_count: t.length });
      const overlapText = t.slice(-overlap);
      current = overlapText ? [overlapText] : [];
      currentSize = overlapText.length;
    } else if (currentSize >= chunkSize * 1.5) {
      const t = current.join('\n').trim();
      if (t) chunks.push({ id: chunkId++, text: t, section: currentSection, page: currentPage, char_count: t.length });
      const overlapText = t.slice(-overlap);
      current = overlapText ? [overlapText] : [];
      currentSize = overlapText.length;
    }
  }

  if (current.length > 0) {
    const t = current.join('\n').trim();
    if (t) chunks.push({ id: chunkId++, text: t, section: currentSection, page: currentPage, char_count: t.length });
  }

  return chunks;
}

/** 简单关键词检索（Node.js 实现，不依赖Python） */
function keywordSearch(
  query: string,
  chunks: Array<{ id: number; text: string; section: string; page: number }>,
  topK: number
): Array<{ chunk_id: number; score: number; section: string; page: number; text: string }> {
  const queryTerms = query.split(/[\s，。、,]+/).filter(t => t.length > 1);

  const scored = chunks.map(chunk => {
    const text = chunk.text.toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
      const regex = new RegExp(term, 'gi');
      const matches = (text.match(regex) || []).length;
      score += matches * (term.length > 2 ? 2 : 1); // 长词权重更高
    }
    return {
      chunk_id: chunk.id,
      score: score / Math.max(chunk.text.length / 100, 1), // 归一化
      section: chunk.section,
      page: chunk.page,
      text: chunk.text,
    };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

/** 格式化检索结果为 prompt 上下文 */
function formatContextForPrompt(results: Array<{ chunk_id: number; score: number; section: string; page: number; text: string }>, maxChars = 4000): string {
  if (!results.length) return '';
  const lines = ['【相关案例内容（按相关度排序）】\n'];
  let totalChars = lines[0].length;

  for (const r of results) {
    const source = r.page && r.section ? `[第${r.page}页·${r.section}]` : `[片段${r.chunk_id}]`;
    const text = r.text.length > 600 ? r.text.slice(0, 600) + '...' : r.text;
    const block = `${source}\n${text}\n\n`;

    if (totalChars + block.length > maxChars) break;
    lines.push(block);
    totalChars += block.length;
  }

  return lines.join('');
}

// RAG 内存存储（生产环境应持久化到磁盘，此处为简化版）
const ragStore = new Map<string, { chunks: Array<{ id: number; text: string; section: string; page: number; char_count: number }>; createdAt: string }>();

// POST /api/rag/index — 构建案例 RAG 索引
app.post('/api/rag/index', async (req, res) => {
  try {
    const { caseId, text, chunksJson } = req.body as { caseId: string; text?: string; chunksJson?: string };

    if (!caseId) {
      res.status(400).json({ error: 'caseId 必填' });
      return;
    }

    let chunks: Array<{ id: number; text: string; section: string; page: number; char_count: number }>;

    if (chunksJson) {
      // 直接使用已分块数据
      const data = JSON.parse(chunksJson);
      chunks = data.chunks || data;
    } else if (text) {
      // 用 Node.js 内置分块
      chunks = chunkTextNode(text, 1000, 100);
    } else {
      res.status(400).json({ error: 'text 或 chunksJson 必填其一' });
      return;
    }

    // 存储到内存（及磁盘）
    ragStore.set(caseId, { chunks, createdAt: new Date().toISOString() });

    // 同时持久化到磁盘（便于 Python 脚本访问）
    const caseDir = pathMod.join(RAG_INDEX_DIR, caseId);
    fsSync.mkdirSync(caseDir, { recursive: true });
    fsSync.writeFileSync(
      pathMod.join(caseDir, 'chunks.json'),
      JSON.stringify({ chunks, total_chunks: chunks.length, created_at: new Date().toISOString() }, null, 2),
      'utf-8'
    );

    res.json({
      status: 'ok',
      caseId,
      totalChunks: chunks.length,
      avgChunkSize: Math.round(chunks.reduce((s, c) => s + c.char_count, 0) / chunks.length),
      method: 'node-builtin',
    });
  } catch (error) {
    console.error('RAG index error:', error);
    res.status(500).json({ error: `索引构建失败: ${error instanceof Error ? error.message : String(error)}` });
  }
});

// POST /api/rag/query — 检索相关片段
app.post('/api/rag/query', async (req, res) => {
  try {
    const { caseId, query, topK = 5 } = req.body as { caseId: string; query: string; topK?: number };

    if (!caseId || !query) {
      res.status(400).json({ error: 'caseId 和 query 必填' });
      return;
    }

    // 优先从内存获取
    let store = ragStore.get(caseId);

    // 内存中没有则尝试从磁盘加载
    if (!store) {
      const diskPath = pathMod.join(RAG_INDEX_DIR, caseId, 'chunks.json');
      if (fsSync.existsSync(diskPath)) {
        const data = JSON.parse(fsSync.readFileSync(diskPath, 'utf-8'));
        store = { chunks: data.chunks, createdAt: data.created_at || '' };
        ragStore.set(caseId, store);
      }
    }

    if (!store) {
      res.status(404).json({ error: `案例索引不存在: ${caseId}，请先调用 /api/rag/index` });
      return;
    }

    const results = keywordSearch(query, store.chunks, Math.min(topK, 15));
    const contextForPrompt = formatContextForPrompt(results);

    res.json({
      status: 'ok',
      caseId,
      query,
      resultsCount: results.length,
      totalChunksInIndex: store.chunks.length,
      results: results.map(r => ({
        chunkId: r.chunk_id,
        score: Math.round(r.score * 1000) / 1000,
        section: r.section,
        page: r.page,
        text: r.text.slice(0, 300) + (r.text.length > 300 ? '...' : ''),
      })),
      contextForPrompt,
    });
  } catch (error) {
    console.error('RAG query error:', error);
    res.status(500).json({ error: `检索失败: ${error instanceof Error ? error.message : String(error)}` });
  }
});

// DELETE /api/rag/index/:caseId — 删除索引
app.delete('/api/rag/index/:caseId', (req, res) => {
  const { caseId } = req.params;
  ragStore.delete(caseId);

  const diskPath = pathMod.join(RAG_INDEX_DIR, caseId);
  if (fsSync.existsSync(diskPath)) {
    fsSync.rmSync(diskPath, { recursive: true, force: true });
  }

  res.json({ status: 'ok', caseId, message: '索引已删除' });
});

// GET /api/rag/list — 列出所有已索引案例
app.get('/api/rag/list', (_req, res) => {
  const inMemory = Array.from(ragStore.entries()).map(([id, v]) => ({
    caseId: id,
    totalChunks: v.chunks.length,
    createdAt: v.createdAt,
    storage: 'memory',
  }));
  res.json({ status: 'ok', cases: inMemory });
});

// ============================================================
// 工作流 API — 多步骤任务编排
// ============================================================

interface WorkflowStep {
  id: string;
  name: string;
  type: 'parse_file' | 'llm_analyze' | 'rag_index' | 'ppt_outline';
  params: Record<string, any>;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
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
  parsedText?: string;  // 文件解析后的全文
}

const workflows = new Map<string, Workflow>();

// LLM 配置（与 gateway.ts 保持一致）
const WF_LLM_CONFIG = {
  baseUrl: process.env.LLM_BASE_URL || 'https://chat.ecnu.edu.cn/open/api/v1',
  apiKey: process.env.LLM_API_KEY || '',
  model: process.env.LLM_MODEL || 'ecnu-plus',
};

const PYTHON_GATEWAY_URL = 'http://127.0.0.1:3002';

// 工作流模板
const WORKFLOW_TEMPLATES: Record<string, {
  name: string;
  description: string;
  icon: string;
  steps: Omit<WorkflowStep, 'id' | 'status' | 'result' | 'error'>[];
}> = {
  'quick-read': {
    name: '案例速读',
    description: '上传PDF → 提取核心摘要、关键数据、决策点',
    icon: 'BookOpen',
    steps: [
      { name: '解析文件', type: 'parse_file', params: {} },
      { name: '摘要分析', type: 'llm_analyze', params: { prompt: '请阅读以下案例，生成专业分析报告：\n1. 核心摘要（200字以内）\n2. 关键事件时间线\n3. 核心决策点（3-5个）\n4. 关键数据提取（Markdown表格）' } },
    ],
  },
  'swot': {
    name: 'SWOT分析',
    description: '上传PDF → 构建知识库 → SWOT四象限 + TOWS矩阵',
    icon: 'BarChart3',
    steps: [
      { name: '解析文件', type: 'parse_file', params: {} },
      { name: '构建知识库', type: 'rag_index', params: {} },
      { name: 'SWOT分析', type: 'llm_analyze', params: { prompt: '请为以下案例中的企业进行完整SWOT分析：\n1. 优势(S) — 至少5个要点\n2. 劣势(W) — 至少5个要点\n3. 机会(O) — 至少5个要点\n4. 威胁(T) — 至少5个要点\n5. TOWS矩阵（SO/WO/ST/WT战略组合）\n6. 战略建议（3条）\n\n用Markdown表格呈现SWOT四象限对比。' } },
    ],
  },
  'deep-insight': {
    name: '深度洞察',
    description: '上传PDF → 多维度深度分析 → 颠覆性视角',
    icon: 'Lightbulb',
    steps: [
      { name: '解析文件', type: 'parse_file', params: {} },
      { name: '构建知识库', type: 'rag_index', params: {} },
      { name: '深度分析', type: 'llm_analyze', params: { prompt: '基于以下案例进行深度洞察分析：\n1. 3个被忽略的关键视角\n2. 2个跨行业类比（参照其他行业类似案例）\n3. 1个颠覆性假设（如果核心前提不成立会怎样）\n4. 对常规分析的3个挑战性质疑\n5. 独家数据洞察（Markdown表格）' } },
    ],
  },
  'ppt-outline': {
    name: 'PPT大纲',
    description: '上传PDF → 内容提取 → 生成15页以内PPT结构大纲',
    icon: 'Presentation',
    steps: [
      { name: '解析文件', type: 'parse_file', params: {} },
      { name: 'PPT大纲生成', type: 'ppt_outline', params: {} },
    ],
  },
  'full-pipeline': {
    name: '全流程分析',
    description: '速读 → SWOT → 深度洞察 → PPT大纲，一步到位',
    icon: 'Zap',
    steps: [
      { name: '解析文件', type: 'parse_file', params: {} },
      { name: '构建知识库', type: 'rag_index', params: {} },
      { name: '案例速读', type: 'llm_analyze', params: { prompt: '请阅读以下案例，生成核心摘要：\n1. 核心摘要（200字以内）\n2. 关键事件时间线\n3. 核心决策点（3-5个）\n4. 关键数据提取（Markdown表格）' } },
      { name: 'SWOT分析', type: 'llm_analyze', params: { prompt: '请进行SWOT分析（S/W/O/T各5个要点+TOWS矩阵+战略建议），用Markdown表格呈现。' } },
      { name: '深度洞察', type: 'llm_analyze', params: { prompt: '基于以下案例进行深度洞察：3个被忽略视角、2个跨行业类比、1个颠覆性假设、3个质疑。用Markdown表格提取关键数据。' } },
      { name: 'PPT大纲', type: 'ppt_outline', params: {} },
    ],
  },
};

// GET /api/workflow/templates
app.get('/api/workflow/templates', (_req, res) => {
  const templates = Object.entries(WORKFLOW_TEMPLATES).map(([id, t]) => ({
    id,
    name: t.name,
    description: t.description,
    icon: t.icon,
    stepCount: t.steps.length,
  }));
  res.json({ templates });
});

// GET /api/workflow/templates/:id
app.get('/api/workflow/templates/:id', (req, res) => {
  const template = WORKFLOW_TEMPLATES[req.params.id];
  if (!template) { res.status(404).json({ error: '模板不存在' }); return; }
  res.json({ id: req.params.id, ...template });
});

// POST /api/workflow/create
app.post('/api/workflow/create', async (req, res) => {
  try {
    const { templateId, steps, name, parsedText } = req.body;

    let workflowSteps: WorkflowStep[];
    if (templateId && WORKFLOW_TEMPLATES[templateId]) {
      const template = WORKFLOW_TEMPLATES[templateId];
      workflowSteps = template.steps.map((s, i) => ({
        ...s,
        id: `step_${i}`,
        status: 'pending' as const,
        params: { ...s.params },
      }));
    } else if (steps) {
      workflowSteps = steps.map((s: any, i: number) => ({
        ...s,
        id: `step_${i}`,
        status: 'pending' as const,
      }));
    } else {
      res.status(400).json({ error: '请提供 templateId 或 steps' });
      return;
    }

    const workflow: Workflow = {
      id: `wf_${Date.now()}`,
      name: name || `工作流 ${new Date().toLocaleString('zh-CN')}`,
      templateId: templateId || undefined,
      steps: workflowSteps,
      status: 'pending',
      createdAt: new Date().toISOString(),
      parsedText: parsedText || '',
    };

    workflows.set(workflow.id, workflow);
    res.json({ workflow });
  } catch (error) {
    res.status(500).json({ error: `创建工作流失败: ${error instanceof Error ? error.message : String(error)}` });
  }
});

// POST /api/workflow/:id/run
app.post('/api/workflow/:id/run', async (req, res) => {
  const workflow = workflows.get(req.params.id);
  if (!workflow) { res.status(404).json({ error: '工作流不存在' }); return; }

  if (workflow.status === 'running') {
    res.status(400).json({ error: '工作流正在执行中' });
    return;
  }

  // 如果请求体有 parsedText，更新到工作流
  if (req.body?.parsedText) {
    workflow.parsedText = req.body.parsedText;
  }

  workflow.status = 'running';
  // 重置所有步骤状态
  for (const step of workflow.steps) {
    step.status = 'pending';
    step.result = undefined;
    step.error = undefined;
  }

  res.json({ status: 'running', message: '工作流开始执行' });

  // 异步执行
  executeWorkflow(workflow).catch(err => {
    console.error('[Workflow] 执行异常:', err);
  });
});

// GET /api/workflow/:id
app.get('/api/workflow/:id', (req, res) => {
  const workflow = workflows.get(req.params.id);
  if (!workflow) { res.status(404).json({ error: '工作流不存在' }); return; }
  res.json({ workflow });
});

// GET /api/workflow
app.get('/api/workflow', (_req, res) => {
  const list = Array.from(workflows.values())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 50);
  res.json({ workflows: list });
});

// POST /api/workflow/:id/push — 推送结果到微信
app.post('/api/workflow/:id/push', async (req, res) => {
  const workflow = workflows.get(req.params.id);
  if (!workflow) { res.status(404).json({ error: '工作流不存在' }); return; }
  if (workflow.status !== 'completed') { res.status(400).json({ error: '工作流尚未完成' }); return; }

  const sections: string[] = [`📋 ${workflow.name}\n完成时间: ${workflow.completedAt}\n`];
  for (const step of workflow.steps) {
    const icon = step.status === 'completed' ? '✅' : '❌';
    sections.push(`${icon} ${step.name}`);
    if (workflow.results?.[step.name]) {
      sections.push(workflow.results[step.name]);
    }
  }

  const fullText = sections.join('\n\n---\n\n');

  try {
    const pushResp = await fetch(`${PYTHON_GATEWAY_URL}/push-wechat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: fullText, title: `工作流结果: ${workflow.name}` }),
    });
    const pushData = await pushResp.json();
    res.json(pushData);
  } catch (error) {
    res.status(500).json({ error: '推送失败，请检查微信是否已连接' });
  }
});

// 工作流执行引擎
async function executeWorkflow(workflow: Workflow) {
  const context: Record<string, any> = { parsedText: workflow.parsedText || '' };

  for (const step of workflow.steps) {
    step.status = 'running';
    try {
      switch (step.type) {
        case 'parse_file': {
          // parsedText 已在创建/执行时注入
          if (context.parsedText) {
            step.result = { text: context.parsedText.slice(0, 200) + '...', length: context.parsedText.length };
          } else {
            step.status = 'failed';
            step.error = '没有可解析的文件文本。请先上传PDF。';
            workflow.status = 'failed';
            return;
          }
          step.status = 'completed';
          break;
        }
        case 'rag_index': {
          const text = context.parsedText;
          if (!text) {
            step.status = 'failed';
            step.error = '没有文本可索引';
            workflow.status = 'failed';
            return;
          }
          const caseId = `wf_${workflow.id}_${Date.now()}`;
          const chunks = chunkTextNode(text, 1000, 100);
          ragStore.set(caseId, { chunks, createdAt: new Date().toISOString() });
          context.ragCaseId = caseId;
          context.ragChunks = chunks;
          step.result = { totalChunks: chunks.length, caseId };
          step.status = 'completed';
          console.log(`[Workflow] RAG索引完成: ${chunks.length} 块`);
          break;
        }
        case 'llm_analyze': {
          const prompt = step.params.prompt || '';
          let text = context.parsedText || '';
          if (!text) {
            step.status = 'failed';
            step.error = '没有可分析的文本';
            workflow.status = 'failed';
            return;
          }
          // 如果有RAG检索结果，用检索增强的上下文
          if (context.ragCaseId && context.ragChunks) {
            const query = prompt.split('\n')[0].slice(0, 50);
            const results = keywordSearch(query, context.ragChunks, 10);
            const ragContext = formatContextForPrompt(results, 6000);
            if (ragContext) {
              text = `【检索到的相关内容】\n${ragContext}\n\n【完整案例内容】\n${text}`;
            }
          }
          // ECNU API 不支持 system role，合并到 user message
          const userMsg = `${prompt}\n\n---\n${text.slice(0, 15000)}`;
          console.log(`[Workflow] LLM分析中: ${step.name} (${userMsg.length} 字符)`);
          const resp = await fetch(`${WF_LLM_CONFIG.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${WF_LLM_CONFIG.apiKey}`,
            },
            body: JSON.stringify({
              model: WF_LLM_CONFIG.model,
              messages: [{ role: 'user', content: userMsg }],
              temperature: 0.6,
              max_tokens: 4000,
              stream: false,
            }),
            signal: AbortSignal.timeout(120000),
          });
          if (resp.ok) {
            const data: any = await resp.json();
            const result = data?.choices?.[0]?.message?.content || '';
            context[step.name] = result;
            step.result = { preview: result.slice(0, 200) + '...', length: result.length };
            console.log(`[Workflow] LLM分析完成: ${step.name} (${result.length} 字符)`);
          } else {
            throw new Error(`LLM API 返回 ${resp.status}`);
          }
          step.status = 'completed';
          break;
        }
        case 'ppt_outline': {
          let text = context.parsedText || '';
          if (!text) {
            step.status = 'failed';
            step.error = '没有可用的文本';
            workflow.status = 'failed';
            return;
          }
          // 合并之前分析结果
          let contentForPPT = '';
          for (const [key, val] of Object.entries(context)) {
            if (typeof val === 'string' && val.length > 100 && key !== 'parsedText') {
              contentForPPT += val + '\n\n';
            }
          }
          if (!contentForPPT) contentForPPT = text;
          // 生成PPT大纲
          const pptPrompt = `你是一位专业的PPT设计专家和MBA案例分析顾问。请根据以下分析内容，生成一份结构化的PPT大纲。

请严格按以下JSON格式输出（只输出JSON）：
{"title":"PPT标题","subtitle":"副标题","slides":[{"layout":"title|content|twoColumn|data|quote|section","title":"页面标题（完整观点句）","bullets":["要点1","要点2"]}]}
设计规范：10-15页以内，遵循麦肯锡金字塔原理，结论先行，内容精炼有洞察力。

以下为分析内容：
${contentForPPT.slice(0, 12000)}`;

          console.log(`[Workflow] PPT大纲生成中...`);
          const resp = await fetch(`${WF_LLM_CONFIG.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${WF_LLM_CONFIG.apiKey}`,
            },
            body: JSON.stringify({
              model: WF_LLM_CONFIG.model,
              messages: [{ role: 'user', content: pptPrompt }],
              temperature: 0.7,
              max_tokens: 3000,
              stream: false,
            }),
            signal: AbortSignal.timeout(120000),
          });
          if (resp.ok) {
            const data: any = await resp.json();
            const result = data?.choices?.[0]?.message?.content || '';
            context[step.name] = result;
            step.result = { preview: result.slice(0, 200) + '...', length: result.length };
            console.log(`[Workflow] PPT大纲完成 (${result.length} 字符)`);
          } else {
            throw new Error(`LLM API 返回 ${resp.status}`);
          }
          step.status = 'completed';
          break;
        }
        default:
          step.status = 'completed';
      }
    } catch (error) {
      step.status = 'failed';
      step.error = error instanceof Error ? error.message : String(error);
      workflow.status = 'failed';
      console.error(`[Workflow] 步骤失败: ${step.name} - ${step.error}`);
      return;
    }
  }

  // 所有步骤完成
  if (workflow.steps.every(s => s.status === 'completed')) {
    workflow.status = 'completed';
    workflow.completedAt = new Date().toISOString();
  }

  // 保存结果
  workflow.results = {};
  for (const step of workflow.steps) {
    if (context[step.name]) {
      workflow.results[step.name] = context[step.name];
    }
  }
  console.log(`[Workflow] 工作流完成: ${workflow.name}`);
}

app.listen(PORT, () => {
  console.log(`CaseBuddy backend running on http://localhost:${PORT}`);
});
