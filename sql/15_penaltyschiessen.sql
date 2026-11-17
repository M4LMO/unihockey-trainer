-- ============================================================
--  Update 15: Penaltyschiessen
--  Pro Match die Penaltys in Reihenfolge: wir (Person) / Gegner (nur Nummer),
--  getroffen ja/nein. Zählt NICHT in Skorerliste, Tore oder Goalie-Gegentore.
--  einsaetze.penalty_goalie_id = Goalie im Penaltyschiessen (leer = automatisch:
--  der Goalie, der am Spielende im Tor stand).
--  Rechte wie match_ereignisse (darf_einsatz / darf_einsatz_schreiben).
-- ============================================================
create table if not exists public.match_penaltys (
  id          uuid primary key default gen_random_uuid(),
  einsatz_id  uuid not null references public.einsaetze(id) on delete cascade,
  nr          int  not null check (nr >= 1),                 -- Reihenfolge im Penaltyschiessen
  team        text not null check (team in ('wir', 'gegner')),
  kader_id    uuid references public.kader(id) on delete set null,   -- nur bei «wir»
  gegner_nr   int check (gegner_nr between 0 and 99),                -- nur bei «gegner»
  tor         boolean not null,
  erstellt_am timestamptz not null default now()
);
create index if not exists match_penaltys_einsatz_idx on public.match_penaltys (einsatz_id, nr);
create index if not exists match_penaltys_kader_idx on public.match_penaltys (kader_id);

alter table public.einsaetze
  add column if not exists penalty_goalie_id uuid references public.kader(id) on delete set null;

alter table public.match_penaltys enable row level security;
drop policy if exists "Lesen" on public.match_penaltys;
drop policy if exists "Anlegen" on public.match_penaltys;
drop policy if exists "Ändern" on public.match_penaltys;
drop policy if exists "Löschen" on public.match_penaltys;
create policy "Lesen" on public.match_penaltys for select to authenticated
  using (public.darf_einsatz(einsatz_id));
create policy "Anlegen" on public.match_penaltys for insert to authenticated
  with check (public.darf_einsatz_schreiben(einsatz_id));
create policy "Ändern" on public.match_penaltys for update to authenticated
  using (public.darf_einsatz_schreiben(einsatz_id)) with check (public.darf_einsatz_schreiben(einsatz_id));
create policy "Löschen" on public.match_penaltys for delete to authenticated
  using (public.darf_einsatz_schreiben(einsatz_id));

-- Realtime (nur einmal hinzufügen, falls die Datei zweimal läuft)
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'match_penaltys') then
    alter publication supabase_realtime add table public.match_penaltys;
  end if;
end $$;
