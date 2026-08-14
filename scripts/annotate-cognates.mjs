#!/usr/bin/env node
/**
 * annotate-cognates.mjs — 用 DeepSeek API 为学习包词汇标注英语同源词（同源词桥）
 *
 * 用法：
 *   node scripts/annotate-cognates.mjs            # 标注全部学习包（跳过已标注）
 *   node scripts/annotate-cognates.mjs <packId>   # 只标注一个包
 *   node scripts/annotate-cognates.mjs --all --force  # 强制重新标注
 *
 * API Key 来源（按顺序）：
 *   1. 环境变量 DEEPSEEK_API_KEY
 *   2. ~/.pi/agent/auth.json 的 deepseek.key（本机 pi 凭据）
 *   3. 项目 .env 文件（DEEPSEEK_API_KEY=xxx）
 *
 * 产物：pack.json 的 vocab[].cognate（英语同源词，无同源则 null）+ meta.cognates 记录
 * 前端词汇卡翻面时显示 "💡 英语同源：xxx"，帮学习者白捡词汇量。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKS = join(ROOT, 'data', 'packs');

function findKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY.trim();
  const envPath = join(ROOT, '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*DEEPSEEK_API_KEY\s*=\s*(.+)\s*$/);
      if (m) return m[1].trim();
    }
  }
  const authPath = join(homedir(), '.pi', 'agent', 'auth.json');
  try {
    const auth = JSON.parse(readFileSync(authPath, 'utf8'));
    if (auth.deepseek && auth.deepseek.key) return String(auth.deepseek.key);
  } catch {}
  return null;
}

const API_KEY = findKey();
if (!API_KEY) {
  console.error('✗ 未找到 DeepSeek API Key（env DEEPSEEK_API_KEY / 项目 .env / ~/.pi/agent/auth.json）');
  process.exit(1);
}

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const ALL = args.includes('--all');
const packIdArg = args.find((a) => !a.startsWith('--'));

const MODEL = 'deepseek-chat';

async function annotateWords(words) {
  const prompt = `你是英语-西班牙语同源词专家。以下是西语单词列表（JSON 数组，元素 {id, es}）。
对每个词：如果英语中存在**同源词**（同词源、拼写或发音明显相关、A1 学习者一眼能认出的），给出那个英语单词（原形）；否则返回 null。
规则：只标"学习者真能认出来"的同源词；词形或意思差异过大的不要标；每个词最多给 1 个；一律小写。
严格只输出 JSON，不要任何其他文字：
[{"id": "...", "cognate": "english word 或 null"}, ...]`;
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + API_KEY },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: '你是严谨的英语-西班牙语同源词标注器，只输出 JSON。' },
        { role: 'user', content: prompt + '\n' + JSON.stringify(words) },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  const json = text.replace(/^```(json)?\s*/, '').replace(/\s*```$/, '').trim();
  return JSON.parse(json);
}

async function annotatePack(packId) {
  const packPath = join(PACKS, packId, 'pack.json');
  if (!existsSync(packPath)) {
    console.error(`✗ 未找到学习包：${packPath}`);
    return 0;
  }
  const pack = JSON.parse(readFileSync(packPath, 'utf8'));
  const todo = pack.vocab.filter((v) => FORCE || v.cognate === undefined);
  if (!todo.length) {
    console.log(`  ${packId}：全部已标注，跳过（--force 可重标）`);
    return 0;
  }
  const result = await annotateWords(todo.map((v) => ({ id: v.id, es: v.es })));
  const byId = new Map(result.map((r) => [r.id, r]));
  let hits = 0;
  for (const v of todo) {
    const c = byId.get(v.id)?.cognate ?? null;
    v.cognate = c && typeof c === 'string' && c.toLowerCase() !== 'null' ? c.toLowerCase() : null;
    if (v.cognate) hits++;
  }
  pack.meta.cognates = {
    engine: 'deepseek',
    model: MODEL,
    date: new Date().toISOString().slice(0, 10),
    annotated: todo.length,
  };
  writeFileSync(packPath, JSON.stringify(pack, null, 2) + '\n');
  console.log(`  ${packId}：标注 ${todo.length} 词，命中同源 ${hits} 个`);
  return hits;
}

let targets = [];
if (ALL) {
  targets = readdirSync(PACKS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(PACKS, d.name, 'pack.json')))
    .map((d) => d.name);
} else if (packIdArg) {
  targets = [packIdArg];
} else {
  targets = readdirSync(PACKS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(PACKS, d.name, 'pack.json')))
    .map((d) => d.name);
}

console.log(`用 DeepSeek（${MODEL}）标注 ${targets.length} 个学习包…`);
let totalHits = 0;
for (const id of targets) {
  try {
    totalHits += await annotatePack(id);
  } catch (err) {
    console.error(`✗ ${id} 失败：${err.message}`);
  }
}
console.log(`✓ 完成，共命中同源词 ${totalHits} 个。`);
