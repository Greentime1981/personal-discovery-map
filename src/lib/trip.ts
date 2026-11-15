import type { LatLng, Place } from '../types';
import { distanceKm } from './geo';

/** 點 P 到線段 AB 的最短距離（公里）；小範圍用等距投影近似即可 */
export function distanceToSegmentKm(p: LatLng, a: LatLng, b: LatLng): number {
  const k = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const ax = a.lng * k, ay = a.lat, bx = b.lng * k, by = b.lat, px = p.lng * k, py = p.lat;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return distanceKm(p, { lat: ay + t * dy, lng: (ax + t * dx) / k });
}

export interface TripHit {
  place: Place;
  hotelKm: number | null; // 距飯店
  routeKm: number; // 距當天路線（直線路段）
  detourKm: number; // 額外繞路距離（直線估計）
  detourMin: number; // 額外繞路時間（估計：道路係數 1.3、平均 40 km/h）
  nearStop: string; // 最近的路段 / 目的地說明
  reason: 'hotel' | 'route';
}

/** 依「飯店周邊」與「當天行車路線附近」篩選推薦地點（初期：直線距離與路線附近；之後再接行車時間） */
export function tripCandidates(
  places: Place[],
  points: (LatLng & { label: string })[],
  hotel: LatLng | null,
  corridorKm: number,
  hotelKm: number,
): TripHit[] {
  const out: TripHit[] = [];
  for (const place of places) {
    if (place.latitude == null || place.longitude == null) continue;
    const p = { lat: place.latitude, lng: place.longitude };
    const dHotel = hotel ? distanceKm(p, hotel) : null;
    let best = { routeKm: Infinity, detourKm: Infinity, label: '' };
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i], b = points[i + 1];
      const routeKm = distanceToSegmentKm(p, a, b);
      if (routeKm < best.routeKm) {
        const detourKm = Math.max(0, distanceKm(a, p) + distanceKm(p, b) - distanceKm(a, b));
        best = { routeKm, detourKm, label: `${a.label} → ${b.label}` };
      }
    }
    if (points.length === 1) {
      const d = distanceKm(p, points[0]);
      best = { routeKm: d, detourKm: d * 2, label: points[0].label };
    }
    const nearHotel = dHotel != null && dHotel <= hotelKm;
    const nearRoute = best.routeKm <= corridorKm;
    if (!nearHotel && !nearRoute) continue;
    const detourKm = nearRoute ? best.detourKm : (dHotel ?? 0) * 2;
    out.push({
      place,
      hotelKm: dHotel,
      routeKm: best.routeKm,
      detourKm,
      detourMin: Math.round(((detourKm * 1.3) / 40) * 60),
      nearStop: nearRoute ? best.label : '飯店周邊',
      reason: nearRoute ? 'route' : 'hotel',
    });
  }
  return out.sort((x, y) => x.detourMin - y.detourMin || x.routeKm - y.routeKm);
}
