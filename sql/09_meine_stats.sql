-- ============================================================
--  Update 09: Tool «Meine Stats» (persönliche Statistik von Marc)
--  Eigene Spiele als Trainer, als Spieler (Goalie) und als Fan,
--  dazu Rangtabellen. Unabhängig von Teams/Kadern der App.
--
--  Zugang: Lesen = Admin + Zuschauer:in (sieht_alles()),
--          Schreiben = nur voller Admin (ist_admin()).
--  Staff-Logins sehen davon nichts.
-- ============================================================

-- Vereine/Teams (Gegner, eigene Vereine, Nationalteams …)
-- aliase = andere Schreibweisen, die bei der Suche auch gefunden werden
create table public.ms_vereine (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(trim(name)) > 0),
  land        text,                                   -- z.B. CZE, FIN (leer = Schweiz)
  aliase      text[] not null default '{}',
  erstellt_am timestamptz not null default now()
);

-- Hallen (Ort + Halle). Halle darf leer sein (nur Ort bekannt).
create table public.ms_hallen (
  id          uuid primary key default gen_random_uuid(),
  ort         text not null check (length(trim(ort)) > 0),
  name        text not null default '',
  erstellt_am timestamptz not null default now(),
  unique (ort, name)
);

-- Ein Block = eine Saison/ein Turnierjahr mit einem Team
--   bereich  trainer | spieler | fan
--   saison   frei, z.B. "2023/24" oder "2025" (Turnierjahr)
--   kategorie z.B. "Meisterschaft", "Prague Games"
create table public.ms_abschnitte (
  id           uuid primary key default gen_random_uuid(),
  bereich      text not null check (bereich in ('trainer', 'spieler', 'fan')),
  saison       text not null,
  kategorie    text,
  verein_id    uuid references public.ms_vereine(id) on delete set null,
  team         text,
  gruppe       text,
  staff        text,
  notiz        text,
  geloescht_am timestamptz,                            -- Papierkorb
  erstellt_am  timestamptz not null default now()
);

-- Spiele
--   eigene Spiele (trainer/spieler): gegner_id, tore1 = wir, tore2 = Gegner
--   Fan-Spiele: heim_id/gast_id, tore1 = Heim, tore2 = Gast
--   ich: trainer → dabei | nicht ; spieler → tor | ersatz | nicht ; fan → leer
create table public.ms_spiele (
  id            uuid primary key default gen_random_uuid(),
  abschnitt_id  uuid not null references public.ms_abschnitte(id) on delete cascade,
  teil          text,                                 -- Unterabschnitt, z.B. "La Saga Tenero"
  datum         date,
  zeit          time,
  halle_id      uuid references public.ms_hallen(id) on delete set null,
  livestream    boolean not null default false,
  gegner_id     uuid references public.ms_vereine(id) on delete set null,
  gegner_zusatz text,                                 -- z.B. "U17", "B"
  heim_id       uuid references public.ms_vereine(id) on delete set null,
  gast_id       uuid references public.ms_vereine(id) on delete set null,
  tore1         int check (tore1 >= 0),
  tore2         int check (tore2 >= 0),
  entscheid     text check (entscheid in ('nv', 'np')),   -- n.V. / n.P.
  spielart      text not null default 'meisterschaft'
                check (spielart in ('meisterschaft', 'cup', 'test', 'turnier', 'ko', 'playoff', 'abstieg', 'laenderspiel')),
  liga          text,
  ich           text check (ich in ('dabei', 'nicht', 'tor', 'ersatz')),
  abgesagt      boolean not null default false,
  notiz         text,
  erstellt_am   timestamptz not null default now()
);
create index ms_spiele_abschnitt_idx on public.ms_spiele (abschnitt_id, datum);
create index ms_spiele_gegner_idx on public.ms_spiele (gegner_id);
create index ms_spiele_heim_idx on public.ms_spiele (heim_id);
create index ms_spiele_gast_idx on public.ms_spiele (gast_id);
create index ms_spiele_halle_idx on public.ms_spiele (halle_id);

-- Rangtabellen (mehrere pro Block möglich, getrennt über titel)
create table public.ms_tabellen (
  id           uuid primary key default gen_random_uuid(),
  abschnitt_id uuid not null references public.ms_abschnitte(id) on delete cascade,
  titel        text not null default '',
  rang         int,
  verein_id    uuid references public.ms_vereine(id) on delete set null,
  team         text,                                  -- Zusatz, z.B. "Junioren B", "B14 Red"
  eigenes      boolean not null default false,        -- das bin ich / mein Team
  sp int, s int, u int, snv int, nnv int, n int,
  tore int, gegentore int, punkte int,
  erstellt_am  timestamptz not null default now()
);
create index ms_tabellen_abschnitt_idx on public.ms_tabellen (abschnitt_id);
create index ms_tabellen_verein_idx on public.ms_tabellen (verein_id);

-- ---- Rechte ---------------------------------------------------
alter table public.ms_vereine    enable row level security;
alter table public.ms_hallen     enable row level security;
alter table public.ms_abschnitte enable row level security;
alter table public.ms_spiele     enable row level security;
alter table public.ms_tabellen   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['ms_vereine', 'ms_hallen', 'ms_abschnitte', 'ms_spiele', 'ms_tabellen'] loop
    execute format('create policy "Lesen" on public.%I for select to authenticated using (public.sieht_alles())', t);
    execute format('create policy "Anlegen" on public.%I for insert to authenticated with check (public.ist_admin())', t);
    execute format('create policy "Ändern" on public.%I for update to authenticated using (public.ist_admin()) with check (public.ist_admin())', t);
    execute format('create policy "Löschen" on public.%I for delete to authenticated using (public.ist_admin())', t);
  end loop;
end $$;

alter publication supabase_realtime
  add table public.ms_vereine, public.ms_hallen, public.ms_abschnitte, public.ms_spiele, public.ms_tabellen;

-- Kontrolle: 5 Tabellen mit je 4 Regeln
select tablename, count(*) as regeln from pg_policies
where schemaname = 'public' and tablename like 'ms\_%' group by tablename order by tablename;
