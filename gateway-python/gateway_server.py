"""
CaseBuddy Python 网关服务
统一管理微信/QQ/飞书/企业微信 Bot

功能：
- 接收 Node.js 后端的配置和命令
- 管理各平台 Bot 的启动/停止
- 提供扫码状态查询
- 转发消息到后端 LLM
"""

import os
import sys
import json
import time
import threading
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
import socketserver

# 项目根目录
PROJECT_ROOT = Path(__file__).parent.absolute()
TEMP_DIR = PROJECT_ROOT / "temp"
TEMP_DIR.mkdir(exist_ok=True)

# 导入 Bot 实现
sys.path.insert(0, str(PROJECT_ROOT))
from bots.wechat_bot import WxBotClient
from bots.qq_bot import QQBot
from bots.feishu_bot_enhanced import FeishuBot  # 使用增强版

# 全局状态
class GatewayState:
    def __init__(self):
        self.bots = {
            'wechat': None,  # WxBotClient instance
            'qq': None,
            'feishu': None,
            'wecom': None  # 企业微信由 Node.js 管理
        }
        self.bot_threads = {
            'wechat': None,
            'qq': None,
            'feishu': None,
        }
        self.config = {
            'wechat': {'enabled': False, 'logged_in': False},
            'qq': {'enabled': False, 'logged_in': False},
            'feishu': {'enabled': False, 'logged_in': False},
            'wecom': {'enabled': False, 'logged_in': False}
        }
        self.llm_proxy_url = 'http://localhost:3001'
        self.lock = threading.Lock()
        self._wechat_running = threading.Event()
        self._last_wechat_uid = ''  # 记录最后一个发消息给Bot的微信用户ID，用于推送

        # 推送历史持久化
        self.push_history = []
        self._push_history_file = TEMP_DIR / 'push_history.json'
        self._load_push_history()

        # 分析工作台 session 摘要（前端同步过来）
        self.session_summary = []

    def _load_push_history(self):
        """启动时从文件加载推送历史"""
        try:
            if self._push_history_file.exists():
                with open(self._push_history_file, 'r', encoding='utf-8') as f:
                    self.push_history = json.load(f)
                print(f"[Gateway] 已加载 {len(self.push_history)} 条推送历史")
        except Exception as e:
            print(f"[Gateway] 加载推送历史失败: {e}")
            self.push_history = []

    def _save_push_history(self):
        """保存推送历史到文件"""
        try:
            # 只保留最近200条
            self.push_history = self.push_history[-200:]
            with open(self._push_history_file, 'w', encoding='utf-8') as f:
                json.dump(self.push_history, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"[Gateway] 保存推送历史失败: {e}")

    def _get_session_summary(self):
        """从后端获取分析工作台 session 摘要"""
        try:
            import requests as _req
            resp = _req.get(
                'http://localhost:3001/api/gateway/session-summary',
                timeout=5
            )
            if resp.ok:
                data = resp.json()
                return data.get('summary', '')
            return None
        except Exception as e:
            print(f'[Gateway] 获取session摘要失败: {e}')
            return None

    def _analyze_file(self, file_path):
        """上传文件到后端进行分析（使用增强版 30K 字符解析）"""
        try:
            import requests as _req
            # 第一步：调用 /api/parse/file 解析文件（支持 PDF/DOCX，30K字符）
            # 显式设置 filename 和 content-type，避免 multer fileFilter 拦截
            # 必须禁用代理，避免 Clash 等代理工具拦截 localhost 请求
            file_name = os.path.basename(file_path)
            file_ext = os.path.splitext(file_name)[1].lower()
            mime_map = {'.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.doc': 'application/msword'}
            content_type = mime_map.get(file_ext, 'application/octet-stream')
            with open(file_path, 'rb') as f:
                resp = _req.post(
                    'http://localhost:3001/api/parse/file',
                    files={'file': (file_name, f, content_type)},
                    proxies={'http': '', 'https': ''},
                    timeout=120
                )
            if not resp.ok:
                err_msg = ''
                try:
                    err_msg = resp.json().get('error', resp.text[:200])
                except Exception:
                    err_msg = resp.text[:200]
                print(f'[Gateway] 文件解析失败 HTTP {resp.status_code}: {err_msg}', file=sys.__stdout__)
                return f'文件解析失败 (HTTP {resp.status_code}): {err_msg}'

            data = resp.json()
            parsed_text = data.get('text', '')
            filename = data.get('filename', '')
            page_count = data.get('pageCount', 0)

            if not parsed_text.strip():
                return f'文件 {filename} 无法提取有效文本内容。'

            print(f'[Gateway] 文件解析成功: {filename}, {page_count}页, {len(parsed_text)}字', file=sys.__stdout__)

            # 第二步：使用解析出的文本调用 LLM 进行深度分析
            analysis_prompt = (
                f'请对以下案例文件内容进行专业MBA案例分析，输出以下部分：\n'
                f'1. 核心摘要（200字以内）\n'
                f'2. 关键数据提取（用Markdown表格呈现）\n'
                f'3. 核心决策点识别（3-5个）\n'
                f'4. 初步战略建议\n\n'
                f'文件名: {filename}\n'
                f'页数: {page_count}\n\n'
                f'---案例内容---\n{parsed_text}'
            )
            analysis = self._forward_to_llm(analysis_prompt, source='wechat')
            return analysis
        except Exception as e:
            print(f'[Gateway] 文件分析失败: {e}')
            return f'文件分析出错: {e}'

    def _build_session_summary(self):
        """根据缓存的 session 摘要构建可读文本"""
        msgs = state.session_summary
        if not msgs:
            return '当前分析工作台暂无对话内容。请在前端分析工作台进行对话后，再查看。'
        lines = ['📋 分析工作台最近对话：\n']
        for m in msgs[-10:]:
            role = '👤 用户' if m.get('role') == 'user' else '🤖 AI'
            content = m.get('content', '')[:300]
            lines.append(f'{role}: {content}')
        return '\n\n'.join(lines)

    def _build_full_session_summary(self):
        """构建完整的分析工作台对话摘要（用于微信推送，保留完整内容）"""
        msgs = state.session_summary
        if not msgs:
            return '当前分析工作台暂无对话内容。请先在前端进行分析工作台进行对话，然后再请求推送。'
        lines = [f'📋 分析工作台对话记录（共 {len(msgs)} 条）：\n']
        for m in msgs[-20:]:
            role = '👤 用户' if m.get('role') == 'user' else '🤖 AI'
            content = m.get('content', '')
            lines.append(f'{role}:\n{content}')
        return '\n\n---\n\n'.join(lines)

    def to_dict(self):
        with self.lock:
            return {
                'running': any(b is not None for b in self.bots.values()),
                'connectedPlatforms': [k for k, v in self.config.items() if v.get('logged_in')],
                'totalMessages': 0,
                'bots': dict(self.config)
            }

    def _forward_to_llm(self, text, source='wechat'):
        """转发消息到 LLM 后端（修复：使用正确的 /api/gateway/chat 端点）。"""
        import requests as _req
        try:
            resp = _req.post(
                'http://localhost:3001/api/gateway/chat',
                json={'message': text},
                timeout=60
            )
            if resp.ok:
                data = resp.json()
                return data.get('response', '') or data.get('text', '')
            else:
                err = resp.json().get('error', f'HTTP {resp.status_code}')
                print(f'[Gateway] LLM 调用失败: {err}')
                return f'处理失败：{err}'
        except _req.exceptions.Timeout:
            print('[Gateway] LLM 调用超时（60s）')
            return '抱歉，AI 响应超时，请稍后再试。'
        except Exception as e:
            print(f'[Gateway] LLM 转发失败: {e}')
            return '抱歉，服务暂时不可用，请稍后再试。'

    def wechat_message_handler(self, bot, msg):
        """微信消息回调：收到消息后转发给 LLM。"""
        text = bot.extract_text(msg)
        uid = msg.get('from_user_id', '')
        ctx = msg.get('context_token', '')

        # 记录最后发消息的用户ID（用于推送功能）
        if uid:
            state._last_wechat_uid = uid

        # 检测文件/图片消息
        if not text:
            print(f'[WX] 收到非文本消息 from {uid}: type={msg.get("message_type", "?")}', file=sys.__stdout__)
            # 使用增强的文件信息提取
            file_info = bot.extract_file_info(msg)
            if file_info:
                file_id, file_name, item_type, dl_method = file_info
                print(f'[WX] 检测到{item_type}(下载方式:{dl_method}): name={file_name}', file=sys.__stdout__)
                file_path = bot.download_media(msg)
                if file_path:
                    print(f'[WX] 文件已下载: {file_path}', file=sys.__stdout__)
                    doc_exts = ('.pdf', '.docx', '.doc', '.txt', '.md')
                    is_doc = any(file_path.lower().endswith(ext) for ext in doc_exts)

                    if is_doc:
                        bot.send_text(uid, f'📄 文件已收到，正在分析 {file_name}...', context_token=ctx)
                        def _analyze():
                            try:
                                analysis = state._analyze_file(file_path)
                                max_len = 1800
                                for i in range(0, len(analysis), max_len):
                                    part = analysis[i:i+max_len]
                                    bot.send_text(uid, part, context_token=ctx)
                                    time.sleep(0.5)
                            except Exception as e:
                                bot.send_text(uid, f'文件分析失败: {e}', context_token=ctx)
                        threading.Thread(target=_analyze, daemon=True).start()
                    else:
                        bot.send_text(uid, f'📎 已收到文件 "{file_name}"，但暂不支持该类型的分析。请发送 PDF 或 Word 文档。', context_token=ctx)
                else:
                    bot.send_text(uid, '⚠️ 文件下载失败，请重试。', context_token=ctx)
            else:
                # 无法识别的消息类型，打印详细信息用于调试
                items = msg.get('item_list', [])
                item_types = [str(it.get('type')) for it in items]
                print(f'[WX] 未知消息类型，item_list types={item_types}', file=sys.__stdout__)
                bot.send_text(uid, f'⚠️ 暂不支持该类型消息。请发送文本或 PDF 文件。', context_token=ctx)
            return

        print(f'[WX] 收到消息 from {uid}: {text[:80]}', file=sys.__stdout__)

        # 检测"查看分析工作台"意图
        if any(kw in text for kw in ['分析工作台', '工作台内容', '分析了什么', '当前分析', '工作台']):
            summary = state._build_session_summary()
            max_len = 1800
            for i in range(0, len(summary), max_len):
                part = summary[i:i+max_len]
                bot.send_text(uid, part, context_token=ctx)
                time.sleep(0.3)
            return

        # 检测"推送工作台结果"意图
        if any(kw in text for kw in ['发送结果', '推送结果', '把分析发给我', '发给我', '推送工作台', '结果发给我', '分析结果', '推送给我']):
            full_summary = state._build_full_session_summary()
            if '暂无对话内容' in full_summary:
                bot.send_text(uid, '当前分析工作台暂无对话内容，请先在前端进行分析工作台进行对话后再请求推送。', context_token=ctx)
            else:
                bot.send_text(uid, '📋 正在推送分析工作台内容...', context_token=ctx)
                max_len = 1800
                for i in range(0, len(full_summary), max_len):
                    part = full_summary[i:i+max_len]
                    bot.send_text(uid, part, context_token=ctx)
                    time.sleep(0.5)
            return

        # ── 工作流命令检测 ──
        wf_commands = {
            '案例速读': 'quick-read',
            '速读': 'quick-read',
            'swot分析': 'swot',
            'swot': 'swot',
            '深度洞察': 'deep-insight',
            '洞察': 'deep-insight',
            'ppt大纲': 'ppt-outline',
            '生成ppt': 'ppt-outline',
            '全流程': 'full-pipeline',
            '全流程分析': 'full-pipeline',
            '一键分析': 'full-pipeline',
        }
        workflow_match = None
        for kw, tpl_id in wf_commands.items():
            if kw.lower() in text.lower():
                workflow_match = tpl_id
                wf_name = kw
                break

        if workflow_match:
            tpl_names = {'quick-read': '案例速读', 'swot': 'SWOT分析', 'deep-insight': '深度洞察', 'ppt-outline': 'PPT大纲', 'full-pipeline': '全流程分析'}
            display_name = tpl_names.get(workflow_match, workflow_match)
            bot.send_text(uid, f'🚀 正在启动「{display_name}」工作流...', context_token=ctx)
            def _run_workflow():
                try:
                    import requests as _req
                    # 创建工作流
                    create_resp = _req.post(
                        'http://localhost:3001/api/workflow/create',
                        json={'templateId': workflow_match, 'name': display_name},
                        timeout=30
                    )
                    if not create_resp.ok:
                        bot.send_text(uid, f'工作流创建失败: {create_resp.status_code}', context_token=ctx)
                        return
                    wf_data = create_resp.json().get('workflow', {})
                    wf_id = wf_data.get('id')
                    if not wf_id:
                        bot.send_text(uid, '工作流创建失败: 无ID', context_token=ctx)
                        return

                    # 执行工作流（异步）
                    run_resp = _req.post(
                        f'http://localhost:3001/api/workflow/{wf_id}/run',
                        timeout=10
                    )
                    bot.send_text(uid, '✅ 工作流已创建并开始执行', context_token=ctx)

                    # 轮询等待完成（最多5分钟）
                    for attempt in range(60):
                        time.sleep(5)
                        status_resp = _req.get(
                            f'http://localhost:3001/api/workflow/{wf_id}',
                            timeout=10
                        )
                        if status_resp.ok:
                            wf_status = status_resp.json().get('workflow', {})
                            st = wf_status.get('status', '')
                            if st == 'completed':
                                results = wf_status.get('results', {})
                                if results:
                                    # 发送各步骤结果
                                    for step_name, result_text in results.items():
                                        if isinstance(result_text, str) and result_text.strip():
                                            bot.send_text(uid, f'📊 {step_name}', context_token=ctx)
                                            time.sleep(0.3)
                                            # 分段发送
                                            for i in range(0, len(result_text), 1800):
                                                bot.send_text(uid, result_text[i:i+1800], context_token=ctx)
                                                time.sleep(0.5)
                                    bot.send_text(uid, '✅ 分析全部完成！', context_token=ctx)
                                else:
                                    bot.send_text(uid, '✅ 工作流已完成，但未生成结果。', context_token=ctx)
                                break
                            elif st == 'failed':
                                steps = wf_status.get('steps', [])
                                failed = [s for s in steps if s.get('status') == 'failed']
                                errors = [f"{s['name']}: {s.get('error', '未知错误')}" for s in failed]
                                bot.send_text(uid, f'❌ 工作流执行失败:\n' + '\n'.join(errors), context_token=ctx)
                                break
                    else:
                        bot.send_text(uid, '⏳ 工作流执行超时，请稍后发送"查看结果"获取结果。', context_token=ctx)
                except Exception as e:
                    print(f'[Gateway] 工作流执行失败: {e}', file=sys.__stdout__)
                    bot.send_text(uid, f'工作流执行失败: {e}', context_token=ctx)
            threading.Thread(target=_run_workflow, daemon=True).start()
            return

        # 检测"查看工作流结果"
        if any(kw in text for kw in ['查看结果', '工作流结果', '执行结果']):
            try:
                import requests as _req
                resp = _req.get('http://localhost:3001/api/workflow', timeout=10)
                if resp.ok:
                    wf_list = resp.json().get('workflows', [])
                    if wf_list:
                        latest = wf_list[0]
                        results = latest.get('results', {})
                        status = latest.get('status', '')
                        if status == 'running':
                            # 计算进度
                            steps = latest.get('steps', [])
                            done = sum(1 for s in steps if s['status'] in ('completed', 'failed'))
                            bot.send_text(uid, f'⏳ 工作流「{latest["name"]}」执行中... ({done}/{len(steps)} 步骤完成)', context_token=ctx)
                        elif results:
                            for step_name, result_text in results.items():
                                if isinstance(result_text, str) and result_text.strip():
                                    bot.send_text(uid, f'📊 {step_name}', context_token=ctx)
                                    time.sleep(0.3)
                                    for i in range(0, len(result_text), 1800):
                                        bot.send_text(uid, result_text[i:i+1800], context_token=ctx)
                                        time.sleep(0.5)
                        else:
                            bot.send_text(uid, f'工作流「{latest["name"]}」{status}，暂无结果。', context_token=ctx)
                    else:
                        bot.send_text(uid, '暂无工作流记录。', context_token=ctx)
            except Exception as e:
                bot.send_text(uid, f'获取工作流结果失败: {e}', context_token=ctx)
            return

        # 简单命令处理
        if text.strip() == '/help':
            bot.send_text(uid,
                '📚 CaseBuddy 微信助手\n\n'
                '💬 基础功能：\n'
                '• 发送任意问题 — AI 分析 MBA 案例\n'
                '• 发送 PDF/DOCX — 自动分析并返回结果\n\n'
                '🚀 工作流命令（需先发送PDF）：\n'
                '• "案例速读" — 核心摘要+关键数据\n'
                '• "SWOT分析" — SWOT四象限+TOWS\n'
                '• "深度洞察" — 多维度深度分析\n'
                '• "PPT大纲" — 生成PPT结构\n'
                '• "全流程分析" — 速读+SWOT+洞察+PPT\n'
                '• "查看结果" — 查看最近工作流结果\n\n'
                '📋 工作台相关：\n'
                '• "查看分析工作台" — 工作台摘要\n'
                '• "发送结果" — 推送工作台结果到微信\n\n'
                '💡 使用流程：先发PDF → 再发命令',
                context_token=ctx)
            return

        # 转发给 LLM（异步回复）
        def _reply():
            try:
                response = self._forward_to_llm(text, source="wechat")
                # 分段发送（每段不超过2000字符）
                max_len = 2000
                for i in range(0, len(response), max_len):
                    part = response[i:i+max_len]
                    bot.send_text(uid, part, context_token=ctx)
                    time.sleep(0.5)
            except Exception as e:
                print(f"[WX] 回复失败: {e}", file=sys.__stdout__)
                try:
                    bot.send_text(uid, '抱歉，回复失败了，请重试。', context_token=ctx)
                except:
                    pass
        threading.Thread(target=_reply, daemon=True).start()

    def _push_to_wechat(self, data):
        """从前端推送内容到微信（需要已登录）。
        发送到当前微信Bot的「最近对话对象」。
        如果指定了 to_user_id 则直接发送。
        返回 {'ok': bool, 'message': str}
        """
        content = data.get('content', '') if data else ''
        title = data.get('title', '') if data else ''
        to_user_id = data.get('to_user_id', '') if data else ''
        if not content:
            return {'ok': False, 'message': '缺少推送内容'}

        bot = state.bots.get('wechat')
        if not bot or not bot.token:
            return {'ok': False, 'message': '微信未登录，请先扫码'}

        # 如果没有指定接收者，尝试从最近消息中获取
        if not to_user_id and hasattr(state, '_last_wechat_uid') and state._last_wechat_uid:
            to_user_id = state._last_wechat_uid

        if not to_user_id:
            return {'ok': False, 'message': '无接收者。请先从微信发一条消息给Bot，系统会自动记录对方。'}

        # 如果有标题，先发标题
        if title:
            try:
                bot.send_text(to_user_id, f'📋 {title}', context_token='')
                time.sleep(0.5)
            except Exception as e:
                print(f'[WX] 推送标题失败: {e}')

        # 分段发送内容
        sent = 0
        max_len = 1800
        for i in range(0, len(content), max_len):
            part = content[i:i+max_len]
            try:
                bot.send_text(to_user_id, part, context_token='')
                sent += 1
                time.sleep(0.5)
            except Exception as e:
                print(f'[WX] 推送内容失败: {e}')
                # 记录失败
                record = {
                    'id': str(int(time.time() * 1000)),
                    'time': time.strftime('%Y-%m-%d %H:%M:%S'),
                    'title': title or '(无标题)',
                    'content': content[:500] + ('...' if len(content) > 500 else ''),
                    'contentFull': content,
                    'to_user_id': to_user_id,
                    'status': 'failed',
                    'message': f'推送中断: {e}'
                }
                state.push_history.append(record)
                state._save_push_history()
                return {'ok': False, 'message': f'推送中断: {e}'}

        # 记录成功
        record = {
            'id': str(int(time.time() * 1000)),
            'time': time.strftime('%Y-%m-%d %H:%M:%S'),
            'title': title or '(无标题)',
            'content': content[:500] + ('...' if len(content) > 500 else ''),
            'contentFull': content,
            'to_user_id': to_user_id,
            'status': 'ok',
            'segments': sent
        }
        state.push_history.append(record)
        state._save_push_history()

        return {'ok': True, 'message': f'推送成功，共发送 {sent} 段'}

state = GatewayState()

# ============= HTTP API Handler =============

class GatewayHandler(BaseHTTPRequestHandler):
    """HTTP API 处理器"""

    def log_message(self, format, *args):
        """自定义日志格式"""
        print(f"[Gateway] {args[0]}")

    def send_json(self, data, status=200):
        """发送 JSON 响应"""
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def read_json(self):
        """读取 JSON 请求体"""
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length > 0:
            return json.loads(self.rfile.read(content_length).decode('utf-8'))
        return {}

    def parse_path(self):
        """解析路径和查询参数"""
        parsed = urlparse(self.path)
        path_parts = parsed.path.strip('/').split('/')
        return path_parts, parse_qs(parsed.query)

    def do_OPTIONS(self):
        """处理 CORS 预检请求"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        """处理 GET 请求"""
        path_parts, query = self.parse_path()

        # GET /status - 获取网关状态
        if len(path_parts) == 1 and path_parts[0] == 'status':
            self.send_json(state.to_dict())
            return

        # GET /qrcode - 获取微信二维码
        if len(path_parts) == 1 and path_parts[0] == 'qrcode':
            # 先检查 WxBotClient 的二维码路径
            from bots.wechat_bot import TOKEN_FILE
            qr_path = TOKEN_FILE.parent / 'wx_qr.png'
            if qr_path.exists():
                self.send_response(200)
                self.send_header('Content-Type', 'image/png')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(qr_path.read_bytes())
            else:
                self.send_json({'status': 'no_qrcode', 'message': '暂无二维码，请先调用 /start/wechat'})
            return

        # GET /config - 获取配置
        if len(path_parts) == 1 and path_parts[0] == 'config':
            with state.lock:
                config = {
                    'wechat': {'enabled': state.config['wechat']['enabled']},
                    'qq': {'enabled': state.config['qq']['enabled'], 'appId': '', 'allowedUsers': []},
                    'feishu': {'enabled': state.config['feishu']['enabled'], 'appId': '', 'allowedUsers': []}
                }
            self.send_json({'gateways': config})
            return

        # GET /push-history - 获取推送历史
        if len(path_parts) == 1 and path_parts[0] == 'push-history':
            self.send_json(state.push_history)
            return

        # GET /session-summary - 获取分析工作台摘要
        if len(path_parts) == 1 and path_parts[0] == 'session-summary':
            summary = state._build_session_summary()
            self.send_json({'summary': summary})
            return

        self.send_json({'error': 'Unknown endpoint'}, 404)

    def do_POST(self):
        """处理 POST 请求"""
        path_parts, query = self.parse_path()
        data = self.read_json()

        # POST /config/wechat - 配置微信
        if len(path_parts) >= 2 and path_parts[0] == 'config' and path_parts[1] == 'wechat':
            with state.lock:
                state.config['wechat']['enabled'] = data.get('enabled', False)
            self.send_json({'status': 'ok', 'message': '微信配置已更新'})
            return

        # POST /config/qq - 配置 QQ
        if len(path_parts) >= 2 and path_parts[0] == 'config' and path_parts[1] == 'qq':
            with state.lock:
                state.config['qq']['enabled'] = data.get('enabled', False)
                state.config['qq']['appId'] = data.get('appId', '')
                state.config['qq']['secret'] = data.get('secret', '')
                state.config['qq']['allowedUsers'] = data.get('allowedUsers', [])
            self.send_json({'status': 'ok', 'message': 'QQ 配置已更新'})
            return

        # POST /config/feishu - 配置飞书
        if len(path_parts) >= 2 and path_parts[0] == 'config' and path_parts[1] == 'feishu':
            with state.lock:
                state.config['feishu']['enabled'] = data.get('enabled', False)
                state.config['feishu']['appId'] = data.get('appId', '')
                state.config['feishu']['secret'] = data.get('secret', '')
                state.config['feishu']['allowedUsers'] = data.get('allowedUsers', [])
            self.send_json({'status': 'ok', 'message': '飞书配置已更新'})
            return

        # POST /start - 启动所有已配置且启用的 Bot
        if len(path_parts) == 1 and path_parts[0] == 'start':
            self._start_all_bots()
            self.send_json({'status': 'ok', 'message': '网关启动中'})
            return

        # POST /stop - 停止所有 Bot
        if len(path_parts) == 1 and path_parts[0] == 'stop':
            self._stop_all_bots()
            self.send_json({'status': 'ok', 'message': '网关已停止'})
            return

        # POST /start/wechat - 启动微信（扫码登录）
        if len(path_parts) == 2 and path_parts[0] == 'start' and path_parts[1] == 'wechat':
            self._start_wechat()
            self.send_json({'status': 'ok', 'message': '微信 Bot 启动中，请等待二维码'})
            return

        # POST /start/qq - 启动 QQ
        if len(path_parts) == 2 and path_parts[0] == 'start' and path_parts[1] == 'qq':
            self._start_qq()
            self.send_json({'status': 'ok', 'message': 'QQ Bot 启动中'})
            return

        # POST /start/feishu - 启动飞书
        if len(path_parts) == 2 and path_parts[0] == 'start' and path_parts[1] == 'feishu':
            self._start_feishu()
            self.send_json({'status': 'ok', 'message': '飞书 Bot 启动中'})
            return

        # POST /logout/wechat - 退出微信登录
        if len(path_parts) == 2 and path_parts[0] == 'logout' and path_parts[1] == 'wechat':
            self._stop_wechat()
            with state.lock:
                state.config['wechat']['logged_in'] = False
            self.send_json({'status': 'ok', 'message': '微信已退出登录'})
            return

        # POST /push-wechat - 从前端推送内容到微信
        if len(path_parts) == 1 and path_parts[0] == 'push-wechat':
            result = state._push_to_wechat(data)
            if result.get('ok'):
                self.send_json({'status': 'ok', 'message': result['message']})
            else:
                self.send_json({'status': 'error', 'error': result['message']}, 400)
            return

        # POST /sync-session - 前端同步分析工作台 session 摘要
        if len(path_parts) == 1 and path_parts[0] == 'sync-session':
            messages = data.get('messages', [])
            if isinstance(messages, list):
                state.session_summary = messages[-20:]  # 保留最近20条
                print(f"[Gateway] 已同步 session 摘要 ({len(state.session_summary)} 条)")
                self.send_json({'status': 'ok', 'count': len(state.session_summary)})
            else:
                self.send_json({'status': 'error', 'error': 'messages 格式错误'}, 400)
            return

        self.send_json({'error': 'Unknown endpoint'}, 404)

    def _start_all_bots(self):
        """启动所有已配置的 Bot"""
        if state.config['wechat']['enabled']:
            self._start_wechat()
        if state.config['qq']['enabled']:
            self._start_qq()
        if state.config['feishu']['enabled']:
            self._start_feishu()

    def _stop_all_bots(self):
        """停止所有 Bot"""
        self._stop_wechat()
        self._stop_qq()
        self._stop_feishu()

    def _start_wechat(self):
        """启动微信 Bot：先扫码登录，再启动监听循环。"""
        # ★ 防重复启动（避免两个 run_loop 同时运行导致双重回复）
        if state.bots['wechat'] is not None:
            print("[Gateway] 微信已在运行，跳过重复启动")
            return

        # 如果已登录，验证 token 是否还有效
        bot = WxBotClient()
        if bot.token and bot.bot_id:
            # ★ 验证 token 有效性：调用 get_updates 测试，无效则删除 token 重新扫码
            try:
                import requests as _req
                test_resp = _req.post(
                    'https://ilinkai.weixin.qq.com/ilink/bot/getupdates',
                    json={'get_updates_buf': bot._buf or '', 'base_info': {'channel_version': bot.channel_version if hasattr(bot, 'channel_version') else '2.1.10'}},
                    headers={
                        'Content-Type': 'application/json',
                        'AuthorizationType': 'ilink_bot_token',
                        'Authorization': f'Bearer {bot.token}',
                        'User-Agent': 'openclaw-weixin/2.1.10',
                    },
                    timeout=10,
                    proxies={'http': '', 'https': ''}
                )
                if test_resp.status_code == 401 or test_resp.status_code == 404:
                    print(f"[Gateway] 微信 token 已失效 (HTTP {test_resp.status_code})，删除旧 token，重新扫码")
                    # 删除旧 token 文件
                    try:
                        from bots.wechat_bot import TOKEN_FILE
                        TOKEN_FILE.unlink(missing_ok=True)
                    except:
                        pass
                    bot = WxBotClient()  # 重新创建（无 token）
                else:
                    print("[Gateway] 微信已登录（token 有效），启动监听循环...")
                    with state.lock:
                        state.bots['wechat'] = bot
                        state.config['wechat']['logged_in'] = True
                    self._run_wechat_loop(bot)
                    return
            except Exception as e:
                print(f"[Gateway] 微信 token 验证失败: {e}，重新扫码")
                try:
                    from bots.wechat_bot import TOKEN_FILE
                    TOKEN_FILE.unlink(missing_ok=True)
                except:
                    pass
                bot = WxBotClient()

        # 未登录 → 扫码
        print("[Gateway] 微信未登录，开始扫码登录...")
        def _scan_and_run():
            try:
                qr_path = bot.login_qr()
                print(f"[Gateway] 扫码完成，二维码: {qr_path}")
                # 登录成功后启动监听
                with state.lock:
                    state.bots['wechat'] = bot
                    state.config['wechat']['logged_in'] = True
                self._run_wechat_loop(bot)
            except Exception as e:
                print(f"[Gateway] 微信登录失败: {e}", file=sys.__stdout__)

        thread = threading.Thread(target=_scan_and_run, daemon=True)
        thread.start()

    def _run_wechat_loop(self, bot):
        """在新线程中运行微信消息监听循环。"""
        def _loop():
            state._wechat_running.set()
            try:
                bot.run_loop(state.wechat_message_handler)
            except Exception as e:
                print(f"[Gateway] 微信监听循环异常: {e}", file=sys.__stdout__)
            finally:
                state._wechat_running.clear()
                with state.lock:
                    state.bots['wechat'] = None
                    state.config['wechat']['logged_in'] = False
                print("[Gateway] 微信监听已停止")

        thread = threading.Thread(target=_loop, daemon=True)
        thread.start()
        state.bot_threads['wechat'] = thread
        print("[Gateway] 微信监听线程已启动")

    def _stop_wechat(self):
        """停止微信 Bot（通过停止监听循环实现）。"""
        state._wechat_running.clear()
        with state.lock:
            if state.bots['wechat'] is not None:
                # WxBotClient 没有 stop()，通过清空 bot 来停止
                state.bots['wechat'] = None
        print("[Gateway] 微信 Bot 已停止")

    def _start_qq(self):
        """启动 QQ Bot"""
        if state.bots['qq'] is not None:
            print("[Gateway] QQ Bot 已在运行")
            return

        config = state.config['qq']
        if not config.get('appId') or not config.get('secret'):
            print("[Gateway] QQ 配置不完整，请先配置 AppID 和 Secret")
            return

        def run_qq():
            try:
                bot = QQBot(
                    app_id=config['appId'],
                    app_secret=config['secret'],
                    allowed_users=config.get('allowedUsers', []),
                    llm_proxy_url=state.llm_proxy_url
                )
                with state.lock:
                    state.bots['qq'] = bot
                    state.config['qq']['logged_in'] = True
                bot.run()
            except Exception as e:
                print(f"[Gateway] QQ Bot 错误: {e}")
            finally:
                with state.lock:
                    state.bots['qq'] = None
                    state.config['qq']['logged_in'] = False

        thread = threading.Thread(target=run_qq, daemon=True)
        thread.start()
        state.bot_threads['qq'] = thread
        print("[Gateway] QQ Bot 启动线程已创建")

    def _stop_qq(self):
        """停止 QQ Bot"""
        with state.lock:
            if state.bots['qq'] is not None:
                try:
                    state.bots['qq'].stop()
                except:
                    pass
                state.bots['qq'] = None
                state.config['qq']['logged_in'] = False
        print("[Gateway] QQ Bot 已停止")

    def _start_feishu(self):
        """启动飞书 Bot"""
        if state.bots['feishu'] is not None:
            print("[Gateway] 飞书 Bot 已在运行")
            return

        config = state.config['feishu']
        if not config.get('appId') or not config.get('secret'):
            print("[Gateway] 飞书配置不完整，请先配置 AppID 和 Secret")
            return

        def run_feishu():
            try:
                bot = FeishuBot(
                    app_id=config['appId'],
                    app_secret=config['secret'],
                    allowed_users=config.get('allowedUsers', []),
                    llm_proxy_url=state.llm_proxy_url
                )
                with state.lock:
                    state.bots['feishu'] = bot
                    state.config['feishu']['logged_in'] = True
                bot.run()
            except Exception as e:
                print(f"[Gateway] 飞书 Bot 错误: {e}")
            finally:
                with state.lock:
                    state.bots['feishu'] = None
                    state.config['feishu']['logged_in'] = False

        thread = threading.Thread(target=run_feishu, daemon=True)
        thread.start()
        state.bot_threads['feishu'] = thread
        print("[Gateway] 飞书 Bot 启动线程已创建")

    def _stop_feishu(self):
        """停止飞书 Bot"""
        with state.lock:
            if state.bots['feishu'] is not None:
                try:
                    state.bots['feishu'].stop()
                except:
                    pass
                state.bots['feishu'] = None
                state.config['feishu']['logged_in'] = False
        print("[Gateway] 飞书 Bot 已停止")


# ============= 启动网关服务 =============

class ThreadedHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    """多线程 HTTP 服务器"""
    allow_reuse_address = True

def run_gateway(port=3002):
    """运行网关服务"""
    server = ThreadedHTTPServer(('127.0.0.1', port), GatewayHandler)
    print(f"[Gateway] Python 网关服务启动在 http://127.0.0.1:{port}")
    print("[Gateway] 按 Ctrl+C 停止")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[Gateway] 正在停止...")
        server.shutdown()
        print("[Gateway] 已停止")

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3002
    run_gateway(port)
