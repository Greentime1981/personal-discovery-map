"""python -m unittest pipeline/test_extract.py"""
import unittest
from extract import extract_places, split_admin


class T(unittest.TestCase):
    def test_labelled(self):
        t = "今天吃牛肉麵\n\n📍店名：老王牛肉麵\n📍地址：台北市大安區仁愛路四段１２３號\n☎電話：02-1234"
        r = extract_places(t)
        self.assertEqual(r, [{"name": "老王牛肉麵", "address": "台北市大安區仁愛路四段123號", "sequence": 1}])

    def test_bracket_and_order(self):
        t = "【阿明小吃】臺南市中西區民族路二段45號\n\n第二間\n小林冰店\n地址：台南市東區東門路一段8之1號"
        r = extract_places(t)
        self.assertEqual([x["name"] for x in r], ["阿明小吃", "小林冰店"])
        self.assertEqual([x["sequence"] for x in r], [1, 2])
        self.assertEqual(r[0]["address"], "台南市中西區民族路二段45號")

    def test_no_name(self):
        r = extract_places("營業時間 11:00\n地址：新北市板橋區文化路一段100號")
        self.assertIsNone(r[0]["name"])

    def test_no_address(self):
        self.assertEqual(extract_places("好吃！歡迎訂閱"), [])

    def test_admin(self):
        self.assertEqual(split_admin("台北市大安區仁愛路"), ("台北市", "大安區"))
        self.assertEqual(split_admin("宜蘭縣羅東鎮中正路1號"), ("宜蘭縣", "羅東鎮"))


if __name__ == "__main__":
    unittest.main()
