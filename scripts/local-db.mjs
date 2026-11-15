import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { readFile, readdir } from "node:fs/promises";

export async function createDatabase(path, beforeMigrations) {
  const db = new PGlite({ dataDir: path, extensions: { citext } });
  await db.waitReady;
  const exists = await db.query("select to_regclass('public.employees') as t");
  if (!exists.rows[0].t) {
    await db.exec(`
   create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth;create schema storage;
   create table auth.users(id uuid primary key default gen_random_uuid(),email text,created_at timestamptz default now());
   create table auth.sessions(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users,created_at timestamptz default now());
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text);
   create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
   create publication supabase_realtime;
   grant usage on schema public,auth to authenticated,anon,service_role;
  `);
    // pgcrypto extension is unnecessary here: PostgreSQL core supplies gen_random_uuid().
    await db.exec(
      (
        await readFile(
          new URL("../supabase/final.sql", import.meta.url),
          "utf8",
        )
      ).replace("create extension if not exists pgcrypto;", ""),
    );
    await db.exec(
      "grant select,insert,update,delete on all tables in schema public to authenticated;",
    );
  }
  if (beforeMigrations) await beforeMigrations(db);
  for (const file of (
    await readdir(new URL("../supabase/migrations/", import.meta.url))
  ).sort()) {
    if (file.endsWith(".sql"))
      await db.exec(
        await readFile(
          new URL("../supabase/migrations/" + file, import.meta.url),
          "utf8",
        ),
      );
  }
  return db;
}
export async function asUser(db, user, session, fn) {
  return db.transaction(async (tx) => {
    await tx.query(
      "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
      [user, JSON.stringify({ sub: user, session_id: session })],
    );
    await tx.exec("set local role authenticated");
    return fn(tx);
  });
}
export async function rpc(db, user, session, action, p = {}) {
  return asUser(
    db,
    user,
    session,
    async (tx) =>
      (
        await tx.query("select public.portal_rpc($1,$2::jsonb) as value", [
          action,
          JSON.stringify(p),
        ])
      ).rows[0].value,
  );
}
export async function seed(db) {
  const count = await db.query(
    "select count(*)::int n from public.employees where email='admin@example.test'",
  );
  if (count.rows[0].n) return;
  await db.exec(`
 insert into training.departments(id,name) values('10000000-0000-0000-0000-000000000001','行政部'),('10000000-0000-0000-0000-000000000002','服務部');
 insert into auth.users(id,email) values('20000000-0000-0000-0000-000000000001','admin@example.test'),('20000000-0000-0000-0000-000000000002','learner@example.test'),('20000000-0000-0000-0000-000000000003','manager@example.test'),('20000000-0000-0000-0000-000000000004','hr@example.test'),('20000000-0000-0000-0000-000000000005','other@example.test');
 insert into public.employees(id,user_id,name,email,role,work_location_id,department_id,hire_date)
 select ('30000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,('20000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 (array['測試管理員','測試學員','測試主管','測試人資','外部門學員'])[i],(array['admin@example.test','learner@example.test','manager@example.test','hr@example.test','other@example.test'])[i],
 case when i=1 then 'admin' else 'employee' end,(select id from public.work_locations limit 1),case when i=5 then '10000000-0000-0000-0000-000000000002'::uuid else '10000000-0000-0000-0000-000000000001'::uuid end,current_date-40 from generate_series(1,5) i;
 insert into training.memberships select id,'training' from public.employees;
 insert into training.memberships select id,'snack-vote' from public.employees;
 select training.bootstrap_admin('admin@example.test');
 insert into training.grants(employee_id,system_code,role,department_id) values('30000000-0000-0000-0000-000000000003','training','manager','10000000-0000-0000-0000-000000000001'),('30000000-0000-0000-0000-000000000004','training','hr','10000000-0000-0000-0000-000000000001');
 `);
}
