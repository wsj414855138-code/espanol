#!/usr/bin/env node
/**
 * verify-audio.mjs — 音频链路静态校验（零依赖，任何环境可跑）
 *
 * 用法：
 *   node scripts/verify-audio.mjs              # 校验全部学习包
 *   node scripts/verify-audio.mjs <packId>     # 只校验一个包
 *   node scripts/verify-audio.mjs --http       # 附带 HTTP 抽查（需练习页服务在跑）
 *
 * 校验项：
 *   1. 每个 pack.json 引用的所有音频路径 → 文件存在且非 0 字节；
 *   2. 每个包 vocab/listening/sentences 的引用完整（id 与文件一一对应）；
 *   3. --http 时对每个包抽查 3 个音频的 HTTP 状态（防"路径 404"类回归）。
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKS = join(ROOT, 'data', 'packs');
const args = process.argv.slice(2);
const HTTP = args.includes('--http');
const packArg = args.find((a) => !a.startsWith('--'));
const BASE = process.env.PRACTICE_URL || 'http://localhost:8000';

function refsOf(pack) {
  const refs = [];
  for (const v of pack.vocab) {
    refs.push(v.audio);
    if (v.exampleAudio) refs.push(v.exampleAudio);
  }
  for (const l of pack.listening) l.audio.forEach((a) => refs.push(a));
  for (const s of pack.sentences) { refs.push(s.audio); refs.push(s.audioSlow); }
  return refs;
}

async function httpCheck(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.status;
  } catch {
    return -1;
  }
}

async function verifyPack(packId) {
  const packPath = join(PACKS, packId, 'pack.json');
  if (!existsSync(packPath)) return { packId, ok: false, issues: ['pack.json 不存在'] };
  const pack = JSON.parse(readFileSync(packPath, 'utf8'));
  const issues = [];
  const refs = refsOf(pack);
  if (refs.length === 0) issues.push('没有任何音频引用（vocab/listening/sentences 全空？）');

  for (const rel of refs) {
    const f = join(PACKS, packId, rel);
    if (!existsSync(f)) { issues.push(`文件缺失: ${rel}`); continue; }
    if (statSync(f).size === 0) issues.push(`文件 0 字节: ${rel}`);
  }

  if (HTTP) {
    // 每包抽查 3 个（首/中/尾各一）
    const samples = [refs[0], refs[Math.floor(refs.length / 2)], refs[refs.length - 1]].filter(Boolean);
    for (const rel of [...new Set(samples)]) {
      const status = await httpCheck(`${BASE}/data/packs/${packId}/${rel}`);
      if (status !== 200) issues.push(`HTTP ${status}: /data/packs/${packId}/${rel}`);
    }
  }

  return { packId, ok: issues.length === 0, issues };
}

const targets = packArg
  ? [packArg]
  : readdirSync(PACKS, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(PACKS, d.name, 'pack.json')))
      .map((d) => d.name);

let bad = 0;
for (const id of targets) {
  const r = await verifyPack(id);
  if (r.ok) {
    console.log(`✅ ${r.packId}`);
  } else {
    bad++;
    console.log(`❌ ${r.packId}`);
    r.issues.forEach((i) => console.log(`    - ${i}`));
  }
}
console.log(bad ? `❌ ${bad}/${targets.length} 个包有问题` : `✅ ${targets.length} 个包音频链路全部通过${HTTP ? '（含 HTTP 抽查）' : ''}`);
process.exit(bad ? 1 : 0);
