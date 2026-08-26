-- ============================================================
-- SUIVI DES CONCOURS v0.2
-- À exécuter UNE SEULE FOIS dans Supabase > SQL Editor
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.concours (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  date_concours date not null,
  type_suivi text not null default 'suivi'
    check (type_suivi in ('suivi','gere')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.concours_regles (
  id uuid primary key default gen_random_uuid(),
  concours_id uuid not null references public.concours(id) on delete cascade,
  analyse_type text not null,
  age_min_mois integer not null default 0,
  age_max_mois integer,
  delai_max_jours integer not null default 30,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.concours_animaux (
  id uuid primary key default gen_random_uuid(),
  concours_id uuid not null references public.concours(id) on delete cascade,
  eleveur text not null,
  cheptel text,
  bovin text not null,
  naissance date,
  origine text not null default 'Ajout manuel',
  sur_certificat boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create unique index if not exists concours_animaux_unique
on public.concours_animaux(concours_id, bovin);

create table if not exists public.concours_resultats (
  id uuid primary key default gen_random_uuid(),
  animal_id uuid not null references public.concours_animaux(id) on delete cascade,
  analyse_type text not null,
  statut text not null default 'attente'
    check (statut in (
      'attente','labo','conforme','nonconforme',
      'positif','recontrole','inutile'
    )),
  date_prelevement date,
  commentaire text,
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  unique(animal_id, analyse_type)
);

create table if not exists public.concours_certificats (
  id uuid primary key default gen_random_uuid(),
  concours_id uuid not null references public.concours(id) on delete cascade,
  eleveur text not null,
  date_signature date,
  mode_transmission text,
  commentaire text,
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  unique(concours_id, eleveur)
);

-- ------------------------------------------------------------
-- RLS : accès uniquement aux utilisateurs Supabase connectés
-- ------------------------------------------------------------

alter table public.concours enable row level security;
alter table public.concours_regles enable row level security;
alter table public.concours_animaux enable row level security;
alter table public.concours_resultats enable row level security;
alter table public.concours_certificats enable row level security;

drop policy if exists "concours_authenticated_all" on public.concours;
create policy "concours_authenticated_all"
on public.concours for all
to authenticated
using (true)
with check (true);

drop policy if exists "concours_regles_authenticated_all" on public.concours_regles;
create policy "concours_regles_authenticated_all"
on public.concours_regles for all
to authenticated
using (true)
with check (true);

drop policy if exists "concours_animaux_authenticated_all" on public.concours_animaux;
create policy "concours_animaux_authenticated_all"
on public.concours_animaux for all
to authenticated
using (true)
with check (true);

drop policy if exists "concours_resultats_authenticated_all" on public.concours_resultats;
create policy "concours_resultats_authenticated_all"
on public.concours_resultats for all
to authenticated
using (true)
with check (true);

drop policy if exists "concours_certificats_authenticated_all" on public.concours_certificats;
create policy "concours_certificats_authenticated_all"
on public.concours_certificats for all
to authenticated
using (true)
with check (true);


-- v0.3.0 : catalogue général et demandes par concours
create table if not exists public.concours_regles_catalogue (id uuid primary key default gen_random_uuid(), maladie text not null, libelle_analyse text not null, matrice text, technique text, age_min_mois integer not null default 0, age_max_mois integer, recevable_validation boolean not null default true, remboursable boolean not null default true, methode_reference_remboursement boolean not null default false, created_by uuid default auth.uid(), created_at timestamptz not null default now());
create table if not exists public.concours_demandes (id uuid primary key default gen_random_uuid(), concours_id uuid not null references public.concours(id) on delete cascade, maladie text not null, delai_max_jours integer not null default 30, created_by uuid default auth.uid(), created_at timestamptz not null default now(), unique(concours_id,maladie));
alter table public.concours_regles_catalogue enable row level security;
alter table public.concours_demandes enable row level security;
drop policy if exists "concours_regles_catalogue_authenticated_all" on public.concours_regles_catalogue;
create policy "concours_regles_catalogue_authenticated_all" on public.concours_regles_catalogue for all to authenticated using (true) with check (true);
drop policy if exists "concours_demandes_authenticated_all" on public.concours_demandes;
create policy "concours_demandes_authenticated_all" on public.concours_demandes for all to authenticated using (true) with check (true);
insert into public.concours_regles_catalogue (maladie,libelle_analyse,matrice,technique,age_min_mois,age_max_mois,recevable_validation,remboursable,methode_reference_remboursement) select * from (values
('BVD','BVD Ag biopsie auriculaire','Biopsie auriculaire','Antigénémie',0,2,true,true,true),
('BVD','BVD PCR biopsie auriculaire','Biopsie auriculaire','PCR',0,2,true,true,false),
('BVD','BVD Ag sérum','Sérum','Antigénémie',0,2,false,false,false),
('BVD','BVD PCR individuelle sérum','Sérum','PCR individuelle',0,2,true,true,false),
('BVD','BVD PCR mélange sérum','Sérum','PCR mélange',0,2,false,false,false),
('BVD','BVD Ag biopsie auriculaire','Biopsie auriculaire','Antigénémie',3,null,true,true,true),
('BVD','BVD PCR biopsie auriculaire','Biopsie auriculaire','PCR',3,null,true,true,false),
('BVD','BVD Ag sérum','Sérum','Antigénémie',3,null,true,true,true),
('BVD','BVD PCR individuelle sérum','Sérum','PCR individuelle',3,null,true,true,false),
('BVD','BVD PCR mélange sérum','Sérum','PCR mélange',3,null,true,true,false)
) as v(maladie,libelle_analyse,matrice,technique,age_min_mois,age_max_mois,recevable_validation,remboursable,methode_reference_remboursement) where not exists (select 1 from public.concours_regles_catalogue where maladie='BVD');


-- ============================================================
-- v0.3.1 - CONTRÔLE DES LISTES D'INSCRITS AVEC LE FICHIER MÉTIER
-- ============================================================

alter table public.concours_animaux
  add column if not exists commune_partenaire text,
  add column if not exists controle_metier text not null default 'pending',
  add column if not exists detenteur_metier text,
  add column if not exists cheptel_metier text,
  add column if not exists naissance_metier date;



-- ============================================================
-- v0.3.2 - MULTI-DEPARTEMENTS
-- ============================================================

create table if not exists public.concours_departements (
  id uuid primary key default gen_random_uuid(),
  concours_id uuid not null references public.concours(id) on delete cascade,
  departement text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique(concours_id, departement)
);

alter table public.concours_departements enable row level security;

drop policy if exists "concours_departements_authenticated_all" on public.concours_departements;
create policy "concours_departements_authenticated_all"
on public.concours_departements for all
to authenticated
using (true)
with check (true);

alter table public.concours_animaux
  add column if not exists departement text;

create index if not exists concours_animaux_departement_idx
on public.concours_animaux(concours_id, departement);


-- ============================================================
-- v0.3.7 - SUIVI DE RECEPTION / VALIDATION DES CERTIFICATS
-- ============================================================

alter table public.concours_certificats
  add column if not exists statut_certificat text not null default 'non_recu',
  add column if not exists date_reception date;

