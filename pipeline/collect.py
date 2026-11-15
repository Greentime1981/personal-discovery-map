"""每日資料蒐集：YouTube 頻道 → 規則式地點辨識 → 地理編碼 → 去重 → 更新 JSON。

用法：
  YOUTUBE_API_KEY=xxx python pipeline/collect.py          # 正式執行（GitHub Actions 用）
  python pipeline/collect.py --videos-json sample.json     # 離線測試：用本機檔案代替 API

設計原則（依規格書）：
- 增量更新：state.json 記錄已處理的影片，只處理新影片。
- 去重：同地址、或同店名且距離 < 200 公尺 → 視為同一家，只新增推薦來源。
- 不捏造：說明文字沒寫地址就不建立地點；座標查不到就留 null（不上地圖）。
- 只存 API 回傳的 metadata（標題、連結、日期），不下載影片或縮圖。
- 所有失敗原因寫進 log.json。
"""
import argparse
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract import extract_places, normalize, split_admin  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
PIPE = ROOT / "pipeline"
UA = "personal-discovery-map/0.3 (personal, non-commercial)"
BACKFILL_PAGES = 4  # 第一次執行每個頻道最多抓 4×50 支影片
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")


def load(p: Path, default):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def save(p: Path, obj):
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def http_json(url: str, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


# ---------- YouTube Data API ----------
def fetch_new_videos(channel_id: str, known: set[str], key: str) -> list[dict]:
    """從頻道的 uploads 播放清單由新到舊抓，遇到已處理過的影片就停（增量）。"""
    playlist = "UU" + channel_id[2:]
    out, token = [], None
    for _ in range(BACKFILL_PAGES if not known else 2):
        q = {"part": "snippet", "playlistId": playlist, "maxResults": 50, "key": key}
        if token:
            q["pageToken"] = token
        data = http_json("https://www.googleapis.com/youtube/v3/playlistItems?" + urllib.parse.urlencode(q))
        for it in data.get("items", []):
            sn = it["snippet"]
            vid = sn.get("resourceId", {}).get("videoId")
            if not vid:
                continue
            if vid in known:
                return out
            out.append({"video_id": vid, "title": sn.get("title", ""), "description": sn.get("description", ""),
                        "published_at": sn.get("publishedAt", "")[:10]})
        token = data.get("nextPageToken")
        if not token:
            break
    return out


# ---------- 地理編碼（Nominatim，1 次/秒，結果快取） ----------
class Geocoder:
    def __init__(self, cache_path: Path, offline: bool):
        self.path = cache_path
        self.cache = load(cache_path, {})
        self.offline = offline
        self.last = 0.0

    def _query(self, q: str):
        if q in self.cache:
            return self.cache[q]
        if self.offline:
            return None
        wait = 1.1 - (time.time() - self.last)
        if wait > 0:
            time.sleep(wait)
        self.last = time.time()
        url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
            {"q": q, "format": "jsonv2", "limit": 1, "countrycodes": "tw", "addressdetails": 1})
        rows = http_json(url, {"Accept-Language": "zh-TW"})
        res = None
        if rows:
            r = rows[0]
            res = {"lat": round(float(r["lat"]), 6), "lng": round(float(r["lon"]), 6),
                   "has_house": bool(r.get("address", {}).get("house_number"))}
        self.cache[q] = res
        return res

    def locate(self, address: str):
        """回傳 (lat, lng, precision) 或 None。precision: house = 門牌、street = 路段概略位置。"""
        r = self._query(address)
        if r:
            return r["lat"], r["lng"], "house" if r["has_house"] else "street"
        # 去掉門牌、巷弄，退而求其次找路段
        street = re.sub(r"(\d+巷)?(\d+弄)?\d+(-\d+)?號.*$", "", address)
        if street != address:
            r = self._query(street)
            if r:
                return r["lat"], r["lng"], "street"
        return None

    def save(self):
        save(self.path, self.cache)


# ---------- 去重 ----------
def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def key_name(s: str) -> str:
    return re.sub(r"[\s・·\-（）()]", "", normalize(s)).lower()


def key_addr(s: str) -> str:
    return re.sub(r"\s", "", normalize(s))


def find_existing(places, name, address, coords):
    for p in places:
        if address and key_addr(p.get("address", "")) == key_addr(address):
            return p
        if key_name(p["name"]) == key_name(name):
            if coords and p.get("latitude") is not None and km(coords, (p["latitude"], p["longitude"])) < 0.2:
                return p
            if not coords or p.get("latitude") is None:
                if split_admin(p.get("address", ""))[1] == split_admin(address)[1]:
                    return p
    return None


def slug_id(prefix: str, existing: set[str]) -> str:
    i = len(existing) + 1
    while f"{prefix}{i:05d}" in existing:
        i += 1
    return f"{prefix}{i:05d}"


# ---------- 主流程 ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--videos-json", help="離線測試：{channel_id: [video, ...]} 格式的檔案")
    args = ap.parse_args()

    sources = load(PIPE / "sources.json", {})
    state = load(PIPE / "state.json", {"processed_videos": {}})
    places = load(DATA / "places.json", [])
    contents = load(DATA / "contents.json", [])
    log = load(PIPE / "log.json", [])
    geo = Geocoder(PIPE / "geocode_cache.json", offline=bool(args.videos_json))
    offline_videos = load(Path(args.videos_json), {}) if args.videos_json else None
    key = os.environ.get("YOUTUBE_API_KEY", "")
    if offline_videos is None and not key:
        print("缺少 YOUTUBE_API_KEY（請放在 GitHub Secrets）", file=sys.stderr)
        return 1

    run = {"run_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "new_videos": 0,
           "new_places": 0, "merged_places": 0, "skipped": [], "errors": []}
    place_ids = {p["place_id"] for p in places}
    content_ids = {c["content_id"] for c in contents}

    for ch in sources.get("youtube", []):
        cid = ch["channel_id"]
        known = set(state["processed_videos"].get(cid, []))
        try:
            videos = offline_videos.get(cid, []) if offline_videos is not None else fetch_new_videos(cid, known, key)
            videos = [v for v in videos if v["video_id"] not in known]
        except Exception as e:  # 單一頻道失敗不影響其他頻道
            run["errors"].append(f"{ch['name']}：抓取失敗 {e}")
            continue

        for v in reversed(videos):  # 由舊到新處理
            run["new_videos"] += 1
            found = extract_places(v["description"])
            if not found:
                run["skipped"].append(f"{ch['name']}｜{v['title'][:40]}：說明中沒有地址")
            for f in found:
                if not f["name"]:
                    run["skipped"].append(f"{ch['name']}｜{v['title'][:40]}：找不到店名（{f['address']}）")
                    continue
                try:
                    loc = geo.locate(f["address"])
                except Exception as e:
                    run["errors"].append(f"地理編碼失敗 {f['address']}：{e}")
                    loc = None
                coords = (loc[0], loc[1]) if loc else None
                p = find_existing(places, f["name"], f["address"], coords)
                if p is None:
                    city, district = split_admin(f["address"])
                    pid = slug_id("yt", place_ids)
                    place_ids.add(pid)
                    p = {"place_id": pid, "name": f["name"], "category": ch.get("category", "food"),
                         "city": city, "district": district, "address": f["address"],
                         "latitude": coords[0] if coords else None, "longitude": coords[1] if coords else None,
                         "geo_precision": loc[2] if loc else None,
                         "price_range": None, "description": "", "sources": [],
                         "created_at": TODAY, "updated_at": TODAY, "last_verified_at": "",
                         "confidence_score": 0.8 if loc and loc[2] == "house" else 0.5 if loc else 0.3}
                    places.append(p)
                    run["new_places"] += 1
                    if not loc:
                        run["skipped"].append(f"{f['name']}：查不到座標，暫不顯示在地圖（{f['address']}）")
                else:
                    run["merged_places"] += 1
                cont_id = f"yt-{v['video_id']}-{f['sequence']}"
                if cont_id in content_ids:
                    continue
                content_ids.add(cont_id)
                contents.append({"content_id": cont_id, "place_id": p["place_id"], "source_type": "youtube",
                                 "source_name": ch["name"], "title": v["title"],
                                 "source_url": f"https://www.youtube.com/watch?v={v['video_id']}",
                                 "published_at": v.get("published_at", ""), "summary": "",
                                 "original_sequence": f["sequence"]})
                if cont_id not in p["sources"]:
                    p["sources"].append(cont_id)
                    p["updated_at"] = TODAY
            known.add(v["video_id"])
        state["processed_videos"][cid] = sorted(known)

    save(DATA / "places.json", places)
    save(DATA / "contents.json", contents)
    save(PIPE / "state.json", state)
    geo.save()
    meta = load(DATA / "meta.json", {})
    meta["last_updated"] = TODAY
    meta["note"] = "地點由 YouTube 影片說明中的地址自動整理（規則式，未經 AI 推論）。標示「範例資料」者為未驗證的示範地點。"
    save(DATA / "meta.json", meta)
    log.append(run)
    save(PIPE / "log.json", log[-60:])  # 保留最近 60 次
    print(json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in run.items()}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
