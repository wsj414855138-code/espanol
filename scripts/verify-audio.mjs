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
 *   3. --http 时对每个包抽查 3 个音频的 HTTP 状态（防"路径 404"类回归）；
 *   4. --http 时校验媒体响应头：Content-Length 必须存在（Safari 拒绝 chunked
 *      音频）、Accept-Ranges: bytes 必须存在，且 Range: bytes=0-1023 必须回 206
 *      + Content-Range（Safari/AVFoundation 播放 HTTP 媒体强制要求字节区间，
 *      Chrome 容忍 200 —— 2026-08-15 用户"听不到声音"根因，已修进 serve.mjs v2）。
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
  // 完整 GET + 头校验（HEAD 拿不到媒体栈真实行为，且 serve.mjs 对 HEAD 也回全长头）
  const issues = [];
  let status = -1;
  try {
    const res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-1023' } });
    status = res.status;
    // 1) Range 请求必须 206 + Content-Range（Safari 媒体播放硬性要求）
    if (status !== 206) {
      issues.push(`Range 请求未回 206（实际 ${status}）`);
    } else if (!res.headers.get('content-range')) {
      issues.push('206 响应缺少 Content-Range');
    }
  } catch (e) {
    issues.push(`请求失败: ${e.message}`);
  }
  try {
    const res = await fetch(url, { method: 'GET' });
    if (res.status !== 200) issues.push(`GET 状态 ${res.status}`);
    if (!res.headers.get('content-length')) issues.push('缺少 Content-Length（Safari 会拒播 chunked 音频）');
    if (res.headers.get('accept-ranges') !== 'bytes') issues.push('缺少 Accept-Ranges: bytes');
  } catch (e) {
    issues.push(`GET 失败: ${e.message}`);
  }
  return { status, issues };
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
      const url = `${BASE}/data/packs/${packId}/${rel}`;
      const r = await httpCheck(url);
      if (r.issues.length) issues.push(...r.issues.map((i) => `${i} → ${url}`));
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
