import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapView from './components/MapView';
import PlaceCard from './components/PlaceCard';
import PlaceList, { type Row } from './components/PlaceList';
import SearchBar from './components/SearchBar';
import { CATEGORY_META, DEFAULT_CENTER, RADIUS_OPTIONS } from './config';
import { loadPublicData, type PublicData } from './lib/data';
import { distanceKm } from './lib/geo';
import { useUserData } from './lib/userData';
import type { Category, Destination, LatLng } from './types';

type Mode = 'destination' | 'trip' | 'blogger' | 'guide';
type Filter = 'all' | Category | 'favorites';
type Sort = 'distance' | 'sources' | 'category';

const MODES: { id: Mode; label: string; phase?: string }[] = [
  { id: 'destination', label: '目的地探索' },
  { id: 'trip', label: '旅遊路線', phase: '第五階段' },
  { id: 'blogger', label: '部落客攻略', phase: '第三階段' },
  { id: 'guide', label: '米其林/500碗', phase: '第四階段' },
];

export default function App() {
  const [data, setData] = useState<PublicData | null>(null);
  const [center, setCenter] = useState<Destination>(DEFAULT_CENTER);
  const [radius, setRadius] = useState(3);
  const [customRadius, setCustomRadius] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('distance');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'map' | 'list'>('map');
  const [mode, setMode] = useState<Mode>('destination');
  const [userPos, setUserPos] = useState<LatLng | null>(null);
  const [toast, setToast] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const user = useUserData();

  useEffect(() => {
    loadPublicData().then(setData);
  }, []);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const locate = useCallback(() => {
    if (!navigator.geolocation) return flash('此裝置不支援定位');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserPos(p);
        setCenter({ ...p, label: '目前位置' });
      },
      () => flash('無法取得目前位置（請確認已允許定位）'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  const pickPoint = useCallback((p: LatLng) => {
    setCenter({ ...p, label: '地圖上選取的位置' });
    setSelectedId(null);
  }, []);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setView('map');
  }, []);

  const contentsByPlace = useMemo(() => groupBy(data?.contents ?? [], (c) => c.place_id), [data]);
  const awardsByPlace = useMemo(() => groupBy(data?.awards ?? [], (a) => a.place_id), [data]);

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const out: Row[] = [];
    for (const p of data.places) {
      if (p.latitude == null || p.longitude == null) continue; // 座標未確認的不上地圖
      if (filter === 'favorites' ? !user.data.favorites.includes(p.place_id) : filter !== 'all' && p.category !== filter) continue;
      const d = distanceKm(center, { lat: p.latitude, lng: p.longitude });
      if (d > radius) continue;
      const sourceCount = new Set((contentsByPlace.get(p.place_id) ?? []).map((c) => c.source_name)).size;
      out.push({ place: p, distance: d, sourceCount });
    }
    const order = Object.keys(CATEGORY_META);
    out.sort((a, b) =>
      sort === 'sources'
        ? b.sourceCount - a.sourceCount || a.distance - b.distance
        : sort === 'category'
          ? order.indexOf(a.place.category) - order.indexOf(b.place.category) || a.distance - b.distance
          : a.distance - b.distance,
    );
    return out;
  }, [data, filter, center, radius, sort, contentsByPlace, user.data.favorites]);

  const selectedRow = rows.find((r) => r.place.place_id === selectedId);
  const selected = selectedRow?.place ?? data?.places.find((p) => p.place_id === selectedId);
  const activeMode = MODES.find((m) => m.id === mode)!;

  return (
    <div className={`app view-${view}`}>
      <header className="top">
        <SearchBar onPick={(d) => { setCenter(d); setSelectedId(null); }} onLocate={locate} />
        <nav className="modes">
          {MODES.map((m) => (
            <button key={m.id} className={m.id === mode ? 'on' : ''} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </nav>
        {mode === 'destination' ? (
          <div className="filters">
            <div className="chips">
              <Chip on={filter === 'all'} onClick={() => setFilter('all')}>全部</Chip>
              {(Object.keys(CATEGORY_META) as Category[]).map((c) => (
                <Chip key={c} on={filter === c} onClick={() => setFilter(c)}>
                  {CATEGORY_META[c].icon} {CATEGORY_META[c].label}
                </Chip>
              ))}
              <Chip on={filter === 'favorites'} onClick={() => setFilter('favorites')}>★ 收藏</Chip>
            </div>
            <div className="selects">
              <label>
                範圍
                <select
                  value={customRadius ? 'custom' : String(radius)}
                  onChange={(e) => {
                    if (e.target.value === 'custom') setCustomRadius(true);
                    else { setCustomRadius(false); setRadius(Number(e.target.value)); }
                  }}
                >
                  {RADIUS_OPTIONS.map((r) => <option key={r} value={r}>{r} 公里</option>)}
                  <option value="custom">自訂</option>
                </select>
              </label>
              {customRadius && (
                <input
                  type="number" min={0.2} max={100} step={0.5} value={radius}
                  onChange={(e) => setRadius(Math.max(0.2, Number(e.target.value) || 0.2))}
                  aria-label="自訂範圍（公里）" className="num"
                />
              )}
              <label>
                排序
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  <option value="distance">距離</option>
                  <option value="sources">推薦來源數</option>
                  <option value="category">分類</option>
                </select>
              </label>
              <button className="link" onClick={() => setView(view === 'map' ? 'list' : 'map')}>
                {view === 'map' ? '清單模式' : '地圖模式'}
              </button>
            </div>
          </div>
        ) : (
          <div className="todo">「{activeMode.label}」預計於{activeMode.phase}開發，目前請使用「目的地探索」。</div>
        )}
      </header>

      <main className="body">
        <section className="map-wrap">
          <MapView
            center={center}
            radiusKm={radius}
            places={rows.map((r) => r.place)}
            selectedId={selectedId}
            userPos={userPos}
            onSelect={select}
            onPickPoint={pickPoint}
          />
          <div className="map-hint">右鍵 / 長按地圖可設為目的地</div>
        </section>

        <aside className="sheet">
          <div className="sheet-head">
            <span>
              <strong>{center.label}</strong> 附近 {radius} 公里 · {rows.length} 個地點
            </span>
            <span className="menu">
              <button className="link" onClick={user.exportJson}>匯出個人資料</button>
              <button className="link" onClick={() => fileRef.current?.click()}>匯入</button>
              <input
                ref={fileRef} type="file" accept="application/json" hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try { await user.importJson(f); flash('已匯入個人資料'); }
                  catch { flash('檔案格式不正確'); }
                  e.target.value = '';
                }}
              />
            </span>
          </div>
          {data?.meta.note && <div className="data-note">{data.meta.note}</div>}
          {data ? (
            <PlaceList
              rows={rows}
              favorites={user.data.favorites}
              visited={user.data.visited}
              selectedId={selectedId}
              onSelect={select}
            />
          ) : (
            <div className="empty">載入資料中…</div>
          )}
        </aside>

        {selected && (
          <PlaceCard
            place={selected}
            distance={
              selected.latitude != null && selected.longitude != null
                ? distanceKm(center, { lat: selected.latitude, lng: selected.longitude })
                : null
            }
            contents={(contentsByPlace.get(selected.place_id) ?? []).slice().sort(
              (a, b) => (b.published_at || '').localeCompare(a.published_at || ''),
            )}
            awards={awardsByPlace.get(selected.place_id) ?? []}
            favorite={user.data.favorites.includes(selected.place_id)}
            visited={user.data.visited.includes(selected.place_id)}
            note={user.data.notes[selected.place_id] ?? ''}
            onToggleFavorite={() => user.toggle('favorites', selected.place_id)}
            onToggleVisited={() => user.toggle('visited', selected.place_id)}
            onNote={(t) => user.setNote(selected.place_id, t)}
            onClose={() => setSelectedId(null)}
          />
        )}
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={`chip${on ? ' on' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}
