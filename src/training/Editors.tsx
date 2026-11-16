import { useState } from "react";
import type {
  Course,
  CourseDraft,
  Deadline,
  Job,
  JobContent,
  Link,
  Question,
  Material,
} from "./types";
import { api, materialApi, youtubeId } from "./api";
export const defaultDeadline: Deadline = {
  mode: "assigned",
  days: 30,
  month: 12,
  day: "last",
  late: "makeup",
  makeup_days: 30,
};
export function DeadlineEditor({
  value,
  onChange,
}: {
  value: Deadline;
  onChange: (v: Deadline) => void;
}) {
  const change = (v: Partial<Deadline>) => onChange({ ...value, ...v });
  return (
    <div className="inline-fields">
      <label>
        期限起算
        <select
          value={value.mode}
          onChange={(e) => change({ mode: e.target.value as Deadline["mode"] })}
        >
          <option value="assigned">指派日</option>
          <option value="hire">到職日</option>
          <option value="tenure">接任日</option>
          <option value="fixed">年度固定日期</option>
        </select>
      </label>
      {value.mode === "fixed" ? (
        <>
          <label>
            月份
            <input
              type="number"
              min="1"
              max="12"
              value={value.month}
              onChange={(e) => change({ month: Number(e.target.value) })}
            />
          </label>
          <label>
            日期／last 為月底
            <input
              value={value.day}
              onChange={(e) => change({ day: e.target.value })}
            />
          </label>
          <label>
            截止後加入
            <select
              value={value.late}
              onChange={(e) =>
                change({ late: e.target.value as Deadline["late"] })
              }
            >
              <option value="makeup">指定天數補訓</option>
              <option value="exempt">當年度免修</option>
            </select>
          </label>
        </>
      ) : (
        <label>
          起算後天數
          <input
            type="number"
            min="0"
            value={value.days}
            onChange={(e) => change({ days: Number(e.target.value) })}
          />
        </label>
      )}
      <label>
        新增訓練已過原期限時補訓天數
        <input
          type="number"
          min="0"
          value={value.makeup_days}
          onChange={(e) => change({ makeup_days: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}
export function LinkEditor({
  links,
  courses,
  onChange,
}: {
  links: Link[];
  courses: Course[];
  onChange: (v: Link[]) => void;
}) {
  return (
    <div className="links-editor">
      {links.map((link, i) => (
        <div className="subpanel" key={i}>
          <label>
            指定課程
            <select
              value={link.course_id}
              onChange={(e) =>
                onChange(
                  links.map((l, n) =>
                    n === i ? { ...l, course_id: e.target.value } : l,
                  ),
                )
              }
            >
              <option value="">請選擇</option>
              {courses
                .filter((c) => c.published && c.active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.published?.title}
                  </option>
                ))}
            </select>
          </label>
          <DeadlineEditor
            value={link.deadline}
            onChange={(deadline) =>
              onChange(links.map((l, n) => (n === i ? { ...l, deadline } : l)))
            }
          />
          <button
            type="button"
            onClick={() => onChange(links.filter((_, n) => n !== i))}
          >
            移除課程來源
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([
            ...links,
            { course_id: "", deadline: { ...defaultDeadline } },
          ])
        }
      >
        新增連結課程
      </button>
    </div>
  );
}
export function MaterialLibrary({materials,done}:{materials:Material[];done:()=>void}) {
  const [editing,setEditing]=useState<Material|null>(null);
  const [draft,setDraft]=useState<Material>({id:"",title:"",kind:"text",content:"",active:true});
  const [message,setMessage]=useState("");
  const edit=(m?:Material)=>{const next=m||{id:"",title:"",kind:"text" as const,content:"",active:true};setEditing(next);setDraft({...next});setMessage("");};
  async function save(){
    try{
      const content=draft.kind==="youtube"?youtubeId(draft.content):draft.content;
      await materialApi("save",{id:draft.id,title:draft.title,kind:draft.kind,content,summary:draft.id?"更新教材":"建立教材"});
      setMessage("教材已儲存，可供多個課程引用。");setEditing(null);await done();
    }catch(e){setMessage((e as Error).message);}
  }
  return <>
    <section className="workflow-intro"><span>獨立資產</span><h2>教材庫</h2><p>教材可先建立、單獨維護並重複用於多個課程；停用教材不會改寫已發布課程的歷史快照。</p></section>
    <div className="button-row"><button className="primary" onClick={()=>edit()}>新增教材</button></div>
    <div className="course-grid material-library-grid">{materials.map(m=><article className="course-card" key={m.id}>
      <span className="badge">{m.active===false?"已停用":m.kind==="text"?"網頁文字":m.kind==="pdf"?"PDF":"YouTube"}</span>
      <h2>{m.title}</h2><p>版本 {m.revision||1} · 可獨立使用</p>
      <div className="button-row"><button onClick={()=>edit(m)}>編輯教材</button><button onClick={async()=>{await materialApi("set_active",{id:m.id,active:m.active===false});await done();}}>{m.active===false?"重新啟用":"停用"}</button></div>
    </article>)}</div>
    {editing&&<section className="panel focused-editor"><p className="eyebrow">MATERIAL ASSET</p><h2>{draft.id?"編輯教材":"新增教材"}</h2>
      <div className="form-grid"><label>教材名稱<input value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label><label>教材類型<select value={draft.kind} onChange={e=>setDraft({...draft,kind:e.target.value as Material["kind"],content:""})}><option value="text">網頁文字</option><option value="pdf">PDF</option><option value="youtube">YouTube</option></select></label></div>
      <label>{draft.kind==="text"?"教材內容":draft.kind==="pdf"?"PDF HTTPS 網址":"YouTube 網址或 11 碼識別碼"}<textarea rows={draft.kind==="text"?10:3} value={draft.content} onChange={e=>setDraft({...draft,content:e.target.value})}/></label>
      <div className="button-row"><button onClick={()=>setEditing(null)}>取消</button><button className="primary" disabled={!draft.title.trim()||!draft.content.trim()} onClick={()=>void save()}>儲存教材</button></div>{message&&<p role="status">{message}</p>}
    </section>}
  </>;
}

type CourseSection="basic"|"materials"|"questions"|"schedule"|"publish";
export function CourseEditor({course,materials,departments,done}:{course:Course|null;materials:Material[];departments:{id:string;name:string}[];done:()=>void}) {
  const [section,setSection]=useState<CourseSection>("basic");
  const [value, setValue] = useState<CourseDraft>(course?.draft || {
      title:"",seconds:3600,pass_score:80,question_count:1,minutes:0,cycle:"once",departments:[],start:"",end:"",material_ids:[],questions:[],
    });
  const [id, setId] = useState(course?.id);
  const [summary, setSummary] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const patch = (v: Partial<CourseDraft>) =>
    setValue((c) => ({ ...c, ...v }));
  async function save(publish = false) {
    setBusy(true);
    setMessage("");
    try {
      const c = await api<{ id: string }>("course_save", { id, content:value });
      setId(c.id);
      if (publish) await api("course_publish", { id: c.id, summary });
      setMessage(
        publish ? "已發布；既有要求保留原時數與進度。" : "草稿已儲存。",
      );
      done();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const updateQuestion = (index: number, v: Partial<Question>) =>
    patch({
      questions: value.questions.map((q, i) =>
        i === index ? { ...q, ...v } : q,
      ),
    });
  const activeMaterials=materials.filter(m=>m.active!==false);
  const checks=[
    [!!value.title.trim()&&value.seconds>0,"基本資料完整"],
    [value.material_ids.length>0&&value.material_ids.every(x=>activeMaterials.some(m=>m.id===x)),"至少引用一份啟用教材"],
    [value.questions.length>=value.question_count&&value.questions.every(q=>q.prompt.trim()&&q.options.length>=2&&q.correct?.length&&value.material_ids.includes(q.material_id)),"題庫與教材對照完整"],
    [!value.start||!value.end||new Date(value.end)>new Date(value.start),"常規開課期間有效"],
  ] as [boolean,string][];
  return <section className="panel course-workflow">
      <div className="editor-heading"><div><p className="eyebrow">COURSE WORKFLOW</p><h2>{course?value.title||"未命名課程":"建立新課程"}</h2></div><span className="badge">{course?.published?"已發布":"草稿"}</span></div>
      <nav className="course-steps">{([['basic','1 基本設定'],['materials','2 引用教材'],['questions','3 題庫'],['schedule','4 常規開課'],['publish','5 發布檢查']] as [CourseSection,string][]).map(([id,label])=><button key={id} className={section===id?"selected":""} onClick={()=>setSection(id)}>{label}</button>)}</nav>
      {section==="basic"&&<><div className="section-explainer"><strong>基本設定</strong><span>只定義課程本身，不包含教材內容或開課對象。</span></div><div className="form-grid">
        <label>
          課程名稱
          <input
            value={value.title}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </label>
        <label>
          總學習分鐘數
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={value.seconds / 60}
            onChange={(e) => patch({ seconds: Number(e.target.value) * 60 })}
          />
        </label>
        <label>
          及格分數
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={value.pass_score}
            onChange={(e) => patch({ pass_score: Number(e.target.value) })}
          />
        </label>
        <label>
          抽題數
          <input
            type="number"
            min="1"
            value={value.question_count}
            onChange={(e) => patch({ question_count: Number(e.target.value) })}
          />
        </label>
        <label>
          測驗限時分鐘（0 不限時）
          <input
            type="number"
            min="0"
            value={value.minutes}
            onChange={(e) => patch({ minutes: Number(e.target.value) })}
          />
        </label>
        <label>
          訓練週期
          <input value="草稿階段不開課" disabled />
        </label>
      </div><div className="button-row"><button onClick={()=>void save()}>儲存基本設定</button><button className="primary" onClick={()=>setSection("materials")}>下一步：引用教材</button></div></>}
      {section==="materials"&&<><div className="section-explainer"><strong>引用教材</strong><span>只選擇教材庫中的資產；要新增或修改教材，請到「教材庫」。</span></div><div className="material-picker">{activeMaterials.map(m=><label className={value.material_ids.includes(m.id)?"selected":""} key={m.id}><input type="checkbox" checked={value.material_ids.includes(m.id)} onChange={e=>patch({material_ids:e.target.checked?[...value.material_ids,m.id]:value.material_ids.filter(id=>id!==m.id)})}/><span><strong>{m.title}</strong><small>{m.kind==="text"?"網頁文字":m.kind==="pdf"?"PDF":"YouTube"} · 版本 {m.revision||1}</small></span></label>)}</div>{!activeMaterials.length&&<p className="warning">教材庫尚無啟用教材。請先到「教材庫」建立，課程草稿仍可先儲存。</p>}<div className="button-row"><button onClick={()=>void save()}>儲存教材引用</button><button className="primary" onClick={()=>setSection("questions")}>下一步：建立題庫</button></div></>}
      {section==="schedule"&&<><div className="section-explainer"><strong>常規開課設定</strong><span>設定課程發布後的適用部門、週期與開放期間；不在這裡編輯教材。</span></div><div className="form-grid"><label>訓練週期<select value={value.cycle} onChange={e=>patch({cycle:e.target.value as CourseDraft["cycle"]})}><option value="once">一次性</option><option value="annual">每年必修</option></select></label><label>開課時間（空白立即）<input type="datetime-local" value={value.start?.slice(0,16)||""} onChange={e=>patch({start:e.target.value?e.target.value+":00+08:00":""})}/></label><label>結束時間（空白永久）<input type="datetime-local" value={value.end?.slice(0,16)||""} onChange={e=>patch({end:e.target.value?e.target.value+":00+08:00":""})}/></label></div><fieldset>
        <legend>適用部門（不勾選為全公司）</legend>
        {departments.map((d) => (
          <label className="check" key={d.id}>
            <input
              type="checkbox"
              checked={value.departments.includes(d.id)}
              onChange={(e) =>
                patch({
                  departments: e.target.checked
                    ? [...value.departments, d.id]
                    : value.departments.filter((id) => id !== d.id),
                })
              }
            />
            {d.name}
          </label>
        ))}
      </fieldset><div className="button-row"><button onClick={()=>void save()}>儲存常規開課設定</button><button className="primary" onClick={()=>setSection("publish")}>下一步：發布檢查</button></div></>}
      {section==="questions"&&<><div className="section-explainer"><strong>題庫</strong><span>題目可先存草稿；發布前再完成答案與教材對照，不會反過來阻擋教材建立。</span></div>
      <p>發布前會檢查可用題數、答案及教材對照。複選題必須全部選對才得分。</p>
      {value.questions.map((q, i) => (
        <fieldset key={q.id}>
          <legend>題目 {i + 1}</legend>
          <label>
            題型
            <select
              value={q.kind}
              onChange={(e) =>
                updateQuestion(i, {
                  kind: e.target.value as Question["kind"],
                  ...(e.target.value === "boolean"
                    ? { options: ["是", "否"], correct: [0] }
                    : {}),
                })
              }
            >
              <option value="single">單選</option>
              <option value="multiple">複選</option>
              <option value="boolean">是非</option>
            </select>
          </label>
          <label>
            題幹
            <textarea
              value={q.prompt}
              onChange={(e) => updateQuestion(i, { prompt: e.target.value })}
            />
          </label>
          {q.options.map((o, n) => (
            <div className="option-editor" key={n}>
              <input
                aria-label={`第 ${i + 1} 題選項 ${n + 1}`}
                value={o}
                onChange={(e) =>
                  updateQuestion(i, {
                    options: q.options.map((v, j) =>
                      j === n ? e.target.value : v,
                    ),
                  })
                }
              />
              <label className="check">
                <input
                  type={q.kind === "multiple" ? "checkbox" : "radio"}
                  name={`correct-${q.id}`}
                  checked={q.correct?.includes(n) || false}
                  onChange={() =>
                    updateQuestion(i, {
                      correct:
                        q.kind === "multiple"
                          ? q.correct?.includes(n)
                            ? q.correct.filter((v) => v !== n)
                            : [...(q.correct || []), n]
                          : [n],
                    })
                  }
                />
                正確答案
              </label>
            </div>
          ))}
          {q.kind !== "boolean" && (
            <button
              onClick={() => updateQuestion(i, { options: [...q.options, ""] })}
            >
              增加選項
            </button>
          )}
          <label>
            對應教材
            <select
              value={q.material_id}
              onChange={(e) =>
                updateQuestion(i, { material_id: e.target.value })
              }
            >
              <option value="">請選擇</option>
              {activeMaterials.filter(m=>value.material_ids.includes(m.id)).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            頁碼、章節或影片秒數
            <input
              value={q.reference || ""}
              onChange={(e) => updateQuestion(i, { reference: e.target.value })}
            />
          </label>
          <label>
            解析
            <textarea
              value={q.explanation || ""}
              onChange={(e) =>
                updateQuestion(i, { explanation: e.target.value })
              }
            />
          </label>
          <button
            onClick={() =>
              patch({ questions: value.questions.filter((_, n) => n !== i) })
            }
          >
            刪除此題
          </button>
        </fieldset>
      ))}
      <button
        onClick={() =>
          patch({
            questions: [
              ...value.questions,
              {
                id: crypto.randomUUID(),
                kind: "single",
                prompt: "",
                options: ["", ""],
                correct: [0],
                explanation: "",
                material_id: value.material_ids[0] || "",
              },
            ],
          })
        }
      >
        新增題目
      </button><div className="button-row"><button onClick={()=>void save()}>儲存題庫草稿</button><button className="primary" onClick={()=>setSection("schedule")}>下一步：常規開課</button></div></>}
      {section==="publish"&&<><div className="section-explainer"><strong>發布檢查</strong><span>前面各區都可獨立存草稿；只有發布才要求全部通過。</span></div><div className="publish-checklist">{checks.map(([ok,label])=><p className={ok?"ready":"pending"} key={label}><b>{ok?"✓":"!"}</b>{label}</p>)}</div><label>
        發布摘要
        <input value={summary} onChange={(e) => setSummary(e.target.value)} />
      </label>
      <div className="button-row">
        <button disabled={busy} onClick={() => void save()}>
          儲存草稿
        </button>
        <button
          className="primary"
          disabled={busy || !summary.trim() || checks.some(([ok])=>!ok)}
          onClick={() => void save(true)}
        >
          發布／僅更新內容
        </button>
      </div></>}
      <p role="status">{message}</p>
    </section>;
}
export function JobEditor({
  job,
  courses,
  departments,
  publishable,
  done,
}: {
  job: Job | null;
  courses: Course[];
  departments: { id: string; name: string }[];
  publishable: boolean;
  done: () => void;
}) {
  const [value, setValue] = useState<JobContent>(
    job?.draft || { name: "", purpose: "", duties: [], training: [] },
  );
  const [dep, setDep] = useState(
    job?.department_id || departments[0]?.id || "",
  );
  const [id, setId] = useState(job?.id);
  const [summary, setSummary] = useState("");
  const [message, setMessage] = useState("");
  const change = (v: Partial<JobContent>) => setValue((c) => ({ ...c, ...v }));
  async function save(publish = false) {
    try {
      const r = await api<{ id: string }>("job_save", {
        id,
        department_id: dep,
        content: value,
      });
      setId(r.id);
      if (publish) await api("job_publish", { id: r.id, summary });
      setMessage(
        publish ? "已發布並套用訓練來源。" : "草稿已儲存，尚不影響員工。",
      );
      done();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <section className="panel">
      <h2>職務說明書</h2>
      <label>
        所屬部門
        <select
          disabled={!!job}
          value={dep}
          onChange={(e) => setDep(e.target.value)}
        >
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        職務名稱
        <input
          value={value.name}
          onChange={(e) => change({ name: e.target.value })}
        />
      </label>
      <label>
        職務目的
        <textarea
          value={value.purpose}
          onChange={(e) => change({ purpose: e.target.value })}
        />
      </label>
      <h3>工作職責</h3>
      {value.duties.map((d, i) => (
        <fieldset key={d.id}>
          <legend>職責 {i + 1}</legend>
          <textarea
            aria-label={`職責 ${i + 1}`}
            value={d.text}
            onChange={(e) =>
              change({
                duties: value.duties.map((v, n) =>
                  n === i ? { ...v, text: e.target.value } : v,
                ),
              })
            }
          />
          <LinkEditor
            links={d.training}
            courses={courses}
            onChange={(training) =>
              change({
                duties: value.duties.map((v, n) =>
                  n === i ? { ...v, training } : v,
                ),
              })
            }
          />
          <div className="button-row">
            <button
              disabled={i === 0}
              onClick={() => {
                const next = [...value.duties];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                change({ duties: next });
              }}
            >
              上移
            </button>
            <button
              disabled={i === value.duties.length - 1}
              onClick={() => {
                const next = [...value.duties];
                [next[i + 1], next[i]] = [next[i], next[i + 1]];
                change({ duties: next });
              }}
            >
              下移
            </button>
            <button
              onClick={() =>
                change({ duties: value.duties.filter((_, n) => n !== i) })
              }
            >
              刪除職責
            </button>
          </div>
        </fieldset>
      ))}
      <button
        onClick={() =>
          change({
            duties: [
              ...value.duties,
              { id: crypto.randomUUID(), text: "", training: [] },
            ],
          })
        }
      >
        新增職責
      </button>
      <h3>職務直接要求的課程</h3>
      <LinkEditor
        links={value.training}
        courses={courses}
        onChange={(training) => change({ training })}
      />
      <label>
        發布摘要
        <input value={summary} onChange={(e) => setSummary(e.target.value)} />
      </label>
      <div className="button-row">
        <button onClick={() => void save()}>儲存草稿</button>
        {publishable && (
          <button
            className="primary"
            disabled={!summary.trim()}
            onClick={() => void save(true)}
          >
            發布職務說明書
          </button>
        )}
      </div>
      <p role="status">{message}</p>
    </section>
  );
}
