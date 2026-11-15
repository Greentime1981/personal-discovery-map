# Personal Discovery Map 個人探索地圖

個人用的生活與旅遊探索地圖：輸入目的地，看附近值得去的美食、親子、約會地點與景點，點一下就能開 Google Maps 導航。

目前完成 **第一～三階段**：

- 目的地 / 地址搜尋、目前位置定位、右鍵（手機長按）地圖設為目的地
- 範圍 1 / 3 / 5 / 10 公里或自訂；分類篩選；依距離、推薦來源數、分類排序
- 分類圖示標記、附近清單、地圖 / 清單模式切換（手機優先，桌面自動改為左右版面）
- 地點資訊卡：沒有資料的欄位顯示「尚無資料」，不捏造內容
- 收藏、已造訪、個人備註（只存在本機瀏覽器），可匯出 / 匯入 `user_data.json`
- 開啟 Google Maps 導航
- **部落客攻略**：每天自動讀取追蹤的 YouTube 頻道（`pipeline/sources.json`），從影片說明擷取店名與地址，依作者原始順序顯示在地圖上

### 設定 YouTube API Key（一次就好）

1. 到 Google Cloud Console 建立專案，啟用「YouTube Data API v3」，建立 API 金鑰（免費額度每天 10,000 單位，本專案每天用不到 50）。
2. 到本 repo **Settings → Secrets and variables → Actions → New repository secret**，名稱 `YOUTUBE_API_KEY`，貼上金鑰。
3. 到 **Actions → Update data (YouTube) → Run workflow** 手動跑第一次。之後每天台灣時間 04:00 自動執行。

新增 / 移除頻道：編輯 `pipeline/sources.json`。

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
