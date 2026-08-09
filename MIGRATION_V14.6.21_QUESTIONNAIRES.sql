-- v14.6.21 — Questionnaires éleveur partageables
create extension if not exists pgcrypto;

create table if not exists public.farmer_questionnaires (
  id uuid primary key default gen_random_uuid(),
  visit_id text not null,
  farm_id text not null,
  type text not null,
  title text not null,
  schema jsonb not null default '{}'::jsonb,
  response jsonb,
  token_hash text not null unique,
  status text not null default 'sent',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  created_by text
);

alter table public.farmer_questionnaires enable row level security;

drop policy if exists "technicians_all_farmer_questionnaires" on public.farmer_questionnaires;
create policy "technicians_all_farmer_questionnaires"
on public.farmer_questionnaires for all
to authenticated
using (true)
with check (true);

grant select, insert, update, delete on public.farmer_questionnaires to authenticated;

create or replace function public.fetch_farmer_questionnaire(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.farmer_questionnaires%rowtype;
begin
  select * into q
  from public.farmer_questionnaires
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and expires_at > now()
  limit 1;

  if q.id is null then
    return jsonb_build_object('error','Lien invalide ou expiré.');
  end if;

  return jsonb_build_object(
    'id',q.id,
    'title',q.title,
    'type',q.type,
    'schema',q.schema,
    'response',coalesce(q.response,'{}'::jsonb),
    'status',q.status,
    'expires_at',q.expires_at,
    'submitted_at',q.submitted_at
  );
end;
$$;

create or replace function public.submit_farmer_questionnaire(p_token text, p_response jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  update public.farmer_questionnaires
  set response = coalesce(p_response,'{}'::jsonb),
      status = 'submitted',
      submitted_at = now(),
      updated_at = now()
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and expires_at > now();

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

revoke all on function public.fetch_farmer_questionnaire(text) from public;
revoke all on function public.submit_farmer_questionnaire(text,jsonb) from public;
grant execute on function public.fetch_farmer_questionnaire(text) to anon, authenticated;
grant execute on function public.submit_farmer_questionnaire(text,jsonb) to anon, authenticated;
