-- ============================================================
--  Update 3: Linien-Tool (bereits ausgeführt)
--  Einsätze (Training/Match) → Versionen → Linien/PP/BP/6:5
--  → eingeteilte Personen. Dazu Chemie-Notizen (Paare).
--  Hinweis: Die Policies "Team hat Zugriff" wurden mit SQL 05 ersetzt.
-- ============================================================

create table public.einsaetze (
  id          uuid primary key default gen_random_uuid(),
  liste_id    uuid not null references public.kaderlisten(id) on delete cascade,
  typ         text not null check (typ in ('training', 'match')),
  datum       date not null default current_date,
  titel       text,
  notiz       text,
  resultat    text,
  wettbewerb  text check (wettbewerb in ('meisterschaft', 'cup', 'test')),
  ort         text check (ort in ('heim', 'auswaerts')),
  erstellt_am timestamptz not null default now()
);
create index einsaetze_liste_idx on public.einsaetze (liste_id, datum desc);

create table public.varianten (
  id          uuid primary key default gen_random_uuid(),
  einsatz_id  uuid not null references public.einsaetze(id) on delete cascade,
  nr          int  not null default 1,
  name        text,
  erstellt_am timestamptz not null default now()
);
create index varianten_einsatz_idx on public.varianten (einsatz_id);

create table public.linien (
  id          uuid primary key default gen_random_uuid(),
  variante_id uuid not null references public.varianten(id) on delete cascade,
  art         text not null default 'linie' check (art in ('linie', 'pp', 'bp', '6v5')),
  nr          int  not null default 1,
  name        text,
  system      text not null,
  note        numeric(2,1) check (note between 1 and 6),
  notiz       text,
  anzahl      int check (anzahl >= 0),
  tore        int check (tore >= 0),
  erstellt_am timestamptz not null default now()
);
create index linien_variante_idx on public.linien (variante_id);

-- kader_id ohne "on delete": Personen mit Linien-Historie können nicht gelöscht
-- werden (nur inaktiv setzen). "deferred": ganze Saison/Team bleibt löschbar.
create table public.linien_spieler (
  id          uuid primary key default gen_random_uuid(),
  linie_id    uuid not null references public.linien(id) on delete cascade,
  kader_id    uuid references public.kader(id) deferrable initially deferred,
  gast_name   text,
  posten      text not null,
  rolle       text not null default 'S' check (rolle in ('V', 'S', 'flex')),
  sort        int  not null default 0,
  erstellt_am timestamptz not null default now(),
  check (kader_id is not null or nullif(trim(gast_name), '') is not null)
);
create index linien_spieler_linie_idx on public.linien_spieler (linie_id);
create index linien_spieler_kader_idx on public.linien_spieler (kader_id);
create unique index linien_spieler_posten_uq on public.linien_spieler (linie_id, posten) where posten <> 'Z';

create table public.chemie (
  id          uuid primary key default gen_random_uuid(),
  liste_id    uuid not null references public.kaderlisten(id) on delete cascade,
  kader_a     uuid not null references public.kader(id) on delete cascade,
  kader_b     uuid not null references public.kader(id) on delete cascade,
  wertung     text not null check (wertung in ('gut', 'schlecht')),
  notiz       text,
  erstellt_am timestamptz not null default now(),
  check (kader_a <> kader_b)
);
create index chemie_liste_idx on public.chemie (liste_id);

alter table public.einsaetze      enable row level security;
alter table public.varianten      enable row level security;
alter table public.linien         enable row level security;
alter table public.linien_spieler enable row level security;
alter table public.chemie         enable row level security;

create policy "Team hat Zugriff" on public.einsaetze      for all to authenticated using (true) with check (true);
create policy "Team hat Zugriff" on public.varianten      for all to authenticated using (true) with check (true);
create policy "Team hat Zugriff" on public.linien         for all to authenticated using (true) with check (true);
create policy "Team hat Zugriff" on public.linien_spieler for all to authenticated using (true) with check (true);
create policy "Team hat Zugriff" on public.chemie         for all to authenticated using (true) with check (true);

alter publication supabase_realtime
  add table public.einsaetze, public.varianten, public.linien, public.linien_spieler, public.chemie;
