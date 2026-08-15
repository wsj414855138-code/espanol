/* 西班牙语陪练 · 练习页逻辑（纯前端，零依赖） */
'use strict';

const $ = (id) => document.getElementById(id);
// BASE 解析：页面可能在 /app/（本地）或 /<仓库>/app/（GitHub Pages 子路径）下。
// 只要路径里含 /app/ 段就用相对上一级的 data/packs（曾因 startsWith('/app/')
// 在子路径部署下失效，导致线上"数据加载失败"——2026-08-15 修复）
const BASE = (location.pathname + '/').includes('/app/') ? '../data/packs' : 'data/packs';

const state = {
  packs: [],
  pack: null,
  // 词汇卡
  vocabIdx: 0,
  vocabRevealed: false,
  // 复习模式（SRS）
  reviewOn: false,
  reviewList: [],   // 当前到期的词汇
  reviewIdx: 0,
  // 听辨
  listenQueue: [],   // 打乱的题目
  listenPos: 0,
  listenScore: 0,
  listenDone: 0,
  listenAnswer: -1,  // 当前题的正确答案下标
  listenRight: null,
  // 全局音频
  player: null,
  // 录音
  recorder: null,
  recorderStream: null,
  recorderRow: null,
};

/* ---------- 基础工具 ---------- */
let playToastTimer = null;
/** 播放失败时在页面底部显示提示（2026-08-15：此前静默 catch 导致"无声"问题难以察觉） */
function toast(msg) {
  const box = document.getElementById('playToast');
  if (!box) return;
  box.textContent = msg;
  box.classList.add('show');
  clearTimeout(playToastTimer);
  playToastTimer = setTimeout(() => box.classList.remove('show'), 4000);
}

function playAudio(url) {
  if (!url) return;
  // pack.json 里的音频是包内相对路径（audio/xxx.m4a），页面在 /app/ 下，
  // 必须解析为 /data/packs/<课程>/audio/xxx.m4a 才能播放（曾因直接用相对路径 404）
  if (typeof url === 'string' && url.startsWith('audio/') && state.pack) {
    url = `${BASE}/${state.pack.id}/${url}`;
  }
  if (state.player) { state.player.pause(); state.player.src = ''; }
  const a = new Audio(url);
  a.play().catch((err) => {
    toast(`🔇 播放失败：${url.split('/').pop()}（${err.name || '未知错误'}）。请刷新页面重试，或检查服务器是否在运行。`);
    console.error('[play] 播放失败', url, err);
  });
  state.player = a;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 听写判对：忽略大小写、重音、标点、多余空格 */
function normalizeText(s) {
  return (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[¿¡!?.,;:'"()—–-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ---------- 学习统计（localStorage，跨天自动重置） ---------- */
const STATS_KEY = 'ls_stats';

function dateStr(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
function todayStr() { return dateStr(new Date()); }

function loadStats() {
  try {
    const raw = JSON.parse(localStorage.getItem(STATS_KEY));
    if (raw && typeof raw === 'object' && raw.date) return raw;
  } catch { /* localStorage 不可用或数据损坏时按无统计处理 */ }
  return null;
}

function saveStats(s) {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch { /* 隐私模式等场景忽略写入失败 */ }
  // v0.5 云同步：每日统计推送（失败静默）
  try { if (typeof CLOUD !== 'undefined' && CLOUD.pushStats) CLOUD.pushStats(s); } catch { /* 云不可用不影响练习 */ }
}

/** 累计今日统计；type: listening(ok=对错) / dictation / review */
function statsAdd(type, ok) {
  const today = todayStr();
  const s = loadStats() || { date: today, listeningDone: 0, listeningRight: 0, dictationDone: 0, reviewCards: 0 };
  if (s.date !== today) {
    // 跨天：重置为新的一天
    s.date = today; s.listeningDone = 0; s.listeningRight = 0; s.dictationDone = 0; s.reviewCards = 0;
  }
  if (type === 'listening') {
    s.listeningDone++;
    if (ok) s.listeningRight++;
  } else if (type === 'dictation') {
    s.dictationDone++;
  } else if (type === 'review') {
    s.reviewCards++;
  }
  saveStats(s);
  renderStats();
}

function renderStats() {
  const bar = $('statsBar');
  const s = loadStats();
  if (!s || s.date !== todayStr()) {
    bar.textContent = '开始练习后这里会出现今日统计';
    return;
  }
  bar.innerHTML =
    `<span class="badge">今日：听辨 ${s.listeningRight}/${s.listeningDone} ✓ · 听写 ${s.dictationDone} 句 · 复习 ${s.reviewCards} 卡</span>`;
}

/* ---------- 间隔重复复习（简化 SM-2，localStorage） ---------- */
const SRS_KEY = 'ls_srs_v1';
const SRS_MAX_INTERVAL = 30;   // 成功间隔翻倍的上限（天）

function loadSRS() {
  try {
    const raw = JSON.parse(localStorage.getItem(SRS_KEY));
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
}

function saveSRS(map) {
  try { localStorage.setItem(SRS_KEY, JSON.stringify(map)); } catch { /* 忽略写入失败 */ }
  // v0.5 云同步：本地为事实源，尽力推送（失败静默，联网后自动补）
  try { if (typeof CLOUD !== 'undefined' && CLOUD.pushSRS) CLOUD.pushSRS(map); } catch { /* 云不可用不影响练习 */ }
}

function srsKey(item) { return `${state.pack.id || 'pack'}/${item.id}`; }

/** 到期判定：没复习过（无记录）或到期日 <= 今天 */
function isDue(rec) {
  return !rec || !rec.due || rec.due <= todayStr();
}

/** 当前课程中所有到期词汇 */
function dueVocab() {
  const map = loadSRS();
  return (state.pack.vocab || []).filter((item) => isDue(map[srsKey(item)]));
}

/** 进入 / 退出复习模式 */
function setReviewMode(on) {
  state.reviewOn = on;
  $('vocabReviewToggle').checked = on;
  state.reviewList = on ? dueVocab() : [];
  state.reviewIdx = 0;
  state.vocabRevealed = false;
  $('vocabZh').classList.add('hidden');
  if (on) renderReview(); else renderVocab();
}

/** 渲染复习卡片：只显示到期词，底部两个按钮作答 */
function renderReview() {
  const empty = $('vocabReviewEmpty');
  const card = $('vocabCard');
  const normalCtl = $('vocabControls');
  const reviewCtl = $('vocabReviewControls');
  const progress = $('vocabProgress');

  if (!state.reviewList.length) {
    // 今天没有到期的单词
    empty.classList.remove('hidden');
    card.classList.add('hidden');
    normalCtl.classList.add('hidden');
    reviewCtl.classList.add('hidden');
    progress.textContent = '0 / 0';
    return;
  }
  empty.classList.add('hidden');
  card.classList.remove('hidden');
  normalCtl.classList.add('hidden');
  reviewCtl.classList.remove('hidden');
  progress.textContent = `剩余 ${state.reviewList.length - state.reviewIdx} 张`;

  const item = state.reviewList[state.reviewIdx];
  $('vocabEs').textContent = item.es;
  $('vocabZhText').textContent = item.zh;
  const cog1 = item.cognate;
  $('vocabCognate').textContent = cog1 ? `💡 英语同源：${cog1}` : '';
  $('vocabCognate').classList.toggle('hidden', !cog1);
  $('vocabExEs').textContent = item.example ? item.example.es : '';
  $('vocabExZh').textContent = item.example ? item.example.zh : '';
  $('vocabExPlay').style.display = item.example ? '' : 'none';
  state.vocabRevealed = false;
  $('vocabZh').classList.add('hidden');
}

/** 复习作答：remember=true 记得，false 忘了；按简化 SM-2 更新排期 */
function answerReview(remember) {
  if (!state.reviewOn || !state.reviewList.length) return;
  const item = state.reviewList[state.reviewIdx];
  const map = loadSRS();
  const key = srsKey(item);
  const rec = map[key] || { ease: 2.5, interval: 0, due: todayStr(), reps: 0, lapses: 0 };
  if (remember) {
    // 成功：首次间隔 1 天，之后翻倍（上限 30 天）
    rec.reps++;
    rec.interval = rec.interval <= 0 ? 1 : Math.min(rec.interval * 2, SRS_MAX_INTERVAL);
  } else {
    // 失败：间隔重置为 1 天，lapses + 1
    rec.lapses++;
    rec.reps = 0;
    rec.interval = 1;
  }
  const due = new Date();
  due.setDate(due.getDate() + rec.interval);
  rec.due = dateStr(due);
  map[key] = rec;
  saveSRS(map);
  statsAdd('review');   // 只有点 ✓ / ✗ 才算一次复习，普通浏览不算

  // 跳到下一张到期卡；答完今天的就重新取一遍（一般会空 → 显示 🎉）
  state.reviewIdx++;
  if (state.reviewIdx >= state.reviewList.length) {
    state.reviewList = dueVocab();
    state.reviewIdx = 0;
  }
  renderReview();
}

/* ---------- 数据加载 ---------- */
async function init() {
  renderStats();   // 打开页面即显示今日统计（无数据时显示占位提示）
  // v0.7 PWA：注册 Service Worker（离线缓存应用外壳；失败静默）
  try { if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {}); } catch { /* 忽略 */ }
  // v0.5 云同步：后台初始化匿名身份 + 拉取云端 SRS 合并进本地（不阻塞页面，失败静默）
  try {
    if (typeof CLOUD !== 'undefined' && CLOUD.init) {
      CLOUD.init().then(async (ok) => {
        if (!ok) return;
        const map = loadSRS();
        const changed = await CLOUD.pullSRS(map);
        if (changed) saveSRS(map);
      });
    }
  } catch { /* 云不可用完全不影响本地使用 */ }
  try {
    const res = await fetch(`${BASE}/index.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.packs = await res.json();
  } catch (err) {
    $('loadError').classList.remove('hidden');
    return;
  }
  const sel = $('packSelect');
  state.packs.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.title}${p.level ? `（${p.level}）` : ''}`;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => loadPack(sel.value));
  if (state.packs.length) loadPack(state.packs[0].id);
}

async function loadPack(id) {
  try {
    const res = await fetch(`${BASE}/${id}/pack.json`);
    state.pack = await res.json();
  } catch {
    $('loadError').classList.remove('hidden');
    return;
  }
  $('loadError').classList.add('hidden');

  // 词汇卡（复习模式随课程切换重置为关闭）
  state.vocabIdx = 0;
  state.vocabRevealed = false;
  setReviewMode(false);
  // 听辨
  state.listenQueue = shuffle(state.pack.listening);
  state.listenPos = 0;
  state.listenScore = 0;
  state.listenDone = 0;
  renderListening();
  // 跟读 / 听写
  renderShadow();
  renderDictation();

  // 没数据的 tab 隐藏
  document.querySelectorAll('.tab[data-tab]').forEach((t) => {
    const key = { vocab: 'vocab', listening: 'listening', shadow: 'sentences', dictation: 'sentences' }[t.dataset.tab];
    if (!key) return;
    const empty = key === 'sentences' ? !state.pack.sentences.length : !state.pack[key].length;
    t.style.display = empty ? 'none' : '';
  });
}

/* ---------- 词汇卡 ---------- */
function renderVocab() {
  // 普通浏览模式：显示卡片与 上一个/翻面/下一个，隐藏复习控件
  $('vocabReviewEmpty').classList.add('hidden');
  $('vocabCard').classList.remove('hidden');
  $('vocabReviewControls').classList.add('hidden');
  $('vocabControls').classList.remove('hidden');
  const list = state.pack.vocab;
  const item = list[state.vocabIdx];
  $('vocabProgress').textContent = `${state.vocabIdx + 1} / ${list.length}`;
  if (!item) return;
  $('vocabEs').textContent = item.es;
  $('vocabZhText').textContent = item.zh;
  const cog = item.cognate;
  $('vocabCognate').textContent = cog ? `💡 英语同源：${cog}` : '';
  $('vocabCognate').classList.toggle('hidden', !cog);
  $('vocabExEs').textContent = item.example ? item.example.es : '';
  $('vocabExZh').textContent = item.example ? item.example.zh : '';
  $('vocabExPlay').style.display = item.example ? '' : 'none';
  state.vocabRevealed = false;
  $('vocabZh').classList.add('hidden');
  $('vocabFlip').textContent = '翻面';
}

/** 当前词汇卡数据：复习模式下取到期卡，否则取普通浏览卡 */
function currentVocabItem() {
  if (state.reviewOn) return state.reviewList[state.reviewIdx];
  return state.pack.vocab[state.vocabIdx];
}

/** 翻面（普通模式按钮 / 复习模式点卡片） */
function flipVocab() {
  state.vocabRevealed = !state.vocabRevealed;
  $('vocabZh').classList.toggle('hidden', !state.vocabRevealed);
  $('vocabFlip').textContent = state.vocabRevealed ? '再遮住' : '翻面';
}

$('vocabPlay').addEventListener('click', (e) => {
  e.stopPropagation();   // 复习模式下点卡片会翻面，播放按钮不触发
  const item = currentVocabItem();
  if (item) playAudio(item.audio);
});
$('vocabExPlay').addEventListener('click', (e) => {
  e.stopPropagation();
  const item = currentVocabItem();
  if (item && item.exampleAudio) playAudio(item.exampleAudio);
});
$('vocabFlip').addEventListener('click', flipVocab);
$('vocabCard').addEventListener('click', () => {
  // 复习模式隐藏了「翻面」按钮，改点卡片翻面看中文
  if (state.reviewOn) flipVocab();
});
$('vocabReviewToggle').addEventListener('change', (e) => setReviewMode(e.target.checked));
$('vocabRemember').addEventListener('click', () => answerReview(true));
$('vocabForget').addEventListener('click', () => answerReview(false));
$('vocabPrev').addEventListener('click', () => {
  if (state.vocabIdx > 0) { state.vocabIdx--; renderVocab(); }
});
$('vocabNext').addEventListener('click', () => {
  if (state.vocabIdx < state.pack.vocab.length - 1) { state.vocabIdx++; renderVocab(); }
});

/* ---------- 听辨 ---------- */
function renderListening() {
  const q = state.listenQueue[state.listenPos];
  const box = $('listenOptions');
  box.innerHTML = '';
  if (!q) {
    const total = state.listenQueue.length;
    $('listenFeedback').innerHTML =
      `🎉 本轮完成！答对 ${state.listenScore} / ${total} 题` +
      (state.listenScore === total ? '，全对，耳朵很棒！' : '，错的题可以再来一轮。');
    $('listenFeedback').classList.remove('hidden');
    $('listenCategory').textContent = '完成';
    $('listenScore').textContent = `✓ ${state.listenScore} / ${total}`;
    $('listenPlay').classList.add('hidden');
    return;
  }
  $('listenCategory').textContent = `音素：${q.category}`;
  $('listenScore').textContent = `✓ ${state.listenScore} / ${state.listenDone}`;
  $('listenFeedback').classList.add('hidden');
  $('listenPlay').classList.remove('hidden');
  state.listenAnswer = Math.random() < 0.5 ? 0 : 1;

  q.pair.forEach((word, i) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = word;
    b.addEventListener('click', () => answerListening(i, b));
    box.appendChild(b);
  });
}

function answerListening(i, btn) {
  if (state.listenRight !== null) return; // 已作答
  const q = state.listenQueue[state.listenPos];
  const right = i === state.listenAnswer;
  state.listenRight = right;
  state.listenDone++;
  if (right) state.listenScore++;
  statsAdd('listening', right);   // 每答一题记一次统计（对错分别累计）

  const buttons = $('listenOptions').querySelectorAll('.btn');
  buttons.forEach((b, idx) => {
    b.disabled = true;
    if (idx === state.listenAnswer) b.classList.add('correct');
    else if (idx === i) b.classList.add('wrong');
  });

  const fb = $('listenFeedback');
  fb.classList.remove('hidden', 'ok', 'no');
  fb.classList.add(right ? 'ok' : 'no');
  fb.innerHTML =
    `<strong>${right ? '✓ 对了！' : `✗ 听错了，答案是「${q.pair[state.listenAnswer]}」`}</strong>` +
    (q.zh ? `<br><span style="color:var(--muted)">${q.zh}</span>` : '') +
    `<br><button class="btn" id="listenReplay">🔊 再听一遍</button>`;
  $('listenReplay').addEventListener('click', () => playAudio(q.audio[state.listenAnswer]));
  $('listenNext').classList.remove('hidden');
}

$('listenPlay').addEventListener('click', () => {
  const q = state.listenQueue[state.listenPos];
  if (q) playAudio(q.audio[state.listenAnswer]);
});
$('listenNext').addEventListener('click', () => {
  state.listenPos++;
  state.listenRight = null;
  $('listenNext').classList.add('hidden');
  renderListening();
});

/* ---------- 跟读 ---------- */
function renderShadow() {
  const box = $('shadowList');
  box.innerHTML = '';
  (state.pack.sentences || []).forEach((s, i) => {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      <div class="es">${s.es}</div>
      <div class="zh hidden">${s.zh}</div>
      <div class="actions">
        <button class="btn" data-act="play">🔊 常速</button>
        <button class="btn" data-act="playSlow">🐢 慢速</button>
        <button class="btn" data-act="toggleZh">📖 中文</button>
        <button class="btn" data-act="record">🎤 跟读</button>
        <button class="btn hidden" data-act="playMine">▶ 我的录音</button>
        <button class="btn hidden" data-act="score">🎯 评分</button>
      </div>
      <div class="score-result hidden" data-role="score"></div>`;
    div.querySelector('[data-act="play"]').addEventListener('click', () => playAudio(s.audio));
    div.querySelector('[data-act="playSlow"]').addEventListener('click', () => playAudio(s.audioSlow));
    div.querySelector('[data-act="toggleZh"]').addEventListener('click', (e) => {
      div.querySelector('.zh').classList.toggle('hidden');
      e.currentTarget.textContent = div.querySelector('.zh').classList.contains('hidden') ? '📖 中文' : '🙈 遮住';
    });
    div.querySelector('[data-act="record"]').addEventListener('click', () => toggleRecord(div, s, i));
    // 发音评分：浏览器不支持语音识别时按钮常驻显示「评分不可用」
    const scoreBtn = div.querySelector('[data-act="score"]');
    if (window.SpeechRecognition || window.webkitSpeechRecognition) {
      scoreBtn.addEventListener('click', () => scorePronunciation(div, s));
    } else {
      scoreBtn.classList.remove('hidden');
      scoreBtn.textContent = '评分不可用';
      scoreBtn.classList.add('score-na');
      scoreBtn.addEventListener('click', () => {
        alert('当前浏览器不支持语音识别评分，建议用 Chrome/Edge/Safari。');
      });
    }
    box.appendChild(div);
  });
}

async function toggleRecord(div, sentence, idx) {
  const recordBtn = div.querySelector('[data-act="record"]');
  const mineBtn = div.querySelector('[data-act="playMine"]');

  if (state.recorder && state.recorder.state === 'recording') {
    // 停止当前录音
    stopRecording();
    return;
  }
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    alert('此浏览器不支持录音，请用最新版 Chrome / Safari / Edge。');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.recorder = new MediaRecorder(stream);
    state.recorderStream = stream;
    state.recorderRow = { div, mineBtn, recordBtn };
    const chunks = [];
    state.recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    state.recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const url = URL.createObjectURL(new Blob(chunks, { type: 'audio/webm' }));
      mineBtn.classList.remove('hidden');
      mineBtn.onclick = () => playAudio(url);
      // 录完音后显示「评分」按钮（浏览器支持语音识别时）
      if (window.SpeechRecognition || window.webkitSpeechRecognition) {
        const scoreBtn = div.querySelector('[data-act="score"]');
        if (scoreBtn) scoreBtn.classList.remove('hidden');
      }
    };
    div.classList.add('recording');
    recordBtn.textContent = '⏹ 停止';
    state.recorder.start();
  } catch {
    alert('无法访问麦克风，请检查权限设置。');
  }
}

/* ---------- 发音评分（Web Speech API） ---------- */
/** 停止当前录音（跟读停止 / 评分互斥共用） */
function stopRecording() {
  if (!state.recorder || state.recorder.state !== 'recording') return;
  const row = state.recorderRow || {};
  state.recorder.stop();
  if (row.recordBtn) row.recordBtn.textContent = '🎤 跟读';
  if (row.div) row.div.classList.remove('recording');
}

/** 把语音识别错误码转成用户能看懂的中文提示 */
function recErrorText(code) {
  const map = {
    'no-speech': '没有听到声音，请靠近麦克风再说一遍。',
    'audio-capture': '没检测到麦克风，请检查设备或权限。',
    'not-allowed': '麦克风权限被拒绝，请在浏览器设置里允许。',
    'network': '语音识别网络请求失败，请检查网络后重试。',
  };
  return map[code] || `语音识别失败（${code}）。`;
}

/** 发音评分：转写为西语文本，与句子原文逐词比对出命中率 */
function scorePronunciation(div, sentence) {
  const scoreBtn = div.querySelector('[data-act="score"]');
  const box = div.querySelector('[data-role="score"]');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    alert('当前浏览器不支持语音识别评分，建议用 Chrome/Edge/Safari。');
    return;
  }
  // 互斥：评分前先停掉正在进行的录音
  if (state.recorder && state.recorder.state === 'recording') stopRecording();

  const rec = new SR();
  rec.lang = 'es-ES';
  rec.continuous = false;
  rec.interimResults = false;

  scoreBtn.disabled = true;
  scoreBtn.textContent = '⏳ 正在听…';
  box.classList.remove('hidden');
  box.className = 'score-result';
  box.innerHTML = '<span class="rec-text">🎙 请对着麦克风朗读这句话…</span>';

  rec.onresult = (e) => {
    const text = e.results[0][0].transcript || '';
    showScoreResult(box, sentence, text);
    scoreBtn.disabled = false;
    scoreBtn.textContent = '🎯 再评一次';
  };
  rec.onerror = (e) => {
    box.classList.remove('hidden');
    box.className = 'score-result';
    box.innerHTML = `<span class="rec-text">⚠️ ${recErrorText(e.error)}</span>`;
    scoreBtn.disabled = false;
    scoreBtn.textContent = '🎯 再评一次';
  };
  rec.onend = () => { scoreBtn.disabled = false; };
  rec.start();
}

/** 逐词比对：以句子原文为准，统计识别文本命中了几个词 */
function showScoreResult(box, sentence, text) {
  const refWords = normalizeText(sentence.es).split(' ').filter(Boolean);
  const recWords = normalizeText(text).split(' ').filter(Boolean);
  const recSet = new Set(recWords);
  const hit = refWords.filter((w) => recSet.has(w)).length;
  const pct = refWords.length ? Math.round((hit / refWords.length) * 100) : 0;

  let verdict, cls;
  if (pct >= 80) { verdict = '很棒！'; cls = 'good'; }
  else if (pct >= 50) { verdict = '再试试'; cls = 'mid'; }
  else { verdict = '建议先慢速跟读'; cls = 'bad'; }

  box.classList.remove('hidden');
  box.className = `score-result ${cls}`;
  box.innerHTML =
    `<div>识别结果：${text || '（没识别到内容）'}</div>` +
    `<div class="rec-text">词命中 ${pct}%（${hit}/${refWords.length}）· ${verdict}</div>`;
}

/* ---------- 听写 ---------- */
function renderDictation() {
  const box = $('dictationList');
  box.innerHTML = '';
  (state.pack.sentences || []).forEach((s, i) => {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      <span class="item-no">第 ${i + 1} 题</span>
      <div class="actions">
        <button class="btn" data-act="play">🔊 常速</button>
        <button class="btn" data-act="playSlow">🐢 慢速</button>
        <button class="btn" data-act="answer">👀 看答案</button>
      </div>
      <input class="dict-input" data-role="input" placeholder="把你听到的打在这里…" autocomplete="off" autocapitalize="off" />
      <div class="dict-result hidden" data-role="result"></div>`;
    div.querySelector('[data-act="play"]').addEventListener('click', () => playAudio(s.audio));
    div.querySelector('[data-act="playSlow"]').addEventListener('click', () => playAudio(s.audioSlow));
    div.querySelector('[data-act="answer"]').addEventListener('click', () => {
      div.querySelector('[data-role="result"]').classList.remove('hidden');
      div.querySelector('[data-role="result"]').innerHTML =
        `<span class="dict-answer">答案：${s.es}<br>${s.zh}</span>`;
    });
    const input = div.querySelector('[data-role="input"]');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') checkDictation(div, s);
    });
    div.querySelector('[data-role="result"]').dataset.sentence = i;
    input.addEventListener('change', () => checkDictation(div, s));
    box.appendChild(div);
  });
}

function checkDictation(div, s) {
  const input = div.querySelector('[data-role="input"]');
  const result = div.querySelector('[data-role="result"]');
  result.classList.remove('hidden');
  const ok = normalizeText(input.value) === normalizeText(s.es);
  result.innerHTML = ok
    ? `<span class="dict-result ok">✓ 全对！</span>`
    : `<span class="dict-result no">✗ 再听听，正确答案：</span>
       <span class="dict-answer">${s.es}<br>${s.zh}</span>`;
  // 统计「判一次」：Enter 判完紧接着 blur 触发的 change 在 1.5 秒内不重复计数
  const lastJudge = Number(div.dataset.lastJudge) || 0;
  const now = Date.now();
  if (now - lastJudge > 1500) statsAdd('dictation');
  div.dataset.lastJudge = now;
}


/* ---------- 报告页（v0.6：打卡热力图 + 摘要） ---------- */
async function renderReport() {
  const summaryEl = $('reportSummary');
  const heatEl = $('reportHeatmap');
  summaryEl.innerHTML = '<span class="hint">加载中…</span>';
  heatEl.innerHTML = '';

  // 汇总：本地今日统计 + 云端近 90 天活动
  const today = todayStr();
  const s = loadStats();
  const todayDone = s && s.date === today ? s.listeningDone + s.dictationDone + s.reviewCards : 0;

  const byDay = {};
  let cloudOk = false;
  if (typeof CLOUD !== 'undefined' && CLOUD.pullActivity) {
    const acts = await CLOUD.pullActivity(90);
    if (acts.length) {
      cloudOk = true;
      for (const a of acts) {
        byDay[a.day] = (byDay[a.day] || 0) + (Number(a.total) || 0);
      }
    }
  }

  // SRS 到期统计
  const map = loadSRS();
  let dueCount = 0, totalCards = 0;
  for (const k of Object.keys(map)) {
    totalCards++;
    if (isDue(map[k])) dueCount++;
  }

  // 摘要卡
  const streak = calcStreak(byDay, today);
  summaryEl.innerHTML =
    `<div class="report-card"><div class="rc-num">${streak}</div><div class="rc-label">连续打卡（天）</div></div>` +
    `<div class="report-card"><div class="rc-num">${todayDone}</div><div class="rc-label">今日练习（次）</div></div>` +
    `<div class="report-card"><div class="rc-num">${dueCount}</div><div class="rc-label">到期复习卡</div></div>` +
    `<div class="report-card"><div class="rc-num">${totalCards}</div><div class="rc-label">已学词汇</div></div>`;
  summaryEl.dataset.cloud = cloudOk ? '1' : '0';
  if (!cloudOk && todayDone === 0) {
    summaryEl.innerHTML += '<div class="hint">还没有练习记录，去做几题吧！</div>';
  }

  // 热力图：近 8 周（56 天），列 = 周
  const days = [];
  for (let i = 55; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({ day: dateStr(d), count: byDay[dateStr(d)] || 0 });
  }
  const maxCount = Math.max(1, ...days.map((x) => x.count));
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  const cellSize = 14;
  const gap = 3;
  const width = weeks.length * (cellSize + gap) + 8;
  const svg = `<svg width="${width}" height="${7 * (cellSize + gap) + 8}" viewBox="0 0 ${width} ${7 * (cellSize + gap) + 8}">` +
    weeks.map((week, wi) => week.map((d, di) => {
      const level = d.count <= 0 ? 0 : Math.min(4, Math.ceil((d.count / maxCount) * 4));
      const fill = ['#2d2d35', 'rgba(47,158,68,0.25)', 'rgba(47,158,68,0.45)', 'rgba(47,158,68,0.7)', 'rgba(47,158,68,1)'][level];
      const isToday = d.day === today;
      const title = `${d.day}：${d.count} 次练习`;
      return `<rect x="${wi * (cellSize + gap)}" y="${di * (cellSize + gap)}" width="${cellSize}" height="${cellSize}" rx="3" fill="${fill}"${isToday ? ' stroke="#fff" stroke-width="1.5"' : ''}><title>${title}</title></rect>`;
    }).join('')).join('') + '</svg>';
  heatEl.innerHTML = svg;
}

/** 连续打卡天数：从今天往回数，今天没练则从昨天往回数 */
function calcStreak(byDay, today) {
  let streak = 0;
  let d = new Date();
  if (!byDay[today]) d.setDate(d.getDate() - 1);   // 今天还没练，从昨天算
  while (byDay[dateStr(d)]) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

/* ---------- 页签切换（支持 #hash 深链接） ---------- */
function switchTab(name) {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((x) => x.classList.toggle('active', x.id === `tab-${name}`));
  history.replaceState(null, '', `#${name}`);
  if (name === 'report') renderReport();
}
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => switchTab(t.dataset.tab));
});
// 浏览器前进/后退、深链接 hash 变化时同步页签
window.addEventListener('hashchange', () => {
  const h = location.hash.replace('#', '');
  if (['vocab', 'listening', 'shadow', 'dictation', 'report'].includes(h)) switchTab(h);
});

init().then(() => {
  const hash = location.hash.replace('#', '');
  if (hash && ['vocab', 'listening', 'shadow', 'dictation', 'report'].includes(hash)) switchTab(hash);
});
