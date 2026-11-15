"""每日資料蒐集：YouTube 頻道 + 部落格 RSS → 規則式地點辨識 → 地理編碼 → 去重 → 更新 JSON。

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
import hashlib
import html
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.error
import urllib.request
import urllib.robotparser
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract import extract_places, normalize, split_admin  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
PIPE = ROOT / "pipeline"
UA = "personal-discovery-map/0.3 (personal, non-commercial)"
ARTICLE_DELAY = 3  # 讀文章頁面之間間隔秒數，避免造成對方網站負擔
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


# ---------- 部落格 RSS ----------
def html_to_text(h: str) -> str:
    h = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", "", h)
    h = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>|</h\d>|</tr>", "\n", h)
    return html.unescape(re.sub(r"<[^>]+>", "", h))


def short_hash(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:10]


def fetch_feed(url: str) -> list[dict]:
    """讀 RSS。只在記憶體中解析文字找地址，不儲存全文與圖片。"""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        root = ET.fromstring(r.read())
    out = []
    for it in root.findall("./channel/item"):
        enc = it.find("{http://purl.org/rss/1.0/modules/content/}encoded")
        body = enc.text if enc is not None and enc.text else (it.findtext("description") or "")
        date = ""
        try:
            date = parsedate_to_datetime(it.findtext("pubDate") or "").strftime("%Y-%m-%d")
        except (TypeError, ValueError):
            pass
        out.append({"title": html.unescape(it.findtext("title") or ""), "link": it.findtext("link") or "",
                    "date": date, "text": html_to_text(body), "full": len(body) > 1500})
    return out


_robots: dict[str, urllib.robotparser.RobotFileParser] = {}


def allowed_by_robots(url: str) -> bool:
    origin = "{0.scheme}://{0.netloc}".format(urllib.parse.urlparse(url))
    rp = _robots.get(origin)
    if rp is None:
        # 自己用本程式的 User-Agent 讀 robots.txt（內建 read() 用預設 UA 常被擋成 403）
        rp = urllib.robotparser.RobotFileParser(origin + "/robots.txt")
        try:
            req = urllib.request.Request(origin + "/robots.txt", headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                rp.parse(r.read().decode("utf-8", "ignore").splitlines())
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                rp.disallow_all = True  # 明確拒絕 → 不讀
            else:
                rp.allow_all = True  # 沒有 robots.txt → 允許
        except Exception:
            rp = None  # 連線問題：本次不判斷
        _robots[origin] = rp
    return True if rp is None else rp.can_fetch(UA, url)


def fetch_article(url: str) -> tuple[str, str]:
    """RSS 只有摘要時：讀一次文章頁面，只在記憶體中取文字找店名地址，不儲存全文與照片。回傳 (標題, 文字)。"""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        page = r.read().decode("utf-8", "ignore")
    t = re.search(r"(?is)<title[^>]*>(.*?)</title>", page)
    title = html.unescape(t.group(1)).strip() if t else ""
    title = re.split(r"\s+[|｜\-–—]\s+[^|｜]*$", title)[0]  # 去掉「 - 網站名稱」
    m = re.search(r"(?is)<article\b.*?</article>", page)  # 只取文章本體，避開側欄
    return title, html_to_text(m.group(0) if m else page)


SITEMAP_LIMIT = 30  # 沒有 RSS 的部落格：只看 sitemap 中最新的 30 篇


def fetch_sitemap(url: str) -> list[dict]:
    """部落格關閉 RSS 時，改從文章 sitemap 取得最新文章連結（標題在讀文章時取得）。"""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        root = ET.fromstring(r.read())
    ns = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
    rows = [(u.findtext(ns + "lastmod") or "", u.findtext(ns + "loc") or "") for u in root.findall(ns + "url")]
    rows = sorted([r for r in rows if r[1]], reverse=True)[:SITEMAP_LIMIT]
    return [{"title": "", "link": loc, "date": lm[:10], "text": "", "full": False} for lm, loc in rows]


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


# ---------- 主流程 ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--videos-json", help="離線測試：{channel_id: [video, ...]} 格式的檔案")
    ap.add_argument("--rebuild", action="store_true",
                    help="改善辨識規則後使用：清除已蒐集的地點與紀錄，全部重新處理（保留地理編碼快取與範例地點）")
    args = ap.parse_args()

    sources = load(PIPE / "sources.json", {})
    state = load(PIPE / "state.json", {"processed_videos": {}})
    places = load(DATA / "places.json", [])
    contents = load(DATA / "contents.json", [])
    log = load(PIPE / "log.json", [])
    if args.rebuild:
        places = [p for p in places if p.get("sample")]
        contents = []
        state = {"processed_videos": {}}
    geo = Geocoder(PIPE / "geocode_cache.json", offline=bool(args.videos_json))
    offline_videos = load(Path(args.videos_json), {}) if args.videos_json else None
    key = os.environ.get("YOUTUBE_API_KEY", "")
    if offline_videos is None and not key:
        print("警告：缺少 YOUTUBE_API_KEY，本次只處理部落格", file=sys.stderr)

    run = {"run_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "new_videos": 0,
           "new_posts": 0, "new_places": 0, "merged_places": 0, "skipped": [], "errors": []}
    place_ids = {p["place_id"] for p in places}
    content_ids = {c["content_id"] for c in contents}

    def add_source(name, address, category, cont):
        """地理編碼 → 去重（找既有地點或建立新地點）→ 加上一筆推薦來源。回傳地點。"""
        try:
            loc = geo.locate(address)
        except Exception as e:
            run["errors"].append(f"地理編碼失敗 {address}：{e}")
            loc = None
        coords = (loc[0], loc[1]) if loc else None
        p = find_existing(places, name, address, coords)
        if p is None:
            city, district = split_admin(address)
            # 以地址產生固定 ID：重建資料時 ID 不變，個人收藏不會失效
            pid = "pl-" + short_hash(key_addr(address))
            while pid in place_ids:
                pid += "x"
            place_ids.add(pid)
            p = {"place_id": pid, "name": name, "category": category,
                 "city": city, "district": district, "address": address,
                 "latitude": coords[0] if coords else None, "longitude": coords[1] if coords else None,
                 "geo_precision": loc[2] if loc else None,
                 "price_range": None, "description": "", "sources": [],
                 "created_at": TODAY, "updated_at": TODAY, "last_verified_at": "",
                 "confidence_score": 0.8 if loc and loc[2] == "house" else 0.5 if loc else 0.3}
            places.append(p)
            run["new_places"] += 1
            if not loc:
                run["skipped"].append(f"{name}：查不到座標，暫不顯示在地圖（{address}）")
        else:
            run["merged_places"] += 1
        cont = {**cont, "place_id": p["place_id"]}
        if cont["content_id"] in content_ids:  # 已存在：更新內容（例如手動清單的備註改了）
            for i, c in enumerate(contents):
                if c["content_id"] == cont["content_id"]:
                    contents[i] = cont
            return p
        content_ids.add(cont["content_id"])
        contents.append(cont)
        if cont["content_id"] not in p["sources"]:
            p["sources"].append(cont["content_id"])
            p["updated_at"] = TODAY
        return p

    def ingest(src_name, category, source_type, cid_prefix, title, url, date, text):
        """處理一支影片 / 一篇文章：擷取地點 → 地理編碼 → 去重 → 建立推薦來源。"""
        found = extract_places(text)
        if not found:
            run["skipped"].append(f"{src_name}｜{title[:40]}：內容中沒有地址")
        for f in found:
            if not f["name"]:
                run["skipped"].append(f"{src_name}｜{title[:40]}：找不到店名（{f['address']}）")
                continue
            add_source(f["name"], f["address"], category, {
                "content_id": f"{cid_prefix}-{f['sequence']}", "source_type": source_type,
                "source_name": src_name, "title": title, "source_url": url,
                "published_at": date, "summary": "", "original_sequence": f["sequence"]})

    # ---- YouTube ----
    for ch in (sources.get("youtube", []) if (key or offline_videos is not None) else []):
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
            ingest(ch["name"], ch.get("category", "food"), "youtube", f"yt-{v['video_id']}", v["title"],
                   f"https://www.youtube.com/watch?v={v['video_id']}", v.get("published_at", ""), v["description"])
            known.add(v["video_id"])
        state["processed_videos"][cid] = sorted(known)

    # ---- 部落格 RSS ----
    if offline_videos is None:
        posts_state = state.setdefault("processed_posts", {})
        for b in sources.get("blogs", []):
            src_url = b.get("feed") or b.get("sitemap")
            if not src_url:
                continue
            known = set(posts_state.get(src_url, []))
            try:
                items = fetch_feed(b["feed"]) if b.get("feed") else fetch_sitemap(b["sitemap"])
                posts = [x for x in items if x["link"] not in known]
            except Exception as e:
                run["errors"].append(f"{b['name']}：RSS / sitemap 讀取失敗 {e}")
                continue
            for x in reversed(posts):
                run["new_posts"] += 1
                text, title = x["text"], x["title"]
                if not x["full"]:
                    if not b.get("fetch_article") and not b.get("sitemap"):
                        run["skipped"].append(f"{b['name']}｜{x['title'][:40]}：RSS 只有摘要，無法取得地址")
                        known.add(x["link"])
                        continue
                    if not allowed_by_robots(x["link"]):
                        run["skipped"].append(f"{b['name']}｜{x['title'][:40]}：robots.txt 不允許讀取")
                        known.add(x["link"])
                        continue
                    time.sleep(ARTICLE_DELAY)
                    try:
                        page_title, text = fetch_article(x["link"])
                        title = title or page_title or x["link"]
                    except Exception as e:  # 下次再試，不記為已處理
                        run["errors"].append(f"{b['name']}｜{(title or x['link'])[:40]}：文章讀取失敗 {e}")
                        continue
                ingest(b["name"], b.get("category", "food"), "blog", "bl-" + short_hash(x["link"]),
                       title, x["link"], x["date"], text)
                known.add(x["link"])
            posts_state[src_url] = sorted(known)

    # ---- 我的手動清單（每次都套用；重建資料也不會消失）----
    manual = load(PIPE / "manual.json", {})
    for m in manual.get("places", []):
        addr = normalize(m.get("address", "")).strip()
        if not m.get("name") or not addr:
            run["errors"].append(f"手動清單缺少店名或地址：{m}")
            continue
        note = m.get("note", "")
        p = add_source(m["name"], addr, m.get("category", "food"), {
            "content_id": "manual-" + short_hash(key_addr(addr)), "source_type": "manual",
            "source_name": m.get("by") or "我的清單", "title": note or "我的清單",
            "source_url": m.get("url", ""), "published_at": m.get("added", ""),
            "summary": note, "original_sequence": None})
        p["name"] = m["name"]  # 以手動填寫的店名為準
        if m.get("category"):
            p["category"] = m["category"]
    for f in manual.get("fixes", []):
        k = key_addr(normalize(f.get("address", "")))
        hit = [p for p in places if k and key_addr(p.get("address", "")) == k]
        if not hit:
            run["skipped"].append(f"手動修正找不到地點：{f.get('address')}")
        for p in hit:
            if f.get("closed"):  # 已歇業：移除地點與其推薦來源
                places.remove(p)
                contents[:] = [c for c in contents if c["place_id"] != p["place_id"]]
                continue
            for field in ("name", "category"):
                if f.get(field):
                    p[field] = f[field]

    save(DATA / "places.json", places)
    save(DATA / "contents.json", contents)
    save(PIPE / "state.json", state)
    geo.save()
    meta = load(DATA / "meta.json", {})
    meta["last_updated"] = TODAY
    meta["note"] = "地點由 YouTube 影片說明與部落格文章中的地址自動整理（規則式，未經 AI 推論）。標示「範例資料」者為未驗證的示範地點。"
    save(DATA / "meta.json", meta)
    log.append(run)
    save(PIPE / "log.json", log[-60:])  # 保留最近 60 次
    print(json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in run.items()}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
