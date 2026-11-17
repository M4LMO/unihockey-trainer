-- ============================================================
--  Update 14: Matches «nach Verlängerung» / «nach Penaltys»
--  Neue Spalte einsaetze.entscheid: 'nv' = n.V., 'np' = n.P., leer = regulär
--  (gleich wie ms_spiele.entscheid in «Meine Stats»).
--  RLS, Realtime und Sicherung gelten bereits für «einsaetze».
-- ============================================================
alter table public.einsaetze
  add column if not exists entscheid text check (entscheid in ('nv', 'np'));
