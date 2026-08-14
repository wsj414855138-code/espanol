#!/usr/bin/env node
/**
 * generate-audio.mjs — 为 data/packs/<pack>/pack.json 里的每条文本生成西语发音
 *
 * 用法：
 *   node scripts/generate-audio.mjs <packId|--all> [voice] [--force] [--engine auto|edge|say]
 *
 * - TTS 引擎（--engine，默认 auto）：
 *   edge  = edge-tts 微软在线语音（更自然；es-ES-ElviraNeural 女声；需联网 + .venv）
 *   say   = macOS 内置语音（离线兜底；Mónica es_ES）
 *   auto  = edge 可用则用 edge，否则回退 say
 * - edge-tts 环境准备：python3 -m venv .venv && .venv/bin/pip install edge-tts
 * - 输出 m4a（AAC）：edge-tts 出 mp3 后用 macOS 自带 afconvert 转码，扩展名与旧版兼容
 * - 默认跳过已存在的音频文件；--force 重新生成全部
 *
 * 想换更强的 TTS 引擎时，只需要改本文件：pack 结构完全不感知引擎差异。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const ALL = args.includes('--all');
const packId = ALL ? null : args[0];
const VOICE_EDGE = 'es-ES-ElviraNeural';   // edge-tts 默认语音（女声，西班牙本土）
const VOICE_SAY = 'Mónica';                // macOS say 默认语音
const FORCE = args.includes('--force');
const ENGINE = (args.find((a) => a.startsWith('--engine=')) || '--engine=auto').split('=')[1];

if (!packId && !ALL) {
  console.error('用法：node scripts/generate-audio.mjs <packId|--all> [--force] [--engine auto|edge|say]');
  process.exit(1);
}

const RATE_NORMAL = 170;   // say：词/分钟
const RATE_SLOW = 110;
const EDGE_RATE_SLOW = '-25%'; // edge-tts：慢速百分比

// 定位 edge-tts：项目 .venv → PATH
const EDGE_CANDIDATES = [
  join(ROOT, '.venv', 'bin', 'edge-tts'),
  join(ROOT, '.venv', 'Scripts', 'edge-tts.exe'),
];
function findEdge() {
  if (ENGINE === 'say') return null;
  for (const p of EDGE_CANDIDATES) if (existsSync(p)) return p;
  try {
    return execFileSync('which', ['edge-tts'], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}
const EDGE = findEdge();
const useEdge = EDGE && ENGINE !== 'say';
const VOICE = args.find((a) => !a.startsWith('--') && a !== args[0]) || (useEdge ? VOICE_EDGE : VOICE_SAY);

/** edge-tts 生成 mp3 后转 m4a（afconvert，macOS 自带） */
function ttsEdge(text, outPath, slow) {
  const tmp = join('/tmp', `ls-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);
  const cmd = [EDGE, '--voice', VOICE, '--write-media', tmp];
  if (slow) cmd.push('--rate=' + EDGE_RATE_SLOW); // 用等号形式，避免负数被 argparse 当选项
  cmd.push('--text', text);
  execFileSync(cmd[0], cmd.slice(1));
  try {
    execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '64000', tmp, outPath]);
  } finally {
    rmSync(tmp, { force: true });
  }
}

function ttsSay(text, outPath, rate) {
  execFileSync('say', [
    '-v', VOICE,
    '-r', String(rate),
    '--file-format=mp4f',
    '--data-format=aac',
    '-o', outPath,
    text,
  ]);
}

function generate(packId) {
  const packPath = join(ROOT, 'data', 'packs', packId, 'pack.json');
  if (!existsSync(packPath)) {
    console.error(`✗ 未找到学习包：${packPath}（先运行 build-pack.mjs）`);
    return { failed: true };
  }
  const pack = JSON.parse(readFileSync(packPath, 'utf8'));
  const audioDir = join(ROOT, 'data', 'packs', packId, 'audio');
  mkdirSync(audioDir, { recursive: true });

  const jobs = [];
  for (const v of pack.vocab) {
    jobs.push({ path: v.audio, text: v.es, slow: false });
    if (v.example) jobs.push({ path: v.exampleAudio, text: v.example.es, slow: false });
  }
  for (const l of pack.listening) {
    l.pair.forEach((word, i) => jobs.push({ path: l.audio[i], text: word, slow: false }));
  }
  for (const s of pack.sentences) {
    jobs.push({ path: s.audio, text: s.es, slow: false });
    jobs.push({ path: s.audioSlow, text: s.es, slow: true });
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
      if (useEdge) ttsEdge(job.text, out, job.slow);
      else ttsSay(job.text, out, job.slow ? RATE_SLOW : RATE_NORMAL);
      generated++;
    } catch (err) {
      failed.push(job.path);
      console.error(`✗ 生成失败 ${job.path}：${err.message.split('\n')[0]}`);
    }
  }

  // 记录本次使用的引擎与语音，方便追溯
  pack.meta.audio = { engine: useEdge ? 'edge-tts' : 'macos-say', voice: VOICE };
  writeFileSync(packPath, JSON.stringify(pack, null, 2) + '\n');

  console.log(`✓ [${packId}] 音频完成（${useEdge ? 'edge-tts/' + VOICE : 'macos-say/' + VOICE}）：新生成 ${generated} 个，跳过 ${skipped} 个${failed.length ? `，失败 ${failed.length} 个` : ''}`);
  return { failed: failed.length > 0, failed };
}

let targets = [];
if (ALL) {
  targets = readdirSync(join(ROOT, 'data', 'packs'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(ROOT, 'data', 'packs', d.name, 'pack.json')))
    .map((d) => d.name);
} else {
  targets = [packId];
}

let anyFailed = false;
for (const id of targets) {
  const r = generate(id);
  if (r.failed) anyFailed = true;
}
if (anyFailed) process.exit(1);
