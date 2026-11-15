import { useEffect, useState } from "react";
import { api, PortalApiError } from "./api";
import type { Context } from "./types";
import { Training } from "./Training";
import { TrainingAdmin } from "./TrainingAdmin";
import { supabase } from "../lib/supabase";
import "./training.css";
export function Portal({
  route,
  context,
}: {
  route: string;
  context: Context;
}) {
  const admin = context.grants.some((g) => g.system_code === "training");
  return (
    <div className="training-app">
      <header className="portal-header">
        <a className="portal-brand" href="#/portal">
          <span>員</span>
          <strong>
            員工共用入口<small>學習・協作・日常</small>
          </strong>
        </a>
        <nav>
          <a href="#/portal">返回員工入口</a>
          {context.systems.some((s) => s.code === "training") && (
            <a href="#/training">我的學習</a>
          )}
          {admin && <a href="#/training/admin">訓練後台</a>}
          <span>{context.employee.name}</span>
          <button
            onClick={() => void supabase.auth.signOut({ scope: "local" })}
          >
            登出
          </button>
        </nav>
      </header>
      {import.meta.env.VITE_LOCAL_TEST === "true" && (
        <aside className="local-banner">
          本機測試環境｜僅使用虛構員工；驗證碼與通知存至本機郵件匣，不寄出。
        </aside>
      )}
      {route.startsWith("#/training") ? (
        context.systems.some((s) => s.code === "training") ? (
          route.startsWith("#/training/admin") ? (
            <TrainingAdmin context={context} />
          ) : (
            <Training route={route} />
          )
        ) : (
          <p role="alert">尚未取得教育訓練使用資格。</p>
        )
      ) : (
        <main className="portal-home">
          <p className="eyebrow">EMPLOYEE PORTAL</p>
          <h1>{context.employee.name}，歡迎回來</h1>
          <p>選擇要使用的系統。切換系統沿用目前登入身分。</p>
          <div className="system-grid">
            {context.systems.map((system, i) => (
              <a className="system-tile" key={system.code} href={system.entry}>
                <span className="tile-number">0{i + 1}</span>
                <h2>{system.name}</h2>
                <p>
                  {system.code === "training"
                    ? "接續課程、完成測驗，查看自己的學習紀錄。"
                    : "參與活動、提名與投票，查看採購及回顧。"}
                </p>
                <strong>進入系統 →</strong>
              </a>
            ))}
          </div>
          {!context.systems.length && (
            <p>目前尚未開通系統使用資格，請洽管理員。</p>
          )}
        </main>
      )}
    </div>
  );
}
export function usePortalContext(userId: string | undefined) {
  const [context, setContext] = useState<Context | null>(null);
  const [error, setError] = useState("");
  const [backendMissing, setBackendMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    setContext(null);
    setError("");
    setBackendMissing(false);
    if (!userId) return;
    const load = () =>
      api<Context>("context")
        .then((c) => {
          if (alive) {
            setContext(c);
            setError("");
            setBackendMissing(false);
          }
        })
        .catch((e) => {
          if (alive) {
            setContext(null);
            setBackendMissing(
              e instanceof PortalApiError &&
                e.code === "PGRST202" &&
                e.message.includes("portal_rpc"),
            );
            setError(e.message);
          }
        });
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [userId]);
  return { context, error, backendMissing };
}
