-- ============================================================
--  Update 18: Meine Stats – Fusionen von Vereinen
--  Ein Verein kann «fusioniert in» einen anderen sein (heutiger
--  Verein) – optional ab welcher Saison. Die Spiele behalten den
--  damaligen Namen; die Gegner-Bilanz fasst unter dem heutigen
--  Verein zusammen.
--  Dazu gleich: UHT Eggiwil + Unihockey Schüpbach → Unihockey Emme
--  ab 2025/26 (falls die Vereine so heissen).
-- ============================================================
alter table public.ms_vereine
  add column if not exists nachfolger_id uuid references public.ms_vereine(id) on delete set null,
  add column if not exists fusion_ab     text;

alter table public.ms_vereine drop constraint if exists ms_vereine_nicht_selbst;
alter table public.ms_vereine add constraint ms_vereine_nicht_selbst check (nachfolger_id is distinct from id);
create index if not exists ms_vereine_nachfolger_idx on public.ms_vereine (nachfolger_id);

update public.ms_vereine v
set nachfolger_id = e.id, fusion_ab = '2025/26'
from public.ms_vereine e
where e.name = 'Unihockey Emme'
  and v.name in ('UHT Eggiwil', 'Unihockey Schüpbach');

-- Kontrolle: die zwei Vereine zeigen auf Unihockey Emme
select v.name, n.name as fusioniert_in, v.fusion_ab
from public.ms_vereine v join public.ms_vereine n on n.id = v.nachfolger_id
order by v.name;
