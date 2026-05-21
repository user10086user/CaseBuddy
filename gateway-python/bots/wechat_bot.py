"""
微信 iLink Bot 客户端
基于 GenericAgent 的 wechatapp.py 移植
API: https://ilinkai.weixin.qq.com
"""
import os, sys, re, threading, time, socket, json, struct, base64, uuid, webbrowser, hashlib, math
from pathlib import Path
from urllib.parse import quote
import requests, qrcode
from Crypto.Cipher import AES

# ── 清除代理环境变量（ilinkai 是国内腾讯服务，不需要代理；代理反而会导致连接失败）
# 参考 GenericAgent wechatapp.py 的处理方式
for _k in ('HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'):
    os.environ.pop(_k, None)

# ── 所有 requests 调用使用 NO_PROXY（强制绕过 Windows WinInet 系统代理）
_NO_PROXY = {'http': '', 'https': ''}

# ── 常量 ──────────────────────────────────────────────────────────────────────
API = 'https://ilinkai.weixin.qq.com'
TOKEN_FILE = Path.home() / '.casebuddy' / 'wx_token.json'
TOKEN_FILE.parent.mkdir(exist_ok=True)
VER = '2.1.10'
MSG_USER, MSG_BOT = 1, 2
ITEM_TEXT, ITEM_IMAGE, ITEM_FILE, ITEM_VIDEO = 1, 2, 4, 5
CDN_BASE = 'https://novac2c.cdn.weixin.qq.com/c2c'
ILINK_APP_ID = 'bot'
ILINK_APP_CLIENT_VERSION = (2 << 16) | (1 << 8) | 10
UA = f'openclaw-weixin/{VER}'

def _uin():
    return base64.b64encode(struct.pack('>I', int.from_bytes(os.urandom(4), 'big'))).decode()


class WxBotClient:
    """微信 iLink Bot 客户端（移植自 GenericAgent wechatapp.py）"""

    def __init__(self, token_file=None):
        self._tf = Path(token_file) if token_file else TOKEN_FILE
        self.token = None
        self.bot_id = None
        self._buf = ''
        self._load()

    def _load(self):
        if self._tf.exists():
            d = json.loads(self._tf.read_text('utf-8'))
            self.token = d.get('bot_token', '')
            self.bot_id = d.get('ilink_bot_id', '')
            self._buf = d.get('updates_buf', '')

    def _save(self, **kw):
        d = {
            'bot_token': self.token or '',
            'ilink_bot_id': self.bot_id or '',
            'updates_buf': self._buf or '',
            **kw
        }
        self._tf.write_text(json.dumps(d, ensure_ascii=False, indent=2), 'utf-8')

    def _post(self, ep, body, timeout=15):
        data = json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        h = {
            'Content-Type': 'application/json',
            'AuthorizationType': 'ilink_bot_token',
            'Content-Length': str(len(data)),
            'X-WECHAT-UIN': _uin(),
            'iLink-App-Id': ILINK_APP_ID,
            'iLink-App-ClientVersion': str(ILINK_APP_CLIENT_VERSION),
            'User-Agent': UA
        }
        tok = (self.token or '').strip()
        if tok:
            h['Authorization'] = f'Bearer {tok}'
        r = requests.post(f'{API}/{ep}', data=data, headers=h, timeout=timeout, proxies=_NO_PROXY)
        r.raise_for_status()
        return r.json()

    def login_qr(self, poll_interval=2, qr_output_path=None):
        """获取二维码，返回 (qr_id, save_path)。扫码登录后自动保存 token。"""
        # 清理代理环境变量（避免影响微信长轮询 SSL）
        for _k in ('HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'):
            os.environ.pop(_k, None)

        r = requests.get(f'{API}/ilink/bot/get_bot_qrcode',
                         params={'bot_type': 3},
                         headers={'User-Agent': UA},
                         timeout=10,
                         proxies=_NO_PROXY)
        r.raise_for_status()
        d = r.json()
        qr_id = d.get('qrcode', '')
        url = d.get('qrcode_img_content', '')

        print(f'[WX-QR] qr_id={qr_id}', file=sys.__stdout__)

        if not qr_output_path:
            qr_output_path = str(TOKEN_FILE.parent / 'wx_qr.png')

        if url:
            # 保存二维码图片
            qr = qrcode.QRCode(border=1)
            qr.add_data(url)
            qr.make(fit=True)
            img = qr.make_image(fill_color='black', back_color='white')
            img.save(qr_output_path)
            print(f'[WX-QR] 二维码已保存: {qr_output_path}', file=sys.__stdout__)
            # 尝试用浏览器打开
            try:
                webbrowser.open('file://' + os.path.abspath(qr_output_path))
            except:
                pass
            # 终端打印 ASCII 二维码
            try:
                qr2 = qrcode.QRCode(border=1)
                qr2.add_data(url)
                qr2.make(fit=True)
                qr2.print_ascii(invert=True)
            except:
                pass
        else:
            # 如果没有 url，尝试直接用 qr_id 构造
            print(f'[WX-QR] 无 qrcode_img_content，使用 qr_id: {qr_id}', file=sys.__stdout__)

        # 轮询扫码状态
        last = ''
        while True:
            time.sleep(poll_interval)
            try:
                s = requests.get(
                    f'{API}/ilink/bot/get_qrcode_status',
                    params={'qrcode': qr_id},
                    headers={'User-Agent': UA},
                    timeout=60,
                    proxies=_NO_PROXY
                ).json()
            except requests.exceptions.ReadTimeout:
                continue

            st = s.get('status', '')
            if st != last:
                print(f'[WX-QR] 状态: {st}', file=sys.__stdout__)
                last = st

            if st == 'confirmed':
                self.token = s.get('bot_token', '')
                self.bot_id = s.get('ilink_bot_id', '')
                self._save(login_time=time.strftime('%Y-%m-%d %H:%M:%S'))
                print(f'[WX-QR] 登录成功! bot_id={self.bot_id}', file=sys.__stdout__)
                return qr_output_path
            if st == 'expired':
                raise RuntimeError('二维码已过期，请重新获取')

    def get_updates(self, timeout=30):
        """长轮询获取用户消息，返回 msg 列表。"""
        try:
            resp = self._post('ilink/bot/getupdates', {
                'get_updates_buf': self._buf or '',
                'base_info': {'channel_version': VER}
            }, timeout=timeout + 5)
        except requests.exceptions.ReadTimeout:
            return []
        except Exception as e:
            print(f'[WX] get_updates 异常: {e}', file=sys.__stdout__)
            return []

        if resp.get('errcode'):
            print(f'[WX] get_updates err: {resp.get("errcode")} {resp.get("errmsg", "")}',
                  file=sys.__stdout__)
            if resp.get('errcode') == -14:
                self._buf = ''
                self._save()
            return []

        nb = resp.get('get_updates_buf', '')
        if nb:
            self._buf = nb
            self._save()

        return resp.get('msgs') or []

    def send_text(self, to_user_id, text, context_token=''):
        """发送文本消息。"""
        msg = {
            'from_user_id': '',
            'to_user_id': to_user_id,
            'client_id': f'casebuddy-{uuid.uuid4().hex[:16]}',
            'message_type': MSG_BOT,
            'message_state': 2,  # FINISH
            'item_list': [{'type': ITEM_TEXT, 'text_item': {'text': text}}]
        }
        if context_token:
            msg['context_token'] = context_token
        return self._post('ilink/bot/sendmessage', {
            'msg': msg,
            'base_info': {'channel_version': VER}
        })

    def _enc(self, raw, aes_key):
        pad = 16 - (len(raw) % 16)
        return AES.new(aes_key, AES.MODE_ECB).encrypt(raw + bytes([pad] * pad))

    def _upload(self, filekey, upload_param, raw, aes_key, timeout=120, upload_url=''):
        """上传文件到微信 CDN。"""
        url = upload_url.strip() if upload_url else \
            f'{CDN_BASE}/upload?encrypted_query_param={quote(upload_param)}&filekey={filekey}'
        data = self._enc(raw, aes_key)
        last_err = None
        for attempt in range(1, 4):
            try:
                r = requests.post(url, data=data, headers={
                    'Content-Type': 'application/octet-stream',
                    'User-Agent': UA
                }, timeout=timeout, proxies=_NO_PROXY)
                if 400 <= r.status_code < 500:
                    msg = r.headers.get('x-error-message') or r.text[:300]
                    raise RuntimeError(f'CDN upload client error {r.status_code}: {msg}')
                if r.status_code != 200:
                    msg = r.headers.get('x-error-message') or f'status {r.status_code}'
                    raise RuntimeError(f'CDN upload server error: {msg}')
                eq = r.headers.get('x-encrypted-param', '')
                if not eq:
                    raise RuntimeError('CDN upload response missing x-encrypted-param header')
                return {
                    'encrypt_query_param': eq,
                    'aes_key': base64.b64encode(aes_key.hex().encode()).decode(),
                    'encrypt_type': 1
                }
            except Exception as e:
                last_err = e
                if 'client error' in str(e) or attempt >= 3:
                    break
                print(f'[WX] CDN upload retry {attempt}: {e}', file=sys.__stdout__)
        raise last_err

    def _send_media(self, to_user_id, file_path, media_type, item_type, item_key, context_token=''):
        """通用媒体发送（图片/文件/视频）。"""
        fp = Path(file_path)
        raw = fp.read_bytes()
        filekey = uuid.uuid4().hex
        aes_key = os.urandom(16)
        ciphertext_size = ((len(raw) // 16) + 1) * 16
        thumb_raw = b''
        thumb_w = thumb_h = 0
        thumb_ciphertext_size = 0

        if item_key == 'image_item':
            from io import BytesIO
            from PIL import Image
            im = Image.open(fp)
            im.thumbnail((240, 240))
            thumb_w, thumb_h = im.size
            if im.mode not in ('RGB', 'L'):
                im = im.convert('RGB')
            bio = BytesIO()
            im.save(bio, format='JPEG', quality=85)
            thumb_raw = bio.getvalue()
            thumb_ciphertext_size = ((len(thumb_raw) // 16) + 1) * 16

        body = {
            'filekey': filekey,
            'media_type': media_type,
            'to_user_id': to_user_id,
            'rawsize': len(raw),
            'rawfilemd5': hashlib.md5(raw).hexdigest(),
            'filesize': ciphertext_size,
            'noneed_thumb': item_key not in ('image_item', 'video_item'),
            'aeskey': aes_key.hex(),
            'base_info': {'channel_version': VER}
        }
        if thumb_raw:
            body.update({
                'thumb_rawsize': len(thumb_raw),
                'thumb_rawfilemd5': hashlib.md5(thumb_raw).hexdigest(),
                'thumb_filesize': thumb_ciphertext_size
            })

        resp = self._post('ilink/bot/getuploadurl', body)
        upload_param = resp.get('upload_param', '')
        upload_url_resp = resp.get('upload_full_url', '')
        if not (upload_param or upload_url_resp):
            raise RuntimeError(f'getuploadurl failed: {resp}')

        media = self._upload(filekey, upload_param, raw, aes_key=aes_key, upload_url=upload_url_resp)
        item = {'media': media}

        if item_key == 'file_item':
            item.update({'file_name': fp.name, 'len': str(len(raw))})
        elif item_key == 'image_item':
            thumb_param = resp.get('thumb_upload_param', '')
            thumb_url = resp.get('thumb_upload_full_url', '')
            if thumb_param or thumb_url:
                thumb_media = self._upload(filekey, thumb_param, thumb_raw,
                                         aes_key=aes_key, upload_url=thumb_url)
                thumb_size = thumb_ciphertext_size
            else:
                thumb_media = media
                thumb_size = ciphertext_size
            item.update({
                'mid_size': ciphertext_size,
                'thumb_media': thumb_media,
                'thumb_size': thumb_size,
                'thumb_width': thumb_w,
                'thumb_height': thumb_h
            })
        elif item_key == 'video_item':
            item.update({'video_size': ciphertext_size})

        msg = {
            'from_user_id': '',
            'to_user_id': to_user_id,
            'client_id': f'casebuddy-{uuid.uuid4().hex[:16]}',
            'message_type': MSG_BOT,
            'message_state': 2,
            'item_list': [{'type': item_type, item_key: item}]
        }
        if context_token:
            msg['context_token'] = context_token
        return self._post('ilink/bot/sendmessage', {
            'msg': msg,
            'base_info': {'channel_version': VER}
        })

    def send_file(self, to_user_id, file_path, context_token=''):
        return self._send_media(to_user_id, file_path, 3, ITEM_FILE, 'file_item', context_token)

    def send_image(self, to_user_id, file_path, context_token=''):
        return self._send_media(to_user_id, file_path, 1, ITEM_IMAGE, 'image_item', context_token)

    def send_video(self, to_user_id, file_path, context_token=''):
        return self._send_media(to_user_id, file_path, 2, ITEM_VIDEO, 'video_item', context_token)

    @staticmethod
    def extract_text(msg):
        """从 msg 中提取文本内容。"""
        return '\n'.join(
            it['text_item'].get('text', '')
            for it in msg.get('item_list', [])
            if it.get('type') == ITEM_TEXT and it.get('text_item')
        ).strip()

    @staticmethod
    def is_user_msg(msg):
        return msg.get('message_type') == MSG_USER

    @staticmethod
    def extract_file_info(msg):
        """提取消息中的文件信息（支持多种 item type 和下载方式）。
        返回 (file_id, file_name, item_type, download_method) 或 None。
        download_method: 'cdn' (encrypt_query_param + aes_key) 或 'api' (file_id)
        """
        for it in msg.get('item_list', []):
            t = it.get('type')
            # 检查是否有 CDN 加密参数（微信原生文件的主要方式）
            for key, label in [('file_item', 'file'), ('image_item', 'image'), ('video_item', 'video'), ('voice_item', 'voice')]:
                sub = it.get(key)
                if not sub:
                    continue
                media = sub.get('media') or {}
                eq = media.get('encrypt_query_param')
                ak = media.get('aes_key', '') or sub.get('aeskey', '')
                if eq and ak:
                    fname = sub.get('file_name') or f'media_{uuid.uuid4().hex[:8]}'
                    return (eq, fname, label, 'cdn')
                # 兼容 file_id 方式
                fid = sub.get('file_id') or sub.get('image_id') or sub.get('video_id')
                if fid:
                    fname = sub.get('file_name') or f'{label}_{fid[:8]}'
                    return (fid, fname, label, 'api')
        return None

    def download_media(self, msg):
        """下载用户发送的文件/图片，保存到临时目录。返回文件路径或 None。
        支持两种下载方式：
        1. CDN 下载（file_item.media.encrypt_query_param + aes_key）— 微信原生文件
        2. API 下载（file_id）— 兼容旧方式
        """
        try:
            item_list = msg.get('item_list', [])
            print(f'[WX] download_media: item_list types = {[it.get("type") for it in item_list]}', file=sys.__stdout__)
            for it in item_list:
                print(f'[WX]   item type={it.get("type")}, keys={list(it.keys())}', file=sys.__stdout__)
                if it.get('file_item'):
                    import json as _json
                    print(f'[WX]   file_item content: {_json.dumps(it["file_item"], ensure_ascii=False, default=str)[:500]}', file=sys.__stdout__)

            # ── 方式1：CDN 下载（微信原生文件的主要方式） ──
            _MEDIA_KEYS = {
                'image_item': '.jpg',
                'video_item': '.mp4',
                'file_item': '',
                'voice_item': '.silk',
            }
            for it in item_list:
                for key, default_ext in _MEDIA_KEYS.items():
                    sub = it.get(key)
                    if not sub:
                        continue
                    # 优先从 sub.media 获取加密参数
                    media = sub.get('media') or {}
                    eq = media.get('encrypt_query_param')
                    # AES key 可能在 media.aes_key 或顶层 aeskey
                    ak = media.get('aes_key', '') or sub.get('aeskey', '')
                    if not eq or not ak:
                        continue
                    try:
                        # 解析 AES key
                        if media.get('aes_key'):
                            aes_key = bytes.fromhex(base64.b64decode(ak).decode())
                        else:
                            aes_key = bytes.fromhex(ak)
                        # 从 CDN 下载加密文件
                        ct = requests.get(
                            f'{CDN_BASE}/download?encrypted_query_param={quote(eq)}',
                            headers={'User-Agent': UA},
                            proxies=_NO_PROXY,
                            timeout=60
                        ).content
                        # AES-ECB 解密 + 去除 PKCS7 padding
                        pt = AES.new(aes_key, AES.MODE_ECB).decrypt(ct)
                        pt = pt[:-pt[-1]]
                        # 确定文件名
                        fname = sub.get('file_name') or f'{uuid.uuid4().hex[:8]}{default_ext or ".bin"}'
                        temp_dir = Path(__file__).parent.parent / 'temp'
                        temp_dir.mkdir(exist_ok=True)
                        file_path = temp_dir / f'{int(time.time())}_{fname}'
                        with open(file_path, 'wb') as f:
                            f.write(pt)
                        print(f'[WX] CDN下载成功: {fname} ({len(pt)} bytes)', file=sys.__stdout__)
                        return str(file_path)
                    except Exception as e:
                        print(f'[WX] CDN下载失败 ({key}): {e}', file=sys.__stdout__)
                    break  # 每个 item 只处理一次

            # ── 方式2：API 下载（file_id 方式，兼容旧版本） ──
            file_id = None
            file_name = None
            for it in item_list:
                if it.get('type') == ITEM_FILE and it.get('file_item'):
                    file_id = it['file_item'].get('file_id')
                    file_name = it['file_item'].get('file_name', 'file')
                    break
                elif it.get('type') == ITEM_IMAGE and it.get('image_item'):
                    file_id = it['image_item'].get('image_id')
                    file_name = f'image_{file_id}.jpg' if file_id else 'image.jpg'
                    break

            if file_id:
                resp = requests.get(
                    f'{API}/ilink/bot/file/download',
                    params={'file_id': file_id, 'bot_id': self.bot_id},
                    headers={'Authorization': f'Bot {self.token}'},
                    proxies=_NO_PROXY,
                    timeout=30
                )
                if resp.ok:
                    if not file_name:
                        file_name = f'file_{file_id}'
                    content_type = resp.headers.get('Content-Type', '')
                    if 'pdf' in content_type and not file_name.endswith('.pdf'):
                        file_name += '.pdf'
                    temp_dir = Path(__file__).parent.parent / 'temp'
                    temp_dir.mkdir(exist_ok=True)
                    file_path = temp_dir / f'{int(time.time())}_{file_name}'
                    with open(file_path, 'wb') as f:
                        f.write(resp.content)
                    print(f'[WX] API下载成功: {file_name} ({len(resp.content)} bytes)', file=sys.__stdout__)
                    return str(file_path)
                else:
                    print(f'[WX] API下载失败: HTTP {resp.status_code}', file=sys.__stdout__)

            print(f'[WX] 无法下载文件：无 CDN 加密参数且无 file_id', file=sys.__stdout__)
            return None
        except Exception as e:
            print(f'[WX] download_media 异常: {e}', file=sys.__stdout__)
            return None

    def run_loop(self, on_message, poll_timeout=30):
        """主循环：监听用户消息并回调 on_message(bot, msg)。"""
        print(f'[WX] 监听中... (bot_id={self.bot_id})', file=sys.__stdout__)
        seen = set()
        while True:
            try:
                for msg in self.get_updates(poll_timeout):
                    mid = msg.get('message_id', 0)
                    if not self.is_user_msg(msg) or mid in seen:
                        continue
                    seen.add(mid)
                    if len(seen) > 5000:
                        seen = set(list(seen)[-2000:])
                    try:
                        on_message(self, msg)
                    except Exception as e:
                        print(f'[WX] 回调异常: {e}', file=sys.__stdout__)
            except KeyboardInterrupt:
                print('[WX] 退出', file=sys.__stdout__)
                break
            except Exception as e:
                print(f'[WX] 异常: {e}，5s重试', file=sys.__stdout__)
                time.sleep(5)


# ── Flask HTTP 封装 ───────────────────────────────────────────────────────────
from flask import Flask, request, send_file, jsonify
import tempfile, io

app = Flask(__name__)
_bot_instance = None
_loop_thread = None


def get_bot():
    global _bot_instance
    if _bot_instance is None:
        _bot_instance = WxBotClient()
    return _bot_instance


@app.route('/status')
def http_status():
    bot = get_bot()
    return jsonify({
        'status': 'logged_in' if bot.token else 'not_logged_in',
        'bot_id': bot.bot_id or '',
        'has_token': bool(bot.token)
    })


@app.route('/login_qr', methods=['POST'])
def http_login_qr():
    """触发二维码登录，返回二维码图片路径。"""
    global _bot_instance
    bot = WxBotClient()
    try:
        qr_path = bot.login_qr()
        _bot_instance = bot
        return jsonify({
            'status': 'waiting_scan',
            'qr_path': qr_path,
            'bot_id': bot.bot_id or '',
            'message': '请用微信扫描二维码'
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/qrcode')
def http_qrcode():
    """返回二维码图片（PNG）。"""
    bot = get_bot()
    qr_path = str(TOKEN_FILE.parent / 'wx_qr.png')
    if os.path.exists(qr_path):
        return send_file(qr_path, mimetype='image/png')
    return jsonify({'status': 'no_qrcode', 'message': '暂无二维码'}), 404


@app.route('/send_text', methods=['POST'])
def http_send_text():
    bot = get_bot()
    if not bot.token:
        return jsonify({'status': 'error', 'message': '未登录'}), 401
    data = request.json or {}
    to = data.get('to_user_id', '')
    text = data.get('text', '')
    if not to or not text:
        return jsonify({'status': 'error', 'message': '缺少参数'}), 400
    try:
        bot.send_text(to, text)
        return jsonify({'status': 'ok'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/messages')
def http_messages():
    """拉取最新消息（供 Node.js 后端轮询）。"""
    bot = get_bot()
    if not bot.token:
        return jsonify({'status': 'error', 'message': '未登录'}), 401
    try:
        msgs = bot.get_updates(timeout=10)
        return jsonify({'status': 'ok', 'messages': msgs})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


def start_flask(host='127.0.0.1', port=3002):
    app.run(host=host, port=port, debug=False, use_reloader=False)


if __name__ == '__main__':
    print('=== CaseBuddy 微信 Bot (iLink API) ===')
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3002
    start_flask(port=port)
