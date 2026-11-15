begin;
create or replace function public.portal_rpc(action text,p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,training as $$
#variable_conflict use_column
declare me uuid=training.actor();emp public.employees;other public.employees;dep uuid;cid uuid;rid uuid;pid uuid;
 c training.courses;r training.requirements;l training.leases;paper training.papers;j training.jobs;
 v jsonb;x jsonb;z jsonb;result jsonb;questions jsonb;ids text[];new_id uuid;seq_no int;is_eligible boolean;delta numeric;pos numeric;old_due timestamptz;new_due timestamptz;errors jsonb='[]';fp text;imp training.imports;updated int=0;
begin
 select * into emp from public.employees where id=me;
 if action='context' then
  return jsonb_build_object('employee',to_jsonb(emp),'systems',(select coalesce(jsonb_agg(to_jsonb(s) order by s.sort_order),'[]') from training.systems s where s.enabled and training.member(me,s.code)),
  'grants',(select coalesce(jsonb_agg(to_jsonb(g)),'[]') from training.grants g where g.employee_id=me),'server_now',now());
 end if;
 if not training.member(me,'training') then raise exception '尚未取得教育訓練使用資格'; end if;
 if action='mine' then
  for pid in select a.id from training.papers a join training.requirements b on b.id=a.requirement_id where b.employee_id=me and a.submitted_at is null and a.expires_at<=now() loop perform training.grade(pid,true);end loop;
  return jsonb_build_object('requirements',(select coalesce(jsonb_agg(to_jsonb(t) order by t.due),'[]') from
   (select r.*,training.course_public(c.published) as course,c.active as course_active,training.open(c) as is_open,
    (select coalesce(jsonb_agg(to_jsonb(s)),'[]') from training.sources s where s.requirement_id=r.id) as sources,
    (select training.paper_view(a.id)-'questions'-'answers' from training.papers a where a.requirement_id=r.id order by a.passed desc nulls last,a.submitted_at desc nulls last limit 1) as result
    from training.requirements r join training.courses c on c.id=r.course_id where r.employee_id=me) t),
   'notifications',(select coalesce(jsonb_agg(to_jsonb(n) order by n.day desc),'[]') from training.notifications n where n.employee_id=me));
 elsif action='read_notification' then
  update training.notifications set read_at=now() where id=(p->>'id')::uuid and employee_id=me;return '{}';
 end if;
 -- Requirement-bound operations always enforce ownership; management permissions do not imply impersonation.
 if action in ('requirement','lease','heartbeat','exam_start','exam_save','exam_submit','exam_history','issue') then
  select * into r from training.requirements where id=(p->>'id')::uuid and employee_id=me for update;
  if not found then raise exception '找不到自己的訓練要求'; end if;
  select * into c from training.courses where id=r.course_id;
  for pid in select id from training.papers where requirement_id=r.id and submitted_at is null and expires_at<=now() loop perform training.grade(pid,true);end loop;
  select * into r from training.requirements where id=r.id;
  if action='requirement' then
   return jsonb_build_object('requirement',to_jsonb(r),'course',training.course_public(c.published),'is_open',training.open(c),'course_active',c.active,
    'sources',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from training.sources s where s.requirement_id=r.id),
    'positions',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from training.positions s where s.requirement_id=r.id),'server_now',now());
  elsif action='exam_history' then
   return coalesce((select jsonb_agg(training.paper_view(id) order by started_at desc) from training.papers where requirement_id=r.id),'[]');
  elsif action='issue' then
   if length(btrim(p->>'message'))=0 then raise exception '請填問題內容'; end if;
   insert into training.issues(employee_id,requirement_id,material_id,message) values(me,r.id,p->>'material_id',p->>'message');return '{}';
  elsif action='lease' then
   if r.lifecycle<>'active' or r.completed_at is not null or not training.open(c) then raise exception '目前不能學習計時'; end if;
   if not exists(select 1 from jsonb_array_elements(c.published->'materials') m where m->>'id'=p->>'material_id') then raise exception '教材不存在'; end if;
   insert into training.leases(employee_id,requirement_id,material_id) values(me,r.id,p->>'material_id')
   on conflict(employee_id) do update set requirement_id=excluded.requirement_id,material_id=excluded.material_id,token=gen_random_uuid(),seq=0,last_at=now(),eligible=false,last_interaction=now() returning * into l;
   return to_jsonb(l);
  elsif action='heartbeat' then
   select * into l from training.leases where employee_id=me for update;
   if l.token<>(p->>'token')::uuid or l.requirement_id<>r.id or not found then raise exception '計時已由另一分頁接手，請重新開始'; end if;
   seq_no=(p->>'seq')::int;
   if seq_no<=l.seq then return jsonb_build_object('seconds',r.seconds,'duplicate',true); end if;
   if seq_no<>l.seq+1 then raise exception '計時序號不連續，請重新取得租約'; end if;
   select m into v from jsonb_array_elements(c.published->'materials') m where m->>'id'=l.material_id;
   is_eligible=r.lifecycle='active' and r.completed_at is null and training.open(c) and coalesce((p->>'visible')::boolean,false) and coalesce((p->>'loaded')::boolean,false)
    and case when v->>'kind'='youtube' then coalesce((p->>'playing')::boolean,false) else now()-l.last_interaction<interval '5 minutes' end;
   if coalesce((p->>'interacted')::boolean,false) then
    update training.leases set last_interaction=now() where employee_id=me;
    if v->>'kind'<>'youtube' and r.lifecycle='active' and r.completed_at is null and training.open(c) then is_eligible=coalesce((p->>'visible')::boolean,false) and coalesce((p->>'loaded')::boolean,false);end if;
   end if;
   -- Only confirmed consecutive eligible intervals count. No credit for gaps >30s or offline claims.
   delta=case when is_eligible and l.eligible and now()-l.last_at<=interval '30 seconds' then greatest(0,least(15,extract(epoch from now()-l.last_at))) else 0 end;
   update training.requirements set seconds=seconds+delta,ever_overdue=ever_overdue or now()>=due where id=r.id returning * into r;
   if coalesce((r.rules->>'retest')::boolean,true)=false and r.batch<>'normal' and r.seconds>=(r.rules->>'seconds')::numeric then
    update training.requirements set completed_at=now(),completed_due=due where id=r.id;
   end if;
   update training.leases set seq=seq_no,last_at=now(),eligible=is_eligible where employee_id=me;
   pos=greatest(0,least(coalesce((p->>'position')::numeric,0),31536000));
   insert into training.positions values(r.id,l.material_id,pos) on conflict(requirement_id,material_id) do update set position=excluded.position;
   return jsonb_build_object('seconds',r.seconds,'eligible',is_eligible,'server_now',now(),'reason',case when is_eligible then '有效前景學習，已保存' else '已暫停：背景、未載入、影片未播放或文字閒置' end);
  elsif action='exam_start' then
   select * into paper from training.papers where requirement_id=r.id and submitted_at is null;
   if found then return training.paper_view(paper.id);end if;
   if r.lifecycle<>'active' or r.completed_at is not null or not training.open(c) then raise exception '目前不能開始測驗';end if;
   if r.seconds<(r.rules->>'seconds')::numeric then raise exception '學習時數尚未達標';end if;
   perform training.assert_course(c.published);
   select jsonb_agg(q) into questions from (select value q from jsonb_array_elements(c.published->'questions') order by random() limit (c.published->>'question_count')::int) sampled;
   insert into training.papers(requirement_id,questions,pass_score,total,expires_at) values(r.id,questions,(c.published->>'pass_score')::numeric,jsonb_array_length(questions),case when coalesce((c.published->>'minutes')::numeric,0)>0 then now()+((c.published->>'minutes')::numeric*interval '1 minute') end) returning id into pid;
   return training.paper_view(pid);
  elsif action in ('exam_save','exam_submit') then
   select * into paper from training.papers where id=(p->>'paper_id')::uuid and requirement_id=r.id for update;
   if not found then raise exception '試卷不存在';end if;
   if action='exam_save' and paper.submitted_at is null and r.lifecycle='active' then
    if not exists(select 1 from jsonb_array_elements(paper.questions) q where q->>'id'=p->>'question_id') then raise exception '試題不存在';end if;
    select q into v from jsonb_array_elements(paper.questions) q where q->>'id'=p->>'question_id';
    if jsonb_typeof(p->'answer')<>'array' or exists(select 1 from jsonb_array_elements_text(p->'answer') x where x::int<0 or x::int>=jsonb_array_length(v->'options')) or (select count(*)<>count(distinct value) from jsonb_array_elements(p->'answer')) or (v->>'kind'<>'multiple' and jsonb_array_length(p->'answer')>1) then raise exception '作答格式錯誤';end if;
    update training.papers set answers=jsonb_set(answers,array[p->>'question_id'],p->'answer') where id=paper.id;
   elsif action='exam_submit' and r.lifecycle='active' then perform training.grade(paper.id);end if;
   return training.paper_view(paper.id);
  end if;
 end if;
 if action='admin' then
  if not exists(select 1 from training.grants where employee_id=me and system_code='training') then raise exception '無管理權限';end if;
  return jsonb_build_object(
   'departments',(select coalesce(jsonb_agg(to_jsonb(d)),'[]') from training.departments d where training.allowed(me,'manage',d.id)),
   'employees',(select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('systems',(select coalesce(jsonb_agg(system_code),'[]') from training.memberships where employee_id=e.id),'tenures',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from training.tenures t where employee_id=e.id))),'[]') from public.employees e where training.allowed(me,'manage',e.department_id)),
   'jobs',(select coalesce(jsonb_agg(to_jsonb(j)),'[]') from training.jobs j where training.allowed(me,'manage',j.department_id)),
   'courses',(select coalesce(jsonb_agg(case when training.allowed(me,'admin') then to_jsonb(c) else jsonb_build_object('id',c.id,'published',training.course_public(c.published),'active',c.active,'version',c.version) end),'[]') from training.courses c where training.allowed(me,'admin') or (c.active and c.published is not null and (exists(select 1 from training.grants g where g.employee_id=me and g.system_code='training' and (g.all_departments or training.applies(c.published,g.department_id)))))),
   'requirements',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('course_title',c.published->>'title','sources',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from training.sources s where s.requirement_id=r.id))),'[]') from training.requirements r join public.employees e on e.id=r.employee_id join training.courses c on c.id=r.course_id where training.allowed(me,'manage',e.department_id)),
   'issues',(select coalesce(jsonb_agg(to_jsonb(i)),'[]') from training.issues i where training.allowed(me,'admin')),
   'settings',(select value from training.settings where training.allowed(me,'admin')),
   'grants',(select coalesce(jsonb_agg(to_jsonb(g)),'[]') from training.grants g where training.allowed(me,'admin')),
   'systems',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from training.systems s where training.allowed(me,'admin')));
 elsif action='department' then
  if not training.allowed(me,'admin') then raise exception '僅管理員可維護部門';end if;
  insert into training.departments(name) values(btrim(p->>'name')) returning id into new_id;return to_jsonb(new_id);
 elsif action in ('course_save','course_publish','course_disable','course_delete','retrain') then
  if not training.allowed(me,'admin') then raise exception '僅管理員可維護課程與題庫';end if;
  cid=coalesce(nullif(p->>'id','')::uuid,gen_random_uuid());
  select * into c from training.courses where id=cid for update;
  if action='course_save' then
   insert into training.courses(id,draft) values(cid,p->'content') on conflict(id) do update set draft=excluded.draft,revision=training.courses.revision+1;
  elsif action='course_publish' then
   if c.id is null then raise exception '先儲存草稿';end if;perform training.assert_course(c.draft);
   if coalesce(btrim(p->>'summary'),'')='' then raise exception '請填發布摘要';end if;
   -- Content-only updates keep the assignment version and original thresholds. Immutable publication revisions are separate.
   update training.courses set published=draft,version=case when version=0 then 1 else version end,revision=revision+1 where id=cid returning * into c;
   insert into training.course_versions(course_id,version,content,actor,summary) values(cid,c.revision,c.published,me,p->>'summary');
  elsif action='course_disable' then
   if coalesce(btrim(p->>'reason'),'')='' then raise exception '請填停用原因';end if;
   update training.courses set active=false where id=cid;
   update training.requirements set lifecycle='cancelled',cancellation_reason=p->>'reason',ever_overdue=ever_overdue or now()>=due where course_id=cid and lifecycle='active' and completed_at is null;
  elsif action='course_delete' then
   if c.published is not null or exists(select 1 from training.requirements where course_id=cid) then raise exception '僅無紀錄且未發布草稿可刪除';end if;
   delete from training.courses where id=cid;
  elsif action='retrain' then
   if coalesce(p->>'batch','')='' or p->>'batch'='normal' then raise exception '重訓須填獨立批次代碼';end if;
   for x in select value from jsonb_array_elements(p->'employees') loop
    perform training.assign((x#>>'{}')::uuid,cid,'retrain:'||(p->>'batch'),'更新重訓',p->'deadline',null,p->>'batch',c.published||jsonb_build_object('seconds',(p->>'seconds')::numeric,'retest',(p->>'retest')::boolean));
   end loop;
  end if;
  result=jsonb_build_object('id',cid);
 elsif action in ('job_save','job_publish','job_training') then
  new_id=coalesce(nullif(p->>'id','')::uuid,gen_random_uuid());select * into j from training.jobs where id=new_id for update;
  dep=coalesce(j.department_id,(p->>'department_id')::uuid);
  if not training.allowed(me,case when action='job_training' then 'manage' when action='job_publish' then 'admin' else 'job' end,dep) then raise exception '無職務維護權限';end if;
  if action='job_save' then
   if coalesce(btrim(p->'content'->>'name'),'')='' or coalesce(btrim(p->'content'->>'purpose'),'')='' then raise exception '請填職務名稱及目的';end if;
   insert into training.jobs(id,department_id,draft) values(new_id,dep,p->'content') on conflict(id) do update set draft=excluded.draft;
  else
   if j.id is null then raise exception '找不到職務';end if;
   v=case when action='job_training' then j.published||jsonb_build_object('training',p->'training') else j.draft end;
   if v is null then raise exception '請先發布職務說明書';end if;
   if coalesce(btrim(p->>'summary'),'')='' then raise exception '請填異動摘要';end if;
   for x in select value from jsonb_array_elements(coalesce(v->'training','[]')) union all select t.value from jsonb_array_elements(coalesce(v->'duties','[]')) d cross join lateral jsonb_array_elements(coalesce(d->'training','[]')) t loop
    if not exists(select 1 from training.courses where id=(x->>'course_id')::uuid and published is not null and active and training.applies(published,dep)) then raise exception '職務含未發布或不適用的課程';end if;
   end loop;
   update training.jobs set published=v,version=version+1 where id=new_id returning * into j;
   insert into training.job_versions(job_id,version,content,actor,summary) values(j.id,j.version,v,me,p->>'summary');
   for cid in select employee_id from training.tenures where job_id=j.id and end_date is null loop perform training.reconcile(cid);end loop;
  end if;
  result=jsonb_build_object('id',new_id);
 elsif action='person_save' then
  new_id=coalesce(nullif(p->>'id','')::uuid,gen_random_uuid());select * into other from public.employees where id=new_id for update;
  dep=(p->>'department_id')::uuid;
  if not training.allowed(me,'people',dep) or (other.id is not null and not training.allowed(me,'people',other.department_id)) then raise exception '無此部門人員維護權限';end if;
  if coalesce((p->>'active')::boolean,true)=false and coalesce(btrim(p->>'inactive_reason'),'')='' then raise exception '停用時須填原因';end if;
  if coalesce(p->>'email','')!~'^[^ @]+@[^ @]+\.[^ @]+$' then raise exception 'Email 格式錯誤';end if;
  -- Existing auth user is linked by the legacy employees trigger. A changed email breaks the previous mapping.
  insert into public.employees(id,name,email,hire_date,department_id,active,inactive_reason) values(new_id,p->>'name',lower(p->>'email'),nullif(p->>'hire_date','')::date,dep,coalesce((p->>'active')::boolean,true),p->>'inactive_reason')
  on conflict(id) do update set name=excluded.name,email=excluded.email,hire_date=excluded.hire_date,department_id=excluded.department_id,active=excluded.active,inactive_reason=excluded.inactive_reason,
   user_id=case when lower(public.employees.email::text)=lower(excluded.email::text) then public.employees.user_id else null end,updated_at=now();
  if p ? 'systems' then
   -- HR may manage training membership only; other system entitlements require platform admin.
   if not training.allowed(me,'admin') and exists(select 1 from jsonb_array_elements_text(p->'systems') s where s<>'training' and not exists(select 1 from training.memberships where employee_id=new_id and system_code=s)) then raise exception '僅管理員可設定其他系統資格';end if;
   if training.allowed(me,'admin') then delete from training.memberships where employee_id=new_id;
   else delete from training.memberships where employee_id=new_id and system_code='training';end if;
   insert into training.memberships select new_id,value from jsonb_array_elements_text(p->'systems') where value='training' or training.allowed(me,'admin') on conflict do nothing;
  end if;
  if p ? 'tenures' then
   for x in select value from jsonb_array_elements(p->'tenures') loop
    if not exists(select 1 from training.jobs where id=(x->>'job_id')::uuid and training.allowed(me,'people',department_id)) then raise exception '無此職務範圍權限';end if;
    insert into training.tenures(employee_id,job_id,start_date) values(new_id,(x->>'job_id')::uuid,(x->>'start_date')::date) on conflict(employee_id,job_id) where end_date is null do nothing;
   end loop;
   update training.tenures t set end_date=(now() at time zone 'Asia/Taipei')::date where t.employee_id=new_id and end_date is null and not exists(select 1 from jsonb_array_elements(p->'tenures') x where (x->>'job_id')::uuid=t.job_id);
  end if;
  perform training.reconcile(new_id);result=jsonb_build_object('id',new_id);
 elsif action='assign' then
  select * into other from public.employees where id=(p->>'employee_id')::uuid;
  if not training.allowed(me,'manage',other.department_id) then raise exception '無指派權限';end if;
  cid=(p->>'course_id')::uuid;select * into c from training.courses where id=cid;
  rid=training.assign(other.id,cid,'direct:'||coalesce(p->>'key',gen_random_uuid()::text),'個別指派',p->'deadline',nullif(p->>'base','')::date);
  if exists(select 1 from training.requirements where id=rid and conflict_pending) and coalesce(btrim(p->>'conflict_reason'),'')='' then raise exception '開課期間衝突，請填保留原因或調整期限';end if;
  update training.requirements set conflict_reason=nullif(p->>'conflict_reason',''),conflict_pending=false where id=rid and nullif(p->>'conflict_reason','') is not null;
  result=jsonb_build_object('id',rid);
 elsif action in ('deadline','conflict') then
  select * into r from training.requirements where id=(p->>'id')::uuid for update;select department_id into dep from public.employees where id=r.employee_id;
  if not training.allowed(me,'manage',dep) then raise exception '無期限維護權限';end if;
  if coalesce(btrim(p->>'reason'),'')='' then raise exception '必須填寫原因';end if;
  if action='conflict' then update training.requirements set conflict_reason=p->>'reason',conflict_pending=false where id=r.id;
  else
   new_due=training.end_day((p->>'date')::date);
   insert into training.deadline_changes(requirement_id,old_due,new_due,reason,actor) values(r.id,r.due,new_due,p->>'reason',me);
   update training.requirements set due=case when completed_at is null then new_due else due end,ever_overdue=ever_overdue or (completed_at is null and now()>=due) where id=r.id;
  end if;result='{}';
 elsif action='issue_resolve' then
  if not training.allowed(me,'admin') then raise exception '無處理教材權限';end if;
  update training.issues set resolution=p->>'resolution' where id=(p->>'id')::uuid;result='{}';
 elsif action='grant' then
  if not training.allowed(me,'admin') then raise exception '僅管理員可設定權限';end if;
  if p->>'delete'='true' then delete from training.grants where id=(p->>'id')::uuid;
  else
   if p->>'role'='admin' and p->>'system_code'='training' and not coalesce((p->>'all_departments')::boolean,false) then raise exception '平台管理員須為全平台範圍';end if;
   insert into training.grants(employee_id,system_code,role,department_id,all_departments) values((p->>'employee_id')::uuid,p->>'system_code',p->>'role',nullif(p->>'department_id','')::uuid,(p->>'all_departments')::boolean) on conflict do nothing;
  end if;result='{}';
 elsif action='settings' then
  if not training.allowed(me,'admin') then raise exception '無設定權限';end if;
  if (p->>'time')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or (p->>'overdue_every')::int<1 then raise exception '提醒時間或間隔錯誤';end if;
  update training.settings set value=p;result='{}';
 elsif action='system' then
  if not training.allowed(me,'admin') then raise exception '無系統目錄設定權限';end if;
  if p->>'code'='customer-service' and coalesce((p->>'enabled')::boolean,false) then raise exception '客服尚未接入，第一版維持停用';end if;
  if coalesce(p->>'entry','')!~'^#/' and coalesce((p->>'enabled')::boolean,false) then raise exception '第一版系統入口須為本站路由';end if;
  insert into training.systems(code,name,entry,admin_entry,enabled,sort_order) values(p->>'code',p->>'name',p->>'entry',p->>'admin_entry',(p->>'enabled')::boolean,(p->>'sort_order')::int)
  on conflict(code) do update set name=excluded.name,entry=excluded.entry,admin_entry=excluded.admin_entry,enabled=excluded.enabled,sort_order=excluded.sort_order;result='{}';
 elsif action='versions' then
  if p->>'kind'='job' then
   select department_id into dep from training.jobs where id=(p->>'id')::uuid;
   if not training.allowed(me,'manage',dep) then raise exception '無版本查詢權限';end if;
   return coalesce((select jsonb_agg(to_jsonb(t) order by t.version desc) from training.job_versions t where job_id=(p->>'id')::uuid),'[]');
  else
   if not training.allowed(me,'admin') then raise exception '無課程版本權限';end if;
   return coalesce((select jsonb_agg(to_jsonb(t) order by t.version desc) from training.course_versions t where course_id=(p->>'id')::uuid),'[]');
  end if;
 elsif action='report' then
  if not exists(select 1 from training.grants where employee_id=me and system_code='training') then raise exception '無報表權限';end if;
  if p->>'kind'='attempts' then
   return coalesce((select jsonb_agg(to_jsonb(a)-'questions'||jsonb_build_object('employee_id',e.id,'name',e.name,'email',e.email,'department_id',e.department_id,'score',round(a.correct::numeric*100/a.total,2))) from training.papers a join training.requirements r on r.id=a.requirement_id join public.employees e on e.id=r.employee_id where training.allowed(me,'manage',e.department_id) and training.report_matches(r,p)),'[]');
  elsif p->>'kind'='deadlines' then
   return coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('employee_id',e.id,'name',e.name)) from training.deadline_changes d join training.requirements r on r.id=d.requirement_id join public.employees e on e.id=r.employee_id where training.allowed(me,'manage',e.department_id) and training.report_matches(r,p)),'[]');
  else
   return coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('name',e.name,'email',e.email,'department_id',e.department_id,'title',c.published->>'title','sources',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from training.sources s where s.requirement_id=r.id))) from training.requirements r join public.employees e on e.id=r.employee_id join training.courses c on c.id=r.course_id where training.allowed(me,'manage',e.department_id) and training.report_matches(r,p)
    and (coalesce(p->>'department_id','')='' or e.department_id=(p->>'department_id')::uuid)
    and (coalesce(p->>'employee_id','')='' or e.id=(p->>'employee_id')::uuid)
    and (coalesce(p->>'course_id','')='' or r.course_id=(p->>'course_id')::uuid)
    and (coalesce(p->>'cycle','')='' or r.cycle=p->>'cycle')
    and (coalesce(p->>'job_id','')='' or exists(select 1 from training.sources s where s.requirement_id=r.id and s.source_key like 'job:'||(p->>'job_id')||':%'))
    and (coalesce(p->>'status','')='' or (p->>'status'='completed' and r.completed_at is not null) or (p->>'status'='incomplete' and r.completed_at is null and r.lifecycle='active') or r.lifecycle=p->>'status')),'[]');
  end if;
 elsif action in ('import_preview','import_commit') then
  if action='import_commit' then
   select * into imp from training.imports where id=(p->>'id')::uuid and actor=me for update;
   if not found then raise exception '找不到自己的匯入預覽';end if;
   if imp.committed_at is not null then return jsonb_build_object('committed',true);end if;
   if jsonb_array_length(imp.errors)>0 then raise exception '預覽含錯誤，整批未寫入';end if;
   p=jsonb_build_object('rows',imp.rows,'fields',imp.fields);
  end if;
  -- Serialize roster imports and person writes via table lock. Fingerprint rechecked inside this transaction.
  lock table public.employees in share row exclusive mode;
  select md5(coalesce(string_agg(to_jsonb(e)::text,'' order by e.id),'')) into fp from public.employees e where training.allowed(me,'people',e.department_id);
  if action='import_commit' and fp<>imp.fingerprint then raise exception '名冊已異動，請重新預覽';end if;
  if jsonb_typeof(p->'rows')<>'array' or jsonb_array_length(p->'rows')=0 or jsonb_array_length(p->'rows')>2000 then raise exception '匯入資料為空';end if;
  for x in select value from jsonb_array_elements(p->'rows') loop
   begin
    select * into other from public.employees where lower(email::text)=lower(x->>'email');
    select id into dep from training.departments where name=x->>'department';
    if other.id is not null and (coalesce(x->>'department','')='' or not (p->'fields' ? 'department')) then dep=other.department_id;end if;
    if not training.allowed(me,'people',dep) or (other.id is not null and not training.allowed(me,'people',other.department_id)) then raise exception '無部門權限或部門不存在';end if;
    if coalesce(nullif(btrim(x->>'name'),''),other.name,'')='' or coalesce(x->>'email','')!~'^[^ @]+@[^ @]+\.[^ @]+$' then raise exception '姓名或 Email 格式錯誤';end if;
    if (select count(*) from jsonb_array_elements(p->'rows') z where lower(z->>'email')=lower(x->>'email'))>1 then raise exception '檔案內 Email 重複';end if;
    if nullif(x->>'hire_date','') is not null then perform (x->>'hire_date')::date;end if;
    if nullif(x->>'active','') is not null and x->>'active' not in ('true','false') then raise exception '啟用狀態須為 true 或 false';end if;
    if nullif(x->>'job','') is not null and not exists(select 1 from training.jobs where department_id=dep and published->>'name'=x->>'job') then raise exception '職務不存在或尚未發布';end if;
    if nullif(x->>'job','') is not null and nullif(x->>'tenure_date','') is null then raise exception '設定職務須填接任日';end if;
    if nullif(x->>'tenure_date','') is not null then perform (x->>'tenure_date')::date;end if;
    for z in select to_jsonb(value) from unnest(string_to_array(coalesce(x->>'systems',''),',')) u(value) loop
     if not exists(select 1 from training.systems where code=btrim(z#>>'{}')) then raise exception '系統代碼不存在';end if;
     if btrim(z#>>'{}')<>'training' and not training.allowed(me,'admin') and not exists(select 1 from training.memberships where employee_id=other.id and system_code=btrim(z#>>'{}')) then raise exception '無其他系統資格設定權限';end if;
    end loop;
   exception when others then errors=errors||jsonb_build_array(jsonb_build_object('email',x->>'email','error',sqlerrm));end;
  end loop;
  if action='import_preview' then
   insert into training.imports(actor,rows,fields,fingerprint,errors) values(me,p->'rows',p->'fields',fp,errors) returning id into new_id;
   return jsonb_build_object('id',new_id,'errors',errors,'rows',(select jsonb_agg(x||jsonb_build_object('operation',case when exists(select 1 from public.employees where lower(email::text)=lower(x->>'email')) then '更新' else '新增' end)) from jsonb_array_elements(p->'rows') x));
  end if;
  if jsonb_array_length(errors)>0 then raise exception '匯入再次檢核失敗：%',errors;end if;
  for x in select value from jsonb_array_elements(p->'rows') loop
   select * into other from public.employees where lower(email::text)=lower(x->>'email');
   select id into dep from training.departments where name=x->>'department';
   v=case when other.id is null then jsonb_build_object('name',x->>'name','email',x->>'email','department_id',dep,'hire_date',nullif(x->>'hire_date',''),'active',true) else jsonb_build_object('id',other.id,'name',other.name,'email',other.email,'department_id',other.department_id,'hire_date',other.hire_date,'active',other.active) end;
   v=v||jsonb_build_object('inactive_reason',case when other.inactive_reason is not null then other.inactive_reason else 'Excel 名冊匯入停用' end);
   for z in select value from jsonb_array_elements(p->'fields') loop
    if coalesce(x->>(z#>>'{}'),'')<>'' and (z#>>'{}') in ('name','hire_date','active') then v=v||jsonb_build_object(z#>>'{}',x->(z#>>'{}'));end if;
    if z#>>'{}'='department' and coalesce(x->>'department','')<>'' then v=v||jsonb_build_object('department_id',dep);end if;
    if z#>>'{}'='systems' and coalesce(x->>'systems','')<>'' then v=v||jsonb_build_object('systems',(select jsonb_agg(btrim(s)) from unnest(string_to_array(x->>'systems',',')) s));end if;
    if z#>>'{}'='job' and coalesce(x->>'job','')<>'' then
     v=v||jsonb_build_object('tenures',(select coalesce(jsonb_agg(jsonb_build_object('job_id',job_id,'start_date',start_date)),'[]') from training.tenures where employee_id=other.id and end_date is null)||jsonb_build_array(jsonb_build_object('job_id',(select id from training.jobs where department_id=dep and published->>'name'=x->>'job'),'start_date',x->>'tenure_date')));
    end if;
   end loop;
   perform public.portal_rpc('person_save',v);updated=updated+1;
  end loop;
  update training.imports set committed_at=now() where id=imp.id;result=jsonb_build_object('committed',true,'count',updated);
 else raise exception '未知操作';
 end if;
 insert into training.audit(actor,action,body) values(me,action,p);
 return coalesce(result,'{}');
end $$;
revoke all on function public.portal_rpc(text,jsonb) from public,anon;
grant execute on function public.portal_rpc(text,jsonb) to authenticated;
insert into training.migrations(version) values('202611150003') on conflict do nothing;
commit;
