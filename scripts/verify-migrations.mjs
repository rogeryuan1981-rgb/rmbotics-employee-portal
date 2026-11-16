import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createDatabase } from "./local-db.mjs";
const db = await createDatabase(undefined, async (db) => {
  await db.exec(
    "insert into public.employees(name,email,work_location_id,role) select '既有零食員工','existing@example.test',id,'admin' from public.work_locations limit 1",
  );
});
const existing = (
  await db.query(
    "select id from public.employees where email='existing@example.test'",
  )
).rows[0].id;
assert.equal(
  (
    await db.query(
      "select count(*)::int n from training.memberships where employee_id=$1 and system_code=$2",
      [existing, "snack-vote"],
    )
  ).rows[0].n,
  1,
);
assert.equal(
  (await db.query("select count(*)::int n from training.grants")).rows[0].n,
  0,
);
const products = (
  await db.query(
    "select md5(string_agg(to_jsonb(p)::text,'' order by id)) v from public.products p",
  )
).rows[0].v;
const fresh = (
  await db.query(
    "insert into public.employees(name,email) values('新進員工','fresh@example.test') returning id",
  )
).rows[0].id;
const migrationFiles = (
  await readdir(new URL("../supabase/migrations/", import.meta.url))
).sort();
for (const file of migrationFiles)
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/" + file, import.meta.url),
      "utf8",
    ),
  );
assert.equal(
  (
    await db.query(
      "select count(*)::int n from training.memberships where employee_id=$1",
      [fresh],
    )
  ).rows[0].n,
  0,
);
assert.equal(
  (
    await db.query(
      "select md5(string_agg(to_jsonb(p)::text,'' order by id)) v from public.products p",
    )
  ).rows[0].v,
  products,
);
assert.equal(
  (await db.query("select count(*)::int n from training.migrations")).rows[0].n,
  migrationFiles.length,
);
await db.close();
console.log(
  "PASS: migration replay preserves existing snack qualification/products, grants no training admin, and does not enroll later employees.",
);
