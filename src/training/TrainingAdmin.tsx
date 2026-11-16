import { useCallback, useEffect, useState } from "react";
import { api, materialApi, organizationApi, accessProfileApi, externalTrainingApi, certificateUrl, deleteTrainingRequirement, dateTime, deadlineLabel, duration } from "./api";
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
  ExternalCourse,
  ExternalEnrollment,
} from "./types";
import {
  CourseEditor,
  MaterialLibrary,
  JobEditor,
  DeadlineEditor,
  LinkEditor,
  defaultDeadline,
} from "./Editors";
import { exportWorkbook, importTemplate, readImport } from "./workbooks";
type Tab =
  | "overview"
  | "people"
  | "organization"
  | "access"
  | "systems"
  | "jobs"
  | "courses"
  | "materials"
  | "assign"
  | "external"
  | "reports"
  | "settings";
export function TrainingAdmin({
  context,
  scope = "training",
}: {
  context: Context;
  scope?: "platform" | "training";
}) {
  const platform = scope === "platform";
  const [data, setData] = useState<AdminData | null>(null);
  const [tab, setTab] = useState<Tab>(
    platform
      ? context.grants.some((g) => g.system_code === "training" && g.role === "admin")
        ? "organization"
        : "people"
      : "overview",
  );
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
  const load = useCallback(async () => {
    try {
      const adminData = await api<Omit<AdminData, "materials">>("admin");
      const materials =
        !platform && admin
          ? await materialApi<AdminData["materials"]>("list")
          : [];
      setData({ ...adminData, materials });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [admin, platform]);
  useEffect(() => {
    void load();
  }, [load]);
  async function act<T = unknown>(action: string, p: object): Promise<T | undefined> {
    setError("");
    try {
      const result = await api<T>(action, p);
      await load();
      return result;
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function removeRequirement(id: string, label: string) {
    const reason = prompt(`刪除「${label}」的原因（必填）`);
    if (!reason?.trim()) return;
    if (!confirm("這會永久刪除本次指派、學習進度、試卷與通知，且無法復原。確定繼續？")) return;
    setError("");
    try {
      await deleteTrainingRequirement({ id, reason: reason.trim() });
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
      <p className="eyebrow">
        {platform ? "IDENTITY & ORGANIZATION" : "LEARNING ADMINISTRATION"}
      </p>
      <h1>{platform ? "單一入口管理" : "教育訓練管理"}</h1>
      <p>
        {platform
          ? "只維護登入所需的人員主檔、組織歸屬、應用資格與管理權限。"
          : "只維護教材、課程、職務訓練、開課指派、學習紀錄與訓練通知。"}
      </p>
      {platform ? (
        <section className="platform-sequence" aria-label="入口設定順序">
          <span><b>1</b> 建立組織</span>
          <i>→</i>
          <span><b>2</b> 建立人員與設定完整權限</span>
          <i>→</i>
          <span><b>3</b> 維護系統目錄</span>
        </section>
      ) : (
        people && (
          <a className="platform-boundary-link" href="#/portal/admin">
            人員、部門與登入資格請至「單一入口管理」設定 →
          </a>
        )
      )}
      <nav className="admin-tabs">
        {(
          (platform
            ? [
                ...(admin ? [["organization", "組織設定"]] : []),
                ...(people ? [["people", "人員與權限"]] : []),
                ...(admin ? [["systems", "系統設定"]] : []),
              ]
            : [
                ["overview", "訓練總覽"],
                ["jobs", "職務與職責"],
                ...(admin
                  ? [
                      ["materials", "教材庫"],
                      ["courses", "課程與題庫"],
                    ]
                  : []),
                ["assign", "開課與指派"],
                ["external", "外訓與證書"],
                ["reports", "訓練報表"],
                ...(admin ? [["settings", "通知設定"]] : []),
              ]) as [Tab, string][]
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
            onGrant={act}
            onSave={async (p, adminSystems) => {
              setError("");
              try {
                const saved = await api<{ id: string }>("person_save", p);
                await accessProfileApi("save", {
                  employee_id: saved.id,
                  systems: p.systems,
                  admin_systems: adminSystems,
                });
                await load();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
          <RosterImport onDone={load} />
        </>
      )}
      {tab === "organization" && platform && admin && (
        <OrganizationSettings departments={data.departments} employees={data.employees} onSaved={load} />
      )}
      {tab === "systems" && platform && admin && (
        <SystemSettings
          systems={data.systems}
          onSave={(p) => act("system", p)}
        />
      )}
      {tab === "materials" && admin && (
        <MaterialLibrary materials={data.materials} done={load} />
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
              materials={data.materials}
              departments={data.departments}
              done={() => void load()}
            />
          )}
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
          {people && (
            <JobTenures data={data} onSave={(p) => act("person_save", p)} />
          )}
        </>
      )}
      {tab === "assign" && (
        <>
          <section className="workflow-intro">
            <span>已發布課程</span>
            <h2>開課與指派</h2>
            <p>此區只處理人員指派、期限與重新受訓。教材請在「教材庫」獨立維護，課程內容請在「課程與題庫」設定。</p>
          </section>
          <Assignment data={data} onSave={(p) => act("assign", p)} />
          <Retrain data={data} onSave={(p) => act("retrain", p)} />
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
                          {r.cycle === "once" ? "一次性" : `${r.cycle} 年度`} · {r.batch === "normal" ? "一般指派" : r.batch}
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
                        {admin && <button className="danger-button" onClick={() => void removeRequirement(r.id, `${person(r.employee_id)}－${r.course_title}`)}>刪除訓練紀錄</button>}
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
      {tab === "external" && <ExternalTrainingAdmin data={data} canCreate={admin} />}
      {tab === "settings" && admin && (
        <NotificationSettings
          initial={data.settings!}
          onSave={(p) => act("settings", p)}
        />
      )}
    </main>
  );
}
function ExternalTrainingAdmin({ data, canCreate }: { data: AdminData; canCreate: boolean }) {
  const [courses, setCourses] = useState<ExternalCourse[]>([]);
  const [enrollments, setEnrollments] = useState<ExternalEnrollment[]>([]);
  const [draft, setDraft] = useState({ title: "", provider: "", start_date: "", end_date: "", hours: 0, notes: "" });
  const [courseId, setCourseId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const result = await externalTrainingApi<{ courses: ExternalCourse[]; enrollments: ExternalEnrollment[] }>("admin");
    setCourses(result.courses);
    setEnrollments(await Promise.all(result.enrollments.map(async (enrollment) => ({
      ...enrollment,
      certificate_url: enrollment.certificate_path ? await certificateUrl(enrollment.certificate_path) : undefined,
    }))));
  }, []);
  useEffect(() => { void load().catch((e) => setError(e.message)); }, [load]);
  const run = async (action: string, p: object) => {
    try { setError(""); await externalTrainingApi(action, p); await load(); }
    catch (e) { setError((e as Error).message); }
  };
  return <>
    {canCreate && <section className="panel">
      <p className="eyebrow">EXTERNAL TRAINING</p>
      <h2>建立外訓課程</h2>
      <p>外部訓練獨立於教材庫與一般開課；建立後再指派參訓人員。</p>
      <div className="form-grid">
        <label>課程名稱<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
        <label>訓練機構<input value={draft.provider} onChange={(e) => setDraft({ ...draft, provider: e.target.value })} /></label>
        <label>開始日期<input type="date" value={draft.start_date} onChange={(e) => setDraft({ ...draft, start_date: e.target.value })} /></label>
        <label>結束日期<input type="date" value={draft.end_date} onChange={(e) => setDraft({ ...draft, end_date: e.target.value })} /></label>
        <label>訓練時數<input type="number" min="0" step="0.5" value={draft.hours} onChange={(e) => setDraft({ ...draft, hours: Number(e.target.value) })} /></label>
      </div>
      <label>備註<textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
      <button className="primary" disabled={!draft.title.trim() || !draft.provider.trim()} onClick={() => void run("save_course", draft)}>建立外訓課程</button>
    </section>}
    <section className="panel">
      <h2>指派參訓人員</h2>
      <div className="form-grid">
        <label>外訓課程<select value={courseId} onChange={(e) => setCourseId(e.target.value)}><option value="">請選擇</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title} · {course.provider}</option>)}</select></label>
        <label>參訓人員<select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}><option value="">請選擇</option>{data.employees.filter((employee) => employee.active).map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
      </div>
      <button disabled={!courseId || !employeeId} onClick={() => void run("assign", { course_id: courseId, employee_id: employeeId })}>指派外訓</button>
    </section>
    <section className="panel">
      <h2>結業證書審核</h2>
      <p>只有審核通過才列為外訓完成；退回後員工可重新上傳。</p>
      {error && <p role="alert" className="error">{error}</p>}
      {enrollments.map((enrollment) => <div className="history-row" key={enrollment.id}>
        <span>{enrollment.employee_name} · {enrollment.course?.title} · {{assigned:"待上傳",submitted:"待審核",approved:"已完成",rejected:"已退回"}[enrollment.status]}</span>
        <div className="button-row">
          {enrollment.certificate_url && <a href={enrollment.certificate_url} target="_blank" rel="noreferrer">查看證書</a>}
          {enrollment.status === "submitted" && <>
            <button className="primary" onClick={() => void run("review", { id: enrollment.id, approved: true, note: "證書審核通過" })}>通過</button>
            <button onClick={() => { const note=prompt("請填退回原因"); if(note) void run("review", { id: enrollment.id, approved: false, note }); }}>退回</button>
          </>}
        </div>
      </div>)}
    </section>
  </>;
}
type Department = AdminData["departments"][number];
function departmentTree(departments: Department[]) {
  const rows: { department: Department; depth: number }[] = [];
  const visited = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    departments
      .filter((d) => d.parent_id === parentId)
      .sort((a, b) => a.name.localeCompare(b.name, "zh-TW"))
      .forEach((department) => {
        if (visited.has(department.id)) return;
        visited.add(department.id);
        rows.push({ department, depth });
        walk(department.id, depth + 1);
      });
  };
  walk(null, 0);
  departments
    .filter((d) => !visited.has(d.id))
    .forEach((department) => rows.push({ department, depth: 0 }));
  return rows;
}
function OrganizationSettings({
  departments,
  employees,
  onSaved,
}: {
  departments: Department[];
  employees: Person[];
  onSaved: () => Promise<void>;
}) {
  const tree = departmentTree(departments);
  const [selectedId, setSelectedId] = useState(departments[0]?.id || "");
  const selected = departments.find((d) => d.id === selectedId) || null;
  const [draft, setDraft] = useState<Department>({ id: "", name: "", parent_id: null, manager_employee_id: null });
  const [error, setError] = useState("");
  useEffect(() => {
    if (selected) setDraft(selected);
  }, [selected]);
  const descendants = (id: string) => {
    const found = new Set<string>();
    const visit = (parentId: string) =>
      departments.filter((d) => d.parent_id === parentId).forEach((d) => {
        if (!found.has(d.id)) { found.add(d.id); visit(d.id); }
      });
    visit(id);
    return found;
  };
  const blockedParents = draft.id ? descendants(draft.id) : new Set<string>();
  if (draft.id) blockedParents.add(draft.id);
  const beginNew = (parentId: string | null) => {
    setSelectedId("");
    setDraft({ id: "", name: "", parent_id: parentId, manager_employee_id: null });
    setError("");
  };
  return (
    <section className="panel">
      <p className="eyebrow">ORGANIZATION DIRECTORY</p>
      <h2>組織層級</h2>
      <p>每位人員歸屬一個單位；上層單位的主管權限與課程適用範圍會自動涵蓋所有下層單位。</p>
      <div className="organization-layout">
        <aside className="organization-tree">
          <button className="primary" onClick={() => beginNew(null)}>＋ 新增最上層單位</button>
          <nav aria-label="組織樹">
            {tree.map(({ department, depth }) => (
              <button
                key={department.id}
                className={selectedId === department.id ? "selected" : ""}
                style={{ paddingInlineStart: `${14 + depth * 22}px` }}
                onClick={() => setSelectedId(department.id)}
              >
                <span>{depth ? "↳" : "◆"}</span>{department.name}
              </button>
            ))}
          </nav>
        </aside>
        <div className="organization-editor">
          <small>{draft.id ? "EDIT ORGANIZATION" : "NEW ORGANIZATION"}</small>
          <h3>{draft.id ? `編輯 ${draft.name}` : "建立組織單位"}</h3>
          <label>組織名稱
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label>上層組織
            <select value={draft.parent_id || ""} onChange={(e) => setDraft({ ...draft, parent_id: e.target.value || null })}>
              <option value="">無（最上層）</option>
              {tree.filter(({ department }) => !blockedParents.has(department.id)).map(({ department, depth }) => (
                <option key={department.id} value={department.id}>{`${"— ".repeat(depth)}${department.name}`}</option>
              ))}
            </select>
          </label>
          <label>單位主管
            <select value={draft.manager_employee_id || ""} onChange={(e) => setDraft({ ...draft, manager_employee_id: e.target.value || null })}>
              <option value="">尚未指定</option>
              {employees.filter((employee) => employee.active).sort((a, b) => a.name.localeCompare(b.name, "zh-TW")).map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.name} · {employee.email}</option>
              ))}
            </select>
            <small>主管可管理本單位及所有下層單位的教育訓練。</small>
          </label>
          <p className="boundary-note">變更上層只會調整組織關係，不會刪除人員、職務或既有資料。</p>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="button-row">
            <button className="primary" disabled={!draft.name.trim()} onClick={async () => {
              try {
                setError("");
                const saved = await organizationApi<Department>("save", draft);
                await onSaved();
                setSelectedId(saved.id);
              } catch (e) { setError((e as Error).message); }
            }}>儲存組織</button>
            {draft.id && <button onClick={() => beginNew(draft.id)}>＋ 在此單位下新增</button>}
          </div>
        </div>
      </div>
    </section>
  );
}
function People({
  data,
  admin,
  onSave,
  onGrant,
}: {
  data: AdminData;
  admin: boolean;
  onSave: (p: Person, adminSystems: string[]) => Promise<void>;
  onGrant: (action: string, p: object) => Promise<void>;
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
  const [adminSystems, setAdminSystems] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const patch = (v: Partial<Person>) => setP((p) => ({ ...p, ...v }));
  const filteredPeople = data.employees.filter((employee) =>
    `${employee.name} ${employee.email}`
      .toLocaleLowerCase("zh-TW")
      .includes(query.trim().toLocaleLowerCase("zh-TW")),
  );
  return (
    <section className="panel">
      <p className="eyebrow">SHARED PEOPLE DIRECTORY</p>
      <h2>共用人員與權限</h2>
      <p>在同一份人員資料中完成登入資料、組織歸屬、系統資格及管理範圍設定。</p>
      <div className="people-directory-layout">
        <aside className="people-directory-sidebar">
          <button className="primary new-person-button" onClick={() => { setP(empty); setAdminSystems([]); }}>
            ＋ 新增人員
          </button>
          <label className="people-search">
            搜尋人員
            <input
              type="search"
              value={query}
              placeholder="姓名或 Email"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <nav className="people-list" aria-label="人員清單">
            {filteredPeople.map((employee) => (
              <button
                key={employee.id}
                className={p.id === employee.id ? "selected" : ""}
                onClick={() => {
                  setP(employee);
                  setAdminSystems(data.grants.filter((grant) => grant.employee_id === employee.id && grant.role === "admin").map((grant) => grant.system_code));
                }}
              >
                <span>
                  <strong>{employee.name}</strong>
                  <small>{employee.email}</small>
                </span>
                <em className={employee.active ? "active" : "inactive"}>
                  {employee.active ? "啟用" : "停用"}
                </em>
              </button>
            ))}
            {!filteredPeople.length && <p>找不到符合的人員。</p>}
          </nav>
        </aside>
        <div className="people-editor">
          <div className="people-editor-heading">
            <div>
              <small>{p.id ? "EDIT PERSON" : "NEW PERSON"}</small>
              <h3>{p.id ? `編輯 ${p.name}` : "建立新人員"}</h3>
            </div>
            <span className={p.active ? "person-state active" : "person-state inactive"}>
              {p.active ? "啟用中" : "已停用"}
            </span>
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
                {departmentTree(data.departments).map(({ department: d, depth }) => (
                  <option key={d.id} value={d.id}>
                    {`${"— ".repeat(depth)}${d.name}`}
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
          <fieldset className="access-profile-editor">
            <legend>應用與管理權限</legend>
            <p>一次設定入口顯示與系統管理權限；授予管理權限時會自動開通該系統。</p>
            {admin && <div className="access-presets">
              <button type="button" onClick={() => { const codes=data.systems.filter((system)=>system.enabled).map((system)=>system.code); patch({systems:codes}); setAdminSystems([]); }}>開通所有系統</button>
              <button type="button" className="primary" onClick={() => { const codes=data.systems.filter((system)=>system.enabled).map((system)=>system.code); patch({systems:codes}); setAdminSystems(codes); }}>授予所有系統管理權限</button>
              <button type="button" onClick={() => { patch({systems:[]}); setAdminSystems([]); }}>清除全部資格</button>
            </div>}
            <div className="access-system-grid">
              {data.systems.filter((system) => system.enabled).map((system) => {
                const enabled=p.systems.includes(system.code);
                const systemAdmin=adminSystems.includes(system.code);
                return <article key={system.code} className={enabled ? "enabled" : ""}>
                  <strong>{system.name}</strong>
                  <label className="check"><input type="checkbox" checked={enabled} onChange={(e) => {
                    const systems=e.target.checked?[...new Set([...p.systems,system.code])]:p.systems.filter((code)=>code!==system.code);
                    patch({systems});
                    if(!e.target.checked) setAdminSystems((items)=>items.filter((code)=>code!==system.code));
                  }} />顯示入口並允許使用</label>
                  {admin && <label className="check"><input type="checkbox" checked={systemAdmin} onChange={(e) => {
                    if(e.target.checked){ patch({systems:[...new Set([...p.systems,system.code])]}); setAdminSystems((items)=>[...new Set([...items,system.code])]); }
                    else setAdminSystems((items)=>items.filter((code)=>code!==system.code));
                  }} />全功能管理員</label>}
                </article>;
              })}
            </div>
            <small>一般使用者與全功能管理員在此設定；部門主管及 HR 範圍也在下方同一頁完成。</small>
          </fieldset>
          <ScopedPermissions person={p} data={data} onSave={onGrant} />
          <button
            className="primary"
            onClick={() =>
              void onSave({
                ...p,
                tenures: p.tenures.filter((t) => !t.end_date),
              }, adminSystems)
            }
          >
            儲存人員與登入資料
          </button>
        </div>
      </div>
    </section>
  );
}
function ScopedPermissions({
  person,
  data,
  onSave,
}: {
  person: Person;
  data: AdminData;
  onSave: (action: string, p: object) => Promise<void>;
}) {
  const [role, setRole] = useState<"manager" | "hr">("manager");
  const [deps, setDeps] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  const grants = data.grants.filter((grant) => grant.employee_id === person.id);
  return <fieldset className="scoped-permissions" disabled={!person.id}>
    <legend>主管／HR 管理範圍</legend>
    {!person.id && <p>請先儲存人員基本資料，再設定管理範圍。</p>}
    {person.id && <>
      <div className="form-grid">
        <label>角色<select value={role} onChange={(e) => setRole(e.target.value as "manager" | "hr")}><option value="manager">部門訓練主管</option><option value="hr">HR</option></select></label>
        <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />全公司範圍</label>
      </div>
      {!all && departmentTree(data.departments).map(({department,depth}) => <label className="check" key={department.id}><input type="checkbox" checked={deps.includes(department.id)} onChange={(e) => setDeps(e.target.checked ? [...deps,department.id] : deps.filter((id) => id !== department.id))} />{`${"— ".repeat(depth)}${department.name}`}（含下層）</label>)}
      <button disabled={!all && !deps.length} onClick={async () => {
        if(all) await onSave("grant",{employee_id:person.id,system_code:"training",role,all_departments:true});
        else for(const departmentId of deps) await onSave("grant",{employee_id:person.id,system_code:"training",role,department_id:departmentId,all_departments:false});
      }}>新增主管／HR 權限</button>
      <h3>目前完整權限</h3>
      {person.systems.filter((code) => !grants.some((grant) => grant.system_code === code)).map((code) => <div className="history-row" key={`user-${code}`}><span>{data.systems.find((system) => system.code === code)?.name || code} · 一般使用者</span></div>)}
      {grants.map((grant) => <div className="history-row" key={grant.id}><span>{data.systems.find((system) => system.code === grant.system_code)?.name || grant.system_code} · {grant.role === "admin" ? "系統管理員" : grant.role === "hr" ? "HR" : "部門主管"} · {grant.all_departments ? "全公司" : data.departments.find((department) => department.id === grant.department_id)?.name}</span><button onClick={() => { if(confirm("移除此管理權限？")) void onSave("grant",{id:grant.id,delete:true}); }}>移除</button></div>)}
      {!person.systems.length && !grants.length && <p>尚未設定任何系統資格。</p>}
    </>}
  </fieldset>;
}
function JobTenures({
  data,
  onSave,
}: {
  data: AdminData;
  onSave: (p: object) => Promise<void>;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const person = data.employees.find((e) => e.id === employeeId) || null;
  const [tenures, setTenures] = useState<Person["tenures"]>([]);
  const selectPerson = (id: string) => {
    const selected = data.employees.find((e) => e.id === id);
    setEmployeeId(id);
    setTenures(selected?.tenures || []);
  };
  return (
    <section className="panel">
      <p className="eyebrow">TRAINING RESPONSIBILITY</p>
      <h2>職務與接任日</h2>
      <p>此資料只供教育訓練判斷職務必修課程，不屬於登入或組織主檔。</p>
      <label>
        員工
        <select
          value={employeeId}
          onChange={(e) => selectPerson(e.target.value)}
        >
          <option value="">請選擇</option>
          {data.employees
            .filter((e) => e.active)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
        </select>
      </label>
      {person && (
        <>
          <fieldset>
            <legend>目前職務（可兼任）</legend>
            {data.jobs
              .filter((j) => j.published)
              .map((j) => {
                const tenure = tenures.find(
                  (t) => t.job_id === j.id && !t.end_date,
                );
                return (
                  <div className="inline-fields" key={j.id}>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={!!tenure}
                        onChange={(e) =>
                          setTenures(
                            e.target.checked
                              ? [
                                  ...tenures,
                                  {
                                    job_id: j.id,
                                    start_date: "",
                                    end_date: null,
                                  },
                                ]
                              : tenures.filter((t) => t.job_id !== j.id),
                          )
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
                            setTenures(
                              tenures.map((t) =>
                                t.job_id === j.id
                                  ? { ...t, start_date: e.target.value }
                                  : t,
                              ),
                            )
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
              void onSave({
                ...person,
                tenures: tenures.filter((t) => !t.end_date),
              })
            }
          >
            儲存職務與接任日
          </button>
        </>
      )}
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
      <p>只匯入入口登入與組織資料，以 Email 比對；空白不覆寫，有任一錯誤即不開放整批提交。</p>
      <button onClick={() => void importTemplate()}>下載 Excel 範本</button>
      <fieldset>
        <legend>允許更新欄位（變更後須重新選檔預覽）</legend>
        {[
          ["name", "姓名"],
          ["department", "部門"],
          ["hire_date", "到職日"],
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
        cycle: filter.cycle.trim() === "一次性" ? "once" : filter.cycle.trim(),
      });
      const localized = r.map((row) => ({
        ...row,
        cycle: row.cycle === "once" ? "一次性" : /^\d{4}$/.test(String(row.cycle || "")) ? `${row.cycle} 年` : row.cycle,
      }));
      setRows(localized);
      if (exportName) await exportWorkbook(localized, exportName);
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
          訓練週期／年度
          <input
            placeholder="例如：一次性或 2026"
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
              <th>訓練週期／年度</th>
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
  onAccessSave,
}: {
  data: AdminData;
  onSave: (action: string, p: object) => Promise<void>;
  onAccessSave: (p: object) => Promise<void>;
}) {
  const [employee, setEmployee] = useState("");
  const [system, setSystem] = useState("training");
  const [role, setRole] = useState("manager");
  const [deps, setDeps] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState("");
  const filteredPeople = data.employees.filter((person) =>
    `${person.name} ${person.email}`.toLocaleLowerCase("zh-TW").includes(query.trim().toLocaleLowerCase("zh-TW")),
  );
  const selectedPerson = data.employees.find((person) => person.id === employee);
  const selectedGrants = data.grants.filter((grant) => grant.employee_id === employee);
  const adminSystems = selectedGrants.filter((grant) => grant.role === "admin").map((grant) => grant.system_code);
  const generalSystems = (selectedPerson?.systems || []).filter(
    (code) => !selectedGrants.some((grant) => grant.system_code === code),
  );
  return (
    <section className="panel">
      <h2>獨立系統角色與部門範圍</h2>
      <p>先從左側選擇人員，再設定該人員的系統角色與管理範圍。</p>
      <div className="people-directory-layout permission-directory-layout">
        <aside className="people-directory-sidebar">
          <label className="people-search">搜尋人員
            <input type="search" value={query} placeholder="姓名或 Email" onChange={(e) => setQuery(e.target.value)} />
          </label>
          <nav className="people-list" aria-label="權限設定人員清單">
            {filteredPeople.map((person) => <button key={person.id} className={employee === person.id ? "selected" : ""} onClick={() => { setEmployee(person.id); setDeps([]); setAll(false); }}>
              <span><strong>{person.name}</strong><small>{person.email}</small></span>
              <em className={person.active ? "active" : "inactive"}>{person.active ? "啟用" : "停用"}</em>
            </button>)}
            {!filteredPeople.length && <p>找不到符合的人員。</p>}
          </nav>
        </aside>
        <div className="people-editor permission-editor">
          <div className="people-editor-heading"><div><small>ACCESS PROFILE</small><h3>{selectedPerson ? `設定 ${selectedPerson.name} 的權限` : "請先選擇人員"}</h3></div></div>
          <fieldset disabled={!employee}>
            <legend>新增系統角色</legend>
            <div className="form-grid">
        <label>
          系統
          <select value={system} onChange={(e) => { const code=e.target.value; setSystem(code); if(code!=="training"){ setRole((current) => current === "user" ? "user" : "admin"); setAll(true); } }}>
            {data.systems.filter((item) => item.enabled).map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          角色
          <select value={role} onChange={(e) => { const next=e.target.value; setRole(next); if(next==="admin" || next==="user") setAll(true); }}>
            <option value="user">一般使用者</option>
            {system === "training" && <option value="manager">部門訓練主管</option>}
            {system === "training" && <option value="hr">HR</option>}
            <option value="admin">後臺管理員</option>
          </select>
        </label>
      </div>
      {role !== "user" && <label className="check">
        <input
          type="checkbox"
          checked={all}
          disabled={role === "admin"}
          onChange={(e) => setAll(e.target.checked)}
        />
        全公司範圍（管理員須勾選）
      </label>}
      {role !== "user" && !all &&
        departmentTree(data.departments).map(({ department: d, depth }) => (
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
            {`${"— ".repeat(depth)}${d.name}`}（含下層）
          </label>
        ))}
      <button
        disabled={!employee || (role !== "user" && !all && !deps.length)}
        onClick={async () => {
          if (role === "user") {
            await onAccessSave({
              employee_id: employee,
              systems: [...new Set([...(selectedPerson?.systems || []), system])],
              admin_systems: adminSystems,
            });
          } else if (all)
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
        {role === "user" ? "開通一般使用資格" : "新增角色授權"}
      </button>
          </fieldset>
          <h3>此人員目前的角色</h3>
          {!employee && <p>選擇人員後顯示。</p>}
      {generalSystems.map((code) => (
        <div className="history-row" key={`user-${code}`}>
          <span>
            {selectedPerson?.name} · {data.systems.find((item) => item.code === code)?.name || code} · 一般使用者
          </span>
          <button onClick={() => {
            if (confirm("移除此系統的一般使用資格？"))
              void onAccessSave({
                employee_id: employee,
                systems: (selectedPerson?.systems || []).filter((item) => item !== code),
                admin_systems: adminSystems.filter((item) => item !== code),
              });
          }}>移除</button>
        </div>
      ))}
      {selectedGrants.map((g) => (
        <div className="history-row" key={g.id}>
          <span>
            {data.employees.find((e) => e.id === g.employee_id)?.name} ·{" "}
            {data.systems.find((system) => system.code === g.system_code)?.name || g.system_code} · {g.role === "admin" ? "系統管理員" : g.role === "hr" ? "HR" : "部門主管"} ·{" "}
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
          {employee && !generalSystems.length && !selectedGrants.length && <p>目前沒有任何系統角色。</p>}
        </div>
      </div>
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
