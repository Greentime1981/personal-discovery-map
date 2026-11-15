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


def log(msg: str) -> None:
    HOME.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}\n")


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    r = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, encoding="utf-8")
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} 失敗：{r.stderr.strip()[:300]}")
    return r


def run_update() -> None:
    HOME.mkdir(parents=True, exist_ok=True)
    if LOCK.exists() and time.time() - LOCK.stat().st_mtime < 3 * 3600:
        log("已有更新在執行中，略過")
        return
    LOCK.write_text(str(os.getpid()))
    try:
        if not (REPO / ".git").exists():
            log("第一次執行：下載專案")
            subprocess.run(["git", "clone", "-q", REPO_URL, str(REPO)], check=True, capture_output=True)
            git("config", "user.name", "underarmy1981")
            git("config", "user.email", "underarmy1981@gmail.com")
        git("fetch", "-q", "origin")
        git("reset", "-q", "--hard", "origin/main")  # 這是專用資料夾，直接對齊 GitHub 最新版

        env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
        env.pop("YOUTUBE_API_KEY", None)  # YouTube 由 GitHub 每日處理，本機只跑部落格
        r = subprocess.run([sys.executable, "pipeline/collect.py"], cwd=REPO, capture_output=True,
                           text=True, encoding="utf-8", env=env)
        log(f"蒐集結果：{(r.stdout or '').strip()[-400:]} {(r.stderr or '').strip()[-300:]}")
        if r.returncode != 0:
            raise RuntimeError("collect.py 執行失敗")
        v = subprocess.run([sys.executable, "scripts/validate_data.py", "--compare-git"], cwd=REPO, capture_output=True,
                           text=True, encoding="utf-8", env=env)
        if v.returncode != 0:
            raise RuntimeError(f"資料驗證失敗，不上傳：{v.stdout[-300:]}")

        if not git("status", "--porcelain").stdout.strip():
            log("沒有新資料")
        else:
            git("add", "public/data", "pipeline")
            git("commit", "-q", "-m", f"部落格資料更新（本機）{datetime.now():%Y-%m-%d}")
            if git("push", "-q", check=False).returncode != 0:
                git("pull", "-q", "--rebase", "origin", "main")
                git("push", "-q")
            log("已上傳新資料，網站會在幾分鐘內更新")
        STAMP.write_text(datetime.now().isoformat())
    except Exception as e:  # 失敗只記錄，不影響使用 Claude
        log(f"錯誤：{e}")
    finally:
        LOCK.unlink(missing_ok=True)


def main() -> None:
    if "--run" in sys.argv:
        run_update()
        return
    HOME.mkdir(parents=True, exist_ok=True)
    if "--force" not in sys.argv and STAMP.exists():
        try:
            last = datetime.fromisoformat(STAMP.read_text().strip())
            if (datetime.now() - last).total_seconds() < MIN_HOURS * 3600:
                return
        except ValueError:
            pass
    # 以獨立背景程序執行，Claude 不需等待
    flags = 0
    if os.name == "nt":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
    subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--run"], creationflags=flags,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     close_fds=True, cwd=str(HOME))


if __name__ == "__main__":
    main()
