begin;

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
values ('202611160004')
on conflict do nothing;

notify pgrst,'reload schema';
commit;
