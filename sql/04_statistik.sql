-- ============================================================
--  Update 5: Statistik-Tool (bereits ausgeführt)
--  Match-Statistik (Aufstellung + Ereignisse) zu einem Match-Einsatz
--  aus dem Linien-Tool. Gegner werden ohne Namen gespeichert.
--  Hinweis: Die Policies "Team hat Zugriff" wurden mit SQL 05 ersetzt.
-- ============================================================

alter table public.einsaetze
  add column tore_fuer      int check (tore_fuer >= 0),
  add column tore_gegen     int check (tore_gegen >= 0),
  add column abschnitte     int check (abschnitte between 1 and 4),
  add column abschnitt_min  int check (abschnitt_min between 5 and 30),
  add column stat_am        timestamptz;

create table public.match_aufstellung (
  id          uuid primary key default gen_random_uuid(),
  einsatz_id  uuid not null references public.einsaetze(id) on delete cascade,
  kader_id    uuid not null references public.kader(id) deferrable initially deferred,
  nummer      int check (nummer between 0 and 99),
  goalie      boolean not null default false,
  start       boolean not null default false,
  erstellt_am timestamptz not null default now(),
  unique (einsatz_id, kader_id)
);
create index match_aufstellung_einsatz_idx on public.match_aufstellung (einsatz_id);
create index match_aufstellung_kader_idx on public.match_aufstellung (kader_id);

--  zeit        = Spielzeit in Sekunden (durchlaufend, z.B. 35:25 → 2125)
--  situation   = nur wenn von Hand gesetzt, sonst rechnet die App sie aus
--  variante_id = ab diesem Ereignis gilt diese Linien-Version
--  linie_id    = Linie/Formation auf dem Feld (Plus/Minus, freiwillig)
create table public.match_ereignisse (
  id          uuid primary key default gen_random_uuid(),
  einsatz_id  uuid not null references public.einsaetze(id) on delete cascade,
  art         text not null check (art in ('tor', 'gegentor', 'strafe', 'gegnerstrafe', 'goalie')),
  zeit        int  not null check (zeit >= 0),
  kader_id    uuid references public.kader(id) deferrable initially deferred,
  assist_id   uuid references public.kader(id) deferrable initially deferred,
  gegner_nr   int check (gegner_nr between 0 and 99),
  minuten     text,
  grund       text,
  situation   text check (situation in ('eq', 'pp', 'bp', '6v5', '5v6', 'pen')),
  variante_id uuid references public.varianten(id) on delete set null,
  linie_id    uuid references public.linien(id) on delete set null,
  notiz       text,
  erstellt_am timestamptz not null default now()
);
create index match_ereignisse_einsatz_idx on public.match_ereignisse (einsatz_id, zeit);
create index match_ereignisse_kader_idx on public.match_ereignisse (kader_id);
create index match_ereignisse_assist_idx on public.match_ereignisse (assist_id);

create table public.su_zuordnung (
  id          uuid primary key default gen_random_uuid(),
  liste_id    uuid not null references public.kaderlisten(id) on delete cascade,
  su_name     text not null,
  kader_id    uuid not null references public.kader(id) on delete cascade,
  erstellt_am timestamptz not null default now(),
  unique (liste_id, su_name)
);

alter table public.match_aufstellung enable row level security;
alter table public.match_ereignisse  enable row level security;
alter table public.su_zuordnung      enable row level security;

create policy "Team hat Zugriff" on public.match_aufstellung for all to authenticated using (true) with check (true);
create policy "Team hat Zugriff" on public.match_ereignisse  for all to authenticated using (true) with check (true);
create policy "Team hat Zugriff" on public.su_zuordnung      for all to authenticated using (true) with check (true);

alter publication supabase_realtime
  add table public.match_aufstellung, public.match_ereignisse, public.su_zuordnung;
