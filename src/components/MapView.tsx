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
}

function placeIcon(p: Place, selected: boolean) {
  const m = CATEGORY_META[p.category] ?? CATEGORY_META.attraction;
  return L.divIcon({
    className: '',
    html: `<div class="pin${selected ? ' pin-selected' : ''}" style="background:${m.color}"><span>${m.icon}</span></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
  });
}

export default function MapView({ center, radiusKm, places, selectedId, userPos, onSelect, onPickPoint }: Props) {
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
    return () => {
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
  }, [center, radiusKm]);

  // 推薦地點標記
  useEffect(() => {
    const g = layerRef.current;
    if (!g) return;
    g.clearLayers();
    for (const p of places) {
      if (p.latitude == null || p.longitude == null) continue;
      L.marker([p.latitude, p.longitude], {
        icon: placeIcon(p, p.place_id === selectedId),
        title: p.name,
        zIndexOffset: p.place_id === selectedId ? 1000 : 0,
      })
        .on('click', () => onSelect(p.place_id))
        .addTo(g);
    }
  }, [places, selectedId, onSelect]);

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
