-- Audit Bovin v12 pilote — base commune réservée aux techniciens
-- À coller dans Supabase > SQL Editor > New query, puis Run.

create table if not exists public.shared_state (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  version bigint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.backup_snapshots (
  backup_date date primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_by text
);

alter table public.shared_state enable row level security;
alter table public.backup_snapshots enable row level security;

-- Tous les utilisateurs authentifiés sont des techniciens autorisés à voir et modifier toute la base.
drop policy if exists "technicians_all_shared_state" on public.shared_state;
create policy "technicians_all_shared_state"
on public.shared_state for all
to authenticated
using (true)
with check (true);

drop policy if exists "technicians_all_backups" on public.backup_snapshots;
create policy "technicians_all_backups"
on public.backup_snapshots for all
to authenticated
using (true)
with check (true);

grant select, insert, update, delete on public.shared_state to authenticated;
grant select, insert, update, delete on public.backup_snapshots to authenticated;
