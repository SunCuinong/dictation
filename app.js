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
(async function initWords() {
  const loaded = await loadWords();
  words = loaded && loaded.length
    ? loaded
    : BUILTIN.map(([en, cn]) => ({ id: uid(), en, cn, status: 'new', streak: 0, wrongCount: 0 }));
  // 确保每条有 id
  words.forEach(w => { if (!w.id) w.id = uid(); });
  try { localStorage.setItem(STORE_KEY, JSON.stringify(words)); } catch (e) {}
  renderHome();
  renderDict();
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

// 用后端 edge_tts 合成并播放；返回 Promise<boolean> 是否成功
function speakBackend(text, lang, rate) {
  const url = `${API_BASE}/api/tts?text=${encodeURIComponent(text)}&lang=${lang}&rate=${rate}`;
  return fetch(url)
    .then(r => { if (!r.ok) throw new Error('tts failed'); return r.blob(); })
    .then(blob => {
      const audio = new Audio(URL.createObjectURL(blob));
      return new Promise((resolve) => {
        audio.onended = () => { URL.revokeObjectURL(audio.src); resolve(true); };
        audio.onerror = () => resolve(false);
        audio.play().catch(() => resolve(false));
      });
    });
}
function speakLocal(text, lang, rate, times) {
  if (!('speechSynthesis' in window)) return Promise.resolve(false);
  return new Promise((resolve) => {
    window.speechSynthesis.cancel();
    let i = 0;
    const utter = () => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === 'en' ? 'en-US' : 'zh-CN';
      u.rate = rate || 1;
      const v = pickVoice(u.lang);
      if (v) u.voice = v;
      return u;
    };
    const playNext = () => {
      if (i >= (times || 1)) { resolve(true); return; }
      i++;
      const u = utter();
      if (i < (times || 1)) u.onend = playNext;
      else u.onend = () => resolve(true);
      window.speechSynthesis.speak(u);
    };
    playNext();
  });
}

// 单段朗读：优先后端，失败回退本地
function speak(text, lang, rate, times) {
  rate = rate || 1;
  speakBackend(text, lang, rate)
    .then(ok => { if (!ok) return speakLocal(text, lang, rate, times || 1); })
    .catch(() => speakLocal(text, lang, rate, times || 1));
}

// 依次朗读：英文(重复 times) -> 中文(1次)，优先后端
function speakSequence(en, cn, rate, times) {
  rate = rate || 1;
  const playLocalSeq = () => {
    speakLocal(en, 'en', rate, times).then(() => speakLocal(cn, 'zh', rate, 1));
  };
  speakBackend(en, 'en', rate)
    .then(ok => {
      if (!ok) { playLocalSeq(); return; }
      // 英文重复次数通过多次后端请求实现
      let i = 1;
      const repeatEn = () => {
        if (i >= times) {
          speakBackend(cn, 'zh', rate)
            .then(ok2 => { if (!ok2) speakLocal(cn, 'zh', rate, 1); })
            .catch(() => speakLocal(cn, 'zh', rate, 1));
        } else {
          i++;
          speakBackend(en, 'en', rate).then(repeatEn).catch(playLocalSeq);
        }
      };
      repeatEn();
    })
    .catch(playLocalSeq);
}

/* ============ 听写清单生成 ============ */
function buildSession(count) {
  const wrong = words.filter(w => w.status === 'wrong');
  const fresh = words.filter(w => w.status === 'new');
  const learned = words.filter(w => w.status === 'learned');
  const pool = [];
  shuffle(wrong).forEach(w => pool.push(w));
  shuffle(fresh).forEach(w => pool.push(w));
  if (pool.length < count) {
    learned.sort((a, b) => b.wrongCount - a.wrongCount);
    learned.forEach(w => { if (pool.length < count) pool.push(w); });
  }
  // 记录原始状态用于汇总判断
  return pool.slice(0, count).map(w => ({ id: w.id, firstStatus: w.status }));
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ============ 状态更新 ============ */
function markCorrect(id) {
  const w = words.find(x => x.id === id);
  if (!w) return;
  if (w.status === 'new') { w.status = 'learned'; w.streak = 1; }
  else if (w.status === 'wrong') {
    w.streak += 1;
    if (w.streak >= 3) w.status = 'learned';
  }
  saveWordsRemote(words);
}
function markWrong(id) {
  const w = words.find(x => x.id === id);
  if (!w) return;
  w.status = 'wrong';
  w.streak = 0;
  w.wrongCount += 1;
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
$('#navHomeBtn').addEventListener('click', () => { renderHome(); showView('home'); });
$('#navDictBtn').addEventListener('click', () => { renderDict(); showView('dict'); });
$('#navListenBtn').addEventListener('click', () => { resetToSetup(); showView('listen'); });
$('#homeListenBtn').addEventListener('click', () => { resetToSetup(); showView('listen'); });
$('#homeDictBtn').addEventListener('click', () => { renderDict(); showView('dict'); });

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
let session = null; // { items:[{id,firstStatus}], idx, rate, repeat, graded:{} }
let current = null;

function resetToSetup() {
  $('#setupPanel').hidden = false;
  $('#sessionPanel').hidden = true;
  $('#answerPanel').hidden = true;
  updateSetupInfo();
}
function updateSetupInfo() {
  const wrong = words.filter(w => w.status === 'wrong').length;
  const fresh = words.filter(w => w.status === 'new').length;
  const total = words.length;
  $('#setupInfo').textContent =
    `词库共 ${total} 词：未听写 ${fresh} 个，错词待巩固 ${wrong} 个。本次将优先抽取错词，不足部分用新词补足。`;
}

$('#startBtn').addEventListener('click', () => {
  const count = Math.max(1, parseInt($('#countInput').value, 10) || 30);
  const rate = parseFloat($('#speedSelect').value);
  const repeat = parseInt($('#repeatSelect').value, 10);
  const items = buildSession(count);
  if (items.length === 0) { alert('词库为空，请先到「题库」添加单词。'); return; }
  session = { items, idx: 0, rate, repeat, graded: {} };
  $('#setupPanel').hidden = true;
  $('#answerPanel').hidden = true;
  $('#sessionPanel').hidden = false;
  nextWord();
});

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
  // 自动朗读英文（重复）+ 中文
  speakSequence(w.en, w.cn, session.rate, session.repeat);
}

function updateProgress() {
  const pct = session.items.length ? (session.idx / session.items.length) * 100 : 0;
  $('#progressFill').style.width = pct + '%';
  $('#progressText').textContent = `${session.idx} / ${session.items.length}`;
}

$('#playEnBtn').addEventListener('click', () => {
  const w = words.find(x => x.id === current.id);
  speak(w.en, 'en', session.rate, session.repeat);
});
$('#playCnBtn').addEventListener('click', () => {
  const w = words.find(x => x.id === current.id);
  speak(w.cn, 'zh', session.rate, 1);
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
      // 应用到状态机
      if (ok) markCorrect(id); else markWrong(id);
    });
  });
  updateProgress();
  $('#progressText').textContent = `${session.items.length} / ${session.items.length}`;
  $('#progressFill').style.width = '100%';
}

$('#backHomeBtn2').addEventListener('click', () => { renderHome(); showView('home'); });

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
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:24px;">暂无单词</td></tr>`;
    return;
  }
  filtered.forEach(w => {
    const label = w.status === 'new' ? '未听写' : w.status === 'wrong' ? '错词中' : '已掌握';
    const cls = w.status === 'new' ? 'new' : w.status === 'wrong' ? 'wrong' : 'learned';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(w.en)}</td>
      <td>${escapeHtml(w.cn)}</td>
      <td><span class="status-badge ${cls}">${label}</span></td>
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
  list.push({ id: uid(), en, cn, status: 'new', streak: 0, wrongCount: 0 });
  saveWordsRemote(list);
  $('#addEn').value = ''; $('#addCn').value = '';
  $('#addForm').hidden = true;
  renderDict();
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
          status: 'new', streak: 0, wrongCount: 0
        }));
      } else {
        reader.result.split('\n').forEach(line => {
          line = line.trim();
          if (!line) return;
          let en, cn;
          if (line.includes(',')) { [en, cn] = line.split(','); }
          else { const m = line.split(/\s+/); en = m[0]; cn = m.slice(1).join(' '); }
          en = (en || '').trim(); cn = (cn || '').trim();
          if (en && cn) imported.push({ id: uid(), en, cn, status: 'new', streak: 0, wrongCount: 0 });
        });
      }
      if (imported.length === 0) { alert('没有解析到有效单词。'); return; }
      if (confirm(`成功解析 ${imported.length} 个单词，是否追加到现有词库？`)) {
        saveWordsRemote(words.concat(imported));
        renderDict();
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
  if (!confirm('将把所有单词状态重置为「未听写」，确定？')) return;
  const list = words.slice();
  list.forEach(w => { w.status = 'new'; w.streak = 0; w.wrongCount = 0; });
  saveWordsRemote(list);
  renderDict();
});

/* ============ 初始化 ============ */
// words 由 initWords() 异步加载完成后渲染；这里仅确保视图默认显示首页
showView('home');
