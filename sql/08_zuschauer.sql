-- ============================================================
--  Update 13: Zuschauer-Login
--  Sieht ALLES wie der Admin (alle Teams, Saisons, Papierkorb,
--  Staff-Logins), kann aber NICHTS speichern.
--  In "zugang": admin = true UND nur_lesen = true.
--
--  ist_admin()   = voller Admin (darf alles ändern)
--  sieht_alles() = Admin ODER Zuschauer:in (darf alles lesen)
-- ============================================================

create or replace function public.ist_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select admin and not nur_lesen from public.zugang where user_id = auth.uid()), false)
$$;

create or replace function public.sieht_alles() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select admin from public.zugang where user_id = auth.uid()), false)
$$;

-- Nur-lesen gilt jetzt auch für Zuschauer:innen (admin = true)
create or replace function public.ich_nur_lesen() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select nur_lesen from public.zugang where user_id = auth.uid()), false)
$$;

-- Lesen: Admin und Zuschauer:in sehen alle Teams (auch im Papierkorb)
create or replace function public.darf_team(t uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.sieht_alles()
      or exists (
        select 1 from public.zugang z
        join public.teams tm on tm.id = z.team_id
        where z.user_id = auth.uid() and z.team_id = t and tm.geloescht_am is null
      )
$$;

drop policy if exists "Zugang lesen" on public.zugang;
create policy "Zugang lesen" on public.zugang for select to authenticated
  using (user_id = auth.uid() or public.sieht_alles());

-- ---- Admin-Funktionen ---------------------------------------------
-- Liste: alle Logins ausser vollen Admins (Staff + Zuschauer:innen)
drop function if exists public.staff_liste();
create function public.staff_liste()
  returns table (user_id uuid, email text, team_id uuid, nur_lesen boolean, zuschauer boolean)
  language plpgsql stable security definer set search_path = public as $$
begin
  if not public.sieht_alles() then raise exception 'Nur für Admin'; end if;
  return query
    select z.user_id, u.email::text, z.team_id, z.nur_lesen, z.admin
    from public.zugang z join auth.users u on u.id = z.user_id
    where not (z.admin and not z.nur_lesen)
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
  if exists (select 1 from public.zugang where user_id = u and admin and not nur_lesen) then
    raise exception 'Das ist dein Admin-Login – bitte einen eigenen Staff-Login verwenden.';
  end if;
  insert into public.zugang (user_id, team_id) values (u, p_team)
    on conflict (user_id) do update set team_id = excluded.team_id, admin = false;
end $$;

create or replace function public.zuschauer_zuordnen(p_email text)
  returns void language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if not public.ist_admin() then raise exception 'Nur für Admin'; end if;
  select id into u from auth.users where lower(email) = lower(trim(p_email));
  if u is null then
    raise exception 'Kein Login mit dieser E-Mail gefunden – zuerst in Supabase unter Authentication → Users anlegen.';
  end if;
  if exists (select 1 from public.zugang where user_id = u and admin and not nur_lesen) then
    raise exception 'Das ist dein Admin-Login – bitte einen eigenen Login verwenden.';
  end if;
  insert into public.zugang (user_id, admin, nur_lesen, team_id) values (u, true, true, null)
    on conflict (user_id) do update set admin = true, nur_lesen = true, team_id = null;
end $$;

-- Entfernen: Staff und Zuschauer:innen, nie volle Admins
create or replace function public.staff_entfernen(p_user uuid)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.ist_admin() then raise exception 'Nur für Admin'; end if;
  delete from public.zugang where user_id = p_user and not (admin and not nur_lesen);
end $$;

-- Nur lesen umschalten: nur Staff (nicht Admin, nicht Zuschauer:in)
create or replace function public.staff_nur_lesen(p_user uuid, p_wert boolean)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.ist_admin() then raise exception 'Nur für Admin'; end if;
  update public.zugang set nur_lesen = p_wert where user_id = p_user and not admin;
end $$;

revoke execute on function public.staff_liste(), public.zuschauer_zuordnen(text), public.sieht_alles() from anon, public;
grant  execute on function public.staff_liste(), public.zuschauer_zuordnen(text), public.sieht_alles() to authenticated;

-- Kontrolle: alle Logins mit ihren Rechten
select u.email, z.admin, z.nur_lesen,
       case when z.admin and not z.nur_lesen then 'Admin'
            when z.admin then 'Zuschauer:in'
            when z.nur_lesen then 'Staff (nur lesen)'
            else 'Staff' end as rolle
from public.zugang z join auth.users u on u.id = z.user_id;
