begin;

alter table training.departments add column if not exists parent_id uuid;
alter table training.departments add column if not exists manager_employee_id uuid references public.employees(id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'training.departments'::regclass
      and conname = 'departments_parent_id_fkey'
  ) then
    alter table training.departments
      add constraint departments_parent_id_fkey
      foreign key (parent_id) references training.departments(id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'training.departments'::regclass
      and conname = 'departments_not_own_parent'
  ) then
    alter table training.departments
      add constraint departments_not_own_parent
      check (parent_id is null or parent_id <> id);
  end if;
end $$;

create index if not exists departments_parent_id_idx
  on training.departments(parent_id);
create index if not exists departments_manager_employee_id_idx
  on training.departments(manager_employee_id);

create or replace function training.department_contains(root_id uuid, node_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public, training
as $$
  with recursive branch(id) as (
    select root_id
    union
    select d.id
    from training.departments d
    join branch b on d.parent_id = b.id
  )
  select node_id is not null and exists(select 1 from branch where id = node_id)
$$;

create or replace function training.allowed(e uuid, op text, dep uuid default null)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public, training
as $$
 select training.member(e,'training') and exists(
  select 1 from training.grants g where g.employee_id=e and g.system_code='training'
  and ((g.role='admin' and g.all_departments)
   or (op in ('manage','people','job') and g.role='hr' and (g.all_departments or training.department_contains(g.department_id,dep)))
   or (op='manage' and g.role='manager' and (g.all_departments or training.department_contains(g.department_id,dep))))
 )
$$;

create or replace function training.applies(c jsonb, dep uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public, training
as $$
 select coalesce(jsonb_array_length(c->'departments'),0)=0
 or exists(
  select 1 from jsonb_array_elements_text(coalesce(c->'departments','[]'::jsonb)) selected(id)
  where training.department_contains(selected.id::uuid,dep)
 )
$$;

revoke all on function training.department_contains(uuid,uuid) from public,anon,authenticated;
revoke all on function training.allowed(uuid,text,uuid) from public,anon,authenticated;
revoke all on function training.applies(jsonb,uuid) from public,anon,authenticated;

create or replace function public.portal_organization_rpc(action text, p jsonb default '{}')
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, training
as $$
declare
  me uuid = training.actor();
  organization_id uuid = coalesce(nullif(p->>'id','')::uuid, gen_random_uuid());
  parent_department_id uuid = nullif(p->>'parent_id','')::uuid;
  saved training.departments;
  previous_manager uuid;
  next_manager uuid = nullif(p->>'manager_employee_id','')::uuid;
begin
  if not training.allowed(me,'admin') then
    raise exception '僅平台管理員可維護組織';
  end if;
  if action <> 'save' then raise exception '未知組織操作'; end if;
  if coalesce(btrim(p->>'name'),'') = '' then raise exception '請填組織名稱'; end if;
  if parent_department_id = organization_id then raise exception '上層組織不可選擇自己'; end if;
  if parent_department_id is not null and not exists(
    select 1 from training.departments where id = parent_department_id
  ) then raise exception '找不到上層組織'; end if;
  if next_manager is not null and not exists(
    select 1 from public.employees where id = next_manager and active
  ) then raise exception '單位主管不存在或已停用'; end if;
  if nullif(p->>'id','') is not null and exists(
    with recursive descendants(id) as (
      select id from training.departments where parent_id = organization_id
      union
      select d.id from training.departments d join descendants x on d.parent_id = x.id
    )
    select 1 from descendants where id = parent_department_id
  ) then raise exception '上層組織不可選擇自己的下層'; end if;

  select manager_employee_id into previous_manager from training.departments where id=organization_id;
  insert into training.departments(id,name,parent_id,manager_employee_id)
  values(organization_id,btrim(p->>'name'),parent_department_id,next_manager)
  on conflict(id) do update set name=excluded.name,parent_id=excluded.parent_id,manager_employee_id=excluded.manager_employee_id
  returning * into saved;
  if previous_manager is distinct from next_manager and previous_manager is not null then
    delete from training.grants
    where employee_id=previous_manager and system_code='training' and role='manager'
      and department_id=organization_id and not all_departments;
  end if;
  if next_manager is not null then
    insert into training.memberships(employee_id,system_code)
    values(next_manager,'training') on conflict do nothing;
    insert into training.grants(employee_id,system_code,role,department_id,all_departments)
    values(next_manager,'training','manager',organization_id,false)
    on conflict do nothing;
  end if;
  insert into training.audit(actor,action,body)
  values(me,'organization_save',to_jsonb(saved));
  return to_jsonb(saved);
end
$$;

revoke all on function public.portal_organization_rpc(text,jsonb) from public,anon;
grant execute on function public.portal_organization_rpc(text,jsonb) to authenticated;

-- Extend manager/HR email scope to descendants as well as the selected unit.
do $$
declare ddl text;
begin
  ddl := pg_get_functiondef('training.tick()'::regprocedure);
  ddl := replace(ddl,
    '(gr.all_departments or gr.department_id=rr.department_id)',
    '(gr.all_departments or training.department_contains(gr.department_id,rr.department_id))');
  execute ddl;

  ddl := pg_get_functiondef('public.training_mail_claim()'::regprocedure);
  ddl := replace(ddl,
    '(g.all_departments or g.department_id=e.department_id)',
    '(g.all_departments or training.department_contains(g.department_id,e.department_id))');
  execute ddl;
end $$;

revoke all on function training.tick() from public,anon,authenticated;
revoke all on function public.training_mail_claim() from public,anon,authenticated;
grant execute on function public.training_mail_claim() to service_role;

insert into training.migrations(version) values('202611160006') on conflict do nothing;
notify pgrst, 'reload schema';
commit;
