import { useEffect, useMemo, useState } from 'react';
import { CATEGORY_META } from '../config';
import { formatDistance } from '../lib/geo';
import { tripCandidates } from '../lib/trip';
import type { Category, Destination, LatLng, Place, Trip } from '../types';
import LocationInput from './LocationInput';
import type { Anchor } from './MapView';

export interface TripMapState {
  places: Place[];
  anchors: Anchor[];
  route: LatLng[];
  fitKey: string;
}

interface Props {
  places: Place[];
  trips: Trip[];
  setTrips: (t: Trip[]) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onShow: (s: TripMapState) => void;
}

const newTrip = (n: number): Trip => ({ id: `t${Date.now()}`, name: `我的旅程 ${n}`, hotel: null, days: [{ stops: [] }] });

export default function TripPlanner({ places, trips, setTrips, selectedId, onSelect, onShow }: Props) {
  const [tripId, setTripId] = useState<string>(trips[0]?.id ?? '');
  const [day, setDay] = useState(0);
  const [corridor, setCorridor] = useState(2);
  const [hotelKm, setHotelKm] = useState(2);
  const [cat, setCat] = useState<Category | 'all'>('all');

  const trip = trips.find((t) => t.id === tripId) ?? null;
  const update = (patch: Partial<Trip>) => trip && setTrips(trips.map((t) => (t.id === trip.id ? { ...t, ...patch } : t)));
  const stops = trip?.days[day]?.stops ?? [];
  const setStops = (s: Destination[]) => trip && update({ days: trip.days.map((d, i) => (i === day ? { stops: s } : d)) });

  const points = useMemo(() => {
    if (!trip) return [];
    const pts = [...(trip.hotel ? [{ ...trip.hotel, label: '飯店' }] : []), ...stops.map((s, i) => ({ ...s, label: `${i + 1}. ${s.label}` }))];
    if (trip.hotel && stops.length) pts.push({ ...trip.hotel, label: '飯店' });
    return pts;
  }, [trip, stops]);

  const hits = useMemo(() => {
    if (!trip || !points.length) return [];
    const pool = cat === 'all' ? places : places.filter((p) => p.category === cat);
    return tripCandidates(pool, points, trip.hotel, corridor, hotelKm);
  }, [trip, points, places, cat, corridor, hotelKm]);

  const key = `${tripId}|${day}|${points.map((p) => p.lat + ',' + p.lng).join(';')}`;
  useEffect(() => {
    const anchors: Anchor[] = [
      ...(trip?.hotel ? [{ ...trip.hotel, label: `飯店：${trip.hotel.label}`, kind: 'hotel' as const }] : []),
      ...stops.map((s, i) => ({ ...s, label: `第 ${i + 1} 站：${s.label}`, kind: 'stop' as const, num: i + 1 })),
    ];
    onShow({ places: hits.map((h) => h.place), anchors, route: points, fitKey: key });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits, key]);

  if (!trip) {
    return (
      <div className="trip">
        <p className="empty">建立旅程後，輸入住宿飯店和每天要去的地方，就會列出飯店周邊與沿途的推薦地點。行程只存在這台裝置。</p>
        <button
          className="btn primary wide"
          onClick={() => {
            const t = newTrip(trips.length + 1);
            setTrips([...trips, t]);
            setTripId(t.id);
            setDay(0);
          }}
        >
          ＋ 建立旅程
        </button>
      </div>
    );
  }

  return (
    <div className="trip">
      <div className="trip-row">
        <select value={trip.id} onChange={(e) => { setTripId(e.target.value); setDay(0); }} aria-label="選擇旅程">
          {trips.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button className="link" onClick={() => { const t = newTrip(trips.length + 1); setTrips([...trips, t]); setTripId(t.id); setDay(0); }}>＋ 新旅程</button>
        <button
          className="link danger"
          onClick={() => {
            if (!confirm(`刪除「${trip.name}」？`)) return;
            const rest = trips.filter((t) => t.id !== trip.id);
            setTrips(rest);
            setTripId(rest[0]?.id ?? '');
            setDay(0);
          }}
        >
          刪除
        </button>
      </div>
      <input className="trip-name" value={trip.name} onChange={(e) => update({ name: e.target.value })} aria-label="旅程名稱" />

      <div className="trip-block">
        <div className="trip-label">🏨 住宿飯店</div>
        {trip.hotel ? (
          <div className="trip-item">
            <span>{trip.hotel.label}</span>
            <button className="link" onClick={() => update({ hotel: null })}>更換</button>
          </div>
        ) : (
          <LocationInput placeholder="輸入飯店名稱或地址" onPick={(d) => update({ hotel: d })} />
        )}
      </div>

      <div className="day-tabs">
        {trip.days.map((_, i) => (
          <button key={i} className={`chip${i === day ? ' on' : ''}`} onClick={() => setDay(i)}>第 {i + 1} 天</button>
        ))}
        <button className="chip" onClick={() => { update({ days: [...trip.days, { stops: [] }] }); setDay(trip.days.length); }}>＋ 一天</button>
        {trip.days.length > 1 && (
          <button className="link danger" onClick={() => { update({ days: trip.days.filter((_, i) => i !== day) }); setDay(Math.max(0, day - 1)); }}>刪除這天</button>
        )}
      </div>

      <div className="trip-block">
        <div className="trip-label">📍 第 {day + 1} 天的目的地（依順序）</div>
        {stops.map((s, i) => (
          <div className="trip-item" key={i}>
            <span><b>{i + 1}.</b> {s.label}</span>
            <span>
              {i > 0 && <button className="link" onClick={() => { const n = [...stops]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setStops(n); }} aria-label="上移">↑</button>}
              <button className="link danger" onClick={() => setStops(stops.filter((_, j) => j !== i))} aria-label="移除">✕</button>
            </span>
          </div>
        ))}
        <LocationInput placeholder="加入目的地（景點、餐廳、地址）" onPick={(d) => setStops([...stops, d])} />
      </div>

      <div className="selects trip-settings">
        <label>
          路線附近
          <select value={corridor} onChange={(e) => setCorridor(Number(e.target.value))}>
            {[1, 2, 3, 5, 10].map((k) => <option key={k} value={k}>{k} 公里</option>)}
          </select>
        </label>
        <label>
          飯店周邊
          <select value={hotelKm} onChange={(e) => setHotelKm(Number(e.target.value))}>
            {[1, 2, 3, 5].map((k) => <option key={k} value={k}>{k} 公里</option>)}
          </select>
        </label>
        <label>
          分類
          <select value={cat} onChange={(e) => setCat(e.target.value as Category | 'all')}>
            <option value="all">全部</option>
            {(Object.keys(CATEGORY_META) as Category[]).map((c) => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}
          </select>
        </label>
      </div>

      <div className="sheet-head">
        <span>{points.length ? `沿途與飯店周邊 ${hits.length} 個推薦` : '先輸入飯店或目的地'}</span>
      </div>
      <div className="data-note">距離為直線估算；繞路時間以平均時速 40 公里、道路係數 1.3 估計，實際請以導航為準。</div>
      <ul className="place-list">
        {hits.map((h) => {
          const m = CATEGORY_META[h.place.category];
          return (
            <li key={h.place.place_id} className={h.place.place_id === selectedId ? 'sel' : ''}>
              <button onClick={() => onSelect(h.place.place_id)}>
                <span className="li-icon" style={{ background: m?.color }}>{m?.icon}</span>
                <span className="li-body">
                  <strong>{h.place.name}</strong>
                  <small>
                    {h.reason === 'route'
                      ? `距路線 ${formatDistance(h.routeKm)} · ${h.detourMin < 1 ? '幾乎順路' : `多繞約 ${h.detourMin} 分鐘`} · ${h.nearStop}`
                      : `距飯店 ${formatDistance(h.hotelKm ?? 0)}`}
                  </small>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
