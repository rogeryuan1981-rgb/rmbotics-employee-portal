begin;
create or replace function training.actor() returns uuid language plpgsql volatile security definer set search_path=pg_catalog,public,training as $$
#variable_conflict use_column
declare v uuid;
begin
 select e.id into v from public.employees e where e.user_id=auth.uid() and e.active;
 if v is null then raise exception '員工已停用或登入已失效'; end if;
 if not public.is_current_auth_session() then raise exception '登入已失效'; end if;
 return v;
end $$;
create or replace function training.member(e uuid,s text) returns boolean language sql stable security definer set search_path=pg_catalog,public,training as $$
 select exists(select 1 from training.memberships m join training.systems s1 on s1.code=m.system_code join public.employees e1 on e1.id=m.employee_id where m.employee_id=e and m.system_code=s and s1.enabled and e1.active);
$$;
create or replace function training.allowed(e uuid,op text,dep uuid default null) returns boolean language sql stable security definer set search_path=pg_catalog,public,training as $$
 select training.member(e,'training') and exists(select 1 from training.grants g where g.employee_id=e and g.system_code='training'
 and ((g.role='admin' and g.all_departments) or (op in ('manage','people','job') and g.role='hr' and (g.all_departments or g.department_id=dep))
 or (op='manage' and g.role='manager' and (g.all_departments or g.department_id=dep))));
$$;
create or replace function training.end_day(d date) returns timestamptz language sql immutable as $$ select (d+1)::timestamp at time zone 'Asia/Taipei' $$;
create or replace function training.open(c training.courses) returns boolean language sql stable as $$
 select c.active and c.published is not null and (nullif(c.published->>'start','') is null or now()>=(c.published->>'start')::timestamptz)
 and (nullif(c.published->>'end','') is null or now()<(c.published->>'end')::timestamptz)
$$;
create or replace function training.applies(c jsonb,dep uuid) returns boolean language sql immutable as $$
 select coalesce(jsonb_array_length(c->'departments'),0)=0 or coalesce(c->'departments','[]') ? dep::text
$$;
create or replace function training.course_public(c jsonb) returns jsonb language sql immutable as $$
 select c-'questions'
$$;
create or replace function training.assert_course(c jsonb) returns void language plpgsql as $$
#variable_conflict use_column
declare q jsonb;m jsonb;ids text[]='{}';n int;
begin
 if not(c ?& array['title','seconds','pass_score','question_count','materials','questions']) then raise exception '課程設定不完整';end if;
 if length(btrim(c->>'title')) is null or length(btrim(c->>'title'))=0 then raise exception '請填課程名稱'; end if;
 if (c->>'seconds')::numeric<=0 or (c->>'seconds')::numeric>31536000 then raise exception '學習秒數須大於零'; end if;
 if (c->>'pass_score')::numeric<0 or (c->>'pass_score')::numeric>100 then raise exception '及格分數須為 0 至 100'; end if;
 if (c->>'question_count')::int<1 or (c->>'question_count')::int>jsonb_array_length(c->'questions') then raise exception '可用題數不足'; end if;
 if coalesce((c->>'minutes')::numeric,0)<0 then raise exception '測驗限時不可為負'; end if;
 if nullif(c->>'end','') is not null and nullif(c->>'start','') is not null and (c->>'end')::timestamptz<=(c->>'start')::timestamptz then raise exception '結束時間須晚於開始時間'; end if;
 if jsonb_array_length(c->'materials')<1 then raise exception '至少一份教材'; end if;
 for m in select value from jsonb_array_elements(c->'materials') loop
  if coalesce(m->>'id','')='' or m->>'id'=any(ids) then raise exception '教材識別碼須唯一'; end if;
  ids=array_append(ids,m->>'id');
  if m->>'kind' not in ('text','pdf','youtube') then raise exception '教材類型錯誤'; end if;
  if m->>'kind'='youtube' and coalesce(m->>'content','')!~'^[A-Za-z0-9_-]{11}$' then raise exception '請填 YouTube 影片識別碼'; end if;
  if m->>'kind'='pdf' and coalesce(m->>'content','')!~'^https://' then raise exception 'PDF 須為 HTTPS 連結'; end if;
 end loop;
 ids='{}';
 for q in select value from jsonb_array_elements(c->'questions') loop
  if coalesce(q->>'id','')='' or q->>'id'=any(ids) then raise exception '題目識別碼須唯一'; end if;
  ids=array_append(ids,q->>'id');
  if coalesce(q->>'prompt','')='' or q->>'kind' not in ('single','multiple','boolean') then raise exception '題目內容或題型錯誤'; end if;
  n=jsonb_array_length(q->'options');
  if n<2 or jsonb_array_length(q->'correct')<1 or (q->>'kind'<>'multiple' and jsonb_array_length(q->'correct')<>1) then raise exception '選項或答案不完整'; end if;
  if q->>'kind'='boolean' and n<>2 then raise exception '是非題須有兩個選項'; end if;
  if exists(select 1 from jsonb_array_elements_text(q->'correct') x where x::int<0 or x::int>=n) or (select count(distinct value)<>count(*) from jsonb_array_elements(q->'correct')) then raise exception '正確答案索引錯誤'; end if;
  if not exists(select 1 from jsonb_array_elements(c->'materials') x where x->>'id'=q->>'material_id') then raise exception '每題須對應課程教材'; end if;
 end loop;
end $$;
create or replace function training.assign(e uuid,cid uuid,src text,label text,rule jsonb,base date default null,batch_id text default 'normal',override_rules jsonb default null) returns uuid
language plpgsql security definer set search_path=pg_catalog,public,training as $$
#variable_conflict use_column
declare c training.courses;emp public.employees;r training.requirements;due_at timestamptz;cy text;yr int;d date;exempt boolean=false;rules jsonb;
begin
 select * into emp from public.employees where id=e for update;
 if not found or not emp.active or not training.member(e,'training') then return null; end if;
 select * into c from training.courses where id=cid;
 if not found or not c.active or c.published is null or not training.applies(c.published,emp.department_id) then raise exception '課程未發布、停用或不適用此部門'; end if;
 if coalesce(rule->>'mode','') not in ('hire','tenure','assigned','fixed') or coalesce((rule->>'days')::int,0)<0 or coalesce((rule->>'makeup_days')::int,0)<0 then raise exception '期限方式或天數錯誤';end if;
 yr=extract(year from now() at time zone 'Asia/Taipei');
 cy=case when c.published->>'cycle'='annual' then yr::text else 'once' end;
 rules=training.course_public(coalesce(override_rules,c.published))||jsonb_build_object('publication_revision',c.revision);
 if rule->>'mode'='hire' then d=emp.hire_date;
 elsif rule->>'mode'='tenure' then d=base;
 elsif rule->>'mode'='fixed' then
  d=make_date(yr,(rule->>'month')::int,1);
  d=case when coalesce(rule->>'day','')='last' then (d+interval '1 month'-interval '1 day')::date else make_date(yr,(rule->>'month')::int,(rule->>'day')::int) end;
 else d=(now() at time zone 'Asia/Taipei')::date; end if;
 if d is null then raise exception '缺少到職日或接任日，無法計算期限'; end if;
 if rule->>'mode'<>'fixed' then d=d+coalesce((rule->>'days')::int,30); end if;
 if d<(now() at time zone 'Asia/Taipei')::date then
  exempt=rule->>'mode'='fixed' and c.published->>'cycle'='annual' and coalesce(rule->>'late','makeup')='exempt';
  d=(now() at time zone 'Asia/Taipei')::date+coalesce((rule->>'makeup_days')::int,30);
 end if;
 due_at=training.end_day(d);
 select * into r from training.requirements where employee_id=e and course_id=cid and course_version=c.version and cycle=cy and batch=batch_id and lifecycle in ('active','exempt') for update;
 if not found then
  insert into training.requirements(employee_id,course_id,course_version,cycle,batch,generation,rules,original_due,due,lifecycle,conflict_pending)
  values(e,cid,c.version,cy,batch_id,coalesce((select max(generation)+1 from training.requirements where employee_id=e and course_id=cid and course_version=c.version and cycle=cy and batch=batch_id),1),rules,due_at,due_at,case when exempt then 'exempt' else 'active' end,
   nullif(c.published->>'end','') is not null and due_at>(c.published->>'end')::timestamptz) returning * into r;
  insert into training.notifications(employee_id,requirement_id,kind,body) values(e,r.id,case when batch_id='normal' then 'assigned' else 'retrain' end,jsonb_build_object('title',c.published->>'title','due',due_at,'entry','#/training/'||r.id));
 else
  -- Source changes cannot relax a saved due date or rewrite completed results.
  if r.completed_at is null and not exists(select 1 from training.sources where requirement_id=r.id and source_key=src and active) then
   update training.requirements set due=least(due,due_at) where id=r.id;
  end if;
 end if;
 insert into training.sources values(r.id,src,label,due_at,true) on conflict(requirement_id,source_key) do update set active=true,label=excluded.label;
 return r.id;
end $$;
create or replace function training.reconcile(e uuid) returns void language plpgsql security definer set search_path=pg_catalog,public,training as $$
#variable_conflict use_column
declare t record;j jsonb;ln jsonb;r record;cur_keys text[]='{}';key text;cid uuid;
begin
 -- Assign all new sources first, so a transfer never briefly cancels a shared course.
 if exists(select 1 from public.employees where id=e and active) and training.member(e,'training') then
 for t in select x.*,z.published,z.id as jid from training.tenures x join training.jobs z on z.id=x.job_id where x.employee_id=e and x.end_date is null and z.published is not null loop
  j=t.published;
  for ln in select value from jsonb_array_elements(coalesce(j->'training','[]')) union all select l.value from jsonb_array_elements(coalesce(j->'duties','[]')) d cross join lateral jsonb_array_elements(coalesce(d->'training','[]')) l loop
   cid=(ln->>'course_id')::uuid;key='job:'||t.jid||':'||cid;
   cur_keys=array_append(cur_keys,key);
   if exists(select 1 from training.courses where id=cid and active) then
    perform training.assign(e,cid,key,j->>'name',ln->'deadline',t.start_date);
   end if;
  end loop;
 end loop;
 end if;
 update training.sources s set active=false from training.requirements r where s.requirement_id=r.id and r.employee_id=e and s.source_key like 'job:%' and not(s.source_key=any(cur_keys));
 update training.requirements r set lifecycle='cancelled',cancellation_reason='全部來源失效或員工已停用',ever_overdue=ever_overdue or now()>=due
 where r.employee_id=e and r.lifecycle='active' and r.completed_at is null and
 (not exists(select 1 from public.employees where id=e and active) or not training.member(e,'training') or not exists(select 1 from training.sources s where s.requirement_id=r.id and s.active));
end $$;
create or replace function training.grade(pid uuid,auto_expire boolean default false) returns void language plpgsql security definer set search_path=pg_catalog,public,training as $$
#variable_conflict use_column
declare p training.papers;r training.requirements;q jsonb;n int=0;ans jsonb;correct_ans jsonb;at_time timestamptz;
begin
 select * into p from training.papers where id=pid;
 if not found then return;end if;
 -- The same lock order is used by interactive RPCs and the expiry worker.
 select * into r from training.requirements where id=p.requirement_id for update;
 select * into p from training.papers where id=pid for update;
 if p.submitted_at is not null then return; end if;
 if auto_expire and (p.expires_at is null or now()<p.expires_at) then return; end if;
 for q in select value from jsonb_array_elements(p.questions) loop
  select coalesce(jsonb_agg(value order by value),'[]') into ans from jsonb_array_elements(coalesce(p.answers->(q->>'id'),'[]'));
  select jsonb_agg(value order by value) into correct_ans from jsonb_array_elements(q->'correct');
  if ans=correct_ans then n=n+1; end if;
 end loop;
 at_time=case when p.expires_at is not null and now()>=p.expires_at then p.expires_at else now() end;
 update training.papers set correct=n,passed=(n::numeric*100>=p.pass_score*p.total),submitted_at=at_time where id=pid;
 if n::numeric*100>=p.pass_score*p.total and r.lifecycle='active' and r.seconds>=(r.rules->>'seconds')::numeric then
  update training.requirements set completed_at=coalesce(completed_at,at_time),completed_due=coalesce(completed_due,due),ever_overdue=ever_overdue or at_time>=due where id=r.id;
 end if;
end $$;
create or replace function training.paper_view(pid uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,training as $$
#variable_conflict use_column
declare p training.papers;questions jsonb;
begin
 select * into p from training.papers where id=pid;
 select jsonb_agg(case when coalesce(p.passed,false) then q else q-'correct'-'explanation' end order by ord) into questions from jsonb_array_elements(p.questions) with ordinality x(q,ord);
 return to_jsonb(p)-'questions'||jsonb_build_object('questions',questions,'server_now',now(),'score',case when p.correct is not null then round(p.correct::numeric*100/p.total,2) end,
 'wrong_ids',case when p.submitted_at is not null then (select coalesce(jsonb_agg(q->>'id'),'[]') from jsonb_array_elements(p.questions) q where (select coalesce(jsonb_agg(value order by value),'[]') from jsonb_array_elements(coalesce(p.answers->(q->>'id'),'[]')))<>(select jsonb_agg(value order by value) from jsonb_array_elements(q->'correct'))) else '[]'::jsonb end);
end $$;
-- Supabase Auth sessions are already shared by all modules. No module claims a new session.
create or replace function training.bootstrap_admin(p_email text) returns void language plpgsql security definer set search_path=pg_catalog,public,training as $$
#variable_conflict use_column
declare e uuid;
begin
 select id into strict e from public.employees where lower(email::text)=lower(p_email) and active;
 insert into training.memberships values(e,'training') on conflict do nothing;
 insert into training.grants(employee_id,system_code,role,all_departments) values(e,'training','admin',true) on conflict do nothing;
 insert into training.audit(actor,action,body) values(e,'bootstrap_admin',jsonb_build_object('email',p_email));
end $$;
create or replace function training.report_matches(req training.requirements,filter jsonb) returns boolean language sql stable security definer set search_path=pg_catalog,public,training as $$
 select (coalesce(filter->>'department_id','')='' or (select department_id from public.employees where id=req.employee_id)=(filter->>'department_id')::uuid)
 and (coalesce(filter->>'employee_id','')='' or req.employee_id=(filter->>'employee_id')::uuid)
 and (coalesce(filter->>'course_id','')='' or req.course_id=(filter->>'course_id')::uuid)
 and (coalesce(filter->>'cycle','')='' or req.cycle=filter->>'cycle')
 and (coalesce(filter->>'job_id','')='' or exists(select 1 from training.sources where requirement_id=req.id and source_key like 'job:'||(filter->>'job_id')||':%'))
 and (coalesce(filter->>'status','')='' or (filter->>'status'='completed' and req.completed_at is not null) or (filter->>'status'='incomplete' and req.completed_at is null and req.lifecycle='active') or req.lifecycle=filter->>'status');
$$;
revoke all on all functions in schema training from public,anon,authenticated;
insert into training.migrations(version) values('202611150002') on conflict do nothing;
commit;
