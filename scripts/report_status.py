"""第六階段：資料更新出錯時開 GitHub Issue 通知（GitHub 會寄信給倉庫擁有者）。

在 GitHub Actions 執行：python scripts/report_status.py
- status.json 有錯誤 → 開一個「資料更新警告」Issue（已有未關閉的就加留言，不重複開）
- 沒有錯誤 → 自動關閉先前的警告 Issue
需要 gh CLI（Actions 內建）與 GH_TOKEN。
"""
import json
import subprocess
import sys
from pathlib import Path

STATUS = Path(__file__).resolve().parent.parent / "data" / "status.json"
TITLE = "資料更新警告"


def gh(*args: str) -> str:
    return subprocess.run(["gh", *args], capture_output=True, text=True, check=True).stdout


def main() -> int:
    extra = sys.argv[1:]  # 其他步驟的失敗訊息（例如資料驗證失敗）
    status = json.loads(STATUS.read_text(encoding="utf-8")) if STATUS.exists() else {}
    errors = list(status.get("errors", [])) + extra
    found = json.loads(gh("issue", "list", "--state", "open", "--search", f"{TITLE} in:title", "--json", "number,title"))
    issue = next((i["number"] for i in found if i["title"] == TITLE), None)
    if errors:
        body = f"執行時間：{status.get('run_at', '未知')}\n\n" + "\n".join(f"- {e}" for e in errors[:50])
        body += "\n\n（修正後下一次執行成功，這個 Issue 會自動關閉。）"
        if issue:
            gh("issue", "comment", str(issue), "--body", body)
        else:
            gh("issue", "create", "--title", TITLE, "--body", body)
        print(f"已回報 {len(errors)} 個問題")
    elif issue:
        gh("issue", "close", str(issue), "--comment", f"{status.get('run_at', '')} 執行正常，自動關閉。")
        print("已關閉先前的警告")
    return 0


if __name__ == "__main__":
    sys.exit(main())
