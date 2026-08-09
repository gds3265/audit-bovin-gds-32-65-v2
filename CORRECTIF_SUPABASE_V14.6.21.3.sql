-- Correctif v14.6.21.3 — questionnaire éleveur
-- À exécuter UNE FOIS dans Supabase > SQL Editor.
-- Ne supprime aucune réponse ni aucune donnée existante.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.fetch_farmer_questionnaire(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
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
    'id',q.id, 'title',q.title, 'type',q.type, 'schema',q.schema,
    'response',coalesce(q.response,'{}'::jsonb), 'status',q.status,
    'expires_at',q.expires_at, 'submitted_at',q.submitted_at
  );
end;
$$;

create or replace function public.submit_farmer_questionnaire(p_token text, p_response jsonb)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  updated_count integer;
begin
  update public.farmer_questionnaires
  set response = coalesce(p_response,'{}'::jsonb),
      status = 'submitted', submitted_at = now(), updated_at = now()
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
