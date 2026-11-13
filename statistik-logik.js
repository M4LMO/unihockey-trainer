// ============================================================
//  Statistik: Rechenlogik ohne Oberfläche
//  (wird von statistik.js und später von der Linien-Auswertung genutzt)
// ============================================================

export const IMPORT_FORMAT = 'unihockey-statistik-1';

export const SITUATION = {
  eq: { kurz: 'EQ', text: 'Gleichzahl' },
  pp: { kurz: 'PP', text: 'Powerplay' },
  bp: { kurz: 'BP', text: 'Boxplay' },
  '6v5': { kurz: '6:5', text: 'ohne eigenen Goalie' },
  '5v6': { kurz: '5:6', text: 'Gegner ohne Goalie' },
  pen: { kurz: 'Pen', text: 'Penalty' },
};
export const ART = {
  tor:          { text: 'Tor',          icon: '🟢' },
  gegentor:     { text: 'Gegentor',     icon: '🔴' },
  strafe:       { text: 'Strafe',       icon: '🟨' },
  gegnerstrafe: { text: 'Gegner-Strafe', icon: '🟧' },
  goalie:       { text: 'Goalie-Wechsel', icon: '🥅' },
};
export const MINUTEN = ['2', '2+2', '5', '10', '2+10', 'MS'];

// ---- Zeit ------------------------------------------------------
export function zeitText(sek) {
  if (sek == null) return '';
  return `${String(Math.floor(sek / 60)).padStart(2, '0')}:${String(sek % 60).padStart(2, '0')}`;
}
export function parseZeit(t) {
  if (typeof t === 'number') return Math.max(0, Math.round(t));
  const m = /^\s*(\d{1,3})\s*[:.']\s*(\d{1,2})\s*$/.exec(String(t ?? ''));
  if (!m || +m[2] > 59) return null;
  return +m[1] * 60 + +m[2];
}

// Spiellänge und Abschnitt (Drittel / Halbzeit)
export const abschnittMin = e => e?.abschnitt_min || 20;
export const abschnittZahl = e => e?.abschnitte || 3;
export const spielSek = e => abschnittZahl(e) * abschnittMin(e) * 60;
export function abschnittVon(sek, e) {
  const n = Math.floor(sek / (abschnittMin(e) * 60)) + 1;
  return n > abschnittZahl(e) ? 'V' : n;           // V = Verlängerung
}
export function abschnittName(n, e) {
  if (n === 'V') return 'Verlängerung';
  const z = abschnittZahl(e);
  return z === 3 ? `${n}. Drittel` : z === 2 ? `${n}. Halbzeit` : `${n}. Abschnitt`;
}

// ---- Strafen → Zeitabschnitte in Unterzahl ---------------------
// [Dauer in Sek, endet bei Gegentor?]
function strafTeile(min) {
  const m = String(min ?? '').trim().toUpperCase();
  if (m.startsWith('MS')) return [[300, false]];
  if (m === '10') return [];
  if (m === '5') return [[300, false]];
  if (m === '2+2') return [[120, true], [120, true]];
  if (m === '2' || m === '2+10') return [[120, true]];
  return [];
}
// Bringt die Strafe eine Unterzahl? (10' nicht)
export const strafeMitUnterzahl = min => strafTeile(min).length > 0;
// Einheitliche Schreibweise der Strafart (für Gruppierung)
export function strafArt(min) {
  const m = String(min ?? '').trim().toUpperCase().replace(/\s+/g, '').replace(/['’]/g, '');
  if (m.startsWith('MS')) return 'MS';
  return MINUTEN.includes(m) ? m : (m || '?');
}
export function strafMinuten(min) {
  const m = String(min ?? '').trim().toUpperCase();
  if (m.startsWith('MS')) return 25;   // Matchstrafe: Person 20 + Team 5 → für Statistik als 25 gezählt
  return m.split('+').map(Number).filter(n => !isNaN(n)).reduce((a, b) => a + b, 0);
}

// ---- Zeitleiste: Situation bei jedem Tor, PP/BP-Bilanz --------
// ereignisse: [{id, art, zeit, kader_id, situation, minuten}]
// Rückgabe: { sit: Map(id → situation), pp: {chancen, tore, gegentore, starts}, bp: {chancen, gegentore, tore, starts}, leer: {tore, gegentore},
//            folgen: Map(id eigene Strafe → Gegentore in Unterzahl, die dieser Strafe zugerechnet werden) }
// starts = Spielzeiten, an denen ein Powerplay/Boxplay begonnen hat
export function zeitleiste(ereignisse) {
  const liste = [...ereignisse].sort((a, b) => a.zeit - b.zeit || rang(a) - rang(b));
  const team = () => ({ aktiv: [] });   // aktiv: [{ende, frueh, rest:[[d,frueh]…]}]
  const eigen = team(), gegner = team();
  let goalieRaus = false;
  const sit = new Map();
  const folgen = new Map();
  const R = { pp: { chancen: 0, tore: 0, gegentore: 0, starts: [] }, bp: { chancen: 0, gegentore: 0, tore: 0, starts: [] }, leer: { tore: 0, gegentore: 0 } };
  let zustand = 'eq';

  const ablaufen = (t, s) => {
    let wechsel = true;
    while (wechsel) {
      wechsel = false;
      for (const p of s.aktiv) if (p.ende <= t) {
        const naechst = p.rest.shift();
        if (naechst) { p.ende += naechst[0]; p.frueh = naechst[1]; } else p.weg = true;
        wechsel = true;
      }
      s.aktiv = s.aktiv.filter(p => !p.weg);
    }
  };
  const anzahl = s => 5 - Math.min(2, s.aktiv.length);
  const berechne = () => {
    const e = anzahl(eigen), g = anzahl(gegner);
    return e > g ? 'pp' : e < g ? 'bp' : 'eq';
  };
  // t = Zeitpunkt des Wechsels (für die Zuordnung zur Linien-Version)
  const pruefeWechsel = (t = aktuelleZeit) => {
    const neu = berechne();
    if (neu !== zustand) {
      if (neu === 'pp') { R.pp.chancen++; R.pp.starts.push(t); }
      if (neu === 'bp') { R.bp.chancen++; R.bp.starts.push(t); }
      zustand = neu;
    }
  };
  // Nächstes Strafende vor t einzeln abarbeiten (damit Zustandswechsel gezählt werden)
  const bisZeit = t => {
    for (;;) {
      const enden = [...eigen.aktiv, ...gegner.aktiv].map(p => p.ende).filter(x => x <= t);
      if (!enden.length) break;
      const x = Math.min(...enden);
      ablaufen(x, eigen); ablaufen(x, gegner);
      pruefeWechsel(x);
    }
  };
  let aktuelleZeit = 0;
  const beendeFrueheste = s => {
    const p = s.aktiv.filter(x => x.frueh).sort((a, b) => a.ende - b.ende)[0];
    if (!p) return null;
    const naechst = p.rest.shift();
    if (naechst) { p.ende = aktuelleZeit + naechst[0]; p.frueh = naechst[1]; }   // 2+2: zweite Strafe beginnt jetzt
    else s.aktiv = s.aktiv.filter(x => x !== p);
    return p;
  };

  liste.forEach((ev, i) => {
    aktuelleZeit = ev.zeit;
    bisZeit(ev.zeit);
    if (ev.art === 'tor' || ev.art === 'gegentor') {
      const strafSit = berechne();
      let s = ev.situation || (goalieRaus && strafSit === 'eq' ? '6v5' : strafSit);
      if (!ev.situation && goalieRaus && strafSit !== 'eq') s = strafSit;   // Unterzahl hat Vorrang
      sit.set(ev.id, s);
      if (ev.art === 'tor') {
        if (s === 'pp') R.pp.tore++;
        if (s === 'bp') R.bp.tore++;
        if (strafSit === 'pp') beendeFrueheste(gegner);
      } else {
        if (s === 'bp') R.bp.gegentore++;
        if (s === 'pp') R.pp.gegentore++;
        if (goalieRaus) R.leer.gegentore++;
        if (strafSit === 'bp') {
          // Gegentor der Strafe zurechnen, die es beendet (2'), sonst der zuerst ablaufenden (5' / MS)
          const p = beendeFrueheste(eigen) || [...eigen.aktiv].sort((a, b) => a.ende - b.ende)[0];
          if (p?.id != null) folgen.set(p.id, (folgen.get(p.id) || 0) + 1);
        }
      }
      pruefeWechsel();
    } else if (ev.art === 'strafe' || ev.art === 'gegnerstrafe') {
      const teile = strafTeile(ev.minuten);
      if (teile.length) {
        const [d, frueh] = teile.shift();
        (ev.art === 'strafe' ? eigen : gegner).aktiv.push({ id: ev.id, ende: ev.zeit + d, frueh, rest: teile });
      }
      // Gleichzeitige Strafen beider Teams zuerst alle eintragen, dann prüfen
      const n = liste[i + 1];
      if (!(n && n.zeit === ev.zeit && (n.art === 'strafe' || n.art === 'gegnerstrafe'))) pruefeWechsel();
    } else if (ev.art === 'goalie') {
      goalieRaus = !ev.kader_id;
    }
  });
  return { sit, folgen, ...R };
}
// Bei gleicher Zeit: Tore vor Strafen, Goalie-Wechsel zuerst
const rang = e => e.art === 'goalie' ? 0 : (e.art === 'tor' || e.art === 'gegentor') ? 1 : 2;

// ---- Goalies: Spielzeit und Gegentore -------------------------
// Rückgabe: Map(kader_id → {sek, gegentore}) ; Schlüssel 'leer' = Tor leer
export function goalieBilanz(einsatz, aufstellung, ereignisse) {
  const goalies = aufstellung.filter(a => a.goalie);
  let drin = (goalies.find(a => a.start) || goalies[0])?.kader_id ?? null;
  const ende = Math.max(spielSek(einsatz), ...ereignisse.map(e => e.zeit));
  const M = new Map();
  const add = (k, f, n) => { const key = k ?? 'leer'; const x = M.get(key) || { sek: 0, gegentore: 0 }; x[f] += n; M.set(key, x); };
  let seit = 0;
  for (const ev of [...ereignisse].sort((a, b) => a.zeit - b.zeit || rang(a) - rang(b))) {
    if (ev.art === 'goalie') { add(drin, 'sek', ev.zeit - seit); seit = ev.zeit; drin = ev.kader_id || null; }
    if (ev.art === 'gegentor') add(drin, 'gegentore', 1);
  }
  add(drin, 'sek', ende - seit);
  if (drin == null && !M.get('leer')?.sek && !M.get('leer')?.gegentore) M.delete('leer');
  return M;
}

// ---- Welche Linien-Version gilt bei einem Ereignis? -----------
// Eine gesetzte Version gilt ab diesem Ereignis, bis eine andere gesetzt wird.
export function versionen(ereignisse, varianten) {
  const erste = [...varianten].sort((a, b) => a.nr - b.nr)[0]?.id ?? null;
  const M = new Map();
  let aktuell = erste;
  for (const ev of [...ereignisse].sort((a, b) => a.zeit - b.zeit || rang(a) - rang(b))) {
    if (ev.variante_id && varianten.some(v => v.id === ev.variante_id)) aktuell = ev.variante_id;
    M.set(ev.id, aktuell);
  }
  return M;
}

// ---- Namen vergleichen ----------------------------------------
export function normName(s) {
  return String(s ?? '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
}
// Swiss-Unihockey-Person → Kader-Person
// gemerkt: Map(normName → kader_id)
export function zuordnen(su, kader, gemerkt = new Map()) {
  const n = normName(su.name);
  const k = id => kader.find(x => x.id === id);
  if (n && gemerkt.has(n) && k(gemerkt.get(n))) return { kader_id: gemerkt.get(n), sicher: true, grund: 'gemerkt' };
  const gleicherName = kader.filter(x => normName(x.name) === n);
  const gleicheNr = su.nr != null ? kader.filter(x => x.nummer === su.nr) : [];
  const beides = gleicherName.filter(x => x.nummer === su.nr);
  if (beides.length === 1) return { kader_id: beides[0].id, sicher: true, grund: 'Nummer + Name' };
  if (gleicherName.length === 1) return { kader_id: gleicherName[0].id, sicher: true, grund: 'Name' };
  // Teilweise gleicher Name (z.B. nur Nachname + Nummer)
  const teile = new Set(n.split(' '));
  const aehnlich = gleicheNr.filter(x => normName(x.name).split(' ').some(t => t.length > 2 && teile.has(t)));
  if (aehnlich.length === 1) return { kader_id: aehnlich[0].id, sicher: true, grund: 'Nummer + Teil des Namens' };
  if (gleicheNr.length === 1) return { kader_id: gleicheNr[0].id, sicher: false, grund: 'nur Nummer – bitte prüfen' };
  return { kader_id: null, sicher: false, grund: 'nicht gefunden' };
}

// ---- Import-Text prüfen ---------------------------------------
export function parseImport(text) {
  let t = String(text ?? '').trim().replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('Kein Import-Text gefunden. Bitte den ganzen Block von Claude einfügen.');
  let d;
  try { d = JSON.parse(t.slice(a, b + 1)); } catch { throw new Error('Der Import-Text ist unvollständig oder beschädigt. Bitte nochmals ganz kopieren.'); }
  if (d.format && d.format !== IMPORT_FORMAT) throw new Error(`Unbekanntes Format „${d.format}“.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.datum || '')) throw new Error('Datum fehlt oder ist ungültig (JJJJ-MM-TT).');

  const nr = x => x == null || x === '' ? null : (Number.isInteger(+x) && +x >= 0 && +x <= 99 ? +x : null);
  const aufstellung = (d.aufstellung || []).map(p => ({
    nr: nr(p.nr), name: String(p.name || '').trim(), goalie: !!p.goalie, start: !!p.start,
  })).filter(p => p.name || p.nr != null);

  const fehler = [];
  const ereignisse = (d.ereignisse || []).map((e, i) => {
    const zeit = parseZeit(e.zeit);
    if (zeit == null) fehler.push(`Ereignis ${i + 1}: Zeit „${e.zeit}“ ungültig`);
    if (!ART[e.art]) fehler.push(`Ereignis ${i + 1}: Art „${e.art}“ unbekannt`);
    return {
      art: e.art, zeit: zeit ?? 0,
      nr: nr(e.nr), name: e.name ? String(e.name).trim() : null,
      assist_nr: nr(e.assist_nr), assist_name: e.assist_name ? String(e.assist_name).trim() : null,
      gegner_nr: nr(e.gegner_nr),
      minuten: e.minuten != null ? String(e.minuten) : null,
      grund: e.grund ? String(e.grund).trim() : null,
      situation: SITUATION[e.situation] ? e.situation : null,
    };
  });
  if (fehler.length) throw new Error(fehler.slice(0, 3).join(' · '));

  const tore = Array.isArray(d.tore) ? d.tore.map(x => x == null ? null : +x) : [null, null];
  return {
    datum: d.datum,
    ort: d.ort === 'heim' || d.ort === 'auswaerts' ? d.ort : null,
    gegner: d.gegner ? String(d.gegner).trim() : null,
    wettbewerb: ['meisterschaft', 'cup', 'test'].includes(d.wettbewerb) ? d.wettbewerb : null,
    liga: d.liga ? String(d.liga) : null,
    tore_fuer: Number.isInteger(tore[0]) ? tore[0] : ereignisse.filter(e => e.art === 'tor').length,
    tore_gegen: Number.isInteger(tore[1]) ? tore[1] : ereignisse.filter(e => e.art === 'gegentor').length,
    abschnitte: Number.isInteger(d.abschnitte) ? d.abschnitte : null,
    abschnitt_min: Number.isInteger(d.abschnitt_min) ? d.abschnitt_min : null,
    aufstellung, ereignisse,
  };
}

// ---- Saison-Statistik pro Person ------------------------------
// matches: [{…einsatz, match_aufstellung, match_ereignisse}]
// linienSpieler: Map(linie_id → Set(kader_id))
export function personenStatistik(matches, linienSpieler = new Map()) {
  const P = new Map();
  const p = id => {
    let x = P.get(id);
    if (!x) P.set(id, x = { sp: 0, t: 0, a: 0, pim: 0, ppT: 0, plus: 0, minus: 0, goalie: { sp: 0, sek: 0, gt: 0 } });
    return x;
  };
  let pmErfasst = 0, pmTotal = 0;
  for (const m of matches) {
    const ev = m.match_ereignisse || [], auf = m.match_aufstellung || [];
    auf.forEach(a => { if (!a.goalie) p(a.kader_id).sp++; });
    const { sit } = zeitleiste(ev);
    for (const e of ev) {
      if (e.art === 'tor') {
        if (e.kader_id) { p(e.kader_id).t++; if (sit.get(e.id) === 'pp') p(e.kader_id).ppT++; }
        if (e.assist_id) p(e.assist_id).a++;
      }
      if (e.art === 'strafe' && e.kader_id) p(e.kader_id).pim += strafMinuten(e.minuten);
      if (e.art === 'tor' || e.art === 'gegentor') {
        const s = sit.get(e.id);
        // Plus/Minus wie im Eishockey: PP-Tore geben kein +, Gegentore in Unterzahl kein −
        const zaehlt = e.art === 'tor' ? s !== 'pp' : s !== 'bp';
        if (zaehlt && s !== 'pen') {
          pmTotal++;
          const leute = e.linie_id ? linienSpieler.get(e.linie_id) : null;
          if (leute) { pmErfasst++; leute.forEach(id => { e.art === 'tor' ? p(id).plus++ : p(id).minus++; }); }
        }
      }
    }
    for (const [id, g] of goalieBilanz(m, auf, ev)) {
      if (id === 'leer' || !g.sek) continue;
      const x = p(id).goalie; x.sp++; x.sek += g.sek; x.gt += g.gegentore;
    }
  }
  return { P, pmErfasst, pmTotal };
}

// ---- Strafen-Auswertung (Register «Strafen») ------------------
// matches: [{…einsatz, match_ereignisse}]
// Rückgabe: {
//   total: {n, pim, mitUnterzahl, gegentore, matches},
//   arten: Map(art → n),
//   personen: Map(kader_id | null → {n, pim, gt, arten: Map, gruende: Map(grund-key → n)}),   null = ohne Person (Bank-/Teamstrafe)
//   gruende: Map(grund-key (klein) → {n, pim, text}),   '' = ohne Grund
//   abschnitte: Map(1|2|3|'V' → n), formate: Set(Anzahl Abschnitte),
//   spaet: n (letzte 5 Min eines Abschnitts), frueh: n (erste 5 Min),
//   proMatch: [{m, n, pim, gt}]
// }
export function strafenStatistik(matches) {
  const R = {
    total: { n: 0, pim: 0, mitUnterzahl: 0, gegentore: 0, matches: 0 },
    arten: new Map(), personen: new Map(), gruende: new Map(),
    abschnitte: new Map(), formate: new Set(), spaet: 0, frueh: 0, proMatch: [],
  };
  const plus = (map, key, n = 1) => map.set(key, (map.get(key) || 0) + n);
  for (const m of matches) {
    const ev = m.match_ereignisse || [];
    const strafen = ev.filter(e => e.art === 'strafe');
    const hatStatistik = !!(m.stat_am || ev.length);
    if (hatStatistik) { R.total.matches++; R.formate.add(abschnittZahl(m)); }
    if (!strafen.length) { if (hatStatistik) R.proMatch.push({ m, n: 0, pim: 0, gt: 0 }); continue; }
    const { folgen } = zeitleiste(ev);
    const pm = { m, n: 0, pim: 0, gt: 0 };
    const absLen = abschnittMin(m) * 60;
    for (const e of strafen) {
      const pim = strafMinuten(e.minuten), art = strafArt(e.minuten), gt = folgen.get(e.id) || 0;
      R.total.n++; R.total.pim += pim; R.total.gegentore += gt;
      if (strafeMitUnterzahl(e.minuten)) R.total.mitUnterzahl++;
      plus(R.arten, art);
      pm.n++; pm.pim += pim; pm.gt += gt;

      const key = e.kader_id || null;
      let p = R.personen.get(key);
      if (!p) R.personen.set(key, p = { n: 0, pim: 0, gt: 0, arten: new Map(), gruende: new Map() });
      p.n++; p.pim += pim; p.gt += gt; plus(p.arten, art);

      const text = String(e.grund ?? '').trim().replace(/\s+/g, ' ');
      const gKey = text.toLowerCase() || '';
      if (text) plus(p.gruende, gKey);   // Anzeige-Text über R.gruende.get(key).text
      const g = R.gruende.get(gKey) || { n: 0, pim: 0, text: text ? text.charAt(0).toUpperCase() + text.slice(1) : '' };
      g.n++; g.pim += pim; R.gruende.set(gKey, g);

      const a = abschnittVon(e.zeit, m);
      plus(R.abschnitte, a);
      if (a !== 'V') {
        const inAbs = e.zeit - (a - 1) * absLen;
        if (inAbs >= absLen - 300) R.spaet++;
        else if (inAbs < 300) R.frueh++;
      }
    }
    R.proMatch.push(pm);
  }
  return R;
}
