import { useState } from 'react';
import { geocode } from '../lib/geocode';
import type { Destination } from '../types';

/** 簡單的地點輸入：輸入 → 搜尋 → 從結果挑一個 */
export default function LocationInput({ placeholder, onPick }: { placeholder: string; onPick: (d: Destination) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Destination[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function search() {
    if (!q.trim()) return;
    setBusy(true);
    setMsg('');
    try {
      const r = await geocode(q);
      setResults(r);
      if (!r.length) setMsg('找不到，請換個寫法（例如加上縣市）');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '查詢失敗');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="loc-input">
      <div className="loc-row">
        <input
          value={q}
          placeholder={placeholder}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
        />
        <button onClick={search} disabled={busy}>{busy ? '…' : '查詢'}</button>
      </div>
      {msg && <div className="search-msg">{msg}</div>}
      {results && results.length > 0 && (
        <ul className="loc-results">
          {results.map((r, i) => (
            <li key={i}>
              <button
                onClick={() => {
                  onPick({ ...r, label: q.trim() || r.label.split(',')[0] });
                  setResults(null);
                  setQ('');
                }}
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
