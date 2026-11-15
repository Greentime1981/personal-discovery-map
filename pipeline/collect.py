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
import queue
import re
import sys
import threading
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
from extract import extract_places, normalize, normalize_city, split_admin  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"  # 完整資料庫（App 用的精簡檔由 scripts/build_app_data.py 產生）
PIPE = ROOT / "pipeline"
UA = "personal-discovery-map/0.3 (personal, non-commercial)"
ARTICLE_DELAY = 3  # 讀文章頁面之間間隔秒數，避免造成對方網站負擔
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")
ON_GITHUB = os.environ.get("GITHUB_ACTIONS") == "true"


def load(p: Path, default):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


COMPACT = {"places.json", "contents.json", "awards.json", "state.json", "geocode_cache.json", "log.json"}


def save(p: Path, obj):
    if p.name in COMPACT and isinstance(obj, list):
        # 大型清單：一筆一行（不縮排）。檔案小，而且每天新增的資料只是多幾行，GitHub 倉庫不會暴增
        text = "[\n" + ",\n".join(json.dumps(x, ensure_ascii=False, separators=(",", ":")) for x in obj) + "\n]"
    elif p.name in COMPACT:
        text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    else:
        text = json.dumps(obj, ensure_ascii=False, indent=2)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(text + "\n", encoding="utf-8")
    tmp.replace(p)  # 先寫暫存檔再取代：中途被中斷也不會留下壞掉的檔案


def http_json(url: str, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


# ---------- YouTube Data API ----------
def fetch_new_videos(channel_id: str, known: set[str], key: str, full: bool = False) -> list[dict]:
    """從頻道的 uploads 播放清單由新到舊抓。
    full=True：補齊歷史，翻完所有頁面（每頁 50 支只花 1 單位配額），跳過已處理的影片。
    full=False：日常增量，遇到已處理過的影片就停。"""
    playlist = "UU" + channel_id[2:]
    out, token = [], None
    for _ in range(10_000 if full else 2):
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
                if full:
                    continue
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


def fetch_article_meta(url: str) -> tuple[str, str, str]:
    """讀一次文章頁面，只在記憶體中取文字找店名地址，不儲存全文與照片。回傳 (標題, 文字, 發布日期)。"""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        page = r.read().decode("utf-8", "ignore")
    t = re.search(r"(?is)<title[^>]*>(.*?)</title>", page)
    title = html.unescape(t.group(1)).strip() if t else ""
    title = re.split(r"\s+[|｜\-–—]\s+[^|｜]*$", title)[0]  # 去掉「 - 網站名稱」
    d = re.search(r'(?i)(?:article:published_time|datePublished)["\']?\s*(?:content=|:)\s*["\'](\d{4}-\d{2}-\d{2})', page)
    m = re.search(r"(?is)<article\b.*?</article>", page)  # 只取文章本體，避開側欄
    return title, html_to_text(m.group(0) if m else page), d.group(1) if d else ""


def fetch_article(url: str) -> tuple[str, str]:
    title, text, _ = fetch_article_meta(url)
    return title, text


SITEMAP_LIMIT = 30  # 日常增量：沒有 RSS 的部落格只看 sitemap 中最新的 30 篇
SM_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"


def _get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
        return r.read()


def discover_all_posts(site: str) -> list[str]:
    """補齊歷史：從網站的 sitemap 索引找出「所有」文章網址（新到舊）。找不到 sitemap 回傳空清單。"""
    base = "{0.scheme}://{0.netloc}".format(urllib.parse.urlparse(site))
    for idx in ("/sitemap_index.xml", "/wp-sitemap.xml", "/sitemap.xml"):
        try:
            root = ET.fromstring(_get(base + idx))
        except Exception:
            continue
        subs = [e.findtext(SM_NS + "loc") for e in root.findall(SM_NS + "sitemap")]
        post_maps = [u for u in subs if u and re.search(r"post(s)?[-_]?(sitemap|\d)|sitemap-posts|posts-post", u)]
        if not post_maps and root.findall(SM_NS + "url"):
            post_maps = [base + idx]
        if not post_maps:
            continue
        rows = []
        for sm in post_maps:
            try:
                r2 = ET.fromstring(_get(sm))
            except Exception:
                continue
            for u in r2.findall(SM_NS + "url"):
                loc = u.findtext(SM_NS + "loc")
                if loc and loc.rstrip("/") != base:
                    rows.append(((u.findtext(SM_NS + "lastmod") or "")[:10], loc))
        rows.sort(reverse=True)
        if rows:
            return list(dict.fromkeys(loc for _, loc in rows))
    # 沒有索引的網站：直接試 post-sitemap.xml、post-sitemap2.xml…
    rows = []
    for i in range(1, 200):
        url = f"{base}/post-sitemap{'' if i == 1 else i}.xml"
        try:
            r2 = ET.fromstring(_get(url))
        except Exception:
            break
        for u in r2.findall(SM_NS + "url"):
            loc = u.findtext(SM_NS + "loc")
            if loc:
                rows.append(((u.findtext(SM_NS + "lastmod") or "")[:10], loc))
    rows.sort(reverse=True)
    return list(dict.fromkeys(loc for _, loc in rows))


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
    def __init__(self, cache_path: Path, offline: bool, budget: int = 10**9):
        self.path = cache_path
        self.cache = load(cache_path, {})
        self.offline = offline
        self.last = 0.0
        self.budget = budget  # 本次最多新查幾次（遵守 Nominatim 不可大量查詢的規定）
        self.used = 0
        self.deferred = 0  # 超過額度、留到下次再查的次數

    def _query(self, q: str):
        if q in self.cache:
            return self.cache[q]
        if self.offline:
            return None
        if self.used >= self.budget:
            self.deferred += 1
            return None  # 不寫入快取：下次還會再查
        self.used += 1
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

    # ---- 內政部 TGOS 全國門牌地址定位（有 APPId／APIKey 才啟用；門牌等級、每日上限 1 萬筆）----
    TGOS_URL = os.environ.get("TGOS_URL", "https://addr.tgos.tw/addrws/v40/QueryAddr.asmx/QueryAddr")
    TGOS_ID = os.environ.get("TGOS_APPID", "")
    TGOS_KEY = os.environ.get("TGOS_APIKEY", "")
    tgos_budget = int(os.environ.get("TGOS_BUDGET", "4000"))  # 每次執行上限（每日總額 1 萬，GitHub 與本機共用）
    tgos_used = 0

    def _tgos(self, address: str):
        key = "tgos:" + address
        if key in self.cache:
            return self.cache[key]
        if self.offline or not (self.TGOS_ID and self.TGOS_KEY) or self.tgos_used >= self.tgos_budget:
            return None
        self.tgos_used += 1
        q = {"oAPPId": self.TGOS_ID, "oAPIKey": self.TGOS_KEY, "oAddress": address, "oSRS": "EPSG:4326",
             "oFuzzyType": "2", "oResultDataType": "JSON", "oFuzzyBuffer": "0", "oIsOnlyFullMatch": "false",
             "oIsSupportPast": "true", "oIsShowCodeBase": "false", "oIsLockCounty": "true", "oIsLockTown": "false",
             "oIsLockVillage": "false", "oIsLockRoadSection": "false", "oIsLockLane": "false", "oIsLockAlley": "false",
             "oIsLockArea": "false", "oIsSameNumber_SubNumber": "true", "oCanIgnoreVillage": "true",
             "oCanIgnoreNeighborhood": "true", "oReturnMaxCount": "1"}
        req = urllib.request.Request(self.TGOS_URL + "?" + urllib.parse.urlencode(q), headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode("utf-8", "ignore")
        if raw.lstrip().startswith("<"):  # .asmx 會把 JSON 包在 <string> 裡
            raw = html.unescape(re.sub(r"<[^>]+>", "", raw))
        data = json.loads(raw)
        rows = data.get("AddressList") or []
        res = None
        if rows and rows[0].get("X") and rows[0].get("Y"):
            res = {"lat": round(float(rows[0]["Y"]), 6), "lng": round(float(rows[0]["X"]), 6), "has_house": True}
        self.cache[key] = res
        return res

    def locate(self, address: str):
        """回傳 (lat, lng, precision) 或 None。precision: house = 門牌、street = 路段概略位置。"""
        try:
            t = self._tgos(address)  # 先用 TGOS（門牌等級、台灣官方資料）
        except Exception:
            t = None
        if t:
            return t["lat"], t["lng"], "house"
        r = self._query(address)
        if r:
            return r["lat"], r["lng"], "house" if r["has_house"] else "street"
        # 去掉門牌、巷弄，退而求其次找路段（「9之1號」「60-5號」也要能去掉）
        street = re.sub(r"(\d+巷)?(\d+弄)?\d+(?:[-之]\d+)?號.*$", "", address)
        if street == address:
            return None
        # OSM 多寫「臺北市」；有時加縣市反而查不到，所以再試只有「行政區＋路名」
        tries = [street, street.replace("台", "臺"), re.sub(r"^.{2}[市縣]", "", street)]
        if re.search(r"[一二三四五六七八九十]段$", street):
            tries.append(re.sub(r"[一二三四五六七八九十]段$", "", street))  # 去掉「段」
        for q in dict.fromkeys(tries):
            r = self._query(q)
            if r:
                return r["lat"], r["lng"], "street"
        return None

    def locate_poi(self, name: str, city: str):
        """沒有地址時，用「店名 縣市」查詢；只接受結果確實是餐廳／商店類的地點，避免誤配到路名。"""
        q = f"{name} {city}"
        key = "poi:" + q
        if key in self.cache:
            r = self.cache[key]
        elif self.offline:
            return None
        elif self.used >= self.budget:
            self.deferred += 1
            return None
        else:
            self.used += 1
            wait = 1.1 - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
            url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
                {"q": q, "format": "jsonv2", "limit": 3, "countrycodes": "tw", "addressdetails": 1})
            r = None
            for row in http_json(url, {"Accept-Language": "zh-TW"}):
                if row.get("category") in ("amenity", "shop") and city[:2] in (row.get("display_name") or "").replace("臺", "台"):
                    a = row.get("address", {})
                    r = {"lat": round(float(row["lat"]), 6), "lng": round(float(row["lon"]), 6),
                         "district": a.get("suburb") or a.get("city_district") or a.get("town") or ""}
                    break
            self.cache[key] = r
        return r

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


def similar_name(a: str, b: str) -> bool:
    """同一地址常有多家店（百貨、美食街），名稱要有關聯才算同一家：
    一方包含另一方，或有 2 個以上連續相同字（例如「A Cut」與「ACut牛排館」）。"""
    a, b = key_name(a), key_name(b)
    if not a or not b:
        return False
    if a in b or b in a:
        return True
    return any(a[i:i + 2] in b for i in range(len(a) - 1))


class PlaceIndex:
    """地點索引（依地址、依店名），幾萬筆資料比對也很快（原本逐筆比對會慢到跑不完）。"""

    def __init__(self, places):
        self.by_addr: dict[str, list] = {}
        self.by_name: dict[str, list] = {}
        for p in places:
            self.add(p)

    def add(self, p):
        if p.get("address"):
            self.by_addr.setdefault(key_addr(p["address"]), []).append(p)
        self.by_name.setdefault(key_name(p["name"]), []).append(p)

    def rename(self, p, new_name):
        old = self.by_name.get(key_name(p["name"]), [])
        if p in old:
            old.remove(p)
        p["name"] = new_name
        self.by_name.setdefault(key_name(new_name), []).append(p)

    def remove(self, p):
        for d, k in ((self.by_addr, key_addr(p.get("address", ""))), (self.by_name, key_name(p["name"]))):
            if p in d.get(k, []):
                d[k].remove(p)

    def find(self, name, address, coords):
        if address:
            for p in self.by_addr.get(key_addr(address), []):
                if similar_name(p["name"], name):
                    return p
        for p in self.by_name.get(key_name(name), []):
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
    ap.add_argument("--time-budget", type=float, default=20,
                    help="補齊歷史資料最多花幾分鐘（GitHub 用 300、本機用 150）；時間到會存檔，下次接著做")
    ap.add_argument("--geo-budget", type=int, default=int(os.environ.get("GEOCODE_BUDGET", "800")),
                    help="本次最多新查幾個地址座標（Nominatim 1 次/秒；其餘留到下次）")
    ap.add_argument("--rebuild", action="store_true",
                    help="改善辨識規則後使用：清除已蒐集的地點與紀錄，全部重新處理（保留地理編碼快取與範例地點）")
    args = ap.parse_args()

    sources = load(PIPE / "sources.json", {})
    state = load(PIPE / "state.json", {"processed_videos": {}})
    places = load(DATA / "places.json", [])
    for p in places:  # 舊縣市名（台北縣等）統一成現在的縣市
        if p.get("city"):
            p["city"] = normalize_city(p["city"])
    contents = load(DATA / "contents.json", [])
    log = load(PIPE / "log.json", [])
    if args.rebuild:
        places = [p for p in places if p.get("sample")]
        contents = []
        state = {"processed_videos": {}}
    geo = Geocoder(PIPE / "geocode_cache.json", offline=bool(args.videos_json), budget=args.geo_budget)
    index = PlaceIndex(places)
    offline_videos = load(Path(args.videos_json), {}) if args.videos_json else None
    key = os.environ.get("YOUTUBE_API_KEY", "")
    if offline_videos is None and not key:
        print("警告：缺少 YOUTUBE_API_KEY，本次只處理部落格", file=sys.stderr)

    run = {"run_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "new_videos": 0,
           "new_posts": 0, "new_places": 0, "merged_places": 0, "skipped": [], "errors": []}
    place_ids = {p["place_id"] for p in places}
    content_ids = {c["content_id"] for c in contents}

    def new_place(name, address, category, loc, city="", district="", id_key=None):
        if not city:
            city, district = split_admin(address)
        # 以地址（沒有地址時用店名＋縣市）產生固定 ID：重建資料時 ID 不變，個人收藏不會失效
        pid = "pl-" + short_hash(id_key or key_addr(address))
        while pid in place_ids:
            pid += "x"
        place_ids.add(pid)
        p = {"place_id": pid, "name": name, "category": category,
             "city": city, "district": district, "address": address,
             "latitude": loc[0] if loc else None, "longitude": loc[1] if loc else None,
             "geo_precision": loc[2] if loc else None,
             "price_range": None, "description": "", "sources": [],
             "created_at": TODAY, "updated_at": TODAY, "last_verified_at": "",
             "confidence_score": 0.8 if loc and loc[2] == "house" else 0.5 if loc else 0.3}
        places.append(p)
        index.add(p)
        run["new_places"] += 1
        return p

    def ensure_place(name, address, category):
        """地理編碼 → 去重（找既有地點或建立新地點）。回傳地點。"""
        try:
            loc = geo.locate(address)
        except Exception as e:
            run["errors"].append(f"地理編碼失敗 {address}：{e}")
            loc = None
        coords = (loc[0], loc[1]) if loc else None
        p = index.find(name, address, coords)
        if p is None:
            p = new_place(name, address, category, loc)
            if not loc:
                run["skipped"].append(f"{name}：查不到座標，暫不顯示在地圖（{address}）")
        else:
            run["merged_places"] += 1
            if loc and p.get("latitude") is None:  # 之前查不到座標的地點，這次查到了就補上
                p["latitude"], p["longitude"], p["geo_precision"] = loc
        return p

    def add_source(name, address, category, cont):
        """建立 / 找到地點後，加上一筆推薦來源。回傳地點。"""
        p = ensure_place(name, address, category)
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
        yt_done = state.setdefault("youtube_history_done", {})
        full = not yt_done.get(cid)  # 還沒補齊歷史：翻完頻道所有影片
        try:
            videos = offline_videos.get(cid, []) if offline_videos is not None else fetch_new_videos(cid, known, key, full=full)
            videos = [v for v in videos if v["video_id"] not in known]
            if full and offline_videos is None:
                yt_done[cid] = TODAY
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
            if b.get("github_blocked") and ON_GITHUB:
                continue  # 這個網站擋 GitHub 伺服器，交給本機更新
            known = set(posts_state.get(src_url, []))
            try:
                items = fetch_feed(b["feed"]) if b.get("feed") else fetch_sitemap(b["sitemap"])
                posts = [x for x in items if x["link"] not in known]
            except Exception as e:
                if ON_GITHUB and isinstance(e, urllib.error.HTTPError) and e.code == 403:
                    # 這個網站擋 GitHub 伺服器：不算錯誤（本機會更新），提醒把它標成 github_blocked
                    run["skipped"].append(f"{b['name']}：擋 GitHub 伺服器，由本機更新（建議在 sources.json 標記 github_blocked）")
                    run.setdefault("github_blocked_detected", []).append(b["name"])
                else:
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

    # ---- 部落格歷史文章補齊：從 sitemap 取得「所有」文章 ----
    # 多個網站同時進行；同一個網站每 3 秒最多讀 1 篇（不造成對方負擔）。
    # 時間到（--time-budget）就存檔，下次從剩下的接著讀；全部讀完後標記完成，之後只做日常增量。
    def checkpoint():
        save(DATA / "places.json", places)
        save(DATA / "contents.json", contents)
        save(PIPE / "state.json", state)
        geo.save()

    if offline_videos is not None:
        pass
    else:
        history = state.setdefault("blog_history", {})
        posts_state = state.setdefault("processed_posts", {})
        jobs = []
        active = [b for b in sources.get("blogs", [])
                  if (b.get("feed") or b.get("sitemap")) and not (b.get("github_blocked") and ON_GITHUB)
                  and not history.get(b["site"], {}).get("done")]
        # 第一次：同時讀取各網站的 sitemap，列出全部文章（只做一次，清單會存起來）
        need = [b for b in active if "queue" not in history.get(b["site"], {})]
        found_urls = {}
        if need:
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=12) as ex:
                futs = {b["site"]: ex.submit(discover_all_posts, b["site"]) for b in need}
            for site, fu in futs.items():
                try:
                    found_urls[site] = fu.result()
                except Exception as e:
                    found_urls[site] = e
        deadline = time.time() + args.time_budget * 60  # 列完清單後才開始計時
        for b in active:
            key_url = b.get("feed") or b.get("sitemap")
            h = history.setdefault(b["site"], {})
            known = set(posts_state.get(key_url, []))
            if "queue" not in h:
                urls = found_urls.get(b["site"], [])
                if isinstance(urls, Exception):
                    run["errors"].append(f"{b['name']}：讀取 sitemap 失敗 {urls}")
                    continue
                if not urls:
                    h.update(done=TODAY, note="找不到文章 sitemap，只做日常增量")
                    continue
                h["total"] = len(urls)
                h["queue"] = [u for u in urls if u not in known]
            if not h["queue"]:
                h["done"] = TODAY
                continue
            jobs.append((b, h, known, key_url))

        results: queue.Queue = queue.Queue(maxsize=300)
        stop = threading.Event()

        def worker(b, h):
            while h["queue"] and not stop.is_set() and time.time() < deadline:
                url = h["queue"][0]
                try:
                    if not allowed_by_robots(url):
                        item = (b, url, None, None, "", "robots")
                    else:
                        t, txt, d = fetch_article_meta(url)
                        item = (b, url, t, txt, d, None)
                except urllib.error.HTTPError as e:
                    item = (b, url, None, None, "", "gone" if e.code in (404, 410) else f"HTTP {e.code}")
                except Exception as e:
                    item = (b, url, None, None, "", f"{type(e).__name__}")
                h["queue"].pop(0)
                results.put(item)
                stop.wait(ARTICLE_DELAY)

        threads = [threading.Thread(target=worker, args=(b, h), daemon=True) for b, h, _, _ in jobs]
        for t in threads:
            t.start()
        meta_by_site = {b["site"]: (known, key_url) for b, _, known, key_url in jobs}
        run["history_posts"] = run["history_failed"] = 0
        done_count = 0

        def handle(item):
            nonlocal done_count
            b, url, title, text, date, err = item
            known, key_url = meta_by_site[b["site"]]
            if err is None:
                ingest(b["name"], b.get("category", "food"), "blog", "bl-" + short_hash(url),
                       title or url, url, date, text)
                run["history_posts"] += 1
            elif err not in ("gone", "robots"):
                run["history_failed"] += 1
            known.add(url)
            done_count += 1
            if done_count % 500 == 0:
                for kn, ku in meta_by_site.values():
                    posts_state[ku] = sorted(kn)
                checkpoint()
                print(f"  歷史文章進度：已處理 {done_count} 篇", flush=True)

        while any(t.is_alive() for t in threads) or not results.empty():
            try:
                handle(results.get(timeout=1))
            except queue.Empty:
                if time.time() > deadline + 120:
                    stop.set()
        stop.set()
        for t in threads:
            t.join(timeout=40)
        while not results.empty():
            handle(results.get())
        for b, h, known, key_url in jobs:
            posts_state[key_url] = sorted(known)
            if not h["queue"]:
                h["done"] = TODAY
        left = sum(len(h.get("queue", [])) for h in history.values() if not h.get("done"))
        run["history_remaining"] = left
        if jobs:
            print(f"  歷史文章：本次處理 {done_count} 篇，剩 {left} 篇下次繼續", flush=True)

    # ---- TGOS 批次比對結果（門牌等級）：取代沒有座標或只有路段概略位置的 ----
    from tgos import apply_cache  # noqa: E402
    run["geo_tgos_applied"] = apply_cache(places, geo.cache)

    # ---- 補查座標：之前因額度留到下次的地址（已確認查不到的會直接略過，不重複查）----
    filled = 0
    for p in places:
        if p.get("latitude") is None and p.get("address") and "號" in p["address"] and (
                geo.used < geo.budget or (geo.TGOS_ID and geo.tgos_used < geo.tgos_budget)):
            try:
                loc = geo.locate(p["address"])
            except Exception:
                loc = None
            if loc:
                p["latitude"], p["longitude"], p["geo_precision"] = loc
                filled += 1
    run["geo_filled"] = filled
    run["geo_pending"] = sum(1 for p in places if p.get("latitude") is None and "號" in (p.get("address") or ""))

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
        if p["name"] != m["name"]:
            index.rename(p, m["name"])  # 以手動填寫的店名為準
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
                index.remove(p)
                contents[:] = [c for c in contents if c["place_id"] != p["place_id"]]
                continue
            if f.get("name") and f["name"] != p["name"]:
                index.rename(p, f["name"])
            if f.get("category"):
                p["category"] = f["category"]

    # ---- 米其林／必比登／台灣500碗（awards_source.json，每次重新產生 awards.json）----
    awards = []
    award_src = load(PIPE / "awards_source.json", {})
    entries = list(award_src.get("entries", []))
    # 台灣500碗：使用者自行整理的 CSV（name,city,address,year,bowls,source_url），程式只做格式轉換
    csv_path = PIPE / "awards_500_import.csv"
    if csv_path.exists():
        import csv
        with csv_path.open(encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                try:
                    if not (row.get("name") and row.get("city") and row.get("year")):
                        continue
                    entries.append({"name": row["name"].strip(), "city": normalize(row["city"].strip()),
                                    "address": (row.get("address") or "").strip(), "award_type": "taiwan_500",
                                    "award_year": int(row["year"]), "level": int(row["bowls"]) if (row.get("bowls") or "").strip() else None,
                                    "source_url": (row.get("source_url") or "").strip()})
                except ValueError as ex:
                    run["errors"].append(f"500碗 CSV 格式錯誤：{row}（{ex}）")
    for e in entries:
        name, city = e["name"], e["city"]
        base = re.split(r"\s*[（(]", name)[0].strip()
        if e.get("address"):
            addr = normalize(e["address"])
            p = ensure_place(name, addr, "food")
            c2, d2 = split_admin(addr)  # 官方地址最準：縣市、行政區以它為準
            if d2:
                p["city"], p["district"] = c2, d2
            if not p.get("address"):
                p["address"] = addr
        else:
            # 先找同縣市、同店名的既有地點（含部落客推薦或前一年度已建立的）
            # 連鎖店名稱含分店（如「鼎泰豐（信義路）」），只做完整名稱比對，避免配到別家分店
            p = next((x for x in index.by_name.get(key_name(name), []) if x.get("city") == city), None)
            if p is None:
                try:
                    r = geo.locate_poi(name, city) or (geo.locate_poi(base, city) if base == name else None)
                except Exception as ex:
                    run["errors"].append(f"地點查詢失敗 {name}：{ex}")
                    r = None
                loc = (r["lat"], r["lng"], "poi") if r else None
                p = new_place(name, "", "food", loc, city=city, district=(r or {}).get("district", ""),
                              id_key="award:" + key_name(name) + city)
                if not r:
                    run["skipped"].append(f"{name}（{city}）：獎項名單沒有地址，查不到位置，暫不顯示在地圖")
        if p.get("category") != "food":
            p["category"] = "food"
        awards.append({"award_id": "aw-" + short_hash(f"{p['place_id']}|{e['award_type']}|{e['award_year']}"),
                       "place_id": p["place_id"], "award_type": e["award_type"], "award_year": e["award_year"],
                       "source_url": e.get("source_url", ""), "verified_at": award_src.get("verified_at", ""),
                       **({"level": e["level"]} if e.get("level") else {})})
    # 同一地點同年同獎項只留一筆
    awards = list({a["award_id"]: a for a in awards}.values())
    if award_src or entries:
        save(DATA / "awards.json", awards)
        meta_notes = award_src.get("notes", {})
    else:
        meta_notes = {}

    save(DATA / "places.json", places)
    save(DATA / "contents.json", contents)
    save(PIPE / "state.json", state)
    geo.save()
    meta = load(DATA / "meta.json", {})
    meta["last_updated"] = TODAY
    meta["note"] = "地點由 YouTube 影片說明與部落格文章中的地址自動整理（規則式，未經 AI 推論）。標示「範例資料」者為未驗證的示範地點。"
    meta["award_notes"] = meta_notes
    save(DATA / "meta.json", meta)

    # ---- 第六階段：公開的執行狀態（App 的「資料狀態」會顯示；不含任何個人資料）----
    by_source = {}
    for c in contents:
        s = by_source.setdefault(c["source_name"], {"contents": 0, "latest": ""})
        s["contents"] += 1
        s["latest"] = max(s["latest"], c.get("published_at") or "")
    save(DATA / "status.json", {
        "run_at": run["run_at"], "runner": "github" if ON_GITHUB else "local",
        "new_videos": run["new_videos"], "new_posts": run["new_posts"], "new_places": run["new_places"],
        "skipped": len(run["skipped"]), "errors": run["errors"][:50], "by_source": by_source,
        "github_blocked_detected": run.get("github_blocked_detected", []),
        "history_posts": run.get("history_posts", 0), "history_remaining": run.get("history_remaining", 0),
        "geo_used": geo.used, "geo_deferred": geo.deferred, "geo_pending": run.get("geo_pending", 0),
        "tgos_used": geo.tgos_used,
    })
    summary = {k: (len(v) if isinstance(v, list) else v) for k, v in run.items()}
    run["skipped_count"] = len(run["skipped"])
    run["skipped"] = run["skipped"][:300]  # 補齊歷史時會有上萬筆，只保留前 300 筆
    log.append(run)
    save(PIPE / "log.json", log[-60:])  # 保留最近 60 次
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
