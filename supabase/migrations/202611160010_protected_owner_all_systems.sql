begin;

create or replace function training.ensure_owner_admin()
returns trigger
language plpgsql security definer
set search_path=pg_catalog,public,training
as $$
begin
  if lower(new.email::text)='rogeryu@rmbotics.com' then
    insert into training.memberships(employee_id,system_code)
    select new.id,s.code from training.systems s on conflict do nothing;
    insert into training.grants(employee_id,system_code,role,all_departments)
    select new.id,s.code,'admin',true from training.systems s on conflict do nothing;
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
  if training.is_protected_owner(old.employee_id) then
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
  if training.is_protected_owner(old.employee_id) and old.role='admin' and old.all_departments then
    if tg_op='DELETE' then return null; end if;
    return old;
  end if;
  return case when tg_op='DELETE' then old else new end;
end
$$;

create or replace function training.ensure_owner_for_new_system()
returns trigger
language plpgsql security definer
set search_path=pg_catalog,public,training
as $$
declare owner_id uuid;
begin
  select id into owner_id from public.employees where lower(email::text)='rogeryu@rmbotics.com';
  if owner_id is not null then
    insert into training.memberships(employee_id,system_code) values(owner_id,new.code) on conflict do nothing;
    insert into training.grants(employee_id,system_code,role,all_departments)
    values(owner_id,new.code,'admin',true) on conflict do nothing;
  end if;
  return new;
end
$$;

drop trigger if exists ensure_owner_for_new_system on training.systems;
create trigger ensure_owner_for_new_system after insert on training.systems
for each row execute function training.ensure_owner_for_new_system();

do $$
declare owner_id uuid;
begin
  select id into owner_id from public.employees where lower(email::text)='rogeryu@rmbotics.com';
  if owner_id is not null then
    delete from training.grants g where g.employee_id=owner_id and g.role<>'admin'
      and exists(select 1 from training.grants a where a.employee_id=owner_id and a.system_code=g.system_code and a.role='admin' and a.all_departments);
    update training.grants set role='admin',department_id=null,all_departments=true
      where employee_id=owner_id and role<>'admin';
    insert into training.memberships(employee_id,system_code)
      select owner_id,s.code from training.systems s on conflict do nothing;
    insert into training.grants(employee_id,system_code,role,all_departments)
      select owner_id,s.code,'admin',true from training.systems s on conflict do nothing;
  end if;
end
$$;

revoke all on function training.ensure_owner_for_new_system() from public,anon,authenticated;
insert into training.migrations(version) values('202611160010') on conflict do nothing;
notify pgrst,'reload schema';
commit;
