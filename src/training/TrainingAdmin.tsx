import { useCallback, useEffect, useState } from "react";
import { api, dateTime, deadlineLabel, duration } from "./api";
import type {
  AdminData,
  Context,
  Course,
  Job,
  Person,
  Deadline,
  Link,
  Settings,
  System,
} from "./types";
import {
  CourseEditor,
  JobEditor,
  DeadlineEditor,
  LinkEditor,
  defaultDeadline,
} from "./Editors";
import { exportWorkbook, importTemplate, readImport } from "./workbooks";
type Tab =
  | "overview"
  | "people"
  | "jobs"
  | "courses"
  | "assign"
  | "reports"
  | "settings";
export function TrainingAdmin({ context }: { context: Context }) {
  const [data, setData] = useState<AdminData | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<
    | { kind: "course"; item: Course | null }
    | { kind: "job"; item: Job | null }
    | null
  >(null);
  const admin = context.grants.some(
    (g) => g.system_code === "training" && g.role === "admin",
  );
  const people =
    admin ||
    context.grants.some((g) => g.system_code === "training" && g.role === "hr");
  const load = useCallback(
    () =>
      api<AdminData>("admin")
        .then(setData)
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function act(action: string, p: object) {
    setError("");
    try {
      await api(action, p);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!context.grants.some((g) => g.system_code === "training"))
    return (
      <main className="training-main">
        <h1>無教育訓練管理權限</h1>
      </main>
    );
  if (!data)
    return (
      <main className="training-main">
        <p role="alert">{error || "正在載入管理範圍…"}</p>
      </main>
    );
  const department = (id: string | null) =>
    data.departments.find((d) => d.id === id)?.name || "未設定";
  const person = (id: string) =>
    data.employees.find((e) => e.id === id)?.name || id;
  return (
    <main className="training-main">
      <p className="eyebrow">TRAINING MANAGEMENT</p>
      <h1>教育訓練管理後台</h1>
      <p>目前資料依授權部門顯示。個人學習與管理資料分開。</p>
      <nav className="admin-tabs">
        {(
          [
            ["overview", "管理總覽"],
            ...(people ? [["people", "員工名冊"]] : []),
            ["jobs", "職務與職責"],
            ...(admin ? [["courses", "課程與題庫"]] : []),
            ["assign", "指派與期限"],
            ["reports", "報表"],
            ...(admin ? [["settings", "權限與設定"]] : []),
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            className={tab === id ? "selected" : ""}
            key={id}
            onClick={() => {
              setTab(id);
              setEditing(null);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {tab === "overview" && (
        <>
          <div className="learning-stats">
            <span>
              管理範圍員工 <strong>{data.employees.length}</strong>
            </span>
            <span>
              未完成要求{" "}
              <strong>
                {
                  data.requirements.filter(
                    (r) => r.lifecycle === "active" && !r.completed_at,
                  ).length
                }
              </strong>
            </span>
            <span>
              期限衝突{" "}
              <strong>
                {data.requirements.filter((r) => r.conflict_pending).length}
              </strong>
            </span>
          </div>
          <section className="panel">
            <h2>待處理期限衝突</h2>
            {data.requirements
              .filter((r) => r.conflict_pending)
              .map((r) => (
                <div className="history-row" key={r.id}>
                  <span>
                    {person(r.employee_id)} · {r.course_title}
                  </span>
                  <button
                    onClick={() => {
                      const reason = prompt(
                        "請填保留開課期間與期限衝突的原因；如需修正，請至課程或期限管理調整。",
                      );
                      if (reason) void act("conflict", { id: r.id, reason });
                    }}
                  >
                    保留衝突並記錄原因
                  </button>
                </div>
              ))}
            <h2>資料待補</h2>
            {data.employees
              .filter((e) => !e.hire_date)
              .map((e) => (
                <p key={e.id}>{e.name}：缺少到職日，無法推算到職期限。</p>
              ))}
          </section>
          {admin && (
            <section className="panel">
              <h2>教材問題回報</h2>
              {data.issues.map((i) => (
                <div className="history-row" key={i.id}>
                  <span>
                    {i.message} · {i.resolution || "尚未處理"}
                  </span>
                  <button
                    onClick={() => {
                      const resolution = prompt("請填處理結果");
                      if (resolution)
                        void act("issue_resolve", { id: i.id, resolution });
                    }}
                  >
                    記錄處理結果
                  </button>
                </div>
              ))}
            </section>
          )}
        </>
      )}
      {tab === "people" && (
        <>
          <People
            data={data}
            admin={admin}
            onSave={(p) => act("person_save", p)}
          />
          <RosterImport onDone={load} />
        </>
      )}
      {tab === "courses" && (
        <>
          <div className="button-row">
            <button
              className="primary"
              onClick={() => setEditing({ kind: "course", item: null })}
            >
              新增課程
            </button>
          </div>
          <div className="course-grid">
            {data.courses.map((c) => (
              <article className="course-card" key={c.id}>
                <span className="badge">
                  {!c.active ? "已停用" : c.published ? "已發布" : "草稿"}
                </span>
                <h2>{c.draft.title}</h2>
                <p>
                  {c.draft.questions.length} 題 · 要求{" "}
                  {duration(c.draft.seconds)}
                </p>
                <div className="button-row">
                  <button
                    onClick={() => setEditing({ kind: "course", item: c })}
                  >
                    編輯課程／題庫
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const versions = await api<unknown[]>("versions", {
                          kind: "course",
                          id: c.id,
                        });
                        await exportWorkbook(
                          versions as Record<string, unknown>[],
                          "課程發布版本",
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    版本紀錄
                  </button>
                  <button
                    onClick={() => {
                      const reason =
                        prompt("停用會取消既有未完成要求；請填原因");
                      if (reason)
                        void act("course_disable", { id: c.id, reason });
                    }}
                  >
                    停用課程
                  </button>
                  {!c.published && (
                    <button
                      onClick={() => {
                        if (confirm("刪除此未發布草稿？"))
                          void act("course_delete", { id: c.id });
                      }}
                    >
                      刪除草稿
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {editing?.kind === "course" && (
            <CourseEditor
              key={editing.item?.id || "new-course"}
              course={editing.item}
              departments={data.departments}
              done={() => void load()}
            />
          )}
          <Retrain data={data} onSave={(p) => act("retrain", p)} />
        </>
      )}
      {tab === "jobs" && (
        <>
          <div className="button-row">
            {people && (
              <button
                className="primary"
                onClick={() => setEditing({ kind: "job", item: null })}
              >
                新增職務說明書
              </button>
            )}
          </div>
          {data.jobs.map((j) => (
            <section className="panel" key={j.id}>
              <h2>{(j.published || j.draft).name}</h2>
              <p>
                {department(j.department_id)} · 已發布版本 {j.version}
              </p>
              <p>{j.published?.purpose || "尚未發布"}</p>
              <ol>
                {j.published?.duties.map((d) => (
                  <li key={d.id}>{d.text}</li>
                ))}
              </ol>
              <div className="button-row">
                {people && (
                  <button onClick={() => setEditing({ kind: "job", item: j })}>
                    編輯草稿
                  </button>
                )}
                <button
                  onClick={async () => {
                    try {
                      await exportWorkbook(
                        await api<Record<string, unknown>[]>("versions", {
                          kind: "job",
                          id: j.id,
                        }),
                        "職務發布版本",
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  版本紀錄
                </button>
              </div>
              {j.published && (
                <JobLinks
                  job={j}
                  courses={data.courses}
                  onSave={(p) => act("job_training", p)}
                />
              )}
            </section>
          ))}
          {editing?.kind === "job" && (
            <JobEditor
              key={editing.item?.id || "new-job"}
              job={editing.item}
              courses={data.courses}
              departments={data.departments}
              publishable={admin}
              done={() => void load()}
            />
          )}
        </>
      )}
      {tab === "assign" && (
        <>
          <Assignment data={data} onSave={(p) => act("assign", p)} />
          <section className="panel">
            <h2>個別期限與訓練紀錄</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>員工／課程</th>
                    <th>時數</th>
                    <th>原期限／適用期限</th>
                    <th>狀態</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.requirements.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {person(r.employee_id)}
                        <br />
                        {r.course_title}
                        <small>
                          {r.cycle} · {r.batch}
                        </small>
                      </td>
                      <td>
                        {duration(r.seconds)}／{duration(r.rules.seconds)}
                      </td>
                      <td>
                        {deadlineLabel(r.original_due)}
                        <br />
                        {deadlineLabel(r.due)}
                      </td>
                      <td>
                        {r.completed_at
                          ? "已完成"
                          : r.lifecycle === "cancelled"
                            ? "已取消列管"
                            : r.lifecycle === "exempt"
                              ? "年度免修"
                              : Date.now() >= new Date(r.due).getTime()
                                ? "逾期未完成"
                                : "未完成"}
                        {r.ever_overdue && <small>曾逾期</small>}
                      </td>
                      <td>
                        <button
                          onClick={() => {
                            const date = prompt(
                              "調整後截止日期（YYYY-MM-DD）；已完成紀錄僅記錄異動，不改寫完成判定。",
                            );
                            if (!date) return;
                            const reason = prompt("調整原因（必填）");
                            if (reason)
                              void act("deadline", { id: r.id, date, reason });
                          }}
                        >
                          調整期限
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {tab === "reports" && <Reports data={data} />}
      {tab === "settings" && admin && (
        <>
          <section className="panel">
            <h2>部門</h2>
            <p>工作地點與部門分開維護。</p>
            {data.departments.map((d) => (
              <span className="badge" key={d.id}>
                {d.name}
              </span>
            ))}
            <button
              onClick={() => {
                const name = prompt("新增部門名稱");
                if (name) void act("department", { name });
              }}
            >
              新增部門
            </button>
          </section>
          <Permissions data={data} onSave={act} />
          <NotificationSettings
            initial={data.settings!}
            onSave={(p) => act("settings", p)}
          />
          <SystemSettings
            systems={data.systems}
            onSave={(p) => act("system", p)}
          />
        </>
      )}
    </main>
  );
}
function People({
  data,
  admin,
  onSave,
}: {
  data: AdminData;
  admin: boolean;
  onSave: (p: object) => Promise<void>;
}) {
  const empty: Person = {
    id: "",
    name: "",
    email: "",
    hire_date: "",
    department_id: data.departments[0]?.id || "",
    active: true,
    systems: [],
    tenures: [],
  };
  const [p, setP] = useState<Person>(empty);
  const patch = (v: Partial<Person>) => setP((p) => ({ ...p, ...v }));
  return (
    <section className="panel">
      <h2>共用員工名冊</h2>
      <div className="button-row">
        <select
          aria-label="選擇員工"
          value={p.id}
          onChange={(e) =>
            setP(data.employees.find((p) => p.id === e.target.value) || empty)
          }
        >
          <option value="">新增員工</option>
          {data.employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} · {e.email}
              {e.active ? "" : "（停用）"}
            </option>
          ))}
        </select>
        <button onClick={() => setP(empty)}>清空新增</button>
      </div>
      <div className="form-grid">
        <label>
          姓名
          <input
            required
            value={p.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </label>
        <label>
          Email
          <input
            type="email"
            value={p.email}
            onChange={(e) => patch({ email: e.target.value })}
          />
        </label>
        <label>
          到職日
          <input
            type="date"
            value={p.hire_date || ""}
            onChange={(e) => patch({ hire_date: e.target.value })}
          />
        </label>
        <label>
          部門
          <select
            value={p.department_id || ""}
            onChange={(e) => patch({ department_id: e.target.value })}
          >
            <option value="">請選擇</option>
            {data.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={p.active}
          onChange={(e) => patch({ active: e.target.checked })}
        />
        在職／啟用
      </label>
      {!p.active && (
        <label>
          停用原因
          <input
            value={p.inactive_reason || ""}
            onChange={(e) => patch({ inactive_reason: e.target.value })}
          />
        </label>
      )}
      <fieldset>
        <legend>各系統使用資格（新增不自動開通）</legend>
        {(admin
          ? ["training", "snack-vote", "customer-service"]
          : ["training"]
        ).map((s) => (
          <label className="check" key={s}>
            <input
              type="checkbox"
              checked={p.systems.includes(s)}
              onChange={(e) =>
                patch({
                  systems: e.target.checked
                    ? [...p.systems, s]
                    : p.systems.filter((x) => x !== s),
                })
              }
            />
            {
              {
                training: "教育訓練",
                "snack-vote": "零食投票",
                "customer-service": "客服（尚未接入）",
              }[s]
            }
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>職務與接任日（可兼任）</legend>
        {data.jobs
          .filter((j) => j.published)
          .map((j) => {
            const tenure = p.tenures.find(
              (t) => t.job_id === j.id && !t.end_date,
            );
            return (
              <div className="inline-fields" key={j.id}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={!!tenure}
                    onChange={(e) =>
                      patch({
                        tenures: e.target.checked
                          ? [
                              ...p.tenures,
                              { job_id: j.id, start_date: "", end_date: null },
                            ]
                          : p.tenures.filter((t) => t.job_id !== j.id),
                      })
                    }
                  />
                  {j.published?.name}
                </label>
                {tenure && (
                  <label>
                    接任日
                    <input
                      type="date"
                      required
                      value={tenure.start_date.slice(0, 10)}
                      onChange={(e) =>
                        patch({
                          tenures: p.tenures.map((t) =>
                            t.job_id === j.id
                              ? { ...t, start_date: e.target.value }
                              : t,
                          ),
                        })
                      }
                    />
                  </label>
                )}
              </div>
            );
          })}
      </fieldset>
      <button
        className="primary"
        onClick={() =>
          void onSave({ ...p, tenures: p.tenures.filter((t) => !t.end_date) })
        }
      >
        儲存人員與任職資料
      </button>
    </section>
  );
}
function Assignment({
  data,
  onSave,
}: {
  data: AdminData;
  onSave: (p: object) => Promise<void>;
}) {
  const [employee, setEmployee] = useState("");
  const [course, setCourse] = useState("");
  const [deadline, setDeadline] = useState<Deadline>({ ...defaultDeadline });
  const [reason, setReason] = useState("");
  const [base, setBase] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  return (
    <section className="panel">
      <h2>個別指派訓練</h2>
      <div className="form-grid">
        <label>
          員工
          <select
            value={employee}
            onChange={(e) => {
              setEmployee(e.target.value);
              setKey(crypto.randomUUID());
            }}
          >
            <option value="">請選擇</option>
            {data.employees
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          課程
          <select
            value={course}
            onChange={(e) => {
              setCourse(e.target.value);
              setKey(crypto.randomUUID());
            }}
          >
            <option value="">請選擇</option>
            {data.courses
              .filter((c) => c.active && c.published)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.published?.title}
                </option>
              ))}
          </select>
        </label>
      </div>
      <DeadlineEditor value={deadline} onChange={setDeadline} />
      {deadline.mode === "tenure" && (
        <label>
          本次接任日
          <input
            type="date"
            value={base}
            onChange={(e) => setBase(e.target.value)}
          />
        </label>
      )}
      <label>
        如開課期間與期限衝突，保留原因
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button
        className="primary"
        disabled={!employee || !course}
        onClick={() =>
          void onSave({
            employee_id: employee,
            course_id: course,
            deadline,
            base,
            key,
            conflict_reason: reason,
          })
        }
      >
        指派訓練
      </button>
    </section>
  );
}
function JobLinks({
  job,
  courses,
  onSave,
}: {
  job: Job;
  courses: Course[];
  onSave: (p: object) => Promise<void>;
}) {
  const [links, setLinks] = useState<Link[]>(job.published?.training || []);
  const [summary, setSummary] = useState("");
  return (
    <details>
      <summary>為此職務挑選訓練</summary>
      <LinkEditor links={links} courses={courses} onChange={setLinks} />
      <label>
        訓練異動摘要
        <input value={summary} onChange={(e) => setSummary(e.target.value)} />
      </label>
      <button
        disabled={!summary.trim()}
        onClick={() => void onSave({ id: job.id, training: links, summary })}
      >
        套用職務訓練異動
      </button>
    </details>
  );
}
function Retrain({
  data,
  onSave,
}: {
  data: AdminData;
  onSave: (p: object) => Promise<void>;
}) {
  const [course, setCourse] = useState("");
  const [employees, setEmployees] = useState<string[]>([]);
  const [batch, setBatch] = useState("");
  const [seconds, setSeconds] = useState(3600);
  const [retest, setRetest] = useState(true);
  const [deadline, setDeadline] = useState<Deadline>({ ...defaultDeadline });
  return (
    <section className="panel">
      <h2>要求重新受訓</h2>
      <p>建立新批次並重新累計，不撤銷原完成紀錄。同批次重試不重複建立。</p>
      <label>
        課程
        <select value={course} onChange={(e) => setCourse(e.target.value)}>
          <option value="">請選擇</option>
          {data.courses
            .filter((c) => c.active && c.published)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.published?.title}
              </option>
            ))}
        </select>
      </label>
      <div className="form-grid">
        <label>
          本次批次代碼
          <input value={batch} onChange={(e) => setBatch(e.target.value)} />
        </label>
        <label>
          本次總學習分鐘
          <input
            type="number"
            min="1"
            value={seconds / 60}
            onChange={(e) => setSeconds(Number(e.target.value) * 60)}
          />
        </label>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={retest}
          onChange={(e) => setRetest(e.target.checked)}
        />
        本次須重新測驗
      </label>
      <fieldset>
        <legend>訓練範圍</legend>
        {data.employees
          .filter((e) => e.active)
          .map((e) => (
            <label className="check" key={e.id}>
              <input
                type="checkbox"
                checked={employees.includes(e.id)}
                onChange={(ev) =>
                  setEmployees(
                    ev.target.checked
                      ? [...employees, e.id]
                      : employees.filter((id) => id !== e.id),
                  )
                }
              />
              {e.name}
            </label>
          ))}
      </fieldset>
      <DeadlineEditor value={deadline} onChange={setDeadline} />
      <button
        disabled={!course || !batch || !employees.length}
        onClick={() =>
          void onSave({
            id: course,
            employees,
            batch,
            seconds,
            retest,
            deadline,
          })
        }
      >
        建立重訓要求
      </button>
    </section>
  );
}
function RosterImport({ onDone }: { onDone: () => Promise<void> }) {
  const [fields, setFields] = useState(["name", "department"]);
  const [preview, setPreview] = useState<{
    id: string;
    rows: Record<string, string>[];
    errors: { email: string; error: string }[];
  } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function read(file: File) {
    setBusy(true);
    setPreview(null);
    try {
      const rows = await readImport(file);
      setPreview(await api("import_preview", { rows, fields }));
      setMessage("預覽完成，尚未寫入。");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Excel 整批匯入</h2>
      <p>以 Email 比對。空白不覆寫；有任一錯誤即不開放整批提交。</p>
      <button onClick={() => void importTemplate()}>下載 Excel 範本</button>
      <fieldset>
        <legend>允許更新欄位（變更後須重新選檔預覽）</legend>
        {[
          ["name", "姓名"],
          ["department", "部門"],
          ["hire_date", "到職日"],
          ["job", "職務與接任日"],
          ["active", "啟用狀態"],
          ["systems", "系統資格"],
        ].map(([key, label]) => (
          <label className="check" key={key}>
            <input
              type="checkbox"
              checked={fields.includes(key)}
              onChange={(e) => {
                setFields(
                  e.target.checked
                    ? [...fields, key]
                    : fields.filter((f) => f !== key),
                );
                setPreview(null);
              }}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <label>
        選擇 .xlsx 檔
        <input
          disabled={busy}
          type="file"
          accept=".xlsx"
          onChange={(e) => {
            if (e.target.files?.[0]) void read(e.target.files[0]);
            e.target.value = "";
          }}
        />
      </label>
      <p role="status">{message}</p>
      {preview && (
        <>
          <p>
            {preview.rows.length} 筆；{preview.errors.length} 筆錯誤
          </p>
          {preview.errors.map((e, i) => (
            <p className="error" key={i}>
              {e.email}：{e.error}
            </p>
          ))}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>Email</th>
                  <th>部門</th>
                  <th>處理</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.name}</td>
                    <td>{r.email}</td>
                    <td>{r.department}</td>
                    <td>{r.operation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            disabled={busy || !!preview.errors.length}
            onClick={async () => {
              setBusy(true);
              try {
                const v = await api<{ count: number }>("import_commit", {
                  id: preview.id,
                });
                setMessage(`整批匯入完成，共 ${v.count} 筆。`);
                setPreview(null);
                await onDone();
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            確認整批匯入
          </button>
        </>
      )}
    </section>
  );
}
function Reports({ data }: { data: AdminData }) {
  const [filter, setFilter] = useState({
    department_id: "",
    employee_id: "",
    job_id: "",
    course_id: "",
    cycle: "",
    status: "",
  });
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [message, setMessage] = useState("");
  async function get(kind: string, exportName?: string) {
    try {
      const r = await api<Record<string, unknown>[]>("report", {
        kind,
        ...filter,
      });
      setRows(r);
      if (exportName) await exportWorkbook(r, exportName);
      setMessage(`${r.length} 筆資料`);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <section className="panel">
      <h2>訓練查詢與 Excel 報表</h2>
      <div className="form-grid">
        {(
          [
            [
              "department_id",
              "部門",
              data.departments.map((d) => [d.id, d.name]),
            ],
            ["employee_id", "人員", data.employees.map((e) => [e.id, e.name])],
            [
              "job_id",
              "職務",
              data.jobs.map((j) => [j.id, (j.published || j.draft).name]),
            ],
            [
              "course_id",
              "課程",
              data.courses.map((c) => [c.id, (c.published || c.draft).title]),
            ],
            [
              "status",
              "完成狀態",
              [
                ["completed", "已完成"],
                ["incomplete", "未完成"],
                ["cancelled", "已取消列管"],
                ["exempt", "年度免修"],
              ],
            ],
          ] as [keyof typeof filter, string, string[][]][]
        ).map(([key, label, options]) => (
          <label key={key}>
            {label}
            <select
              value={filter[key]}
              onChange={(e) =>
                setFilter((f) => ({ ...f, [key]: e.target.value }))
              }
            >
              <option value="">全部</option>
              {options.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          義務年度（once 為一次性）
          <input
            value={filter.cycle}
            onChange={(e) =>
              setFilter((f) => ({ ...f, cycle: e.target.value }))
            }
          />
        </label>
      </div>
      <div className="button-row">
        <button onClick={() => void get("summary")}>查詢總表</button>
        <button onClick={() => void get("attempts")}>查詢歷次測驗</button>
        <button onClick={() => void get("summary", "訓練總表")}>
          匯出訓練總表
        </button>
        <button onClick={() => void get("attempts", "歷次測驗")}>
          匯出歷次測驗
        </button>
        <button onClick={() => void get("deadlines", "期限異動表")}>
          匯出期限異動
        </button>
      </div>
      <p role="status">{message}</p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>姓名</th>
              <th>課程／要求</th>
              <th>年度</th>
              <th>完成／交卷時間</th>
              <th>成績</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{String(r.name || "")}</td>
                <td>{String(r.title || r.requirement_id || "")}</td>
                <td>{String(r.cycle || "")}</td>
                <td>
                  {dateTime(
                    String(r.completed_at || r.submitted_at || "") || null,
                  )}
                </td>
                <td>
                  {r.score !== null && r.score !== undefined
                    ? Number(r.score).toFixed(2)
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function Permissions({
  data,
  onSave,
}: {
  data: AdminData;
  onSave: (action: string, p: object) => Promise<void>;
}) {
  const [employee, setEmployee] = useState("");
  const [system, setSystem] = useState("training");
  const [role, setRole] = useState("manager");
  const [deps, setDeps] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  return (
    <section className="panel">
      <h2>獨立系統角色與部門範圍</h2>
      <p>零食管理員不會自動取得訓練管理員。可同時兼任主管與 HR。</p>
      <label>
        員工
        <select value={employee} onChange={(e) => setEmployee(e.target.value)}>
          <option value="">請選擇</option>
          {data.employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      <div className="form-grid">
        <label>
          系統
          <select value={system} onChange={(e) => setSystem(e.target.value)}>
            {data.systems.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          角色
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="manager">部門訓練主管</option>
            <option value="hr">HR</option>
            <option value="admin">後臺管理員</option>
          </select>
        </label>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={all}
          onChange={(e) => setAll(e.target.checked)}
        />
        全公司範圍（管理員須勾選）
      </label>
      {!all &&
        data.departments.map((d) => (
          <label className="check" key={d.id}>
            <input
              type="checkbox"
              checked={deps.includes(d.id)}
              onChange={(e) =>
                setDeps(
                  e.target.checked
                    ? [...deps, d.id]
                    : deps.filter((id) => id !== d.id),
                )
              }
            />
            {d.name}
          </label>
        ))}
      <button
        disabled={!employee || (!all && !deps.length)}
        onClick={async () => {
          if (all)
            await onSave("grant", {
              employee_id: employee,
              system_code: system,
              role,
              all_departments: true,
            });
          else
            for (const dep of deps)
              await onSave("grant", {
                employee_id: employee,
                system_code: system,
                role,
                department_id: dep,
                all_departments: false,
              });
        }}
      >
        新增角色授權
      </button>
      {data.grants.map((g) => (
        <div className="history-row" key={g.id}>
          <span>
            {data.employees.find((e) => e.id === g.employee_id)?.name} ·{" "}
            {g.system_code} · {g.role} ·{" "}
            {g.all_departments
              ? "全公司"
              : data.departments.find((d) => d.id === g.department_id)?.name}
          </span>
          <button
            onClick={() => {
              if (confirm("移除此角色授權？"))
                void onSave("grant", { id: g.id, delete: true });
            }}
          >
            移除
          </button>
        </div>
      ))}
    </section>
  );
}
function NotificationSettings({
  initial,
  onSave,
}: {
  initial: Settings;
  onSave: (p: object) => Promise<void>;
}) {
  const [v, setV] = useState(initial);
  const [before, setBefore] = useState(initial.before.join(","));
  return (
    <section className="panel">
      <h2>通知設定</h2>
      <label>
        每日彙整時間（臺灣）
        <input
          type="time"
          value={v.time}
          onChange={(e) => setV({ ...v, time: e.target.value })}
        />
      </label>
      <label>
        到期前提醒天數（逗號分隔）
        <input value={before} onChange={(e) => setBefore(e.target.value)} />
      </label>
      <label>
        逾期後每幾天提醒
        <input
          type="number"
          min="1"
          value={v.overdue_every}
          onChange={(e) =>
            setV({ ...v, overdue_every: Number(e.target.value) })
          }
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={v.hr_digest}
          onChange={(e) => setV({ ...v, hr_digest: e.target.checked })}
        />
        開啟 HR 範圍內逾期彙整 Email（預設關閉）
      </label>
      <button
        onClick={() =>
          void onSave({
            ...v,
            before: before.split(",").filter(Boolean).map(Number),
          })
        }
      >
        儲存通知設定
      </button>
    </section>
  );
}
function SystemSettings({
  systems,
  onSave,
}: {
  systems: System[];
  onSave: (p: object) => Promise<void>;
}) {
  return (
    <section className="panel">
      <h2>系統目錄</h2>
      <p>
        客服預設停用。僅保留共用身分、使用資格與入口設定，尚未實作客服介接。
      </p>
      {systems.map((s) => (
        <SystemRow key={s.code} system={s} onSave={onSave} />
      ))}
    </section>
  );
}
function SystemRow({
  system,
  onSave,
}: {
  system: System;
  onSave: (p: object) => Promise<void>;
}) {
  const [s, setS] = useState(system);
  return (
    <fieldset>
      <legend>{s.code}</legend>
      <label>
        名稱
        <input
          value={s.name}
          onChange={(e) => setS({ ...s, name: e.target.value })}
        />
      </label>
      <label>
        入口
        <input
          value={s.entry}
          onChange={(e) => setS({ ...s, entry: e.target.value })}
        />
      </label>
      <label>
        管理入口
        <input
          value={s.admin_entry || ""}
          onChange={(e) => setS({ ...s, admin_entry: e.target.value })}
        />
      </label>
      <label>
        排序
        <input
          type="number"
          value={s.sort_order}
          onChange={(e) => setS({ ...s, sort_order: Number(e.target.value) })}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          disabled={s.code === "customer-service"}
          checked={s.enabled}
          onChange={(e) => setS({ ...s, enabled: e.target.checked })}
        />
        啟用
      </label>
      <button onClick={() => void onSave(s)}>儲存系統設定</button>
    </fieldset>
  );
}
