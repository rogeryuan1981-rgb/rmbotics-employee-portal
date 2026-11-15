begin;
alter table training.outbox add column if not exists first_attempt_at timestamptz;
alter table training.outbox add column if not exists delivery_email text;
-- Persist a new device at Auth session creation, even if the browser closes before
-- its first portal request. Deleting a newer session must never revive an older one.
create or replace function training.remember_auth_session() returns trigger language plpgsql security definer set search_path=pg_catalog,public,training as $$
begin
 insert into training.auth_session_heads as h(employee_id,session_id,created_at)
 select e.id,new.id,new.created_at from public.employees e where e.user_id=new.user_id and e.active
 on conflict(employee_id) do update set session_id=excluded.session_id,created_at=excluded.created_at
 where (h.created_at,h.session_id)<(excluded.created_at,excluded.session_id);
 return new;
end $$;
drop trigger if exists portal_remember_auth_session on auth.sessions;
create trigger portal_remember_auth_session after insert on auth.sessions for each row execute function training.remember_auth_session();
insert into training.auth_session_heads as h(employee_id,session_id,created_at)
select distinct on (e.id) e.id,s.id,s.created_at from public.employees e join auth.sessions s on s.user_id=e.user_id where e.active
order by e.id,s.created_at desc,s.id desc
on conflict(employee_id) do update set session_id=excluded.session_id,created_at=excluded.created_at
where (h.created_at,h.session_id)<(excluded.created_at,excluded.session_id);
-- Keep existing snack admin roles; explicit snack grants are independent of training roles.
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=pg_catalog,public,training as $$
 select exists(select 1 from public.employees e where e.id=public.current_employee_id() and
 (e.role='admin' or exists(select 1 from training.grants g where g.employee_id=e.id and g.system_code='snack-vote' and g.role='admin')));
$$;
-- The old roster may explicitly enable snack access after adding a person. It cannot grant training.
create or replace function public.snack_enable_employee(p_employee_id uuid) returns void language plpgsql security definer set search_path=pg_catalog,public,training as $$
begin
 if not public.is_admin() then raise exception 'ADMIN_REQUIRED';end if;
 insert into training.memberships values(p_employee_id,'snack-vote') on conflict do nothing;
end $$;
revoke all on function public.snack_enable_employee(uuid) from public,anon;
grant execute on function public.snack_enable_employee(uuid) to authenticated;
-- Prevent a stale identity from continuing to access an employee after an Email change,
-- including changes made by the legacy roster UI.
create or replace function training.reset_email_identity() returns trigger language plpgsql security definer set search_path=pg_catalog,public,training as $$
begin
 if lower(old.email::text)<>lower(new.email::text) then new.user_id=null;end if;return new;
end $$;
drop trigger if exists employees_00_email_reset on public.employees;
create trigger employees_00_email_reset before update of email on public.employees for each row execute function training.reset_email_identity();
-- Immediate lifecycle changes apply even when the old snack UI disables an employee.
create or replace function training.employee_lifecycle() returns trigger language plpgsql security definer set search_path=pg_catalog,public,training as $$
begin
 if old.active and not new.active then
  if coalesce(btrim(new.inactive_reason),'')='' then raise exception '停用時須填原因';end if;
  update training.requirements set lifecycle='cancelled',cancellation_reason=new.inactive_reason,ever_overdue=ever_overdue or now()>=due where employee_id=new.id and lifecycle='active' and completed_at is null;
 end if;
 return new;
end $$;
drop trigger if exists employees_training_lifecycle on public.employees;
create trigger employees_training_lifecycle after update of active on public.employees for each row execute function training.employee_lifecycle();
-- Existing public-table policies must not give snack admins authority to move shared departments.
create or replace function training.protect_shared_fields() returns trigger language plpgsql security invoker set search_path=pg_catalog,public,training as $$
begin
 if current_user in ('authenticated','anon') and (new.department_id is distinct from old.department_id or new.hire_date is distinct from old.hire_date) then raise exception '請由共用員工名冊依人資權限維護部門及到職日';end if;
 return new;
end $$;
drop trigger if exists employees_protect_training_fields on public.employees;
create trigger employees_protect_training_fields before update on public.employees for each row execute function training.protect_shared_fields();
revoke all on all functions in schema training from public,anon,authenticated;
insert into training.migrations(version) values('202611150005') on conflict do nothing;
notify pgrst, 'reload schema';
commit;
