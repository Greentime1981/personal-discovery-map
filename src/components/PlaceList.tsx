import { CATEGORY_META } from '../config';
import { formatDistance } from '../lib/geo';
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

export default function PlaceList({ rows, favorites, visited, selectedId, onSelect }: Props) {
  if (rows.length === 0) {
    return <div className="empty">範圍內沒有符合條件的推薦地點。可以加大範圍或換個分類。</div>;
  }
  return (
    <ul className="place-list">
      {rows.map(({ place: p, distance, sourceCount }) => {
        const m = CATEGORY_META[p.category];
        return (
          <li key={p.place_id} className={p.place_id === selectedId ? 'sel' : ''}>
            <button onClick={() => onSelect(p.place_id)}>
              <span className="li-icon" style={{ background: m?.color }}>{m?.icon}</span>
              <span className="li-body">
                <strong>
                  {p.name}
                  {favorites.includes(p.place_id) && ' ★'}
                  {visited.includes(p.place_id) && ' ✓'}
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
      })}
    </ul>
  );
}
