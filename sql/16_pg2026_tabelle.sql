-- ============================================================
--  Update 16: Meine Stats – Rangtabelle Prague Games 2026
--  Block «2026 · Prague Games · ZPGD – G16 Blue»: Gruppe G eintragen
--  und die Rangtabelle (Girls 16, Group G) ergänzen.
--  Bricht ab (ohne etwas zu ändern), wenn der Block nicht genau
--  einmal gefunden wird, ein Verein fehlt oder schon eine Tabelle da ist.
-- ============================================================
do $$
declare
  blk   uuid;
  anz   int;
  v_lvl uuid; v_biv uuid; v_ore uuid; v_zpg uuid;
begin
  select count(*), min(a.id::text)::uuid into anz, blk
  from public.ms_abschnitte a join public.ms_vereine v on v.id = a.verein_id
  where a.bereich = 'trainer' and a.saison = '2026' and v.name = 'ZPGD' and a.team = 'G16 Blue' and a.geloescht_am is null;
  if anz <> 1 then raise exception 'Block 2026 ZPGD – G16 Blue nicht eindeutig gefunden (%×) – nichts geändert.', anz; end if;
  if exists (select 1 from public.ms_tabellen where abschnitt_id = blk) then
    raise exception 'Dieser Block hat schon eine Rangtabelle – nichts geändert.';
  end if;

  select id into v_lvl from public.ms_vereine where name = 'LevelUp Girls';
  select id into v_biv from public.ms_vereine where name = 'SK Bivoj Litvínov';
  select id into v_ore from public.ms_vereine where name = 'FBC Orel Rtyně';
  select id into v_zpg from public.ms_vereine where name = 'ZPGD';
  if v_lvl is null or v_biv is null or v_ore is null or v_zpg is null then
    raise exception 'Ein Verein wurde nicht gefunden (umbenannt?) – nichts geändert.';
  end if;

  update public.ms_abschnitte set gruppe = 'Prag Games G16 · Gruppe G' where id = blk;

  insert into public.ms_tabellen (abschnitt_id, titel, rang, verein_id, team, eigenes, sp, s, u, n, tore, gegentore, punkte) values
    (blk, '', 1, v_lvl, '2011',     false, 3, 3, 0, 0, 18,  2, 9),
    (blk, '', 2, v_biv, null,       false, 3, 2, 0, 1, 15,  3, 6),
    (blk, '', 3, v_ore, null,       false, 3, 0, 1, 2,  3, 16, 1),
    (blk, '', 4, v_zpg, 'G16 Blue', true,  3, 0, 1, 2,  3, 18, 1);
end $$;

-- Kontrolle: 4 Zeilen, ZPGD auf Rang 4
select t.rang, v.name, t.team, t.sp, t.s, t.u, t.n, t.tore || ':' || t.gegentore as tore, t.punkte
from public.ms_tabellen t
join public.ms_abschnitte a on a.id = t.abschnitt_id
join public.ms_vereine v on v.id = t.verein_id
where a.saison = '2026' and a.team = 'G16 Blue'
order by t.rang;
