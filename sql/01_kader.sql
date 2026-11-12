-- Update 1 (11.11.2026): Tabelle kader (bereits ausgeführt)
-- Hinweis: Die Policy "Team hat Zugriff" wurde mit SQL 05 ersetzt.
create table public.kader (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  nummer      int check (nummer between 0 and 99),
  position    text,
  rolle       text not null default 'spieler' check (rolle in ('spieler','staff')),
  aktiv       boolean not null default true,
  erstellt_am timestamptz not null default now()
);
alter table public.kader enable row level security;
create policy "Team hat Zugriff" on public.kader
  for all to authenticated using (true) with check (true);
alter publication supabase_realtime add table public.kader;
