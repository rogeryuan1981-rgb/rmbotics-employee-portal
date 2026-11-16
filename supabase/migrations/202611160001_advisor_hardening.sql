-- Supabase advisor hardening for the unified employee portal.
begin;

-- PostgreSQL grants EXECUTE to PUBLIC for new functions by default. Keep only
-- the one anonymous pre-login lookup and preserve existing explicit grants to
-- authenticated/service_role for application RPCs.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.is_login_email_allowed(text) to anon, authenticated;

-- Fix the search path on private helpers flagged by the security advisor.
alter function training.end_day(date)
  set search_path = pg_catalog, public, training;
alter function training.open(training.courses)
  set search_path = pg_catalog, public, training;
alter function training.applies(jsonb, uuid)
  set search_path = pg_catalog, public, training;
alter function training.course_public(jsonb)
  set search_path = pg_catalog, public, training;
alter function training.assert_course(jsonb)
  set search_path = pg_catalog, public, training;

-- Keep extension-owned objects outside the exposed public schema.
create schema if not exists extensions;
alter extension citext set schema extensions;

-- Cache auth lookups once per statement rather than once per employee row.
drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- PostgreSQL does not automatically index foreign keys. Add only missing
-- leading-column indexes so joins and referential actions remain efficient.
do $$
declare
  r record;
  index_name text;
begin
  for r in
    select
      n.nspname as schema_name,
      c.relname as table_name,
      con.conname,
      string_agg(quote_ident(a.attname), ', ' order by k.ord) as columns_sql
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral unnest(con.conkey) with ordinality k(attnum, ord)
    join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
    where con.contype = 'f'
      and n.nspname in ('public', 'training')
      and not exists (
        select 1
        from pg_index i
        where i.indrelid = con.conrelid
          and i.indisvalid
          and (i.indkey::smallint[])[0:cardinality(con.conkey)-1] = con.conkey
      )
    group by n.nspname, c.relname, con.conname
  loop
    index_name := left(r.conname, 55) || '_idx';
    execute format(
      'create index if not exists %I on %I.%I (%s)',
      index_name,
      r.schema_name,
      r.table_name,
      r.columns_sql
    );
  end loop;
end $$;

insert into training.migrations(version)
values ('202611160001')
on conflict do nothing;

commit;
