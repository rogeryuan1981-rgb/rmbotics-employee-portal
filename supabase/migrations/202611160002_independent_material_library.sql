-- Independent, reusable training materials. Courses reference library ids in drafts;
-- publication snapshots the current material content for stable learning records.
begin;

create table if not exists training.materials(
 id uuid primary key default gen_random_uuid(),
 title text not null,
 kind text not null check(kind in ('text','pdf','youtube')),
 content text not null default '',
 active boolean not null default true,
 revision int not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists training.material_versions(
 id uuid primary key default gen_random_uuid(),
 material_id uuid not null references training.materials,
 revision int not null,
 content jsonb not null,
 actor uuid references public.employees,
 at timestamptz not null default now(),
 summary text not null,
 unique(material_id,revision)
);
revoke all on training.materials,training.material_versions from public,anon,authenticated;

insert into training.materials(id,title,kind,content)
select distinct on ((m->>'id')::uuid) (m->>'id')::uuid,m->>'title',m->>'kind',coalesce(m->>'content','')
from training.courses c cross join lateral jsonb_array_elements(coalesce(c.draft->'materials','[]')) m
where coalesce(m->>'id','')<>''
on conflict(id) do nothing;

insert into training.material_versions(material_id,revision,content,summary)
select m.id,m.revision,jsonb_build_object('title',m.title,'kind',m.kind,'content',m.content),'由既有課程教材移入獨立教材庫'
from training.materials m
where not exists(select 1 from training.material_versions v where v.material_id=m.id and v.revision=m.revision);

update training.courses c set draft=(c.draft-'materials')||jsonb_build_object(
 'material_ids',coalesce((select jsonb_agg(m->>'id') from jsonb_array_elements(coalesce(c.draft->'materials','[]')) m),'[]'::jsonb)
) where c.draft ? 'materials';

create or replace function training.materialize_course(c jsonb) returns jsonb
language sql stable security definer set search_path=pg_catalog,public,training as $$
 select case when c ? 'material_ids' then
  (c-'materials')||jsonb_build_object('materials',coalesce((
   select jsonb_agg(jsonb_build_object('id',m.id,'title',m.title,'kind',m.kind,'content',m.content) order by x.ord)
   from jsonb_array_elements_text(coalesce(c->'material_ids','[]')) with ordinality x(id,ord)
   join training.materials m on m.id=x.id::uuid and m.active
  ),'[]'::jsonb))
 else c end
$$;

create or replace function training.assert_course(c jsonb) returns void language plpgsql stable security definer set search_path=pg_catalog,public,training as $$
declare course_data jsonb=training.materialize_course(c);m jsonb;q jsonb;n int;ids text[]='{}';
begin
 if not(course_data ?& array['title','seconds','pass_score','question_count','materials','questions']) then raise exception '課程設定不完整';end if;
 if coalesce(length(btrim(course_data->>'title')),0)=0 then raise exception '請填課程名稱';end if;
 if (course_data->>'seconds')::numeric<=0 or (course_data->>'seconds')::numeric>31536000 then raise exception '學習秒數須大於零';end if;
 if (course_data->>'pass_score')::numeric<0 or (course_data->>'pass_score')::numeric>100 then raise exception '及格分數須為 0 至 100';end if;
 if (course_data->>'question_count')::int<1 or (course_data->>'question_count')::int>jsonb_array_length(course_data->'questions') then raise exception '可用題數不足';end if;
 if coalesce((course_data->>'minutes')::numeric,0)<0 then raise exception '測驗限時不可為負';end if;
 if nullif(course_data->>'end','') is not null and nullif(course_data->>'start','') is not null and (course_data->>'end')::timestamptz<=(course_data->>'start')::timestamptz then raise exception '結束時間須晚於開始時間';end if;
 if jsonb_array_length(course_data->'materials')<1 then raise exception '請至少引用一份啟用中的教材';end if;
 for m in select value from jsonb_array_elements(course_data->'materials') loop
  if coalesce(m->>'id','')='' or m->>'id'=any(ids) then raise exception '教材識別碼須唯一';end if;ids=array_append(ids,m->>'id');
  if coalesce(btrim(m->>'title'),'')='' then raise exception '教材名稱不可空白';end if;
  if m->>'kind' not in ('text','pdf','youtube') then raise exception '教材類型錯誤';end if;
  if m->>'kind'='youtube' and coalesce(m->>'content','')!~'^[A-Za-z0-9_-]{11}$' then raise exception '請填 YouTube 影片識別碼';end if;
  if m->>'kind'='pdf' and coalesce(m->>'content','')!~'^https://' then raise exception 'PDF 須為 HTTPS 連結';end if;
 end loop;
 ids='{}';
 for q in select value from jsonb_array_elements(course_data->'questions') loop
  if coalesce(q->>'id','')='' or q->>'id'=any(ids) then raise exception '題目識別碼須唯一';end if;ids=array_append(ids,q->>'id');
  if coalesce(q->>'prompt','')='' or q->>'kind' not in ('single','multiple','boolean') then raise exception '題目內容或題型錯誤';end if;
  n=jsonb_array_length(q->'options');
  if n<2 or jsonb_array_length(q->'correct')<1 or (q->>'kind'<>'multiple' and jsonb_array_length(q->'correct')<>1) then raise exception '選項或答案不完整';end if;
  if q->>'kind'='boolean' and n<>2 then raise exception '是非題須有兩個選項';end if;
  if exists(select 1 from jsonb_array_elements_text(q->'correct') x where x::int<0 or x::int>=n) or (select count(distinct value)<>count(*) from jsonb_array_elements(q->'correct')) then raise exception '正確答案索引錯誤';end if;
  if not exists(select 1 from jsonb_array_elements(course_data->'materials') x where x->>'id'=q->>'material_id') then raise exception '每題須對應已引用的教材';end if;
 end loop;
end $$;

create or replace function training.snapshot_course_materials() returns trigger language plpgsql security definer set search_path=pg_catalog,public,training as $$
begin
 if new.published is distinct from old.published and new.published is not null then new.published=training.materialize_course(new.published);end if;
 return new;
end $$;
drop trigger if exists courses_snapshot_materials on training.courses;
create trigger courses_snapshot_materials before update of published on training.courses for each row execute function training.snapshot_course_materials();

revoke all on function training.materialize_course(jsonb),training.assert_course(jsonb),training.snapshot_course_materials() from public,anon,authenticated;

create or replace function public.training_material_rpc(action text,p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,training as $$
declare me uuid;mid uuid;m training.materials;next_revision int;normalized text;
begin
 me=training.actor();
 if not training.allowed(me,'admin') then raise exception '僅管理員可維護教材庫';end if;
 if action='list' then
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.active desc,x.updated_at desc) from training.materials x),'[]'::jsonb);
 elsif action='save' then
  mid=coalesce(nullif(p->>'id','')::uuid,gen_random_uuid());
  if coalesce(btrim(p->>'title'),'')='' then raise exception '請填教材名稱';end if;
  if p->>'kind' not in ('text','pdf','youtube') then raise exception '教材類型錯誤';end if;
  normalized=coalesce(p->>'content','');
  if p->>'kind'='youtube' and normalized!~'^[A-Za-z0-9_-]{11}$' then raise exception 'YouTube 教材請儲存 11 碼影片識別碼';end if;
  if p->>'kind'='pdf' and normalized!~'^https://' then raise exception 'PDF 教材須使用 HTTPS 網址';end if;
  select * into m from training.materials where id=mid for update;
  next_revision=coalesce(m.revision,0)+1;
  insert into training.materials(id,title,kind,content,revision) values(mid,btrim(p->>'title'),p->>'kind',normalized,next_revision)
   on conflict(id) do update set title=excluded.title,kind=excluded.kind,content=excluded.content,revision=excluded.revision,updated_at=now() returning * into m;
  insert into training.material_versions(material_id,revision,content,actor,summary) values(mid,m.revision,jsonb_build_object('title',m.title,'kind',m.kind,'content',m.content),me,coalesce(nullif(btrim(p->>'summary'),''),'儲存教材'));
  return to_jsonb(m);
 elsif action='set_active' then
  update training.materials set active=coalesce((p->>'active')::boolean,true),updated_at=now() where id=(p->>'id')::uuid returning * into m;
  if not found then raise exception '找不到教材';end if;return to_jsonb(m);
 elsif action='versions' then
  return coalesce((select jsonb_agg(to_jsonb(v) order by v.revision desc) from training.material_versions v where v.material_id=(p->>'id')::uuid),'[]'::jsonb);
 else raise exception '未知教材操作';end if;
end $$;
revoke all on function public.training_material_rpc(text,jsonb) from public,anon;
grant execute on function public.training_material_rpc(text,jsonb) to authenticated;

insert into training.migrations(version)
values ('202611160002')
on conflict do nothing;

notify pgrst,'reload schema';
commit;
