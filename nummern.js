// ============================================================
//  Andere Rückennummern in Matches (z.B. anderes Trikot)
//  Gemeinsam für Kader, Linien und Statistik.
//  Quelle: match_aufstellung.nummer (Nummer pro Match)
// ============================================================
import { sb } from './supabase.js';

// Stil einmalig einfügen (damit style.css nicht angepasst werden muss)
if (!document.querySelector('style[data-nummern]')) {
  const st = document.createElement('style');
  st.dataset.nummern = '1';
  st.textContent = `
    .nr-auch { display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 99px;
      background: #ffedd5; color: #9a3412; font-size: .75rem; font-weight: 700; white-space: nowrap; vertical-align: 1px; }
    .nr-auch small { font-weight: 500; opacity: .8; }`;
  document.head.appendChild(st);
}

// kader: [{id, nummer}] · aufstellungen: [{kader_id, nummer}]
// → Map(kader_id → [{nr, n}]) nur Nummern, die von der Kader-Nummer abweichen
export function andereNummern(kader, aufstellungen) {
  const kNr = new Map(kader.map(k => [k.id, k.nummer]));
  const M = new Map();
  for (const a of aufstellungen) {
    if (a.nummer == null || !kNr.has(a.kader_id) || a.nummer === kNr.get(a.kader_id)) continue;
    const z = M.get(a.kader_id) || new Map();
    z.set(a.nummer, (z.get(a.nummer) || 0) + 1);
    M.set(a.kader_id, z);
  }
  return new Map([...M].map(([id, z]) => [id, [...z].map(([nr, n]) => ({ nr, n })).sort((a, b) => b.n - a.n)]));
}

export async function ladeAndereNummern(kader) {
  const ids = kader.map(k => k.id);
  if (!ids.length) return new Map();
  const { data, error } = await sb.from('match_aufstellung').select('kader_id, nummer').in('kader_id', ids);
  if (error) return new Map();          // z.B. Statistik-Tabellen fehlen → einfach nichts anzeigen
  return andereNummern(kader, data);
}

// Abzeichen „auch #87 (4×)“
export function auchNr(liste) {
  if (!liste?.length) return '';
  return `<span class="nr-auch" title="In Matches auch mit dieser Nummer gespielt">auch ${liste
    .map(x => `#${x.nr} <small>(${x.n}×)</small>`).join(', ')}</span>`;
}
