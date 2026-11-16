begin;

-- A system role is stronger than ordinary access, so it must always make the
-- corresponding application visible in the shared entrance.
create or replace function training.grant_enables_membership()
returns trigger
language plpgsql
set search_path=pg_catalog,public,training
as $$
begin
  insert into training.memberships(employee_id,system_code)
  values(new.employee_id,new.system_code)
  on conflict do nothing;
  return new;
end
$$;

drop trigger if exists grant_enables_membership on training.grants;
create trigger grant_enables_membership
after insert or update of employee_id,system_code on training.grants
for each row execute function training.grant_enables_membership();

insert into training.memberships(employee_id,system_code)
select employee_id,system_code from training.grants
on conflict do nothing;

create or replace function public.portal_access_profile_rpc(action text,p jsonb default '{}')
returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,training
as $$
declare
  me uuid=training.actor();
  target uuid=nullif(p->>'employee_id','')::uuid;
  requested_systems text[];
  requested_admins text[];
begin
  if not training.allowed(me,'admin') then raise exception '僅平台管理員可設定完整權限'; end if;
  if action<>'save' then raise exception '未知權限設定操作'; end if;
  if not exists(select 1 from public.employees where id=target) then raise exception '找不到人員'; end if;
  if jsonb_typeof(coalesce(p->'systems','[]'::jsonb))<>'array'
    or jsonb_typeof(coalesce(p->'admin_systems','[]'::jsonb))<>'array' then raise exception '權限格式錯誤'; end if;

  select coalesce(array_agg(distinct value),array[]::text[]) into requested_systems
  from jsonb_array_elements_text(coalesce(p->'systems','[]'::jsonb));
  select coalesce(array_agg(distinct value),array[]::text[]) into requested_admins
  from jsonb_array_elements_text(coalesce(p->'admin_systems','[]'::jsonb));
  if exists(select 1 from unnest(requested_systems) code where not exists(select 1 from training.systems s where s.code=code and s.enabled))
    or exists(select 1 from unnest(requested_admins) code where not (code=any(requested_systems))) then raise exception '包含未啟用系統或管理權限未開通入口'; end if;

  if target=me and not ('training'=any(requested_admins)) and not exists(
    select 1 from training.grants g join public.employees e on e.id=g.employee_id
    where g.employee_id<>target and g.system_code='training' and g.role='admin' and g.all_departments and e.active
  ) then raise exception '不可移除最後一位平台管理員'; end if;

  -- Remove obsolete grants first, then memberships. Scoped manager/HR roles are
  -- preserved while their system remains enabled.
  delete from training.grants where employee_id=target
    and (role='admin' or not (system_code=any(requested_systems)));
  delete from training.memberships where employee_id=target and not (system_code=any(requested_systems));
  insert into training.memberships(employee_id,system_code)
    select target,code from unnest(requested_systems) code on conflict do nothing;
  insert into training.grants(employee_id,system_code,role,all_departments)
    select target,code,'admin',true from unnest(requested_admins) code on conflict do nothing;

  insert into training.audit(actor,action,body) values(me,'access_profile_save',jsonb_build_object(
    'employee_id',target,'systems',to_jsonb(requested_systems),'admin_systems',to_jsonb(requested_admins)));
  return jsonb_build_object('employee_id',target,'systems',to_jsonb(requested_systems),'admin_systems',to_jsonb(requested_admins));
end
$$;

revoke all on function training.grant_enables_membership() from public,anon,authenticated;
revoke all on function public.portal_access_profile_rpc(text,jsonb) from public,anon;
grant execute on function public.portal_access_profile_rpc(text,jsonb) to authenticated;
insert into training.migrations(version) values('202611160008') on conflict do nothing;
notify pgrst,'reload schema';
commit;
