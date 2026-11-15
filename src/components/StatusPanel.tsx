import type { PublicData } from '../lib/data';

/** 資料狀態（第六階段）：最後更新、各來源數量、最近的錯誤 */
export default function StatusPanel({ data, onClose }: { data: PublicData; onClose: () => void }) {
  const s = data.status;
  const located = data.places.filter((p) => p.latitude != null).length;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="資料狀態" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>資料狀態</h2>
          <button className="icon-btn" onClick={onClose} aria-label="關閉">✕</button>
        </div>
        <dl>
          <dt>最後更新</dt>
          <dd>{s?.run_at ? new Date(s.run_at).toLocaleString('zh-TW') : data.meta.last_updated || '尚無資料'}
            {s?.runner ? `（${s.runner === 'github' ? 'GitHub 每日排程' : '本機（開啟 Claude 時）'}）` : ''}</dd>
          <dt>地點</dt>
          <dd>{data.places.length} 個（地圖上 {located} 個）</dd>
          <dt>推薦來源</dt>
          <dd>{data.index.total} 筆（{data.index.sources.length} 個來源）</dd>
          <dt>評鑑</dt>
          <dd>{data.awards.length} 筆</dd>
        </dl>
        {s?.by_source && (
          <>
            <h3>各來源</h3>
            <table className="status-table">
              <thead><tr><th>來源</th><th>推薦</th><th>最新</th></tr></thead>
              <tbody>
                {Object.entries(s.by_source)
                  .sort((a, b) => b[1].contents - a[1].contents)
                  .map(([name, v]) => (
                    <tr key={name}><td>{name}</td><td>{v.contents}</td><td>{v.latest || '—'}</td></tr>
                  ))}
              </tbody>
            </table>
          </>
        )}
        {(s?.history_remaining ?? 0) > 0 && (
          <p className="data-note">⏳ 正在補齊歷史文章：還有約 {s!.history_remaining!.toLocaleString()} 篇待讀，會在之後的更新中自動完成。</p>
        )}
        {(s?.geo_pending ?? 0) > 0 && (
          <p className="data-note">📍 {s!.geo_pending!.toLocaleString()} 個地址尚未查到地圖座標（清單和搜尋仍可找到，導航可正常使用）。</p>
        )}
        <h3>最近一次執行</h3>
        {s ? (
          <>
            <p className="muted">新影片 {s.new_videos ?? 0} · 新文章 {s.new_posts ?? 0} · 新地點 {s.new_places ?? 0} · 略過 {s.skipped ?? 0}</p>
            {s.errors?.length ? (
              <ul className="err-list">{s.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}</ul>
            ) : (
              <p className="ok">沒有錯誤 ✓</p>
            )}
          </>
        ) : (
          <p className="na">尚無資料</p>
        )}
      </div>
    </div>
  );
}
