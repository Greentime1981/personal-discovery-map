"""內政部 TGOS「批次門牌地址比對服務」：匯出待比對地址、匯入比對結果。

個人會員只能用 TGOS 網站上的批次比對（上傳 CSV、隔 1～2 天收到結果信），不能用程式自動查詢，
所以流程是：
  1. export：把「還沒有門牌等級座標」的地址寫成 TGOS 範本格式的 CSV（每檔最多 1 萬筆＝每日上限）
  2. 使用者到 https://www.tgos.tw/tgos/Addr/Compare 上傳，收到通知信後下載結果
  3. import：讀結果檔（.csv 或 .zip），寫入 geocode_cache（"tgos:" + 地址），並更新地點座標

用法：
  python pipeline/tgos.py export <輸出資料夾>
  python pipeline/tgos.py import <結果檔或資料夾>...
"""
import csv
import io
import json
import re
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from collect import DATA, PIPE, load, save  # noqa: E402

CACHE = PIPE / "geocode_cache.json"
ADDR_MAP = PIPE / "tgos_map.json"  # 匯出時清理過的地址 → 資料庫原本的地址
SENT = PIPE / "tgos_sent.json"  # 地址 → 最近一次匯出的日期
PER_FILE = 10_000  # TGOS 每日可比對 1 萬筆
HEADER = ["id", "Address", "Response_Address", "Response_X", "Response_Y"]


def clean(addr: str) -> str:
    """TGOS 上傳檔是逗號分隔、不能有引號；括號內的補充說明（例如「(近捷運站)」）會讓比對失敗。"""
    a = re.sub(r"[（(][^）)]*[）)]", "", addr)
    return re.sub(r"[\s,\"'，]", "", a)


def needs(p) -> bool:
    """沒有座標，或只有路段／店名概略位置（手動指定的座標不動）。"""
    return p.get("latitude") is None or p.get("geo_precision") in ("street", "poi")


def pending(places, cache):
    """需要比對的地址：有門牌號碼、還不是門牌等級座標、TGOS 也還沒比對過。沒有座標的排前面。"""
    seen, first, later = set(), [], []
    for p in places:
        a = p.get("address") or ""
        if "號" not in a or a in seen or ("tgos:" + a) in cache or not needs(p):
            continue
        seen.add(a)
        (first if p.get("latitude") is None else later).append(a)
    return first + later


def export(out_dir: Path, resend_days: int = 5) -> list[Path]:
    """資料夾裡還有沒上傳的檔案就不動（使用者上傳後刪掉，下次才產生新的）。
    已匯出、但還沒收到結果的地址，resend_days 天內不重複匯出（TGOS 要 1～2 天才回覆）。"""
    out_dir.mkdir(parents=True, exist_ok=True)
    existing = sorted(out_dir.glob("TGOS待比對_*.csv"))
    if existing:
        return existing
    from datetime import date, timedelta
    today = date.today()
    cutoff = (today - timedelta(days=resend_days)).isoformat()
    places = load(DATA / "places.json", [])
    cache = load(CACHE, {})
    amap = load(ADDR_MAP, {})
    sent = load(SENT, {})
    addrs = [a for a in pending(places, cache) if sent.get(a, "") < cutoff]
    files = []
    for n, start in enumerate(range(0, len(addrs), PER_FILE), 1):
        f = out_dir / f"TGOS待比對_{today:%m%d}_{n:02d}.csv"
        for a in addrs[start:start + PER_FILE]:
            sent[a] = today.isoformat()
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\r\n", quoting=csv.QUOTE_MINIMAL)
        w.writerow(HEADER)
        for i, a in enumerate(addrs[start:start + PER_FILE], 1):
            c = clean(a)
            amap[c] = a
            w.writerow([i, c, "", "", ""])
        f.write_text(buf.getvalue(), encoding="utf-8-sig", newline="")  # 與 TGOS 範本相同：UTF-8（含 BOM）
        files.append(f)
    save(ADDR_MAP, amap)
    save(SENT, sent)
    return files


def _read_text(b: bytes) -> str:
    for enc in ("utf-8-sig", "cp950", "big5"):
        try:
            return b.decode(enc)
        except UnicodeDecodeError:
            pass
    return b.decode("utf-8", "ignore")


def _tables(path: Path):
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as z:
            for n in z.namelist():
                if n.lower().endswith((".csv", ".txt")):
                    yield _read_text(z.read(n))
    elif path.suffix.lower() in (".csv", ".txt"):
        yield _read_text(path.read_bytes())


def _col(header, *names):
    low = [h.strip().lower() for h in header]
    for n in names:
        if n.lower() in low:
            return low.index(n.lower())
    return None


def parse(path: Path):
    """回傳 [(原始地址, (lat, lng) 或 None)]。座標自動判斷 X／Y 是否對調，並確認在台灣範圍內。"""
    out = []
    for text in _tables(path):
        rows = list(csv.reader(io.StringIO(text)))
        if not rows:
            continue
        h = rows[0]
        ia, ix, iy = _col(h, "Address"), _col(h, "Response_X", "X"), _col(h, "Response_Y", "Y")
        if ia is None or ix is None or iy is None:
            raise ValueError(f"{path.name}：找不到 Address / Response_X / Response_Y 欄位（第一列是 {h[:6]}）")
        for r in rows[1:]:
            if len(r) <= max(ia, ix, iy) or not r[ia].strip():
                continue
            try:
                x, y = float(r[ix]), float(r[iy])
            except ValueError:
                out.append((r[ia].strip(), None))
                continue
            if 21 <= x <= 27 and 118 <= y <= 123:
                x, y = y, x
            ok = 118 <= x <= 123 and 21 <= y <= 27  # 只接受 WGS84 經緯度（上傳時請選 EPSG:4326）
            out.append((r[ia].strip(), (round(y, 6), round(x, 6)) if ok else None))
    return out


def apply_cache(places, cache) -> int:
    """把 TGOS 門牌座標套用到地點（取代沒有座標或只有路段概略位置的）。"""
    n = 0
    for p in places:
        hit = cache.get("tgos:" + (p.get("address") or ""))
        if hit and needs(p):
            p["latitude"], p["longitude"], p["geo_precision"] = hit["lat"], hit["lng"], "house"
            n += 1
    return n


def import_results(paths) -> dict:
    files = []
    for p in map(Path, paths):
        files += sorted(f for f in p.iterdir() if f.suffix.lower() in (".csv", ".zip", ".txt")) if p.is_dir() else [p]
    cache = load(CACHE, {})
    amap = load(ADDR_MAP, {})
    found = missed = 0
    for f in files:
        for addr, loc in parse(f):
            orig = amap.get(addr, addr)
            if loc:
                cache["tgos:" + orig] = {"lat": loc[0], "lng": loc[1], "has_house": True}
                found += 1
            else:
                cache.setdefault("tgos:" + orig, None)  # 比對不到：記下來，之後不再匯出
                missed += 1
    places = load(DATA / "places.json", [])
    updated = apply_cache(places, cache)
    save(CACHE, cache)
    save(DATA / "places.json", places)
    return {"files": len(files), "found": found, "missed": missed, "places_updated": updated}


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "export":
        fs = export(Path(sys.argv[2]))
        print(f"已產生 {len(fs)} 個檔案：" + "、".join(f.name for f in fs) if fs else "沒有需要比對的地址")
    elif len(sys.argv) >= 3 and sys.argv[1] == "import":
        print(json.dumps(import_results(sys.argv[2:]), ensure_ascii=False))
    else:
        print(__doc__)
        sys.exit(1)
