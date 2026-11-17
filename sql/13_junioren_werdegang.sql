-- ============================================================
--  Update 13: Meine Stats – Junioren-Werdegang
--  Ungefähre Angaben pro Saison und Team (keine einzelnen Spiele).
--  Isoliert: fliesst in keine andere Statistik ein.
--  Zugang wie die anderen ms_-Tabellen (Lesen Admin + Zuschauer:in,
--  Schreiben nur Admin).
-- ============================================================
create table public.ms_werdegang (
  id                 uuid primary key default gen_random_uuid(),
  saison             text not null check (length(trim(saison)) > 0),
  verein_id          uuid references public.ms_vereine(id) on delete set null,
  team               text,                         -- z.B. "Junioren C"
  liga               text,
  ohne_meisterschaft boolean not null default false,  -- erste Jahre: nur Trainings/Turniere
  spiele             int check (spiele >= 0),       -- ungefähre Anzahl, darf leer sein
  notiz              text,
  erstellt_am        timestamptz not null default now()
);
create index ms_werdegang_verein_idx on public.ms_werdegang (verein_id);

alter table public.ms_werdegang enable row level security;
create policy "Lesen"   on public.ms_werdegang for select to authenticated using (public.sieht_alles());
create policy "Anlegen" on public.ms_werdegang for insert to authenticated with check (public.ist_admin());
create policy "Ändern"  on public.ms_werdegang for update to authenticated using (public.ist_admin()) with check (public.ist_admin());
create policy "Löschen" on public.ms_werdegang for delete to authenticated using (public.ist_admin());

alter publication supabase_realtime add table public.ms_werdegang;

-- Kontrolle: 4 Regeln
select count(*) as regeln from pg_policies where schemaname = 'public' and tablename = 'ms_werdegang';
