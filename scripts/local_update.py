"""開啟 Claude 時，在背景更新部落格資料（不需要每天開電腦）。

為什麼要在本機跑：部分部落格會擋 GitHub 的伺服器（403），從本機連線才讀得到。

運作方式：
- 由 Claude Code 的 SessionStart hook 呼叫：python scripts/local_update.py
- 立刻在背景啟動真正的更新程序後就結束，不會拖慢 Claude 開啟速度。
- 距離上次本機更新未滿 MIN_HOURS 小時就跳過（避免一天開很多次 Claude 重複執行）。
- 在獨立的資料夾（%LOCALAPPDATA%/pdm-updater/repo）操作，不會動到你正在編輯的專案。
- 有新資料才 commit + push；GitHub Pages 會自動重新部署。
- 紀錄寫在 %LOCALAPPDATA%/pdm-updater/update.log

手動強制執行：python scripts/local_update.py --force
"""
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

REPO_URL = "https://github.com/Greentime1981/personal-discovery-map.git"
MIN_HOURS = 20
HOME = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "pdm-updater"
REPO = HOME / "repo"
LOG = HOME / "update.log"
STAMP = HOME / "last_run.txt"
LOCK = HOME / "running.lock"

# TGOS 批次門牌比對：桌面上的資料夾（使用者上傳／下載用）
TGOS_DIR = Path(os.environ.get("PDM_TGOS_DIR", Path.home() / "Desktop" / "TGOS門牌比對"))
TGOS_OUT = TGOS_DIR / "1_要上傳的檔案"
TGOS_IN = TGOS_DIR / "2_下載的結果放這裡"
TGOS_DONE = TGOS_DIR / "3_已匯入"
TGOS_README = """TGOS 門牌比對（讓地圖位置精準到門牌）

每次約 1 分鐘，有空再做即可：
1. 到 https://www.tgos.tw/tgos/Addr/Compare 登入
2. APIKEY 填你申請到的批次比對金鑰；坐標系統選「EPSG:4326 (WGS84)」；比對方式選「允許模糊比對」；多筆回傳限制選「1 筆」
3. 門牌檔案：上傳「1_要上傳的檔案」裡的一個檔案（一天最多一個，每檔 1 萬筆），按「進行批次比對」
4. 上傳後把那個檔案刪掉（全部刪完，下次開 Claude 會產生新的一批）
5. 1～2 天後收到 TGOS 通知信，下載比對結果（.csv 或 .zip 都可以）放進「2_下載的結果放這裡」
6. 下次開 Claude 會自動匯入並更新網站，匯入過的檔案會移到「3_已匯入」
"""


def tgos_results() -> list[Path]:
    if not TGOS_IN.exists():
        return []
    return sorted(f for f in TGOS_IN.iterdir() if f.suffix.lower() in (".csv", ".zip", ".txt"))


def log(msg: str) -> None:
    HOME.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}\n")


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    r = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, encoding="utf-8")
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} 失敗：{r.stderr.strip()[:300]}")
    return r


def run_update(tgos_only: bool = False) -> None:
    HOME.mkdir(parents=True, exist_ok=True)
    if LOCK.exists() and time.time() - LOCK.stat().st_mtime < 4 * 3600:
        log("已有更新在執行中，略過")
        return
    # GitHub 正在更新資料時先不跑，避免兩邊同時上傳造成衝突
    try:
        import json as _json
        import urllib.request as _ur
        api = REPO_URL.replace("https://github.com/", "https://api.github.com/repos/").removesuffix(".git")
        with _ur.urlopen(_ur.Request(api + "/actions/runs?status=in_progress&per_page=5",
                                     headers={"User-Agent": "personal-discovery-map"}), timeout=20) as r:
            if _json.load(r).get("total_count", 0) > 0:
                log("GitHub 正在更新資料，這次先不跑（下次開 Claude 再更新）")
                return
    except Exception:
        pass  # 查不到就照常執行
    LOCK.write_text(str(os.getpid()))
    try:
        if not (REPO / ".git").exists():
            log("第一次執行：下載專案")
            subprocess.run(["git", "clone", "-q", REPO_URL, str(REPO)], check=True, capture_output=True)
            git("config", "user.name", "underarmy1981")
            git("config", "user.email", "underarmy1981@gmail.com")
        git("rebase", "--abort", check=False)  # 上次上傳中途失敗留下的狀態
        git("fetch", "-q", "origin")
        git("reset", "-q", "--hard", "origin/main")  # 這是專用資料夾，直接對齊 GitHub 最新版

        env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
        env.pop("YOUTUBE_API_KEY", None)  # YouTube 由 GitHub 每日處理，本機只跑部落格

        # TGOS 比對結果：先匯入（門牌等級座標）
        results = tgos_results()
        if results:
            t = subprocess.run([sys.executable, "pipeline/tgos.py", "import", *map(str, results)], cwd=REPO,
                               capture_output=True, text=True, encoding="utf-8", env=env)
            log(f"TGOS 匯入：{(t.stdout or '').strip()[-300:]} {(t.stderr or '').strip()[-300:]}")
            if t.returncode != 0:
                raise RuntimeError("TGOS 結果檔匯入失敗（檔案留在原處，下次再試）")

        if not tgos_only:
            # 補齊歷史文章時一次最多讀 150 分鐘，沒讀完下次開 Claude 會接著讀
            r = subprocess.run([sys.executable, "pipeline/collect.py", "--time-budget", "150"], cwd=REPO,
                               capture_output=True, text=True, encoding="utf-8", env=env)
            log(f"蒐集結果：{(r.stdout or '').strip()[-400:]} {(r.stderr or '').strip()[-300:]}")
            if r.returncode != 0:
                raise RuntimeError("collect.py 執行失敗")

        # 依最新資料準備下一批要上傳 TGOS 的地址
        TGOS_DIR.mkdir(parents=True, exist_ok=True)
        TGOS_IN.mkdir(exist_ok=True)
        (TGOS_DIR / "使用說明.txt").write_text(TGOS_README, encoding="utf-8-sig")
        e = subprocess.run([sys.executable, "pipeline/tgos.py", "export", str(TGOS_OUT)], cwd=REPO,
                           capture_output=True, text=True, encoding="utf-8", env=env)
        log(f"TGOS 匯出：{(e.stdout or '').strip()[-200:]} {(e.stderr or '').strip()[-300:]}")

        v = subprocess.run([sys.executable, "scripts/validate_data.py", "--compare-git"], cwd=REPO, capture_output=True,
                           text=True, encoding="utf-8", env=env)
        if v.returncode != 0:
            raise RuntimeError(f"資料驗證失敗，不上傳：{v.stdout[-300:]}")

        if not git("status", "--porcelain").stdout.strip():
            log("沒有新資料")
        else:
            git("add", "data", "pipeline")
            msg = "門牌座標更新（TGOS）" if tgos_only else "部落格資料更新（本機）"
            git("commit", "-q", "-m", f"{msg}{datetime.now():%Y-%m-%d}")
            if git("push", "-q", check=False).returncode != 0:
                git("pull", "-q", "--rebase", "origin", "main")
                git("push", "-q")
            log("已上傳新資料，網站會在幾分鐘內更新")
        # 上傳成功後才把結果檔移走（失敗的話留著，下次再匯入）
        if results:
            TGOS_DONE.mkdir(parents=True, exist_ok=True)
            for f in results:
                f.replace(TGOS_DONE / f.name)
        if not tgos_only:
            STAMP.write_text(datetime.now().isoformat())
    except Exception as e:  # 失敗只記錄，不影響使用 Claude
        log(f"錯誤：{e}")
    finally:
        LOCK.unlink(missing_ok=True)


def main() -> None:
    if "--run" in sys.argv:
        run_update(tgos_only="--tgos-only" in sys.argv)
        return
    HOME.mkdir(parents=True, exist_ok=True)
    mode = []
    if "--force" not in sys.argv and STAMP.exists():
        try:
            last = datetime.fromisoformat(STAMP.read_text().strip())
            if (datetime.now() - last).total_seconds() < MIN_HOURS * 3600:
                if not tgos_results():
                    return
                mode = ["--tgos-only"]  # 有新的 TGOS 結果檔：只匯入，不重跑部落格
        except ValueError:
            pass
    # 以獨立背景程序執行，Claude 不需等待
    flags = 0
    if os.name == "nt":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
    subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--run", *mode], creationflags=flags,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     close_fds=True, cwd=str(HOME))


if __name__ == "__main__":
    main()
