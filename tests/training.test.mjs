import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, seed, rpc, asUser } from "../scripts/local-db.mjs";
const db = await createDatabase();
await seed(db);
const uid = (i) => "20000000-0000-0000-0000-" + String(i).padStart(12, "0");
const eid = (i) => "30000000-0000-0000-0000-" + String(i).padStart(12, "0");
const dep = (i) => "10000000-0000-0000-0000-" + String(i).padStart(12, "0");
const sessions = {};
for (let i = 1; i <= 5; i++)
  sessions[i] = (
    await db.query(
      "insert into auth.sessions(user_id) values($1) returning id",
      [uid(i)],
    )
  ).rows[0].id;
const call = (i, a, p) => rpc(db, uid(i), sessions[i], a, p);
const sql = async (q, p = []) => (await db.query(q, p)).rows;
const deadline = { mode: "assigned", days: 30, makeup_days: 30 };
function course(overrides = {}) {
  return {
    title: "行政訓練",
    seconds: 15,
    pass_score: 80,
    question_count: 2,
    minutes: 30,
    cycle: "once",
    departments: [],
    start: "",
    end: "",
    materials: [
      { id: "m1", title: "教材一", kind: "text", content: "教材內容" },
      { id: "m2", title: "教材二", kind: "text", content: "第二教材" },
    ],
    questions: [
      {
        id: "q1",
        kind: "single",
        prompt: "一加一？",
        options: ["二", "三"],
        correct: [0],
        explanation: "一加一為二",
        material_id: "m1",
      },
      {
        id: "q2",
        kind: "multiple",
        prompt: "選擇偶數",
        options: ["二", "四", "三"],
        correct: [0, 1],
        explanation: "偶數為二與四",
        material_id: "m2",
      },
      {
        id: "q3",
        kind: "boolean",
        prompt: "一是奇數",
        options: ["是", "否"],
        correct: [0],
        explanation: "是",
        material_id: "m1",
      },
    ],
    ...overrides,
  };
}
async function publish(content = course()) {
  const c = await call(1, "course_save", { content });
  await call(1, "course_publish", { id: c.id, summary: "測試發布" });
  return c.id;
}
async function assign(cid, i = 2, key = "test") {
  return (
    await call(1, "assign", {
      employee_id: eid(i),
      course_id: cid,
      deadline,
      key,
    })
  ).id;
}
async function learned(rid, seconds = 15) {
  await sql("update training.requirements set seconds=$1 where id=$2", [
    seconds,
    rid,
  ]);
}
let cid, rid;
test("A01/B18/B19 independent memberships, customer-service disabled, own frontend only", async () => {
  const ctx = await call(1, "context");
  assert.equal(ctx.systems.length, 2);
  assert.ok(!ctx.systems.some((s) => s.code === "customer-service"));
  assert.equal((await call(3, "mine")).requirements.length, 0);
  await assert.rejects(call(2, "admin"), /管理權限/);
  await assert.rejects(
    asUser(db, uid(2), sessions[2], (tx) =>
      tx.query("select * from training.papers"),
    ),
    /permission denied/,
  );
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec("set local role anon");
      await tx.query("select public.portal_rpc('context')");
    }),
    /permission denied/,
  );
});
test("A03/A04 scoped manager and HR cannot edit courses, grants or unowned records", async () => {
  assert.equal((await call(3, "admin")).employees.length, 4);
  for (const i of [3, 4]) {
    await assert.rejects(
      call(i, "course_save", { content: course() }),
      /僅管理員/,
    );
    await assert.rejects(call(i, "grant", {}), /管理員/);
    await assert.rejects(
      call(i, "person_save", {
        id: eid(5),
        name: "改名",
        email: "other@example.test",
        department_id: dep(1),
      }),
      /權限/,
    );
  }
  cid = await publish();
  rid = await assign(cid);
  await assert.rejects(call(3, "requirement", { id: rid }), /自己的/);
  await assert.rejects(call(4, "requirement", { id: rid }), /自己的/);
  await assert.rejects(
    call(3, "assign", { employee_id: eid(5), course_id: cid, deadline }),
    /權限/,
  );
});
test("A09/A13 publication validates bank size, material mapping, and backend enforces learning threshold", async () => {
  await assert.rejects(publish(course({ question_count: 9 })), /題數不足/);
  const broken = course();
  broken.questions[0].material_id = "missing";
  await assert.rejects(publish(broken), /對應(?:課程|已引用的)教材/);
  await assert.rejects(call(2, "exam_start", { id: rid }), /時數尚未達標/);
});
test("A08/A10/A11/A25/B07 server clock lease, dedup sequence, two materials aggregate, load/visibility/idleness", async () => {
  let lease = await call(2, "lease", { id: rid, material_id: "m1" });
  const beat = (token, seq, extra = {}) =>
    call(2, "heartbeat", {
      id: rid,
      token,
      seq,
      visible: true,
      loaded: true,
      interacted: true,
      ...extra,
    });
  await beat(lease.token, 1);
  await sql(
    "update training.leases set last_at=now()-interval '10 seconds' where employee_id=$1",
    [eid(2)],
  );
  let a = await beat(lease.token, 2);
  assert.ok(Number(a.seconds) >= 9 && Number(a.seconds) <= 11);
  let b = await beat(lease.token, 2);
  assert.equal(Number(b.seconds), Number(a.seconds));
  const old = lease;
  lease = await call(2, "lease", { id: rid, material_id: "m2" });
  await assert.rejects(beat(old.token, 3), /另一分頁/);
  await beat(lease.token, 1);
  await sql(
    "update training.leases set last_at=now()-interval '10 seconds' where employee_id=$1",
    [eid(2)],
  );
  b = await beat(lease.token, 2);
  assert.ok(Number(b.seconds) >= 19);
  await sql(
    "update training.leases set last_at=now()-interval '10 seconds' where employee_id=$1",
    [eid(2)],
  );
  a = await beat(lease.token, 3, { loaded: false });
  assert.equal(Number(a.seconds), Number(b.seconds));
  await sql(
    "update training.leases set eligible=true,last_interaction=now()-interval '6 minutes',last_at=now()-interval '15 seconds' where employee_id=$1",
    [eid(2)],
  );
  a = await beat(lease.token, 4, { interacted: false });
  assert.equal(a.eligible, false);
  assert.equal(Number(a.seconds), Number(b.seconds));
});
test("A12/A13/A15/B05 snapshot resume, exact multiple selection, failed answer secrecy, success feedback and no retake", async () => {
  let p = await call(2, "exam_start", { id: rid });
  assert.equal(new Set(p.questions.map((q) => q.id)).size, 2);
  assert.ok(
    p.questions.every((q) => !("correct" in q) && !("explanation" in q)),
  );
  assert.equal((await call(2, "exam_start", { id: rid })).id, p.id);
  for (const q of p.questions)
    await call(2, "exam_save", {
      id: rid,
      paper_id: p.id,
      question_id: q.id,
      answer: [1],
    });
  p = await call(2, "exam_submit", { id: rid, paper_id: p.id });
  assert.equal(p.passed, false);
  assert.ok(p.questions.every((q) => !("correct" in q)));
  const p2 = await call(2, "exam_start", { id: rid });
  assert.notEqual(p2.id, p.id);
  for (const q of p2.questions) {
    const original = course().questions.find((x) => x.id === q.id);
    await call(2, "exam_save", {
      id: rid,
      paper_id: p2.id,
      question_id: q.id,
      answer: original.correct,
    });
  }
  const pass = await call(2, "exam_submit", { id: rid, paper_id: p2.id });
  assert.equal(pass.passed, true);
  assert.equal(pass.score, 100);
  assert.ok(pass.questions.every((q) => "correct" in q && "explanation" in q));
  const again = await call(2, "exam_submit", { id: rid, paper_id: p2.id });
  assert.equal(again.submitted_at, pass.submitted_at);
  await assert.rejects(call(2, "exam_start", { id: rid }), /目前不能/);
  assert.equal((await call(2, "exam_history", { id: rid })).length, 2);
});
test("B03 content-only update keeps thresholds, paper snapshot survives bank edits", async () => {
  const id = await publish();
  const r = await assign(id);
  await learned(r);
  const p = await call(2, "exam_start", { id: r });
  await call(1, "course_save", {
    id,
    content: course({
      seconds: 600,
      pass_score: 100,
      questions: course().questions.map((q) => ({ ...q, prompt: "新版" })),
    }),
  });
  await call(1, "course_publish", { id, summary: "僅更新內容" });
  assert.equal(
    (await call(2, "requirement", { id: r })).requirement.rules.seconds,
    15,
  );
  assert.deepEqual(
    (await call(2, "exam_start", { id: r })).questions,
    p.questions,
  );
});
test("A14/A16/B08 timed paper expires with saved answers even after course ends; no new attempts", async () => {
  const id = await publish();
  const r = await assign(id);
  await learned(r);
  let p = await call(2, "exam_start", { id: r });
  for (const q of p.questions)
    await call(2, "exam_save", {
      id: r,
      paper_id: p.id,
      question_id: q.id,
      answer: course().questions.find((x) => x.id === q.id).correct,
    });
  await sql(
    "update training.papers set expires_at=now()-interval '1 second' where id=$1",
    [p.id],
  );
  await sql(
    "update training.requirements set due=now()-interval '1 day' where id=$1",
    [r],
  );
  await call(1, "course_save", {
    id,
    content: course({ end: "2020-01-01T00:00:00+08:00" }),
  });
  await call(1, "course_publish", { id, summary: "結束開課" });
  p = (await call(2, "exam_history", { id: r }))[0];
  assert.equal(p.passed, true);
  assert.ok(p.submitted_at);
  const rr = (await call(2, "requirement", { id: r })).requirement;
  assert.ok(new Date(rr.completed_at) >= new Date(rr.completed_due));
  await assert.rejects(
    call(2, "lease", { id: r, material_id: "m1" }),
    /不能學習/,
  );
});
test("A20/B04/B06 completed deadline immutable; Taiwan day-zero; rational grade unaffected by rounding", async () => {
  const before = (await call(2, "requirement", { id: rid })).requirement;
  await call(3, "deadline", {
    id: rid,
    date: "2030-01-01",
    reason: "管理備註",
  });
  const after = (await call(2, "requirement", { id: rid })).requirement;
  assert.equal(after.due, before.due);
  assert.equal(after.completed_due, before.completed_due);
  const boundary = (
    await sql("select training.end_day('2026-07-01'::date+30) t")
  )[0].t;
  assert.equal(new Date(boundary).toISOString(), "2026-07-31T16:00:00.000Z");
  const c = await publish(course({ question_count: 3, pass_score: 66.67 }));
  const r = await assign(c);
  await learned(r);
  const p = await call(2, "exam_start", { id: r });
  for (const [index, q] of p.questions.entries())
    if (index < 2)
      await call(2, "exam_save", {
        id: r,
        paper_id: p.id,
        question_id: q.id,
        answer: course().questions.find((x) => x.id === q.id).correct,
      });
  const result = await call(2, "exam_submit", { id: r, paper_id: p.id });
  assert.equal(result.score, 66.67);
  assert.equal(result.passed, false);
});
test("A05/A06/A07/A21/B01/B02/B10 job drafts isolated, sources merged, transfer continuity and no silent deadline extension", async () => {
  const c = await publish();
  const content = {
    name: "行政專員",
    purpose: "辦理行政",
    duties: [{ id: "d1", text: "協調", training: [] }],
    training: [
      { course_id: c, deadline: { mode: "hire", days: 1, makeup_days: 7 } },
    ],
  };
  const j1 = await call(4, "job_save", { department_id: dep(1), content });
  const j2 = await call(4, "job_save", {
    department_id: dep(1),
    content: {
      ...content,
      name: "兼任職務",
      training: [{ course_id: c, deadline: { mode: "assigned", days: 3 } }],
    },
  });
  assert.equal(
    (
      await sql(
        "select count(*)::int n from training.requirements where course_id=$1",
        [c],
      )
    )[0].n,
    0,
  );
  await call(1, "job_publish", { id: j1.id, summary: "發布" });
  await call(1, "job_publish", { id: j2.id, summary: "發布" });
  const person = {
    id: eid(2),
    name: "測試學員",
    email: "learner@example.test",
    hire_date: "2020-01-01",
    department_id: dep(1),
    active: true,
    tenures: [
      { job_id: j1.id, start_date: "2020-01-01" },
      { job_id: j2.id, start_date: "2020-01-01" },
    ],
  };
  await call(4, "person_save", person);
  let rr = await sql("select * from training.requirements where course_id=$1", [
    c,
  ]);
  assert.equal(rr.length, 1);
  const due = rr[0].due;
  assert.equal(
    (
      await sql(
        "select count(*)::int n from training.sources where requirement_id=$1 and active",
        [rr[0].id],
      )
    )[0].n,
    2,
  );
  await call(4, "person_save", { ...person, tenures: [person.tenures[0]] });
  rr = await sql("select * from training.requirements where course_id=$1", [c]);
  assert.equal(rr[0].lifecycle, "active");
  assert.equal(new Date(rr[0].due).toISOString(), new Date(due).toISOString());
  await call(4, "person_save", { ...person, tenures: [] });
  assert.equal(
    (
      await sql(
        "select lifecycle from training.requirements where course_id=$1",
        [c],
      )
    )[0].lifecycle,
    "cancelled",
  );
  await call(4, "person_save", { ...person, tenures: [person.tenures[0]] });
  assert.equal(
    (
      await sql(
        "select count(*)::int n from training.requirements where course_id=$1",
        [c],
      )
    )[0].n,
    2,
  );
});
test("A17/A18/A19/B11 annual late policy, retraining independent, disable cancels while close retains", async () => {
  const c = await publish(course({ cycle: "annual" }));
  const r = (
    await call(1, "assign", {
      employee_id: eid(2),
      course_id: c,
      deadline: { mode: "fixed", month: 1, day: 1, late: "exempt" },
      key: "annual",
    })
  ).id;
  assert.equal(
    (await call(2, "requirement", { id: r })).requirement.lifecycle,
    "exempt",
  );
  await call(1, "retrain", {
    id: c,
    employees: [eid(2)],
    batch: "rev2",
    deadline,
    seconds: 1,
    retest: false,
  });
  const rows = await sql(
    "select * from training.requirements where course_id=$1",
    [c],
  );
  assert.equal(rows.length, 2);
  assert.equal(Number(rows.find((x) => x.batch === "rev2").seconds), 0);
  await call(1, "course_disable", { id: c, reason: "課程停用" });
  assert.equal(
    (
      await sql(
        "select lifecycle from training.requirements where course_id=$1 and batch='rev2'",
        [c],
      )
    )[0].lifecycle,
    "cancelled",
  );
});
test("A22/B12/B13 live disable, reinstate preserves history, new employees have no snack entitlement, email stable id", async () => {
  const saved = await call(4, "person_save", {
    name: "新人",
    email: "new@example.test",
    department_id: dep(1),
    active: true,
  });
  assert.equal(
    (
      await sql(
        "select count(*)::int n from training.memberships where employee_id=$1",
        [saved.id],
      )
    )[0].n,
    0,
  );
  await call(1, "person_save", {
    id: saved.id,
    name: "新人",
    email: "renamed@example.test",
    department_id: dep(1),
    active: true,
  });
  assert.equal(
    (
      await sql(
        "select id from public.employees where email='renamed@example.test'",
      )
    )[0].id,
    saved.id,
  );
  await sql(
    "update public.employees set active=false,inactive_reason='本機停用測試' where id=$1",
    [eid(2)],
  );
  await assert.rejects(call(2, "context"), /停用/);
  await sql("update public.employees set active=true where id=$1", [eid(2)]);
  assert.ok((await call(2, "mine")).requirements.length > 0);
});
test("A24/B14 Excel preview all-or-nothing, stale protection and scoped exports", async () => {
  const rows = [
    { name: "匯入一", email: "one@example.test", department: "行政部" },
    { name: "匯入二", email: "invalid", department: "行政部" },
  ];
  const bad = await call(4, "import_preview", {
    rows,
    fields: ["name", "department"],
  });
  assert.ok(bad.errors.length);
  await assert.rejects(call(4, "import_commit", { id: bad.id }), /整批未寫入/);
  assert.equal(
    (
      await sql(
        "select count(*)::int n from public.employees where email='one@example.test'",
      )
    )[0].n,
    0,
  );
  rows[1].email = "two@example.test";
  const preview = await call(4, "import_preview", {
    rows,
    fields: ["name", "department"],
  });
  assert.equal(preview.errors.length, 0, JSON.stringify(preview.errors));
  const ok = await call(4, "import_commit", { id: preview.id });
  assert.equal(ok.count, 2);
  await call(4, "import_commit", { id: preview.id });
  const p = await call(4, "import_preview", { rows, fields: ["name"] });
  await sql(
    "update public.employees set name='異動' where email='one@example.test'",
  );
  await assert.rejects(call(4, "import_commit", { id: p.id }), /重新預覽/);
  assert.ok(
    (await call(3, "report", { kind: "summary" })).every(
      (x) => x.department_id === dep(1),
    ),
  );
});
test("A23/A25/B09/B15 notifications grouped per recipient/day, HR off, closed course suppresses reminders", async () => {
  const c = await publish();
  const r = await assign(c, 2, "notify");
  await sql(
    "update training.requirements set due=((now() at time zone 'Asia/Taipei')::date)::timestamp at time zone 'Asia/Taipei' where id=$1",
    [r],
  );
  await sql(
    "update training.settings set value=jsonb_set(value,'{time}','\"00:00\"')",
  );
  await sql("select training.tick()");
  await sql("select training.tick()");
  const rows = await sql(
    "select employee_id,count(*)::int n from training.outbox group by employee_id,day",
  );
  assert.ok(rows.every((x) => x.n === 1));
  assert.equal(
    (
      await sql(
        "select count(*)::int n from training.audit where actor=$1 and action='digest_event'",
        [eid(4)],
      )
    )[0].n,
    0,
  );
  assert.ok(
    (
      await sql(
        "select count(*)::int n from training.audit where actor=$1 and action='digest_event'",
        [eid(3)],
      )
    )[0].n > 0,
  );
  const claim = (await sql("select public.training_mail_claim() v"))[0].v;
  if (claim) {
    await sql("select public.training_mail_ack($1)", [claim.id]);
    assert.equal(
      (
        await sql("select status from training.outbox where id=$1", [claim.id])
      )[0].status,
      "sent",
    );
  }
});
test("B20 existing snack SQL actions and restrictive qualification gate", async () => {
  assert.ok(
    (
      await asUser(db, uid(2), sessions[2], (tx) =>
        tx.query("select * from public.products"),
      )
    ).rows.length > 0,
  );
  await sql(
    "delete from training.memberships where employee_id=$1 and system_code='snack-vote'",
    [eid(2)],
  );
  assert.equal(
    (
      await asUser(db, uid(2), sessions[2], (tx) =>
        tx.query("select * from public.products"),
      )
    ).rows.length,
    0,
  );
  await assert.rejects(
    asUser(db, uid(2), sessions[2], (tx) =>
      tx.query(
        "select public.nominate_product(gen_random_uuid(),gen_random_uuid())",
      ),
    ),
    /NOT_AUTHORIZED/,
  );
  assert.ok(
    (await call(2, "context")).systems.some((s) => s.code === "training"),
  );
});
test("answers never appear inside requirement rule snapshots or personal course lists", async () => {
  const mine = await call(2, "mine");
  assert.ok(!JSON.stringify(mine).includes('"correct":['));
  const detail = await call(2, "requirement", { id: rid });
  assert.ok(!JSON.stringify(detail).includes('"explanation"'));
});
test("B17 foreground video remains eligible without input; paused/background/offline gaps do not count", async () => {
  const c = await publish(
    course({
      materials: [
        { id: "m1", title: "影片", kind: "youtube", content: "M7lc1UVf-VE" },
        { id: "m2", title: "文字", kind: "text", content: "內容" },
      ],
    }),
  );
  const r = await assign(c);
  const lease = await call(2, "lease", { id: r, material_id: "m1" });
  const beat = (seq, extra = {}) =>
    call(2, "heartbeat", {
      id: r,
      token: lease.token,
      seq,
      visible: true,
      loaded: true,
      playing: true,
      interacted: false,
      ...extra,
    });
  await beat(1);
  await sql(
    "update training.leases set last_at=now()-interval '15 seconds',last_interaction=now()-interval '40 minutes' where employee_id=$1",
    [eid(2)],
  );
  const a = await beat(2);
  assert.equal(a.eligible, true);
  assert.ok(Number(a.seconds) >= 14);
  await sql(
    "update training.leases set last_at=now()-interval '15 seconds' where employee_id=$1",
    [eid(2)],
  );
  const b = await beat(3, { playing: false });
  assert.equal(Number(a.seconds), Number(b.seconds));
  await beat(4);
  await sql(
    "update training.leases set last_at=now()-interval '1 hour' where employee_id=$1",
    [eid(2)],
  );
  const gap = await beat(5);
  assert.equal(Number(gap.seconds), Number(a.seconds));
  await sql(
    "update training.leases set last_at=now()-interval '15 seconds' where employee_id=$1",
    [eid(2)],
  );
  const bg = await beat(6, { visible: false });
  assert.equal(Number(bg.seconds), Number(a.seconds));
});
test("B08/B09 period conflict rolls back manual assignment, automatic conflict preserved, reopening retains progress", async () => {
  const c = await publish(
    course({ end: new Date(Date.now() + 86400000).toISOString() }),
  );
  await assert.rejects(assign(c), /開課期間衝突/);
  assert.equal(
    (
      await sql(
        "select count(*)::int n from training.requirements where course_id=$1",
        [c],
      )
    )[0].n,
    0,
  );
  const r = (
    await call(1, "assign", {
      employee_id: eid(2),
      course_id: c,
      deadline,
      key: "conflict",
      conflict_reason: "預計另行延長開課",
    })
  ).id;
  await learned(r, 4);
  await call(1, "course_save", {
    id: c,
    content: course({ end: "2020-01-01T00:00:00+08:00" }),
  });
  await call(1, "course_publish", { id: c, summary: "結束" });
  assert.equal(
    (await call(2, "requirement", { id: r })).requirement.lifecycle,
    "active",
  );
  await assert.rejects(call(2, "exam_start", { id: r }), /目前不能/);
  await call(1, "course_save", { id: c, content: course() });
  await call(1, "course_publish", { id: c, summary: "重新開課" });
  assert.equal(
    Number((await call(2, "requirement", { id: r })).requirement.seconds),
    4,
  );
});
test("missing hire date and invalid deadline never invent dates or partially assign", async () => {
  const c = await publish();
  const person = await call(1, "person_save", {
    name: "缺日期",
    email: "nodate@example.test",
    department_id: dep(1),
    active: true,
    systems: ["training"],
  });
  await assert.rejects(
    call(1, "assign", {
      employee_id: person.id,
      course_id: c,
      key: "no-date",
      deadline: { mode: "hire", days: 30 },
    }),
    /缺少到職日/,
  );
  await assert.rejects(
    call(1, "assign", {
      employee_id: person.id,
      course_id: c,
      key: "negative",
      deadline: { mode: "assigned", days: -1 },
    }),
    /天數錯誤/,
  );
});
test("Excel blank fields preserve existing data and unselected department cannot move staff", async () => {
  const rows = [
    { name: "", email: "learner@example.test", department: "", hire_date: "" },
  ];
  let p = await call(4, "import_preview", {
    rows,
    fields: ["name", "department", "hire_date"],
  });
  assert.deepEqual(p.errors, []);
  await call(4, "import_commit", { id: p.id });
  assert.equal(
    (
      await sql("select name,department_id from public.employees where id=$1", [
        eid(2),
      ])
    )[0].name,
    "測試學員",
  );
  p = await call(4, "import_preview", {
    rows: [
      { name: "測試學員", email: "learner@example.test", department: "服務部" },
    ],
    fields: ["name"],
  });
  assert.deepEqual(p.errors, []);
  await call(4, "import_commit", { id: p.id });
  assert.equal(
    (
      await sql("select department_id from public.employees where id=$1", [
        eid(2),
      ])
    )[0].department_id,
    dep(1),
  );
});
test("Email change immediately revokes old identity, new login maps to the stable employee id", async () => {
  const before = (
    await sql(
      "select count(*)::int n from training.requirements where employee_id=$1",
      [eid(5)],
    )
  )[0].n;
  await call(1, "person_save", {
    id: eid(5),
    name: "外部門學員",
    email: "changed@example.test",
    department_id: dep(2),
    hire_date: "2026-01-01",
    active: true,
  });
  await assert.rejects(call(5, "context"), /停用或登入/);
  const u = (
    await sql(
      "insert into auth.users(email) values('changed@example.test') returning id",
    )
  )[0].id;
  const sess = (
    await sql("insert into auth.sessions(user_id) values($1) returning id", [u])
  )[0].id;
  const context = await rpc(db, u, sess, "context");
  assert.equal(context.employee.id, eid(5));
  assert.equal(
    (
      await sql(
        "select count(*)::int n from training.requirements where employee_id=$1",
        [eid(5)],
      )
    )[0].n,
    before,
  );
});
test("backend department protections survive direct legacy REST updates", async () => {
  await assert.rejects(
    asUser(db, uid(1), sessions[1], (tx) =>
      tx.query("update public.employees set department_id=$1 where id=$2", [
        dep(2),
        eid(2),
      ]),
    ),
    /共用員工名冊/,
  );
  await assert.rejects(
    call(1, "system", {
      code: "customer-service",
      name: "客服",
      entry: "#/customer-service",
      enabled: true,
      sort_order: 30,
    }),
    /尚未接入/,
  );
});
test("B20 snack campaign creation, member snapshot, nomination, voting and purchasing regressions", async () => {
  await sql(
    "insert into training.memberships values($1,'snack-vote') on conflict do nothing",
    [eid(2)],
  );
  const location = (
    await sql("select id from public.work_locations limit 1")
  )[0].id;
  const run = (i, q, p = []) =>
    asUser(db, uid(i), sessions[i], (tx) => tx.query(q, p));
  await run(1, "select public.set_employee_locations($1,$2::uuid[])", [
    eid(2),
    [location],
  ]);
  const campaign = (
    await run(
      1,
      "insert into public.campaigns(label,budget,base_budget,work_location_id,start_at,nomination_deadline,voting_deadline,purchase_at,status) values('本機回歸',1000,1000,$1,now()-interval '2 days',now()+interval '1 day',now()+interval '2 days',now()+interval '3 days','active') returning id",
      [location],
    )
  ).rows[0].id;
  await run(1, "select public.set_campaign_locations($1,$2::uuid[])", [
    campaign,
    [location],
  ]);
  await run(1, "select public.set_employee_locations($1,$2::uuid[])", [
    eid(3),
    [location],
  ]);
  await run(1, "select public.snapshot_active_employees($1)", [campaign]);
  const products = await sql(
    "select id from public.products where active limit 2",
  );
  await run(
    1,
    "update public.products set reference_price=20 where id=any($1::uuid[])",
    [products.map((p) => p.id)],
  );
  await run(2, "select public.set_nominations($1,$2::uuid[])", [
    campaign,
    [products[0].id],
  ]);
  assert.equal(
    (
      await sql(
        "select count(*)::int n from public.nominations where campaign_id=$1",
        [campaign],
      )
    )[0].n,
    1,
  );
  await run(3, "select public.set_nominations($1,$2::uuid[])", [
    campaign,
    [products[1].id],
  ]);
  await run(
    1,
    "update public.campaigns set nomination_deadline=now()-interval '1 hour' where id=$1",
    [campaign],
  );
  await run(2, "select public.set_regular_votes($1,$2::uuid[])", [
    campaign,
    [products[1].id],
  ]);
  assert.ok(
    (
      await sql(
        "select count(*)::int n from public.votes where campaign_id=$1",
        [campaign],
      )
    )[0].n >= 2,
  );
  await run(1, "select public.generate_purchase_plan($1)", [campaign]);
  assert.ok(
    (
      await sql(
        "select count(*)::int n from public.purchase_items where campaign_id=$1",
        [campaign],
      )
    )[0].n > 0,
  );
});
test("A17 annual scheduler produces a new obligation without changing last-year completion", async () => {
  const c = await publish(course({ cycle: "annual" }));
  const job = await call(1, "job_save", {
    department_id: dep(1),
    content: {
      name: "年度職務",
      purpose: "年度受訓",
      duties: [],
      training: [{ course_id: c, deadline }],
    },
  });
  await call(1, "job_publish", { id: job.id, summary: "年度發布" });
  await call(1, "person_save", {
    id: eid(3),
    name: "測試主管",
    email: "manager@example.test",
    department_id: dep(1),
    hire_date: "2026-01-01",
    active: true,
    tenures: [{ job_id: job.id, start_date: "2026-01-01" }],
  });
  const previous = (
    await sql(
      "select id from training.requirements where course_id=$1 and employee_id=$2",
      [c, eid(3)],
    )
  )[0].id;
  await sql(
    "update training.requirements set cycle=(extract(year from now() at time zone 'Asia/Taipei')-1)::int::text,completed_at=now()-interval '1 year',completed_due=due where id=$1",
    [previous],
  );
  await sql("select training.tick()");
  await sql("select training.tick()");
  const rows = await sql(
    "select * from training.requirements where course_id=$1 and employee_id=$2",
    [c, eid(3)],
  );
  assert.equal(rows.length, 2);
  assert.ok(rows.find((x) => x.id === previous).completed_at);
  assert.equal(rows.find((x) => x.id !== previous).completed_at, null);
  assert.equal(Number(rows.find((x) => x.id !== previous).seconds), 0);
});
test("A19 retraining without re-exam completes only after this batch learns enough time", async () => {
  const c = await publish();
  await call(1, "retrain", {
    id: c,
    employees: [eid(2)],
    batch: "no-retest",
    deadline,
    seconds: 1,
    retest: false,
  });
  const r = (
    await sql(
      "select id from training.requirements where course_id=$1 and batch='no-retest'",
      [c],
    )
  )[0].id;
  const lease = await call(2, "lease", { id: r, material_id: "m1" });
  const beat = (seq) =>
    call(2, "heartbeat", {
      id: r,
      token: lease.token,
      seq,
      loaded: true,
      visible: true,
      interacted: true,
    });
  await beat(1);
  await sql(
    "update training.leases set last_at=now()-interval '2 seconds' where employee_id=$1",
    [eid(2)],
  );
  await beat(2);
  assert.ok((await call(2, "requirement", { id: r })).requirement.completed_at);
  assert.equal((await call(2, "exam_history", { id: r })).length, 0);
});
test("explicit snack admin grant works without granting training course authority", async () => {
  await call(1, "grant", {
    employee_id: eid(3),
    system_code: "snack-vote",
    role: "admin",
    all_departments: true,
  });
  assert.equal(
    (
      await asUser(db, uid(3), sessions[3], (tx) =>
        tx.query("select public.is_admin() value"),
      )
    ).rows[0].value,
    true,
  );
  assert.ok(
    (await call(3, "context")).grants.some(
      (g) => g.system_code === "snack-vote" && g.role === "admin",
    ),
  );
  await assert.rejects(
    call(3, "course_save", { content: course() }),
    /僅管理員/,
  );
});
test("older device cannot regain access when the newer device logs out", async () => {
  const newer = (await sql("insert into auth.sessions(user_id) values($1) returning id", [uid(2)]))[0].id;
  await assert.rejects(call(2, "context"), /登入已失效/);
  await sql("delete from auth.sessions where id=$1", [newer]);
  await assert.rejects(call(2, "context"), /登入已失效/);
});
test.after(async () => {
  await db.close();
});
