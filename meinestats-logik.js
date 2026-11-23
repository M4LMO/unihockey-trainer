// ============================================================
//  Meine Stats – Rechnen (ohne Oberfläche, testbar mit node)
// ============================================================

export const BEREICHE = {
  trainer: { name: 'Trainer', icon: '🎽', lang: 'Als Trainer' },
  spieler: { name: 'Spieler', icon: '🥅', lang: 'Als Spieler (Goalie)' },
  fan:     { name: 'Fan',     icon: '👀', lang: 'Als Fan' },
};

export const SPIELARTEN = {
  meisterschaft: 'Meisterschaft',
  cup: 'Cup',
  test: 'Testspiel',
  turnier: 'Turnier',   // seit SQL 20 ohne Unterscheidung Gruppe/K.o. (steht in der Notiz)
  playoff: 'Playoff',
  abstieg: 'Auf-/Abstieg',
  laenderspiel: 'Länderspiel',
};

export const ICH = {
  trainer: { dabei: 'Dabei', nicht: 'Nicht dabei' },
  spieler: { tor: 'Im Tor', ersatz: 'Ersatz (Matchblatt)', nicht: 'Nicht dabei' },
};

// Wie wird gezählt?
//  meine:  Trainer «dabei», Spieler «im Tor», Fan alle
//  blatt:  zusätzlich Spieler als Ersatz auf dem Matchblatt
//  alle:   alle Spiele des Teams (auch ohne mich)
export const MODI = {
  meine: 'Nur meine Spiele (Trainer dabei / im Tor)',
  blatt: 'Inkl. Ersatz auf dem Matchblatt',
  alle: 'Alle Spiele des Teams',
};

export function zaehlt(spiel, bereich, modus = 'meine') {
  if (spiel.abgesagt) return false;
  if (bereich === 'fan' || modus === 'alle') return true;
  if (bereich === 'trainer') return spiel.ich !== 'nicht';
  if (modus === 'blatt') return spiel.ich === 'tor' || spiel.ich === 'ersatz';
  return spiel.ich === 'tor';
}

// Text für Suche vergleichbar machen: klein, ohne Akzente, ohne Satzzeichen
export function norm(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Vereine suchen (nach Name). Treffer am Wortanfang zuerst.
export function sucheVereine(vereine, text, max = 8) {
  const q = norm(text);
  if (!q) return [];
  const punkte = v => {
    const x = norm(v.name);
    return x === q ? 4 : x.startsWith(q) ? 3 : (' ' + x).includes(' ' + q) ? 2 : x.includes(q) ? 1 : 0;
  };
  return vereine.map(v => [v, punkte(v)]).filter(([, p]) => p > 0)
    .sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name, 'de'))
    .slice(0, max).map(([v]) => v);
}
// Genau dieser Name?
export function findeVerein(vereine, text) {
  const q = norm(text);
  if (!q) return null;
  return vereine.find(v => norm(v.name) === q) || null;
}

export const halleText = h => h ? (h.name ? `${h.ort}, ${h.name}` : h.ort) : '';
export function sucheHallen(hallen, text, max = 8) {
  const q = norm(text);
  if (!q) return [];
  return hallen.map(h => {
    const x = norm(halleText(h));
    const p = x === q ? 4 : x.startsWith(q) ? 3 : norm(h.name).startsWith(q) ? 3 : (' ' + x).includes(' ' + q) ? 2 : x.includes(q) ? 1 : 0;
    return [h, p];
  }).filter(([, p]) => p > 0)
    .sort((a, b) => b[1] - a[1] || halleText(a[0]).localeCompare(halleText(b[0]), 'de'))
    .slice(0, max).map(([h]) => h);
}
export function findeHalle(hallen, text) {
  const q = norm(text);
  return q ? hallen.find(h => norm(halleText(h)) === q) || null : null;
}
// «Konolfingen, SLM Arena» → { ort, name }
export function teileHalle(text) {
  const t = String(text || '').trim();
  const i = t.indexOf(',');
  return i < 0 ? { ort: t, name: '' } : { ort: t.slice(0, i).trim(), name: t.slice(i + 1).trim() };
}

// Resultat aus meiner Sicht: 's' | 'u' | 'n' | null
export function ergebnis(sp) {
  if (sp.abgesagt || sp.tore1 == null || sp.tore2 == null) return null;
  return sp.tore1 > sp.tore2 ? 's' : sp.tore1 < sp.tore2 ? 'n' : 'u';
}
export function resultatText(sp) {
  if (sp.tore1 == null || sp.tore2 == null) return '';
  return `${sp.tore1}:${sp.tore2}${sp.entscheid === 'nv' ? ' n.V.' : sp.entscheid === 'np' ? ' n.P.' : ''}`;
}

// Saison/Jahr sortierbar machen: "2023/24" → 2023, "23/24" → 2023.
// Turnierjahr (z.B. Prague Games "2026", im Sommer) zählt zur Saison, die dann beginnt → 2026 (= 2026/27)
export function saisonSchluessel(s) {
  const t = String(s || '');
  let m = /^(\d{4})\s*\/\s*\d{2,4}/.exec(t);
  if (m) return +m[1];
  m = /^(\d{2})\s*\/\s*\d{2}$/.exec(t);
  if (m) return 2000 + +m[1];
  m = /(\d{4})/.exec(t);
  return m ? +m[1] : 0;
}
// Einheitlicher Saison-Name für Filter: "2026" → "2026/27", "23/24" → "2023/24"
export function saisonName(s) {
  const k = saisonSchluessel(s);
  return k ? `${k}/${String((k + 1) % 100).padStart(2, '0')}` : String(s || '');
}
// Aktuelle Saison (Saisonwechsel am 1. Juli wie in kontext.js): November 2026 → 2026 (= 2026/27)
export function aktuelleSaison(jetzt = new Date()) {
  return jetzt.getMonth() >= 6 ? jetzt.getFullYear() : jetzt.getFullYear() - 1;
}
// Werdegang: wie viele Saisons gespielt, seit wann, die wievielte Saison läuft
//   junioren/aktiv = Listen mit { saison } ; eine Saison in beiden Bereichen zählt einmal
//   Die Einstiegs-Saison war nicht komplett → zählt weder bei «x. Saison» noch bei «Saisons gespielt»
//   (laufende Saison zählt mit, sobald sie eingetragen ist)
export function laufbahn(junioren, aktiv, jetzt = new Date()) {
  const keys = l => new Set(l.map(x => saisonSchluessel(x.saison)).filter(Boolean));
  const j0 = keys(junioren), a0 = keys(aktiv), alle0 = new Set([...j0, ...a0]);
  if (!alle0.size) return null;
  const start = Math.min(...alle0), jetztS = aktuelleSaison(jetzt);
  const ohneStart = m => new Set([...m].filter(k => k !== start));
  const j = ohneStart(j0), a = ohneStart(a0), alle = ohneStart(alle0);
  return {
    start, startName: saisonName(String(start)),
    gespielt: alle.size, junioren: j.size, aktiv: a.size, beide: [...j].filter(k => a.has(k)).length,
    aktuellName: saisonName(String(jetztS)),
    komplett: jetztS - start,
  };
}
// Abschnitte: neueste zuerst
export function sortiereAbschnitte(liste) {
  return [...liste].sort((a, b) => saisonSchluessel(b.saison) - saisonSchluessel(a.saison)
    || String(a.kategorie || '').localeCompare(String(b.kategorie || ''), 'de')
    || String(a.erstellt_am || '').localeCompare(String(b.erstellt_am || '')));
}
// Spiele: nach Datum/Zeit, ohne Datum (z.B. abgesagt) ans Ende
export function sortiereSpiele(liste) {
  return [...liste].sort((a, b) => {
    if (!a.datum !== !b.datum) return a.datum ? -1 : 1;
    return String(a.datum || '').localeCompare(String(b.datum || ''))
      || String(a.zeit || '').localeCompare(String(b.zeit || ''))
      || String(a.erstellt_am || '').localeCompare(String(b.erstellt_am || ''));
  });
}

// Bilanz einer Liste eigener Spiele (nur Spiele mit Resultat)
export function bilanz(spiele) {
  const b = { sp: 0, s: 0, u: 0, n: 0, snv: 0, nnv: 0, t: 0, gt: 0, zuNull: 0, offen: 0 };
  for (const x of spiele) {
    const e = ergebnis(x);
    if (!e) { if (!x.abgesagt) b.offen++; continue; }
    b.sp++; b[e]++;
    if (x.entscheid && e === 's') b.snv++;
    if (x.entscheid && e === 'n') b.nnv++;
    b.t += x.tore1; b.gt += x.tore2;
    if (x.tore2 === 0) b.zuNull++;
  }
  b.quote = b.sp ? Math.round(100 * b.s / b.sp) : 0;
  b.schnittT = b.sp ? b.t / b.sp : 0;
  b.schnittGT = b.sp ? b.gt / b.sp : 0;
  return b;
}

// Schlussrang aus der Rangtabelle (Zeile «eigenes»)
export function schlussrang(tabellenZeilen, abschnittId) {
  const zeilen = tabellenZeilen.filter(z => z.abschnitt_id === abschnittId);
  const eigene = zeilen.filter(z => z.eigenes && z.rang != null);
  return eigene.map(z => ({ titel: z.titel, rang: z.rang, von: zeilen.filter(x => x.titel === z.titel).length }));
}

// Gegner-Bilanz über alle eigenen Spiele (nach Verein)
//   gruppe(id) → unter welchem Verein zusammengefasst wird (z.B. heutiger Verein nach Fusion)
//   teile = Bilanz pro ursprünglichem Verein (nur wenn mehrere)
export function gegnerBilanz(spiele, gruppe = id => id) {
  const map = new Map();
  for (const x of spiele) {
    if (!x.gegner_id) continue;
    const k = gruppe(x.gegner_id);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(x);
  }
  return [...map.entries()].map(([id, liste]) => {
    const sortiert = sortiereSpiele(liste);
    const ids = [...new Set(liste.map(x => x.gegner_id))];
    const teile = ids.length > 1 ? ids.map(t => { const l = liste.filter(x => x.gegner_id === t); return { id: t, anzahl: l.length, ...bilanz(l) }; }) : [];
    return { id, spiele: sortiert, ...bilanz(liste), anzahl: liste.length, teile, letztes: sortiert.filter(s => s.datum).at(-1)?.datum || null };
  });
}

// Fusionen: Verein → heutiger Verein (Kette nachfolger_id folgen, ohne Endlosschleife)
export function heutigerVerein(vMap, id) {
  let akt = id;
  for (let i = 0; i < 10; i++) {
    const n = vMap.get(akt)?.nachfolger_id;
    if (!n || n === id || !vMap.has(n)) break;
    akt = n;
  }
  return akt;
}

// Zählen nach Schlüssel (z.B. Halle, Liga) → [{ key, n }] absteigend
export function zaehle(liste, keyFn) {
  const m = new Map();
  for (const x of liste) {
    const k = keyFn(x);
    if (k == null || k === '') continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n || String(a.key).localeCompare(String(b.key), 'de'));
}

// Alter in Jahren/Monaten/Tagen ist bewusst nicht drin (kein Geburtsdatum gespeichert).

// Datum "2026-11-08" → "Sa 8.11.26"
const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export function datumKurz(d, mitTag = true) {
  if (!d) return '';
  const [y, m, t] = d.split('-').map(Number);
  return `${mitTag ? WT[new Date(y, m - 1, t).getDay()] + ' ' : ''}${t}.${m}.${String(y).slice(2)}`;
}
export function datumLang(d) {
  if (!d) return '';
  const [y, m, t] = d.split('-').map(Number);
  return `${t}.${m}.${y}`;
}
export const zeitKurz = z => z ? String(z).slice(0, 5) : '';
export const zahl1 = x => (Math.round(x * 100) / 100).toLocaleString('de-CH', { maximumFractionDigits: 2 });
