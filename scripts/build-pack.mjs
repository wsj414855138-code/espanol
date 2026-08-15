#!/usr/bin/env node
/**
 * build-pack.mjs — 把 data/raw/<pack>/source.md 解析为 data/packs/<pack>/pack.json
 *
 * 用法：
 *   node scripts/build-pack.mjs <packId>      # 构建一个包
 *   node scripts/build-pack.mjs --all         # 构建 data/raw/ 下所有包
 *
 * 产物（勿手改，重新运行本脚本即可再生成）：
 *   data/packs/<pack>/pack.json
 *   data/packs/index.json                     # 所有包的清单（练习页读取）
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = join(ROOT, 'data', 'raw');
const PACKS_DIR = join(ROOT, 'data', 'packs');

const stripMd = (s) => s.replace(/[`*_]/g, '').trim();

function parseTableRow(line) {
  // "| a | b | c |" -> ["a", "b", "c"]；跳过分隔行
  let cells = line.split('|').map((c) => c.trim());
  if (cells[0] === '') cells.shift();
  if (cells[cells.length - 1] === '') cells.pop();
  return cells;
}

const isSeparatorRow = (cells) =>
  cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));

// 表头行（各小节表格的列名）不参与数据解析
const HEADER_TOKENS = ['西语', '中文', '类别', '词A', '词B', '说明', '例句（西语）', '例句（中文）'];
const isHeaderRow = (cells) => cells.some((c) => HEADER_TOKENS.includes(stripMd(c)));

function parseSource(md) {
  const result = { title: '', meta: {}, vocab: [], listening: [], sentences: [] };
  let section = null;
  let headerDone = false;

  for (const rawLine of md.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('# ') && !headerDone) {
      result.title = stripMd(line.slice(2));
      headerDone = true;
      continue;
    }
    if (line.startsWith('## ')) {
      section = line.slice(3).trim();
      continue;
    }
    if (line.startsWith('> meta')) {
      // 例如：> meta: order=1, level=A1, source=教材《现代西班牙语》第1课
      const body = line.replace(/^>\s*meta\s*:\s*/, '');
      for (const kv of body.split(',')) {
        const [k, ...v] = kv.split('=');
        if (k) result.meta[k.trim()] = v.join('=').trim();
      }
      continue;
    }
    if (!section || !line.startsWith('|')) continue;

    const cells = parseTableRow(line);
    if (isSeparatorRow(cells) || isHeaderRow(cells)) continue;

    if (section === '词汇') {
      const [es, zh, exEs, exZh] = cells.map(stripMd);
      if (!es || !zh) continue;
      const example =
        exEs && exZh && exEs !== '—'
          ? { es: exEs, zh: exZh }
          : null;
      result.vocab.push({ es, zh, example });
    } else if (section === '听辨') {
      const [category, a, b, zh] = cells.map(stripMd);
      if (!category || !a || !b) continue;
      result.listening.push({ category, pair: [a, b], zh: zh || '' });
    } else if (section === '句型') {
      const [es, zh] = cells.map(stripMd);
      if (!es) continue;
      result.sentences.push({ es, zh: zh || '' });
    }
  }
  return result;
}

function inferLevel(packId) {
  const m = packId.match(/^(a1|a2|b1|b2|c1|c2)/i);
  return m ? m[1].toUpperCase() : '';
}

function buildPack(packId) {
  const rawPath = join(RAW_DIR, packId, 'source.md');
  if (!existsSync(rawPath)) {
    console.error(`✗ 未找到原料：${rawPath}`);
    return null;
  }
  const src = parseSource(readFileSync(rawPath, 'utf8'));
  if (!src.title) src.title = packId;

  const level = src.meta.level || inferLevel(packId);
  const pack = {
    id: packId,
    title: src.title,
    meta: {
      level,
      source: src.meta.source || '待补充来源',
      ...(src.meta.order !== undefined ? { order: Number(src.meta.order) } : {}),
    },
    vocab: src.vocab.map((v, i) => ({
      id: `v${i + 1}`,
      es: v.es,
      zh: v.zh,
      ...(v.example ? { example: v.example } : {}),
      audio: `audio/v${i + 1}.m4a`,
      ...(v.example ? { exampleAudio: `audio/v${i + 1}-ex.m4a` } : {}),
    })),
    listening: src.listening.map((l, i) => ({
      id: `l${i + 1}`,
      category: l.category,
      pair: l.pair,
      zh: l.zh,
      audio: [`audio/l${i + 1}-0.m4a`, `audio/l${i + 1}-1.m4a`],
    })),
    sentences: src.sentences.map((s, i) => ({
      id: `s${i + 1}`,
      es: s.es,
      zh: s.zh,
      audio: `audio/s${i + 1}.m4a`,
      audioSlow: `audio/s${i + 1}-slow.m4a`,
    })),
  };

  const outDir = join(PACKS_DIR, packId);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'pack.json'), JSON.stringify(pack, null, 2) + '\n');
  return pack;
}

function refreshIndex() {
  const packs = readdirSync(PACKS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(PACKS_DIR, d.name, 'pack.json')))
    .map((d) => {
      const p = JSON.parse(readFileSync(join(PACKS_DIR, d.name, 'pack.json'), 'utf8'));
      return { id: p.id, title: p.title, level: p.meta?.level || '', order: p.meta?.order };
    })
    // 按课本课程顺序排序（meta.order）；无 order 的按 id 排最后
    .sort((a, b) => {
      const oa = a.order ?? 1e9, ob = b.order ?? 1e9;
      if (oa !== ob) return oa - ob;
      return a.id.localeCompare(b.id);
    });
  writeFileSync(join(PACKS_DIR, 'index.json'), JSON.stringify(packs, null, 2) + '\n');
  return packs;
}

const arg = process.argv[2];
let built = [];
if (arg === '--all') {
  for (const d of readdirSync(RAW_DIR, { withFileTypes: true })) {
    // 只处理含 source.md 的学习包目录（跳过 ocr-draft 等素材目录）
    if (d.isDirectory() && existsSync(join(RAW_DIR, d.name, 'source.md'))) {
      const p = buildPack(d.name);
      if (p) built.push(p);
    }
  }
} else if (arg) {
  const p = buildPack(arg);
  if (p) built.push(p);
} else {
  console.error('用法：node scripts/build-pack.mjs <packId> 或 --all');
  process.exit(1);
}

if (built.length === 0) process.exit(1);
refreshIndex();
console.log(`✓ 构建 ${built.length} 个学习包：`);
for (const p of built) {
  console.log(`  - ${p.id}：${p.title}（词汇 ${p.vocab.length}，听辨 ${p.listening.length}，句型 ${p.sentences.length}）`);
}
