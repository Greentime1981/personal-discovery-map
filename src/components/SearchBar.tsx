import { useState } from 'react';
import { geocode } from '../lib/geocode';
import type { Destination } from '../types';

interface Props {
  onPick: (d: Destination) => void;
  onLocate: () => void;
}

export default function SearchBar({ onPick, onLocate }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Destination[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setError('');
    try {
      const r = await geocode(q);
      setResults(r);
      if (r.length === 0) setError('找不到這個地點，請換個寫法（例如加上縣市）');
    } catch (err) {
      setError(err instanceof Error ? err.message : '查詢失敗');
    } finally {
      setBusy(false);
    }
  }

  function pick(d: Destination) {
    const short = d.label.split(',')[0];
    onPick({ ...d, label: short });
    setQ(short);
    setResults(null);
  }

  return (
    <div className="searchbar">
      <form onSubmit={submit} className="search-row">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="輸入目的地或地址（例：台北101）"
          aria-label="目的地"
        />
        <button type="submit" disabled={busy}>{busy ? '…' : '搜尋'}</button>
        <button type="button" onClick={onLocate} title="目前位置" aria-label="目前位置">◎</button>
      </form>
      {error && <div className="search-msg">{error}</div>}
      {results && results.length > 0 && (
        <ul className="search-results">
          {results.map((r, i) => (
            <li key={i}>
              <button type="button" onClick={() => pick(r)}>{r.label}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
