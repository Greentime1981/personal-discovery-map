import type { AwardType, Category } from './types';

/**
 * 圖磚：OpenStreetMap 官方圖磚。
 * OSM 使用政策允許「低用量、附出處、不批次下載」的使用，個人 App 符合此條件；
 * 但它不是無限制免費服務。若使用量變大，請改用 Stadia Maps / MapTiler 等
 * 供應商（需註冊取得 key），只要改這兩個常數即可。
 */
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** 預設地圖中心：台北車站 */
export const DEFAULT_CENTER = { lat: 25.0478, lng: 121.517, label: '台北車站' };

export const CATEGORY_META: Record<Category, { label: string; icon: string; color: string }> = {
  food: { label: '美食', icon: '🍜', color: '#e8710a' },
  family: { label: '親子', icon: '🧸', color: '#188038' },
  date: { label: '約會', icon: '💗', color: '#d01884' },
  attraction: { label: '景點', icon: '📍', color: '#1a73e8' },
};

export const AWARD_LABEL: Record<AwardType, string> = {
  michelin_1: '米其林一星',
  michelin_2: '米其林二星',
  michelin_3: '米其林三星',
  bib_gourmand: '必比登推介',
  taiwan_500: '台灣500碗',
};

/** 獎項排序：越前面越高 */
export const AWARD_ORDER: AwardType[] = ['michelin_3', 'michelin_2', 'michelin_1', 'bib_gourmand', 'taiwan_500'];

export const RADIUS_OPTIONS = [1, 3, 5, 10];
