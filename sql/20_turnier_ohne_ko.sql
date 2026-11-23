-- ============================================================
--  Update 20: Meine Stats – nur noch eine Spielart «Turnier»
--  Bisher «Turnier (Gruppe)» und «Turnier (K.o./Tableau)».
--  Die Info wandert in die Notiz (nur Trainer-/Spieler-Spiele):
--    Gruppe → «Gruppenspiel» vorne an die Notiz
--    K.o.   → «K.o.-Spiel» vorne an die Notiz, ausser die Notiz
--             nennt die Runde schon (Tableau, Final, out, 1/8 …)
--  Danach werden alle K.o.-Spiele zu «Turnier». Fan-Spiele:
--  nur umbenennen, keine Notiz.
--  Läuft nur, solange es noch K.o.-Spiele gibt → erneut ausführen ändert nichts.
-- ============================================================
do $$
begin
  -- nur einmal: sobald es keine K.o.-Spiele mehr gibt, ist alles schon umgestellt
  if not exists (select 1 from public.ms_spiele where spielart = 'ko') then
    raise notice 'Schon umgestellt – nichts geändert.';
    return;
  end if;

  update public.ms_spiele s
  set notiz = case when s.notiz is null or s.notiz = '' then 'Gruppenspiel' else 'Gruppenspiel · ' || s.notiz end
  from public.ms_abschnitte a
  where a.id = s.abschnitt_id and a.bereich <> 'fan' and s.spielart = 'turnier';

  update public.ms_spiele s
  set notiz = case when s.notiz is null or s.notiz = '' then 'K.o.-Spiel' else 'K.o.-Spiel · ' || s.notiz end
  from public.ms_abschnitte a
  where a.id = s.abschnitt_id and a.bereich <> 'fan' and s.spielart = 'ko'
    and coalesce(s.notiz, '') !~* '(tableau|final|out|playoff|1/[0-9])';

  update public.ms_spiele set spielart = 'turnier' where spielart = 'ko';
end $$;

-- Kontrolle: alle Turnier-Spiele mit Notiz (eigene Spiele)
select a.saison, a.kategorie, s.datum, s.notiz
from public.ms_spiele s join public.ms_abschnitte a on a.id = s.abschnitt_id
where s.spielart = 'turnier' and a.bereich <> 'fan'
order by s.datum;
