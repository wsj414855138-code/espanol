#!/usr/bin/env node
/**
 * vision-review.mjs — 用 Kimi 视觉模型分析本地图片（UI 走查 / 截图复核 / 图片识别）
 *
 * 用法：
 *   node scripts/vision-review.mjs <图片路径...> "问题" [--model <模型ID>] [--out <文件>]
 *
 * 默认模型：kimi-coding/kimi-for-coding（Kimi K2.7，本项目视觉优先模型）
 * 可选模型：kimi-coding/k3（K3）、kimi-coding/k3-256k
 *
 * 依赖：pi CLI（~/.pi，已配置 kimi-coding OAuth）；本脚本只是它的封装，
 * 任何 AI（DeepSeek/Codex）和人都可以用同一套命令看图。
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const modelArg = args.findIndex((a) => a === '--model');
const MODEL = modelArg >= 0 ? args[modelArg + 1] : 'kimi-coding/kimi-for-coding';
const outIdx = args.findIndex((a) => a === '--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : null;
const skip = new Set();
if (modelArg >= 0) { skip.add(modelArg); skip.add(modelArg + 1); }
if (outIdx >= 0) { skip.add(outIdx); skip.add(outIdx + 1); }
const clean = args.filter((a, i) => !skip.has(i));

const images = clean.filter((a) => !a.startsWith('@') && (existsSync(resolve(ROOT, a)) || existsSync(a)));
const question = clean.find((a) => !images.includes(a) && !a.startsWith('@'));

if (!images.length || !question) {
  console.error('用法：node scripts/vision-review.mjs <图片路径...> "问题" [--model 模型ID] [--out 文件]');
  console.error(`  图片不存在或问题缺失（当前参数：${JSON.stringify(clean)}）`);
  process.exit(1);
}

const cmd = ['pi', '-p', '--no-extensions', '--no-skills', '--model', MODEL,
  ...images.map((p) => '@' + p), question];

try {
  const out = execFileSync(cmd[0], cmd.slice(1), { encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  if (OUT) {
    mkdirSync(dirname(resolve(ROOT, OUT)), { recursive: true });
    writeFileSync(resolve(ROOT, OUT), out.trim() + '\n');
    console.log(`✓ 结果已写入：${OUT}`);
  } else {
    process.stdout.write(out.trim() + '\n');
  }
} catch (err) {
  console.error(`✗ 调用失败（${MODEL}）：${(err.message || String(err)).split('\n')[0]}`);
  process.exit(1);
}
