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
  ['apple', '苹果'], ['banana', '香蕉'], ['cat', '猫'], ['dog', '狗'],
  ['book', '书'], ['water', '水'], ['school', '学校'], ['teacher', '老师'],
  ['student', '学生'], ['friend', '朋友'], ['family', '家庭'], ['happy', '开心的'],
  ['red', '红色'], ['blue', '蓝色'], ['green', '绿色'], ['yellow', '黄色'],
  ['morning', '早晨'], ['evening', '晚上'], ['today', '今天'], ['tomorrow', '明天'],
  ['computer', '电脑'], ['music', '音乐'], ['sport', '运动'], ['food', '食物'],
  ['animal', '动物'], ['plant', '植物'], ['weather', '天气'], ['travel', '旅行'],
  ['language', '语言'], ['science', '科学'], ['history', '历史'], ['math', '数学'],
  ['english', '英语'], ['chinese', '中文'], ['write', '写'], ['read', '读'],
  ['listen', '听'], ['speak', '说'], ['learn', '学习'], ['remember', '记住'],
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
