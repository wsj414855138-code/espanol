#!/usr/bin/env node
/**
 * serve.mjs — 练习页静态服务器（零依赖）
 *
 * 用法：
 *   node scripts/serve.mjs [port]
 *
 * 启动后：
 *   本机访问  http://localhost:8000/app/
 *   手机访问  http://<局域网IP>:8000/app/   （需与电脑同一 Wi-Fi）
 *
 * v2 改动（2026-08-15，修复"浏览器听不到声音"根因）：
 *   1. 显式 Content-Length —— 之前 res.writeHead 后 end(buffer) 会退化为
 *      chunked 传输；Safari 媒体栈对无 Content-Length 的音频可能拒绝播放。
 *   2. Accept-Ranges: bytes + Range/206 —— Safari/AVFoundation 播放 HTTP 媒体
 *      强制要求字节区间支持（发 Range: bytes=0- 期待 206），Chrome 容忍 200，
 *      所以此前 puppeteer 验证全过但真机 Safari 无声。
 *   3. 请求日志 —— 以后排查"点播放没声音"可直接看日志里 URL 与状态码。
 */
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const PORT = Number(process.argv[2] || process.env.PORT || 8000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/** 解析单个 Range: bytes=start-end | bytes=start- | bytes=-suffix */
function parseRange(rangeHeader, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((rangeHeader || '').trim());
  if (!m) return null;
  let start, end;
  if (m[1] === '') {
    // 后缀区间: bytes=-500 → 最后 500 字节
    const suffix = Number(m[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Number(m[2]);
    if (!Number.isFinite(start) || (m[2] !== '' && !Number.isFinite(end))) return null;
  }
  if (start > end || start >= size) return { unsatisfiable: true };
  end = Math.min(end, size - 1);
  return { start, end };
}

createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }

  if (urlPath === '/' || urlPath === '/app') {
    res.writeHead(301, { Location: '/app/' }).end();
    return;
  }
  let rel = urlPath.replace(/^\/+/, '');
  if (rel === 'app/') rel = 'app/index.html';

  const filePath = normalize(join(ROOT, rel));
  if (!filePath.startsWith(ROOT) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    log(req, 404, urlPath);
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
    return;
  }

  const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
  const size = statSync(filePath).size;
  // no-store：练习页迭代快，必须保证客户端永远拿到最新文件（曾因旧缓存导致音频路径修复不生效）
  const baseHeaders = {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'bytes',
  };

  const range = parseRange(req.headers.range, size);
  if (req.headers.range) {
    if (!range || range.unsatisfiable) {
      log(req, 416, urlPath, req.headers.range);
      res.writeHead(416, {
        ...baseHeaders,
        'Content-Range': `bytes */${size}`,
      }).end();
      return;
    }
    const buf = readFileSync(filePath);
    const chunk = buf.subarray(range.start, range.end + 1);
    log(req, 206, urlPath, req.headers.range, chunk.length);
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Length': chunk.length,
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
    }).end(chunk);
    return;
  }

  log(req, 200, urlPath);
  res.writeHead(200, {
    ...baseHeaders,
    'Content-Length': size,
  });
  res.end(readFileSync(filePath));
}).listen(PORT, () => {
  console.log(`练习页已启动：http://localhost:${PORT}/app/`);
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`手机访问：    http://${net.address}:${PORT}/app/`);
      }
    }
  }
  console.log('按 Ctrl+C 停止。');
});

function log(req, status, urlPath, range, bytes) {
  const time = new Date().toTimeString().slice(0, 8);
  const ua = (req.headers['user-agent'] || 'unknown').slice(0, 40);
  const extra = range ? ` range=${range}` : '';
  const byt = bytes !== undefined ? ` ${bytes}B` : '';
  console.log(`[${time}] ${req.method} ${status} ${urlPath}${extra}${byt} (${ua})`);
}
