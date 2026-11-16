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
  const peopleAdmin = context.grants.some(
    (g) =>
      g.system_code === "training" && (g.role === "admin" || g.role === "hr"),
  );
  return (
    <div className="training-app">
      <header className="portal-header">
        <a className="portal-brand" href="#/portal">
          <span>R</span>
          <strong>
            RMBotics Hub<small>員工數位工作台</small>
          </strong>
        </a>
        <nav>
          <a href="#/portal">返回員工入口</a>
          {context.systems.some((s) => s.code === "training") && (
            <a href="#/training">我的學習</a>
          )}
          {peopleAdmin && <a href="#/portal/admin">平台管理</a>}
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
      {route.startsWith("#/portal/admin") ? (
        peopleAdmin ? (
          <TrainingAdmin context={context} />
        ) : (
          <p role="alert">尚未取得平台人員管理權限。</p>
        )
      ) : route.startsWith("#/training") ? (
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
          <section className="portal-welcome">
            <div>
              <p className="eyebrow">WORKSPACE / HOME</p>
              <h1>{context.employee.name}，開始今天的工作</h1>
              <p>已使用公司身分安全登入。從下方開啟你的應用程式，不需要再次驗證。</p>
            </div>
            <span className="workspace-status"><i /> 系統連線正常</span>
          </section>
          <div className="portal-section-heading">
            <div><span>YOUR APPLICATIONS</span><h2>我的應用程式</h2></div>
            <small>{context.systems.length} 個可用服務</small>
          </div>
          <div className="system-grid">
            {context.systems.map((system, i) => (
              <a className={`system-tile system-${system.code}`} key={system.code} href={system.entry}>
                <div className="tile-top">
                  <span className="system-icon" aria-hidden="true">{system.code === "training" ? "學" : "選"}</span>
                  <span className="tile-number">APP / 0{i + 1}</span>
                </div>
                <h2>{system.name}</h2>
                <p>
                  {system.code === "training"
                    ? "接續課程、完成測驗，查看自己的學習紀錄。"
                    : "參與活動、提名與投票，查看採購及回顧。"}
                </p>
                <strong className="tile-cta">開啟應用程式 <span>↗</span></strong>
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
