import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** 「安裝 App」：Android／電腦 Chrome 直接跳出安裝；iPhone 顯示加到主畫面的步驟 */
export default function InstallButton() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone());
  const [guide, setGuide] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;
  const ios = isIOS();
  if (!prompt && !ios) return null; // 瀏覽器不支援安裝（或已安裝）就不顯示

  return (
    <>
      <button
        className="install-btn"
        onClick={async () => {
          if (prompt) {
            await prompt.prompt();
            const r = await prompt.userChoice;
            if (r.outcome === 'accepted') setInstalled(true);
            setPrompt(null);
          } else {
            setGuide(true);
          }
        }}
      >
        📲 安裝 App
      </button>
      {guide && (
        <div className="modal-bg" onClick={() => setGuide(false)}>
          <div className="modal install-guide" onClick={(e) => e.stopPropagation()}>
            <div className="card-head">
              <h2>安裝到 iPhone</h2>
              <button className="icon-btn" onClick={() => setGuide(false)} aria-label="關閉">✕</button>
            </div>
            <ol>
              <li>請用 <b>Safari</b> 開啟本頁（LINE、FB 內建瀏覽器無法安裝，請先「用 Safari 開啟」）</li>
              <li>點下方的 <b>分享</b> 按鈕 <span className="ios-share">⎋↑</span></li>
              <li>往下滑，選 <b>「加入主畫面」</b></li>
              <li>按右上角 <b>「新增」</b>，主畫面就會出現「探索地圖」圖示</li>
            </ol>
            <p className="muted">安裝後從主畫面開啟，會以全螢幕 App 執行，並自動更新到最新版。</p>
          </div>
        </div>
      )}
    </>
  );
}
