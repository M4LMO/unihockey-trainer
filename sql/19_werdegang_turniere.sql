-- ============================================================
--  Update 19: Meine Stats – Turniere im Junioren-Werdegang
--  Neues Häkchen «Turnier» (🏆) + die drei Turniere:
--    Prague Games 2017 (UHC Thun B15), Prague Games 2019 (ZPGD B17),
--    Swiss Games Zug 2020 (ZPGD B18, Ersatz für die Prague Games).
--  Turnierjahr zählt zur Saison, die im Sommer beginnt (2017 = 2017/18).
--  Einträge werden nur angelegt, wenn sie noch nicht da sind.
-- ============================================================
alter table public.ms_werdegang add column if not exists turnier boolean not null default false;

do $$
declare v_thun uuid; v_zpg uuid;
begin
  select id into v_thun from public.ms_vereine where name = 'UHC Thun';
  select id into v_zpg  from public.ms_vereine where name = 'ZPGD';
  if v_thun is null or v_zpg is null then raise exception 'Verein UHC Thun oder ZPGD nicht gefunden – nichts geändert.'; end if;

  insert into public.ms_werdegang (saison, verein_id, team, liga, spiele, turnier, notiz)
  select x.saison, x.verein, x.team, x.liga, x.spiele, true, x.notiz
  from (values
    ('2017', v_thun, 'B15', 'Prague Games', 6, null::text),
    ('2019', v_zpg,  'B17', 'Prague Games', 5, 'out 1/8-Final B-Tableau'),
    ('2020', v_zpg,  'B18', 'Swiss Games',  4, 'in Zug – Ersatz für die Prague Games (wegen Corona abgesagt)')
  ) as x(saison, verein, team, liga, spiele, notiz)
  where not exists (select 1 from public.ms_werdegang w
                    where w.saison = x.saison and w.verein_id = x.verein and w.team = x.team and w.liga = x.liga);
end $$;

-- Kontrolle: 3 Turniere
select w.saison, v.name, w.team, w.liga, w.spiele, w.notiz
from public.ms_werdegang w join public.ms_vereine v on v.id = w.verein_id
where w.turnier order by w.saison;
