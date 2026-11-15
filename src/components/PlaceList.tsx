import { memo } from 'react';
import { CATEGORY_META } from '../config';
import { formatDistance } from '../lib/geo';
import { MoreButton, useLimit } from '../lib/useLimit';
import type { Place } from '../types';

export interface Row {
  place: Place;
  distance: number;
  sourceCount: number;
}

interface Props {
  rows: Row[];
  favorites: string[];
  visited: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** 單一列：只有自己的資料變了才重新渲染（React.memo） */
const PlaceRow = memo(function PlaceRow({ row, fav, vis, sel, onSelect }: { row: Row; fav: boolean; vis: boolean; sel: boolean; onSelect: (id: string) => void }) {
  const { place: p, distance, sourceCount } = row;
  const m = CATEGORY_META[p.category];
  return (
    <li className={sel ? 'sel' : ''}>
      <button onClick={() => onSelect(p.place_id)}>
        <span className="li-icon" style={{ background: m?.color }}>{m?.icon}</span>
        <span className="li-body">
          <strong>
            {p.name}
            {fav && ' ★'}
            {vis && ' ✓'}
          </strong>
          <small>
            {m?.label} · {formatDistance(distance)}
            {sourceCount > 0 ? ` · ${sourceCount} 個來源推薦` : ''}
            {p.district ? ` · ${p.district}` : ''}
          </small>
        </span>
      </button>
    </li>
  );
});

export default function PlaceList({ rows, favorites, visited, selectedId, onSelect }: Props) {
  const { limit, more } = useLimit(`${rows.length}|${rows[0]?.place.place_id ?? ''}`);
  if (rows.length === 0) {
    return <div className="empty">範圍內沒有符合條件的推薦地點。可以加大範圍或換個分類。</div>;
  }
  const fav = new Set(favorites);
  const vis = new Set(visited);
  return (
    <>
      <ul className="place-list">
        {rows.slice(0, limit).map((r) => (
          <PlaceRow
            key={r.place.place_id}
            row={r}
            fav={fav.has(r.place.place_id)}
            vis={vis.has(r.place.place_id)}
            sel={r.place.place_id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </ul>
      <MoreButton shown={Math.min(limit, rows.length)} total={rows.length} onMore={more} />
    </>
  );
}
