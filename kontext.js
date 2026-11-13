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
// Gelöschte (Papierkorb) werden ausgeblendet – ausser { mitGeloeschten: true }
export async function ladeStammdaten({ mitGeloeschten = false } = {}) {
  const [s, t, l] = await Promise.all([
    sb.from('saisons').select('*'),
    sb.from('teams').select('*'),
    sb.from('kaderlisten').select('*'),
  ]);
  for (const r of [s, t, l]) if (r.error) throw r.error;
  const sichtbar = x => mitGeloeschten || !x.geloescht_am;
  return {
    saisons: s.data.filter(sichtbar).sort((a, b) => b.name.localeCompare(a.name, 'de')),
    teams: t.data.filter(sichtbar).sort((a, b) =>
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

// ---- Wer bin ich? (Admin oder Staff eines Teams) -----------------
let ichCache = null;
export async function ladeIch(neu = false) {
  if (ichCache && !neu) return ichCache;
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  if (!user) return null;
  const { data, error } = await sb.from('zugang').select('*').eq('user_id', user.id).maybeSingle();
  if (error) {
    // Tabelle "zugang" gibt es noch nicht (SQL 05 nicht ausgeführt) → altes Verhalten
    if (/zugang|does not exist|PGRST205|42P01/i.test(`${error.code} ${error.message}`))
      return (ichCache = { uid: user.id, email: user.email, admin: true, teamId: null, ohneZugang: false, alt: true });
    throw error;
  }
  return (ichCache = {
    uid: user.id, email: user.email,
    admin: !!data?.admin, teamId: data?.team_id ?? null, ohneZugang: !data,
    nurLesen: !data?.admin && !!data?.nur_lesen,
  });
}
export function vergissIch() { ichCache = null; }

// Warum darf hier nichts geändert werden? '' = alles erlaubt.
// (Die Datenbank sperrt dasselbe – das hier blendet nur Knöpfe aus.)
export function sperrGrund(saison, ich) {
  if (saison?.archiviert) return '📦 Archivierte Saison – nur Ansicht';
  if (ich?.nurLesen) return '👀 Nur-lesen-Zugang – du kannst alles ansehen, aber nichts ändern';
  return '';
}
