import { CATEGORY_META } from '../config';
import type { Content, Place } from '../types';

export interface Video {
  url: string;
  title: string;
  source_name: string;
  published_at: string;
  items: { content: Content; place: Place }[]; // 依作者原始順序
}

interface Props {
  videos: Video[];
  selected: Video | null;
  selectedPlaceId: string | null;
  onPickVideo: (url: string | null) => void;
  onSelectPlace: (id: string) => void;
}

/** 部落客攻略：影片清單 → 單支影片的地點（保留作者原始順序） */
export default function GuideList({ videos, selected, selectedPlaceId, onPickVideo, onSelectPlace }: Props) {
  if (selected) {
    return (
      <div>
        <div className="guide-head">
          <button className="link" onClick={() => onPickVideo(null)}>‹ 返回影片清單</button>
          <div><strong>{selected.title}</strong></div>
          <div className="muted">
            {selected.source_name} · {selected.published_at} ·{' '}
            <a href={selected.url} target="_blank" rel="noopener noreferrer">觀看影片</a>
          </div>
          <div className="muted">以下為影片說明中的<strong>作者原始順序</strong>（非系統最佳化）</div>
        </div>
        <ul className="place-list">
          {selected.items.map(({ content, place: p }) => {
            const m = CATEGORY_META[p.category];
            return (
              <li key={content.content_id} className={p.place_id === selectedPlaceId ? 'sel' : ''}>
                <button onClick={() => onSelectPlace(p.place_id)}>
                  <span className="li-icon" style={{ background: m?.color, color: '#fff' }}>
                    {content.original_sequence ?? '–'}
                  </span>
                  <span className="li-body">
                    <strong>{p.name}</strong>
                    <small>
                      {p.address}
                      {p.latitude == null ? ' · 尚無座標，未顯示在地圖' : ''}
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
  if (videos.length === 0) {
    return <div className="empty">尚無攻略資料。資料蒐集每天自動執行，有新影片後會出現在這裡。</div>;
  }
  return (
    <ul className="place-list">
      {videos.map((v) => (
        <li key={v.url}>
          <button onClick={() => onPickVideo(v.url)}>
            <span className="li-icon" style={{ background: '#c00', color: '#fff' }}>▶</span>
            <span className="li-body">
              <strong>{v.title}</strong>
              <small>
                {v.source_name} · {v.published_at} · {v.items.length} 個地點
              </small>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
