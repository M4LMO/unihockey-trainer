// ============================================================
//  Gemeinsame Daten für alle Tools: Saisons, Teams, Kaderlisten
//  und die aktuelle Auswahl (Saison + Team) auf diesem Gerät.
// ============================================================
import { sb } from './supabase.js';

const SPEICHER = 'tt-auswahl';

// Zuletzt gewählte Saison/Team merken (nur auf diesem Gerät)
export function getAuswahl() {
  try { return JSON.parse(localStorage.getItem(SPEICHER)) || {}; } catch { return {}; }
}
export function setAuswahl(neu) {
  try { localStorage.setItem(SPEICHER, JSON.stringify({ ...getAuswahl(), ...neu })); } catch {}
}

// Saisons (neueste zuerst), Teams (alphabetisch) und Kaderlisten laden
export async function ladeStammdaten() {
  const [s, t, l] = await Promise.all([
    sb.from('saisons').select('*'),
    sb.from('teams').select('*'),
    sb.from('kaderlisten').select('*'),
  ]);
  for (const r of [s, t, l]) if (r.error) throw r.error;
  return {
    saisons: s.data.sort((a, b) => b.name.localeCompare(a.name, 'de')),
    teams: t.data.sort((a, b) =>
      a.verein.localeCompare(b.verein, 'de') || a.name.localeCompare(b.name, 'de')),
    listen: l.data,
  };
}

// Personen eines Kaders laden (sortiert nach Nummer, dann Name)
export async function ladeKader(listeId, { nurAktive = false } = {}) {
  let q = sb.from('kader').select('*').eq('liste_id', listeId);
  if (nurAktive) q = q.eq('aktiv', true);
  const { data, error } = await q;
  if (error) throw error;
  return data.sort((a, b) =>
    (a.nummer ?? 999) - (b.nummer ?? 999) || a.name.localeCompare(b.name, 'de'));
}

// Vorschlag für die nächste Saison: "2026/27" → "2027/28"
export function naechsteSaison(saisons) {
  const m = saisons.map(s => /^(\d{4})\/(\d{2})$/.exec(s.name)).filter(Boolean)
    .map(x => +x[1]).sort((a, b) => b - a)[0];
  const jetzt = new Date();
  const start = m != null ? m + 1 : (jetzt.getMonth() >= 6 ? jetzt.getFullYear() : jetzt.getFullYear() - 1);
  return `${start}/${String((start + 1) % 100).padStart(2, '0')}`;
}

export const teamLabel = t => t ? `${t.verein} – ${t.name}` : '';
