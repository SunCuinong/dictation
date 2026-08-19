#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
英文听写工具 - 极简后端
提供两个能力：
  1) /api/tts  -> 调用 Microsoft Edge 免费神经语音 (edge_tts) 合成音频，返回 mp3
  2) /api/words -> 读写词库 JSON，保存到仓库 data/words.json 并自动 git 提交&推送

运行:  python3 server.py  (默认端口 8787)
依赖:  pip install edge_tts
"""
import os
import json
import subprocess
import asyncio
import functools

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import edge_tts

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
WORDS_FILE = os.path.join(DATA_DIR, "words.json")

# 语音音色：英文 / 中文
VOICE_EN = "en-US-JennyNeural"
VOICE_ZH = "zh-CN-XiaoxiaoNeural"

PORT = int(os.environ.get("PORT", "8787"))

os.makedirs(DATA_DIR, exist_ok=True)


def ensure_words_file():
    if not os.path.exists(WORDS_FILE):
        # 与前端内置词库保持一致
        builtin = [
            ["apple", "苹果"], ["banana", "香蕉"], ["cat", "猫"], ["dog", "狗"],
            ["book", "书"], ["water", "水"], ["school", "学校"], ["teacher", "老师"],
            ["student", "学生"], ["friend", "朋友"], ["family", "家庭"], ["happy", "开心的"],
            ["red", "红色"], ["blue", "蓝色"], ["green", "绿色"], ["yellow", "黄色"],
            ["morning", "早晨"], ["evening", "晚上"], ["today", "今天"], ["tomorrow", "明天"],
            ["computer", "电脑"], ["music", "音乐"], ["sport", "运动"], ["food", "食物"],
            ["animal", "动物"], ["plant", "植物"], ["weather", "天气"], ["travel", "旅行"],
            ["language", "语言"], ["science", "科学"], ["history", "历史"], ["math", "数学"],
            ["english", "英语"], ["chinese", "中文"], ["write", "写"], ["read", "读"],
            ["listen", "听"], ["speak", "说"], ["learn", "学习"], ["remember", "记住"],
        ]
        data = [{"en": e, "cn": c, "status": "new", "streak": 0, "wrongCount": 0} for e, c in builtin]
        with open(WORDS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)


def load_words():
    ensure_words_file()
    with open(WORDS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_words_and_push(data):
    with open(WORDS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    # 异步 git 提交并推送（失败不影响接口返回）
    try:
        subprocess.run(["git", "add", "data/words.json"],
                       cwd=BASE_DIR, check=True)
        subprocess.run(["git", "commit", "-m", "chore: sync words data"],
                       cwd=BASE_DIR, check=True,
                       stderr=subprocess.DEVNULL)
        # 推送到本仓库的 origin（即 dictation 仓库自身）
        try:
            subprocess.run(["git", "push", "origin", "main"],
                           cwd=BASE_DIR, check=True,
                           stderr=subprocess.DEVNULL, timeout=20)
        except Exception:
            pass
    except Exception:
        pass


async def synthesize(text, voice, rate):
    # rate 形如 +0%、-20%、+20%
    comm = edge_tts.Communicate(text, voice, rate=rate)
    audio = bytearray()
    async for chunk in comm.stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
    return bytes(audio)


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_audio(self, data):
        self.send_response(200)
        self.send_header("Content-Type", "audio/mpeg")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/tts":
            qs = parse_qs(parsed.query)
            text = qs.get("text", [""])[0]
            lang = qs.get("lang", ["en"])[0]
            # rate: 前端传 0.8/1/1.2 -> edge_tts 百分比
            try:
                rate_v = float(qs.get("rate", ["1"])[0])
            except ValueError:
                rate_v = 1.0
            pct = int(round((rate_v - 1.0) * 100))
            rate = ("+" if pct >= 0 else "") + str(pct) + "%"
            voice = VOICE_EN if lang == "en" else VOICE_ZH
            if not text:
                self._send_json({"error": "empty text"}, 400)
                return
            try:
                audio = asyncio.run(synthesize(text, voice, rate))
                self._send_audio(audio)
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
            return
        if parsed.path == "/api/words":
            try:
                self._send_json({"words": load_words()})
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
            return
        self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/words":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                raw = self.rfile.read(length) if length else b"{}"
                payload = json.loads(raw.decode("utf-8"))
                words = payload.get("words")
                if not isinstance(words, list):
                    self._send_json({"error": "words must be array"}, 400)
                    return
                save_words_and_push(words)
                self._send_json({"ok": True, "count": len(words)})
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
            return
        self._send_json({"error": "not found"}, 404)

    def log_message(self, fmt, *args):
        pass  # 静默


def main():
    ensure_words_file()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"dictation server running at http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
