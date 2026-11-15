-- Incremental migration. Apply after existing snack-vote schema; never run final.sql on production.
begin;
create schema if not exists training;
revoke all on schema training from public, anon, authenticated;
create table if not exists training.migrations(version text primary key, applied_at timestamptz default now());
create table if not exists training.departments(id uuid primary key default gen_random_uuid(), name text unique not null);
alter table public.employees add column if not exists hire_date date;
alter table public.employees add column if not exists inactive_reason text;
alter table public.employees add column if not exists department_id uuid references training.departments;
alter table public.employees alter column work_location_id drop not null;
create table if not exists training.systems(
 code text primary key, name text not null, entry text not null, admin_entry text, enabled boolean not null default false, sort_order int not null default 0);
insert into training.systems values
 ('training','教育訓練','#/training','#/training/admin',true,10),
 ('snack-vote','零食投票','#/','#/admin',true,20),
 ('customer-service','客服系統','','',false,30) on conflict do nothing;
create table if not exists training.memberships(employee_id uuid references public.employees, system_code text references training.systems, primary key(employee_id,system_code));
-- Keep the latest claimed device even after Supabase removes that Auth session.
create table if not exists training.auth_session_heads(employee_id uuid primary key references public.employees,session_id uuid not null,created_at timestamptz not null);
-- Preserve only the employees that already exist at this migration, exactly once.
insert into training.memberships select id,'snack-vote' from public.employees
 where not exists(select 1 from training.migrations where version='202611150001') on conflict do nothing;
create table if not exists training.grants(
 id uuid primary key default gen_random_uuid(),employee_id uuid not null references public.employees,
 system_code text not null references training.systems, role text not null check(role in ('admin','hr','manager')),
 department_id uuid references training.departments, all_departments boolean not null default false,
 check((all_departments and department_id is null) or (not all_departments and department_id is not null)));
create unique index if not exists grant_unique on training.grants(employee_id,system_code,role,coalesce(department_id,'00000000-0000-0000-0000-000000000000'::uuid));
create table if not exists training.jobs(
 id uuid primary key default gen_random_uuid(),department_id uuid not null references training.departments,
 draft jsonb not null, published jsonb, version int not null default 0);
create table if not exists training.job_versions(id uuid primary key default gen_random_uuid(),job_id uuid references training.jobs,version int not null,content jsonb not null,actor uuid references public.employees,at timestamptz default now(),summary text not null,unique(job_id,version));
create table if not exists training.tenures(
 id uuid primary key default gen_random_uuid(),employee_id uuid not null references public.employees,
 job_id uuid not null references training.jobs,start_date date not null,end_date date);
create unique index if not exists active_tenure on training.tenures(employee_id,job_id) where end_date is null;
create table if not exists training.courses(
 id uuid primary key default gen_random_uuid(),draft jsonb not null,published jsonb,version int not null default 0,
 active boolean not null default true,revision int not null default 0);
create table if not exists training.course_versions(id uuid primary key default gen_random_uuid(),course_id uuid references training.courses,version int not null,content jsonb not null,actor uuid references public.employees,at timestamptz default now(),summary text not null,unique(course_id,version));
create table if not exists training.requirements(
 id uuid primary key default gen_random_uuid(),employee_id uuid not null references public.employees,course_id uuid not null references training.courses,
 course_version int not null,cycle text not null,batch text not null default 'normal',generation int not null default 1,
 rules jsonb not null,original_due timestamptz not null,due timestamptz not null,
 lifecycle text not null default 'active' check(lifecycle in ('active','cancelled','exempt')),
 cancellation_reason text,seconds numeric not null default 0 check(seconds>=0),completed_at timestamptz,
 completed_due timestamptz,ever_overdue boolean not null default false,conflict_reason text,
 conflict_pending boolean not null default false,created_at timestamptz not null default now(),
 unique(employee_id,course_id,course_version,cycle,batch,generation));
create unique index if not exists active_requirement on training.requirements(employee_id,course_id,course_version,cycle,batch) where lifecycle in ('active','exempt');
create table if not exists training.sources(
 requirement_id uuid references training.requirements,source_key text not null,label text not null,due timestamptz not null,active boolean not null default true,
 primary key(requirement_id,source_key));
create table if not exists training.deadline_changes(id uuid primary key default gen_random_uuid(),requirement_id uuid references training.requirements,old_due timestamptz not null,new_due timestamptz not null,reason text not null,actor uuid references public.employees,at timestamptz default now());
create table if not exists training.leases(employee_id uuid primary key references public.employees,requirement_id uuid references training.requirements,material_id text not null,token uuid not null default gen_random_uuid(),seq int not null default 0,last_at timestamptz not null default now(),eligible boolean not null default false,last_interaction timestamptz not null default now());
create table if not exists training.positions(requirement_id uuid references training.requirements,material_id text,position numeric not null default 0,primary key(requirement_id,material_id));
create table if not exists training.papers(
 id uuid primary key default gen_random_uuid(),requirement_id uuid not null references training.requirements,
 questions jsonb not null,answers jsonb not null default '{}',pass_score numeric not null,started_at timestamptz not null default now(),expires_at timestamptz,
 submitted_at timestamptz,correct int,total int not null check(total>0),passed boolean,unique(id,requirement_id));
create unique index if not exists one_live_paper on training.papers(requirement_id) where submitted_at is null;
create table if not exists training.issues(id uuid primary key default gen_random_uuid(),employee_id uuid references public.employees,requirement_id uuid references training.requirements,material_id text,message text not null,resolution text,at timestamptz default now());
create table if not exists training.notifications(id uuid primary key default gen_random_uuid(),employee_id uuid references public.employees,requirement_id uuid references training.requirements,kind text not null,day date not null default (now() at time zone 'Asia/Taipei')::date,body jsonb not null,read_at timestamptz,unique(employee_id,requirement_id,kind,day));
create table if not exists training.settings(id boolean primary key default true check(id),value jsonb not null);
insert into training.settings values(true,'{"time":"09:00","before":[7,3,1],"overdue_every":7,"hr_digest":false}') on conflict do nothing;
create table if not exists training.outbox(id uuid primary key default gen_random_uuid(),employee_id uuid references public.employees,day date not null,body jsonb not null,status text not null default 'pending',attempts int not null default 0,claimed_at timestamptz,sent_at timestamptz,error text,unique(employee_id,day));
create table if not exists training.imports(id uuid primary key default gen_random_uuid(),actor uuid references public.employees,rows jsonb not null,fields jsonb not null,fingerprint text not null,errors jsonb not null,committed_at timestamptz,at timestamptz default now());
create table if not exists training.audit(id uuid primary key default gen_random_uuid(),actor uuid references public.employees,action text not null,body jsonb not null,at timestamptz default now());
create unique index if not exists digest_event_unique on training.audit(actor,(body->>'day'),(body->>'requirement_id')) where action='digest_event';
-- No direct REST access. All reads/writes go through the bounded RPC below.
do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname='training' loop
  execute format('alter table training.%I enable row level security',t.tablename);
  execute format('revoke all on training.%I from public,anon,authenticated',t.tablename);
 end loop;
end $$;
insert into training.migrations(version) values('202611150001') on conflict do nothing;
commit;
