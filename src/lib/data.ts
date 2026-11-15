import type { Award, Category, Content, Place } from '../types';

export interface RunStatus {
  run_at: string;
  runner: 'github' | 'local';
  new_videos?: number;
  new_posts?: number;
  new_places?: number;
  skipped?: number;
  errors?: string[];
  by_source?: Record<string, { contents: number; latest: string }>;
  history_posts?: number;
  history_remaining?: number;
  geo_pending?: number;
}

/** 推薦來源（部落客或 YouTube 頻道） */
export interface SourceInfo {
  k: number;
  name: string;
  type: string;
  count: number; // 推薦紀錄數
  articles: number; // 文章 / 影片數
  latest: string;
}

export interface ContentIndex {
  cities: string[];
  sources: SourceInfo[];
  total: number;
}

export interface PublicData {
  places: Place[];
  awards: Award[];
  meta: { last_updated?: string; note?: string; award_notes?: Record<string, string> };
  status: RunStatus | null;
  index: ContentIndex;
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

// 精簡格式（scripts/build_app_data.py 產生）→ App 內部格式
interface LitePlace { i: string; n: string; c: Category; y: string; d: string; a: string; la: number | null; lo: number | null; k: number; g?: 'house' | 'street' | 'poi'; pr?: string; sm?: 1 }
interface LiteContent { i: string; p: string; t: string; s: string; ti: string; u: string; d: string; su?: string; q?: number }

const toPlace = (r: LitePlace): Place => ({
  place_id: r.i, name: r.n, category: r.c, city: r.y, district: r.d, address: r.a,
  latitude: r.la, longitude: r.lo, price_range: r.pr ?? null, description: '', sources: [],
  created_at: '', updated_at: '', last_verified_at: '', confidence_score: null,
  geo_precision: r.g === 'poi' ? 'street' : r.g ?? null, sample: r.sm === 1, source_count: r.k,
});

const toContent = (r: LiteContent): Content => ({
  content_id: r.i, place_id: r.p, source_type: r.t, source_name: r.s, title: r.ti, source_url: r.u,
  published_at: r.d, summary: r.su ?? '', original_sequence: r.q ?? null,
});

export async function loadPublicData(): Promise<PublicData> {
  const [places, awards, meta, status, index] = await Promise.all([
    getJson<LitePlace[]>('places.json', []),
    getJson<Award[]>('awards.json', []),
    getJson<PublicData['meta']>('meta.json', {}),
    getJson<RunStatus | null>('status.json', null),
    getJson<ContentIndex>('contents/index.json', { cities: [], sources: [], total: 0 }),
  ]);
  return { places: places.map(toPlace), awards, meta, status, index };
}

// 推薦紀錄分檔、用到才載入（並記住，不重複下載）
const cache = new Map<string, Promise<Content[]>>();
function loadContents(file: string): Promise<Content[]> {
  let p = cache.get(file);
  if (!p) {
    p = getJson<LiteContent[]>(`contents/${file}`, []).then((rows) => rows.map(toContent));
    cache.set(file, p);
  }
  return p;
}

/** 某縣市所有地點的推薦紀錄（資訊卡用） */
export function loadCityContents(index: ContentIndex, city: string): Promise<Content[]> {
  const k = index.cities.indexOf(city || '');
  return k < 0 ? Promise.resolve([]) : loadContents(`c${k}.json`);
}

/** 某個來源（部落客 / 頻道）的所有推薦紀錄（部落客攻略用） */
export function loadSourceContents(src: SourceInfo): Promise<Content[]> {
  return loadContents(`s${src.k}.json`);
}
