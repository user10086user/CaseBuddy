"""
QQ Bot 实现
基于 qq-botpy 库
"""

import os
import sys
import json
import time
import asyncio
import threading
from typing import List, Optional
from collections import deque

try:
    import botpy
    from botpy.message import C2CMessage, GroupMessage
except ImportError:
    print("请安装依赖: pip install qq-botpy")
    sys.exit(1)


class QQBot:
    """QQ Bot 客户端"""

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
        self._processed_ids = deque(maxlen=1000)

    def _check_permission(self, user_id: str) -> bool:
        """检查用户权限"""
        if self.public_access:
            return True
        return user_id in self.allowed_users

    def _build_intents(self):
        """构建连接意图"""
        try:
            return botpy.Intents(public_messages=True, direct_message=True)
        except Exception:
            intents = botpy.Intents.none() if hasattr(botpy.Intents, "none") else botpy.Intents()
            for attr in ("public_messages", "public_guild_messages", "direct_message",
                        "direct_messages", "c2c_message", "c2c_messages",
                        "group_at_message", "group_at_messages"):
                if hasattr(intents, attr):
                    try:
                        setattr(intents, attr, True)
                    except Exception:
                        pass
            return intents

    def _split_text(self, text: str, limit: int = 1500) -> List[str]:
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

    def _make_bot_class(self):
        """创建 Bot 类"""
        app = self

        class QQBotInstance(botpy.Client):
            def __init__(self):
                super().__init__(intents=app._build_intents(), ext_handlers=False)

            async def on_ready(self):
                print(f"[QQ] Bot 已就绪")

            async def on_c2c_message_create(self, message: C2CMessage):
                await app._on_message(message, is_group=False)

            async def on_group_at_message_create(self, message: GroupMessage):
                await app._on_message(message, is_group=True)

            async def on_direct_message_create(self, message):
                await app._on_message(message, is_group=False)

        return QQBotInstance

    async def _on_message(self, data, is_group: bool = False):
        """处理收到的消息"""
        try:
            msg_id = getattr(data, "id", None)
            if msg_id in self._processed_ids:
                return
            self._processed_ids.append(msg_id)

            content = (getattr(data, "content", "") or "").strip()
            if not content:
                return

            author = getattr(data, "author", None)
            user_id = str(
                getattr(author, "member_openid" if is_group else "user_openid", "")
                or getattr(author, "id", "")
                or "unknown"
            )

            if not self._check_permission(user_id):
                print(f"[QQ] 未授权用户: {user_id}")
                return

            print(f"[QQ] 收到消息 from {user_id} ({'群' if is_group else '私聊'}): {content}")

            # 调用 LLM 并发送回复
            response = await self._call_llm(content)
            if response:
                await self._send_text(
                    user_id if not is_group else getattr(data, "group_openid", ""),
                    response,
                    is_group=is_group
                )

        except Exception as e:
            print(f"[QQ] 处理消息错误: {e}")

    async def _send_text(self, chat_id: str, content: str, msg_id=None, is_group: bool = False):
        """发送文本消息"""
        if not self._client:
            return

        api = self._client.api.post_group_message if is_group else self._client.api.post_c2c_message
        key = "group_openid" if is_group else "openid"

        for part in self._split_text(content, 1500):
            try:
                await api(**{
                    key: chat_id,
                    "msg_type": 0,
                    "content": part,
                    "msg_id": msg_id
                })
            except Exception as e:
                print(f"[QQ] 发送消息失败: {e}")

    async def _call_llm(self, text: str) -> Optional[str]:
        """调用 LLM"""
        try:
            import aiohttp
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f'{self._llm_proxy_url}/api/chat/stream',
                    json={'message': text, 'source': 'qq'},
                    timeout=aiohttp.ClientTimeout(total=60)
                ) as resp:
                    if resp.ok:
                        data = await resp.json()
                        return data.get('response', '')
            return None
        except Exception as e:
            print(f"[QQ] LLM 调用失败: {e}")
            return None

    def stop(self):
        """停止 Bot"""
        self._running = False
        if self._client:
            try:
                asyncio.run(self._client.close())
            except:
                pass

    def run(self):
        """运行 Bot"""
        self._running = True
        print(f"[QQ] Bot 启动中 (app_id={self.app_id})")

        if not self.app_id or not self.app_secret:
            print("[QQ] 配置不完整，请设置 app_id 和 app_secret")
            return

        try:
            BotClass = self._make_bot_class()
            self._client = BotClass()

            # 使用异步方式运行
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(self._client.start(
                appid=int(self.app_id),
                secret=self.app_secret
            ))

        except KeyboardInterrupt:
            print("[QQ] 收到退出信号")
        except Exception as e:
            print(f"[QQ] Bot 错误: {e}")
        finally:
            self._running = False
            print("[QQ] Bot 已停止")
