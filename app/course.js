/* 课程引擎（M1 语音关）——课程路径页 + 上课流 + 过关测 + 进度模型
 *
 * 依赖 app.js 全局：$、BASE、playAudio、shuffle、statsAdd、loadSRS、isDue、toast
 * 依赖 playground.js：Playground.mouthSVG（口型图）、Playground.confetti（庆祝）
 * 数据：data/curriculum.json（课程地图）+ 各课 pack.json（letters/syllables/cards/vocab/listening）
 * 进度：localStorage ls_course_v1（唯一事实源）→ cloud.js 尽力云同步（失败静默）
 */
'use strict';

window.Course = (() => {
  const KEY = 'ls_course_v1';
  let curriculum = null;      // data/curriculum.json
  let cur = null;             // 正在上的一课 { lesson, pack, steps, pos, quiz }
  const packCache = {};

  /* ---------- 进度模型 ---------- */
  function loadProg() {
    try { const p = JSON.parse(localStorage.getItem(KEY)); return p && typeof p === 'object' ? p : {}; }
    catch { return {}; }
  }
  function saveProg(map) {
    try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* 隐私模式忽略 */ }
    try { if (typeof CLOUD !== 'undefined' && CLOUD.pushCourse) CLOUD.pushCourse(map); } catch { /* 云不可用不影响 */ }
  }
  function lessonProg(id) { return loadProg()[id] || {}; }
  function setLesson(id, patch) {
    const map = loadProg();
    const prev = map[id] || {};
    // done 不降级；best 只升不降
    if (prev.status === 'done' && patch.status !== 'done') patch.status = 'done';
    if (patch.best != null && prev.best != null) patch.best = Math.max(prev.best, patch.best);
    map[id] = { ...prev, ...patch };
    saveProg(map);
  }

  /* ---------- 数据 ---------- */
  /** 课程内音频必须带上所属包的绝对路径：playAudio 只解析「当前练习包」的相对路径，
   *  课程流横跨多个 pack（尤其过关测），直接给相对路径会被解析成练习场当前包的 404 */
  const purl = (pid, rel) => `${BASE}/${pid}/${rel}`;

  async function loadCurriculum() {
    const dataBase = BASE.replace(/\/packs$/, '');
    const res = await fetch(`${dataBase}/curriculum.json`);
    if (!res.ok) throw new Error(`curriculum ${res.status}`);
    return res.json();
  }
  async function getPack(id) {
    if (!packCache[id]) {
      const res = await fetch(`${BASE}/${id}/pack.json`);
      if (!res.ok) throw new Error(`pack ${id} ${res.status}`);
      packCache[id] = await res.json();
    }
    return packCache[id];
  }
  function flatLessons() {
    const out = [];
    (curriculum.units || []).forEach((u) => (u.lessons || []).forEach((l) => out.push({ ...l, unit: u })));
    return out;
  }
  function findLesson(id) { return flatLessons().find((l) => l.id === id); }

  /** 解锁：单元带 requires 时整单元锁定；课带 locked:true 永锁（M2 占位）；否则前一课 done 才解锁，第一课恒开 */
  function lockState(lesson) {
    if (lesson.locked) return 'locked';
    if (lesson.unit && lesson.unit.requires && lessonProg(lesson.unit.requires).status !== 'done') return 'locked';
    const flat = flatLessons();
    const idx = flat.findIndex((l) => l.id === lesson.id);
    if (idx <= 0) return 'open';
    const prev = flat[idx - 1];
    if (prev.unit && prev.unit.requires && !lesson.unit.requires && prev.unit.id !== lesson.unit.id) return 'open';
    return lessonProg(prev.id).status === 'done' ? 'open' : 'locked';
  }

  /* ---------- 顶层渲染 ---------- */
  async function renderInner() {
    const root = $('courseRoot');
    if (!root) return;
    if (!curriculum) {
      try { curriculum = await loadCurriculum(); }
      catch { root.innerHTML = '<div class="notice">课程数据加载失败，请刷新重试。</div>'; return; }
    }
    if (cur) { renderFlow(); return; }   // 恢复正在上的课
    renderPath();
  }

  /** 课程路径页：继续学习卡 + 单元路径 */
  function renderPath() {
    const root = $('courseRoot');
    const flat = flatLessons();
    const next = flat.find((l) => lockState(l) === 'open' && lessonProg(l.id).status !== 'done');
    const doneCount = flat.filter((l) => lessonProg(l.id).status === 'done').length;

    // 到期复习卡总数（SRS 记录跨所有包，直接数 key）
    const srs = loadSRS();
    let due = 0;
    for (const k of Object.keys(srs)) if (isDue(srs[k])) due++;

    root.innerHTML = `
      ${next ? `
      <button class="course-continue" data-course="open" data-id="${next.id}">
        <span class="cc-label">${lessonProg(next.id).status === 'in_progress' ? '▶ 继续学习' : '▶ 开始学习'}</span>
        <span class="cc-title">${next.unit.title} · ${next.title}</span>
        ${due ? `<span class="cc-due">🔔 另有 ${due} 张到期复习卡，可在「练习场 → 词汇卡」开复习模式清掉</span>` : '<span class="cc-due">跟着课程走，每天一节刚刚好</span>'}
      </button>` : `
      <div class="course-continue done"><span class="cc-title">🎉 当前课程全部点亮！</span><span class="cc-due">等新课上线路径会自动生长</span></div>`}

      ${(curriculum.units || []).map((u) => {
        const locked = u.requires && lessonProg(u.requires).status !== 'done';
        return `
        <div class="course-unit">
          <div class="cu-head"><span class="cu-title">${u.title}</span><span class="cu-sub">${u.subtitle || ''}</span></div>
          <div class="cu-path">
            ${(u.lessons || []).map((l) => {
              const st = lessonProg(l.id).status;
              const lock = lockState(l);
              const cls = lock === 'locked' ? 'is-locked' : st === 'done' ? 'is-done' : st === 'in_progress' ? 'is-doing' : '';
              const mark = lock === 'locked' ? '🔒' : st === 'done' ? '⭐' : st === 'in_progress' ? '🔵' : (l.icon || '▫️');
              return `
              <button class="course-node ${cls}" data-course="${lock === 'locked' ? 'hint' : 'open'}" data-id="${l.id}">
                <span class="cn-mark">${mark}</span>
                <span class="cn-body"><span class="cn-title">${l.title}</span>
                  <span class="cn-sub">${lock === 'locked' ? (u.requires ? '先通过拼读过关测解锁' : '完成上一课解锁') : st === 'done' ? '已点亮 · 点这里再练一遍' : lockState(l) === 'open' ? '可学习' : '未解锁'}</span>
                </span>
              </button>`;
            }).join('')}
          </div>
        </div>`;
      }).join('')}

      <div class="progress">已点亮 ${doneCount} / ${flat.length} 节 · 进度自动云同步</div>`;
  }

  /* ---------- 上课流 ---------- */
  async function openLesson(id) {
    const lesson = findLesson(id);
    if (!lesson) return;
    let pack;
    try { pack = await getPack(lesson.pack); }
    catch { toast('课程数据加载失败，请检查网络后重试'); return; }
    const steps = buildSteps(lesson, pack);
    const saved = lessonProg(id);
    cur = { lesson, pack, steps, pos: Math.min(saved.step || 0, steps.length - 1) };
    if (saved.status !== 'done') setLesson(id, { status: 'in_progress' });
    renderFlow();
  }

  function closeLesson() { cur = null; renderPath(); }

  /** 按课型组装步骤序列 */
  function buildSteps(lesson, pack) {
    const flow = lesson.flow || 'rules';
    const steps = [];
    if (flow === 'letters') {
      const groups = [];
      (pack.letters || []).forEach((l) => {
        const g = groups.find((x) => x.group === l.group);
        if (g) g.items.push(l); else groups.push({ group: l.group || '字母', items: [l] });
      });
      groups.forEach((g) => steps.push({ type: 'letters', title: `${g.group}音`, items: g.items, pid: pack.id }));
    } else if (flow === 'syllables') {
      const size = 6;
      for (let i = 0; i < (pack.syllables || []).length; i += size) {
        steps.push({ type: 'syllables', title: `拼读表 ${Math.floor(i / size) + 1}`, items: pack.syllables.slice(i, i + size), pid: pack.id });
      }
    } else if (flow === 'rules') {
      (pack.cards || []).forEach((c) => steps.push({ type: 'card', card: c, pid: pack.id }));
    }
    // 公共环节：认词（有 emoji 词汇时）→ 听辨/音节小练 → 完成
    const emojiVocab = (pack.vocab || []).filter((v) => v.emoji);
    if (emojiVocab.length >= 4) steps.push({ type: 'look', title: '认一认', items: emojiVocab.slice(0, 10), pid: pack.id });
    if (flow === 'syllables') steps.push({ type: 'sylquiz', title: '听音节小练' });
    else if ((pack.listening || []).length) steps.push({ type: 'listen', title: '磨耳朵小练', items: pack.listening, pid: pack.id });
    steps.push({ type: 'done', title: '小结' });
    return steps;
  }

  function renderFlow() {
    const root = $('courseRoot');
    const { lesson, steps, pos } = cur;
    const step = steps[pos];
    root.innerHTML = `
      <div class="flow-head">
        <button class="btn" data-course="close">← 课程</button>
        <div class="fh-info"><span class="fh-title">${lesson.title}</span><span class="fh-step">第 ${pos + 1} / ${steps.length} 步 · ${step.title || ''}</span></div>
        <span class="badge">${lessonProg(lesson.id).status === 'done' ? '⭐ 已点亮' : '🔵 进行中'}</span>
      </div>
      <div id="flowBody"></div>
      <div class="flow-ctrls">
        ${pos > 0 ? '<button class="btn" data-course="prev">← 上一步</button>' : '<span></span>'}
        ${pos < steps.length - 1 ? '<button class="btn primary" data-course="next">下一步 →</button>' : '<span></span>'}
      </div>`;
    const body = $('flowBody');
    ({
      letters: renderLettersStep,
      syllables: renderSyllablesStep,
      card: renderCardStep,
      look: renderLookStep,
      listen: renderListenStep,
      sylquiz: renderSylQuizStep,
      done: renderDoneStep,
      exam: renderExamStep,
    })[step.type](body, step);
    window.scrollTo({ top: 0 });
  }

  function go(delta) {
    if (!cur) return;
    const nextPos = cur.pos + delta;
    if (nextPos < 0 || nextPos >= cur.steps.length) return;
    cur.pos = nextPos;
    setLesson(cur.lesson.id, { step: cur.pos });
    renderFlow();
  }

  /* ---------- 步骤渲染器 ---------- */
  /** 字母组：字母大字 + 可点口型小脸（点脸=听字母名+说话动画）+ 要领 + 发音按钮 */
  function renderLettersStep(body, step) {
    body.innerHTML = step.items.map((l) => {
      const mouth = Playground.mouthSVG(l.letter, l.group);
      const face = mouth
        ? `<button class="pg-mouth" data-course="letter" data-audio="${purl(step.pid, l.letterAudio)}" title="点小脸听字母名">${mouth}</button>`
        : '';
      return `
      <div class="card pg-letter-card">
        <div class="pg-letter-row">
          <div class="pg-letter">${l.letter}</div>
          ${face}
        </div>
        ${l.tip ? `<div class="pg-tip">💡 ${l.tip}</div>` : ''}
        <div class="pg-ctrls">
          <button class="btn" data-course="letter" data-audio="${purl(step.pid, l.letterAudio)}">🔊 字母名</button>
          ${l.repAudio ? `<button class="btn primary" data-course="letter" data-audio="${purl(step.pid, l.repAudio)}">🔊 ${l.rep}</button>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  /** 音节表：辅音行 + 五个可点音节块 + 拼写规则注释 */
  function renderSyllablesStep(body, step) {
    body.innerHTML = step.items.map((g) => `
      <div class="card syl-card">
        <div class="syl-head"><span class="syl-cons">${g.cons}</span>${g.note ? `<span class="syl-note">${g.note}</span>` : ''}</div>
        <div class="syl-row">
          ${g.items.map((s, k) => `<button class="syl-chip" data-course="letter" data-audio="${purl(step.pid, g.audio[k])}">${s}</button>`).join('')}
        </div>
      </div>`).join('') +
      `<p class="hint">每个音节块都能点 🔊。先横着跟读一遍，再竖着随便点着听——听得出区别就赢了。</p>`;
  }

  /** 规则讲解卡：标题 + 要领（支持换行）+ 素材例词（点读，含拆音节展示） */
  function renderCardStep(body, step) {
    const c = step.card;
    body.innerHTML = `
      <div class="card rule-card">
        <div class="rule-title">${c.title}</div>
        <div class="rule-tip">${(c.tip || '').split('。').filter(Boolean).map((s) => `<p>${s}。</p>`).join('')}</div>
        ${(c.mat || []).length ? `
        <div class="rule-mat">
          ${c.mat.map((w, k) => `<button class="syl-chip" data-course="letter" data-audio="${purl(step.pid, c.matAudio[k])}">🔊 ${w}</button>`).join('')}
        </div>` : ''}
      </div>
      <p class="hint">例词可以点读。念的时候注意标题里的规律。</p>`;
  }

  /** 认一认：emoji + 词，点读（学习态，非测验） */
  function renderLookStep(body, step) {
    body.innerHTML = `
      <div class="look-grid">
        ${step.items.map((v) => `
        <button class="look-card" data-course="letter" data-audio="${purl(step.pid, v.audio)}">
          <span class="pg-pick-emoji">${v.emoji}</span>
          <span class="look-word">${v.es}</span>
          <span class="look-zh">${v.zh}</span>
        </button>`).join('')}
      </div>
      <p class="hint">点卡片听发音。对照中文记一遍，下一步要考耳朵。</p>`;
  }

  /** 听辨小练：复用听辨逻辑（一轮 6 题） */
  function renderListenStep(body, step) {
    const items = shuffle(step.items).slice(0, 6).map((it) => ({ ...it, pid: step.pid }));
    cur.quiz = { items, pos: 0, right: 0, answer: 0, answered: false };
    renderListenQ(body);
  }
  function renderListenQ(body) {
    const q = cur.quiz;
    const item = q.items[q.pos];
    if (!item) {
      body.innerHTML = `<div class="card done-card"><div class="rule-title">小练完成 ${q.right} / ${q.items.length} ✅</div>
        <p class="hint">${q.right === q.items.length ? '全对！这对耳朵可以出师了' : '错过的题下一步还能再来'}</p></div>`;
      return;
    }
    q.answer = Math.random() < 0.5 ? 0 : 1;
    q.answered = false;
    body.innerHTML = `
      <div class="card quiz-card">
        <span class="badge">${item.category}</span>
        <button class="sound-btn big play-big" data-course="letter" data-audio="${purl(item.pid, item.audio[q.answer])}">🔊 听</button>
        <div class="listen-options">
          ${item.pair.map((w, i) => `<button class="btn" data-course="listenOpt" data-i="${i}">${w}</button>`).join('')}
        </div>
        <div class="feedback hidden" id="cqFb"></div>
        <div class="progress">${q.pos + 1} / ${q.items.length} · 对 ${q.right}</div>
      </div>`;
  }
  function answerListen(i) {
    const q = cur.quiz;
    if (q.answered) return;
    q.answered = true;
    const ok = i === q.answer;
    if (ok) q.right++;
    statsAdd('listening', ok);
    const btns = $('flowBody').querySelectorAll('[data-course="listenOpt"]');
    btns.forEach((b, idx) => {
      b.disabled = true;
      if (idx === q.answer) b.classList.add('correct');
      else if (idx === i) b.classList.add('wrong');
    });
    const fb = $('cqFb');
    fb.classList.remove('hidden');
    fb.classList.add(ok ? 'ok' : 'no');
    fb.innerHTML = `${ok ? '✓ 对了！' : `✗ 是「${q.items[q.pos].pair[q.answer]}」`} ${q.items[q.pos].zh || ''}`;
    setTimeout(() => { q.pos++; renderListenQ($('flowBody')); }, ok ? 700 : 1400);
  }

  /** 音节小练：从音节表现场出 6 题（易混辅音对优先做干扰项） */
  function renderSylQuizStep(body) {
    const all = [];
    (cur.pack.syllables || []).forEach((g) => g.items.forEach((s, k) => all.push({ syl: s, audio: g.audio[k], cons: g.cons })));
    const CONFUSE = { p: 'b', b: 'p', t: 'd', d: 't', l: 'r', r: 'l', rr: 'r', g: 'j', j: 'g', s: 'z', z: 's', m: 'n', n: 'm', ll: 'y', y: 'll', f: 'v', v: 'f' };
    cur.quiz = { qs: [], pos: 0, right: 0, answered: false };
    for (let n = 0; n < 6 && all.length > 3; n++) {
      const target = all[Math.floor(Math.random() * all.length)];
      const mate = all.filter((x) => x.cons === (CONFUSE[target.cons] || target.cons) && x.syl !== target.syl);
      const others = shuffle(all.filter((x) => x.syl !== target.syl && x.cons !== target.cons));
      const opts = shuffle([target, ...shuffle(mate).slice(0, 1), ...others.slice(0, 2)]).slice(0, 4);
      cur.quiz.qs.push({ target, opts, answer: opts.indexOf(target) });
    }
    renderSylQ(body);
  }
  function renderSylQ(body) {
    const q = cur.quiz;
    const item = q.qs[q.pos];
    if (!item) {
      body.innerHTML = `<div class="card done-card"><div class="rule-title">音节小练完成 ${q.right} / ${q.qs.length} ✅</div>
        <p class="hint">${q.right === q.qs.length ? '全对！拼读耳朵已经上线' : '继续磨，错的音节回上一节再点点'}</p></div>`;
      return;
    }
    q.answered = false;
    body.innerHTML = `
      <div class="card quiz-card">
        <span class="badge">听音节</span>
        <button class="sound-btn big play-big" data-course="letter" data-audio="${item.target.audio}">🔊 听</button>
        <div class="syl-quiz-row">
          ${item.opts.map((o, i) => `<button class="btn syl-opt" data-course="sylOpt" data-i="${i}">${o.syl}</button>`).join('')}
        </div>
        <div class="feedback hidden" id="cqFb"></div>
        <div class="progress">${q.pos + 1} / ${q.qs.length} · 对 ${q.right}</div>
      </div>`;
  }
  function answerSyl(i) {
    const q = cur.quiz;
    if (q.answered) return;
    q.answered = true;
    const item = q.qs[q.pos];
    const ok = i === item.answer;
    if (ok) q.right++;
    statsAdd('play', ok);
    const btns = $('flowBody').querySelectorAll('[data-course="sylOpt"]');
    btns.forEach((b, idx) => {
      b.disabled = true;
      if (idx === item.answer) b.classList.add('correct');
      else if (idx === i) b.classList.add('wrong');
    });
    const fb = $('cqFb');
    fb.classList.remove('hidden');
    fb.classList.add(ok ? 'ok' : 'no');
    fb.textContent = ok ? '✓ 对了！' : `✗ 是「${item.target.syl}」`;
    setTimeout(() => { q.pos++; renderSylQ($('flowBody')); }, ok ? 700 : 1400);
  }

  /** 小结：点亮本课 */
  function renderDoneStep(body) {
    const { lesson } = cur;
    body.innerHTML = `
      <div class="card done-card">
        <div class="done-emoji">🌟</div>
        <div class="rule-title">「${lesson.title}」走完了！</div>
        <p class="hint">点下面的按钮点亮这节课${lesson.flow === 'exam' ? '' : '，下一节随之解锁'}。以后随时可以回来重练。</p>
        <button class="btn primary big-finish" data-course="finish">✅ 完成并点亮</button>
      </div>`;
  }
  function finishLesson() {
    setLesson(cur.lesson.id, { status: 'done' });
    Playground.confetti();
    closeLesson();
  }

  /* ---------- 过关测（fon-quiz）：三包混合 15 题，≥80% 点亮 ---------- */
  async function openExam(lesson) {
    toast('正在组卷…');
    const packs = [];
    for (const pid of lesson.packs || []) {
      try { packs.push(await getPack(pid)); } catch { /* 缺包跳过 */ }
    }
    const syll = [];
    const words = [];
    const stress = [];
    packs.forEach((p) => {
      (p.syllables || []).forEach((g) => g.items.forEach((s, k) => syll.push({ syl: s, audio: g.audio[k], cons: g.cons, pid: p.id })));
      (p.vocab || []).filter((v) => v.emoji).forEach((v) => words.push({ ...v, pid: p.id }));
      (p.listening || []).forEach((l) => stress.push({ ...l, pid: p.id }));
    });
    const CONFUSE = { p: 'b', b: 'p', t: 'd', d: 't', l: 'r', r: 'l', rr: 'r', g: 'j', j: 'g', s: 'z', z: 's', m: 'n', n: 'm' };
    const qs = [];
    const nPer = Math.ceil((lesson.questionCount || 15) / 3);
    for (let i = 0; i < nPer && syll.length > 3; i++) {
      const target = syll[Math.floor(Math.random() * syll.length)];
      const mate = syll.filter((x) => x.cons === (CONFUSE[target.cons] || target.cons) && x.syl !== target.syl);
      const opts = shuffle([target, ...shuffle(mate).slice(0, 1), ...shuffle(syll.filter((x) => x.syl !== target.syl && x.cons !== target.cons)).slice(0, 2)]).slice(0, 4);
      qs.push({ kind: 'syl', target, opts, answer: opts.indexOf(target) });
    }
    for (let i = 0; i < nPer && words.length > 3; i++) {
      const target = words[Math.floor(Math.random() * words.length)];
      const opts = shuffle([target, ...shuffle(words.filter((w) => w.id !== target.id)).slice(0, 3)]);
      qs.push({ kind: 'word', target, opts, answer: opts.indexOf(target) });
    }
    for (let i = 0; i < nPer && stress.length; i++) {
      const item = stress[Math.floor(Math.random() * stress.length)];
      const answer = Math.random() < 0.5 ? 0 : 1;
      qs.push({ kind: 'stress', item, answer });
    }
    cur = {
      lesson, pack: packs[0], steps: [{ type: 'exam', title: '拼读过关测' }], pos: 0,
      quiz: { qs, pos: 0, right: 0, answered: false, total: qs.length, pass: lesson.passScore || 0.8 },
      isExam: true,   // sylOpt 等选项路由到 answerExam 而不是普通小练
    };
    setLesson(lesson.id, { status: 'in_progress' });
    renderFlow();
  }
  function renderExamStep(body) {
    const q = cur.quiz;
    const item = q.qs[q.pos];
    if (!item) {
      const pct = q.total ? q.right / q.total : 0;
      const pass = pct >= q.pass;
      body.innerHTML = `
        <div class="card done-card">
          <div class="done-emoji">${pass ? '🏆' : '💪'}</div>
          <div class="rule-title">${q.right} / ${q.total}（${Math.round(pct * 100)}%）</div>
          ${pass
            ? '<p class="hint">🎉 过关！语音关毕业——课程路径里的现代西语第一册已解锁。</p>'
            : `<p class="hint">还差一点：过关线 ${Math.round(q.pass * 100)}%。错题多听听音频，随时重考（不限次数）。</p>`}
          <div class="pg-ctrls">
            <button class="btn" data-course="close">← 回课程</button>
            ${pass ? '' : '<button class="btn primary" data-course="retake">🔄 再考一次</button>'}
            ${pass ? '<button class="btn primary" data-course="claim">✅ 领取过关</button>' : ''}
          </div>
        </div>`;
      if (pass) Playground.confetti();
      return;
    }
    q.answered = false;
    let inner = '';
    if (item.kind === 'syl') {
      inner = `
        <button class="sound-btn big play-big" data-course="letter" data-audio="${purl(item.target.pid, item.target.audio)}">🔊 听</button>
        <div class="syl-quiz-row">${item.opts.map((o, i) => `<button class="btn syl-opt" data-course="sylOpt" data-i="${i}">${o.syl}</button>`).join('')}</div>`;
    } else if (item.kind === 'word') {
      inner = `
        <button class="sound-btn big play-big" data-course="letter" data-audio="${purl(item.target.pid, item.target.audio)}">🔊 听</button>
        <div class="look-grid look-grid-quiz">${item.opts.map((o, i) => `
          <button class="look-card" data-course="wordOpt" data-i="${i}"><span class="pg-pick-emoji">${o.emoji}</span></button>`).join('')}</div>`;
    } else {
      inner = `
        <span class="badge">重音 ${item.item.category}</span>
        <button class="sound-btn big play-big" data-course="letter" data-audio="${purl(item.item.pid, item.item.audio[item.answer])}">🔊 听</button>
        <div class="listen-options">${item.item.pair.map((w, i) => `<button class="btn" data-course="stressOpt" data-i="${i}">${w}</button>`).join('')}</div>`;
    }
    body.innerHTML = `
      <div class="card quiz-card">
        <div class="listen-head"><span class="badge">第 ${q.pos + 1} / ${q.total} 题</span><span class="score">✓ ${q.right}</span></div>
        ${inner}
        <div class="feedback hidden" id="cqFb"></div>
      </div>`;
    // 首题自动播一遍
    const first = body.querySelector('.play-big');
    if (first && q.pos === 0) setTimeout(() => first.click(), 400);
  }
  function answerExam(kind, i) {
    const q = cur.quiz;
    const item = q.qs[q.pos];
    if (q.answered) return;
    q.answered = true;
    const ok = i === item.answer;
    if (ok) q.right++;
    statsAdd('play', ok);
    const sel = kind === 'syl' ? '[data-course="sylOpt"]' : kind === 'word' ? '[data-course="wordOpt"]' : '[data-course="stressOpt"]';
    $('flowBody').querySelectorAll(sel).forEach((b, idx) => {
      b.disabled = true;
      if (idx === item.answer) b.classList.add('correct');
      else if (idx === i) b.classList.add('wrong');
    });
    const fb = $('cqFb');
    fb.classList.remove('hidden');
    fb.classList.add(ok ? 'ok' : 'no');
    const rightText = item.kind === 'syl' ? item.target.syl : item.kind === 'word' ? item.target.es : item.item.pair[item.answer];
    fb.textContent = ok ? '✓ 对了！' : `✗ 正确答案：${rightText}`;
    setTimeout(() => { q.pos++; renderExamStep($('flowBody')); }, ok ? 700 : 1500);
  }

  /* ---------- 事件 ---------- */
  function onTap(e) {
    const el = e.target.closest('[data-course]');
    if (!el) return;
    const act = el.dataset.course;
    if (act === 'open') {
      const id = el.dataset.id;
      const lesson = findLesson(id);
      if (lesson && lesson.flow === 'exam') openExam(lesson); else openLesson(id);
    }
    else if (act === 'close') closeLesson();
    else if (act === 'prev') go(-1);
    else if (act === 'next') go(1);
    else if (act === 'finish') finishLesson();
    else if (act === 'retake') openExam(cur.lesson);
    else if (act === 'claim') finishLesson();
    else if (act === 'letter') {
      playAudio(el.dataset.audio);
      // 点口型小脸时触发"说话"动画
      if (el.classList.contains('pg-mouth')) {
        el.classList.remove('playing');
        void el.offsetWidth;
        el.classList.add('playing');
        setTimeout(() => el.classList.remove('playing'), 950);
      }
    }
    else if (act === 'listenOpt') answerListen(Number(el.dataset.i));
    else if (act === 'sylOpt') { cur && cur.isExam ? answerExam('syl', Number(el.dataset.i)) : answerSyl(Number(el.dataset.i)); }
    else if (act === 'wordOpt' || act === 'stressOpt') answerExam(act === 'wordOpt' ? 'word' : 'stress', Number(el.dataset.i));
    else if (act === 'hint') toast('🔒 先完成前面的课，这里会自动解锁');
  }

  function bindOnce() {
    const root = $('courseRoot');
    if (!root || root.dataset.bound) return;
    root.dataset.bound = '1';
    root.addEventListener('click', onTap);
  }

  function render() {
    bindOnce();
    return renderInner();
  }

  return { render, closeLesson };
})();
