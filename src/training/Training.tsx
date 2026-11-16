import { useCallback, useEffect, useRef, useState } from "react";
import { api, dateTime, deadlineLabel, duration } from "./api";
import type { CourseContent, Requirement, Notification, Paper } from "./types";
import { Materials } from "./Materials";
import { markSharedActivity } from "../lib/shared-session";
type Detail = {
  requirement: Requirement;
  course: CourseContent;
  is_open: boolean;
  course_active: boolean;
  positions: { material_id: string; position: number }[];
  sources: Requirement["sources"];
  server_now: string;
};
function status(r: Requirement) {
  if (r.completed_at)
    return new Date(r.completed_at) >= new Date(r.completed_due || r.due)
      ? "逾期完成"
      : "準時完成";
  if (r.lifecycle === "cancelled") return "已取消列管";
  if (r.lifecycle === "exempt") return "當年度免修";
  if (r.course_active === false) return "課程已停用";
  if (!r.is_open) return "課程未開放、未完成";
  if (Date.now() >= new Date(r.due).getTime()) return "逾期未完成";
  if (Number(r.seconds) >= r.rules.seconds) return "可開始測驗";
  return Number(r.seconds) > 0 ? "學習中" : "尚未開始學習";
}
export function Training({ route }: { route: string }) {
  const [data, setData] = useState<{
    requirements: Requirement[];
    notifications: Notification[];
  } | null>(null);
  const [error, setError] = useState("");
  const id = route.split("/")[2];
  useEffect(() => {
    if (id) return;
    let active = true;
    void api<{ requirements: Requirement[]; notifications: Notification[] }>(
      "mine",
    )
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  if (id) return <Study key={id} id={id} />;
  return (
    <main className="training-main">
      <p className="eyebrow">MY LEARNING</p>
      <h1>我的學習</h1>
      <p>依期限完成學習與測驗。這裡只顯示您自己的指派與紀錄。</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p>正在載入…</p>}
      <div className="learning-stats">
        <span>
          待完成{" "}
          <strong>
            {data?.requirements.filter(
              (r) => !r.completed_at && r.lifecycle === "active",
            ).length ?? 0}
          </strong>
        </span>
        <span>
          已完成{" "}
          <strong>
            {data?.requirements.filter((r) => r.completed_at).length ?? 0}
          </strong>
        </span>
      </div>
      <div className="learning-layout">
        <section className="learning-courses" aria-label="我的課程">
          <div className="course-grid">
            {data?.requirements.map((r) => (
              <article className="course-card" key={r.id}>
                <div className="badge">{status(r)}</div>
                <h2>{r.course?.title}</h2>
                <p>
                  {r.cycle === "once" ? "一次性" : `${r.cycle} 年度`} ·{" "}
                  {r.batch === "normal" ? "一般訓練" : `重訓 ${r.batch}`}
                </p>
                <p>截止：{deadlineLabel(r.due)}</p>
                <progress
                  value={Math.min(Number(r.seconds), r.rules.seconds)}
                  max={r.rules.seconds}
                />
                <p>
                  已保存 {duration(r.seconds)}／要求 {duration(r.rules.seconds)}
                </p>
                {r.result?.score !== null && r.result?.score !== undefined && (
                  <p>成績：{Number(r.result.score).toFixed(2)} 分</p>
                )}
                {r.conflict_pending && (
                  <p className="warning">
                    開課期間與個人期限有衝突，管理員處理中。
                  </p>
                )}
                <a className="primary-link" href={`#/training/${r.id}`}>
                  {r.completed_at ? "查看完成紀錄" : "進入課程"} →
                </a>
              </article>
            ))}
          </div>
          {data?.requirements.length === 0 && (
            <div className="empty-state">目前沒有指派課程。</div>
          )}
        </section>
        <aside className="panel learning-notifications">
          <h2>我的通知</h2>
          {data?.notifications.length === 0 && <p>目前沒有通知。</p>}
          {data?.notifications.map((n) => (
            <div className="notification" key={n.id}>
              <a href={n.body.entry}>
                {n.body.title} ·{" "}
                {n.kind === "assigned"
                  ? "新增訓練"
                  : n.kind === "retrain"
                    ? "重新受訓"
                    : n.kind === "course_updated"
                      ? "課程內容已更新"
                    : n.kind === "due"
                      ? "即將到期"
                      : "逾期提醒"}
              </a>
              {!n.read_at && (
                <button
                  onClick={async () => {
                    await api("read_notification", { id: n.id });
                    setData((d) =>
                      d
                        ? {
                            ...d,
                            notifications: d.notifications.map((x) =>
                              x.id === n.id
                                ? { ...x, read_at: new Date().toISOString() }
                                : x,
                            ),
                          }
                        : d,
                    );
                  }}
                >
                  標示已讀
                </button>
              )}
            </div>
          ))}
        </aside>
      </div>
    </main>
  );
}
function Study({ id }: { id: string }) {
  const [data, setData] = useState<Detail | null>(null);
  const [materialId, setMaterialId] = useState("");
  const [error, setError] = useState("");
  const [mediaError, setMediaError] = useState("");
  const [retry, setRetry] = useState(0);
  const [saved, setSaved] = useState(0);
  const [timing, setTiming] = useState("尚未開始計時");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<Paper[]>([]);
  const media = useRef({ loaded: false, playing: false });
  const activity = useRef(true);
  const position = useRef(0);
  const beatNow = useRef<(() => void) | null>(null);
  const load = useCallback(async () => {
    const d = await api<Detail>("requirement", { id });
    setData(d);
    setSaved(Number(d.requirement.seconds));
    setMaterialId((m) =>
      d.course.materials.some((x) => x.id === m)
        ? m
        : d.course.materials[0]?.id || "",
    );
  }, [id]);
  const loadHistory = useCallback(
    () => api<Paper[]>("exam_history", { id }).then(setHistory),
    [id],
  );
  useEffect(() => {
    void load()
      .then(loadHistory)
      .catch((e) => setError(e.message));
  }, [load, loadHistory]);
  const material = data?.course.materials.find((x) => x.id === materialId);
  useEffect(() => {
    setMediaError("");
    activity.current = true;
    position.current =
      Number(
        data?.positions.find((p) => p.material_id === materialId)?.position,
      ) || 0;
  }, [materialId, data?.positions]);
  useEffect(() => {
    if (!running || !materialId) return;
    let cancelled = false;
    let seq = 0;
    let token = "";
    let inFlight = false;
    const beat = async () => {
      if (cancelled || !token || inFlight) return;
      inFlight = true;
      const interacted = activity.current;
      activity.current = false;
      try {
        const v = await api<{
          seconds: number;
          eligible: boolean;
          reason: string;
        }>("heartbeat", {
          id,
          token,
          seq: ++seq,
          visible:
            document.visibilityState === "visible" && document.hasFocus(),
          loaded: media.current.loaded,
          playing: media.current.playing,
          interacted,
          position: position.current,
        });
        if (!cancelled) {
          setSaved(Number(v.seconds));
          setTiming(v.reason);
          if (v.eligible) markSharedActivity();
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setTiming("尚未保存新時間，計時已停止；請重新開始。");
          setRunning(false);
        }
      } finally {
        inFlight = false;
      }
    };
    beatNow.current = () => void beat();
    void api<{ token: string }>("lease", { id, material_id: materialId })
      .then((l) => {
        if (cancelled) return;
        token = l.token;
        void beat();
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setRunning(false);
        }
      });
    const onActivity = () => {
      activity.current = true;
    };
    const visible = () => {
      void beat();
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    events.forEach((e) =>
      window.addEventListener(e, onActivity, { passive: true, capture: true }),
    );
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("blur", visible);
    const timer = window.setInterval(() => void beat(), 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      beatNow.current = null;
      events.forEach((e) =>
        window.removeEventListener(e, onActivity, { capture: true }),
      );
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("blur", visible);
    };
  }, [id, materialId, running, retry]);
  if (!data)
    return (
      <main className="training-main">
        <p role="alert">{error || "正在載入課程…"}</p>
      </main>
    );
  const r = data.requirement;
  const learnable = data.is_open && r.lifecycle === "active" && !r.completed_at;
  const remaining = Math.max(0, r.rules.seconds - saved);
  return (
    <main className="training-main">
      <a href="#/training">← 返回我的學習</a>
      <p className="eyebrow">COURSE</p>
      <h1>{data.course.title}</h1>
      <div className="badge">
        {status({
          ...r,
          is_open: data.is_open,
          course_active: data.course_active,
          seconds: saved,
        })}
      </div>
      <p>
        完成條件：本次有效學習 {duration(r.rules.seconds)}
        {r.batch !== "normal" && r.rules.retest === false
          ? "，本次免重考"
          : `，且測驗達 ${data.course.pass_score} 分`}
        。
      </p>
      <p>
        個人截止：{deadlineLabel(r.due)} ·{" "}
        {r.cycle === "once" ? "一次性" : r.cycle + " 年度"}
      </p>
      <p>
        指派來源：
        {data.sources
          .map((s) => s.label + (s.active ? "" : "（已失效）"))
          .join("、")}
      </p>
      {r.cancellation_reason && <p>{r.cancellation_reason}</p>}
      {r.conflict_pending && (
        <p className="warning">
          開課期間與個人期限衝突，管理員處理中；系統不會自動縮短您的期限。
        </p>
      )}
      {r.completed_at && (
        <p className="success">完成時間：{dateTime(r.completed_at)}</p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="study-layout">
        <aside className="panel material-menu">
          <h2>課程教材</h2>
          {data.course.materials.map((m) => (
            <button
              className={m.id === materialId ? "selected" : ""}
              key={m.id}
              onClick={() => {
                setMaterialId(m.id);
                setRunning(false);
                setTiming("已切換教材，請開始計時");
              }}
            >
              {m.title}
              <small>
                {m.kind === "text"
                  ? "網頁文字"
                  : m.kind === "pdf"
                    ? "PDF 文件"
                    : "YouTube 影片"}
              </small>
            </button>
          ))}
          <p>有效時間合計達標即可，不要求每份教材分別讀滿。</p>
        </aside>
        <section className="panel reading-panel">
          <h2>{material?.title}</h2>
          <div className="saved-time" aria-live="polite">
            <strong>已保存 {duration(saved)}</strong>
            <span>
              {remaining > 0 ? `尚需 ${duration(remaining)}` : "時數已達標"}
            </span>
            <small>{timing}</small>
          </div>
          <div className="button-row">
            <button
              disabled={!learnable || running}
              onClick={() => {
                setError("");
                setRunning(true);
                setTiming("正在連線確認計時…");
              }}
            >
              開始／接續計時
            </button>
            <button
              disabled={!running}
              onClick={() => {
                setRunning(false);
                setTiming("已手動暫停；顯示最後保存時間");
              }}
            >
              暫停計時
            </button>
          </div>
          {!data.is_open && (
            <p className="warning">
              課程尚未開放或已結束，停止新學習及新測驗；已開始試卷仍可完成。
            </p>
          )}
          {mediaError && (
            <p className="error">
              {mediaError}{" "}
              <button onClick={() => setRetry((n) => n + 1)}>重試</button>
            </p>
          )}
          {material && (
            <Materials
              key={`${material.id}-${retry}`}
              material={material}
              position={
                Number(
                  data.positions.find((p) => p.material_id === material.id)
                    ?.position,
                ) || 0
              }
              onPosition={(n) => {
                position.current = n;
              }}
              onState={(loaded, playing, msg) => {
                media.current = { loaded, playing };
                setMediaError(msg || "");
                beatNow.current?.();
              }}
            />
          )}
          <button
            className="text-button"
            onClick={async () => {
              const message = prompt("請說明教材問題（不會自動完成課程）");
              if (message)
                try {
                  await api("issue", { id, material_id: materialId, message });
                  setTiming("已回報教材問題，請等候管理員處理。");
                } catch (e) {
                  setError((e as Error).message);
                }
            }}
          >
            回報教材問題
          </button>
        </section>
      </div>
      <Exam
        id={id}
        canStart={
          learnable &&
          remaining === 0 &&
          !(r.batch !== "normal" && r.rules.retest === false)
        }
        remaining={remaining}
        history={history}
        onChange={() => {
          void load();
          void loadHistory();
        }}
        onMaterial={(mid) => {
          setMaterialId(mid);
          setRunning(false);
          document
            .querySelector(".reading-panel")
            ?.scrollIntoView({ behavior: "smooth" });
        }}
      />
    </main>
  );
}
function Exam({
  id,
  canStart,
  remaining,
  history,
  onChange,
  onMaterial,
}: {
  id: string;
  canStart: boolean;
  remaining: number;
  history: Paper[];
  onChange: () => void;
  onMaterial: (id: string) => void;
}) {
  const [paper, setPaper] = useState<Paper | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [offset, setOffset] = useState(0);
  const submitRef = useRef(false);
  const live = history.find((p) => !p.submitted_at);
  useEffect(() => {
    if (live && !paper) {
      setPaper(live);
      setOffset(new Date(live.server_now).getTime() - Date.now());
    }
  }, [live, paper]);
  const submit = useCallback(async () => {
    if (!paper || submitRef.current) return;
    submitRef.current = true;
    setBusy(true);
    try {
      setPaper(await api<Paper>("exam_submit", { id, paper_id: paper.id }));
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      submitRef.current = false;
    }
  }, [paper, id, onChange]);
  useEffect(() => {
    const t = window.setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = paper?.expires_at
    ? Math.max(
        0,
        Math.ceil(
          (new Date(paper.expires_at).getTime() - clock - offset) / 1000,
        ),
      )
    : null;
  useEffect(() => {
    if (left === 0 && paper && !paper.submitted_at && !busy) void submit();
  }, [left, paper, busy, submit]);
  async function start() {
    setBusy(true);
    setError("");
    try {
      const p = await api<Paper>("exam_start", { id });
      setPaper(p);
      setOffset(new Date(p.server_now).getTime() - Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function answer(qid: string, value: number[]) {
    if (!paper) return;
    const previous = paper;
    setPaper({ ...paper, answers: { ...paper.answers, [qid]: value } });
    setBusy(true);
    setError("");
    try {
      setPaper(
        await api<Paper>("exam_save", {
          id,
          paper_id: paper.id,
          question_id: qid,
          answer: value,
        }),
      );
    } catch (e) {
      setPaper(previous);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel exam-panel">
      <h2>課程測驗</h2>
      {remaining > 0 && (
        <p>尚需學習 {duration(remaining)}，達標後才可開始新測驗。</p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {(!paper || paper.submitted_at) && (
        <button disabled={!canStart || busy} onClick={() => void start()}>
          {paper?.submitted_at && !paper.passed ? "重新抽題測驗" : "開始測驗"}
        </button>
      )}
      {paper && (
        <>
          <h3>
            {paper.submitted_at
              ? `本次 ${Number(paper.score).toFixed(2)} 分 · ${paper.passed ? "及格" : "未及格"}`
              : "測驗進行中"}
          </h3>
          <p>
            {!paper.submitted_at
              ? left === null
                ? "不限時"
                : `剩餘 ${Math.floor(left / 60)} 分 ${left % 60} 秒；離開仍會倒數`
              : `交卷：${dateTime(paper.submitted_at)}`}{" "}
            · 及格 {paper.pass_score} 分
          </p>
          {busy && <p role="status">正在保存，請稍候…</p>}
          {paper.questions.map((q, index) => (
            <fieldset key={q.id} disabled={!!paper.submitted_at || busy}>
              <legend>
                {index + 1}. {q.prompt}（
                {q.kind === "multiple" ? "複選" : "單選／是非"}）
              </legend>
              {q.options.map((option, i) => (
                <label className="answer-option" key={i}>
                  <input
                    type={q.kind === "multiple" ? "checkbox" : "radio"}
                    name={q.id}
                    checked={(paper.answers[q.id] || []).includes(i)}
                    onChange={() => {
                      const selected = paper.answers[q.id] || [];
                      void answer(
                        q.id,
                        q.kind === "multiple"
                          ? selected.includes(i)
                            ? selected.filter((n) => n !== i)
                            : [...selected, i]
                          : [i],
                      );
                    }}
                  />
                  {option}
                </label>
              ))}
              {paper.submitted_at && (
                <div className="answer-feedback">
                  <p>
                    {paper.wrong_ids?.includes(q.id)
                      ? "此題未得分"
                      : "此題答對"}
                  </p>
                  {paper.passed && (
                    <p>
                      正確答案：{q.correct?.map((n) => q.options[n]).join("、")}
                      <br />
                      {q.explanation}
                    </p>
                  )}
                  <button
                    disabled={false}
                    type="button"
                    onClick={() => onMaterial(q.material_id)}
                  >
                    查看對應教材{q.reference ? " · " + q.reference : ""}
                  </button>
                </div>
              )}
            </fieldset>
          ))}
          {!paper.submitted_at && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                if (confirm("確認交卷？交卷後不能修改本次作答。"))
                  void submit();
              }}
            >
              交卷
            </button>
          )}
        </>
      )}
      <h3>歷次測驗</h3>
      {history.length === 0 && <p>尚無測驗紀錄。</p>}
      {history.map((p) => (
        <div className="history-row" key={p.id}>
          <span>{dateTime(p.started_at)}</span>
          <span>
            {p.submitted_at
              ? `${Number(p.score).toFixed(2)} 分 · ${p.passed ? "及格" : "未及格"}`
              : "進行中"}
          </span>
          <button onClick={() => setPaper(p)}>查看本卷</button>
        </div>
      ))}
    </section>
  );
}
