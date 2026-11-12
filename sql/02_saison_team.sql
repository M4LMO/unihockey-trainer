-- ============================================================
--  Update 2: Saisons, Teams und Kader pro Saison + Team
-- ============================================================

-- Teams (z.B. Verein "UHC Muster", Team "Herren 1")
create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  verein      text not null,
  name        text not null,
  erstellt_am timestamptz not null default now()
);

-- Saisons (z.B. "2026/27"); archivierte sind nur noch lesbar
create table public.saisons (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  archiviert  boolean not null default false,
  erstellt_am timestamptz not null default now()
);

-- Ein Kader = eine Saison + ein Team
create table public.kaderlisten (
  id          uuid primary key default gen_random_uuid(),
  saison_id   uuid not null references public.saisons(id) on delete cascade,
  team_id     uuid not null references public.teams(id)   on delete cascade,
  erstellt_am timestamptz not null default now(),
  unique (saison_id, team_id)
);

-- Jede Person gehört zu genau einem Kader
alter table public.kader
  add column liste_id uuid references public.kaderlisten(id) on delete cascade;

-- Bereits erfasste Personen einem Start-Team zuordnen
-- (Team und Verein kannst du danach in der App umbenennen)
do $$
declare t uuid; s uuid; l uuid;
begin
  if exists (select 1 from public.kader where liste_id is null) then
    insert into public.teams (verein, name) values ('Mein Verein', 'Team 1') returning id into t;
    insert into public.saisons (name) values ('2026/27') returning id into s;
    insert into public.kaderlisten (saison_id, team_id) values (s, t) returning id into l;
    update public.kader set liste_id = l where liste_id is null;
  end if;
end $$;

alter table public.kader alter column liste_id set not null;
create index kader_liste_idx on public.kader (liste_id);

-- Schutz: nur eingeloggte Team-Mitglieder
alter table public.teams       enable row level security;
alter table public.saisons     enable row level security;
alter table public.kaderlisten enable row level security;

create policy "Team hat Zugriff" on public.teams
  for all to authenticated using (true) with check (true);
create policy "Team hat Zugriff" on public.saisons
  for all to authenticated using (true) with check (true);
create policy "Team hat Zugriff" on public.kaderlisten
  for all to authenticated using (true) with check (true);

-- Live-Updates
alter publication supabase_realtime add table public.teams, public.saisons, public.kaderlisten;
