/* 個人探索地圖 Service Worker：讓 App 可安裝、離線也能開啟。
   - 頁面：先抓網路，失敗才用快取（確保拿到最新版）
   - 程式與圖示（有雜湊檔名）：快取優先
   - 資料 JSON：先抓網路，離線時用上次的資料
   - 地圖圖磚不快取（遵守 OpenStreetMap 使用政策） */
const CACHE = 'pdm-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
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
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    return hit || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
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

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 圖磚、地址查詢等外部請求不處理
  if (req.mode === 'navigate' || url.pathname.includes('/data/')) {
    e.respondWith(networkFirst(req));
  } else if (url.pathname.includes('/assets/') || /\.(png|svg|webmanifest)$/.test(url.pathname)) {
    e.respondWith(cacheFirst(req));
  }
});
