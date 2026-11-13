-- ============================================================
--  Update 12: Rechte verfeinern
--  1) Staff-Login kann auf "Nur lesen" gestellt werden
--     (sieht alles im eigenen Team, kann nichts ändern).
--  2) Kaderliste einer Saison anlegen/löschen: nur Admin.
--  3) Archivierte Saison: in der Datenbank gesperrt (für alle,
--     auch Admin – zum Ändern zuerst reaktivieren).
--  Lesen bleibt wie bisher (darf_team / darf_liste / …).
-- ============================================================

alter table public.zugang add column if not exists nur_lesen boolean not null default false;

-- ---- Hilfsfunktionen ------------------------------------------
create or replace function public.ich_nur_lesen() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select nur_lesen and not admin from public.zugang where user_id = auth.uid()), false)
$$;

-- Darf ich in dieser Kaderliste etwas ändern?
create or replace function public.darf_liste_schreiben(l uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.darf_liste(l)
     and not public.ich_nur_lesen()
     and not coalesce((select s.archiviert from public.kaderlisten k
                       join public.saisons s on s.id = k.saison_id where k.id = l), true)
$$;

create or replace function public.darf_einsatz_schreiben(e uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.darf_liste_schreiben((select liste_id from public.einsaetze where id = e))
$$;

create or replace function public.darf_variante_schreiben(v uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.darf_einsatz_schreiben((select einsatz_id from public.varianten where id = v))
$$;

create or replace function public.darf_linie_schreiben(x uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.darf_variante_schreiben((select variante_id from public.linien where id = x))
$$;

-- ---- Alte Regeln ("alles erlaubt im Team") entfernen ------------
drop policy if exists "Team-Zugriff" on public.kaderlisten;
drop policy if exists "Lesen" on public.kaderlisten;
drop policy if exists "Admin" on public.kaderlisten;
drop policy if exists "Team-Zugriff" on public.kader;
drop policy if exists "Team-Zugriff" on public.einsaetze;
drop policy if exists "Team-Zugriff" on public.chemie;
drop policy if exists "Team-Zugriff" on public.su_zuordnung;
drop policy if exists "Team-Zugriff" on public.varianten;
drop policy if exists "Team-Zugriff" on public.match_aufstellung;
drop policy if exists "Team-Zugriff" on public.match_ereignisse;
drop policy if exists "Team-Zugriff" on public.linien;
drop policy if exists "Team-Zugriff" on public.linien_spieler;

-- ---- Kaderlisten: Team liest, nur Admin legt an/ändert/löscht ---
create policy "Lesen" on public.kaderlisten for select to authenticated
  using (public.darf_team(team_id));
create policy "Admin" on public.kaderlisten for all to authenticated
  using (public.ist_admin()) with check (public.ist_admin());

-- ---- Alles andere: lesen wie bisher, schreiben mit neuen Regeln --
do $$
declare
  r record;
begin
  for r in select * from (values
    ('kader',             'darf_liste',    'darf_liste_schreiben',    'liste_id'),
    ('einsaetze',         'darf_liste',    'darf_liste_schreiben',    'liste_id'),
    ('chemie',            'darf_liste',    'darf_liste_schreiben',    'liste_id'),
    ('su_zuordnung',      'darf_liste',    'darf_liste_schreiben',    'liste_id'),
    ('varianten',         'darf_einsatz',  'darf_einsatz_schreiben',  'einsatz_id'),
    ('match_aufstellung', 'darf_einsatz',  'darf_einsatz_schreiben',  'einsatz_id'),
    ('match_ereignisse',  'darf_einsatz',  'darf_einsatz_schreiben',  'einsatz_id'),
    ('linien',            'darf_variante', 'darf_variante_schreiben', 'variante_id'),
    ('linien_spieler',    'darf_linie',    'darf_linie_schreiben',    'linie_id')
  ) as t(tab, lesen, schreiben, spalte)
  loop
    execute format('drop policy if exists "Lesen" on public.%I', r.tab);
    execute format('drop policy if exists "Anlegen" on public.%I', r.tab);
    execute format('drop policy if exists "Ändern" on public.%I', r.tab);
    execute format('drop policy if exists "Löschen" on public.%I', r.tab);
    execute format('create policy "Lesen" on public.%I for select to authenticated using (public.%I(%I))',
                   r.tab, r.lesen, r.spalte);
    execute format('create policy "Anlegen" on public.%I for insert to authenticated with check (public.%I(%I))',
                   r.tab, r.schreiben, r.spalte);
    execute format('create policy "Ändern" on public.%I for update to authenticated using (public.%I(%I)) with check (public.%I(%I))',
                   r.tab, r.schreiben, r.spalte, r.schreiben, r.spalte);
    execute format('create policy "Löschen" on public.%I for delete to authenticated using (public.%I(%I))',
                   r.tab, r.schreiben, r.spalte);
  end loop;
end $$;

-- ---- Admin-Funktionen: Staff-Liste mit "Nur lesen" ---------------
drop function if exists public.staff_liste();
create function public.staff_liste()
  returns table (user_id uuid, email text, team_id uuid, nur_lesen boolean)
  language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ist_admin() then raise exception 'Nur für Admin'; end if;
  return query
    select z.user_id, u.email::text, z.team_id, z.nur_lesen
    from public.zugang z join auth.users u on u.id = z.user_id
    where not z.admin
    order by u.email;
end $$;

create or replace function public.staff_nur_lesen(p_user uuid, p_wert boolean)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.ist_admin() then raise exception 'Nur für Admin'; end if;
  update public.zugang set nur_lesen = p_wert where user_id = p_user and not admin;
end $$;

revoke execute on function public.staff_liste(), public.staff_nur_lesen(uuid, boolean) from anon, public;
grant  execute on function public.staff_liste(), public.staff_nur_lesen(uuid, boolean) to authenticated;

-- Kontrolle: Liste aller Logins mit ihren Rechten
select u.email, z.admin, z.nur_lesen from public.zugang z join auth.users u on u.id = z.user_id;
