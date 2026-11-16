begin;

create table if not exists training.external_courses(
  id uuid primary key default gen_random_uuid(),
  title text not null check(length(btrim(title)) between 1 and 200),
  provider text not null check(length(btrim(provider)) between 1 and 200),
  start_date date,
  end_date date,
  hours numeric(7,2) not null default 0 check(hours >= 0),
  notes text not null default '',
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  check(start_date is null or end_date is null or end_date >= start_date)
);

create table if not exists training.external_enrollments(
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references training.external_courses(id),
  employee_id uuid not null references public.employees(id),
  status text not null default 'assigned' check(status in ('assigned','submitted','approved','rejected')),
  certificate_path text,
  submitted_at timestamptz,
  reviewed_by uuid references public.employees(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  unique(course_id,employee_id)
);

create index if not exists external_courses_created_by_idx on training.external_courses(created_by);
create index if not exists external_enrollments_employee_id_idx on training.external_enrollments(employee_id);
create index if not exists external_enrollments_course_id_idx on training.external_enrollments(course_id);
create index if not exists external_enrollments_reviewed_by_idx on training.external_enrollments(reviewed_by);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('training-certificates','training-certificates',false,10485760,array['application/pdf','image/jpeg','image/png'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists training_certificates_insert on storage.objects;
create policy training_certificates_insert on storage.objects
for insert to authenticated with check(
  bucket_id='training-certificates'
  and (storage.foldername(name))[1] = training.actor()::text
  and exists(
    select 1 from training.external_enrollments x
    where x.id=((storage.foldername(name))[2])::uuid and x.employee_id=training.actor()
  )
);
drop policy if exists training_certificates_update on storage.objects;
create policy training_certificates_update on storage.objects
for update to authenticated using(
  bucket_id='training-certificates' and (storage.foldername(name))[1]=training.actor()::text
) with check(
  bucket_id='training-certificates' and (storage.foldername(name))[1]=training.actor()::text
);
drop policy if exists training_certificates_select on storage.objects;
create policy training_certificates_select on storage.objects
for select to authenticated using(
  bucket_id='training-certificates' and (
    (storage.foldername(name))[1]=training.actor()::text
    or exists(
      select 1 from training.external_enrollments x
      join public.employees e on e.id=x.employee_id
      where x.certificate_path=name and training.allowed(training.actor(),'manage',e.department_id)
    )
  )
);

create or replace function public.training_external_rpc(action text,p jsonb default '{}')
returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,training,storage
as $$
declare
  me uuid=training.actor();
  target_employee public.employees;
  enrollment training.external_enrollments;
  new_id uuid;
begin
  if not training.member(me,'training') then raise exception '尚未取得教育訓練使用資格'; end if;
  if action='mine' then
    return coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('course',to_jsonb(c)) order by c.start_date desc nulls last,c.created_at desc)
      from training.external_enrollments x join training.external_courses c on c.id=x.course_id where x.employee_id=me),'[]');
  elsif action='admin' then
    if not exists(select 1 from training.grants g where g.employee_id=me and g.system_code='training') then raise exception '無管理權限'; end if;
    return jsonb_build_object(
      'courses',(select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc),'[]') from training.external_courses c),
      'enrollments',(select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('course',to_jsonb(c),'employee_name',e.name) order by x.created_at desc),'[]')
        from training.external_enrollments x join training.external_courses c on c.id=x.course_id join public.employees e on e.id=x.employee_id
        where training.allowed(me,'manage',e.department_id))
    );
  elsif action='save_course' then
    if not training.allowed(me,'admin') then raise exception '僅管理員可建立外訓課程'; end if;
    insert into training.external_courses(title,provider,start_date,end_date,hours,notes,created_by)
    values(btrim(p->>'title'),btrim(p->>'provider'),nullif(p->>'start_date','')::date,nullif(p->>'end_date','')::date,coalesce((p->>'hours')::numeric,0),coalesce(p->>'notes',''),me)
    returning id into new_id;
    return to_jsonb(new_id);
  elsif action='assign' then
    select * into target_employee from public.employees where id=(p->>'employee_id')::uuid and active;
    if target_employee.id is null or not training.allowed(me,'manage',target_employee.department_id) then raise exception '無此人員指派權限'; end if;
    if not exists(select 1 from training.external_courses where id=(p->>'course_id')::uuid) then raise exception '找不到外訓課程'; end if;
    insert into training.external_enrollments(course_id,employee_id)
    values((p->>'course_id')::uuid,target_employee.id) on conflict(course_id,employee_id) do nothing
    returning id into new_id;
    return coalesce(to_jsonb(new_id),'{}');
  elsif action='submit' then
    select * into enrollment from training.external_enrollments where id=(p->>'id')::uuid and employee_id=me for update;
    if enrollment.id is null then raise exception '找不到自己的外訓指派'; end if;
    if p->>'certificate_path' !~ ('^'||me::text||'/'||enrollment.id::text||'/certificate\\.(pdf|jpg|jpeg|png)$') then raise exception '證書檔案路徑不正確'; end if;
    if not exists(select 1 from storage.objects where bucket_id='training-certificates' and name=p->>'certificate_path') then raise exception '證書尚未上傳完成'; end if;
    update training.external_enrollments set status='submitted',certificate_path=p->>'certificate_path',submitted_at=now(),reviewed_by=null,reviewed_at=null,review_note=null where id=enrollment.id;
    return '{}';
  elsif action='review' then
    select x.* into enrollment from training.external_enrollments x join public.employees e on e.id=x.employee_id
    where x.id=(p->>'id')::uuid and training.allowed(me,'manage',e.department_id) for update of x;
    if enrollment.id is null or enrollment.status<>'submitted' then raise exception '找不到待審核證書'; end if;
    if coalesce(btrim(p->>'note'),'')='' then raise exception '請填審核說明'; end if;
    update training.external_enrollments set status=case when coalesce((p->>'approved')::boolean,false) then 'approved' else 'rejected' end,
      reviewed_by=me,reviewed_at=now(),review_note=btrim(p->>'note') where id=enrollment.id;
    return '{}';
  else raise exception '未知外訓操作';
  end if;
end
$$;

revoke all on function public.training_external_rpc(text,jsonb) from public,anon;
grant execute on function public.training_external_rpc(text,jsonb) to authenticated;
insert into training.migrations(version) values('202611160007') on conflict do nothing;
notify pgrst, 'reload schema';
commit;
