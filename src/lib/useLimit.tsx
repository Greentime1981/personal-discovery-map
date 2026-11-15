import { useEffect, useState } from 'react';

/** 長清單分批顯示：先顯示 step 筆，按「顯示更多」再加；篩選條件（resetKey）改變時回到第一批 */
export function useLimit(resetKey: string, step = 100) {
  const [limit, setLimit] = useState(step);
  useEffect(() => setLimit(step), [resetKey, step]);
  return { limit, more: () => setLimit((n) => n + step) };
}

export function MoreButton({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (shown >= total) return null;
  return (
    <button className="more-btn" onClick={onMore}>
      顯示更多（已顯示 {shown} / {total}）
    </button>
  );
}
