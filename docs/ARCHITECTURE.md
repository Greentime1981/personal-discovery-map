# 架構與開發規劃

依《個人生活與旅遊探索地圖 App－開發規格書》第十節要求整理。

## 1. 最精簡可行架構

```
GitHub repo（公開）
├── public/data/*.json      ← 公開地點資料（places / contents / awards / meta）
├── src/                    ← React + TypeScript + Vite 前端（純靜態）
├── scripts/                ← Python：資料驗證；第三階段起加入資料蒐集
└── .github/workflows/      ← build + 部署 GitHub Pages；第六階段加每日排程

瀏覽器
├── 讀取 data/*.json（靜態檔，無後端）
├── 地圖：Leaflet + OpenStreetMap 官方圖磚（低用量個人使用，可在 config.ts 換供應商）
├── 地址查詢：OSM Nominatim（使用者按搜尋時才呼叫）
├── 個人資料：localStorage（收藏、已造訪、備註），可匯出 / 匯入 user_data.json
└── 導航：開啟 Google Maps 外部連結
```

沒有後端、沒有資料庫伺服器、沒有會員系統。

## 2. 專案目錄

| 路徑 | 用途 |
|---|---|
| `src/App.tsx` | 首頁：搜尋列、四大入口、篩選、地圖 + 清單 + 資訊卡 |
| `src/components/MapView.tsx` | Leaflet 地圖、分類圖示、搜尋範圍圈、目前位置 |
| `src/components/SearchBar.tsx` | 目的地 / 地址搜尋 |
| `src/components/PlaceList.tsx` | 附近推薦清單 |
| `src/components/PlaceCard.tsx` | 地點資訊卡（沒有資料就顯示「尚無資料」） |
| `src/lib/geo.ts` | 距離計算、Google Maps 導航連結 |
| `src/lib/geocode.ts` | Nominatim 查詢（節流 1 次/秒 + 快取） |
| `src/lib/userData.ts` | 個人資料（localStorage） |
| `src/config.ts` | 圖磚供應商、分類圖示、獎項名稱 |
| `public/data/` | 公開資料 JSON |
| `scripts/validate_data.py` | 資料檢查（重複、參照、獎項年度），CI 每次部署前執行 |

## 3. 資料 Schema

與規格書第四節一致，額外欄位：

- `places.json`：多一個 `sample: true`，標示「範例資料、未驗證」。`latitude/longitude` 為 `null` 的地點**不會**出現在地圖上（避免不確定的地址當成正確資料）。
- `contents.json`：`source_type` 為 `youtube` / `blog` / `official`。推薦數量 = 同一 `place_id` 下不同 `source_name` 的數量。`original_sequence` 存作者原始順序；系統最佳化順序將另存，不覆蓋原始值。
- `awards.json`：`award_type` ∈ `michelin_1 | michelin_2 | michelin_3 | bib_gourmand | taiwan_500`；每筆一個年度，同一家多年獲獎就多筆，畫面一律顯示年度。
- `meta.json`：`last_updated`、說明文字。
- `user_data.json`：**不進 repo**（已列入 `.gitignore`）。App 內存在 localStorage，「匯出個人資料」可下載備份。

## 4. 開發階段

| 階段 | 內容 | 狀態 |
|---|---|---|
| 一 | 地圖、搜尋、分類、範圍、排序、地點資訊卡 | ✅ 完成 |
| 二 | 收藏、已造訪、備註、Google Maps 導航、目前位置 | ✅ 完成 |
| 三 | YouTube Data API + 部落格 RSS 蒐集 → 規則式地點辨識 → 地理編碼 → 去重 → 寫入 JSON；「部落客攻略」頁（保留作者原始順序）；每日 GitHub Actions | ✅ 完成 |
| 四 | 米其林星級與必比登 2018–2026 歷年資料（中央社），依縣市、行政區、年度、獎項、店名搜尋；地點卡顯示歷年獲獎區間並標示「最新年度未列入」；500碗以 CSV 自行匯入 | ✅ 完成 |
| 五 | 旅遊路線：多個旅程、每日目的地、飯店周邊＋沿線（直線路段）篩選、繞路時間估算；行程存在本機 | ✅ 完成 |
| 六 | 每日排程＋開 Claude 時本機更新、status.json 與 App「資料狀態」、驗證（年度、碗數、筆數驟減）、出錯自動開 GitHub Issue 通知 | ✅ 完成 |

每階段完成並測試後才進下一階段。

## 4.1 第三階段資料流程

```
pipeline/sources.json（追蹤的頻道）
  → collect.py：YouTube Data API playlistItems（只抓新影片，state.json 記錄已處理）
  → extract.py：從影片說明找「台灣地址（…號）」與附近的店名；沒寫地址就不建立
  → Nominatim 地理編碼（快取在 geocode_cache.json）；查不到 → 座標 null、不上地圖
  → 去重：同地址，或同店名且 < 200 公尺 → 合併為同一地點、多一個推薦來源
  → 寫入 public/data/places.json、contents.json；執行紀錄與失敗原因寫入 pipeline/log.json
  → GitHub Actions（update-data.yml，每天 04:00）commit 後重新部署
```

部落格（21 個，見 sources.json）：
- RSS 有全文的（4 個）直接從 RSS 擷取。
- RSS 只有摘要的（10 個，`fetch_article: true`）：經使用者同意，對每篇**新文章**讀取一次文章頁面，只在記憶體中擷取店名與地址；不儲存全文與照片，遵守 robots.txt，每篇間隔 3 秒。
- 關閉 RSS 的部落格（`sitemap`）：從文章 sitemap 取最新 30 篇，同樣只擷取店名與地址。
- 資料只保存：店名、地址、文章標題、連結、日期。
- 地點 ID 由地址產生（`pl-` + 雜湊），重建資料時不變，個人收藏不會失效。

注意：YouTube 的公開 RSS（feeds/videos.xml）目前回應 404，因此直接使用官方 Data API。
Nominatim 對台灣地址多半只能定位到路段（`geo_precision: "street"`），地圖上為概略位置；導航按鈕一律用「店名 + 地址」交給 Google Maps 查詢，所以導航仍會到正確店家。

## 4.2 第四階段：獎項資料
- 來源：中央社各年度報導與圖表（robots.txt 宣告 `ai-input=yes`），2022 必比登取自 TVBS 新聞（robots 無 AI 限制）。
- 米其林官網聲明禁止自動化讀取、聯合報系（500碗）聲明不得以 AI 處理，因此都不讀取。
- 資料檔：`pipeline/awards_source.json`（每筆一個年度）；500碗：`pipeline/awards_500_import.csv` 由使用者自行填寫。
- 星級各年筆數皆與官方公布數量核對（程式內 assert）。不完整的年度寫在 `notes`，App 會顯示：
  - 2020 必比登台北僅新入選 7 家；2022 必比登僅報導點名的 36 家（官方 141 家）。
- 沒有地址的必比登：先比對同縣市同名的既有地點，再用 Nominatim 查「店名 縣市」，只接受餐廳／商店類結果；查不到就不上地圖（清單仍可導航）。

## 4.3 第五階段：旅遊路線
- 路線 = 飯店 → 當天各目的地 → 飯店（直線路段）。每個地點算：距飯店、距最近路段、繞路距離 d(A,P)+d(P,B)−d(A,B)。
- 繞路時間 = 繞路距離 × 1.3 ÷ 40 km/h（估計值，畫面註明）。之後可改接 OSRM 等路線服務。

## 4.4 第六階段：穩定更新
- `public/data/status.json`：最後執行、執行者（github / local）、各來源筆數與最新日期、錯誤（App「ⓘ 資料狀態」）。
- `validate_data.py --compare-git`：與上一版比較，筆數減少超過 20% 視為異常，不發布。
- `scripts/report_status.py`：有錯誤時開／更新「資料更新警告」Issue（GitHub 寄信），恢復正常自動關閉。
- `sources.json` 的 `github_blocked: true`：擋 GitHub 的部落格只在本機更新，GitHub 不再每天報 403。

## 5. 需要申請的 API 與費用

| 服務 | 用途 | 需要申請 | 費用 |
|---|---|---|---|
| OpenStreetMap 圖磚 | 地圖圖磚 | 否 | 免費，但只限低用量、需標示出處、不可批次下載；用量變大改 Stadia Maps / MapTiler（有免費額度，需註冊 key） |
| OSM Nominatim | 地址查詢 | 否 | 免費，限 1 次/秒、不可大量查詢 |
| Google Maps 連結 | 導航 | 否 | 免費（只用 URL，不用 API） |
| GitHub Pages + Actions | 部署 / 排程 | 否 | 公開 repo 免費 |
| YouTube Data API v3（第三階段） | 影片 metadata | Google Cloud 專案 + API Key | 免費，每日 10,000 配額單位 |
| 地理編碼（第三階段後，批次） | 地址轉座標 | 視選擇 | 建議 TGOS（內政部，需申請）或自建快取；不可用 Nominatim 批次跑 |
| Claude API（選用，第三階段後） | 摘要 / 地點辨識 | Anthropic Console | 依用量計費，增量更新每月約數美元內 |

API Key 一律放 GitHub Secrets，只在 Actions 的 Python 中使用，不會出現在前端。

## 6. 可能的技術限制

1. **米其林 / 台灣500碗資料授權**：官方網站沒有公開 API，網站條款可能禁止爬取。建議以手動或半自動方式整理名單（店名、獎項、年度、官方連結），不複製介紹全文與照片。
2. **部落格**：很多部落格沒有 RSS，或 RSS 只有摘要。只用 RSS 能取得的內容，不爬全文。
3. **地點辨識**：從文章擷取店名容易出錯（同名分店、已歇業）。自動流程只產出「候選」，座標不確定的維持 `null`，不上地圖。
4. **地理編碼**：Nominatim 對台灣門牌地址精度普通；批次地理編碼需要另一個合規服務。
5. **行車路線（第五階段）**：真正的繞路時間需要路線 API（如 OSRM 公共伺服器有用量限制）。初期以「離每日目的地連線的距離」近似。
6. **個人資料只存在單一裝置**：換手機需用匯出 / 匯入。需要跨裝置同步時再考慮 Supabase。
7. **GitHub Pages 為公開網站**：任何知道網址的人都看得到公開地點資料（但看不到你的收藏）。

## 7. 未來擴充清單（目前刻意不做）

- 跨裝置同步（Supabase）
- 真實行車時間（OSRM / 路線 API）取代直線估算
- AI 自動行程最佳化、AI 分類與推薦理由摘要
- 離線地圖、Service Worker 快取
