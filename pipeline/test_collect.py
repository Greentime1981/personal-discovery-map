"""cd pipeline && python -m unittest test_collect.py"""
import unittest

from collect import merge_duplicates


def place(pid, name, lat, lng, sources=(), created="2026-01-01", address=""):
    return {"place_id": pid, "name": name, "latitude": lat, "longitude": lng, "sources": list(sources),
            "created_at": created, "address": address, "city": "", "district": ""}


class MergeDuplicates(unittest.TestCase):
    def test_merges_same_name_nearby(self):
        a = place("pl-a", "鍾家原上海生煎包", 25.0400, 121.5000, ["c1", "c2"])
        b = place("pl-b", "鍾家原上海生煎包", 25.0402, 121.5001, ["c3"], address="台北市中正區某路1號")
        places = [a, b]
        contents = [{"place_id": "pl-a"}, {"place_id": "pl-a"}, {"place_id": "pl-b"}]
        awards = [{"place_id": "pl-b"}]
        self.assertEqual(merge_duplicates(places, contents, refs=[awards]), 1)
        self.assertEqual([p["place_id"] for p in places], ["pl-a"])  # 保留推薦較多的
        self.assertEqual(a["sources"], ["c1", "c2", "c3"])
        self.assertEqual(a["address"], "台北市中正區某路1號")  # 補上缺少的地址
        self.assertTrue(all(c["place_id"] == "pl-a" for c in contents + awards))

    def test_keeps_branches_far_apart(self):
        places = [place("pl-a", "鼎泰豐", 25.033, 121.564), place("pl-b", "鼎泰豐", 25.040, 121.520)]
        self.assertEqual(merge_duplicates(places, []), 0)
        self.assertEqual(len(places), 2)

    def test_ignores_places_without_coords(self):
        places = [place("pl-a", "小店", 25.0, 121.5), place("pl-b", "小店", None, None)]
        self.assertEqual(merge_duplicates(places, []), 0)

    def test_different_names_same_spot(self):  # 同一棟百貨的不同店
        places = [place("pl-a", "甲餐廳", 25.0, 121.5), place("pl-b", "乙咖啡", 25.0, 121.5)]
        self.assertEqual(merge_duplicates(places, []), 0)


if __name__ == "__main__":
    unittest.main()
