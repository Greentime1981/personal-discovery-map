import { useState } from 'react';
import { CATEGORY_META } from '../config';
import type { SourceInfo } from '../lib/data';
import { MoreButton, useLimit } from '../lib/useLimit';
import type { Content, Place } from '../types';

export interface Video {
  url: string;
  title: string;
  source_name: string;
  published_at: string;
  items: { content: Content; place: Place }[]; // 依作者原始順序
}

interface Props {
  sources: SourceInfo[];
  source: SourceInfo | null;
  loading: boolean;
  onPickSource: (name: string | null) => void;
  videos: Video[];
  selected: Video | null;
  selectedPlaceId: string | null;
  onPickVideo: (url: string | null) => void;
  onSelectPlace: (id: string) => void;
}

/** 部落客攻略：影片清單 → 單支影片的地點（保留作者原始順序） */
export default function GuideList({ sources, source, loading, onPickSource, videos, selected, selectedPlaceId, onPickVideo, onSelectPlace }: Props) {
  const { limit, more } = useLimit(`${source?.name ?? ''}|${videos.length}|${videos[0]?.url ?? ''}`);
  const [q, setQ] = useState('');

  // 第一層：選來源（部落客 / YouTube 頻道）
  if (!source) {
    const list = q ? sources.filter((s) => s.name.toLowerCase().includes(q.toLowerCase())) : sources;
    return (
      <div>
        <div className="guide-head">
          <div><strong>選擇部落客或 YouTube 頻道</strong>（共 {sources.length} 個來源）</div>
          <input className="name-filter wide" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋來源名稱" aria-label="搜尋來源" />
        </div>
        <ul className="place-list">
          {list.map((s) => (
            <li key={s.k}>
              <button onClick={() => onPickSource(s.name)}>
                <span className="li-icon" style={{ background: s.type === 'youtube' ? '#c00' : s.type === 'manual' ? '#7b2ff7' : '#e8710a', color: '#fff' }}>
                  {s.type === 'youtube' ? '▶' : s.type === 'manual' ? '⭐' : '✎'}
                </span>
                <span className="li-body">
                  <strong>{s.name}</strong>
                  <small>{s.articles.toLocaleString()} 篇{s.type === 'youtube' ? '影片' : '文章'} · {s.count.toLocaleString()} 筆推薦{s.latest ? ` · 最新 ${s.latest}` : ''}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (loading) return <div className="empty">載入「{source.name}」的文章中…</div>;
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
  const back = (
    <div className="guide-head">
      <button className="link" onClick={() => onPickSource(null)}>‹ 返回來源清單</button>
      <div><strong>{source.name}</strong> · {videos.length.toLocaleString()} 篇有推薦店家</div>
    </div>
  );
  if (videos.length === 0) {
    return (
      <>
        {back}
        <div className="empty">這個來源目前還沒有找到店家地址。歷史文章補齊中，之後會陸續出現。</div>
      </>
    );
  }
  return (
    <>
    {back}
    <ul className="place-list">
      {videos.slice(0, limit).map((v) => (
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
    <MoreButton shown={Math.min(limit, videos.length)} total={videos.length} onMore={more} />
    </>
  );
}
