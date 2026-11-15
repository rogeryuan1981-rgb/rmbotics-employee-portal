begin;
-- One newest device session. Same browser tabs share the same session_id.
create or replace function public.is_current_auth_session() returns boolean language plpgsql volatile security definer set search_path=pg_catalog,public,training as $$
declare employee uuid;claimed_session uuid;started timestamptz;
begin
 select e.id,s.id,s.created_at into employee,claimed_session,started from auth.sessions s join public.employees e on e.user_id=s.user_id
 where s.id=nullif(auth.jwt()->>'session_id','')::uuid and s.user_id=auth.uid() and e.active
 and not exists(select 1 from auth.sessions newer where newer.user_id=s.user_id and (newer.created_at,newer.id)>(s.created_at,s.id));
 if employee is null then return false;end if;
 insert into training.auth_session_heads as h(employee_id,session_id,created_at) values(employee,claimed_session,started)
 on conflict(employee_id) do update set session_id=excluded.session_id,created_at=excluded.created_at
 where (h.created_at,h.session_id)<(excluded.created_at,excluded.session_id);
 return exists(select 1 from training.auth_session_heads h where h.employee_id=employee and h.session_id=claimed_session);
end;
$$;
revoke all on function public.is_current_auth_session() from public,anon;
grant execute on function public.is_current_auth_session() to authenticated;
create or replace function public.current_employee_id() returns uuid language sql volatile security definer set search_path=pg_catalog,public,training as $$
 select e.id from public.employees e where e.user_id=auth.uid() and e.active and public.is_current_auth_session() and training.member(e.id,'snack-vote') limit 1;
$$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=pg_catalog,public,training as $$
 select exists(select 1 from public.employees where id=public.current_employee_id() and role='admin');
$$;
-- Restrictive policies also protect direct REST reads that legacy permissive policies allowed.
do $$ declare t record;begin
 for t in select tablename from pg_tables where schemaname='public' and tablename not in ('employees','app_migrations') loop
  execute format('drop policy if exists portal_snack_access on public.%I',t.tablename);
  execute format('create policy portal_snack_access on public.%I as restrictive to authenticated using (public.current_employee_id() is not null) with check (public.current_employee_id() is not null)',t.tablename);
 end loop;
end $$;
create or replace function training.tick() returns void language plpgsql security definer set search_path=pg_catalog,public,training as $$
#variable_conflict use_column
declare e uuid;pid uuid;s jsonb;today date=(now() at time zone 'Asia/Taipei')::date;rr record;g record;days_left int;kind text;
begin
 select value into s from training.settings;
 -- Reconciliation is idempotent, also creates the new year's obligations.
 for e in select id from public.employees where active loop
  begin perform training.reconcile(e);
  exception when others then insert into training.audit(action,body) values('reconcile_error',jsonb_build_object('employee_id',e,'error',sqlerrm));end;
 end loop;
 for pid in select id from training.papers where submitted_at is null and expires_at<=now() loop perform training.grade(pid,true);end loop;
 update training.requirements set ever_overdue=true where lifecycle='active' and completed_at is null and now()>=due;
 if (now() at time zone 'Asia/Taipei')::time<(s->>'time')::time then return;end if;
 for rr in select r.*,e.department_id,c.published from training.requirements r join public.employees e on e.id=r.employee_id join training.courses c on c.id=r.course_id
  where e.active and training.member(e.id,'training') and r.lifecycle='active' and r.completed_at is null and training.open(c) loop
  days_left=((rr.due at time zone 'Asia/Taipei')::date-1)-today;kind=null;
  if s->'before' @> to_jsonb(days_left) then kind='due';
  elsif now()>=rr.due and ((today-(rr.due at time zone 'Asia/Taipei')::date) % (s->>'overdue_every')::int)=0 then kind='overdue';end if;
  if kind is not null then
   insert into training.notifications(employee_id,requirement_id,kind,body) values(rr.employee_id,rr.id,kind,jsonb_build_object('title',rr.published->>'title','due',rr.due,'seconds',rr.seconds,'department_id',rr.department_id,'learner_id',rr.employee_id,'entry','#/training/'||rr.id)) on conflict do nothing;
   if kind='overdue' then
    for g in select distinct gr.employee_id from training.grants gr where gr.system_code='training' and (gr.role='manager' or (gr.role='hr' and (s->>'hr_digest')::boolean)) and (gr.all_departments or gr.department_id=rr.department_id) and training.member(gr.employee_id,'training') loop
     -- Manager digest events are separate from the person's own frontend notifications.
     insert into training.audit(actor,action,body)
     select g.employee_id,'digest_event',jsonb_build_object('day',today,'requirement_id',rr.id)
     where not exists(select 1 from training.audit where actor=g.employee_id and action='digest_event' and body->>'day'=today::text and body->>'requirement_id'=rr.id::text) on conflict do nothing;
    end loop;
   end if;
  end if;
 end loop;
 -- One message per recipient/day, grouped in body by department. Rebuilt until sent; recheck eligibility at claim.
 for e in select distinct employee_id from training.notifications where day=today union select actor from training.audit where action='digest_event' and body->>'day'=today::text loop
  insert into training.outbox(employee_id,day,body) values(e,today,'{}') on conflict do nothing;
 end loop;
end $$;
create or replace function public.training_mail_claim() returns jsonb language plpgsql security definer set search_path=pg_catalog,public,training as $$
#variable_conflict use_column
declare o training.outbox;items jsonb;
begin
 perform training.tick();
 update training.outbox set status='needs_review',error='超過供應商去重期限，停止自動重試；請人工核對投遞結果' where status in ('sending','failed') and first_attempt_at<now()-interval '23 hours';
 select * into o from training.outbox where status in ('pending','failed') or (status='sending' and claimed_at<now()-interval '5 minutes') order by day limit 1 for update skip locked;
 if not found then return null;end if;
 if not training.member(o.employee_id,'training') then update training.outbox set status='cancelled' where id=o.id;return null;end if;
 select coalesce(jsonb_agg(item order by item::text),'[]') into items from (
  select n.body||jsonb_build_object('requirement_id',r.id,'due',r.due,'seconds',r.seconds,'kind',n.kind,'learner_name',e.name,'days_overdue',greatest(0,(now() at time zone 'Asia/Taipei')::date-(r.due at time zone 'Asia/Taipei')::date+1)) item
  from training.notifications n join training.requirements r on r.id=n.requirement_id join training.courses c on c.id=r.course_id join public.employees e on e.id=r.employee_id
  where n.employee_id=o.employee_id and n.day=o.day and r.lifecycle='active' and r.completed_at is null and e.active and training.open(c)
  and (n.kind in ('assigned','retrain') or (n.kind='overdue' and now()>=r.due) or (n.kind='due' and now()<r.due and exists(select 1 from training.settings st cross join lateral jsonb_array_elements_text(st.value->'before') b where b::int=((r.due at time zone 'Asia/Taipei')::date-1)-(now() at time zone 'Asia/Taipei')::date)))
  union all
  select jsonb_build_object('requirement_id',r.id,'kind','manager_overdue','title',c.published->>'title','learner_name',e.name,'department_id',e.department_id,'department',(select name from training.departments where id=e.department_id),'due',r.due,'seconds',r.seconds,'days_overdue',greatest(0,(now() at time zone 'Asia/Taipei')::date-(r.due at time zone 'Asia/Taipei')::date+1),'entry','#/training/admin')
  from training.audit a join training.requirements r on r.id=(a.body->>'requirement_id')::uuid join training.courses c on c.id=r.course_id join public.employees e on e.id=r.employee_id
  where a.actor=o.employee_id and a.action='digest_event' and a.body->>'day'=o.day::text and r.lifecycle='active' and r.completed_at is null and now()>=r.due and e.active and training.open(c)
  and exists(select 1 from training.grants g where g.employee_id=o.employee_id and g.system_code='training' and (g.role='manager' or (g.role='hr' and (select (value->>'hr_digest')::boolean from training.settings))) and (g.all_departments or g.department_id=e.department_id))
 ) t;
 if jsonb_array_length(items)=0 then update training.outbox set status='cancelled' where id=o.id;return null;end if;
 if o.attempts>0 then
  if o.delivery_email is distinct from (select email::text from public.employees where id=o.employee_id)
   or exists(select 1 from jsonb_array_elements(o.body) prior where not exists(select 1 from jsonb_array_elements(items) cur where cur->>'requirement_id'=prior->>'requirement_id' and cur->>'kind'=prior->>'kind')) then
   update training.outbox set status='cancelled',error='重試前狀態或收件範圍變更，停止投遞舊彙整' where id=o.id;return null;
  end if;
  items=o.body;
 end if;
 update training.outbox set first_attempt_at=coalesce(first_attempt_at,now()),delivery_email=coalesce(delivery_email,(select email::text from public.employees where id=o.employee_id)),body=items,status='sending',claimed_at=now(),attempts=attempts+1 where id=o.id returning * into o;
 return to_jsonb(o)||jsonb_build_object('email',(select email from public.employees where id=o.employee_id));
end $$;
create or replace function public.training_mail_ack(p_id uuid,p_error text default null) returns void language sql security definer set search_path=pg_catalog,public,training as $$
 update training.outbox set status=case when p_error is null then 'sent' else 'failed' end,sent_at=case when p_error is null then now() end,error=p_error where id=p_id and status='sending';
$$;
revoke all on function public.training_mail_claim() from public,anon,authenticated;
revoke all on function public.training_mail_ack(uuid,text) from public,anon,authenticated;
grant execute on function public.training_mail_claim(),public.training_mail_ack(uuid,text) to service_role;
revoke all on all functions in schema training from public,anon,authenticated;
insert into training.migrations(version) values('202611150004') on conflict do nothing;
commit;
