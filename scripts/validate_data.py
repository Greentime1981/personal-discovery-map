"""檢查 public/data/*.json 的基本正確性。

- 必填欄位、分類值
- place_id / content_id / award_id 不重複
- 疑似重複地點（同名且距離 < 100 公尺）
- contents / awards 參照的 place_id 必須存在
- 獎項必須有年度（不能把舊年度當成今年）

用法：python scripts/validate_data.py   （有錯誤時 exit code = 1）
"""
import json
import math
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "public" / "data"
CATEGORIES = {"food", "family", "date", "attraction"}
AWARD_TYPES = {"michelin_1", "michelin_2", "michelin_3", "bib_gourmand", "taiwan_500"}


def load(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def km(a, b):
    r = 6371
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def norm(name):
    return "".join(name.split()).lower()


def main():
    errors, warns = [], []
    places, contents, awards = load("places.json"), load("contents.json"), load("awards.json")

    ids = set()
    for p in places:
        pid = p.get("place_id")
        if not pid or pid in ids:
            errors.append(f"place_id 缺少或重複：{pid}")
        ids.add(pid)
        if not p.get("name"):
            errors.append(f"{pid} 缺少 name")
        if p.get("category") not in CATEGORIES:
            errors.append(f"{pid} category 不合法：{p.get('category')}")
        lat, lng = p.get("latitude"), p.get("longitude")
        if (lat is None) != (lng is None):
            errors.append(f"{pid} 座標只填一半")
        elif lat is not None and not (21 <= lat <= 27 and 118 <= lng <= 123):
            warns.append(f"{pid} 座標不在台灣範圍：{lat},{lng}")

    located = [p for p in places if p.get("latitude") is not None]
    for i, a in enumerate(located):
        for b in located[i + 1:]:
            if norm(a["name"]) == norm(b["name"]) and km((a["latitude"], a["longitude"]), (b["latitude"], b["longitude"])) < 0.1:
                errors.append(f"疑似重複地點：{a['place_id']} / {b['place_id']}（{a['name']}）")

    cids = set()
    for c in contents:
        cid = c.get("content_id")
        if not cid or cid in cids:
            errors.append(f"content_id 缺少或重複：{cid}")
        cids.add(cid)
        if c.get("place_id") not in ids:
            errors.append(f"content {cid} 參照不存在的 place_id：{c.get('place_id')}")

    aids = set()
    for a in awards:
        aid = a.get("award_id")
        if not aid or aid in aids:
            errors.append(f"award_id 缺少或重複：{aid}")
        aids.add(aid)
        if a.get("place_id") not in ids:
            errors.append(f"award {aid} 參照不存在的 place_id：{a.get('place_id')}")
        if a.get("award_type") not in AWARD_TYPES:
            errors.append(f"award {aid} award_type 不合法：{a.get('award_type')}")
        if not isinstance(a.get("award_year"), int):
            errors.append(f"award {aid} 缺少 award_year")
        if not a.get("source_url"):
            warns.append(f"award {aid} 缺少 source_url")

    for w in warns:
        print("警告：", w)
    for e in errors:
        print("錯誤：", e)
    print(f"places={len(places)} contents={len(contents)} awards={len(awards)}  錯誤 {len(errors)}、警告 {len(warns)}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
