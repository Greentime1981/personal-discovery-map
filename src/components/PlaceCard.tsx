import { AWARD_LABEL, CATEGORY_META } from '../config';
import { formatDistance, googleMapsDirUrl } from '../lib/geo';
import type { Award, AwardType, Content, Place } from '../types';

interface Props {
  place: Place;
  distance: number | null;
  contents: Content[];
  awards: Award[];
  favorite: boolean;
  visited: boolean;
  note: string;
  onToggleFavorite: () => void;
  onToggleVisited: () => void;
  onNote: (t: string) => void;
  onClose: () => void;
}

const NA = <span className="na">尚無資料</span>;

export default function PlaceCard(props: Props) {
  const { place: p, distance, contents, awards } = props;
  const cat = CATEGORY_META[p.category];
  const sourceCount = new Set(contents.map((c) => c.source_name)).size;
  const sortedAwards = [...awards].sort((a, b) => b.award_year - a.award_year);

  return (
    <div className="card" role="dialog" aria-label={p.name}>
      <div className="card-head">
        <h2>{p.name}</h2>
        <button className="icon-btn" onClick={props.onClose} aria-label="關閉">✕</button>
      </div>
      {p.sample && <div className="sample-tag">範例資料：位置為概略值，尚未驗證</div>}
      {!p.sample && p.geo_precision === 'street' && (
        <div className="sample-tag">地圖位置為路段概略位置，導航會以店名 + 地址查詢</div>
      )}
      <dl>
        <dt>分類</dt>
        <dd>{cat ? `${cat.icon} ${cat.label}` : NA}</dd>
        <dt>地址</dt>
        <dd>{p.address || NA}</dd>
        <dt>距離</dt>
        <dd>{distance != null ? `距目的地 ${formatDistance(distance)}（直線）` : NA}</dd>
        <dt>推薦理由</dt>
        <dd>
          {contents.some((c) => c.summary)
            ? contents.filter((c) => c.summary).map((c) => <p key={c.content_id}>{c.summary}</p>)
            : NA}
        </dd>
        <dt>推薦來源</dt>
        <dd>
          {contents.length ? (
            <ul className="src-list">
              {contents.map((c) => (
                <li key={c.content_id}>
                  {c.source_type === 'youtube' ? '▶ ' : c.source_type === 'manual' ? '⭐ ' : '📝 '}
                  {c.source_url ? (
                    <a href={c.source_url} target="_blank" rel="noopener noreferrer">{c.title || c.source_name}</a>
                  ) : (
                    c.title || c.source_name
                  )}
                  <span className="muted">（{c.source_name}{c.published_at ? `，${c.published_at}` : ''}
                    {c.original_sequence != null ? `，影片中第 ${c.original_sequence} 間` : ''}）</span>
                </li>
              ))}
            </ul>
          ) : NA}
        </dd>
        <dt>推薦數量</dt>
        <dd>{sourceCount ? `${sourceCount} 個獨立來源` : NA}</dd>
        <dt>評鑑</dt>
        <dd>
          {sortedAwards.length
            ? sortedAwards.map((a) => (
                <div key={a.award_id}>
                  {AWARD_LABEL[a.award_type as AwardType] ?? a.award_type}（{a.award_year} 年）
                  {a.source_url && (
                    <a href={a.source_url} target="_blank" rel="noopener noreferrer"> 來源</a>
                  )}
                </div>
              ))
            : NA}
        </dd>
        <dt>價格</dt>
        <dd>{p.price_range || NA}</dd>
        <dt>備註</dt>
        <dd>
          <textarea
            value={props.note}
            onChange={(e) => props.onNote(e.target.value)}
            placeholder="個人備註（只存在這台裝置）"
            rows={2}
          />
        </dd>
      </dl>
      <div className="card-actions">
        <a className="btn primary" href={googleMapsDirUrl(p)} target="_blank" rel="noopener noreferrer">導航</a>
        <button className={`btn${props.favorite ? ' on' : ''}`} onClick={props.onToggleFavorite}>
          {props.favorite ? '★ 已收藏' : '☆ 收藏'}
        </button>
        <button className={`btn${props.visited ? ' on' : ''}`} onClick={props.onToggleVisited}>
          {props.visited ? '✓ 已造訪' : '已造訪？'}
        </button>
      </div>
    </div>
  );
}
