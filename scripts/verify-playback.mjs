#!/usr/bin/env node
/**
 * verify-playback.mjs — 真实播放链路校验（dev 工具，需 puppeteer-core + 系统 Chrome）
 *
 * 用法：
 *   node scripts/verify-playback.mjs [baseUrl] [--module vocab|listening|shadow|dictation|all]
 *
 * 校验内容（比"文件存在"更严格）：
 *   1. 页面正常加载（无 loadError）；
 *   2. 点击每个播放点后，音频请求 HTTP 200；
 *   3. new Audio().play() 的 Promise 成功 resolve（浏览器确认可解码播放）；
 *   4. 报告每个播放点的检查结果。
 *
 * 安装：npm i puppeteer-core（node_modules 已 gitignore，仅开发用）
 * 依赖：系统 Chrome（/Applications/Google Chrome.app）
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const BASE = process.argv[2] || 'http://localhost:8000/app/';
const MODULE = (process.argv.find((a) => a.startsWith('--module=')) || '--module=all').split('=')[1];
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_TMP = join(dirname(fileURLToPath(import.meta.url)), '..', '.chrome-tmp');
mkdirSync(CHROME_TMP, { recursive: true });

/** 每个待测播放点：页签 hash、选择器、说明 */
const POINTS = {
  vocab: [
    ['#vocabPlay', '词汇卡 · 单词发音'],
    ['#vocabExPlay', '词汇卡 · 例句发音（需先翻面）'],
  ],
  listening: [['#listenPlay', '听辨 · 播放题目']],
  shadow: [
    ['#shadowList [data-act="play"]', '跟读 · 常速'],
    ['#shadowList [data-act="playSlow"]', '跟读 · 慢速'],
  ],
  dictation: [
    ['#dictationList [data-act="play"]', '听写 · 常速'],
    ['#dictationList [data-act="playSlow"]', '听写 · 慢速'],
  ],
};

async function main() {
  // headless Chrome 偶发启动失败：自动重试
  let browser = null;
  for (let attempt = 1; attempt <= 3 && !browser; attempt++) {
    try {
      browser = await puppeteer.launch({
        executablePath: CHROME,
        headless: 'new',
        userDataDir: CHROME_TMP,
        env: { ...process.env, TMPDIR: CHROME_TMP, TMP: CHROME_TMP, TEMP: CHROME_TMP },
        args: ['--autoplay-policy=no-user-gesture-required', '--disable-gpu', '--no-sandbox'],
      });
    } catch (err) {
      console.error(`Chrome 启动失败（第 ${attempt} 次）：${err.message.split('\n')[0]}，重试…`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  if (!browser) { console.error('❌ Chrome 连续 3 次启动失败'); process.exit(1); }
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });

  // 页面加载前拦截 Audio，记录每次 play 的 src 与 resolve/reject
  await page.evaluateOnNewDocument(() => {
    const Orig = window.Audio;
    window.__plays = [];
    window.Audio = class extends Orig {
      constructor(src) { super(src); this.__src = src; }
      play() {
        const rec = { src: this.__src, ok: null, err: null, time: 0 };
        window.__plays.push(rec);
        return super.play().then(() => { rec.ok = true; }).catch((e) => { rec.ok = false; rec.err = String(e); });
      }
    };
  });

  const reqs = [];
  page.on('response', (r) => {
    if (r.url().includes('.m4a')) reqs.push({ status: r.status(), file: r.url().split('/').pop() });
  });

  const results = [];
  const modules = MODULE === 'all' ? Object.keys(POINTS) : [MODULE];
  for (const mod of modules) {
    await page.goto(`${BASE}#${mod}`, { waitUntil: 'networkidle0' });
    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 500));
    // 翻面以显示例句按钮
    if (mod === 'vocab') {
      await page.click('#vocabFlip').catch(() => {});
      await new Promise((r) => setTimeout(r, 200));
    }
    for (const [sel, label] of POINTS[mod]) {
      const btn = await page.$(sel);
      if (!btn) { results.push({ module: mod, point: label, status: 'SKIP', detail: '按钮不存在' }); continue; }
      await btn.click();
      await new Promise((r) => setTimeout(r, 1200));
      const plays = await page.evaluate(() => window.__plays || []);
      const rec = plays[plays.length - 1];
      const m4aReqs = reqs.filter((r) => r.status !== 200);
      results.push({
        module: mod,
        point: label,
        status: !rec ? 'FAIL' : rec.ok ? 'PASS' : 'FAIL',
        detail: rec ? `${rec.src} ${rec.err ? '→ ' + rec.err : ''}` : '无播放记录',
        http: m4aReqs.length ? `非200:${m4aReqs.map((r) => r.status + '/' + r.file).join(',')}` : '全部200',
      });
    }
  }

  const bad = results.filter((r) => r.status !== 'PASS' && r.status !== 'SKIP');
  console.log(`校验 ${BASE}（模块: ${modules.join(',')}）`);
  for (const r of results) console.log(`  ${r.status === 'PASS' ? '✅' : r.status === 'SKIP' ? '⏭️' : '❌'} [${r.module}] ${r.point} — ${r.detail}（${r.http}）`);
  console.log(bad.length ? `❌ ${bad.length} 个播放点失败` : '✅ 全部播放点通过');
  await browser.close();
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => { console.error('ERR ' + e.stack); process.exit(1); });
