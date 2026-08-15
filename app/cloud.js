'use strict';
/**
 * cloud.js — v0.5 学习记录上云（Supabase，零依赖，纯 fetch）
 *
 * 设计原则：
 *  - 本地 localStorage 是唯一事实源（离线照常练），云端是备份 + 跨设备介质；
 *  - 匿名身份（无需注册登录），RLS 保证只能读写自己的行；
 *  - 所有云端操作失败静默（断网/梯子断连不影响练习），联网后下次操作自动补同步；
 *  - 密钥：anon key 可公开（RLS 保护数据），见 docs/supabase-schema.sql。
 *
 * 集成点（app.js）：
 *  - init 时  Cloud.init().then(pullSRS 合并本地)
 *  - saveSRS 后 Cloud.pushSRS(map)
 *  - saveStats 后 Cloud.pushStats(s)
 */
const CLOUD = (() => {
  const URL = 'https://hkveygcfsmoqeanhtntt.supabase.co';
  const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrdmV5Z2Nmc21vcWVhbmh0bnR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4MDAxNjAsImV4cCI6MjEwMjM3NjE2MH0.Ai-76I88aZymKJEMz4nDyb_8VOy7i4M5FZrnC2wh8Uw';
  const AUTH_KEY = 'ls_cloud_auth';
  const SRS_TABLE = 'srs';
  const ACT_TABLE = 'activity';

  let auth = null;   // { access_token, refresh_token, user_id }

  function loadAuth() {
    try {
      const raw = JSON.parse(localStorage.getItem(AUTH_KEY));
      if (raw && raw.access_token) { auth = raw; return true; }
    } catch { /* 忽略 */ }
    return false;
  }
  function saveAuth(a) {
    auth = a;
    try { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); } catch { /* 忽略 */ }
  }

  /** 匿名注册拿身份；已有 token 且未过期直接复用 */
  async function ensureAuth() {
    if (auth && auth.access_token) return true;
    if (loadAuth() && auth.access_token) return true;
    try {
      const res = await fetch(`${URL}/auth/v1/signup`, {
        method: 'POST',
        headers: { 'apikey': ANON, 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) return false;
      const d = await res.json();
      saveAuth({ access_token: d.access_token, refresh_token: d.refresh_token, user_id: d.user && d.user.id });
      return true;
    } catch { return false; }
  }

  /** 401 时用 refresh_token 换新令牌（匿名会话续期） */
  async function refreshAuth() {
    if (!auth || !auth.refresh_token) return false;
    try {
      const res = await fetch(`${URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'apikey': ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: auth.refresh_token }),
      });
      if (!res.ok) return false;
      const d = await res.json();
      saveAuth({ access_token: d.access_token, refresh_token: d.refresh_token, user_id: auth.user_id });
      return true;
    } catch { return false; }
  }

  async function api(path, opts) {
    if (!(await ensureAuth())) return null;
    const doFetch = (token) => fetch(`${URL}${path}`, {
      ...opts,
      headers: { 'apikey': ANON, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    let res = await doFetch(auth.access_token);
    if (res.status === 401 && (await refreshAuth())) res = await doFetch(auth.access_token);
    return res;
  }

  /** 云端 SRS 全量拉取 → 合并进本地 map（云端有、本地没有的键并入）；返回是否有新增 */
  async function pullSRS(localMap) {
    try {
      const res = await api(`/rest/v1/${SRS_TABLE}?select=card_key,interval_days,ease,due_date,lapses,updated_at`, { method: 'GET' });
      if (!res || !res.ok) return false;
      const rows = await res.json();
      if (!Array.isArray(rows)) return false;
      let merged = false;
      for (const r of rows) {
        if (!r.card_key || localMap[r.card_key]) continue;
        localMap[r.card_key] = {
          ease: r.ease != null ? r.ease : 2.5,
          interval: r.interval_days != null ? r.interval_days : 0,
          due: r.due_date || '',
          lapses: r.lapses != null ? r.lapses : 0,
          reps: 0,
        };
        merged = true;
      }
      return merged;
    } catch { return false; }
  }

  /** 本地 SRS 全量推送（upsert，按 user_id+card_key 合并） */
  async function pushSRS(localMap) {
    try {
      const rows = Object.entries(localMap || {}).map(([key, rec]) => ({
        card_key: key,
        interval_days: rec.interval || 0,
        ease: rec.ease != null ? rec.ease : 2.5,
        due_date: rec.due || '2000-01-01',
        lapses: rec.lapses || 0,
        updated_at: new Date().toISOString(),
      }));
      if (!rows.length) return false;
      const res = await api(`/rest/v1/${SRS_TABLE}`, {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows),
      });
      return !!res && res.ok;
    } catch { return false; }
  }

  /** 今日统计推送（按 user_id+day+type upsert） */
  async function pushStats(s) {
    if (!s || !s.date) return false;
    const rows = [
      { day: s.date, type: 'listening', correct: s.listeningRight || 0, total: s.listeningDone || 0 },
      { day: s.date, type: 'dictation', correct: s.dictationDone || 0, total: s.dictationDone || 0 },
      { day: s.date, type: 'review', correct: s.reviewCards || 0, total: s.reviewCards || 0 },
    ];
    try {
      const res = await api(`/rest/v1/${ACT_TABLE}`, {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows),
      });
      return !!res && res.ok;
    } catch { return false; }
  }

  /** 拉取近期活动（v0.6 报告页热力图用）；返回 [{day,type,correct,total}]，失败返回 [] */
  async function pullActivity(days) {
    try {
      const limit = Number(days) || 90;
      const res = await api(`/rest/v1/${ACT_TABLE}?select=day,type,correct,total&order=day.desc&limit=${limit}`, { method: 'GET' });
      if (!res || !res.ok) return [];
      const rows = await res.json();
      return Array.isArray(rows) ? rows : [];
    } catch { return []; }
  }

  return {
    init: ensureAuth,
    pullSRS,
    pushSRS,
    pushStats,
    get auth() { return auth; },
  };
})();
