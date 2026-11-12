// ============================================================
//  Linien-Tool: 💡 Ideen – Vorschläge zum Ausprobieren
//  Grundlage: wie oft Personen/Kombis zusammen gespielt haben
//  (alle Einsätze) und – aus der Match-Statistik – Tore,
//  Skorerpunkte und Plus/Minus (Linie bei Tor/Gegentor erfasst).
//  Nur aktive Feldspieler:innen, keine Gäste.
// ============================================================
import { esc } from './ui.js';
import { berechne, topDrei, statistikProLinie } from './linien-auswertung.js';

const FRISCH_TAGE = 21;   // „frisch getestet“ = erstmals in den letzten 3 Wochen
const ZEIGE = 5;

const S = { person: '', offen: new Set() };   // Zustand, solange die App offen ist

const pm = t => t.plus - t.minus;
const prod = t => t.tf + t.pkt;
const tage = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);

// Wiederholungen weglassen: Kombi steckt ganz in einem schon gezeigten Eintrag mit gleichen Zahlen
// (z.B. Sturmduo aus einer Linie, die schon dasteht)
function ohneDoppelte(liste) {
  const gezeigt = [];
  return liste.filter(({ t }) => {
    const doppelt = gezeigt.some(g => t.ids.every(x => g.ids.includes(x)) && pm(g) === pm(t) && g.einsaetze.size === t.einsaetze.size && g.tf === t.tf);
    if (!doppelt) gezeigt.push(t);
    return !doppelt;
  });
}

// Normierte Stärke 0–1: Häufigkeit, Tore+Punkte und Plus/Minus (je nur, wenn Daten da sind)
export function staerke(liste) {
  const maxN = Math.max(1, ...liste.map(t => t.einsaetze.size));
  const maxP = Math.max(0, ...liste.map(prod));
  const pms = liste.map(pm), minPm = Math.min(0, ...pms), maxPm = Math.max(0, ...pms);
  const mitPm = liste.some(t => t.plus || t.minus);
  return t => {
    const teile = [t.einsaetze.size / maxN];
    if (maxP) teile.push(prod(t) / maxP);
    if (mitPm && maxPm > minPm) teile.push((pm(t) - minPm) / (maxPm - minPm));
    return teile.reduce((a, b) => a + b, 0) / teile.length;
  };
}

// ---- Rechnen ---------------------------------------------------
export function ideen(baum, aktiv) {
  const R = berechne(baum, { modus: 'alle' });
  const { M: stat } = statistikProLinie(baum);
  const nurAktiv = l => l.filter(t => t.ids.every(x => aktiv.has(x)));
  const datum = new Map(baum.map(e => [e.id, e.datum]));
  const erstes = t => [...t.einsaetze].map(id => datum.get(id)).sort()[0];
  const letztesDatum = baum.map(e => e.datum).sort().pop();
  const hatStat = baum.some(e => e.hatStat);
  const hatPm = [...stat.values()].some(x => x.plus || x.minus);

  const L = nurAktiv(R.linien), P = nurAktiv(R.vPaare), T = nurAktiv(R.sTrios), D = nurAktiv(R.sDuos);
  const sP = staerke(P), sT = staerke(T);
  const ok = t => !hatPm || pm(t) >= 0;   // mit Plus/Minus: nichts vorschlagen, was negativ läuft

  // 1) Neue Kombis: starke Paare × starke Trios, die (fast) nie zusammen waren
  const pt = new Map(R.paarTrio.map(x => [x.key, x]));
  const topP = P.filter(ok).sort((a, b) => sP(b) - sP(a)).slice(0, 8);
  const topT = T.filter(ok).sort((a, b) => sT(b) - sT(a)).slice(0, 8);
  const neu = [];
  for (const p of topP) for (const t of topT) {
    if (t.ids.some(x => p.ids.includes(x))) continue;
    const z = pt.get(p.key + '#' + t.key);
    if (z && z.einsaetze.size > 1) continue;
    neu.push({ paar: p, trio: t, zusammen: z?.einsaetze.size ?? 0, wert: (sP(p) + sT(t)) / 2 });
  }
  neu.sort((a, b) => b.wert - a.wert || a.zusammen - b.zusammen);
  // jedes Paar/Trio höchstens 2× vorschlagen → mehr Abwechslung
  const zaehl = new Map();
  const neuKombis = neu.filter(x => {
    const a = (zaehl.get(x.paar.key) || 0), b = (zaehl.get(x.trio.key) || 0);
    if (a >= 2 || b >= 2) return false;
    zaehl.set(x.paar.key, a + 1); zaehl.set(x.trio.key, b + 1); return true;
  });

  // 2) Test-Aufstellung (Baukasten): 3 Paare + 3 Trios ohne Überschneidung
  //    Stärke inkl. Plus/Minus; negativ laufende Paare/Trios werden ausgelassen
  const bau = topDrei({ ...R, vPaare: R.vPaare.filter(ok), sTrios: R.sTrios.filter(ok) }, aktiv, staerke).bau;

  // 3) Verdient mehr Einsätze: selten zusammen, aber produktiv / positives ±
  const einheiten = [
    ...L.map(t => ({ t, art: 'Ganze Linie' })), ...P.map(t => ({ t, art: 'Verteidigerpaar' })),
    ...T.map(t => ({ t, art: 'Sturmtrio' })), ...D.map(t => ({ t, art: 'Sturmduo' })),
  ];
  const mehr = ohneDoppelte(einheiten
    .filter(({ t }) => t.einsaetze.size <= 3 && (pm(t) > 0 || prod(t) > 0))
    .map(x => ({ ...x, wert: (pm(x.t) * 2 + x.t.tf * 1.5 + x.t.pkt) / x.t.einsaetze.size }))
    .sort((a, b) => b.wert - a.wert || b.t.ids.length - a.t.ids.length));

  // 4) Frisch getestet: erstmals in den letzten 3 Wochen (nur wenn es ältere Daten gibt)
  const aeltestes = baum.map(e => e.datum).sort()[0];
  const frisch = letztesDatum && tage(aeltestes, letztesDatum) > FRISCH_TAGE
    ? ohneDoppelte([...L.map(t => ({ t, art: 'Ganze Linie' })), ...P.map(t => ({ t, art: 'Verteidigerpaar' })), ...T.map(t => ({ t, art: 'Sturmtrio' }))]
      .filter(({ t }) => tage(erstes(t), letztesDatum) <= FRISCH_TAGE)
      .map(x => ({ ...x, seit: erstes(x.t) }))
      .sort((a, b) => b.seit.localeCompare(a.seit) || b.t.ids.length - a.t.ids.length || pm(b.t) - pm(a.t)))
    : [];

  // 5) Läuft (noch) nicht: oft zusammen, in Matches negativ bzw. ohne Tore
  const harzt = hatStat ? ohneDoppelte(einheiten
    .filter(({ t }) => t.einsaetze.size >= 4 && t.match.size >= 2 && (pm(t) < 0 || (t.tf === 0 && t.match.size >= 3)))
    .sort((a, b) => pm(a.t) - pm(b.t) || b.t.ids.length - a.t.ids.length || b.t.einsaetze.size - a.t.einsaetze.size)) : [];

  // 6) Personen: Plus/Minus, Punkte, Linie-1-Anteil, Einsätze, Partner
  const P2 = new Map();
  const person = id => {
    let x = P2.get(id);
    if (!x) P2.set(id, x = { id, einsaetze: new Set(), matches: new Set(), linien: 0, linie1: 0, plus: 0, minus: 0, pkt: 0, tf: 0, mit: new Map() });
    return x;
  };
  for (const e of baum) for (const v of e.varianten) for (const l of v.linien) {
    if (l.art !== 'linie') continue;
    const ids = l.linien_spieler.map(r => r.kader_id).filter(id => id && aktiv.has(id));
    const st = stat.get(l.id);
    for (const id of ids) {
      const x = person(id);
      x.einsaetze.add(e.id); if (e.typ === 'match') x.matches.add(e.id);
      x.linien++; if (l.nr === 1) x.linie1++;
      if (st) { x.plus += st.plus; x.minus += st.minus; x.tf += st.tf; x.pkt += st.pkt.filter(k => k === id).length; }
      for (const j of ids) if (j !== id) x.mit.set(j, (x.mit.get(j) || 0) + 1);
    }
  }
  for (const id of aktiv) person(id);   // auch wer noch nie eingeteilt war
  const leute = [...P2.values()];
  const geheim = leute
    .filter(x => x.matches.size >= 2 && (pm(x) > 0 || x.pkt > 0) && x.linie1 / Math.max(1, x.linien) < 0.5)
    .map(x => ({ ...x, wert: (pm(x) + x.pkt) / x.matches.size }))
    .sort((a, b) => b.wert - a.wert);
  const maxE = Math.max(1, ...leute.map(x => x.einsaetze.size));
  const wenig = leute.filter(x => x.einsaetze.size <= maxE * 0.4).sort((a, b) => a.einsaetze.size - b.einsaetze.size);

  return { neuKombis, bau, mehr, frisch, harzt, geheim, wenig, leute, hatStat, hatPm, anzahl: R.anzahlEinsaetze };
}

// ---- Darstellung -----------------------------------------------
export function zeichneIdeen(ziel, baum, { kMap, kurz, personen }) {
  const aktiv = new Set(personen.filter(k => k.aktiv).map(k => k.id));
  const name = id => {
    const k = kMap.get(id);
    return k ? `${k.nummer != null ? `<b>${k.nummer}</b> ` : ''}${esc(kurz.get(id) ?? k.name)}` : '?';
  };
  const chips = (ids, rollen) => {
    const ord = rollen ? [...ids].sort((a, b) => (rollen[a] === 'V' ? 0 : rollen[a] === 'S' ? 2 : 1) - (rollen[b] === 'V' ? 0 : rollen[b] === 'S' ? 2 : 1)) : ids;
    return ord.map(id => `<span class="aw-p ${rollen ? 'r-' + (rollen[id] || 'S') : ''}">${name(id)}</span>`).join('');
  };
  const pmText = t => (t.plus || t.minus) ? `± ${pm(t) > 0 ? '+' : pm(t) < 0 ? '−' : ''}${Math.abs(pm(t))}` : '';
  const zahlen = t => [`${t.einsaetze.size}× zusammen`, t.tf ? `⚽ ${t.tf}` : '', t.pkt ? `🎯 ${t.pkt}` : '', pmText(t)].filter(Boolean).join(' · ');
  const datumKurz = d => { const [y, m, t] = d.split('-').map(Number); return `${t}.${m}.`; };

  const karte = (titel, gruende, badge = '', cls = '') => `<li class="aw-zeile id-karte ${cls}">
      <div class="aw-haupt"><div class="aw-namen">${titel}</div>${gruende.filter(Boolean).map(g => `<div class="aw-info">${g}</div>`).join('')}</div>
      ${badge ? `<div class="id-badge">${badge}</div>` : ''}</li>`;

  function block(key, titel, erkl, liste, render, leer) {
    const offen = S.offen.has(key);
    const zeigen = offen ? liste : liste.slice(0, ZEIGE);
    return `<section class="aw-block">
      <h3 class="gruppe">${titel} ${liste.length ? `<span>${liste.length}</span>` : ''}</h3>
      <p class="muted klein aw-erkl">${erkl}</p>
      ${liste.length ? `<ul class="aw-liste">${zeigen.map(render).join('')}</ul>
        ${liste.length > ZEIGE ? `<button class="btn ghost small aw-mehr" data-k="${key}">${offen ? '▲ Weniger anzeigen' : `▼ Alle ${liste.length} anzeigen`}</button>` : ''}`
        : `<p class="muted klein aw-leer">${leer}</p>`}
    </section>`;
  }

  function zeichne() {
    const I = ideen(baum, aktiv);
    if (!I.anzahl) { ziel.innerHTML = '<p class="muted pad leer">Noch keine Einsätze mit eingeteilten Personen – sobald Linien erfasst sind, gibt es hier Ideen.</p>'; return; }

    const hinweis = !I.hatPm ? `<div class="id-hinweis">ℹ️ <b>Plus/Minus fehlt noch.</b> Sobald ihr in der Match-Statistik bei Toren und Gegentoren die Linie auf dem Feld erfasst, werden die Vorschläge deutlich besser. Bis dahin zählen ${I.hatStat ? 'Häufigkeit, Tore und Skorerpunkte' : 'vor allem die Häufigkeit'}.</div>` : '';

    const p = S.person && I.leute.find(x => x.id === S.person);
    const nieListe = p ? I.leute.filter(x => x.id !== p.id && aktiv.has(x.id))
      .map(x => ({ x, n: p.mit.get(x.id) || 0 })).filter(y => y.n <= 1)
      .sort((a, b) => a.n - b.n || (kMap.get(a.x.id)?.nummer ?? 999) - (kMap.get(b.x.id)?.nummer ?? 999)) : [];

    ziel.innerHTML = `
      <p class="summary muted">Vorschläge aus euren Aufstellungen${I.hatStat ? ' und der Match-Statistik' : ''} – zum Ausprobieren, nicht als Muss.</p>
      ${hinweis}

      ${block('neu', '🧪 Neue Kombis zum Ausprobieren',
        'Starke Verteidigerpaare mit starken Sturmtrios, die noch nie (oder erst 1×) zusammen auf dem Feld standen.',
        I.neuKombis, x => karte(
          `<span class="aw-gruppe">${chips(x.paar.ids)}</span><span class="aw-plus">+</span><span class="aw-gruppe">${chips(x.trio.ids)}</span>`,
          [`🛡️ Paar: ${zahlen(x.paar)}`, `⚡ Trio: ${zahlen(x.trio)}`],
          x.zusammen ? '1× getestet' : '✦ neu'),
        'Noch zu wenig Daten – es braucht ein paar Einsätze mit Verteidigerpaaren und Sturmtrios.')}

      ${block('bau', '🧩 Test-Aufstellung',
        'Ganze Aufstellung aus den besten Paaren und Trios – niemand doppelt. Kombis, die schon zusammen gespielt haben, werden bevorzugt.',
        I.bau, (b, i) => karte(
          `<span class="aw-rang">Linie ${i + 1}</span><span class="aw-gruppe">${chips(b.paar.ids)}</span><span class="aw-plus">+</span><span class="aw-gruppe">${chips(b.trio.ids)}</span>`,
          [b.zusammen ? `✔ So schon ${zahlen(b.zusammen)}` : '✦ In dieser Kombination noch nie zusammen'],
          b.zusammen ? `${b.zusammen.einsaetze.size}×` : 'neu', b.zusammen ? '' : 'id-neu'),
        'Noch zu wenig Paare und Trios erfasst.')}
      ${I.bau.length && I.bau.length < 3 ? `<p class="aw-hinweis">Mehr Linien gehen nicht ohne Überschneidung${I.hatPm ? ' bzw. ohne Paare/Trios mit negativem Plus/Minus' : ''}.</p>` : ''}

      ${block('mehr', '🌱 Verdient mehr Einsätze',
        'Selten zusammen (höchstens 3×), aber in dieser kurzen Zeit mit Toren, Skorerpunkten oder positivem Plus/Minus.',
        I.mehr, x => karte(`<span class="id-art">${x.art}</span>${chips(x.t.ids, x.t.rollen && Object.keys(x.t.rollen).length ? x.t.rollen : null)}`,
          [zahlen(x.t)], pmText(x.t) || `⚽ ${x.t.tf}`),
        I.hatStat ? 'Im Moment nichts – seltene Kombis haben noch keine Tore oder Plus/Minus.' : 'Braucht Daten aus der Match-Statistik.')}

      ${block('frisch', '🆕 Frisch getestet',
        `Kombis, die erst in den letzten ${FRISCH_TAGE} Tagen dazugekommen sind – so läuft es bisher.`,
        I.frisch, x => karte(`<span class="id-art">${x.art}</span>${chips(x.t.ids, x.t.rollen && Object.keys(x.t.rollen).length ? x.t.rollen : null)}`,
          [`seit ${datumKurz(x.seit)} · ${zahlen(x.t)}`], pmText(x.t)),
        'Noch keine neuen Kombis in den letzten Wochen (oder noch zu wenig Historie).')}

      ${I.hatStat ? block('harzt', '⚠️ Läuft (noch) nicht',
        'Oft zusammen, aber in den Matches mit negativem Plus/Minus oder ohne Tor – vielleicht lohnt sich ein Wechsel.',
        I.harzt, x => karte(`<span class="id-art">${x.art}</span>${chips(x.t.ids, x.t.rollen && Object.keys(x.t.rollen).length ? x.t.rollen : null)}`,
          [`${zahlen(x.t)} · davon ${x.t.match.size} Matches`], pmText(x.t) || '0 Tore', 'id-warn'),
        'Nichts Auffälliges. 👍') : ''}

      ${block('geheim', '💎 Geheimtipps',
        'Gutes Plus/Minus oder viele Skorerpunkte pro Match – stehen aber selten in Linie 1.',
        I.geheim, x => karte(chips([x.id]),
          [`${pmText(x) || '± 0'} · 🎯 ${x.pkt} Skorerpunkte in ${x.matches.size} Matches`, `nur ${x.linie1} von ${x.linien}× in Linie 1`],
          `${x.wert > 0 ? '+' : ''}${x.wert.toFixed(1)}<small>/Match</small>`),
        I.hatPm || I.hatStat ? 'Im Moment keine – wer stark ist, steht schon in Linie 1.' : 'Braucht Plus/Minus oder Skorerpunkte aus der Match-Statistik.')}

      ${block('wenig', '🙋 Wenig eingeteilt',
        'Aktive Feldspieler:innen mit deutlich weniger Einsätzen als die anderen – vielleicht mal eine Chance geben.',
        I.wenig, x => karte(chips([x.id]), [x.einsaetze.size ? `${x.einsaetze.size} Einsätze` : 'noch nie eingeteilt'], `${x.einsaetze.size}×`),
        'Alle kommen ähnlich oft zum Einsatz. 👍')}

      <section class="aw-block">
        <h3 class="gruppe">🤝 Noch nie zusammen</h3>
        <p class="muted klein aw-erkl">Person wählen: mit wem stand sie noch nie (oder erst 1×) in derselben Linie?</p>
        <label class="id-wahl">Person<select class="id-person"><option value="">– wählen –</option>
          ${personen.filter(k => k.aktiv).map(k => `<option value="${k.id}" ${S.person === k.id ? 'selected' : ''}>${k.nummer != null ? k.nummer + ' ' : ''}${esc(k.name)}</option>`).join('')}</select></label>
        ${p ? (nieListe.length ? `<div class="id-nie">${nieListe.map(y => `<span class="aw-p ${y.n ? 'id-1x' : ''}">${name(y.x.id)}${y.n ? ' <small>1×</small>' : ''}</span>`).join('')}</div>`
          : '<p class="muted klein aw-leer">Hat schon mit allen mehrfach zusammen gespielt.</p>') : ''}
      </section>`;

    ziel.querySelector('.id-person').onchange = e => { S.person = e.target.value; zeichne(); };
    ziel.querySelectorAll('.aw-mehr').forEach(b => b.onclick = () => {
      S.offen.has(b.dataset.k) ? S.offen.delete(b.dataset.k) : S.offen.add(b.dataset.k); zeichne();
    });
  }
  zeichne();
}
