'use strict';
/* 离线缓存（v0.7 PWA）：缓存应用外壳 + 数据清单；音频在线播放不缓存 */
const CACHE = 'ls-v0.7';
const SHELL = ['./', './index.html', './app.css', './app.js', './cloud.js', '../data/packs/index.json'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 音频不缓存（在线播放）；pack.json 网络优先 + 缓存兜底
  if (url.pathname.endsWith('.m4a')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
  );
});
