import { useCallback, useEffect, useState } from 'react';
import type { Trip, UserData } from '../types';

const KEY = 'pdm_user_data_v1';
const EMPTY: UserData = { favorites: [], visited: [], notes: {}, trips: [] };

function read(): UserData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const d = { ...EMPTY, ...(JSON.parse(raw) as Partial<UserData>) };
    if (!Array.isArray(d.trips)) d.trips = [];
    return d;
  } catch {
    return EMPTY;
  }
}

/** 個人收藏 / 已造訪 / 備註，只存本機瀏覽器（不上傳、不進 GitHub） */
export function useUserData() {
  const [data, setData] = useState<UserData>(read);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* 私密模式等情況下無法儲存 */
    }
  }, [data]);

  const toggle = useCallback((field: 'favorites' | 'visited', id: string) => {
    setData((d) => {
      const list = d[field];
      return { ...d, [field]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] };
    });
  }, []);

  const setNote = useCallback((id: string, text: string) => {
    setData((d) => {
      const notes = { ...d.notes };
      if (text.trim()) notes[id] = text;
      else delete notes[id];
      return { ...d, notes };
    });
  }, []);

  const setTrips = useCallback((trips: Trip[]) => {
    setData((d) => ({ ...d, trips }));
  }, []);

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'user_data.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }, [data]);

  const importJson = useCallback(async (file: File) => {
    const parsed = JSON.parse(await file.text()) as Partial<UserData>;
    setData({ ...EMPTY, ...parsed });
  }, []);

  return { data, toggle, setNote, setTrips, exportJson, importJson };
}
