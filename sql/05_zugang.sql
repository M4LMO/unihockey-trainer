-- ============================================================
--  Update 9: Zugang pro Team
--  Admin (Marc) sieht alles und verwaltet Teams, Saisons, Staff-Logins.
--  Staff-Logins sehen nur IHR Team.
--
--  ⚠️ VOR DEM AUSFÜHREN: unten bei "DEINE-ADMIN-EMAIL" deine
--     Admin-E-Mail eintragen (der neue Login aus Schritt 1).
-- ============================================================

-- Wer darf was: ein Eintrag pro Login
create table public.zugang (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  admin       boolean not null default false,
  team_id     uuid references public.teams(id) on delete cascade,
  erstellt_am timestamptz not null default now(),
  check (admin or team_id is not null)
);
alter table public.zugang enable row level security;

-- ---- Hilfsfunktionen für die Schutzregeln -------------------
create or replace function public.ist_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select admin from public.zugang where user_id = auth.uid()), false)
$$;

create or replace function public.darf_team(t uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.ist_admin()
      or exists (select 1 from public.zugang where user_id = auth.uid() and team_id = t)
$$;

create or replace function public.darf_liste(l uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.darf_team((select team_id from public.kaderlisten where id = l))
$$;

create or replace function public.darf_einsatz(e uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.darf_liste((select liste_id from public.einsaetze where id = e))
$$;

create or replace function public.darf_variante(v uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.darf_einsatz((select einsatz_id from public.varianten where id = v))
$$;

create or replace function public.darf_linie(x uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.darf_variante((select variante_id from public.linien where id = x))
$$;

-- ---- Alte Regel "alle Eingeloggten dürfen alles" entfernen ----
drop policy if exists "Team hat Zugriff" on public.teams;
drop policy if exists "Team hat Zugriff" on public.saisons;
drop policy if exists "Team hat Zugriff" on public.kaderlisten;
drop policy if exists "Team hat Zugriff" on public.kader;
drop policy if exists "Team hat Zugriff" on public.einsaetze;
drop policy if exists "Team hat Zugriff" on public.varianten;
drop policy if exists "Team hat Zugriff" on public.linien;
drop policy if exists "Team hat Zugriff" on public.linien_spieler;
drop policy if exists "Team hat Zugriff" on public.chemie;
drop policy if exists "Team hat Zugriff" on public.match_aufstellung;
drop policy if exists "Team hat Zugriff" on public.match_ereignisse;
drop policy if exists "Team hat Zugriff" on public.su_zuordnung;

-- ---- Neue Regeln ---------------------------------------------
-- Zugang: eigenen Eintrag lesen; Admin alles
create policy "Zugang lesen" on public.zugang for select to authenticated
  using (user_id = auth.uid() or public.ist_admin());
create policy "Zugang Admin" on public.zugang for all to authenticated
  using (public.ist_admin()) with check (public.ist_admin());

-- Teams: Staff sieht nur das eigene, nur Admin ändert
create policy "Teams lesen" on public.teams for select to authenticated
  using (public.darf_team(id));
create policy "Teams Admin" on public.teams for all to authenticated
  using (public.ist_admin()) with check (public.ist_admin());

-- Saisons: alle lesen, nur Admin ändert
create policy "Saisons lesen" on public.saisons for select to authenticated
  using (true);
create policy "Saisons Admin" on public.saisons for all to authenticated
  using (public.ist_admin()) with check (public.ist_admin());

-- Alles innerhalb eines Teams: wer das Team darf, darf alles
create policy "Team-Zugriff" on public.kaderlisten for all to authenticated
  using (public.darf_team(team_id)) with check (public.darf_team(team_id));
create policy "Team-Zugriff" on public.kader for all to authenticated
  using (public.darf_liste(liste_id)) with check (public.darf_liste(liste_id));
create policy "Team-Zugriff" on public.einsaetze for all to authenticated
  using (public.darf_liste(liste_id)) with check (public.darf_liste(liste_id));
create policy "Team-Zugriff" on public.chemie for all to authenticated
  using (public.darf_liste(liste_id)) with check (public.darf_liste(liste_id));
create policy "Team-Zugriff" on public.su_zuordnung for all to authenticated
  using (public.darf_liste(liste_id)) with check (public.darf_liste(liste_id));
create policy "Team-Zugriff" on public.varianten for all to authenticated
  using (public.darf_einsatz(einsatz_id)) with check (public.darf_einsatz(einsatz_id));
create policy "Team-Zugriff" on public.match_aufstellung for all to authenticated
  using (public.darf_einsatz(einsatz_id)) with check (public.darf_einsatz(einsatz_id));
create policy "Team-Zugriff" on public.match_ereignisse for all to authenticated
  using (public.darf_einsatz(einsatz_id)) with check (public.darf_einsatz(einsatz_id));
create policy "Team-Zugriff" on public.linien for all to authenticated
  using (public.darf_variante(variante_id)) with check (public.darf_variante(variante_id));
create policy "Team-Zugriff" on public.linien_spieler for all to authenticated
  using (public.darf_linie(linie_id)) with check (public.darf_linie(linie_id));

-- ---- Admin-Funktionen: Staff-Logins den Teams zuordnen --------
-- (Die Logins selbst legst du im Supabase-Dashboard an.)
create or replace function public.staff_liste()
  returns table (user_id uuid, email text, team_id uuid)
  language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ist_admin() then raise exception 'Nur für Admin'; end if;
  return query
    select z.user_id, u.email::text, z.team_id
    from public.zugang z join auth.users u on u.id = z.user_id
    where not z.admin
    order by u.email;
end $$;

create or replace function public.staff_zuordnen(p_email text, p_team uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if not public.ist_admin() then raise exception 'Nur für Admin'; end if;
  select id into u from auth.users where lower(email) = lower(trim(p_email));
  if u is null then
    raise exception 'Kein Login mit dieser E-Mail gefunden – zuerst in Supabase unter Authentication → Users anlegen.';
  end if;
  if exists (select 1 from public.zugang where user_id = u and admin) then
    raise exception 'Das ist dein Admin-Login – bitte einen eigenen Staff-Login verwenden.';
  end if;
  insert into public.zugang (user_id, team_id) values (u, p_team)
    on conflict (user_id) do update set team_id = excluded.team_id, admin = false;
end $$;

create or replace function public.staff_entfernen(p_user uuid)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.ist_admin() then raise exception 'Nur für Admin'; end if;
  delete from public.zugang where user_id = p_user and not admin;
end $$;

revoke execute on function public.staff_liste(), public.staff_zuordnen(text, uuid), public.staff_entfernen(uuid) from anon, public;
grant  execute on function public.staff_liste(), public.staff_zuordnen(text, uuid), public.staff_entfernen(uuid) to authenticated;

-- ---- Dich als Admin eintragen ---------------------------------
insert into public.zugang (user_id, admin)
  select id, true from auth.users where lower(email) = lower('DEINE-ADMIN-EMAIL')
  on conflict (user_id) do update set admin = true, team_id = null;

-- Kontrolle: hier muss genau EINE Zeile mit deiner E-Mail erscheinen
select u.email, z.admin from public.zugang z join auth.users u on u.id = z.user_id;
