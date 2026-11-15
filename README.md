# Personal Discovery Map 個人探索地圖

<img src="public/icon-192.png" width="96" alt="App 圖示">

**手機掃描開啟：** https://greentime1981.github.io/personal-discovery-map/

<img src="docs/qrcode.png" width="260" alt="QR Code">

> 用手機瀏覽器開啟後選「加入主畫面」，就能像 App 一樣使用。

個人用的生活與旅遊探索地圖：輸入目的地，看附近值得去的美食、親子、約會地點與景點，點一下就能開 Google Maps 導航。

目前完成 **第一～三階段**：

- 目的地 / 地址搜尋、目前位置定位、右鍵（手機長按）地圖設為目的地
- 範圍 1 / 3 / 5 / 10 公里或自訂；分類篩選；依距離、推薦來源數、分類排序
- 分類圖示標記、附近清單、地圖 / 清單模式切換（手機優先，桌面自動改為左右版面）
- 地點資訊卡：沒有資料的欄位顯示「尚無資料」，不捏造內容
- 收藏、已造訪、個人備註（只存在本機瀏覽器），可匯出 / 匯入 `user_data.json`
- 開啟 Google Maps 導航
- **部落客攻略**：每天自動讀取追蹤的 6 個 YouTube 頻道與 21 個部落格（`pipeline/sources.json`），擷取店名與地址，依作者原始順序顯示在地圖上

### 設定 YouTube API Key（一次就好）

1. 到 Google Cloud Console 建立專案，啟用「YouTube Data API v3」，建立 API 金鑰（免費額度每天 10,000 單位，本專案每天用不到 50）。
2. 到本 repo **Settings → Secrets and variables → Actions → New repository secret**，名稱 `YOUTUBE_API_KEY`，貼上金鑰。
3. 到 **Actions → Update data (YouTube) → Run workflow** 手動跑第一次。之後每天台灣時間 04:00 自動執行。

新增 / 移除頻道或部落格：編輯 `pipeline/sources.json`。

### 開啟 Claude 時自動更新部落格

部分部落格會擋 GitHub 的伺服器，所以由本機補抓：`scripts/local_update.py` 掛在 Claude Code 的 SessionStart hook（`~/.claude/settings.json`），開啟 Claude 時在背景執行，20 小時內最多一次，紀錄在 `%LOCALAPPDATA%\pdm-updater\update.log`。

### 我的手動清單

不在追蹤清單裡的店家，加到 `pipeline/manual.json` 的 `places`（店名、地址必填；可填分類、推薦人 `by`、備註 `note`）。
自動抓錯的店名或已歇業的店，加到 `fixes`（用地址對應，可改 `name`、`category`，或 `closed: true`）。
手動清單在每次更新都會套用，重建資料也不會消失。改善辨識規則後，可在 Actions 手動執行時勾選 **rebuild** 重新整理全部資料。

> ⚠️ `public/data/places.json` 目前只有幾筆**範例地點**（標示為範例、座標為概略值），還沒有部落客 / YouTube / 米其林資料。這些在第三、四階段加入。

完整規劃、API 費用與技術限制請看 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 本機執行

```bash
npm install
npm run dev
```

## 部署

推到 `main` 分支後，GitHub Actions 會先執行 `scripts/validate_data.py` 檢查資料，再建置並部署到 GitHub Pages。
第一次使用需要到 repo 的 **Settings → Pages → Source** 選 **GitHub Actions**。

## 新增地點資料

直接編輯 `public/data/places.json`、`contents.json`、`awards.json`，然後執行：

```bash
python scripts/validate_data.py
```

## 隱私

- 收藏、備註只存在你的瀏覽器，不會上傳，也不會進 GitHub。
- API Key（第三階段起）只放在 GitHub Secrets。

地圖資料與圖磚 © OpenStreetMap contributors。
