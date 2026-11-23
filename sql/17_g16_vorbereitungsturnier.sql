-- ============================================================
--  Update 17: Meine Stats – Vorbereitungsturnier G16 Blue 2026
--  14.06.2026, Eschenbach (Turnhalle Neuheim), 4 Spiele, alle klar
--  verloren, Resultate unbekannt (bleiben leer → zählen nicht in
--  die Bilanz). Eigener Block «Vorbereitungsturnier» beim Team
--  ZPGD – G16 Blue 2026 → erscheint im selben Dropdown wie die
--  Prague Games.
--  Bricht ab (ohne etwas zu ändern), wenn ZPGD fehlt oder das
--  Turnier schon eingetragen ist.
-- ============================================================
do $$
declare
  v_zpg  uuid;
  v_orca uuid;
  hal    uuid;
  blk    uuid;
  staff_ text;
begin
  select id into v_zpg from public.ms_vereine where name = 'ZPGD';
  if v_zpg is null then raise exception 'Verein ZPGD nicht gefunden – nichts geändert.'; end if;
  if exists (select 1 from public.ms_abschnitte where bereich = 'trainer' and saison = '2026' and verein_id = v_zpg
             and team = 'G16 Blue' and kategorie = 'Vorbereitungsturnier' and geloescht_am is null) then
    raise exception 'Vorbereitungsturnier ist schon eingetragen – nichts geändert.';
  end if;

  -- Staff wie bei den Prague Games 2026 übernehmen
  select staff into staff_ from public.ms_abschnitte
  where bereich = 'trainer' and saison = '2026' and verein_id = v_zpg and team = 'G16 Blue' and geloescht_am is null
  order by erstellt_am limit 1;

  -- neuer Gegner-Verein (falls noch nicht vorhanden)
  select id into v_orca from public.ms_vereine where name = 'Seeland United Orcas';
  if v_orca is null then
    insert into public.ms_vereine (name) values ('Seeland United Orcas') returning id into v_orca;
  end if;

  -- Halle (falls noch nicht vorhanden)
  insert into public.ms_hallen (ort, name) values ('Eschenbach', 'Turnhalle Neuheim') on conflict (ort, name) do nothing;
  select id into hal from public.ms_hallen where ort = 'Eschenbach' and name = 'Turnhalle Neuheim';

  insert into public.ms_abschnitte (bereich, saison, kategorie, verein_id, team, staff)
  values ('trainer', '2026', 'Vorbereitungsturnier', v_zpg, 'G16 Blue', staff_)
  returning id into blk;

  insert into public.ms_spiele (abschnitt_id, datum, zeit, halle_id, gegner_id, gegner_zusatz, spielart, ich, notiz) values
    (blk, '2026-06-14', '09:15', hal, v_zpg,  'G16 Red',   'test', 'nicht', 'klar verloren, Resultat unbekannt'),
    (blk, '2026-06-14', '10:45', hal, v_zpg,  'G18',       'test', 'nicht', 'klar verloren, Resultat unbekannt'),
    (blk, '2026-06-14', '12:15', hal, v_zpg,  'G16 White', 'test', 'dabei', 'klar verloren, Resultat unbekannt'),
    (blk, '2026-06-14', '13:45', hal, v_orca, null,        'test', 'dabei', 'klar verloren, Resultat unbekannt');
end $$;

-- Kontrolle: 4 Spiele im Vorbereitungsturnier
select s.zeit, v.name, s.gegner_zusatz, s.ich, s.notiz
from public.ms_spiele s
join public.ms_abschnitte a on a.id = s.abschnitt_id
left join public.ms_vereine v on v.id = s.gegner_id
where a.kategorie = 'Vorbereitungsturnier' and a.team = 'G16 Blue'
order by s.zeit;
