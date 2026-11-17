-- ============================================================
--  Update 11: Meine Stats – nur noch EIN Name pro Verein
--  Die zusätzlichen Schreibweisen (Aliase, «auch: …») werden
--  gelöscht. Spiele und Tabellen bleiben unverändert, weil sie
--  auf den Verein selbst zeigen, nicht auf den Namen.
--  (Spalte "aliase" bleibt leer bestehen, wird nicht mehr benutzt.)
-- ============================================================
update public.ms_vereine set aliase = '{}' where aliase <> '{}';

-- Kontrolle: muss 0 sein
select count(*) as vereine_mit_alias from public.ms_vereine where aliase <> '{}';
