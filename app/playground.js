/* 游乐场模块 —— 教宝宝式互动卡片（认一认 / 配一配 / 听音找图 / 字母启蒙）
 *
 * 教宝宝四原则：一次一件事 · 图像先行 · 点哪哪响 · 无挫败感
 * 依赖 app.js 的全局：$、state、playAudio、shuffle、statsAdd（本文件在 app.js 之前加载，
 * 所有引用都发生在渲染/交互时，不碰加载顺序）
 * 通过 window.Playground（render / stopAuto）与 app.js 挂接，渲染范围仅限 #tab-playground。
 */
'use strict';

window.Playground = (() => {
  const PG = {
    mode: '',
    bound: false,
    // 认一认
    lookIdx: 0,
    lookFlipped: false,
    autoOn: false,
    autoTimers: [],
    // 配一配
    matchCards: [],
    matchFirst: -1,
    matchLock: false,
    matchLeft: 0,
    // 听音找图
    pickTarget: null,
    pickOptions: [],
    pickTried: false,   // 本题是否已答错过（只有首次作答计入统计）
    pickStreak: 0,
    pickTimer: null,    // 答对后的自动下一题定时器（切板块/页签时取消）
    // 字母
    letterGroup: '',
  };

  const MODES = [
    { key: 'look', label: '👀 认一认' },
    { key: 'match', label: '🃏 配一配' },
    { key: 'pick', label: '👂 听音找图' },
    { key: 'letters', label: '🔤 字母' },
  ];

  /* ---------- 数据 ---------- */
  const emojiVocab = () => (state.pack.vocab || []).filter((v) => v.emoji);
  const letters = () => state.pack.letters || [];
  const availableModes = () => {
    const n = emojiVocab().length;
    return MODES.filter((m) => {
      if (m.key === 'letters') return letters().length > 0;
      if (m.key === 'look') return n >= 1;
      return n >= 4; // match / pick
    });
  };

  /* ---------- 基础交互 ---------- */
  function later(ms, fn) { PG.autoTimers.push(setTimeout(fn, ms)); }

  function stopAuto() {
    PG.autoOn = false;
    PG.autoTimers.forEach(clearTimeout);
    PG.autoTimers = [];
    clearTimeout(PG.pickTimer);   // 听音找图的跳题定时器一并取消，防止切板块后覆盖内容
    PG.pickTimer = null;
    const btn = document.getElementById('pgAutoBtn');
    if (btn) btn.textContent = '▶ 自动播放';
  }

  /** 彩带庆祝：铺一层随机下落的 emoji，3 秒后移除 */
  function confetti() {
    const set = ['🎉', '⭐', '✨', '🎊', '🌟'];
    const box = document.createElement('div');
    box.className = 'pg-confetti';
    for (let i = 0; i < 16; i++) {
      const s = document.createElement('span');
      s.textContent = set[i % set.length];
      s.style.left = (4 + Math.random() * 92) + '%';
      s.style.fontSize = (16 + Math.random() * 16) + 'px';
      s.style.animationDelay = (Math.random() * 0.5) + 's';
      box.appendChild(s);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3200);
  }

  /* ---------- SVG 口型图（正面示意，点击配合代表词发音演示） ---------- */
  const LIP = '#e2604c', LIP_D = '#b23f30', CAV = '#4a1f1f', TON = '#f08c7d', TON_D = '#d4695c';

  function mouthSVG(kind) {
    const M = {
      bv: { closed: true, vibr: true },
      p:  { closed: true, air: true },
      g:  { rx: 21, ry: 13, tongue: [72, 52, 20, 11], vibr: true },
      d:  { rx: 21, ry: 13, tongue: [50, 47, 20, 10], vibr: true },
      a:  { rx: 27, ry: 20, tongue: [60, 54, 26, 10] },
      e:  { rx: 32, ry: 12, tongue: [60, 49, 24, 8] },
      i:  { rx: 28, ry: 6,  tongue: [60, 46, 22, 6] },
      o:  { rx: 15, ry: 15, round: true },
      u:  { rx: 8,  ry: 8,  round: true },
      r:  { rx: 20, ry: 12, tongue: [54, 46, 20, 9], taps: 1 },
      rr: { rx: 20, ry: 12, tongue: [54, 46, 20, 9], taps: 3 },
      ll: { rx: 22, ry: 14, tongue: [60, 45, 24, 9] },
      ch: { rx: 20, ry: 11, tongue: [54, 47, 20, 8], air: true },
    };
    const m = M[kind];
    if (!m) return '';
    const cx = 60, cy = 42;
    let inner;
    if (m.closed) {
      inner =
        `<path d="M16 ${cy} Q60 ${cy - 20} 104 ${cy} Q60 ${cy - 6} 16 ${cy} Z" fill="${LIP}" stroke="${LIP_D}" stroke-width="1.5"/>` +
        `<path d="M16 ${cy} Q60 ${cy + 20} 104 ${cy} Q60 ${cy + 6} 16 ${cy} Z" fill="${LIP}" stroke="${LIP_D}" stroke-width="1.5"/>`;
    } else {
      const topO = cy - m.ry - 14, topI = cy - m.ry - 3;
      const botO = cy + m.ry + (m.round ? 18 : 14), botI = cy + m.ry + 3;
      inner =
        `<ellipse cx="${cx}" cy="${cy}" rx="${m.rx}" ry="${m.ry}" fill="${CAV}"/>` +
        (m.tongue
          ? `<ellipse cx="${m.tongue[0]}" cy="${m.tongue[1]}" rx="${m.tongue[2]}" ry="${m.tongue[3]}" fill="${TON}" stroke="${TON_D}" stroke-width="1.5"/>`
          : '') +
        `<path d="M16 ${cy} Q60 ${topO} 104 ${cy} Q60 ${topI} 16 ${cy} Z" fill="${LIP}" stroke="${LIP_D}" stroke-width="1.5"/>` +
        `<path d="M16 ${cy} Q60 ${botO} 104 ${cy} Q60 ${botI} 16 ${cy} Z" fill="${LIP}" stroke="${LIP_D}" stroke-width="1.5"/>`;
    }
    let marks = '';
    if (m.vibr) {
      marks += `<g class="pg-vibr" stroke="#e8590c" stroke-width="2" fill="none" stroke-linecap="round">` +
        `<path d="M108 24 q4 4 0 8"/><path d="M112 34 q4 4 0 8"/><path d="M108 44 q4 4 0 8"/></g>`;
    }
    if (m.air) {
      marks += `<g class="pg-air" stroke="#7ab8f5" stroke-width="2" fill="none" stroke-linecap="round">` +
        `<path d="M46 18 L42 8"/><path d="M60 16 L60 6"/><path d="M74 18 L78 8"/></g>`;
    }
    if (m.taps) {
      const ys = m.taps === 1 ? [30] : [27, 33, 39];
      marks += `<g class="pg-tap" stroke="#ffd8a8" stroke-width="2.5" stroke-linecap="round">` +
        ys.map((y) => `<line x1="54" y1="${y}" x2="54" y2="${y + 5}"/>`).join('') + `</g>`;
    }
    return `<svg viewBox="0 0 120 84" class="pg-mouth-svg" aria-hidden="true">${inner}${marks}</svg>`;
  }

  /** 字母卡 → 口型图 kind；不属于讲义难点的字母返回空 */
  function mouthKey(l) {
    const g = l.group || '';
    if (g === '元音') return l.letter;
    if (g === 'b/v') return 'bv';
    if (g === 'r/rr') return l.letter === 'rr' ? 'rr' : 'r';
    if (['p', 'g', 'd', 'll', 'ch'].includes(g)) return g;
    return '';
  }

  /** 按「字母 + 组名」查口型图（课程引擎 course.js 复用） */
  function mouthSVGFor(letter, group) {
    return mouthSVG(mouthKey({ letter, group }));
  }

  /* ---------- 顶层渲染 ---------- */
  function render() {
    if (!state.pack) return;   // 课程数据尚未加载完成（如 #playground 深链接直达时）
    const modes = availableModes();
    const body = $('pgBody');
    if (!body) return;
    if (!modes.length) {
      $('pgSubnav').innerHTML = '';
      body.innerHTML = '<div class="notice">这个学习包还没有图卡数据，先去词汇卡页练吧。</div>';
      return;
    }
    if (!modes.some((m) => m.key === PG.mode)) PG.mode = modes[0].key;
    stopAuto();
    $('pgSubnav').innerHTML = modes
      .map((m) => `<button class="pg-chip${m.key === PG.mode ? ' active' : ''}" data-pg="mode" data-mode="${m.key}">${m.label}</button>`)
      .join('');
    ({ look: renderLook, match: renderMatch, pick: renderPick, letters: renderLetters }[PG.mode])();
    bindOnce();
  }

  function bindOnce() {
    if (PG.bound) return;
    PG.bound = true;
    const onTap = (e) => {
      const el = e.target.closest('[data-pg]');
      if (!el) return;
      handle(el, e);
    };
    $('pgSubnav').addEventListener('click', onTap);
    $('pgBody').addEventListener('click', onTap);
  }

  function handle(el, e) {
    const act = el.dataset.pg;
    if (act === 'mode') { PG.mode = el.dataset.mode; render(); return; }

    /* 认一认 */
    if (act === 'lookTap') {
      if (PG.autoOn) { stopAuto(); renderLook(); return; }
      const item = emojiVocab()[PG.lookIdx];
      playAudio(item.audio);
      return;
    }
    if (act === 'lookPlay') {
      const item = emojiVocab()[PG.lookIdx];
      playAudio(item.audio);
      return;
    }
    if (act === 'lookFlip') {
      if (PG.autoOn) stopAuto();
      PG.lookFlipped = !PG.lookFlipped;
      renderLook();
      return;
    }
    if (act === 'lookPrev' || act === 'lookNext') {
      stopAuto();
      const list = emojiVocab();
      if (act === 'lookPrev') PG.lookIdx = (PG.lookIdx - 1 + list.length) % list.length;
      else PG.lookIdx = (PG.lookIdx + 1) % list.length;
      PG.lookFlipped = false;
      renderLook();
      playAudio(list[PG.lookIdx].audio);   // 翻页即发音，强化"图-音"绑定
      return;
    }
    if (act === 'lookAuto') {
      if (PG.autoOn) { stopAuto(); return; }
      PG.autoOn = true;
      el.textContent = '⏸ 停止';
      autoStep();
      return;
    }

    /* 配一配 */
    if (act === 'matchCard') { tapMatchCard(Number(el.dataset.idx), el); return; }
    if (act === 'matchAgain') { newMatch(); renderMatch(); return; }

    /* 听音找图 */
    if (act === 'pickPlay') { playAudio(PG.pickTarget.audio); return; }
    if (act === 'pickOpt') { tapPickOption(Number(el.dataset.idx), el); return; }
    if (act === 'pickNext') { newPick(); renderPick(); return; }

    /* 字母 */
    if (act === 'letterGroup') { PG.letterGroup = el.dataset.group; renderLetters(); return; }
    if (act === 'letterAudio') {
      const l = letters().find((x) => x.id === el.dataset.x);
      if (l) playAudio(l.letterAudio);
      return;
    }
    if (act === 'repAudio' || act === 'mouth') {
      const l = letters().find((x) => x.id === el.dataset.x);
      if (l && l.repAudio) {
        playAudio(l.repAudio);
        if (act === 'mouth') animateMouth(el);
      }
      return;
    }
  }

  function animateMouth(el) {
    el.classList.remove('playing');
    void el.offsetWidth;   // 重启动画
    el.classList.add('playing');
    setTimeout(() => el.classList.remove('playing'), 950);
  }

  /* ---------- 认一认（图卡轮播 + 自动播放） ---------- */
  function renderLook() {
    const list = emojiVocab();
    const item = list[PG.lookIdx] || list[0];
    if (!item) { $('pgBody').innerHTML = ''; return; }
    const ex = item.example;
    $('pgBody').innerHTML = `
      <div class="pg-flipwrap" data-pg="lookTap" title="点卡片听发音">
        <div class="pg-card-inner${PG.lookFlipped ? ' is-flipped' : ''}">
          <div class="pg-face pg-front">
            <div class="pg-emoji">${item.emoji}</div>
            <div class="pg-word">${item.es}</div>
            <div class="pg-taphint">👆 点卡片听发音</div>
          </div>
          <div class="pg-face pg-back">
            <div class="pg-word-sm">${item.es} ${item.emoji}</div>
            <div class="pg-zh">${item.zh}</div>
            ${ex ? `<div class="pg-example">${ex.es}<br><span>${ex.zh}</span></div>` : ''}
            <div class="pg-taphint">👆 再点翻回去</div>
          </div>
        </div>
      </div>
      <div class="pg-ctrls">
        <button class="btn" data-pg="lookPrev">←</button>
        <button class="btn primary" data-pg="lookPlay">🔊 听</button>
        <button class="btn" data-pg="lookFlip">${PG.lookFlipped ? '🙈 遮住' : '🔁 翻面'}</button>
        <button class="btn" data-pg="lookNext">→</button>
      </div>
      <div class="pg-ctrls">
        <button class="btn" id="pgAutoBtn" data-pg="lookAuto">${PG.autoOn ? '⏸ 停止' : '▶ 自动播放'}</button>
      </div>
      <div class="progress">${PG.lookIdx + 1} / ${list.length} · ${PG.autoOn ? '自动播放中，像看小卡片视频一样' : '自动播放 = 卡片自己翻给你看'}</div>`;
  }

  function autoStep() {
    if (!PG.autoOn) return;
    const list = emojiVocab();
    if (!list.length) { stopAuto(); return; }
    PG.lookFlipped = false;
    renderLook();
    playAudio(list[PG.lookIdx].audio);
    later(1300, () => { if (!PG.autoOn) return; PG.lookFlipped = true; renderLook(); });
    later(2900, () => { if (!PG.autoOn) return; PG.lookIdx = (PG.lookIdx + 1) % list.length; });
    later(2950, autoStep);
  }

  /* ---------- 配一配（翻牌配对） ---------- */
  function newMatch() {
    const pairs = shuffle(emojiVocab()).slice(0, 4);
    PG.matchCards = shuffle(
      pairs.flatMap((v) => [
        { v, kind: 'emoji' },
        { v, kind: 'word' },
      ])
    ).map((c) => ({ ...c, state: 'down' }));   // down | up | matched
    PG.matchFirst = -1;
    PG.matchLock = false;
    PG.matchLeft = pairs.length;
  }

  function renderMatch() {
    if (!PG.matchCards.length) newMatch();   // 首次进入发牌；完成后保留庆祝画面，点「再来一轮」重发
    const done = PG.matchLeft === 0;
    $('pgBody').innerHTML = `
      <div class="pg-match-head">
        <span class="badge">配对 ${4 - PG.matchLeft} / 4</span>
        ${done ? '<span class="pg-cheer">🎉 全配对了！</span>' : '<span class="pg-taphint-inline">翻卡片，把 图 ↔ 词 配成一对</span>'}
      </div>
      <div class="pg-grid">
        ${PG.matchCards.map((c, i) => `
          <button class="pg-mcard${c.state === 'up' || c.state === 'matched' ? ' is-up' : ''}${c.state === 'matched' ? ' is-matched' : ''}" data-pg="matchCard" data-idx="${i}">
            <span class="pg-minner">
              <span class="pg-mface pg-mback">🇪🇸</span>
              <span class="pg-mface pg-mfront">${c.kind === 'emoji' ? c.v.emoji : `<b>${c.v.es}</b>`}</span>
            </span>
          </button>`).join('')}
      </div>
      ${done
        ? `<div class="pg-ctrls"><button class="btn primary" data-pg="matchAgain">🔄 再来一轮</button></div>`
        : ''}`;
  }

  function tapMatchCard(idx) {
    const c = PG.matchCards[idx];
    if (!c || PG.matchLock || c.state === 'matched') return;
    if (PG.matchFirst === idx) {   // 点同一张 = 收回
      c.state = 'down';
      PG.matchFirst = -1;
      renderMatch();
      return;
    }
    c.state = 'up';
    if (PG.matchFirst < 0) {
      PG.matchFirst = idx;
      renderMatch();
      return;
    }
    const first = PG.matchCards[PG.matchFirst];
    if (first.v.id === c.v.id) {
      // 配对成功：让翻面动画先走完，再 pop 消失
      const a = PG.matchFirst;
      PG.matchFirst = -1;
      PG.matchLock = true;
      renderMatch();
      setTimeout(() => {
        PG.matchCards[a].state = 'matched';
        PG.matchCards[idx].state = 'matched';
        PG.matchLeft--;
        PG.matchLock = false;
        if (PG.matchLeft === 0) {
          statsAdd('play', true);
          confetti();
        }
        renderMatch();
      }, 420);
    } else {
      // 配错：抖一抖，然后翻回去（不扣分，无挫败感）
      const a = PG.matchFirst;
      PG.matchFirst = -1;
      PG.matchLock = true;
      renderMatch();
      setTimeout(() => {
        const cards = document.querySelectorAll('#pgBody .pg-mcard');
        [a, idx].forEach((i) => cards[i] && cards[i].classList.add('is-shake'));
      }, 250);
      setTimeout(() => {
        PG.matchCards[a].state = 'down';
        PG.matchCards[idx].state = 'down';
        PG.matchLock = false;
        renderMatch();
      }, 900);
    }
  }

  /* ---------- 听音找图 ---------- */
  /** 确保有一道未作答的题（首次进入 / 答对自动下一题） */
  function ensurePickQuestion() {
    if (PG.pickOptions.length) return;
    const list = emojiVocab();
    PG.pickTarget = list[Math.floor(Math.random() * list.length)];
    const others = shuffle(list.filter((v) => v.id !== PG.pickTarget.id)).slice(0, 3);
    PG.pickOptions = shuffle([PG.pickTarget, ...others]);
    PG.pickTried = false;
  }

  function newPick() {
    PG.pickOptions = [];
    ensurePickQuestion();
    renderPick();
    playAudio(PG.pickTarget.audio);
  }

  function renderPick() {
    ensurePickQuestion();
    $('pgBody').innerHTML = `
      <div class="pg-match-head">
        <span class="badge">🔥 连对 ${PG.pickStreak}</span>
        <span class="pg-taphint-inline">听发音，选出对应的图</span>
      </div>
      <button class="sound-btn big play-big" data-pg="pickPlay">🔊 再听一遍</button>
      <div class="pg-grid">
        ${PG.pickOptions.map((v, i) => `
          <button class="pg-pick" data-pg="pickOpt" data-idx="${i}">
            <span class="pg-pick-emoji">${v.emoji}</span>
            <span class="pg-pick-word hidden">${v.es}</span>
          </button>`).join('')}
      </div>
      <div class="progress">答错不扣分，再听听就好</div>`;
  }

  function tapPickOption(idx, el) {
    const v = PG.pickOptions[idx];
    if (!v) return;
    if (v.id === PG.pickTarget.id) {
      el.classList.add('is-right');
      el.querySelector('.pg-pick-word').classList.remove('hidden');
      if (!PG.pickTried) {
        PG.pickStreak++;
        statsAdd('play', true);
        if (PG.pickStreak > 0 && PG.pickStreak % 5 === 0) confetti();
      }
      document.querySelectorAll('#pgBody .pg-pick').forEach((b) => { b.disabled = true; });
      clearTimeout(PG.pickTimer);
      PG.pickTimer = setTimeout(() => { PG.pickTimer = null; newPick(); }, 850);
    } else {
      el.classList.add('is-shake', 'is-wrong');
      if (!PG.pickTried) {
        PG.pickTried = true;
        PG.pickStreak = 0;
        statsAdd('play', false);
      }
      setTimeout(() => el.classList.remove('is-shake'), 500);
    }
  }

  /* ---------- 字母启蒙 ---------- */
  function renderLetters() {
    const all = letters();
    const groups = [...new Set(all.map((l) => l.group).filter(Boolean))];
    if (!groups.some((g) => g === PG.letterGroup)) PG.letterGroup = groups[0] || '';
    const list = all.filter((l) => l.group === PG.letterGroup);
    $('pgBody').innerHTML = `
      <div class="pg-chips">${groups
        .map((g) => `<button class="pg-chip pg-chip-sm${g === PG.letterGroup ? ' active' : ''}" data-pg="letterGroup" data-group="${g}">${g}</button>`)
        .join('')}</div>
      ${list.map((l) => {
        const key = mouthKey(l);
        return `
        <div class="card pg-letter-card">
          <div class="pg-letter-row">
            <div class="pg-letter">${l.letter}</div>
            ${key ? `<button class="pg-mouth" data-pg="mouth" data-x="${l.id}" title="点口型图，听代表词看嘴型">${mouthSVG(key)}</button>` : ''}
          </div>
          ${l.tip ? `<div class="pg-tip">💡 ${l.tip}</div>` : ''}
          <div class="pg-ctrls">
            <button class="btn" data-pg="letterAudio" data-x="${l.id}">🔊 字母名</button>
            ${l.repAudio ? `<button class="btn primary" data-pg="repAudio" data-x="${l.id}">🔊 ${l.rep}</button>` : ''}
          </div>
        </div>`;
      }).join('')}
      <p class="hint">点口型图 = 听代表词、看嘴型动画；点字母名听字母怎么念。</p>`;
  }

  return { render, stopAuto, mouthSVG: mouthSVGFor, confetti };
})();
