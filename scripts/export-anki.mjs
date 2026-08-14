#!/usr/bin/env node
/**
 * export-anki.mjs — 把学习包导出为 Anki 卡组（TSV 格式，零依赖）
 *
 * 用法：
 *   node scripts/export-anki.mjs <packId>
 *   node scripts/export-anki.mjs --all
 *
 * 产物（data/packs/<pack>/ 下）：
 *   anki-vocab.tsv      词汇卡：西语 | 中文 | 例句西 | 例句中 | [sound:...]
 *   anki-sentences.tsv  句型卡：西语 | 中文 | [sound:...]
 *   anki-media/         音频文件（拷进 Anki 的媒体目录即可发声）
 *
 * 导入步骤（Anki 桌面版，中文界面）：
 *   1. 工具 → 管理笔记类型 → 添加 → 基础（正反卡片），重命名「西语」，
 *      字段改为：西语 | 中文 | 例句 | 例句中文 | 音频（注意顺序）
 *   2. 文件 → 导入，选择 anki-vocab.tsv（字段分隔符=制表符，允许 HTML=否）
 *   3. 把 anki-media/ 里的文件复制到 Anki 媒体目录（工具 → 打开媒体文件夹）
 *
 * 提示：Anki 自带间隔重复（SRS），每天几分钟复习，配合练习页的听说训练。
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const esc = (s) => String(s ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ');

function exportPack(packId) {
  const packPath = join(ROOT, 'data', 'packs', packId, 'pack.json');
  if (!existsSync(packPath)) {
    console.error(`✗ 未找到学习包：${packPath}`);
    return false;
  }
  const pack = JSON.parse(readFileSync(packPath, 'utf8'));
  const outDir = join(ROOT, 'data', 'packs', packId);
  const mediaDir = join(outDir, 'anki-media');
  mkdirSync(mediaDir, { recursive: true });

  // 词汇卡：西语 | 中文 | 例句西 | 例句中 | 音频
  const vocabLines = [];
  for (const v of pack.vocab) {
    const ex = v.example || { es: '', zh: '' };
    const sound = `[sound:${basename(v.audio)}]`;
    vocabLines.push([v.es, v.zh, ex.es, ex.zh, sound].map(esc).join('\t'));
  }
  writeFileSync(join(outDir, 'anki-vocab.tsv'), vocabLines.join('\n') + '\n', 'utf8');

  // 句型卡：西语 | 中文 | 音频
  const sentLines = pack.sentences.map(
    (s) => [s.es, s.zh, `[sound:${basename(s.audio)}]`].map(esc).join('\t')
  );
  writeFileSync(join(outDir, 'anki-sentences.tsv'), sentLines.join('\n') + '\n', 'utf8');

  // 复制音频到 anki-media/（Anki 用文件名引用，需在媒体目录）
  const refs = new Set();
  for (const v of pack.vocab) refs.add(v.audio);
  for (const l of pack.listening) l.audio.forEach((a) => refs.add(a));
  for (const s of pack.sentences) refs.add(s.audio);
  let copied = 0;
  for (const rel of refs) {
    const src = join(outDir, rel);
    if (existsSync(src)) {
      copyFileSync(src, join(mediaDir, basename(rel)));
      copied++;
    }
  }

  console.log(`✓ ${packId}：词汇卡 ${vocabLines.length} 张，句型卡 ${sentLines.length} 张，音频 ${copied} 个`);
  console.log(`  导入文件：${join(outDir, 'anki-vocab.tsv')}（导入步骤见脚本头部注释）`);
  return true;
}

const arg = process.argv[2];
if (arg === '--all') {
  const { readdirSync } = await import('node:fs');
  const packs = readdirSync(join(ROOT, 'data', 'packs'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(ROOT, 'data', 'packs', d.name, 'pack.json')));
  packs.forEach((d) => exportPack(d.name));
} else if (arg) {
  exportPack(arg);
} else {
  console.error('用法：node scripts/export-anki.mjs <packId> 或 --all');
  process.exit(1);
}
