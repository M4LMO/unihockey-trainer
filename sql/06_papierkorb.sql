-- ============================================================
--  Update 11: Papierkorb für Teams und Saisons
--  Gelöschte Teams/Saisons bekommen ein Datum in "geloescht_am"
--  und können vom Admin wiederhergestellt werden.
-- ============================================================

alter table public.teams   add column if not exists geloescht_am timestamptz;
alter table public.saisons add column if not exists geloescht_am timestamptz;

-- Staff verliert den Zugang, solange sein Team im Papierkorb liegt
create or replace function public.darf_team(t uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.ist_admin()
      or exists (
        select 1 from public.zugang z
        join public.teams tm on tm.id = z.team_id
        where z.user_id = auth.uid() and z.team_id = t and tm.geloescht_am is null
      )
$$;
