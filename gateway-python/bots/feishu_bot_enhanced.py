"""
飞书 Bot 增强实现
支持：
1. 接收指令并调用 CaseBuddy 分析
2. 发送分析内容到飞书
3. 发送 PPT 文件到飞书
4. 支持手机查看（飞书天然支持）
"""

import os
import sys
import json
import time
import threading
from typing import List, Optional
from pathlib import Path

try:
    import lark_oapi as lark
    from lark_oapi.api.im.v1 import *
    from lark_oapi.api.im.v1 import CreateMessageRequestBody, CreateMessageRequest
except ImportError:
    print("请安装依赖: pip install lark-oapi")
    sys.exit(1)


class FeishuBot:
    """飞书 Bot 客户端（增强版）"""

    def __init__(
        self,
        app_id: str,
        app_secret: str,
        allowed_users: List[str],
        llm_proxy_url: str = 'http://localhost:3001'
    ):
        self.app_id = app_id
        self.app_secret = app_secret
        self.allowed_users = set(allowed_users) if allowed_users else set()
        self.public_access = '*' in self.allowed_users
        self._llm_proxy_url = llm_proxy_url
        self._running = False
        self._client = None
        self._seen_ids = set()
        self._dedup_file = Path(__file__).parent.parent / "temp" / "feishu_seen_ids.txt"
        self._dedup_file.parent.mkdir(exist_ok=True)

    def _load_dedup(self):
        """加载去重记录"""
        if self._dedup_file.exists():
            try:
                with open(self._dedup_file, 'r', encoding='utf-8') as f:
                    for line in f:
                        parts = line.strip().split(' ', 1)
                        if len(parts) >= 1:
                            self._seen_ids.add(parts[0])
            except Exception as e:
                print(f"[Feishu] 加载去重记录失败: {e}")

    def _save_dedup(self):
        """保存去重记录"""
        try:
            with open(self._dedup_file, 'w', encoding='utf-8') as f:
                for mid in list(self._seen_ids)[-500:]:  # 最多保留500条
                    f.write(f"{mid}\n")
        except Exception as e:
            print(f"[Feishu] 保存去重记录失败: {e}")

    def _check_permission(self, user_id: str) -> bool:
        """检查用户权限"""
        if self.public_access:
            return True
        return user_id in self.allowed_users

    def _extract_text(self, message: dict) -> str:
        """提取消息文本"""
        msg_type = message.get('msg_type', '')
        content = message.get('content', {})

        if msg_type == 'text':
            try:
                return json.loads(content).get('text', '')
            except:
                return str(content)

        if msg_type == 'post':
            try:
                post_content = json.loads(content)
                texts = []
                for section in post_content.get('post', {}).get('zh_cn', {}).get('content', []):
                    for item in section:
                        if item.get('tag') == 'text':
                            texts.append(item.get('text', ''))
                        elif item.get('tag') == 'at':
                            texts.append(f"@{item.get('user_id', '')}")
                return '\n'.join(texts)
            except:
                return '[富文本消息]'

        if msg_type == 'image':
            return '[图片消息]'

        if msg_type == 'file':
            return '[文件消息]'

        if msg_type == 'audio':
            return '[语音消息]'

        if msg_type == 'video':
            return '[视频消息]'

        return str(content)

    def _build_client(self):
        """构建飞书客户端"""
        return lark.Client.builder()\
            .app_id(self.app_id)\
            .app_secret(self.app_secret)\
            .log_level(lark.LogLevel.INFO)\
            .build()

    def _send_text(self, open_id: str, text: str):
        """发送文本消息"""
        if not self._client:
            return

        try:
            # 分割长消息
            for part in self._split_text(text, 4000):
                body = CreateMessageRequestBody.builder() \
                    .receive_id(open_id) \
                    .msg_type("text") \
                    .content(json.dumps({"text": part})) \
                    .build()

                response = self._client.im.v1.message.create(
                    CreateMessageRequest.builder() \
                        .receive_id_type("open_id") \
                        .request_body(body) \
                        .build()
                )
                if not response.success():
                    print(f"[Feishu] 发送失败: {response.msg}")
        except Exception as e:
            print(f"[Feishu] 发送消息错误: {e}")

    def _send_file(self, open_id: str, file_path: str) -> bool:
        """发送文件到飞书"""
        if not self._client:
            return False

        try:
            import requests

            # 1. 上传文件到飞书
            upload_url = "https://open.feishu.cn/open-apis/im/v1/files"
            headers = {
                "Authorization": f"Bearer {self._get_tenant_access_token()}"
            }

            with open(file_path, 'rb') as f:
                files = {
                    'file': (os.path.basename(file_path), f, 'application/octet-stream')
                }
                data = {
                    'file_type': 'stream',
                    'file_name': os.path.basename(file_path)
                }

                resp = requests.post(upload_url, headers=headers, files=files, data=data, timeout=30)
                result = resp.json()

                if result.get('code') == 0:
                    file_key = result.get('data', {}).get('file_key', '')

                    # 2. 发送文件消息
                    body = CreateMessageRequestBody.builder() \
                        .receive_id(open_id) \
                        .msg_type("file") \
                        .content(json.dumps({"file_key": file_key})) \
                        .build()

                    response = self._client.im.v1.message.create(
                        CreateMessageRequest.builder() \
                            .receive_id_type("open_id") \
                            .request_body(body) \
                            .build()
                    )

                    return response.success()
                else:
                    print(f"[Feishu] 上传文件失败: {result}")
                    return False

        except Exception as e:
            print(f"[Feishu] 发送文件错误: {e}")
            return False

    def _get_tenant_access_token(self) -> str:
        """获取 tenant_access_token"""
        try:
            import requests
            url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
            data = {
                "app_id": self.app_id,
                "app_secret": self.app_secret
            }
            resp = requests.post(url, json=data, timeout=10)
            result = resp.json()
            if result.get('code') == 0:
                return result.get('tenant_access_token', '')
            else:
                print(f"[Feishu] 获取 token 失败: {result}")
                return ''
        except Exception as e:
            print(f"[Feishu] 获取 token 错误: {e}")
            return ''

    def _split_text(self, text: str, limit: int = 4000) -> List[str]:
        """分割文本"""
        lines = text.split('\n')
        parts = []
        current = ''
        for line in lines:
            if len(current) + len(line) + 1 <= limit:
                current += ('\n' if current else '') + line
            else:
                if current:
                    parts.append(current)
                current = line
        if current:
            parts.append(current)
        return parts if parts else ['']

    def _clean_response(self, text: str) -> str:
        """清洗响应文本"""
        import re
        # 移除不支持的元素
        text = re.sub(r'!\[.*?\]\(.*?\)', '', text)  # 图片
        text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)  # 链接
        return text.strip()

    def _call_llm(self, text: str) -> Optional[str]:
        """调用 LLM"""
        try:
            import requests
            resp = requests.post(
                f'{self._llm_proxy_url}/api/chat/stream',
                json={'message': text, 'source': 'feishu'},
                timeout=60
            )
            if resp.ok:
                data = resp.json()
                return data.get('response', '')
            return None
        except Exception as e:
            print(f"[Feishu] LLM 调用失败: {e}")
            return None

    def _handle_message(self, message: dict):
        """处理收到的消息"""
        try:
            msg_id = message.get('message_id', '')
            if msg_id in self._seen_ids:
                return

            sender = message.get('sender', {})
            user_id = sender.get('id', {}).get('open_id', '')
            chat_id = message.get('chat_id', '')

            if not self._check_permission(user_id):
                print(f"[Feishu] 未授权用户: {user_id}")
                return

            text = self._extract_text(message)
            if not text:
                return

            print(f"[Feishu] 收到消息 from {user_id}: {text[:80]}")

            # 记录消息 ID
            self._seen_ids.add(msg_id)
            self._save_dedup()

            # 处理指令
            if text.startswith('/'):
                self._handle_command(user_id, text)
                return

            # 调用 LLM
            response = self._call_llm(text)
            if response:
                response = self._clean_response(response)
                self._send_text(user_id, response)

        except Exception as e:
            print(f"[Feishu] 处理消息错误: {e}")

    def _handle_command(self, user_id: str, command: str):
        """处理飞书指令"""
        parts = command.lower().split()
        cmd = parts[0] if parts else ''

        if cmd == '/help':
            help_text = """📖 CaseBuddy 飞书 Bot 指令：

/help - 显示帮助
/analyze <内容> - 分析内容（MBA案例）
/ppt <主题> - 生成 PPT 大纲
/file <文件路径> - 发送文件
/status - 查看状态
"""
            self._send_text(user_id, help_text)

        elif cmd == '/analyze':
            # 分析内容
            content = command[8:].strip()  # 去掉 '/analyze '
            if not content:
                self._send_text(user_id, "请提供要分析的内容，例如：/analyze 苹果公司的SWOT分析")
                return

            self._send_text(user_id, f"🔍 正在分析：{content[:50]}...")

            # 调用 LLM 分析
            response = self._call_llm(f"请对以下内容进行MBA案例分析：{content}")
            if response:
                response = self._clean_response(response)
                self._send_text(user_id, f"📊 分析结果：\n\n{response}")
            else:
                self._send_text(user_id, "❌ 分析失败，请稍后重试")

        elif cmd == '/ppt':
            # 生成 PPT 大纲
            topic = command[4:].strip()
            if not topic:
                self._send_text(user_id, "请提供 PPT 主题，例如：/ppt 新能源汽车市场分析")
                return

            self._send_text(user_id, f"📝 正在生成 PPT 大纲：{topic[:50]}...")

            # 调用 LLM 生成大纲
            response = self._call_llm(f"请为以下主题生成MBA案例分析PPT大纲：{topic}")
            if response:
                response = self._clean_response(response)
                self._send_text(user_id, f"📊 PPT 大纲：\n\n{response}")
            else:
                self._send_text(user_id, "❌ 生成失败，请稍后重试")

        elif cmd == '/file':
            # 发送文件
            file_path = command[5:].strip()
            if not file_path or not os.path.exists(file_path):
                self._send_text(user_id, "请提供有效的文件路径，例如：/file /path/to/file.pdf")
                return

            self._send_text(user_id, f"📤 正在发送文件：{os.path.basename(file_path)}...")
            success = self._send_file(user_id, file_path)
            if success:
                self._send_text(user_id, "✅ 文件发送成功！")
            else:
                self._send_text(user_id, "❌ 文件发送失败，请稍后重试")

        elif cmd == '/status':
            status_text = f"""📊 CaseBuddy 状态：

✅ 飞书 Bot 已连接
🤖 LLM 代理：{self._llm_proxy_url}
👥 授权用户：{'公开' if self.public_access else len(self.allowed_users)}
"""
            self._send_text(user_id, status_text)

        else:
            self._send_text(user_id, f"❌ 未知指令：{cmd}\n输入 /help 查看可用指令")

    def stop(self):
        """停止 Bot"""
        self._running = False

    def run(self):
        """运行 Bot"""
        self._running = True
        print(f"[Feishu] Bot 启动中 (app_id={self.app_id})")

        if not self.app_id or not self.app_secret:
            print("[Feishu] 配置不完整，请设置 app_id 和 app_secret")
            return

        try:
            self._load_dedup()
            self._client = self._build_client()

            # 创建事件处理器
            event_handler = lark.Event.create_callback_handler(self)

            # 创建 WebSocket 应用
            ws_app = lark.WSClient(
                self.app_id,
                self.app_secret,
                event_handler,
                lark.LogLevel.INFO
            )

            # 连接并保持运行
            ws_app.start()

            while self._running:
                time.sleep(1)

        except KeyboardInterrupt:
            print("[Feishu] 收到退出信号")
        except Exception as e:
            print(f"[Feishu] Bot 错误: {e}")
        finally:
            self._running = False
            self._save_dedup()
            print("[Feishu] Bot 已停止")

    # 飞书事件处理
    def on_p2p_message_event(self, data: dict):
        """处理私聊消息事件"""
        message = data.get('event', {})
        self._handle_message(message)

    def on_group_message_event(self, data: dict):
        """处理群消息事件"""
        message = data.get('event', {})
        self._handle_message(message)
