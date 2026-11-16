begin;

create or replace function public.training_course_sync_rpc(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,training as $$
declare
  me uuid=training.actor();
  cid uuid=(p->>'course_id')::uuid;
  c training.courses;
  affected int=0;
  reset_papers int=0;
begin
  if not training.allowed(me,'admin') then raise exception '僅管理員可同步既有課程要求';end if;
  select * into c from training.courses where id=cid for update;
  if c.id is null or c.published is null then raise exception '課程尚未發布';end if;

  update training.requirements r
  set rules=training.course_public(c.published)
      ||jsonb_build_object('publication_revision',c.revision)
      ||case when r.rules ? 'retest' then jsonb_build_object('retest',r.rules->'retest') else '{}'::jsonb end
  where r.course_id=cid and r.lifecycle='active' and r.completed_at is null;
  get diagnostics affected=row_count;

  delete from training.papers paper
  using training.requirements r
  where paper.requirement_id=r.id and r.course_id=cid
    and r.lifecycle='active' and r.completed_at is null and paper.submitted_at is null;
  get diagnostics reset_papers=row_count;

  delete from training.leases lease
  using training.requirements r
  where lease.requirement_id=r.id and r.course_id=cid
    and r.lifecycle='active' and r.completed_at is null;

  delete from training.positions pos
  using training.requirements r
  where pos.requirement_id=r.id and r.course_id=cid
    and r.lifecycle='active' and r.completed_at is null
    and not exists(
      select 1 from jsonb_array_elements(c.published->'materials') m
      where m->>'id'=pos.material_id
    );

  insert into training.notifications(employee_id,requirement_id,kind,body)
  select r.employee_id,r.id,'course_updated',jsonb_build_object(
    'title',c.published->>'title','due',r.due,'entry','#/training/'||r.id
  )
  from training.requirements r
  where r.course_id=cid and r.lifecycle='active' and r.completed_at is null
  on conflict do nothing;

  insert into training.audit(actor,action,body) values(
    me,'course_sync_existing',jsonb_build_object(
      'course_id',cid,'publication_revision',c.revision,
      'affected',affected,'reset_papers',reset_papers
    )
  );
  return jsonb_build_object('affected',affected,'reset_papers',reset_papers);
end $$;

revoke all on function public.training_course_sync_rpc(jsonb) from public,anon;
grant execute on function public.training_course_sync_rpc(jsonb) to authenticated;

insert into training.migrations(version) values ('202611160005') on conflict do nothing;
notify pgrst,'reload schema';
commit;
