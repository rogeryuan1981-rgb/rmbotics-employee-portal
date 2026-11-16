begin;

-- Cover the actor foreign key used by material-version audit lookups and deletes.
create index if not exists material_versions_actor_fkey_idx
  on training.material_versions(actor);

insert into training.migrations(version)
values ('202611160003')
on conflict do nothing;

commit;
