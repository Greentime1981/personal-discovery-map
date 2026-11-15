"""從完整資料庫 data/ 產生 App 用的精簡資料 public/data/（建置網站前執行）。

為什麼要拆：補齊歷史後地點可達數萬筆、推薦紀錄十萬筆以上，全部塞進手機一次載入太慢。
- places.json        地圖索引：只留地圖、清單、篩選需要的欄位（短欄位名）＋推薦來源數
- contents/index.json 來源清單（部落客 / YouTube 頻道、筆數、最新日期）與縣市對照
- contents/c<k>.json  某縣市所有地點的推薦紀錄（點開地點資訊卡時才載入）
- contents/s<k>.json  某個來源的所有推薦紀錄（部落客攻略選了來源才載入）
- awards.json / meta.json / status.json 直接複製

用法：python scripts/build_app_data.py
"""
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))
from extract import normalize_city  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data"
OUT = ROOT / "public" / "data"


def dump(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main() -> None:
    places = json.loads((SRC / "places.json").read_text(encoding="utf-8"))
    contents = json.loads((SRC / "contents.json").read_text(encoding="utf-8"))
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    for p in places:  # 舊縣市名（台北縣等）統一成現在的縣市
        p["city"] = normalize_city(p.get("city") or "")
    city_of = {p["place_id"]: p["city"] for p in places}
    src_count: dict[str, set] = {}
    for c in contents:
        src_count.setdefault(c["place_id"], set()).add(c["source_name"])

    lite = []
    for p in places:
        r = {"i": p["place_id"], "n": p["name"], "c": p["category"], "y": p.get("city") or "", "d": p.get("district") or "",
             "a": p.get("address") or "", "la": p.get("latitude"), "lo": p.get("longitude"),
             "k": len(src_count.get(p["place_id"], ()))}
        if p.get("geo_precision"):
            r["g"] = p["geo_precision"]
        if p.get("price_range"):
            r["pr"] = p["price_range"]
        if p.get("sample"):
            r["sm"] = 1
        lite.append(r)
    dump(OUT / "places.json", lite)

    def slim(c):
        r = {"i": c["content_id"], "p": c["place_id"], "t": c["source_type"], "s": c["source_name"],
             "ti": c.get("title") or "", "u": c.get("source_url") or "", "d": c.get("published_at") or ""}
        if c.get("summary"):
            r["su"] = c["summary"]
        if c.get("original_sequence") is not None:
            r["q"] = c["original_sequence"]
        return r

    cities = sorted({city_of.get(c["place_id"], "") for c in contents})
    city_idx = {name: k for k, name in enumerate(cities)}
    by_city: dict[int, list] = {}
    by_src: dict[str, list] = {}
    for c in contents:
        s = slim(c)
        by_city.setdefault(city_idx[city_of.get(c["place_id"], "")], []).append(s)
        by_src.setdefault(c["source_name"], []).append(s)
    for k, rows in by_city.items():
        dump(OUT / "contents" / f"c{k}.json", rows)

    sources = []
    for k, (name, rows) in enumerate(sorted(by_src.items(), key=lambda kv: -len(kv[1]))):
        dump(OUT / "contents" / f"s{k}.json", rows)
        sources.append({"k": k, "name": name, "type": rows[0]["t"], "count": len(rows),
                        "articles": len({r["u"] for r in rows}), "latest": max(r["d"] for r in rows)})
    dump(OUT / "contents" / "index.json", {"cities": cities, "sources": sources, "total": len(contents)})

    for name in ("awards.json", "meta.json", "status.json"):
        if (SRC / name).exists():
            shutil.copy(SRC / name, OUT / name)

    size = sum(f.stat().st_size for f in OUT.rglob("*.json"))
    print(f"App 資料：地點 {len(lite)}、推薦 {len(contents)}（{len(sources)} 個來源、{len(cities)} 個縣市檔）；"
          f"首頁載入 places.json {(OUT / 'places.json').stat().st_size / 1e6:.1f} MB，全部 {size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
