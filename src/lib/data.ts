import type { Award, Content, Place } from '../types';

export interface RunStatus {
  run_at: string;
  runner: 'github' | 'local';
  new_videos?: number;
  new_posts?: number;
  new_places?: number;
  skipped?: number;
  errors?: string[];
  by_source?: Record<string, { contents: number; latest: string }>;
}

export interface PublicData {
  places: Place[];
  contents: Content[];
  awards: Award[];
  meta: { last_updated?: string; note?: string; award_notes?: Record<string, string> };
  status: RunStatus | null;
}

async function getJson<T>(name: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as T;
  } catch (e) {
    console.warn(`載入 ${name} 失敗`, e);
    return fallback;
  }
}

export async function loadPublicData(): Promise<PublicData> {
  const [places, contents, awards, meta, status] = await Promise.all([
    getJson<Place[]>('places.json', []),
    getJson<Content[]>('contents.json', []),
    getJson<Award[]>('awards.json', []),
    getJson<PublicData['meta']>('meta.json', {}),
    getJson<RunStatus | null>('status.json', null),
  ]);
  return { places, contents, awards, meta, status };
}
