import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { AWARD_LABEL, AWARD_ORDER } from '../config';
import { MoreButton, useLimit } from '../lib/useLimit';
import type { Award, AwardType, Place } from '../types';

interface Props {
  places: Place[];
  awards: Award[];
  notes: Record<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onShow: (places: Place[]) => void;
}

/** 把年份壓成區間：[2021,2022,2023,2025] → 2021–2023、2025 */
export function yearRanges(years: number[]): string {
  const ys = [...new Set(years)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < ys.length; i++) {
    let j = i;
    while (j + 1 < ys.length && ys[j + 1] === ys[j] + 1) j++;
    out.push(i === j ? `${ys[i]}` : `${ys[i]}–${ys[j]}`);
    i = j;
  }
  return out.join('、');
}

/** 依獎項分組的年度摘要（排序：三星 → 二星 → 一星 → 必比登 → 500碗） */
export function awardSummary(list: Award[]): { type: string; label: string; years: string; last: number }[] {
  const by = new Map<string, number[]>();
  for (const a of list) by.set(a.award_type, [...(by.get(a.award_type) ?? []), a.award_year]);
  return [...by.entries()]
    .sort((a, b) => AWARD_ORDER.indexOf(a[0] as AwardType) - AWARD_ORDER.indexOf(b[0] as AwardType))
    .map(([type, ys]) => ({ type, label: AWARD_LABEL[type as AwardType] ?? type, years: yearRanges(ys), last: Math.max(...ys) }));
}

const TYPE_CHIPS: { id: string; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'michelin_3', label: '三星' },
  { id: 'michelin_2', label: '二星' },
  { id: 'michelin_1', label: '一星' },
  { id: 'bib_gourmand', label: '必比登' },
  { id: 'taiwan_500', label: '500碗' },
];

export default function AwardsPanel({ places, awards, notes, selectedId, onSelect, onShow }: Props) {
  const [type, setType] = useState('all');
  const [year, setYear] = useState<string>('latest');
  const [city, setCity] = useState('');
  const [district, setDistrict] = useState('');
  const [q, setQ] = useState('');
  const dq = useDeferredValue(q); // 打字時先更新輸入框，清單稍後再更新，不會卡

  const placeById = useMemo(() => new Map(places.map((p) => [p.place_id, p])), [places]);
  const years = useMemo(() => [...new Set(awards.map((a) => a.award_year))].sort((a, b) => b - a), [awards]);
  const latest = years[0];
  const awardsByPlace = useMemo(() => {
    const m = new Map<string, Award[]>();
    for (const a of awards) m.set(a.place_id, [...(m.get(a.place_id) ?? []), a]);
    return m;
  }, [awards]);
  const cities = useMemo(
    () => [...new Set([...awardsByPlace.keys()].map((id) => placeById.get(id)?.city).filter(Boolean) as string[])].sort(),
    [awardsByPlace, placeById],
  );
  const districts = useMemo(
    () =>
      city
        ? [...new Set([...awardsByPlace.keys()].map((id) => placeById.get(id)).filter((p) => p?.city === city && p.district).map((p) => p!.district))].sort()
        : [],
    [city, awardsByPlace, placeById],
  );

  const rows = useMemo(() => {
    const y = year === 'latest' ? latest : year === 'all' ? null : Number(year);
    const out: { place: Place; list: Award[]; match: Award[] }[] = [];
    for (const [pid, list] of awardsByPlace) {
      const place = placeById.get(pid);
      if (!place) continue;
      if (city && place.city !== city) continue;
      if (district && place.district !== district) continue;
      if (dq && !place.name.toLowerCase().includes(dq.toLowerCase())) continue;
      const match = list.filter((a) => (type === 'all' || a.award_type === type) && (y == null || a.award_year === y));
      if (!match.length) continue;
      out.push({ place, list, match });
    }
    const rank = (r: (typeof out)[number]) => Math.min(...r.match.map((a) => AWARD_ORDER.indexOf(a.award_type as AwardType)));
    return out.sort((a, b) => rank(a) - rank(b) || a.place.name.localeCompare(b.place.name, 'zh-Hant'));
  }, [awardsByPlace, placeById, type, year, latest, city, district, dq]);

  const key = rows.map((r) => r.place.place_id).join(',');
  const { limit, more } = useLimit(key);
  useEffect(() => {
    onShow(rows.map((r) => r.place));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const onMap = rows.filter((r) => r.place.latitude != null).length;
  const yearNote = year !== 'latest' && year !== 'all' ? notes[year] : '';

  return (
    <div>
      <div className="awards-filters">
        <div className="chips">
          {TYPE_CHIPS.map((c) => (
            <button key={c.id} className={`chip${type === c.id ? ' on' : ''}`} onClick={() => setType(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="selects">
          <label>
            年度
            <select value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="latest">最新（{latest ?? '—'}）</option>
              <option value="all">歷年全部</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label>
            縣市
            <select value={city} onChange={(e) => { setCity(e.target.value); setDistrict(''); }}>
              <option value="">全部</option>
              {cities.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          {city && (
            <label>
              行政區
              <select value={district} onChange={(e) => setDistrict(e.target.value)}>
                <option value="">全部</option>
                {districts.map((d) => <option key={d}>{d}</option>)}
              </select>
            </label>
          )}
          <input className="name-filter" value={q} onChange={(e) => setQ(e.target.value)} placeholder="店名" aria-label="店名篩選" />
        </div>
      </div>
      <div className="sheet-head">
        <span>符合 {rows.length} 家 · 地圖上 {onMap} 家</span>
      </div>
      {(yearNote || (type === 'taiwan_500' && notes.taiwan_500)) && (
        <div className="data-note">{type === 'taiwan_500' ? notes.taiwan_500 : yearNote}</div>
      )}
      {rows.length === 0 ? (
        <div className="empty">沒有符合條件的餐廳。</div>
      ) : (
        <ul className="place-list">
          {rows.slice(0, limit).map(({ place: p, list }) => (
            <li key={p.place_id} className={p.place_id === selectedId ? 'sel' : ''}>
              <button onClick={() => onSelect(p.place_id)}>
                <span className="li-icon award-icon">{list.some((a) => a.award_type.startsWith('michelin')) ? '✿' : list.some((a) => a.award_type === 'bib_gourmand') ? '😋' : '🥣'}</span>
                <span className="li-body">
                  <strong>{p.name}</strong>
                  <small>
                    {[p.city, p.district].filter(Boolean).join(' ')}
                    {p.latitude == null ? ' · 尚無座標' : ''}
                  </small>
                  <small className="award-line">
                    {awardSummary(list).map((s) => `${s.label} ${s.years}`).join(' ｜ ')}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <MoreButton shown={Math.min(limit, rows.length)} total={rows.length} onMore={more} />
    </div>
  );
}
