# CaseBuddy - AI赋能MBA案例分析大赛专家产品

> 让 AI Agent 成为你的 "超级外脑"，5小时极限挑战中的全流程智能助手

CaseBuddy 是专为 **MBA案例分析大赛** 设计的 AI 协同专家产品。在 5 小时极限挑战中，帮你完成从案例解构、深度分析、数据整理到 PPT 生成、答辩准备的全流程，同时支持微信远程操控。

---

## 功能概览

| 模块 | 功能 | 说明 |
|:---|:---|:---|
| 智能分析工作台 | 案例速读/框架分析/深度洞察 | AI 对话式交互，支持 PDF/DOCX 上传解析 |
| AI PPT 助手 | 大纲生成/风格指南/多平台导出 | 豆包/Gamma/Canva 提示词 + PPTX 原生生成 |
| 智能工作流 | 5 个预设模板一键执行 | 案例速读/SWOT/深度洞察/PPT大纲/全流程 |
| RAG 知识库 | BM25 关键词检索 | 自动分块、按需注入 Prompt |
| 微信网关 | PDF上传自动分析 + 结果推送 | 扫码登录，微信端远程操控 |
| 模型配置中心 | 多 API / 多模型 | OpenAI 兼容格式，ECNU/DeepSeek 等 |
| Skill 技能市场 | 可扩展 Prompt 模板库 | 自定义分析框架和工具 |

---

## 技术架构

```
CaseBuddy/
├── frontend/             # React 18 + Vite + TypeScript + Tailwind CSS
│   ├── src/pages/        # 页面组件
│   │   ├── Home.tsx           # 首页
│   │   ├── WorkBench.tsx      # 智能分析工作台（核心）
│   │   ├── PPTAssistant.tsx   # AI PPT 助手
│   │   ├── WorkflowPage.tsx   # 智能工作流
│   │   ├── WeChatAssistant.tsx # 微信助手
│   │   ├── ModelConfig.tsx    # 模型配置
│   │   ├── SkillMarket.tsx    # 技能市场
│   │   ├── GatewayConfig.tsx  # 网关配置
│   │   └── Layout.tsx         # 布局框架
│   ├── src/components/        # 通用组件
│   ├── src/contexts/          # React Context（Session 状态管理）
│   └── src/utils/             # 工具函数（导出、格式处理）
│
├── backend/              # Node.js + Express + TypeScript
│   └── src/index.ts      # 全部 API 端点 + 工作流执行引擎
│
├── gateway-python/       # Python 微信/QQ/飞书网关
│   ├── gateway_server.py # HTTP API 网关服务（端口 3002）
│   ├── bots/             # Bot 实现
│   │   └── wechat_bot.py # 微信 Bot（CDN下载 + AES解密）
│   └── requirements.txt  # Python 依赖
│
└── outputs/              # 输出文件目录
```

### 技术栈

| 层级 | 技术 |
|:---|:---|
| 前端 | React 18 + Vite + TypeScript + Tailwind CSS 3.4 |
| 路由 | React Router v7 |
| 状态管理 | React Context + useLocalStorage |
| Markdown 渲染 | react-markdown + remark-gfm |
| PDF 导出 | html2pdf.js |
| PPT 生成 | pptxgenjs |
| 后端 | Express 4 + TypeScript |
| 文件解析 | pdf-parse v2 + mammoth |
| Word 导出 | docx |
| 微信网关 | Python 3.12 + requests + pycryptodome |

---

## 快速启动

### 环境要求

- **Node.js** >= 18.0（推荐 20+）
- **npm** >= 9.0
- **Python** >= 3.10（微信网关需要）

### 1. 克隆项目

```bash
git clone https://github.com/user10086user/CaseBuddy.git
cd CaseBuddy
```

### 2. 安装依赖

```bash
# 前端
cd frontend
npm install
cd ..

# 后端
cd backend
npm install
cd ..

# Python 网关（可选，微信功能需要）
cd gateway-python
pip install -r requirements.txt
cd ..
```

### 3. 配置环境变量

在 `backend/` 目录下创建 `.env` 文件：

```env
# 后端端口
PORT=3001

# LLM API 配置（工作流引擎使用）
LLM_BASE_URL=https://chat.ecnu.edu.cn/open/api/v1
LLM_API_KEY=your-api-key-here
LLM_MODEL=ecnu-plus
```

> 前端的模型配置通过 Web 界面「模型配置中心」页面设置，存储在浏览器 localStorage 中。

### 4. 启动服务

#### 开发模式

需要 **3 个终端**：

```bash
# 终端 1 - 启动后端
cd backend
npm run dev
# 后端运行在 http://localhost:3001

# 终端 2 - 启动前端
cd frontend
npm run dev
# 前端运行在 http://localhost:5173

# 终端 3 - 启动微信网关（可选）
cd gateway-python
python gateway_server.py
# 网关运行在 http://localhost:3002
```

#### 生产部署（Linux/macOS）

```bash
# 编译后端
cd backend
npm run build

# 独立启动后端（必须用 nohup，不能用 bash 后台 &）
nohup node dist/index.js > backend.log 2>&1 &

# 启动前端
cd ../frontend
nohup npx vite --host > frontend.log 2>&1 &

# 启动微信网关（可选）
cd ../gateway-python
nohup python -u gateway_server.py > gateway.log 2>&1 &
```

#### 生产部署（Windows）

```bash
# 编译后端
cd backend
npx tsc

# 启动后端（PowerShell 后台）
Start-Process -NoNewWindow node -ArgumentList "dist/index.js" -RedirectStandardOutput "backend.log" -RedirectStandardError "backend_err.log"

# 启动前端
cd ..\frontend
Start-Process -NoNewWindow npx -ArgumentList "vite --host" -RedirectStandardOutput "frontend.log"

# 启动网关（可选）
cd ..\gateway-python
Start-Process -NoNewWindow python -ArgumentList "-u gateway_server.py" -RedirectStandardOutput "gateway.log"
```

### 5. 验证服务

```bash
# 后端健康检查
curl http://localhost:3001/api/health

# 网关状态检查
curl http://localhost:3002/status
```

### 6. 访问应用

- **前端界面**：http://localhost:5173
- **后端 API**：http://localhost:3001
- **网关 API**：http://localhost:3002

---

## 模块详解

### 1. 智能分析工作台 (WorkBench)

核心交互页面，支持与 AI 进行多轮对话式分析：

- **案例速读**：上传 PDF/DOCX，自动提取核心摘要、关键事件、决策点
- **战略框架分析**：SWOT、PESTEL、波特五力、价值链等框架一键调用
- **深度洞察生成**：跨行业类比、红队质疑、颠覆性假设
- **Agent 工具调用**：支持联网搜索、多步骤推理
- **RAG 知识库**：上传文件后自动构建索引，按需检索相关段落注入 Prompt
- **流式输出**：SSE 实时流式返回 AI 回复
- **消息操作**：每条消息支持复制、预览、导出
- **多格式导出**：Markdown / PDF / Word

### 2. AI PPT 助手

基于案例分析自动生成专业 PPT：

- **数据源**：从分析工作台会话生成 / 上传 MD/TXT / 自定义主题
- **大纲生成**：MBA 标准结构（10 页），Action Title 原则
- **风格指南**：配色方案（5 色）、字体规范、图表风格
- **多平台提示词**：豆包 / Gamma / Canva 一键生成
- **幻灯片预览**：缩略图 + 主预览 + 全屏
- **格式导出**：Markdown / JSON / PPTX

### 3. 智能工作流

一键执行预设分析流程：

| 模板 | 步骤 | 适用场景 |
|:---|:---|:---|
| 案例速读 | 解析 → LLM 摘要 | 快速了解案例全貌 |
| SWOT 分析 | 解析 → RAG 索引 → SWOT | 竞争环境分析 |
| 深度洞察 | 解析 → RAG 索引 → 多维度分析 | 全面深度分析 |
| PPT 大纲 | 解析 → PPT 结构生成 | 快速制作 PPT |
| 全流程 | 解析 → RAG → 速读 → SWOT → 洞察 → PPT | 完整分析全流程 |

支持上传 PDF 文件或粘贴文本，执行完成后可将结果推送到微信。

### 4. RAG 知识库

- **自动分块**：基于章节边界 + 重叠窗口
- **BM25 检索**：关键词匹配，topK 可调
- **按需注入**：分析时自动检索相关段落，替代全文塞入上下文
- **5 场景策略**：根据分析类型调整检索参数

### 5. 微信网关

通过微信远程操控 CaseBuddy：

- **扫码登录**：生成二维码，微信扫码即可连接
- **PDF 上传**：微信发送 PDF 文件，自动下载（CDN + AES 解密）并分析
- **自然语言命令**：发送「案例速读」「SWOT 分析」「深度洞察」等触发工作流
- **结果推送**：分析完成后自动分段推送到微信（单条 ≤ 1800 字）
- **会话同步**：微信与 Web 端共享分析会话（最近 20 条，每条 ≤ 1000 字）

**微信命令列表**：
- `案例速读` / `SWOT` / `深度洞察` / `PPT大纲` / `全流程` / `一键分析`
- `发送结果` / `推送结果` — 推送工作台分析结果到微信
- `查看结果` — 查看最近工作流执行结果
- `帮助` / `help` — 查看命令列表

### 6. 模型配置中心

- 支持 OpenAI 兼容格式的任意 LLM API
- 内置 ECNU Chat API（ecnu-plus / ecnu-max）
- 可配置 Base URL、API Key、模型名称
- 温度、最大 Token 等参数可调
- 多模型快速切换

---

## API 端点

### 后端 API（端口 3001）

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/health` | 健康检查 |
| POST | `/api/proxy/chat/completions` | LLM 对话（代理转发） |
| POST | `/api/proxy/chat/completions/stream` | LLM 流式对话（SSE） |
| POST | `/api/parse/file` | 文件解析（PDF/DOCX，返回文本） |
| POST | `/api/export/docx` | 导出 Word 文档 |
| POST | `/api/ppt/generate-outline` | 生成 PPT 大纲 |
| POST | `/api/rag/index` | 构建 RAG 索引 |
| POST | `/api/rag/query` | RAG 关键词检索 |
| GET | `/api/rag/list` | 列出已索引案例 |
| DELETE | `/api/rag/index/:caseId` | 删除 RAG 索引 |
| GET | `/api/workflow/templates` | 获取工作流模板列表 |
| POST | `/api/workflow/create` | 创建工作流实例 |
| POST | `/api/workflow/:id/run` | 执行工作流 |
| GET | `/api/workflow/:id` | 查询工作流状态 |
| GET | `/api/workflow` | 列出所有工作流 |
| POST | `/api/workflow/:id/push` | 推送工作流结果到微信 |

### 网关 API（端口 3002）

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/status` | 网关状态（含微信登录状态） |
| POST | `/start/wechat` | 启动微信 Bot |
| POST | `/stop/wechat` | 停止微信 Bot |
| GET | `/qr` | 获取微信登录二维码 |
| POST | `/chat` | 发送消息到微信 |

---

## 环境变量参考

### 后端 (.env)

| 变量 | 必填 | 默认值 | 说明 |
|:---|:---|:---|:---|
| `PORT` | 否 | `3001` | 后端服务端口 |
| `LLM_BASE_URL` | 否 | `https://chat.ecnu.edu.cn/open/api/v1` | LLM API 地址 |
| `LLM_API_KEY` | 是 | - | LLM API 密钥 |
| `LLM_MODEL` | 否 | `ecnu-plus` | 默认 LLM 模型 |

### 前端

模型配置通过 Web 界面「模型配置中心」设置，存储在浏览器 localStorage，无需环境变量。

### 微信网关

微信 Bot 的 Token 由 ilinkai 平台管理，通过 `/start/wechat` 自动获取，无需手动配置。

---

## 注意事项

### 代理问题

如果系统使用了 Clash 等代理工具，Python `requests` 库会自动读取系统代理，导致 localhost 请求被拦截。解决方案：

1. 在网关代码中所有 `requests` 调用添加 `proxies={'http': '', 'https': ''}`
2. 或在启动前清除代理环境变量：`unset http_proxy https_proxy`

### ECNU API 限制

- 不支持 `system` role，需合并到 `user` message
- 长 prompt（>500 字符）或复杂 JSON 可能返回 500 错误
- 建议 prompt 简洁，max_tokens ≤ 3000

### Node.js fetch 兼容性

- Node.js v22 内置 `fetch`（基于 Undici）返回的 body 不是标准 Web ReadableStream
- SSE 流式输出需使用 `for await (const chunk of response.body)` 读取

### 微信文件下载

微信原生文件分享使用 CDN + AES-ECB 加密，需从 `file_item.media` 中提取 `encrypt_query_param` 和 `aes_key` 进行解密，而非使用 `file_id` API。

---

## 路线图

- [x] 智能分析工作台（案例速读/框架分析/深度洞察）
- [x] AI PPT 助手（大纲/风格/预览/导出）
- [x] 智能工作流系统（5 个预设模板）
- [x] RAG 知识库（BM25 检索）
- [x] 微信网关（PDF 上传/自动分析/结果推送）
- [x] 多格式导出（Markdown/PDF/Word/PPTX）
- [x] Agent 工具调用
- [x] 模型配置中心
- [ ] 联网搜索增强
- [ ] 多人协作模式
- [ ] 答辩模拟训练

---

## License

ISC

---

> Built with React, Node.js, Python, and a lot of caffeine for MBA Case Competition.
