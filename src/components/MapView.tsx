import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';

/** 超過這個數量的地點才聚合 */
const CLUSTER_MIN = 80;
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
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const markersRef = useRef(new Map<string, { marker: L.Marker; place: Place }>());
  const selectedRef = useRef<string | null>(selectedId);
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
    clusterRef.current = L.markerClusterGroup({
      chunkedLoading: true, // 分批加入，不會一次卡住畫面
      maxClusterRadius: 45,
      disableClusteringAtZoom: 17, // 放大到街道層級就全部展開
      showCoverageOnHover: false,
      iconCreateFunction: (c) => {
        const n = c.getChildCount();
        const size = n < 10 ? 34 : n < 100 ? 40 : 46;
        return L.divIcon({ className: '', html: `<div class="cluster" style="width:${size}px;height:${size}px">${n}</div>`, iconSize: [size, size] });
      },
    }).addTo(map);
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
    map.fitBounds(circle.getBounds(), { padding: [20, 20], animate: false });
  }, [center, radiusKm, showRadius]);

  // 推薦地點標記：地點多時用「聚合」（附近的點合成一個數字泡泡，放大才展開），手機才不會卡
  useEffect(() => {
    const plain = layerRef.current;
    const cluster = clusterRef.current;
    if (!plain || !cluster) return;
    plain.clearLayers();
    cluster.clearLayers();
    markersRef.current.clear();
    const located = places.filter((p) => p.latitude != null && p.longitude != null);
    const useCluster = !numbers && located.length > CLUSTER_MIN; // 攻略的編號路線不聚合，順序才看得清楚
    const markers = located.map((p) => {
      const m = L.marker([p.latitude!, p.longitude!], {
        icon: placeIcon(p, p.place_id === selectedRef.current, numbers?.[p.place_id]),
        title: p.name,
      }).on('click', () => onSelect(p.place_id));
      markersRef.current.set(p.place_id, { marker: m, place: p });
      return m;
    });
    if (useCluster) cluster.addLayers(markers);
    else for (const m of markers) m.addTo(plain);
  }, [places, onSelect, numbers]);

  // 選取變化時只更新前後兩個標記，不重畫全部
  const prevSel = useRef<string | null>(null);
  useEffect(() => {
    selectedRef.current = selectedId;
    for (const id of [prevSel.current, selectedId]) {
      const hit = id ? markersRef.current.get(id) : undefined;
      if (!hit) continue;
      const on = id === selectedId;
      hit.marker.setIcon(placeIcon(hit.place, on, numbers?.[hit.place.place_id]));
      hit.marker.setZIndexOffset(on ? 1000 : 0);
    }
    prevSel.current = selectedId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

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
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 16, animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, showRadius]);

  // 選取時移動到該點
  useEffect(() => {
    const map = mapRef.current;
    const p = places.find((x) => x.place_id === selectedId);
    // 點選時放大到街道層級，避免在全台縮圖中找不到；在聚合泡泡裡的點要放大到能展開
    const hit = selectedId ? markersRef.current.get(selectedId) : undefined;
    const inCluster = !!hit && !!clusterRef.current?.hasLayer(hit.marker);
    if (map && p?.latitude != null && p.longitude != null) {
      map.setView([p.latitude, p.longitude], Math.max(map.getZoom(), inCluster ? 17 : 15), { animate: false });
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
