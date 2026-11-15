import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CATEGORY_META, TILE_ATTRIBUTION, TILE_URL } from '../config';
import type { Destination, LatLng, Place } from '../types';

interface Props {
  center: Destination;
  radiusKm: number;
  places: Place[];
  selectedId: string | null;
  userPos: LatLng | null;
  onSelect: (id: string) => void;
  onPickPoint: (p: LatLng) => void; // 右鍵 / 長按地圖設為目的地
  /** 攻略模式：不畫搜尋範圍，改為縮放到所有地點，並依作者原始順序編號、連線 */
  guideMode?: boolean;
  numbers?: Record<string, number>;
}

function placeIcon(p: Place, selected: boolean, num?: number) {
  const m = CATEGORY_META[p.category] ?? CATEGORY_META.attraction;
  const label = num != null ? `<b>${num}</b>` : m.icon;
  return L.divIcon({
    className: '',
    html: `<div class="pin${selected ? ' pin-selected' : ''}" style="background:${m.color}"><span>${label}</span></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
  });
}

export default function MapView({ center, radiusKm, places, selectedId, userPos, onSelect, onPickPoint, guideMode, numbers }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const centerLayerRef = useRef<L.LayerGroup | null>(null);
  const userLayerRef = useRef<L.LayerGroup | null>(null);
  const pickRef = useRef(onPickPoint);
  pickRef.current = onPickPoint;

  // 建立地圖（只做一次）
  useEffect(() => {
    if (!elRef.current) return;
    const map = L.map(elRef.current, { zoomControl: false }).setView([center.lat, center.lng], 14);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    map.on('contextmenu', (e: L.LeafletMouseEvent) => pickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng }));
    layerRef.current = L.layerGroup().addTo(map);
    centerLayerRef.current = L.layerGroup().addTo(map);
    userLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // 頂端列高度改變（切換模式）時，讓地圖重新計算尺寸
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(elRef.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 目的地與搜尋範圍
  useEffect(() => {
    const map = mapRef.current;
    const g = centerLayerRef.current;
    if (!map || !g) return;
    g.clearLayers();
    if (guideMode) return;
    const circle = L.circle([center.lat, center.lng], {
      radius: radiusKm * 1000,
      color: '#1a73e8',
      weight: 1,
      fillOpacity: 0.05,
    }).addTo(g);
    L.circleMarker([center.lat, center.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#d93025', fillOpacity: 1 })
      .bindTooltip(center.label)
      .addTo(g);
    map.fitBounds(circle.getBounds(), { padding: [20, 20] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center, radiusKm, guideMode]);

  // 推薦地點標記
  useEffect(() => {
    const g = layerRef.current;
    if (!g) return;
    g.clearLayers();
    const pts: [number, number][] = [];
    for (const p of places) {
      if (p.latitude == null || p.longitude == null) continue;
      pts.push([p.latitude, p.longitude]);
      L.marker([p.latitude, p.longitude], {
        icon: placeIcon(p, p.place_id === selectedId, numbers?.[p.place_id]),
        title: p.name,
        zIndexOffset: p.place_id === selectedId ? 1000 : 0,
      })
        .on('click', () => onSelect(p.place_id))
        .addTo(g);
    }
    // 作者原始順序連線（使用者可自行決定實際走法；系統不做最佳化）
    if (guideMode && numbers && pts.length > 1) {
      L.polyline(pts, { color: '#5f6368', weight: 2, dashArray: '6 6' }).bindTooltip('作者原始順序').addTo(g);
    }
  }, [places, selectedId, onSelect, guideMode, numbers]);

  // 攻略模式：地點變動時縮放到全部地點
  const placeKey = places.map((p) => p.place_id).join(',');
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !guideMode) return;
    const pts = places.filter((p) => p.latitude != null && p.longitude != null).map((p) => [p.latitude!, p.longitude!] as [number, number]);
    map.invalidateSize();
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeKey, guideMode]);

  // 選取時移動到該點
  useEffect(() => {
    const map = mapRef.current;
    const p = places.find((x) => x.place_id === selectedId);
    if (map && p?.latitude != null && p.longitude != null) {
      map.panTo([p.latitude, p.longitude]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // 目前位置
  useEffect(() => {
    const g = userLayerRef.current;
    if (!g) return;
    g.clearLayers();
    if (userPos) {
      L.circleMarker([userPos.lat, userPos.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 })
        .bindTooltip('目前位置')
        .addTo(g);
    }
  }, [userPos]);

  return <div ref={elRef} className="map" />;
}
