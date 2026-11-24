-- ============================================================
--  Update 21: Meine Stats – Standort pro Halle (für die Karte)
--  lat/lon = Koordinaten; geo = woher:
--    'auto' = über OpenStreetMap gefunden (Halle + Ort)
--    'ort'  = nur der Ort gefunden (Ortsmitte)
--    'hand' = von Hand auf der Karte gesetzt
--  Leer = noch nicht gesucht. Gesucht wird in der App (Analysen → Karte).
-- ============================================================
alter table public.ms_hallen
  add column if not exists lat double precision check (lat between -90 and 90),
  add column if not exists lon double precision check (lon between -180 and 180),
  add column if not exists geo text check (geo in ('auto', 'ort', 'hand'));

-- Kontrolle: Anzahl Hallen (alle noch ohne Standort)
select count(*) as hallen, count(lat) as mit_standort from public.ms_hallen;
