// ============================================================
//  Linien-Tool: Auswertungen
//  - Stamm-Linien (ähnliche Linien: mind. 4 von 5 gleich)
//  - Verteidigerpaare, Sturmtrios, Sturmduos, Paar × Trio
//  - Top 3: beste bewährte Linien ohne doppelte Personen (Baukasten → linien-ideen.js),
//    aus Häufigkeit und Toren + Skorerpunkten (Statistik-Tool)
//  - Powerplay / Boxplay / 6 gegen 5 mit Quote
//  Gezählt werden nur Kader-Personen (keine Gäste).
//  Bewertungen (Noten) und Chemie sind seit 12.11. ausgebaut.
//  Update S2: Daten aus dem Statistik-Tool (Tore pro Linie,
//  Skorerpunkte, Plus/Minus, PP/BP-Quoten automatisch).
// ============================================================
import { esc } from './ui.js';
import { zeitleiste, versionen } from './statistik-logik.js';

const ZEIGE = 10;                 // so viele Einträge pro Liste (Linien), Rest aufklappbar
const ZEIGE_PAARE = 5;            // Paare & Trios

// Einstellungen bleiben erhalten, solange die App offen ist
const E = { modus: 'alle', spezial: false, sort: 'haeufig', top: 'mix', bereich: 'linien', person: '', offen: new Set() };

// ---- Statistik-Tool → Linien -----------------------------------
// Pro Match: welche Linie/Formation hat welches Tor erzielt bzw. kassiert?
//  1. Linie bei einem Tor von Hand gesetzt (Plus/Minus) → diese Linie
//  2. sonst eigenes Tor: Formation der passenden Art (Linie/PP/BP/6:5) in der gültigen
//     Version, in der Torschütz:in (oder Assist) steht
//  3. sonst PP/BP/6:5 mit nur einer Formation dieser Art → diese
//  PP-/BP-Chancen gehen an die Formation, wenn die Version nur eine dieser Art hat.
export function statistikProLinie(baum) {
  const M = new Map();                 // linie_id → Werte
  const team = { pp: { chancen: 0, tore: 0 }, bp: { chancen: 0, gegentore: 0 }, matches: 0 };
  const wert = id => {
    let x = M.get(id);
    if (!x) M.set(id, x = { tf: 0, tg: 0, plus: 0, minus: 0, anzahl: 0, pkt: [] });
    return x;
  };
  for (const e of baum) {
    const ev = e.match_ereignisse || [];
    if (e.typ !== 'match' || !ev.length) continue;
    e.hatStat = true; team.matches++;
    const R = zeitleiste(ev);
    const ver = versionen(ev, e.varianten);
    const sortiert = [...ev].sort((a, b) => a.zeit - b.zeit);
    const ersteV = [...e.varianten].sort((a, b) => a.nr - b.nr)[0]?.id;
    const vBei = t => { const x = sortiert.filter(y => y.zeit <= t).pop(); return x ? ver.get(x.id) : ersteV; };
    const variante = id => e.varianten.find(v => v.id === id);
    const formen = (vid, art) => (variante(vid)?.linien || []).filter(l => l.art === art);
    const linie = id => { for (const v of e.varianten) { const l = v.linien.find(x => x.id === id); if (l) return l; } return null; };
    const hat = (l, kid) => !!kid && l.linien_spieler.some(r => r.kader_id === kid);

    for (const x of ev) {
      if (x.art !== 'tor' && x.art !== 'gegentor') continue;
      const s = R.sit.get(x.id);
      const art = s === 'pp' ? 'pp' : s === 'bp' ? 'bp' : s === '6v5' ? '6v5' : 'linie';
      let l = x.linie_id ? linie(x.linie_id) : null;
      const getippt = !!l;
      if (!l) {
        const fs = formen(ver.get(x.id), art);
        if (x.art === 'tor') l = fs.find(f => hat(f, x.kader_id)) || fs.find(f => hat(f, x.assist_id)) || null;
        if (!l && art !== 'linie' && fs.length === 1) l = fs[0];
      }
      if (!l) continue;
      const w = wert(l.id);
      if (x.art === 'tor') { w.tf++; [x.kader_id, x.assist_id].forEach(k => k && w.pkt.push(k)); }
      else w.tg++;
      // Plus/Minus nur wenn die Linie getippt wurde (wie im Eishockey: PP-Tor kein +, Gegentor im BP kein −)
      if (getippt) { if (x.art === 'tor' && s !== 'pp') w.plus++; if (x.art === 'gegentor' && s !== 'bp') w.minus++; }
    }
    for (const [art, starts] of [['pp', R.pp.starts], ['bp', R.bp.starts]]) for (const t of starts) {
      const fs = formen(vBei(t), art);
      if (fs.length === 1) wert(fs[0].id).anzahl++;
    }
    team.pp.chancen += R.pp.chancen; team.pp.tore += R.pp.tore;
    team.bp.chancen += R.bp.chancen; team.bp.gegentore += R.bp.gegentore;
  }
  return { M, team };
}

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
      key, ids, einsaetze: new Set(), training: new Set(), match: new Set(),
      anzahl: 0, tore: 0, rollen: {},
      tf: 0, tg: 0, plus: 0, minus: 0, pkt: 0, ...extra,
    });
    t.einsaetze.add(o.e.id);
    (o.e.typ === 'match' ? t.match : t.training).add(o.e.id);
    if (o.e.typ === 'match') {
      if (o.e.hatStat) {
        // Aus der Statistik: Quote der Formation (BP: „tore“ = Gegentore)
        if (o.l.art !== 'linie' && o.st) { t.anzahl += o.st.anzahl; t.tore += o.l.art === 'bp' ? o.st.tg : o.st.tf; }
      } else if (o.l.anzahl != null) { t.anzahl += o.l.anzahl; t.tore += o.l.tore ?? 0; }   // alte Handzähler
    }
    if (o.st) {
      t.tf += o.st.tf; t.tg += o.st.tg; t.plus += o.st.plus; t.minus += o.st.minus;
      t.pkt += o.st.pkt.filter(k => ids.includes(k)).length;
    }
    return t;
  }
  liste() { return [...this.m.values()]; }
}

export function berechne(baum, { modus = 'alle', spezial = false } = {}) {
  // 0) Statistik-Tool: Tore/Chancen pro Linie
  const { M: stat, team } = statistikProLinie(baum);

  // 1) Beobachtungen = jede Linie/Formation in jeder Version
  const obs = [];
  for (const e of baum) {
    if (modus === 'match' && e.typ !== 'match') continue;
    if (modus === 'training' && e.typ !== 'training') continue;
    for (const v of e.varianten) for (const l of v.linien) {
      const rows = l.linien_spieler.filter(r => r.kader_id);
      if (!rows.length) continue;
      obs.push({ e, v, l, rows, st: stat.get(l.id) });
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
  for (const x of exakt.liste().sort((a, b) => b.einsaetze.size - a.einsaetze.size)) {
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
    mitStat: baum.filter(e => e.hatStat && (modus !== 'training')).length,
    team: modus === 'training' ? null : team,
    linien, vPaare: vPaare.liste(), sTrios: sTrios.liste(), sDuos: sDuos.liste(), paarTrio: paarTrio.liste(),
    pp: spez.pp.liste(), bp: spez.bp.liste(), '6v5': spez['6v5'].liste(),
  };
}

// Produktion = Tore der Linie + Skorerpunkte der Personen
const prod = t => t.tf + t.pkt;

export function sortiere(liste, sort) {
  if (sort === 'tore') return [...liste].sort((a, b) =>
    b.tf - a.tf || b.pkt - a.pkt || (b.plus - b.minus) - (a.plus - a.minus) || b.einsaetze.size - a.einsaetze.size);
  return [...liste].sort((a, b) => b.einsaetze.size - a.einsaetze.size || prod(b) - prod(a));
}

// ---- Top 3 ------------------------------------------------------
// Punkte pro Eintrag (0–1): Mischung aus Häufigkeit und Toren/Skorerpunkten,
// jeweils relativ zum besten Eintrag der Liste.
//   art 'mix' = 50 % Häufigkeit + 50 % Tore/Punkte, 'haeufig' = nur Häufigkeit, 'tore' = nur Tore/Punkte
export function bewerter(liste, art = 'mix') {
  const maxH = Math.max(1, ...liste.map(t => t.einsaetze.size));
  const maxP = Math.max(0, ...liste.map(prod));
  return t => {
    const h = t.einsaetze.size / maxH, p = maxP ? prod(t) / maxP : 0;
    if (art === 'haeufig') return h + p * 0.001;            // Gleichstand: Tore entscheiden
    if (art === 'tore') return maxP ? p + h * 0.001 : h;   // ohne Statistik: Häufigkeit
    return maxP ? (h + p) / 2 : h;
  };
}
const frei = (ids, belegt) => ids.every(x => !belegt.has(x));

// beste k sich nicht überschneidende Einträge (max. Punktesumme)
function besteDisjunkte(kand, k, wert, N = 25) {
  const top = [...kand].sort((a, b) => wert(b) - wert(a)).slice(0, N);
  let best = [], bestP = -Infinity;
  const such = (start, wahl, belegt, summe) => {
    if (wahl.length > best.length || (wahl.length === best.length && summe > bestP)) { best = [...wahl]; bestP = summe; }
    if (wahl.length === k) return;
    for (let i = start; i < top.length; i++) {
      const t = top[i];
      if (!frei(t.ids, belegt)) continue;
      t.ids.forEach(x => belegt.add(x));
      such(i + 1, [...wahl, t], belegt, summe + wert(t));
      t.ids.forEach(x => belegt.delete(x));
    }
  };
  such(0, [], new Set(), 0);
  return best.sort((a, b) => wert(b) - wert(a));
}

// art: 'mix' | 'haeufig' | 'tore' oder eigene Funktion (liste → t → Wert 0–1), z.B. aus linien-ideen.js
export function topDrei(R, aktiv, art = 'mix') {
  const B = typeof art === 'function' ? art : l => bewerter(l, art);
  const nurAktiv = l => l.filter(t => t.ids.every(x => aktiv.has(x)));
  // 1) bewährte Linien
  const lin = nurAktiv(R.linien);
  const linien = besteDisjunkte(lin, 3, B(lin));
  // 2) Baukasten: 3 Paare + 3 Trios, alle ohne Überschneidung
  const pAlle = nurAktiv(R.vPaare), tAlle = nurAktiv(R.sTrios);
  const wP = B(pAlle), wT = B(tAlle);
  const paare = [...pAlle].sort((a, b) => wP(b) - wP(a)).slice(0, 15);
  const trios = [...tAlle].sort((a, b) => wT(b) - wT(a)).slice(0, 15);
  // alle überschneidungsfreien Auswahlen mit 1–k Einträgen
  const sets = (liste, k) => { const out = []; const such = (i, w, b) => {
    if (w.length) out.push([...w]);
    if (w.length === k) return;
    for (let j = i; j < liste.length; j++) { if (!frei(liste[j].ids, b)) continue;
      liste[j].ids.forEach(x => b.add(x)); such(j + 1, [...w, liste[j]], b); liste[j].ids.forEach(x => b.delete(x)); }
  }; such(0, [], new Set()); return out; };
  const pSets = sets(paare, 3), tSets = sets(trios, 3);
  let best = null, bestP = -Infinity;
  for (const ps of pSets) {
    const belegt = new Set(ps.flatMap(p => p.ids));
    for (const ts of tSets) {
      // gleich viele Paare wie Trios (= Anzahl Linien), niemand doppelt
      if (ts.length !== ps.length || !ts.every(t => frei(t.ids, belegt))) continue;
      const p = ps.length * 1000 + ps.reduce((a, x) => a + wP(x), 0) + ts.reduce((a, x) => a + wT(x), 0);
      if (p > bestP) { bestP = p; best = { ps, ts }; }
    }
  }
  let bau = [];
  if (best) {
    // Paare den Trios zuordnen: Kombis, die schon zusammen gespielt haben, bevorzugen
    const pt = new Map(R.paarTrio.map(t => [t.key, t]));
    const wPT = B(R.paarTrio);
    const perms = a => a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(r => [x, ...r]));
    const wert = (p, t) => { const k = pt.get(p.key + '#' + t.key); return (k ? 1 + wPT(k) : 0) + (wP(p) + wT(t)) / 2; };
    let bp = null, bw = -Infinity;
    for (const perm of perms(best.ts)) {
      const w = best.ps.reduce((a, p, i) => a + wert(p, perm[i]), 0);
      if (w > bw) { bw = w; bp = perm; }
    }
    bau = best.ps.map((p, i) => ({ paar: p, trio: bp[i], zusammen: pt.get(p.key + '#' + bp[i].key) || null }))
      .sort((a, b) => wert(b.paar, b.trio) - wert(a.paar, a.trio));
  }
  return { linien, bau };
}

// ---- Darstellung -----------------------------------------------
export function zeichneAuswertung(ziel, baum, { kMap, kurz, personen }) {
  const aktiv = new Set(personen.filter(k => k.aktiv).map(k => k.id));
  const name = id => {
    const k = kMap.get(id);
    return k ? `${k.nummer != null ? `<b>${k.nummer}</b> ` : ''}${esc(kurz.get(id) ?? k.name)}` : '?';
  };
  const namen = (ids, rollen) => {
    const ord = rollen ? [...ids].sort((a, b) => (rollen[a] === 'V' ? 0 : rollen[a] === 'S' ? 2 : 1) - (rollen[b] === 'V' ? 0 : rollen[b] === 'S' ? 2 : 1)) : ids;
    return ord.map(id => `<span class="aw-p ${rollen ? 'r-' + (rollen[id] || 'S') : ''}">${name(id)}</span>`).join('');
  };

  // Tore / Skorerpunkte / Plus-Minus aus dem Statistik-Tool
  const statInfo = t => {
    const pm = t.plus - t.minus;
    const teile = [
      t.tf ? `⚽ ${t.tf} ${t.tf === 1 ? 'Tor' : 'Tore'}` : '',
      t.pkt ? `🎯 ${t.pkt} ${t.pkt === 1 ? 'Skorerpunkt' : 'Skorerpunkte'}` : '',
      t.plus || t.minus ? `<span class="${pm > 0 ? 'aw-plus-wert' : pm < 0 ? 'aw-minus-wert' : ''}">± ${pm > 0 ? '+' : ''}${pm}</span> <small>(+${t.plus}/−${t.minus})</small>` : '',
    ].filter(Boolean);
    return teile.length ? `<div class="aw-stat">${teile.join(' · ')}</div>` : '';
  };
  const wieOft = t => [t.training.size ? `🏋️ ${t.training.size}` : '', t.match.size ? `🏆 ${t.match.size}` : ''].filter(Boolean).join(' · ');

  // Rechts: Häufigkeit gross; bei Sortierung „Tore“ die Tore
  function zeile(t, titel, { extra = '', rechts = null } = {}) {
    const r = rechts ?? (E.sort === 'tore' ? { wert: t.tf, text: t.tf === 1 ? 'Tor' : 'Tore' } : { wert: `${t.einsaetze.size}×`, text: 'zusammen' });
    return `<li class="aw-zeile">
      <div class="aw-haupt">
        <div class="aw-namen">${titel}</div>
        ${statInfo(t)}
        <div class="aw-info">${t.einsaetze.size}× zusammen${wieOft(t) ? ` (${wieOft(t)})` : ''}</div>
        ${extra}
      </div>
      <div class="aw-wert"><span class="aw-note">${r.wert}</span><small class="aw-einh">${r.text}</small></div>
    </li>`;
  }

  function block(key, titel, info, liste, render, anzahl = ZEIGE) {
    const sorted = sortiere(E.person ? liste.filter(t => t.ids.includes(E.person)) : liste, E.sort);
    const offen = E.offen.has(key);
    const zeigen = offen ? sorted : sorted.slice(0, anzahl);
    return `<section class="aw-block">
      <h3 class="gruppe">${titel} <span>${sorted.length}</span></h3>
      ${info ? `<p class="muted klein aw-erkl">${info}</p>` : ''}
      ${sorted.length ? `<ul class="aw-liste">${zeigen.map(render).join('')}</ul>
        ${sorted.length > anzahl ? `<button class="btn ghost small aw-mehr" data-k="${key}">${offen ? '▲ Weniger anzeigen' : `▼ Alle ${sorted.length} anzeigen`}</button>` : ''}`
        : '<p class="muted klein aw-leer">Noch keine Daten.</p>'}
    </section>`;
  }

  const quote = (t, art) => !t.anzahl ? '' : `<div class="aw-quote">${art === 'bp'
    ? `${t.anzahl - Math.min(t.tore, t.anzahl)} von ${t.anzahl} Unterzahlen ohne Gegentor = <b>${Math.round(100 * (t.anzahl - Math.min(t.tore, t.anzahl)) / t.anzahl)} %</b>`
    : `${t.tore} ${t.tore === 1 ? 'Tor' : 'Tore'} aus ${t.anzahl} ${art === 'pp' ? (t.anzahl === 1 ? 'Überzahl' : 'Überzahlen') : (t.anzahl === 1 ? 'Situation' : 'Situationen')} = <b>${Math.round(100 * t.tore / t.anzahl)} %</b>`}</div>`;

  function zeichne() {
    const R = berechne(baum, E);
    const seg = (cls, key, opts) => `<div class="seg ${cls}">${opts.map(([v, t]) => `<button data-v="${v}" class="${E[key] === v ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    const keineStat = !R.mitStat ? `<p class="aw-hinweis">ℹ️ Noch keine Match-Statistik erfasst – Tore und Skorerpunkte kommen aus dem Statistik-Tool. Bis dahin zählt nur die Häufigkeit.</p>` : '';

    let inhalt = '';
    if (E.bereich === 'linien') {
      inhalt = block('linien', E.sort === 'tore' ? '⚽ Torgefährlichste Linien' : '🔁 Stamm-Linien',
        `Ähnliche Linien (mind. 4 von 5 gleich) werden zusammengefasst – Abweichungen stehen als Hinweis dabei.
         ${E.sort === 'tore' ? 'Sortiert nach Toren aus der Match-Statistik.' : 'Sortiert nach Häufigkeit.'}`,
        R.linien, t => zeile(t, namen(t.ids, t.rollen), {
          extra: t.varianten.length ? `<div class="aw-var">↔ Varianten: ${t.varianten.map(v => {
            const p = v.plus.map(name).join(', '), m = v.minus.map(name).join(', ');
            return `${p && m ? `${p} statt ${m}` : p ? `zusätzlich ${p}` : `ohne ${m}`} <small>(${v.n}×)</small>`;
          }).join(' · ')}</div>` : '',
        }));
    } else if (E.bereich === 'paare') {
      inhalt = block('vp', '🛡️ Verteidigerpaare', '', R.vPaare, t => zeile(t, namen(t.ids)), ZEIGE_PAARE)
        + block('st', '⚡ Sturmtrios', '', R.sTrios, t => zeile(t, namen(t.ids)), ZEIGE_PAARE)
        + block('sd', '🤝 Sturmduos', 'Zwei Stürmer:innen gemeinsam – auch wenn die dritte Person wechselt.', R.sDuos, t => zeile(t, namen(t.ids)), ZEIGE_PAARE)
        + block('pt', '🧩 Verteidigerpaar + Sturmtrio', '', R.paarTrio, t => zeile(t,
          `<span class="aw-gruppe">${namen(t.paar)}</span><span class="aw-plus">+</span><span class="aw-gruppe">${namen(t.trio)}</span>`), ZEIGE_PAARE);
    } else if (E.bereich === 'top3') {
      const R3 = E.spezial ? berechne(baum, { ...E, spezial: false }) : R;   // Top 3: nur echte Linien, ohne PP/BP
      const T3 = topDrei(R3, aktiv, E.top);
      const rang = i => `<span class="aw-rang">Linie ${i + 1}</span>`;
      const erkl = { mix: 'je zur Hälfte aus Häufigkeit und Toren + Skorerpunkten', haeufig: 'nach Häufigkeit', tore: 'nach Toren + Skorerpunkten' }[E.top];
      const kurzInfo = t => `${t.einsaetze.size}×${t.tf || t.pkt ? ` · ⚽ ${t.tf} · 🎯 ${t.pkt}` : ''}`;
      inhalt = `
        ${seg('aw-top', 'top', [['mix', '⚖️ Gesamt'], ['haeufig', '🔁 Häufigkeit'], ['tore', '⚽ Tore/Punkte']])}
        ${E.top !== 'haeufig' ? keineStat : ''}
        <section class="aw-block">
          <h3 class="gruppe">🏆 Beste 3 bewährte Linien</h3>
          <p class="muted klein aw-erkl">Aus den Stamm-Linien, ${erkl} – niemand kommt doppelt vor, nur aktive Spieler:innen.</p>
          ${T3.linien.length ? `<ul class="aw-liste">${T3.linien.map((t, i) => zeile(t, rang(i) + namen(t.ids, t.rollen),
            { rechts: { wert: `${t.einsaetze.size}×`, text: 'zusammen' } })).join('')}</ul>`
            : '<p class="muted klein aw-leer">Noch keine Linien erfasst.</p>'}
          ${T3.linien.length && T3.linien.length < 3 ? '<p class="aw-hinweis">Mehr Linien ohne Überschneidung gibt es noch nicht.</p>' : ''}
        </section>
        <p class="aw-hinweis">💡 Neue Kombis und eine Test-Aufstellung findest du im Reiter <b>Ideen</b>.</p>`;
    } else {
      const T = R.team;
      const teamZeile = T && T.matches ? `<div class="aw-team">
        <b>Team aus der Match-Statistik</b> (${T.matches} ${T.matches === 1 ? 'Match' : 'Matches'}):
        Powerplay ${T.pp.chancen ? `${T.pp.tore}/${T.pp.chancen} = <b>${Math.round(100 * T.pp.tore / T.pp.chancen)} %</b>` : '–'} ·
        Boxplay ${T.bp.chancen ? `${T.bp.chancen - Math.min(T.bp.gegentore, T.bp.chancen)}/${T.bp.chancen} ohne Gegentor = <b>${Math.round(100 * (T.bp.chancen - Math.min(T.bp.gegentore, T.bp.chancen)) / T.bp.chancen)} %</b>` : '–'}
        <p class="muted klein">Hat eine Version mehrere PP- bzw. BP-Formationen, zählen die Über-/Unterzahlen nur hier fürs Team – Tore gehen trotzdem an die Formation der Torschütz:in.</p>
      </div>` : '';
      inhalt = teamZeile + block('pp', '⚡ Powerplay', '', R.pp, t => zeile(t, namen(t.ids, t.rollen), { extra: quote(t, 'pp') }))
        + block('bp', '🛡️ Boxplay', '', R.bp, t => zeile(t, namen(t.ids, t.rollen), { extra: quote(t, 'bp') }))
        + (R['6v5'].length ? block('65', '🥅 6 gegen 5', '', R['6v5'], t => zeile(t, namen(t.ids, t.rollen), { extra: quote(t, '6v5') })) : '');
    }

    ziel.innerHTML = `
      <div class="aw-steuer">
        ${seg('aw-bereich', 'bereich', [['linien', 'Linien'], ['top3', '🏆 Top 3'], ['paare', 'Paare/Trios'], ['spezial', 'PP / BP']])}
        ${E.bereich === 'top3' ? '' : seg('aw-sort', 'sort', [['haeufig', '🔁 Häufigkeit'], ['tore', '⚽ Tore']])}
        <div class="aw-filter">
          <label>Einsätze<select class="aw-modus">
            ${[['alle', 'Alle Einsätze'], ['match', 'Nur Matches & Testspiele'], ['training', 'Nur Trainings']]
              .map(([v, t]) => `<option value="${v}" ${E.modus === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <label ${E.bereich === 'top3' ? 'hidden' : ''}>Person<select class="aw-person"><option value="">Alle</option>
            ${personen.map(k => `<option value="${k.id}" ${E.person === k.id ? 'selected' : ''}>${k.nummer != null ? k.nummer + ' ' : ''}${esc(k.name)}</option>`).join('')}</select></label>
        </div>
        ${E.bereich === 'paare' ? `<label class="aw-check"><input type="checkbox" class="aw-spezial" ${E.spezial ? 'checked' : ''}> Powerplay & Boxplay mitzählen</label>` : ''}
      </div>
      <p class="summary muted">${R.anzahlEinsaetze} Einsätze${R.mitStat ? ` · ${R.mitStat} mit Match-Statistik` : ''}</p>
      ${R.anzahlEinsaetze ? inhalt : '<p class="muted pad leer">Noch keine Einsätze mit eingeteilten Personen.</p>'}`;

    ziel.querySelector('.aw-bereich').onclick = e => { const b = e.target.closest('button'); if (b) { E.bereich = b.dataset.v; zeichne(); } };
    ziel.querySelector('.aw-sort')?.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { E.sort = b.dataset.v; zeichne(); } });
    ziel.querySelector('.aw-top')?.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { E.top = b.dataset.v; zeichne(); } });
    ziel.querySelector('.aw-modus').onchange = e => { E.modus = e.target.value; zeichne(); };
    ziel.querySelector('.aw-person').onchange = e => { E.person = e.target.value; zeichne(); };
    ziel.querySelector('.aw-spezial')?.addEventListener('change', e => { E.spezial = e.target.checked; zeichne(); });
    ziel.querySelectorAll('.aw-mehr').forEach(b => b.onclick = () => {
      E.offen.has(b.dataset.k) ? E.offen.delete(b.dataset.k) : E.offen.add(b.dataset.k); zeichne();
    });
  }
  zeichne();
}
