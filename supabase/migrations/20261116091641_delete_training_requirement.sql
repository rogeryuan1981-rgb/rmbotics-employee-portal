begin;

create or replace function public.training_delete_requirement(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, training
as $$
#variable_conflict use_column
declare
  me uuid;
  rid uuid;
  reason text;
  req training.requirements;
  employee_name text;
  course_title text;
begin
  me := training.actor();
  if not training.allowed(me, 'admin') then
    raise exception '僅教育訓練系統管理員可刪除訓練紀錄';
  end if;

  rid := nullif(p->>'id', '')::uuid;
  reason := btrim(coalesce(p->>'reason', ''));
  if rid is null then raise exception '缺少訓練紀錄識別碼'; end if;
  if reason = '' then raise exception '請填寫刪除原因'; end if;

  select * into req from training.requirements where id = rid for update;
  if not found then raise exception '找不到訓練紀錄'; end if;

  select name into employee_name from public.employees where id = req.employee_id;
  select coalesce(published->>'title', draft->>'title') into course_title
  from training.courses where id = req.course_id;

  delete from training.leases where requirement_id = rid;
  delete from training.positions where requirement_id = rid;
  delete from training.papers where requirement_id = rid;
  delete from training.issues where requirement_id = rid;
  delete from training.notifications where requirement_id = rid;
  delete from training.deadline_changes where requirement_id = rid;
  delete from training.sources where requirement_id = rid;
  delete from training.audit where body->>'requirement_id' = rid::text;
  delete from training.requirements where id = rid;

  insert into training.audit(actor, action, body)
  values (
    me,
    'requirement_deleted',
    jsonb_build_object(
      'requirement_id', rid,
      'employee_id', req.employee_id,
      'employee_name', employee_name,
      'course_id', req.course_id,
      'course_title', course_title,
      'cycle', req.cycle,
      'batch', req.batch,
      'generation', req.generation,
      'completed_at', req.completed_at,
      'reason', reason
    )
  );

  return jsonb_build_object('deleted', true, 'id', rid);
end
$$;

revoke all on function public.training_delete_requirement(jsonb) from public, anon;
grant execute on function public.training_delete_requirement(jsonb) to authenticated;

insert into training.migrations(version) values('20261116091641') on conflict do nothing;
notify pgrst, 'reload schema';

commit;
