begin;

create or replace function training.is_protected_owner(employee uuid)
returns boolean
language sql stable security definer
set search_path=pg_catalog,public,training
as $$
  select exists(
    select 1 from public.employees e
    where e.id=employee and lower(e.email::text)='rogeryu@rmbotics.com'
  )
$$;

create or replace function training.protect_owner_employee()
returns trigger
language plpgsql security definer
set search_path=pg_catalog,public,training
as $$
begin
  if tg_op='DELETE' then
    if lower(old.email::text)='rogeryu@rmbotics.com' then return null; end if;
    return old;
  end if;
  if lower(old.email::text)='rogeryu@rmbotics.com' then
    new.email=old.email;
    new.active=true;
    new.user_id=old.user_id;
  elsif lower(new.email::text)='rogeryu@rmbotics.com' then
    new.active=true;
  end if;
  return new;
end
$$;

create or replace function training.ensure_owner_admin()
returns trigger
language plpgsql security definer
set search_path=pg_catalog,public,training
as $$
begin
  if lower(new.email::text)='rogeryu@rmbotics.com' then
    insert into training.memberships(employee_id,system_code)
    values(new.id,'training'),(new.id,'snack-vote') on conflict do nothing;
    insert into training.grants(employee_id,system_code,role,all_departments)
    values(new.id,'training','admin',true),(new.id,'snack-vote','admin',true)
    on conflict do nothing;
  end if;
  return new;
end
$$;

create or replace function training.protect_owner_membership()
returns trigger
language plpgsql security definer
set search_path=pg_catalog,public,training
as $$
begin
  if training.is_protected_owner(old.employee_id) and old.system_code in ('training','snack-vote') then
    if tg_op='DELETE' then return null; end if;
    return old;
  end if;
  return case when tg_op='DELETE' then old else new end;
end
$$;

create or replace function training.protect_owner_grant()
returns trigger
language plpgsql security definer
set search_path=pg_catalog,public,training
as $$
begin
  if training.is_protected_owner(old.employee_id) and old.system_code in ('training','snack-vote')
    and old.role='admin' and old.all_departments then
    if tg_op='DELETE' then return null; end if;
    return old;
  end if;
  return case when tg_op='DELETE' then old else new end;
end
$$;

drop trigger if exists protect_owner_employee on public.employees;
create trigger protect_owner_employee before update or delete on public.employees
for each row execute function training.protect_owner_employee();
drop trigger if exists ensure_owner_admin on public.employees;
create trigger ensure_owner_admin after insert or update of email,active,user_id on public.employees
for each row execute function training.ensure_owner_admin();
drop trigger if exists protect_owner_membership on training.memberships;
create trigger protect_owner_membership before update or delete on training.memberships
for each row execute function training.protect_owner_membership();
drop trigger if exists protect_owner_grant on training.grants;
create trigger protect_owner_grant before update or delete on training.grants
for each row execute function training.protect_owner_grant();

do $$
declare owner_id uuid;
begin
  select id into owner_id from public.employees where lower(email::text)='rogeryu@rmbotics.com';
  if owner_id is not null then
    update public.employees set active=true where id=owner_id;
    insert into training.memberships(employee_id,system_code)
    values(owner_id,'training'),(owner_id,'snack-vote') on conflict do nothing;
    insert into training.grants(employee_id,system_code,role,all_departments)
    values(owner_id,'training','admin',true),(owner_id,'snack-vote','admin',true)
    on conflict do nothing;
  end if;
end
$$;

revoke all on function training.is_protected_owner(uuid) from public,anon,authenticated;
revoke all on function training.protect_owner_employee() from public,anon,authenticated;
revoke all on function training.ensure_owner_admin() from public,anon,authenticated;
revoke all on function training.protect_owner_membership() from public,anon,authenticated;
revoke all on function training.protect_owner_grant() from public,anon,authenticated;
insert into training.migrations(version) values('202611160009') on conflict do nothing;
notify pgrst,'reload schema';
commit;
