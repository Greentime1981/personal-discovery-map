export type Category = 'food' | 'family' | 'date' | 'attraction';

export interface Place {
  place_id: string;
  name: string;
  category: Category;
  city: string;
  district: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  price_range: string | null;
  description: string;
  sources: string[]; // content_id 列表
  created_at: string;
  updated_at: string;
  last_verified_at: string;
  confidence_score: number | null;
  sample?: boolean; // 範例資料，非已驗證推薦
  geo_precision?: 'house' | 'street' | null; // 座標精度：門牌 / 路段概略
}

export interface Content {
  content_id: string;
  place_id: string;
  source_type: 'youtube' | 'blog' | 'official' | string;
  source_name: string;
  title: string;
  source_url: string;
  published_at: string;
  summary: string;
  original_sequence: number | null;
}

export type AwardType =
  | 'michelin_1'
  | 'michelin_2'
  | 'michelin_3'
  | 'bib_gourmand'
  | 'taiwan_500';

export interface Award {
  award_id: string;
  place_id: string;
  award_type: AwardType | string;
  award_year: number;
  source_url: string;
  verified_at: string;
  level?: number; // 台灣500碗的碗數
}

/** 自訂旅遊行程（第五階段） */
export interface Trip {
  id: string;
  name: string;
  hotel: Destination | null;
  days: { stops: Destination[] }[];
}

/** 個人資料：只存在瀏覽器 localStorage，絕不進公開 repo */
export interface UserData {
  favorites: string[];
  visited: string[];
  notes: Record<string, string>;
  trips: Trip[];
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Destination extends LatLng {
  label: string;
}
