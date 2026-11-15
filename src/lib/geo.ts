import type { LatLng } from '../types';

/** 兩點直線距離（公里），Haversine */
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} 公尺` : `${km.toFixed(1)} 公里`;
}

/** 開啟 Google Maps 導航（外部連結，不自建導航） */
export function googleMapsDirUrl(p: { name: string; address: string; latitude: number | null; longitude: number | null }): string {
  // 有地址時用「店名 + 地址」讓 Google Maps 找到精確店家；沒地址才用座標
  const dest =
    p.address
      ? `${p.name} ${p.address}`
      : `${p.latitude},${p.longitude}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
}
