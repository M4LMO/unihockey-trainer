// ============================================================
//  Linien-Tool: Auswertungen (Update B)
//  - Stamm-/Top-Linien (ähnliche Linien: mind. 4 von 5 gleich)
//  - Verteidigerpaare, Sturmtrios, Sturmduos, Paar × Trio
//  - Powerplay / Boxplay / 6 gegen 5 mit Quote
//  Gezählt werden nur Kader-Personen (keine Gäste).
// ============================================================
import { esc } from './ui.js';

export const MIN_EINSAETZE = 5;   // ab so vielen bewerteten Einsätzen in den Top-Listen
const ZEIGE = 10;                 // so viele Einträge pro Liste, Rest aufklappbar

// Einstellungen bleiben erhalten, solange die App offen ist
const E = { modus: 'match2', spezial: false, sort: 'note', bereich: 'linien', person: '', offen: new Set() };

// ---- Rechnen ---------------------------------------------------
const kombis = (arr, k) => {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [x, ...rest] = arr;
  return [...kombis(rest, k - 1).map(c => [x, ...c]), ...kombis(rest, k)];
};

class Topf {
  constructor() { this.m = new Map(); }
  add(key, ids, o, extra) {
    let t = this.m.get(key);
    if (!t) this.m.set(key, t = {
      key, ids, einsaetze: new Set(), bewertet: new Set(), sw: 0, swn: 0, n: 0,
      tr: [], ma: [], anzahl: 0, tore: 0, rollen: {}, ...extra,
    });
    t.einsaetze.add(o.e.id);
    if (o.note != null) {
      t.sw += o.w; t.swn += o.w * o.note; t.n++; t.bewertet.add(o.e.id);
      (o.e.typ === 'match' ? t.ma : t.tr).push(o.note);
    }
    if (o.e.typ === 'match' && o.l.anzahl != null) { t.anzahl += o.l.anzahl; t.tore += o.l.tore ?? 0; }
    return t;
  }
  liste() { return [...this.m.values()]; }
}
const schnitt = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const avg = t => t.sw ? t.swn / t.sw : null;

export function berechne(baum, { modus = 'match2', spezial = false } = {}) {
  // 1) Beobachtungen = jede Linie/Formation in jeder Version
  const obs = [];
  for (const e of baum) {
    if (modus === 'match' && e.typ !== 'match') continue;
    if (modus === 'training' && e.typ !== 'training') continue;
    const w = modus === 'match2' && e.typ === 'match' ? 2 : 1;
    for (const v of e.varianten) for (const l of v.linien) {
      const rows = l.linien_spieler.filter(r => r.kader_id);
      if (!rows.length) continue;
      obs.push({ e, v, l, w, rows, note: l.note == null ? null : Number(l.note) });
    }
  }

  // 2) Paare & Trios nach Rolle (V / S)
  const vPaare = new Topf(), sTrios = new Topf(), sDuos = new Topf(), paarTrio = new Topf();
  for (const o of obs) {
    if (o.l.art !== 'linie' && !spezial) continue;
    const V = o.rows.filter(r => r.rolle === 'V').map(r => r.kader_id).sort();
    const S = o.rows.filter(r => r.rolle === 'S').map(r => r.kader_id).sort();
    const vp = kombis(V, 2), st = kombis(S, 3);
    vp.forEach(p => vPaare.add(p.join('|'), p, o));
    st.forEach(t => sTrios.add(t.join('|'), t, o));
    kombis(S, 2).forEach(d => sDuos.add(d.join('|'), d, o));
    for (const p of vp) for (const t of st) paarTrio.add(p.join('|') + '#' + t.join('|'), [...p, ...t], o, { paar: p, trio: t });
  }

  // 3) Linien: exakte Besetzungen, dann ähnliche zusammenfassen
  const exakt = new Topf();
  for (const o of obs) {
    if (o.l.art !== 'linie' || o.rows.length < 3) continue;
    const ids = o.rows.map(r => r.kader_id).sort();
    const t = exakt.add(ids.join('|'), ids, o, { obs: [] });
    t.obs.push(o);
    o.rows.forEach(r => { t.rollen[r.kader_id] = r.rolle; });
  }
  const aehnlich = (a, b) => {
    const s = new Set(a); const gleich = b.filter(x => s.has(x)).length;
    return gleich >= Math.max(a.length, b.length) - 1;
  };
  const cluster = [];
  for (const x of exakt.liste().sort((a, b) => b.einsaetze.size - a.einsaetze.size || b.n - a.n)) {
    let c = cluster.find(c => aehnlich(c.ids, x.ids));
    if (!c) { c = { ids: x.ids, rollen: { ...x.rollen }, mitglieder: [] }; cluster.push(c); }
    c.mitglieder.push(x);
  }
  const linien = cluster.map((c, i) => {
    const t = new Topf();
    let sum;
    for (const m of c.mitglieder) for (const o of m.obs) sum = t.add('c' + i, c.ids, o);
    const ref = new Set(c.ids);
    sum.rollen = c.rollen;
    sum.varianten = c.mitglieder.slice(1).map(m => ({
      plus: m.ids.filter(x => !ref.has(x)), minus: c.ids.filter(x => !m.ids.includes(x)), n: m.einsaetze.size,
    }));
    return sum;
  });

  // 4) Spezialformationen: exakte Besetzung pro Art
  const spez = { pp: new Topf(), bp: new Topf(), '6v5': new Topf() };
  for (const o of obs) {
    if (o.l.art === 'linie') continue;
    const ids = o.rows.map(r => r.kader_id).sort();
    const t = spez[o.l.art].add(ids.join('|'), ids, o);
    o.rows.forEach(r => { t.rollen[r.kader_id] = r.rolle; });
  }

  return {
    anzahlEinsaetze: new Set(obs.map(o => o.e.id)).size,
    bewertet: obs.filter(o => o.note != null).length,
    linien, vPaare: vPaare.liste(), sTrios: sTrios.liste(), sDuos: sDuos.liste(), paarTrio: paarTrio.liste(),
    pp: spez.pp.liste(), bp: spez.bp.liste(), '6v5': spez['6v5'].liste(),
  };
}

export function sortiere(liste, sort) {
  const ok = t => t.bewertet.size >= MIN_EINSAETZE;
  return [...liste].sort((a, b) => sort === 'haeufig'
    ? b.einsaetze.size - a.einsaetze.size || (avg(b) ?? 0) - (avg(a) ?? 0)
    : (ok(b) - ok(a)) || (ok(a) ? avg(b) - avg(a) : b.einsaetze.size - a.einsaetze.size) || (avg(b) ?? 0) - (avg(a) ?? 0));
}

// ---- Darstellung -----------------------------------------------
export function zeichneAuswertung(ziel, baum, { kMap, kurz, personen }) {
  const name = id => {
    const k = kMap.get(id);
    return k ? `${k.nummer != null ? `<b>${k.nummer}</b> ` : ''}${esc(kurz.get(id) ?? k.name)}` : '?';
  };
  const namen = (ids, rollen) => {
    const ord = rollen ? [...ids].sort((a, b) => (rollen[a] === 'V' ? 0 : rollen[a] === 'S' ? 2 : 1) - (rollen[b] === 'V' ? 0 : rollen[b] === 'S' ? 2 : 1)) : ids;
    return ord.map(id => `<span class="aw-p ${rollen ? 'r-' + (rollen[id] || 'S') : ''}">${name(id)}</span>`).join('');
  };

  function zeile(t, titel, { extra = '' } = {}) {
    const a = avg(t), ok = t.bewertet.size >= MIN_EINSAETZE;
    const tm = [t.tr.length ? `🏋️ ${schnitt(t.tr).toFixed(1)}` : '', t.ma.length ? `🏆 ${schnitt(t.ma).toFixed(1)}` : ''].filter(Boolean).join(' · ');
    return `<li class="aw-zeile ${ok ? '' : 'wenig'}">
      <div class="aw-haupt">
        <div class="aw-namen">${titel}</div>
        <div class="aw-info">${t.einsaetze.size}× zusammen${t.n ? ` · ${t.bewertet.size} bewertet` : ' · noch keine Note'}${tm ? ` · ${tm}` : ''}${!ok && t.n ? ` · <i>zu wenig Noten für Top-Liste (ab ${MIN_EINSAETZE})</i>` : ''}</div>
        ${extra}
      </div>
      <div class="aw-wert">
        <span class="aw-note">${a == null ? '–' : a.toFixed(1)}</span>
        <span class="aw-bar"><i style="width:${a == null ? 0 : Math.round((a / 6) * 100)}%"></i></span>
      </div>
    </li>`;
  }

  function block(key, titel, info, liste, render) {
    const sorted = sortiere(E.person ? liste.filter(t => t.ids.includes(E.person)) : liste, E.sort);
    const offen = E.offen.has(key);
    const zeigen = offen ? sorted : sorted.slice(0, ZEIGE);
    return `<section class="aw-block">
      <h3 class="gruppe">${titel} <span>${sorted.length}</span></h3>
      ${info ? `<p class="muted klein aw-erkl">${info}</p>` : ''}
      ${sorted.length ? `<ul class="aw-liste">${zeigen.map(render).join('')}</ul>
        ${sorted.length > ZEIGE ? `<button class="btn ghost small aw-mehr" data-k="${key}">${offen ? 'Weniger anzeigen' : `Alle ${sorted.length} anzeigen`}</button>` : ''}`
        : '<p class="muted klein aw-leer">Noch keine Daten.</p>'}
    </section>`;
  }

  const quote = (t, art) => !t.anzahl ? '' : `<div class="aw-quote">${art === 'bp'
    ? `${t.anzahl - Math.min(t.tore, t.anzahl)} von ${t.anzahl} Unterzahlen ohne Gegentor = <b>${Math.round(100 * (t.anzahl - Math.min(t.tore, t.anzahl)) / t.anzahl)} %</b>`
    : `${t.tore} Tore aus ${t.anzahl} ${art === 'pp' ? 'Überzahlen' : 'Situationen'} = <b>${Math.round(100 * t.tore / t.anzahl)} %</b>`}</div>`;

  function zeichne() {
    const R = berechne(baum, E);
    const seg = (cls, key, opts) => `<div class="seg ${cls}">${opts.map(([v, t]) => `<button data-v="${v}" class="${E[key] === v ? 'on' : ''}">${t}</button>`).join('')}</div>`;

    let inhalt = '';
    if (E.bereich === 'linien') {
      inhalt = block('linien', E.sort === 'note' ? '⭐ Top-Linien' : '🔁 Stamm-Linien',
        `Ähnliche Linien (mind. 4 von 5 gleich) werden zusammengefasst – Abweichungen stehen als Hinweis dabei.
         ${E.sort === 'note' ? `In der Rangliste ab ${MIN_EINSAETZE} bewerteten Einsätzen.` : 'Sortiert nach Häufigkeit.'}`,
        R.linien, t => zeile(t, namen(t.ids, t.rollen), {
          extra: t.varianten.length ? `<div class="aw-var">↔ Varianten: ${t.varianten.map(v => {
            const p = v.plus.map(name).join(', '), m = v.minus.map(name).join(', ');
            return `${p && m ? `${p} statt ${m}` : p ? `zusätzlich ${p}` : `ohne ${m}`} <small>(${v.n}×)</small>`;
          }).join(' · ')}</div>` : '',
        }));
    } else if (E.bereich === 'paare') {
      inhalt = block('vp', '🛡️ Verteidigerpaare', '', R.vPaare, t => zeile(t, namen(t.ids)))
        + block('st', '⚡ Sturmtrios', '', R.sTrios, t => zeile(t, namen(t.ids)))
        + block('sd', '🤝 Sturmduos', 'Zwei Stürmer:innen gemeinsam – auch wenn die dritte Person wechselt.', R.sDuos, t => zeile(t, namen(t.ids)))
        + block('pt', '🧩 Verteidigerpaar + Sturmtrio', '', R.paarTrio, t => zeile(t,
          `<span class="aw-gruppe">${namen(t.paar)}</span><span class="aw-plus">+</span><span class="aw-gruppe">${namen(t.trio)}</span>`));
    } else {
      inhalt = block('pp', '⚡ Powerplay', '', R.pp, t => zeile(t, namen(t.ids, t.rollen), { extra: quote(t, 'pp') }))
        + block('bp', '🛡️ Boxplay', '', R.bp, t => zeile(t, namen(t.ids, t.rollen), { extra: quote(t, 'bp') }))
        + (R['6v5'].length ? block('65', '🥅 6 gegen 5', '', R['6v5'], t => zeile(t, namen(t.ids, t.rollen), { extra: quote(t, '6v5') })) : '');
    }

    ziel.innerHTML = `
      <div class="aw-steuer">
        ${seg('aw-bereich', 'bereich', [['linien', 'Linien'], ['paare', 'Paare & Trios'], ['spezial', 'PP / BP']])}
        ${seg('aw-sort', 'sort', [['note', '⭐ Ø Note'], ['haeufig', '🔁 Häufigkeit']])}
        <div class="aw-filter">
          <label>Gewichtung<select class="aw-modus">
            ${[['match2', 'Match zählt doppelt'], ['gleich', 'Alles gleich'], ['match', 'Nur Matches'], ['training', 'Nur Trainings']]
              .map(([v, t]) => `<option value="${v}" ${E.modus === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <label>Person<select class="aw-person"><option value="">Alle</option>
            ${personen.map(k => `<option value="${k.id}" ${E.person === k.id ? 'selected' : ''}>${k.nummer != null ? k.nummer + ' ' : ''}${esc(k.name)}</option>`).join('')}</select></label>
        </div>
        ${E.bereich === 'paare' ? `<label class="aw-check"><input type="checkbox" class="aw-spezial" ${E.spezial ? 'checked' : ''}> Powerplay & Boxplay mitzählen</label>` : ''}
      </div>
      <p class="summary muted">${R.anzahlEinsaetze} Einsätze · ${R.bewertet} bewertete Linien/Formationen${E.modus === 'match2' ? ' · Matches zählen doppelt' : ''}</p>
      ${R.anzahlEinsaetze ? inhalt : '<p class="muted pad leer">Noch keine Einsätze mit eingeteilten Personen.</p>'}`;

    ziel.querySelector('.aw-bereich').onclick = e => { const b = e.target.closest('button'); if (b) { E.bereich = b.dataset.v; zeichne(); } };
    ziel.querySelector('.aw-sort').onclick = e => { const b = e.target.closest('button'); if (b) { E.sort = b.dataset.v; zeichne(); } };
    ziel.querySelector('.aw-modus').onchange = e => { E.modus = e.target.value; zeichne(); };
    ziel.querySelector('.aw-person').onchange = e => { E.person = e.target.value; zeichne(); };
    ziel.querySelector('.aw-spezial')?.addEventListener('change', e => { E.spezial = e.target.checked; zeichne(); });
    ziel.querySelectorAll('.aw-mehr').forEach(b => b.onclick = () => {
      E.offen.has(b.dataset.k) ? E.offen.delete(b.dataset.k) : E.offen.add(b.dataset.k); zeichne();
    });
  }
  zeichne();
}
