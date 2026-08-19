# 英文听写工具 (dictation)

一个本地运行的英文听写练习工具：点击开始 → 预缓存所有单词的发音 → 逐词听写 → 自评 → 提交后更新掌握状态并同步到 GitHub。

- 语音：Microsoft Edge 免费神经语音（英文 `en-US-JennyNeural` / 中文 `zh-CN-XiaoxiaoNeural`），经本地 `server.py` 代理合成。
- 词库：保存在 `data/words.json`，每次提交结果自动 `git push` 回本仓库，清除浏览器缓存也不丢。

## 目录结构

```
dictation/
├── server.py        # 单端口后端：同时托管页面 + 提供 /api/tts、/api/words
├── index.html       # 页面
├── style.css
├── app.js
├── data/words.json  # 词库（自动同步到 GitHub）
└── README.md
```

## 本地运行（Mac）

需要 Python 3 与 `edge_tts`：

```bash
pip install edge_tts
```

启动（一条命令即可，无需再开静态服务器）：

```bash
cd /Users/suncuinong/Documents/Workspace/Yoyo/dictation
python3 server.py
```

启动后终端会打印访问地址，默认端口 `8787`：

- 本机：   http://localhost:8787/dictation/
- 局域网： http://<本机IP>:8787/dictation/   （同 WiFi 下的 iPad 访问）

修改端口：`PORT=9000 python3 server.py`

## 在 iPad 上使用（家里同一 WiFi）

1. Mac 上先按上面启动 `server.py`。
2. 查 Mac 的局域网 IP：
   ```bash
   ipconfig getifaddr en0
   ```
   得到类似 `192.168.1.23`。
3. iPad 用 Safari 打开：
   ```
   http://192.168.1.23:8787/dictation/
   ```
   （把 IP 换成你 Mac 实际的地址）

iPad 上即可使用自然 Edge 语音，且提交结果会同步回 GitHub。

> 首次在 iPad 新地址打开时，建议清一下该站点网站数据（iOS 设置 → Safari → 高级 → 网站数据），避免旧 localStorage 覆盖 GitHub 上的词库。

## 让 Mac 待机/合盖也能连

默认睡眠或合盖会断网，导致 iPad 连不上。保持可连的方式：

- 听写时让 Mac 不睡眠，用 `caffeinate` 启动后端：
  ```bash
  caffeinate -ims python3 server.py
  ```
  （该进程在运行时 Mac 不会睡眠）
- 或安装免费 App **Amphetamine**，设置「合盖保持运行 / 在网络访问时保持唤醒」。
- 系统设置 → 电池/节能 中勾选「唤醒以供网络访问」。

## 词库管理

- 首页可设置每次听写数量、语速、重复次数、词间间隔。
- 题库页可查看每个单词状态（新学/错误/已掌握）和听写记录（🟢 对 / 🔴 错 的序列），也可导入新词。
- 直接编辑 `data/words.json` 后重启 `server.py` 生效；前端提交的改动会自动写回并推送到 GitHub。

## 部署说明

当前方案为本地/局域网运行，后端依赖本地 Python 与可访问微软 TTS 接口的网络。
若需「随时随地（如出门在外）在 iPad 上访问」，需将后端部署到常驻服务器或云函数，
或将项目改为纯静态（浏览器原生语音）托管到 GitHub Pages。当前仓库未做此类部署。
