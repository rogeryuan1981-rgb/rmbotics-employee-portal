import { supabase } from "../lib/supabase";
export function PendingPortal({ name }: { name: string }) {
  return (
    <div className="training-app hub-surface">
      <header className="portal-header">
        <a className="portal-brand" href="#/portal">
          <span>員</span>
          <strong>
            員工共用入口<small>學習・協作・日常</small>
          </strong>
        </a>
        <nav>
          <span>{name}</span>
          <button
            onClick={() => void supabase.auth.signOut({ scope: "local" })}
          >
            登出
          </button>
        </nav>
      </header>
      <main className="portal-home">
        <p className="eyebrow">EMPLOYEE PORTAL</p>
        <h1>{name}，歡迎回來</h1>
        <p>零食投票已開放；教育訓練將於平台初始化完成後開放。</p>
        <div className="system-grid">
          <a className="system-tile" href="#/">
            <span className="tile-number">01</span>
            <h2>零食投票</h2>
            <p>參與提名與投票，查看採購及活動回顧。</p>
            <strong>進入系統 →</strong>
          </a>
          <article className="system-tile" aria-label="教育訓練尚未開放">
            <span className="tile-number">02</span>
            <h2>教育訓練</h2>
            <p>尚待管理員完成平台初始化，目前未開放學習與測驗。</p>
            <span className="badge">尚未開放</span>
          </article>
        </div>
      </main>
    </div>
  );
}
