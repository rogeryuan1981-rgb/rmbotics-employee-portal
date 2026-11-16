-- Private PDF material storage. Published course access is checked for every read.
begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('training-materials','training-materials',false,20971520,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function training.material_file_access(object_name text, writing boolean default false)
returns boolean language plpgsql security definer
set search_path=pg_catalog,public,training
as $$
declare me uuid;
begin
  if auth.uid() is null then return false; end if;
  me=training.actor();
  if object_name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$' then return false; end if;
  if training.allowed(me,'admin') then return true; end if;
  if writing or not training.member(me,'training') then return false; end if;
  return exists(
    select 1 from training.requirements r join training.courses c on c.id=r.course_id
    where r.employee_id=me and r.lifecycle='active'
    and exists(
      select 1 from jsonb_array_elements(coalesce(c.published->'materials','[]'::jsonb)) m
      where m->>'kind'='pdf'
      and m->>'content' ~ '^https://[^/]+/storage/v1/object/authenticated/training-materials/'
      and split_part(m->>'content','/storage/v1/object/authenticated/training-materials/',2)=object_name
    )
  );
end $$;

revoke all on function training.material_file_access(text,boolean) from public,anon;
grant usage on schema training to authenticated;
grant execute on function training.material_file_access(text,boolean) to authenticated;

-- Preserve the certificate access scope while moving its private-table lookup
-- into an authorization helper. PostgreSQL evaluates every storage policy for
-- a request, so direct private-table subqueries would block other buckets.
create or replace function training.certificate_file_access(object_name text, writing boolean default false)
returns boolean language plpgsql security definer
set search_path=pg_catalog,public,training
as $$
declare me uuid;
begin
  if auth.uid() is null then return false; end if;
  me=training.actor();
  if writing then
    return split_part(object_name,'/',1)=me::text and exists(
      select 1 from training.external_enrollments x
      where x.id::text=split_part(object_name,'/',2) and x.employee_id=me
    );
  end if;
  return split_part(object_name,'/',1)=me::text or exists(
    select 1 from training.external_enrollments x join public.employees e on e.id=x.employee_id
    where x.certificate_path=object_name and training.allowed(me,'manage',e.department_id)
  );
end $$;
revoke all on function training.certificate_file_access(text,boolean) from public,anon;
grant execute on function training.certificate_file_access(text,boolean) to authenticated;

drop policy if exists training_certificates_insert on storage.objects;
create policy training_certificates_insert on storage.objects for insert to authenticated
with check(bucket_id='training-certificates' and training.certificate_file_access(name,true));
drop policy if exists training_certificates_select on storage.objects;
create policy training_certificates_select on storage.objects for select to authenticated
using(bucket_id='training-certificates' and training.certificate_file_access(name,false));
drop policy if exists training_certificates_update on storage.objects;
create policy training_certificates_update on storage.objects for update to authenticated
using(bucket_id='training-certificates' and training.certificate_file_access(name,true))
with check(bucket_id='training-certificates' and training.certificate_file_access(name,true));

drop policy if exists training_material_pdf_insert on storage.objects;
create policy training_material_pdf_insert on storage.objects for insert to authenticated
with check(bucket_id='training-materials' and training.material_file_access(name,true));

drop policy if exists training_material_pdf_select on storage.objects;
create policy training_material_pdf_select on storage.objects for select to authenticated
using(bucket_id='training-materials' and training.material_file_access(name,false));

-- Files are immutable: each replacement gets a new path, preserving published versions.
insert into training.migrations(version) values('20261116094447') on conflict do nothing;
notify pgrst,'reload schema';
commit;
