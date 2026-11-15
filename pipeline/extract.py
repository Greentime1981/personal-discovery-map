"""規則式地點辨識：從影片說明 / 文章摘要中找出「店名 + 地址」。

不使用 AI，不推論：只收錄說明文字裡明確寫出的地址。
找不到店名或地址的，不建立地點（由 collect.py 記錄原因）。
"""
import re
import unicodedata

# 台灣地址：縣市（可省略）+ 鄉鎮市區 + 路/街/大道 ... 號
ADDR_RE = re.compile(
    r"((?:[臺台][北中南東]|新北|桃園|高雄|基隆|新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|澎湖|金門|連江)[市縣]?"
    r"[一-鿿]{1,4}?[區鄉鎮市]"
    r"[一-鿿0-9\-之巷弄段]{0,20}?(?:路|街|大道|道)"
    r"[一-鿿0-9\-之巷弄段]{0,15}?\d+(?:-\d+)?號(?:之\d+)?)"
)
NAME_LABEL_RE = re.compile(r"(?:店名|店家|餐廳|名稱|店舖|店鋪|Restaurant)\s*[:：]\s*(.+)")
ADDR_LABEL_RE = re.compile(r"^\s*(?:地址|住址|位置|Address|📍)\s*[:：]?\s*", re.I)
NOISE_RE = re.compile(r"[\U0001F000-\U0001FFFF☀-➿️#＃|｜]+")
SKIP_NAME_RE = re.compile(r"(地址|住址|位置|電話|專線|營業|時間|公休|價位|價格|日期|期間|參考|http|訂位|菜單|停車|交通|捷運|instagram|facebook|\bIG\b|\bFB\b)", re.I)
# 「(挫冰|冰|季節性)」這類分類標籤：括號內含 | 或 、
TAG_GROUP_RE = re.compile(r"\([^()]*[|、/][^()]*\)")


def normalize(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)  # 全形數字/冒號 → 半形
    return s.replace("臺", "台")


def clean_name(s: str) -> str:
    s = normalize(s)
    s = TAG_GROUP_RE.sub("", s)
    s = re.sub(r"\([^()]*$", "", s)  # 沒有收尾的括號
    s = re.sub(r"\s*(在哪裡|在哪|店家資訊|資訊)\s*[?？]?\s*$", "", s)
    s = re.sub(r"\s*(官網|官方網站)\s*$", "", s)
    s = NOISE_RE.sub(" ", s)
    s = re.sub(r"^[\s\-–—•·*\d\.、:：【\[(（]+", "", s)
    s = re.sub(r"[\s\-–—:：】\]]+$", "", s)
    s = s.strip("「」『』 ")
    return s.strip()


def guess_name(lines: list[str], idx: int) -> str | None:
    """地址在第 idx 行，往前最多 4 行找店名。"""
    # 同一行：「店名 地址：xxx」或「【店名】台北市...」
    line = lines[idx]
    m = re.search(r"【([^】]{2,30})】", line)
    if m:
        return clean_name(m.group(1))
    for j in range(idx, max(-1, idx - 5), -1):
        m = NAME_LABEL_RE.search(lines[j])
        if m:
            name = clean_name(m.group(1))
            if 2 <= len(name) <= 30:
                return name
    for j in range(idx - 1, max(-1, idx - 5), -1):
        raw = lines[j].strip()
        if re.fullmatch(r"\(.*\)", raw):  # 整行都是括號說明，略過往上找
            continue
        cand = clean_name(raw)
        if not cand or SKIP_NAME_RE.search(cand) or ADDR_RE.search(cand):
            continue
        if 2 <= len(cand) <= 30:
            return cand
        break
    return None


def extract_places(text: str) -> list[dict]:
    """回傳 [{name, address, sequence}]，sequence 為說明文字中出現的順序（作者原始順序）。"""
    if not text:
        return []
    lines = [normalize(l) for l in text.splitlines()]
    out, seen = [], set()
    for i, line in enumerate(lines):
        for m in ADDR_RE.finditer(ADDR_LABEL_RE.sub("", line)):
            addr = m.group(1)
            if addr in seen:
                continue
            seen.add(addr)
            out.append({"name": guess_name(lines, i), "address": addr, "sequence": len(out) + 1})
    return out


def split_admin(addr: str) -> tuple[str, str]:
    m = re.match(r"((?:[台][北中南東]|新北|桃園|高雄|基隆|新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|澎湖|金門|連江)[市縣]?)([一-鿿]{1,4}?[區鄉鎮市])", addr)
    if not m:
        return "", ""
    city = m.group(1)
    if not city.endswith(("市", "縣")):
        city += "市" if city in ("台北", "台中", "台南", "新北", "桃園", "高雄", "基隆") else "縣"
    return city, m.group(2)
