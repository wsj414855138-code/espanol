/* 西班牙语陪练 · 练习页逻辑（纯前端，零依赖） */
'use strict';

const $ = (id) => document.getElementById(id);
const BASE = location.pathname.startsWith('/app/') ? '../data/packs' : 'data/packs';

const state = {
  packs: [],
  pack: null,
  // 词汇卡
  vocabIdx: 0,
  vocabRevealed: false,
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
function playAudio(url) {
  if (!url) return;
  if (state.player) { state.player.pause(); state.player.src = ''; }
  const a = new Audio(url);
  a.play().catch(() => {});
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

/* ---------- 数据加载 ---------- */
async function init() {
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

  // 词汇卡
  state.vocabIdx = 0;
  state.vocabRevealed = false;
  renderVocab();
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
    const empty = key === 'sentences' ? !state.pack.sentences.length : !state.pack[key].length;
    t.style.display = empty ? 'none' : '';
  });
}

/* ---------- 词汇卡 ---------- */
function renderVocab() {
  const list = state.pack.vocab;
  const item = list[state.vocabIdx];
  $('vocabProgress').textContent = `${state.vocabIdx + 1} / ${list.length}`;
  if (!item) return;
  $('vocabEs').textContent = item.es;
  $('vocabZhText').textContent = item.zh;
  $('vocabExEs').textContent = item.example ? item.example.es : '';
  $('vocabExZh').textContent = item.example ? item.example.zh : '';
  $('vocabExPlay').style.display = item.example ? '' : 'none';
  state.vocabRevealed = false;
  $('vocabZh').classList.add('hidden');
  $('vocabFlip').textContent = '翻面';
}

$('vocabPlay').addEventListener('click', () => {
  const item = state.pack.vocab[state.vocabIdx];
  if (item) playAudio(item.audio);
});
$('vocabExPlay').addEventListener('click', () => {
  const item = state.pack.vocab[state.vocabIdx];
  if (item && item.exampleAudio) playAudio(item.exampleAudio);
});
$('vocabFlip').addEventListener('click', () => {
  state.vocabRevealed = !state.vocabRevealed;
  $('vocabZh').classList.toggle('hidden', !state.vocabRevealed);
  $('vocabFlip').textContent = state.vocabRevealed ? '再遮住' : '翻面';
});
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
      </div>`;
    div.querySelector('[data-act="play"]').addEventListener('click', () => playAudio(s.audio));
    div.querySelector('[data-act="playSlow"]').addEventListener('click', () => playAudio(s.audioSlow));
    div.querySelector('[data-act="toggleZh"]').addEventListener('click', (e) => {
      div.querySelector('.zh').classList.toggle('hidden');
      e.currentTarget.textContent = div.querySelector('.zh').classList.contains('hidden') ? '📖 中文' : '🙈 遮住';
    });
    div.querySelector('[data-act="record"]').addEventListener('click', () => toggleRecord(div, s, i));
    box.appendChild(div);
  });
}

async function toggleRecord(div, sentence, idx) {
  const recordBtn = div.querySelector('[data-act="record"]');
  const mineBtn = div.querySelector('[data-act="playMine"]');

  if (state.recorder && state.recorder.state === 'recording') {
    // 停止当前录音
    state.recorder.stop();
    recordBtn.textContent = '🎤 跟读';
    div.classList.remove('recording');
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
    };
    div.classList.add('recording');
    recordBtn.textContent = '⏹ 停止';
    state.recorder.start();
  } catch {
    alert('无法访问麦克风，请检查权限设置。');
  }
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
}

/* ---------- 页签切换（支持 #hash 深链接） ---------- */
function switchTab(name) {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((x) => x.classList.toggle('active', x.id === `tab-${name}`));
  history.replaceState(null, '', `#${name}`);
}
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => switchTab(t.dataset.tab));
});
// 浏览器前进/后退、深链接 hash 变化时同步页签
window.addEventListener('hashchange', () => {
  const h = location.hash.replace('#', '');
  if (['vocab', 'listening', 'shadow', 'dictation'].includes(h)) switchTab(h);
});

init().then(() => {
  const hash = location.hash.replace('#', '');
  if (hash && ['vocab', 'listening', 'shadow', 'dictation'].includes(hash)) switchTab(hash);
});
