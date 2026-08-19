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
from urllib.parse import urlparse, parse_qs

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer, SimpleHTTPRequestHandler

import edge_tts

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
WORDS_FILE = os.path.join(DATA_DIR, "words.json")
# 静态文件根目录：本目录（外部通过 /dictation/ 访问）
STATIC_DIR = BASE_DIR

# 语音音色：英文 / 中文
VOICE_EN = "en-US-JennyNeural"
VOICE_ZH = "zh-CN-XiaoxiaoNeural"

PORT = int(os.environ.get("PORT", "8787"))

os.makedirs(DATA_DIR, exist_ok=True)


def ensure_words_file():
    if not os.path.exists(WORDS_FILE):
        # 与前端内置词库/words.json 保持一致（KET 核心实词）
        builtin = [
            ["apple", "苹果"], ["banana", "香蕉"], ["orange", "橘子"], ["grape", "葡萄"], ["water", "水"], ["bread", "面包"], ["cheese", "奶酪"], ["egg", "鸡蛋"], ["rice", "米饭"], ["meat", "肉"],
            ["fish", "鱼"], ["chicken", "鸡肉"], ["soup", "汤"], ["salt", "盐"], ["sugar", "糖"], ["coffee", "咖啡"], ["tea", "茶"], ["milk", "牛奶"], ["juice", "果汁"], ["cake", "蛋糕"],
            ["book", "书"], ["pen", "钢笔"], ["pencil", "铅笔"], ["paper", "纸"], ["bag", "包"], ["box", "盒子"], ["key", "钥匙"], ["door", "门"], ["window", "窗户"], ["floor", "地板"],
            ["school", "学校"], ["teacher", "老师"], ["student", "学生"], ["class", "班级"], ["lesson", "课"], ["homework", "家庭作业"], ["exam", "考试"], ["test", "测验"], ["library", "图书馆"], ["friend", "朋友"],
            ["family", "家庭"], ["father", "父亲"], ["mother", "母亲"], ["brother", "兄弟"], ["sister", "姐妹"], ["parent", "父母"], ["child", "孩子"], ["baby", "婴儿"], ["grandmother", "祖母"], ["grandfather", "祖父"],
            ["home", "家"], ["room", "房间"], ["kitchen", "厨房"], ["garden", "花园"], ["bed", "床"], ["chair", "椅子"], ["table", "桌子"], ["computer", "电脑"], ["phone", "电话"], ["television", "电视"],
            ["cat", "猫"], ["dog", "狗"], ["bird", "鸟"], ["animal", "动物"], ["plant", "植物"], ["tree", "树"], ["flower", "花"], ["grass", "草"], ["horse", "马"], ["farm", "农场"],
            ["city", "城市"], ["town", "城镇"], ["street", "街道"], ["park", "公园"], ["shop", "商店"], ["market", "市场"], ["bank", "银行"], ["post", "邮政"], ["hospital", "医院"], ["station", "车站"],
            ["car", "汽车"], ["bus", "公交车"], ["train", "火车"], ["bike", "自行车"], ["boat", "船"], ["plane", "飞机"], ["taxi", "出租车"], ["road", "道路"], ["travel", "旅行"], ["holiday", "假期"],
            ["morning", "早晨"], ["evening", "晚上"], ["today", "今天"], ["tomorrow", "明天"], ["yesterday", "昨天"], ["week", "周"], ["month", "月"], ["year", "年"], ["time", "时间"], ["hour", "小时"],
            ["red", "红色"], ["blue", "蓝色"], ["green", "绿色"], ["yellow", "黄色"], ["black", "黑色"], ["white", "白色"], ["brown", "棕色"], ["colour", "颜色"], ["size", "尺寸"], ["number", "数字"],
            ["happy", "开心的"], ["sad", "伤心的"], ["tired", "累的"], ["angry", "生气的"], ["hungry", "饥饿的"], ["thirsty", "口渴的"], ["busy", "忙碌的"], ["free", "空闲的"], ["ill", "生病的"], ["well", "健康的"],
            ["big", "大的"], ["small", "小的"], ["long", "长的"], ["short", "短的"], ["new", "新的"], ["old", "旧的"], ["hot", "热的"], ["cold", "冷的"], ["clean", "干净的"], ["dirty", "脏的"],
            ["good", "好的"], ["bad", "坏的"], ["fast", "快的"], ["slow", "慢的"], ["easy", "容易的"], ["difficult", "困难的"], ["early", "早的"], ["late", "晚的"], ["rich", "富有的"], ["poor", "贫穷的"],
            ["beautiful", "美丽的"], ["important", "重要的"], ["interesting", "有趣的"], ["famous", "著名的"], ["young", "年轻的"], ["strong", "强壮的"], ["weak", "弱的"], ["open", "开着的"], ["closed", "关着的"], ["ready", "准备好的"],
            ["write", "写"], ["read", "读"], ["listen", "听"], ["speak", "说"], ["learn", "学习"], ["remember", "记住"], ["understand", "理解"], ["think", "思考"], ["know", "知道"], ["forget", "忘记"],
            ["like", "喜欢"], ["love", "爱"], ["want", "想要"], ["need", "需要"], ["help", "帮助"], ["find", "找到"], ["lose", "丢失"], ["make", "制作"], ["do", "做"], ["use", "使用"],
            ["eat", "吃"], ["drink", "喝"], ["cook", "烹饪"], ["buy", "买"], ["sell", "卖"], ["pay", "付款"], ["give", "给"], ["take", "拿"], ["bring", "带来"], ["send", "发送"],
            ["go", "去"], ["come", "来"], ["walk", "走"], ["run", "跑"], ["swim", "游泳"], ["ride", "骑"], ["drive", "驾驶"], ["fly", "飞"], ["leave", "离开"], ["arrive", "到达"],
            ["see", "看见"], ["look", "看"], ["watch", "观看"], ["hear", "听见"], ["smell", "闻"], ["taste", "尝"], ["feel", "感觉"], ["touch", "触摸"], ["say", "说"], ["tell", "告诉"],
            ["start", "开始"], ["stop", "停止"], ["finish", "完成"], ["wait", "等待"], ["meet", "遇见"], ["call", "打电话"], ["ask", "问"], ["answer", "回答"], ["show", "展示"], ["teach", "教"],
            ["play", "玩"], ["work", "工作"], ["study", "学习"], ["sing", "唱歌"], ["dance", "跳舞"], ["draw", "画"], ["count", "数"], ["win", "赢"], ["lose", "输"], ["try", "尝试"],
            ["weather", "天气"], ["sun", "太阳"], ["rain", "雨"], ["snow", "雪"], ["wind", "风"], ["cloud", "云"], ["sky", "天空"], ["mountain", "山"], ["river", "河"], ["sea", "海"],
            ["language", "语言"], ["english", "英语"], ["chinese", "中文"], ["word", "单词"], ["sentence", "句子"], ["letter", "字母"], ["music", "音乐"], ["song", "歌"], ["game", "游戏"], ["sport", "运动"],
            ["football", "足球"], ["basketball", "篮球"], ["tennis", "网球"], ["swimming", "游泳"], ["science", "科学"], ["history", "历史"], ["math", "数学"], ["art", "美术"], ["geography", "地理"], ["PE", "体育"],
            ["food", "食物"], ["fruit", "水果"], ["vegetable", "蔬菜"], ["breakfast", "早餐"], ["lunch", "午餐"], ["dinner", "晚餐"], ["meal", "一顿饭"], ["restaurant", "餐馆"], ["menu", "菜单"], ["plate", "盘子"],
            ["clothes", "衣服"], ["shirt", "衬衫"], ["dress", "连衣裙"], ["shoe", "鞋"], ["hat", "帽子"], ["coat", "外套"], ["sock", "袜子"], ["pocket", "口袋"], ["wear", "穿"], ["put", "放"],
            ["head", "头"], ["face", "脸"], ["eye", "眼睛"], ["ear", "耳朵"], ["nose", "鼻子"], ["mouth", "嘴"], ["hand", "手"], ["foot", "脚"], ["arm", "手臂"], ["leg", "腿"],
            ["body", "身体"], ["hair", "头发"], ["tooth", "牙齿"], ["heart", "心脏"], ["health", "健康"], ["medicine", "药"], ["doctor", "医生"], ["toothbrush", "牙刷"], ["wash", "洗"], ["brush", "刷"],
            ["name", "名字"], ["people", "人们"], ["person", "人"], ["man", "男人"], ["woman", "女人"], ["boy", "男孩"], ["girl", "女孩"], ["group", "组"], ["team", "队"], ["world", "世界"],
            ["country", "国家"], ["money", "钱"], ["price", "价格"], ["ticket", "票"], ["gift", "礼物"], ["card", "卡片"], ["email", "电子邮件"], ["message", "信息"], ["question", "问题"], ["problem", "难题"],
            ["idea", "主意"], ["reason", "原因"], ["example", "例子"], ["rule", "规则"], ["end", "结束"], ["begin", "开始"], ["change", "改变"], ["hope", "希望"],
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


_TTS_CACHE = {}  # key -> bytes，避免重复合成

async def synthesize(text, voice, rate):
    key = f"{voice}|{rate}|{text}"
    if key in _TTS_CACHE:
        return _TTS_CACHE[key]
    comm = edge_tts.Communicate(text, voice, rate=rate)
    audio = bytearray()
    async for chunk in comm.stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
    data = bytes(audio)
    _TTS_CACHE[key] = data
    return data


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

    def _serve_static(self):
        # 仅允许 /dictation/ 前缀，避免暴露仓库其他文件
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/" or path == "":
            path = "/dictation/index.html"
        if not path.startswith("/dictation/"):
            self._send_json({"error": "not found"}, 404)
            return
        # 去掉 /dictation/ 前缀，映射到 STATIC_DIR
        rel = path[len("/dictation/"):]
        if rel == "" or rel.endswith("/"):
            rel = rel + "index.html"
        # 防目录穿越
        rel = rel.replace("\\", "/")
        safe = os.path.normpath(rel)
        if safe.startswith("..") or os.path.isabs(safe):
            self._send_json({"error": "forbidden"}, 403)
            return
        fpath = os.path.join(STATIC_DIR, safe)
        if not os.path.isfile(fpath):
            self._send_json({"error": "not found"}, 404)
            return
        # 简单 MIME
        ext = os.path.splitext(fpath)[1].lower()
        mime = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
        }.get(ext, "application/octet-stream")
        try:
            with open(fpath, "rb") as f:
                data = f.read()
        except Exception:
            self._send_json({"error": "read error"}, 500)
            return
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self._handle_api_get(parsed)
            return
        self._serve_static()

    def _handle_api_get(self, parsed):
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
    print(f"dictation server running")
    print(f"  本机:    http://localhost:{PORT}/dictation/")
    print(f"  局域网:  http://<本机IP>:{PORT}/dictation/   (iPad 同 WiFi 访问)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
