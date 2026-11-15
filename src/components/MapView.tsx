import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CATEGORY_META, TILE_ATTRIBUTION, TILE_URL } from '../config';
import type { Destination, LatLng, Place } from '../types';

/** 地圖上的固定點：飯店、每日目的地 */
export interface Anchor extends LatLng {
  label: string;
  kind: 'hotel' | 'stop';
  num?: number;
}

interface Props {
  center: Destination;
  radiusKm: number;
  /** true：目的地探索（畫搜尋範圍圈）；false：縮放到所有地點 */
  showRadius: boolean;
  places: Place[];
  selectedId: string | null;
  userPos: LatLng | null;
  onSelect: (id: string) => void;
  onPickPoint: (p: LatLng) => void; // 右鍵 / 長按地圖設為目的地
  numbers?: Record<string, number>;
  route?: LatLng[];
  routeLabel?: string;
  anchors?: Anchor[];
  /** 內容變了才重新縮放（避免每次點選都跳動） */
  fitKey?: string;
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

function anchorIcon(a: Anchor) {
  const text = a.kind === 'hotel' ? '🏨' : String(a.num ?? '');
  return L.divIcon({
    className: '',
    html: `<div class="anchor anchor-${a.kind}">${text}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

export default function MapView(props: Props) {
  const { center, radiusKm, showRadius, places, selectedId, userPos, onSelect, onPickPoint, numbers, route, routeLabel, anchors, fitKey } = props;
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);
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
    centerLayerRef.current = L.layerGroup().addTo(map);
    overlayRef.current = L.layerGroup().addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
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
    if (!showRadius) return;
    const circle = L.circle([center.lat, center.lng], { radius: radiusKm * 1000, color: '#7b2ff7', weight: 1, fillOpacity: 0.05 }).addTo(g);
    L.circleMarker([center.lat, center.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#d93025', fillOpacity: 1 })
      .bindTooltip(center.label)
      .addTo(g);
    map.invalidateSize();
    map.fitBounds(circle.getBounds(), { padding: [20, 20] });
  }, [center, radiusKm, showRadius]);

  // 推薦地點標記
  useEffect(() => {
    const g = layerRef.current;
    if (!g) return;
    g.clearLayers();
    for (const p of places) {
      if (p.latitude == null || p.longitude == null) continue;
      L.marker([p.latitude, p.longitude], {
        icon: placeIcon(p, p.place_id === selectedId, numbers?.[p.place_id]),
        title: p.name,
        zIndexOffset: p.place_id === selectedId ? 1000 : 0,
      })
        .on('click', () => onSelect(p.place_id))
        .addTo(g);
    }
  }, [places, selectedId, onSelect, numbers]);

  // 路線與固定點（攻略原始順序、旅遊行程）
  useEffect(() => {
    const g = overlayRef.current;
    if (!g) return;
    g.clearLayers();
    if (route && route.length > 1) {
      L.polyline(route.map((p) => [p.lat, p.lng] as [number, number]), { color: '#7b2ff7', weight: 3, opacity: 0.7, dashArray: '8 8' })
        .bindTooltip(routeLabel ?? '路線')
        .addTo(g);
    }
    for (const a of anchors ?? []) {
      L.marker([a.lat, a.lng], { icon: anchorIcon(a), title: a.label, zIndexOffset: 2000 }).bindTooltip(a.label).addTo(g);
    }
  }, [route, routeLabel, anchors]);

  // 非範圍模式：內容改變時縮放到全部
  useEffect(() => {
    const map = mapRef.current;
    if (!map || showRadius) return;
    const pts: [number, number][] = [];
    for (const p of places) if (p.latitude != null && p.longitude != null) pts.push([p.latitude, p.longitude]);
    for (const a of anchors ?? []) pts.push([a.lat, a.lng]);
    map.invalidateSize();
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, showRadius]);

  // 選取時移動到該點
  useEffect(() => {
    const map = mapRef.current;
    const p = places.find((x) => x.place_id === selectedId);
    // 點選時放大到街道層級，避免在全台縮圖中找不到
    if (map && p?.latitude != null && p.longitude != null) map.setView([p.latitude, p.longitude], Math.max(map.getZoom(), 15));
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
