import type { Destination } from '../types';

/**
 * 地址 / 地名查詢：OpenStreetMap Nominatim。
 * 使用政策：每秒最多 1 次、需附出處、不得大量批次查詢。
 * 這裡只在使用者按下搜尋時呼叫一次，並快取結果。
 */
const cache = new Map<string, Destination[]>();
let lastCall = 0;

export async function geocode(query: string): Promise<Destination[]> {
  const q = query.trim();
  if (!q) return [];
  const hit = cache.get(q);
  if (hit) return hit;
  if (!navigator.onLine) throw new Error('目前離線，無法查詢地址；可在地圖上長按設定位置，或用 ◎ 目前位置');

  const wait = 1100 - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();

  const url =
    'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=tw&accept-language=zh-TW&q=' +
    encodeURIComponent(q);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`地址查詢失敗（${res.status}）`);
  const rows = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  const out = rows.map((r) => ({ lat: Number(r.lat), lng: Number(r.lon), label: r.display_name }));
  cache.set(q, out);
  return out;
}
