// ============================================================
//  Analyse: Rechenlogik ohne Oberfläche (Torzeiten, Matchverlauf, Saison)
//  Grundlage sind die Ereignisse aus der Statistik (match_ereignisse).
// ============================================================
import * as L from './statistik-logik.js';

export const BUCKET = 300;   // 5 Minuten

const istTor = e => e.art === 'tor' || e.art === 'gegentor';
const nachZeit = (a, b) => a.zeit - b.zeit;
export const toreVon = m => (m.match_ereignisse || []).filter(istTor).sort(nachZeit);
export const hatTore = m => toreVon(m).length > 0;

// Resultat: aus Einsatz, sonst aus den erfassten Toren
export function resultat(m) {
  if (m.tore_fuer != null && m.tore_gegen != null) return { f: m.tore_fuer, g: m.tore_gegen };
  const t = toreVon(m);
  if (!t.length) return null;
  return { f: t.filter(e => e.art === 'tor').length, g: t.filter(e => e.art === 'gegentor').length };
}
export const ergebnis = r => !r ? null : r.f > r.g ? 's' : r.f < r.g ? 'n' : 'u';

// Häufigstes Format (Abschnitte × Minuten) für Achsen
function format(matches) {
  const z = new Map();
  for (const m of matches) {
    const k = `${L.abschnittZahl(m)}x${L.abschnittMin(m)}`;
    z.set(k, (z.get(k) || 0) + 1);
  }
  const [best] = [...z.entries()].sort((a, b) => b[1] - a[1])[0] || ['3x20'];
  const [abschnitte, abschnitt_min] = best.split('x').map(Number);
  return { abschnitte, abschnitt_min, gemischt: z.size > 1 };
}

// ---- Wann fallen die Tore? -----------------------------------
// Rückgabe: { buckets: [{von, bis, f, g}], v: {f, g} (Verlängerung), frueh/spaet: {f, g} (erste/letzte 5 Min eines Abschnitts),
//            abschnitte: Map(n|'V' → {f, g}), grenzen: [sek], format, matches }
export function torZeiten(matches) {
  const mit = matches.filter(hatTore);
  const fmt = format(mit);
  const lang = Math.max(L.spielSek(fmt), ...mit.map(L.spielSek));
  const buckets = Array.from({ length: Math.ceil(lang / BUCKET) }, (_, i) => ({ von: i * BUCKET, bis: (i + 1) * BUCKET, f: 0, g: 0 }));
  const R = { buckets, v: { f: 0, g: 0 }, frueh: { f: 0, g: 0 }, spaet: { f: 0, g: 0 }, abschnitte: new Map(),
    grenzen: [], format: fmt, matches: mit.length };
  for (let i = 1; i < fmt.abschnitte; i++) R.grenzen.push(i * fmt.abschnitt_min * 60);
  for (const m of mit) {
    const absLen = L.abschnittMin(m) * 60;
    for (const e of toreVon(m)) {
      const k = e.art === 'tor' ? 'f' : 'g';
      const a = L.abschnittVon(e.zeit, m);
      const x = R.abschnitte.get(a) || { f: 0, g: 0 }; x[k]++; R.abschnitte.set(a, x);
      if (a === 'V') { R.v[k]++; continue; }
      buckets[Math.min(buckets.length - 1, Math.floor(e.zeit / BUCKET))][k]++;
      const inAbs = e.zeit - (a - 1) * absLen;
      if (inAbs < 300) R.frueh[k]++;
      if (inAbs >= absLen - 300) R.spaet[k]++;
    }
  }
  return R;
}

// ---- Reaktion: Antwort nach Gegentor, Konter nach eigenem Tor --
export function reaktion(matches, antwortSek = 300, sofortSek = 120) {
  const R = { gegentore: 0, antwort: 0, tore: 0, sofortGegen: 0 };
  for (const m of matches) {
    const t = toreVon(m);
    t.forEach((e, i) => {
      const danach = t.slice(i + 1);
      if (e.art === 'gegentor') {
        R.gegentore++;
        if (danach.some(x => x.art === 'tor' && x.zeit - e.zeit <= antwortSek)) R.antwort++;
      } else {
        R.tore++;
        if (danach.some(x => x.art === 'gegentor' && x.zeit - e.zeit <= sofortSek)) R.sofortGegen++;
      }
    });
  }
  return R;
}

// ---- Tore nach Situation (Gleichzahl, PP, BP, …) ---------------
export function nachSituation(matches) {
  const M = new Map();
  for (const m of matches) {
    const ev = m.match_ereignisse || [];
    if (!ev.some(istTor)) continue;
    const { sit } = L.zeitleiste(ev);
    for (const e of ev.filter(istTor)) {
      const s = sit.get(e.id) || 'eq';
      const x = M.get(s) || { f: 0, g: 0 };
      x[e.art === 'tor' ? 'f' : 'g']++; M.set(s, x);
    }
  }
  return M;
}

// ---- Verlauf eines Matches ------------------------------------
// Rückgabe: { ende, punkte: [{t, f, g, e, sit}], phasen: [{von, bis, z}], zeit: {vorne, gleich, hinten},
//            maxVorne, maxHinten, erstes: 'tor'|'gegentor'|null, grenzen: [sek] }
export function matchVerlauf(m) {
  const ev = m.match_ereignisse || [];
  const tore = toreVon(m);
  const ende = Math.max(L.spielSek(m), ...ev.map(e => e.zeit));
  const Z = L.zeitleiste(ev);
  let f = 0, g = 0, seit = 0, maxVorne = 0, maxHinten = 0;
  const zeit = { vorne: 0, gleich: 0, hinten: 0 };
  const stand = () => f > g ? 'vorne' : f < g ? 'hinten' : 'gleich';
  const punkte = [];
  for (const e of tore) {
    zeit[stand()] += e.zeit - seit; seit = e.zeit;
    e.art === 'tor' ? f++ : g++;
    maxVorne = Math.max(maxVorne, f - g); maxHinten = Math.max(maxHinten, g - f);
    punkte.push({ t: e.zeit, f, g, e, sit: Z.sit.get(e.id) || 'eq' });
  }
  zeit[stand()] += ende - seit;
  const phasen = [];
  Z.wechsel.forEach((w, i) => {
    if (w.z === 'eq') return;
    const bis = Z.wechsel[i + 1]?.t ?? ende;
    if (bis > w.t) phasen.push({ von: w.t, bis: Math.min(bis, ende), z: w.z });
  });
  const grenzen = [];
  for (let i = 1; i < L.abschnittZahl(m); i++) grenzen.push(i * L.abschnittMin(m) * 60);
  return { ende, punkte, phasen, zeit, maxVorne, maxHinten, erstes: tore[0]?.art ?? null, grenzen };
}

// ---- Saison: Form, Spielstand, erstes Tor, Comebacks ----------
export function saisonBilanz(matches) {
  const leer = () => ({ s: 0, u: 0, n: 0 });
  const R = {
    form: [],                                   // chronologisch: {m, r, erg, diff}
    erstesTor: leer(), erstesGegentor: leer(),
    zeit: { vorne: 0, gleich: 0, hinten: 0 },
    comebacks: [], verspielt: [],
    groessteFuehrung: null, groessterRueckstand: null,
    ort: { heim: leer(), auswaerts: leer() },
    verlaufMatches: 0,
  };
  const chrono = [...matches].sort((a, b) => a.datum.localeCompare(b.datum) || String(a.erstellt_am).localeCompare(String(b.erstellt_am)));
  for (const m of chrono) {
    const r = resultat(m), erg = ergebnis(r);
    if (erg) {
      R.form.push({ m, r, erg, diff: r.f - r.g });
      if (R.ort[m.ort]) R.ort[m.ort][erg]++;
    }
    if (!hatTore(m)) continue;
    const v = matchVerlauf(m);
    R.verlaufMatches++;
    for (const k of ['vorne', 'gleich', 'hinten']) R.zeit[k] += v.zeit[k];
    if (erg && v.erstes === 'tor') R.erstesTor[erg]++;
    if (erg && v.erstes === 'gegentor') R.erstesGegentor[erg]++;
    if (erg === 's' && v.maxHinten > 0) R.comebacks.push({ m, rueckstand: v.maxHinten });
    if (erg && erg !== 's' && v.maxVorne > 0) R.verspielt.push({ m, fuehrung: v.maxVorne });
    if (v.maxVorne && (!R.groessteFuehrung || v.maxVorne > R.groessteFuehrung.n)) R.groessteFuehrung = { m, n: v.maxVorne };
    if (v.maxHinten && (!R.groessterRueckstand || v.maxHinten > R.groessterRueckstand.n)) R.groessterRueckstand = { m, n: v.maxHinten };
  }
  return R;
}
