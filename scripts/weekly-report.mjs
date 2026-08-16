#!/usr/bin/env node
/**
 * weekly-report.mjs — 喂料者周报：读取学习者的云端学习记录，生成一周总结
 *
 * 用法：
 *   node scripts/weekly-report.mjs            # 最近 7 天
 *   node scripts/weekly-report.mjs 14         # 最近 N 天
 *
 * 依赖：.env 中的 SUPABASE_URL + SUPABASE_SERVICE_ROLE（服务端专用，勿进网页）
 * 数据来源：Supabase activity（每日练习量/正确率）+ srs（间隔重复状态）
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DAYS = Number(process.argv[2] || 7);

// 读 .env（键值行，忽略注释与空行）
const env = {};
for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !m[1].startsWith('#')) env[m[1]] = m[2];
}
const URL = env.SUPABASE_URL;
const SR = env.SUPABASE_SERVICE_ROLE;
if (!URL || !SR) {
  console.error('缺少 .env 中的 SUPABASE_URL / SUPABASE_SERVICE_ROLE');
  process.exit(1);
}
const H = { apikey: SR, Authorization: `Bearer ${SR}` };

const from = new Date();
from.setDate(from.getDate() - (DAYS - 1));

async function get(path) {
  const res = await fetch(`${URL}${path}`, { headers: H });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`);
  return res.json();
}

const act = await get(`/rest/v1/activity?select=day,type,correct,total&day=gte.${from.toISOString().slice(0, 10)}&order=day`);
const srs = await get('/rest/v1/srs?select=due_date,card_key');

// 聚合
const byDay = {};
let sum = { listening: 0, listeningRight: 0, dictation: 0, review: 0 };
for (const a of act) {
  byDay[a.day] = (byDay[a.day] || 0) + Number(a.total || 0);
  if (a.type === 'listening') { sum.listening += Number(a.total || 0); sum.listeningRight += Number(a.correct || 0); }
  if (a.type === 'dictation') sum.dictation += Number(a.total || 0);
  if (a.type === 'review') sum.review += Number(a.total || 0);
}
const activeDays = Object.keys(byDay).length;
const dueNow = srs.filter((r) => r.due_date && r.due_date <= new Date().toISOString().slice(0, 10)).length;

console.log(`📊 学习周报（最近 ${DAYS} 天，截至 ${new Date().toISOString().slice(0, 10)}）`);
console.log('─'.repeat(40));
console.log(`📅 练习天数：${activeDays} 天（共 ${DAYS} 天）`);
console.log(`🎧 听辨：${sum.listening} 题，答对 ${sum.listeningRight}（${sum.listening ? Math.round(sum.listeningRight / sum.listening * 100) : 0}%）`);
console.log(`✍️ 听写：${sum.dictation} 句`);
console.log(`🔄 复习：${sum.review} 卡`);
console.log(`📚 SRS 已学卡片：${srs.length} 张，今天到期 ${dueNow} 张`);
console.log('─'.repeat(40));
if (activeDays === 0) {
  console.log('⚠️ 本周还没有练习记录——提醒她开始 15 分钟循环。');
} else if (sum.listening > 0 && sum.listeningRight / sum.listening < 0.6) {
  console.log('💡 听辨正确率偏低：建议复习最近课程的听辨题，重点难点音素（b/v、r/rr）。');
} else if (dueNow > 20) {
  console.log('💡 到期卡片较多：建议本周安排一次集中复习（或导入 Anki 用它的排期）。');
} else {
  console.log('👍 状态良好，保持节奏。');
}
