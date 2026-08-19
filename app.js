'use strict';

/* ============ 存储层（后端云同步 + 本地回退） ============ */
const API_BASE = location.protocol === 'http:' || location.protocol === 'https:'
  ? (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? `http://${location.hostname}:8787` : '')   // 同域部署时留空走相对路径
  : '';
const STORE_KEY = 'dictation_words_local_fallback';

// 单词数据结构:
// { id, en, cn, status: 'new'|'wrong'|'learned', streak: 连对次数, wrongCount: 累计错次 }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// 从云端拉取；失败则回退 localStorage；都没有则用内置
async function loadWords() {
  try {
    const res = await fetch(API_BASE + '/api/words', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.words)) return data.words;
    }
  } catch (e) { /* 后端不可用时回退 */ }
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return null;
}
// 保存到云端；同时写一份本地回退
function saveWordsRemote(list) {
  words = list;
  _dirty = true;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch (e) {}
  // 异步推送，不阻塞 UI
  fetch(API_BASE + '/api/words', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ words: list })
  }).catch(() => {});
}

const BUILTIN = [
  ['apple', '苹果'], ['banana', '香蕉'], ['orange', '橘子'], ['grape', '葡萄'], ['water', '水'], ['bread', '面包'], ['cheese', '奶酪'], ['egg', '鸡蛋'], ['rice', '米饭'], ['meat', '肉'],
  ['fish', '鱼'], ['chicken', '鸡肉'], ['soup', '汤'], ['salt', '盐'], ['sugar', '糖'], ['coffee', '咖啡'], ['tea', '茶'], ['milk', '牛奶'], ['juice', '果汁'], ['cake', '蛋糕'],
  ['book', '书'], ['pen', '钢笔'], ['pencil', '铅笔'], ['paper', '纸'], ['bag', '包'], ['box', '盒子'], ['key', '钥匙'], ['door', '门'], ['window', '窗户'], ['floor', '地板'],
  ['school', '学校'], ['teacher', '老师'], ['student', '学生'], ['class', '班级'], ['lesson', '课'], ['homework', '家庭作业'], ['exam', '考试'], ['test', '测验'], ['library', '图书馆'], ['friend', '朋友'],
  ['family', '家庭'], ['father', '父亲'], ['mother', '母亲'], ['brother', '兄弟'], ['sister', '姐妹'], ['parent', '父母'], ['child', '孩子'], ['baby', '婴儿'], ['grandmother', '祖母'], ['grandfather', '祖父'],
  ['home', '家'], ['room', '房间'], ['kitchen', '厨房'], ['garden', '花园'], ['bed', '床'], ['chair', '椅子'], ['table', '桌子'], ['computer', '电脑'], ['phone', '电话'], ['television', '电视'],
  ['cat', '猫'], ['dog', '狗'], ['bird', '鸟'], ['animal', '动物'], ['plant', '植物'], ['tree', '树'], ['flower', '花'], ['grass', '草'], ['horse', '马'], ['farm', '农场'],
  ['city', '城市'], ['town', '城镇'], ['street', '街道'], ['park', '公园'], ['shop', '商店'], ['market', '市场'], ['bank', '银行'], ['post', '邮政'], ['hospital', '医院'], ['station', '车站'],
  ['car', '汽车'], ['bus', '公交车'], ['train', '火车'], ['bike', '自行车'], ['boat', '船'], ['plane', '飞机'], ['taxi', '出租车'], ['road', '道路'], ['travel', '旅行'], ['holiday', '假期'],
  ['morning', '早晨'], ['evening', '晚上'], ['today', '今天'], ['tomorrow', '明天'], ['yesterday', '昨天'], ['week', '周'], ['month', '月'], ['year', '年'], ['time', '时间'], ['hour', '小时'],
  ['red', '红色'], ['blue', '蓝色'], ['green', '绿色'], ['yellow', '黄色'], ['black', '黑色'], ['white', '白色'], ['brown', '棕色'], ['colour', '颜色'], ['size', '尺寸'], ['number', '数字'],
  ['happy', '开心的'], ['sad', '伤心的'], ['tired', '累的'], ['angry', '生气的'], ['hungry', '饥饿的'], ['thirsty', '口渴的'], ['busy', '忙碌的'], ['free', '空闲的'], ['ill', '生病的'], ['well', '健康的'],
  ['big', '大的'], ['small', '小的'], ['long', '长的'], ['short', '短的'], ['new', '新的'], ['old', '旧的'], ['hot', '热的'], ['cold', '冷的'], ['clean', '干净的'], ['dirty', '脏的'],
  ['good', '好的'], ['bad', '坏的'], ['fast', '快的'], ['slow', '慢的'], ['easy', '容易的'], ['difficult', '困难的'], ['early', '早的'], ['late', '晚的'], ['rich', '富有的'], ['poor', '贫穷的'],
  ['beautiful', '美丽的'], ['important', '重要的'], ['interesting', '有趣的'], ['famous', '著名的'], ['young', '年轻的'], ['strong', '强壮的'], ['weak', '弱的'], ['open', '开着的'], ['closed', '关着的'], ['ready', '准备好的'],
  ['write', '写'], ['read', '读'], ['listen', '听'], ['speak', '说'], ['learn', '学习'], ['remember', '记住'], ['understand', '理解'], ['think', '思考'], ['know', '知道'], ['forget', '忘记'],
  ['like', '喜欢'], ['love', '爱'], ['want', '想要'], ['need', '需要'], ['help', '帮助'], ['find', '找到'], ['lose', '丢失'], ['make', '制作'], ['do', '做'], ['use', '使用'],
  ['eat', '吃'], ['drink', '喝'], ['cook', '烹饪'], ['buy', '买'], ['sell', '卖'], ['pay', '付款'], ['give', '给'], ['take', '拿'], ['bring', '带来'], ['send', '发送'],
  ['go', '去'], ['come', '来'], ['walk', '走'], ['run', '跑'], ['swim', '游泳'], ['ride', '骑'], ['drive', '驾驶'], ['fly', '飞'], ['leave', '离开'], ['arrive', '到达'],
  ['see', '看见'], ['look', '看'], ['watch', '观看'], ['hear', '听见'], ['smell', '闻'], ['taste', '尝'], ['feel', '感觉'], ['touch', '触摸'], ['say', '说'], ['tell', '告诉'],
  ['start', '开始'], ['stop', '停止'], ['finish', '完成'], ['wait', '等待'], ['meet', '遇见'], ['call', '打电话'], ['ask', '问'], ['answer', '回答'], ['show', '展示'], ['teach', '教'],
  ['play', '玩'], ['work', '工作'], ['study', '学习'], ['sing', '唱歌'], ['dance', '跳舞'], ['draw', '画'], ['count', '数'], ['win', '赢'], ['lose', '输'], ['try', '尝试'],
  ['weather', '天气'], ['sun', '太阳'], ['rain', '雨'], ['snow', '雪'], ['wind', '风'], ['cloud', '云'], ['sky', '天空'], ['mountain', '山'], ['river', '河'], ['sea', '海'],
  ['language', '语言'], ['english', '英语'], ['chinese', '中文'], ['word', '单词'], ['sentence', '句子'], ['letter', '字母'], ['music', '音乐'], ['song', '歌'], ['game', '游戏'], ['sport', '运动'],
  ['football', '足球'], ['basketball', '篮球'], ['tennis', '网球'], ['swimming', '游泳'], ['science', '科学'], ['history', '历史'], ['math', '数学'], ['art', '美术'], ['geography', '地理'], ['PE', '体育'],
  ['food', '食物'], ['fruit', '水果'], ['vegetable', '蔬菜'], ['breakfast', '早餐'], ['lunch', '午餐'], ['dinner', '晚餐'], ['meal', '一顿饭'], ['restaurant', '餐馆'], ['menu', '菜单'], ['plate', '盘子'],
  ['clothes', '衣服'], ['shirt', '衬衫'], ['dress', '连衣裙'], ['shoe', '鞋'], ['hat', '帽子'], ['coat', '外套'], ['sock', '袜子'], ['pocket', '口袋'], ['wear', '穿'], ['put', '放'],
  ['head', '头'], ['face', '脸'], ['eye', '眼睛'], ['ear', '耳朵'], ['nose', '鼻子'], ['mouth', '嘴'], ['hand', '手'], ['foot', '脚'], ['arm', '手臂'], ['leg', '腿'],
  ['body', '身体'], ['hair', '头发'], ['tooth', '牙齿'], ['heart', '心脏'], ['health', '健康'], ['medicine', '药'], ['doctor', '医生'], ['toothbrush', '牙刷'], ['wash', '洗'], ['brush', '刷'],
  ['name', '名字'], ['people', '人们'], ['person', '人'], ['man', '男人'], ['woman', '女人'], ['boy', '男孩'], ['girl', '女孩'], ['group', '组'], ['team', '队'], ['world', '世界'],
  ['country', '国家'], ['money', '钱'], ['price', '价格'], ['ticket', '票'], ['gift', '礼物'], ['card', '卡片'], ['email', '电子邮件'], ['message', '信息'], ['question', '问题'], ['problem', '难题'],
  ['idea', '主意'], ['reason', '原因'], ['example', '例子'], ['rule', '规则'], ['end', '结束'], ['begin', '开始'], ['change', '改变'], ['hope', '希望'],
];

let words = [];
let _initialized = false; // 云端加载是否完成
let _dirty = false;       // 用户是否已做过修改（防止异步加载覆盖）
function normalizeWord(w) {
  if (!w.id) w.id = uid();
  if (!Array.isArray(w.history)) w.history = [];
  if (typeof w.streak !== 'number') w.streak = 0;
  if (typeof w.wrongCount !== 'number') w.wrongCount = 0;
  if (!w.status) w.status = 'new';
  return w;
}
(async function initWords() {
  const loaded = await loadWords();
  // 若用户已在加载完成前改过词库，则保留其改动，不被旧快照覆盖
  if (_dirty) return;
  words = (loaded && loaded.length
    ? loaded
    : BUILTIN.map(([en, cn]) => ({ en, cn, status: 'new', streak: 0, wrongCount: 0, history: [] })))
    .map(normalizeWord);
  _initialized = true;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(words)); } catch (e) {}
  renderHome();
  renderDict();
  updateSetupInfo();
})();

/* ============ TTS（后端 Edge 神经语音，失败回退浏览器） ============ */
let voices = [];
function loadVoices() { voices = window.speechSynthesis.getVoices(); }
if ('speechSynthesis' in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}
function pickVoice(lang) {
  return voices.find(v => v.lang && v.lang.toLowerCase().startsWith(lang)) || null;
}

// 音频缓存：text+lang+rate -> blobUrl，避免重复请求/合成
const _audioCache = {};
function fetchAudio(text, lang, rate) {
  const key = `${lang}|${rate}|${text}`;
  if (_audioCache[key]) return Promise.resolve(_audioCache[key]);
  const url = `${API_BASE}/api/tts?text=${encodeURIComponent(text)}&lang=${lang}&rate=${rate}`;
  return fetch(url)
    .then(r => { if (!r.ok) throw new Error('tts failed'); return r.blob(); })
    .then(blob => {
      const u = URL.createObjectURL(blob);
      _audioCache[key] = u;
      return u;
    });
}
function playUrl(url) {
  return new Promise((resolve) => {
    const a = new Audio(url);
    a.onended = () => resolve(true);
    a.onerror = () => resolve(false);
    a.play().catch(() => resolve(false));
  });
}
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// 播放单个词（已缓存）：英文×repeat -> 中文×1 -> 词间停顿 gap
async function playWordAudio(enUrl, zhUrl, repeat, gap) {
  for (let i = 0; i < Math.max(1, repeat); i++) await playUrl(enUrl);
  await playUrl(zhUrl);
  if (gap > 0) await wait(gap);
}

/* ============ 听写清单生成 ============ */
function buildSession(count) {
  // 按词库当前顺序从头取：优先错词，其次新词，最后已掌握（各组内均保持原顺序）
  const wrong = words.filter(w => w.status === 'wrong');
  const fresh = words.filter(w => w.status === 'new');
  const learned = words.filter(w => w.status === 'learned');
  const pool = [];
  wrong.forEach(w => pool.push(w));
  fresh.forEach(w => pool.push(w));
  learned.forEach(w => { if (pool.length < count) pool.push(w); });
  // 记录原始状态用于汇总判断
  return pool.slice(0, count).map(w => ({ id: w.id, firstStatus: w.status }));
}

/* ============ 状态更新（提交时调用，记录听写历史） ============ */
function applyResult(id, ok) {
  const w = words.find(x => x.id === id);
  if (!w) return;
  w.history.push(ok);            // 追加本次结果到历史
  if (ok) {
    if (w.status === 'new') { w.status = 'learned'; w.streak = 1; }
    else if (w.status === 'wrong') {
      w.streak += 1;
      if (w.streak >= 3) w.status = 'learned';
    }
  } else {
    w.status = 'wrong';
    w.streak = 0;
    w.wrongCount += 1;
  }
  saveWordsRemote(words);
}

/* ============ DOM ============ */
const $ = sel => document.querySelector(sel);
const homeView = $('#homeView');
const listenView = $('#listenView');
const dictView = $('#dictView');

function showView(v) {
  homeView.hidden = v !== 'home';
  listenView.hidden = v !== 'listen';
  dictView.hidden = v !== 'dict';
}

/* ============ 导航 ============ */
$('#homeListenBtn').addEventListener('click', () => { showView('listen'); startSession(); });
$('#homeDictBtn').addEventListener('click', () => { renderDict(); showView('dict'); });
$('#dictBackBtn').addEventListener('click', () => { renderHome(); showView('home'); });

/* ============ 首页 ============ */
function renderHome() {
  const total = words.length;
  const fresh = words.filter(w => w.status === 'new').length;
  const wrong = words.filter(w => w.status === 'wrong').length;
  const learned = words.filter(w => w.status === 'learned').length;
  $('#homeStats').innerHTML = `
    <div class="stat"><div class="n">${total}</div><div class="l">总词数</div></div>
    <div class="stat"><div class="n">${fresh}</div><div class="l">未听写</div></div>
    <div class="stat warn"><div class="n">${wrong}</div><div class="l">错词待巩固</div></div>
    <div class="stat"><div class="n">${learned}</div><div class="l">已掌握</div></div>`;
}

/* ============ 听写流程 ============ */
let session = null; // { items:[{id,firstStatus,audio:{enUrl,zhUrl}}], idx, rate, repeat, gap, graded:{} }
let current = null;

function updateSetupInfo() {
  const wrong = words.filter(w => w.status === 'wrong').length;
  const fresh = words.filter(w => w.status === 'new').length;
  const total = words.length;
  $('#setupInfo').textContent =
    `词库共 ${total} 词：未听写 ${fresh} 个，错词待巩固 ${wrong} 个。本次将优先抽取错词，不足部分用新词补足。`;
}

// 开始：读设置 -> 预缓存全部音频 -> 进入听写
async function startSession() {
  const count = Math.max(1, parseInt($('#countInput').value, 10) || 30);
  const rate = parseFloat($('#speedSelect').value);
  const repeat = parseInt($('#repeatSelect').value, 10);
  const gap = parseInt($('#gapSelect').value, 10);
  const items = buildSession(count);
  if (items.length === 0) { alert('词库为空，请先到「题库」添加单词。'); return; }

  // 显示加载
  $('#loadingPanel').hidden = false;
  $('#sessionPanel').hidden = true;
  $('#answerPanel').hidden = true;
  $('#loadingProgress').textContent = `0 / ${items.length}`;
  $('#loadingFill').style.width = '0%';

  // 并发预缓存每个词的 英文 + 中文 音频
  let done = 0;
  await Promise.all(items.map(async (item) => {
    const w = words.find(x => x.id === item.id);
    try {
      const [enUrl, zhUrl] = await Promise.all([
        fetchAudio(w.en, 'en', rate),
        fetchAudio(w.cn, 'zh', rate)
      ]);
      item.audio = { enUrl, zhUrl };
    } catch (e) {
      item.audio = null; // 拉取失败，留空
    }
    done++;
    $('#loadingProgress').textContent = `${done} / ${items.length}`;
    $('#loadingFill').style.width = (done / items.length * 100) + '%';
  }));

  session = { items, idx: 0, rate, repeat, gap, graded: {} };
  $('#loadingPanel').hidden = true;
  $('#sessionPanel').hidden = false;
  nextWord();
}

function nextWord() {
  if (session.idx >= session.items.length) { showAnswerSheet(); return; }
  const item = session.items[session.idx];
  current = item;
  const w = words.find(x => x.id === item.id);
  $('#wordIndex').textContent = `第 ${session.idx + 1} / ${session.items.length} 个`;
  const st = $('#wordStatus');
  st.className = 'word-status ' + (w.status === 'wrong' ? 'wrong' : w.status === 'learned' ? 'learned' : 'first');
  st.textContent = w.status === 'wrong' ? '错词巩固' : w.status === 'learned' ? '复习' : '新词';
  updateProgress();
  // 自动朗读（播放已缓存音频）
  if (item.audio) playWordAudio(item.audio.enUrl, item.audio.zhUrl, session.repeat, session.gap);
}

function updateProgress() {
  const pct = session.items.length ? (session.idx / session.items.length) * 100 : 0;
  $('#progressFill').style.width = pct + '%';
  $('#progressText').textContent = `${session.idx} / ${session.items.length}`;
}

$('#playEnBtn').addEventListener('click', () => {
  const a = current && current.audio;
  if (a) { for (let i = 0; i < Math.max(1, session.repeat); i++) playUrl(a.enUrl); }
});
$('#playCnBtn').addEventListener('click', () => {
  const a = current && current.audio;
  if (a) playUrl(a.zhUrl);
});

$('#nextBtn').addEventListener('click', () => {
  session.idx++;
  if (session.idx >= session.items.length) showAnswerSheet();
  else nextWord();
});

$('#finishEarlyBtn').addEventListener('click', showAnswerSheet);

/* ============ 统一对答案（自评） ============ */
function showAnswerSheet() {
  window.speechSynthesis.cancel();
  $('#sessionPanel').hidden = true;
  $('#answerPanel').hidden = false;
  const list = $('#sheetList');
  list.innerHTML = '';
  session.items.forEach((item, i) => {
    const w = words.find(x => x.id === item.id);
    const graded = session.graded[item.id];
    const row = document.createElement('div');
    row.className = 'sheet-row';
    row.innerHTML = `
      <div class="sheet-no">${i + 1}</div>
      <div class="sheet-word">
        <div class="sheet-en">${escapeHtml(w.en)}</div>
        <div class="sheet-cn">${escapeHtml(w.cn)}</div>
      </div>
      <div class="sheet-grade">
        <button class="g-btn ok ${graded === true ? 'active' : ''}" data-id="${w.id}" data-ok="1">写对 ✓</button>
        <button class="g-btn bad ${graded === false ? 'active' : ''}" data-id="${w.id}" data-ok="0">写错 ✗</button>
      </div>`;
    list.appendChild(row);
  });
  list.querySelectorAll('.g-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const ok = btn.getAttribute('data-ok') === '1';
      // 更新 graded
      session.graded[id] = ok;
      // 重绘该行的 active 状态
      const row = btn.closest('.sheet-row');
      row.querySelectorAll('.g-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // 仅记录自评，提交后才更新状态
      session.graded[id] = ok;
    });
  });
  updateProgress();
  $('#progressText').textContent = `${session.items.length} / ${session.items.length}`;
  $('#progressFill').style.width = '100%';
}

// 提交：根据自评统一更新词库状态
$('#submitBtn').addEventListener('click', () => {
  const graded = session.graded;
  const ids = Object.keys(graded);
  if (ids.length === 0) { alert('请先对每道题自评（写对/写错）。'); return; }
  ids.forEach(id => applyResult(id, graded[id]));
  renderHome();
  renderDict();
  showView('home');
});

/* ============ 题库管理 ============ */
let dictFilter = 'all';

function renderDict() {
  const total = words.length;
  const fresh = words.filter(w => w.status === 'new').length;
  const wrong = words.filter(w => w.status === 'wrong').length;
  const learned = words.filter(w => w.status === 'learned').length;
  $('#dictStats').innerHTML = `
    <div class="stat"><div class="n">${total}</div><div class="l">总词数</div></div>
    <div class="stat"><div class="n">${fresh}</div><div class="l">未听写</div></div>
    <div class="stat warn"><div class="n">${wrong}</div><div class="l">错词</div></div>
    <div class="stat"><div class="n">${learned}</div><div class="l">已掌握</div></div>`;

  const filtered = words.filter(w => {
    if (dictFilter === 'all') return true;
    if (dictFilter === 'new') return w.status === 'new';
    if (dictFilter === 'wrong') return w.status === 'wrong';
    if (dictFilter === 'learned') return w.status === 'learned';
    return true;
  });
  const body = $('#dictBody');
  body.innerHTML = '';
  if (filtered.length === 0) {
    body.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px;">暂无单词</td></tr>`;
    return;
  }
  filtered.forEach(w => {
    const label = w.status === 'new' ? '未听写' : w.status === 'wrong' ? '错词中' : '已掌握';
    const cls = w.status === 'new' ? 'new' : w.status === 'wrong' ? 'wrong' : 'learned';
    const historyStr = (w.history && w.history.length)
      ? w.history.map(h => h ? '🟢' : '🔴').join('')
      : '<span style="color:var(--muted)">—</span>';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(w.en)}</td>
      <td>${escapeHtml(w.cn)}</td>
      <td><span class="status-badge ${cls}">${label}</span></td>
      <td class="hist-col" title="每次听写结果：🟢对 🔴错">${historyStr}</td>
      <td>${w.streak}</td>
      <td>${w.wrongCount}</td>
      <td><button class="row-del" data-id="${w.id}">删除</button></td>`;
    body.appendChild(tr);
  });
  body.querySelectorAll('.row-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      if (confirm('确定删除该单词？')) {
        saveWordsRemote(words.filter(x => x.id !== id));
        renderDict();
        renderHome();
        updateSetupInfo();
      }
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    dictFilter = btn.getAttribute('data-filter');
    renderDict();
  });
});

$('#addWordBtn').addEventListener('click', () => {
  const f = $('#addForm');
  f.hidden = !f.hidden;
});
$('#addCancelBtn').addEventListener('click', () => { $('#addForm').hidden = true; });
$('#addConfirmBtn').addEventListener('click', () => {
  const en = $('#addEn').value.trim();
  const cn = $('#addCn').value.trim();
  if (!en || !cn) { alert('请填写英文和中文'); return; }
  const list = words.slice();
  list.push({ id: uid(), en, cn, status: 'new', streak: 0, wrongCount: 0, history: [] });
  saveWordsRemote(list);
  $('#addEn').value = ''; $('#addCn').value = '';
  $('#addForm').hidden = true;
  renderDict();
  renderHome();
  updateSetupInfo();
});

$('#importDictBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      let imported = [];
      if (file.name.endsWith('.json')) {
        const data = JSON.parse(reader.result);
        imported = data.map(d => ({
          id: uid(), en: String(d.en || '').trim(), cn: String(d.cn || d.zh || '').trim(),
          status: 'new', streak: 0, wrongCount: 0, history: []
        }));
      } else {
        reader.result.split('\n').forEach(line => {
          line = line.trim();
          if (!line) return;
          let en, cn;
          if (line.includes(',')) { [en, cn] = line.split(','); }
          else { const m = line.split(/\s+/); en = m[0]; cn = m.slice(1).join(' '); }
          en = (en || '').trim(); cn = (cn || '').trim();
          if (en && cn) imported.push({ id: uid(), en, cn, status: 'new', streak: 0, wrongCount: 0, history: [] });
        });
      }
      if (imported.length === 0) { alert('没有解析到有效单词。'); return; }
      if (confirm(`成功解析 ${imported.length} 个单词，是否追加到现有词库？`)) {
        saveWordsRemote(words.concat(imported));
        renderDict();
        renderHome();
        updateSetupInfo();
      }
    } catch (err) {
      alert('导入失败：文件格式不正确。' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

$('#exportDictBtn').addEventListener('click', () => {
  const data = words.map(w => ({ en: w.en, cn: w.cn }));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'dictation_words.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#resetStatBtn').addEventListener('click', () => {
  if (!confirm('将把所有单词状态重置为「未听写」，并清空听写记录，确定？')) return;
  const list = words.slice();
  list.forEach(w => { w.status = 'new'; w.streak = 0; w.wrongCount = 0; w.history = []; });
  saveWordsRemote(list);
  renderDict();
  renderHome();
  updateSetupInfo();
});

/* ============ 初始化 ============ */
// words 由 initWords() 异步加载完成后渲染；这里仅确保视图默认显示首页
showView('home');
