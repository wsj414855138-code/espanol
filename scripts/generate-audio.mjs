#!/usr/bin/env node
/**
 * generate-audio.mjs — 为 data/packs/<pack>/pack.json 里的每条文本生成西语发音
 *
 * 用法：
 *   node scripts/generate-audio.mjs <packId> [voice] [--force]
 *
 * - 默认语音 Mónica（es_ES），可选 Paulina（es_MX）等（见 `say -v '?'`）
 * - 默认跳过已存在的音频文件；--force 重新生成全部
 * - 输出 m4a（AAC），浏览器全兼容；文件写入 data/packs/<pack>/audio/
 *
 * 想换更强的 TTS 引擎时，只需要改本文件：pack 结构完全不感知引擎差异。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const packId = process.argv[2];
if (!packId) {
  console.error('用法：node scripts/generate-audio.mjs <packId> [voice] [--force]');
  process.exit(1);
}

const args = process.argv.slice(3);
const VOICE = args.find((a) => !a.startsWith('--')) || 'Mónica';
const FORCE = args.includes('--force');

const RATE_NORMAL = 170; // 词/分钟
const RATE_SLOW = 110;

const packPath = join(ROOT, 'data', 'packs', packId, 'pack.json');
if (!existsSync(packPath)) {
  console.error(`✗ 未找到学习包：${packPath}（先运行 build-pack.mjs）`);
  process.exit(1);
}
const pack = JSON.parse(readFileSync(packPath, 'utf8'));
const audioDir = join(ROOT, 'data', 'packs', packId, 'audio');
mkdirSync(audioDir, { recursive: true });

const jobs = [];
for (const v of pack.vocab) {
  jobs.push({ path: v.audio, text: v.es, rate: RATE_NORMAL });
  if (v.example) jobs.push({ path: v.exampleAudio, text: v.example.es, rate: RATE_NORMAL });
}
for (const l of pack.listening) {
  l.pair.forEach((word, i) => jobs.push({ path: l.audio[i], text: word, rate: RATE_NORMAL }));
}
for (const s of pack.sentences) {
  jobs.push({ path: s.audio, text: s.es, rate: RATE_NORMAL });
  jobs.push({ path: s.audioSlow, text: s.es, rate: RATE_SLOW });
}

let generated = 0;
let skipped = 0;
const failed = [];

for (const job of jobs) {
  const out = join(audioDir, job.path.split('/').pop());
  if (!FORCE && existsSync(out)) {
    skipped++;
    continue;
  }
  try {
    execFileSync('say', [
      '-v', VOICE,
      '-r', String(job.rate),
      '--file-format=mp4f',
      '--data-format=aac',
      '-o', out,
      job.text,
    ]);
    generated++;
  } catch (err) {
    failed.push(job.path);
    console.error(`✗ 生成失败 ${job.path}：${err.message.split('\n')[0]}`);
  }
}

// 记录本次使用的语音，方便追溯
pack.meta.audio = { voice: VOICE, engine: 'macos-say' };
writeFileSync(packPath, JSON.stringify(pack, null, 2) + '\n');

console.log(`✓ 音频完成：新生成 ${generated} 个，跳过 ${skipped} 个${failed.length ? `，失败 ${failed.length} 个` : ''}`);
if (failed.length) {
  console.error('失败列表：\n  ' + failed.join('\n  '));
  process.exit(1);
}
