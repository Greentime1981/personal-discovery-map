"""cd pipeline && python -m unittest test_extract.py"""
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

    def test_tags_and_headings(self):
        t = (
            "夏雪冰棧\n\n（黑糖挫冰、西瓜冰）\n\n位置：高雄市三民區天祥一路155號\n\n"
            "南海理髮廳（懷舊復古｜冰店｜IG打卡最夯）\n位置：高雄市新興區南海街164號\n\n"
            "星饗道國際自助餐 在哪裡？\n\n地址： 台中市西屯區福星北路18號\n\n"
            "阿桃紅豆薏仁(鍋燒、吐司\n地址：高雄市鹽埕區壽星街10號\n\n"
            "吳家豆花八寶冰（正忠總店）\n位置：高雄市三民區建武路187號"
        )
        self.assertEqual(
            [x["name"] for x in extract_places(t)],
            ["夏雪冰棧", "南海理髮廳", "星饗道國際自助餐", "阿桃紅豆薏仁", "吳家豆花八寶冰(正忠總店)"],
        )

    def test_skip_event_lines(self):
        t = "陽光食園\n活動日期:11/14(六)\n地址：台南市北區育德路66-1號\n\n松山文創園區 官網\n台北市信義區光復南路133號"
        self.assertEqual([x["name"] for x in extract_places(t)], ["陽光食園", "松山文創園區"])

    def test_youtube_formats(self):
        bonny = (
            "===\n📍締旺油飯肉羹麵\n🈺️06:00–13:30\n🏠新北市新莊區自強街44號\n\n"
            "📍宏泰地瓜球\n🈺️08:30–18:00，賣完為止\n🏠新北市新莊區自信街51號(市場)"
        )
        self.assertEqual([x["name"] for x in extract_places(bonny)], ["締旺油飯肉羹麵", "宏泰地瓜球"])
        gout = (
            "/ 新東街米粉湯 /\n6 : 0 0 - 1 4  : 0 0（週四公休）\n台北市松山區新東街41巷10號\n\n"
            "/ 屏東任家涼麵 /\n台北市松山區富錦街535號"
        )
        self.assertEqual([x["name"] for x in extract_places(gout)], ["新東街米粉湯", "屏東任家涼麵"])

    def test_chapter_timestamps(self):
        t = (
            "本集美味店家_\n00:00 開場\n00:56 板橋小籠包\n1 6 : 0 0 - 0 1 : 0 0\n新北市板橋區南雅南路一段79號\n\n"
            "03:03 板橋王記好吃麻油雞\n17:00-22:00（週一公休）\n新北市板橋區南雅東路8號（勝利百貨前"
        )
        self.assertEqual([x["name"] for x in extract_places(t)], ["板橋小籠包", "板橋王記好吃麻油雞"])

    def test_many_blank_lines(self):
        t = "銀河之心耶誕樹\n\n\n\n\n\n展出地址:新光三越台中中港店 1F 水舞廣場(台中市西屯區台灣大道三段301號)\n展出日期:即日起"
        r = extract_places(t)
        self.assertEqual([(x["name"], x["address"]) for x in r], [("銀河之心耶誕樹", "台中市西屯區台灣大道三段301號")])

    def test_address_not_name(self):
        r = extract_places("新北市三重區中央北路\n新北市三重區中央北路65號")
        self.assertIsNone(r[0]["name"])

    def test_admin(self):
        self.assertEqual(split_admin("台北市大安區仁愛路"), ("台北市", "大安區"))
        self.assertEqual(split_admin("宜蘭縣羅東鎮中正路1號"), ("宜蘭縣", "羅東鎮"))
        self.assertEqual(split_admin("高雄市前鎮區正勤路27號"), ("高雄市", "前鎮區"))
        self.assertEqual(split_admin("新竹縣竹北市嘉南豐路一段62號"), ("新竹縣", "竹北市"))
        self.assertEqual(split_admin("新竹市東區東門街1號"), ("新竹市", "東區"))


if __name__ == "__main__":
    unittest.main()
