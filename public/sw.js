/* 個人探索地圖 Service Worker：讓 App 可安裝、線上或離線都能使用。
   - 第一次開啟就把頁面、程式、圖示、資料全部存起來（之後離線也能開）
   - 頁面與資料 JSON：先抓網路（拿最新版），離線時用上次存的
   - 程式與圖示（檔名含雜湊）：快取優先
   - 地圖圖磚：只保留「看過的」區域（OSM 允許快取瀏覽過的圖磚、禁止大量預先下載），上限 1500 張 */
const CACHE = 'pdm-v2';
const TILES = 'pdm-tiles-v1';
const MAX_TILES = 1500;
const DATA = ['places.json', 'contents.json', 'awards.json', 'meta.json', 'status.json'].map((f) => './data/' + f);
const SHELL = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon.svg', ...DATA];

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL);
      // 從首頁找出這一版的程式檔（assets/index-xxxx.js / .css），一併存起來
      const html = await (await cache.match('./')).text();
      const assets = [...new Set(html.match(/assets\/[^"'\s]+\.(?:js|css)/g) || [])].map((a) => './' + a);
      if (assets.length) await cache.addAll(assets);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== TILES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    return hit || (req.mode === 'navigate' ? cache.match('./') : Response.error());
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

let tileWrites = 0;
async function trimTiles(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]); // 刪最舊的
}

// 圖磚：有網路時照常向 OSM 取得（並更新存檔），離線時用看過的存檔
async function tile(req) {
  const cache = await caches.open(TILES);
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') {
      cache.put(req, res.clone());
      if (++tileWrites % 50 === 0) trimTiles(cache);
    }
    return res;
  } catch {
    const hit = await cache.match(req);
    return hit || Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(tile(req));
    return;
  }
  if (url.origin !== self.location.origin) return; // 地址查詢等其他外部請求不處理
  if (req.mode === 'navigate' || url.pathname.includes('/data/')) {
    e.respondWith(networkFirst(req));
  } else if (url.pathname.includes('/assets/') || /\.(png|svg|webmanifest)$/.test(url.pathname)) {
    e.respondWith(cacheFirst(req));
  }
});
