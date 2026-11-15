import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AwardsPanel from './components/AwardsPanel';
import GuideList, { type Video } from './components/GuideList';
import InstallButton from './components/InstallButton';
import MapView from './components/MapView';
import PlaceCard from './components/PlaceCard';
import PlaceList, { type Row } from './components/PlaceList';
import SearchBar from './components/SearchBar';
import StatusPanel from './components/StatusPanel';
import TripPlanner, { type TripMapState } from './components/TripPlanner';
import { CATEGORY_META, DEFAULT_CENTER, RADIUS_OPTIONS } from './config';
import { loadCityContents, loadPublicData, loadSourceContents, type PublicData } from './lib/data';
import { distanceKm } from './lib/geo';
import { useUserData } from './lib/userData';
import type { Category, Content, Destination, LatLng, Place } from './types';

type Mode = 'destination' | 'trip' | 'blogger' | 'guide';
type Filter = 'all' | Category | 'favorites';
type Sort = 'distance' | 'sources' | 'category';

const MODES: { id: Mode; label: string }[] = [
  { id: 'destination', label: '目的地探索' },
  { id: 'trip', label: '旅遊路線' },
  { id: 'blogger', label: '部落客攻略' },
  { id: 'guide', label: '米其林/500碗' },
];

const EMPTY_TRIP: TripMapState = { places: [], anchors: [], route: [], fitKey: '' };

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
  const [channel, setChannel] = useState('all');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [awardPlaces, setAwardPlaces] = useState<Place[]>([]);
  const [tripMap, setTripMap] = useState<TripMapState>(EMPTY_TRIP);
  const [showStatus, setShowStatus] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const fileRef = useRef<HTMLInputElement>(null);
  const user = useUserData();

  useEffect(() => {
    loadPublicData().then(setData);
  }, []);

  // 線上／離線切換：恢復連線時重新抓最新資料
  useEffect(() => {
    const on = () => { setOnline(true); loadPublicData().then(setData); };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
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
        setMode('destination');
      },
      () => flash('無法取得目前位置（請確認已允許定位）'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  const pickPoint = useCallback((p: LatLng) => {
    setCenter({ ...p, label: '地圖上選取的位置' });
    setSelectedId(null);
    setMode('destination');
  }, []);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setView('map');
  }, []);

  const switchMode = (m: Mode) => {
    setMode(m);
    setSelectedId(null);
  };

  const awardsByPlace = useMemo(() => groupBy(data?.awards ?? [], (a) => a.place_id), [data]);
  const latestYear = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of data?.awards ?? []) m[a.award_type] = Math.max(m[a.award_type] ?? 0, a.award_year);
    return m;
  }, [data]);

  // ---- 目的地探索 ----
  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const out: Row[] = [];
    for (const p of data.places) {
      if (p.latitude == null || p.longitude == null) continue; // 座標未確認的不上地圖
      if (filter === 'favorites' ? !user.data.favorites.includes(p.place_id) : filter !== 'all' && p.category !== filter) continue;
      const d = distanceKm(center, { lat: p.latitude, lng: p.longitude });
      if (d > radius) continue;
      const sourceCount = p.source_count ?? 0;
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
  }, [data, filter, center, radius, sort, user.data.favorites]);

  // ---- 部落客攻略 ----
  const placeById = useMemo(() => new Map((data?.places ?? []).map((p) => [p.place_id, p])), [data]);
  // 先選來源（部落客 / 頻道），才下載那個來源的推薦紀錄
  const source = data?.index.sources.find((s) => s.name === channel) ?? null;
  const [srcContents, setSrcContents] = useState<Content[]>([]);
  useEffect(() => {
    setSrcContents([]);
    if (source) loadSourceContents(source).then(setSrcContents);
  }, [source]);
  const allVideos: Video[] = useMemo(() => {
    const m = new Map<string, Video>();
    for (const c of srcContents) {
      const place = placeById.get(c.place_id);
      if (!place || !c.source_url) continue;
      let v = m.get(c.source_url);
      if (!v) {
        v = { url: c.source_url, title: c.title, source_name: c.source_name, published_at: c.published_at, items: [] };
        m.set(c.source_url, v);
      }
      v.items.push({ content: c, place });
    }
    const list = [...m.values()];
    for (const v of list) v.items.sort((a, b) => (a.content.original_sequence ?? 999) - (b.content.original_sequence ?? 999));
    return list.sort((a, b) => b.published_at.localeCompare(a.published_at));
  }, [srcContents, placeById]);
  const videos = allVideos;
  const video = allVideos.find((v) => v.url === videoUrl) ?? null;
  const guidePlaces: Place[] = useMemo(() => {
    if (!source) return [];
    const src = video ? [video] : videos;
    const seen = new Map<string, Place>();
    for (const v of src) for (const it of v.items) seen.set(it.place.place_id, it.place);
    return [...seen.values()];
  }, [source, video, videos]);
  const numbers = useMemo(() => {
    if (!video) return undefined;
    const n: Record<string, number> = {};
    for (const it of video.items) if (it.content.original_sequence != null && !(it.place.place_id in n)) n[it.place.place_id] = it.content.original_sequence;
    return n;
  }, [video]);
  const guideRoute = useMemo(
    () => (video ? video.items.filter((i) => i.place.latitude != null).map((i) => ({ lat: i.place.latitude!, lng: i.place.longitude! })) : []),
    [video],
  );

  // ---- 地圖要顯示什麼（依模式） ----
  const mapProps = (() => {
    switch (mode) {
      case 'blogger':
        return { places: guidePlaces, numbers, route: guideRoute, routeLabel: '作者原始順序', anchors: [], fitKey: 'b' + guidePlaces.map((p) => p.place_id).join(',') };
      case 'guide':
        return { places: awardPlaces, numbers: undefined, route: [], routeLabel: '', anchors: [], fitKey: 'g' + awardPlaces.map((p) => p.place_id).join(',') };
      case 'trip':
        return { places: tripMap.places, numbers: undefined, route: tripMap.route, routeLabel: '當天路線（直線）', anchors: tripMap.anchors, fitKey: 't' + tripMap.fitKey };
      default:
        return { places: rows.map((r) => r.place), numbers: undefined, route: [], routeLabel: '', anchors: [], fitKey: '' };
    }
  })();

  const selected = selectedId ? placeById.get(selectedId) : undefined;
  const [cardContents, setCardContents] = useState<Content[] | null>(null);
  useEffect(() => {
    setCardContents(null);
    if (!selected || !data) return;
    let alive = true;
    loadCityContents(data.index, selected.city).then((rows) => {
      if (alive) setCardContents(rows.filter((c) => c.place_id === selected.place_id));
    });
    return () => { alive = false; };
  }, [selected, data]);

  return (
    <div className={`app view-${view}`}>
      <header className="top">
        <div className="brand-row">
          <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" className="brand-icon" />
          <div className="brand-search">
            <SearchBar onPick={(d) => { setCenter(d); setSelectedId(null); setMode('destination'); }} onLocate={locate} />
          </div>
        </div>
        <InstallButton />
        {!online && (
          <div className="offline-bar">
            📴 離線模式：顯示上次更新的資料{data?.meta.last_updated ? `（${data.meta.last_updated}）` : ''}；看過的地圖區域可顯示，地址搜尋與導航需要網路
          </div>
        )}
        <nav className="modes">
          {MODES.map((m) => (
            <button key={m.id} className={m.id === mode ? 'on' : ''} onClick={() => switchMode(m.id)}>
              {m.label}
            </button>
          ))}
        </nav>
        {mode === 'destination' && (
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
            </div>
          </div>
        )}
      </header>

      <main className="body">
        <section className="map-wrap">
          <MapView
            center={center}
            radiusKm={radius}
            showRadius={mode === 'destination'}
            selectedId={selectedId}
            userPos={userPos}
            onSelect={select}
            onPickPoint={pickPoint}
            {...mapProps}
          />
          <div className="map-tools">
            <button className="link" onClick={() => setView(view === 'map' ? 'list' : 'map')}>{view === 'map' ? '☰ 清單' : '🗺 地圖'}</button>
          </div>
        </section>

        <aside className="sheet">
          {mode === 'destination' && (
            <>
              <div className="sheet-head">
                <span><strong>{center.label}</strong> 附近 {radius} 公里 · {rows.length} 個地點</span>
                <span className="menu">
                  <button className="link" onClick={() => setShowStatus(true)}>ⓘ 資料狀態</button>
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
                <PlaceList rows={rows} favorites={user.data.favorites} visited={user.data.visited} selectedId={selectedId} onSelect={select} />
              ) : (
                <div className="empty">載入資料中…</div>
              )}
            </>
          )}
          {mode === 'blogger' && (
            <GuideList
              sources={data?.index.sources ?? []}
              source={source}
              loading={!!source && srcContents.length === 0}
              onPickSource={(name) => { setChannel(name ?? 'all'); setVideoUrl(null); setSelectedId(null); }}
              videos={videos}
              selected={video}
              selectedPlaceId={selectedId}
              onPickVideo={(u) => { setVideoUrl(u); setSelectedId(null); }}
              onSelectPlace={select}
            />
          )}
          {mode === 'guide' && data && (
            <AwardsPanel
              places={data.places}
              awards={data.awards}
              notes={data.meta.award_notes ?? {}}
              selectedId={selectedId}
              onSelect={select}
              onShow={setAwardPlaces}
            />
          )}
          {mode === 'trip' && data && (
            <TripPlanner
              places={data.places}
              trips={user.data.trips}
              setTrips={user.setTrips}
              selectedId={selectedId}
              onSelect={select}
              onShow={setTripMap}
            />
          )}
        </aside>

        {selected && (
          <PlaceCard
            place={selected}
            distance={
              mode === 'destination' && selected.latitude != null && selected.longitude != null
                ? distanceKm(center, { lat: selected.latitude, lng: selected.longitude })
                : null
            }
            contents={(cardContents ?? []).slice().sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''))}
            contentsLoading={cardContents === null}
            awards={awardsByPlace.get(selected.place_id) ?? []}
            latestYear={latestYear}
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
      {showStatus && data && <StatusPanel data={data} onClose={() => setShowStatus(false)} />}
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
