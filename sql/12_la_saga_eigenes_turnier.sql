-- ============================================================
--  Update 12: Meine Stats – La Saga (Tenero) als eigenes Turnier
--  Der Block «2025 · Prague Games · ZPGD – B14 White» enthielt
--  Tenero UND Prag. Tenero wird ein eigener Block (Kategorie
--  «La Saga») mit seinen Spielen und seiner Rangtabelle.
--  Bricht ab (ohne etwas zu ändern), wenn der Block nicht genau
--  einmal gefunden wird oder keine Tenero-Spiele drin sind.
-- ============================================================
do $$
declare
  quelle public.ms_abschnitte;
  anzahl int;
  neu    uuid;
begin
  select count(*) into anzahl
  from public.ms_abschnitte a join public.ms_vereine v on v.id = a.verein_id
  where a.bereich = 'trainer' and a.saison = '2025' and v.name = 'ZPGD' and a.team = 'B14 White' and a.geloescht_am is null;
  if anzahl <> 1 then raise exception 'Block 2025 ZPGD – B14 White nicht eindeutig gefunden (%×) – nichts geändert.', anzahl; end if;

  select a.* into quelle
  from public.ms_abschnitte a join public.ms_vereine v on v.id = a.verein_id
  where a.bereich = 'trainer' and a.saison = '2025' and v.name = 'ZPGD' and a.team = 'B14 White' and a.geloescht_am is null;

  if not exists (select 1 from public.ms_spiele where abschnitt_id = quelle.id and (teil ilike '%tenero%' or teil ilike '%saga%')) then
    raise exception 'Keine Tenero-Spiele im Block gefunden – nichts geändert (schon getrennt?).';
  end if;

  -- neuer Block für La Saga
  insert into public.ms_abschnitte (bereich, saison, kategorie, verein_id, team, gruppe, staff)
  values ('trainer', quelle.saison, 'La Saga', quelle.verein_id, quelle.team, 'Tenero U14B', quelle.staff)
  returning id into neu;

  -- Tenero-Spiele umhängen (Unterabschnitt braucht es nicht mehr)
  update public.ms_spiele set abschnitt_id = neu, teil = null
  where abschnitt_id = quelle.id and (teil ilike '%tenero%' or teil ilike '%saga%');

  -- Tenero-Rangtabelle umhängen
  update public.ms_tabellen set abschnitt_id = neu, titel = ''
  where abschnitt_id = quelle.id and titel ilike '%tenero%';

  -- Prag-Block aufräumen
  update public.ms_abschnitte set gruppe = 'Prag Games B14 Gruppe C' where id = quelle.id;
  update public.ms_spiele set teil = null where abschnitt_id = quelle.id and teil ilike '%prague%';
  update public.ms_tabellen set titel = '' where abschnitt_id = quelle.id and titel ilike '%prag%';
end $$;

-- Kontrolle: La Saga 9 Spiele / 10 Tabellenzeilen, Prague Games 7 Spiele / 4 Tabellenzeilen
select a.kategorie, a.gruppe,
       (select count(*) from public.ms_spiele s where s.abschnitt_id = a.id) as spiele,
       (select count(*) from public.ms_tabellen t where t.abschnitt_id = a.id) as tabellenzeilen
from public.ms_abschnitte a join public.ms_vereine v on v.id = a.verein_id
where a.bereich = 'trainer' and a.saison = '2025' and v.name = 'ZPGD' and a.team = 'B14 White'
order by a.kategorie;
