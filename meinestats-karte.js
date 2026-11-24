// ============================================================
//  Meine Stats – Hallen-Karte (Leaflet + OpenStreetMap)
//  - Leaflet wird erst geladen, wenn die Karte gebraucht wird
//  - Standort-Suche über OpenStreetMap Nominatim (max. 1 Anfrage/Sekunde);
//    gesendet wird nur «Halle, Ort» – keine Spiele, keine Namen von Personen
// ============================================================
const LEAFLET = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/';
let leafletPromise = null;

export function ladeLeaflet() {
  if (!document.querySelector('link[data-leaflet]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = LEAFLET + 'leaflet.css'; l.dataset.leaflet = '1';
    document.head.appendChild(l);
  }
  leafletPromise ||= import(LEAFLET + 'leaflet-src.esm.js');
  return leafletPromise;
}

// Grösse und Farbe eines Punkts
export const radius = n => Math.round(6 + 4 * Math.sqrt(n));
export function farbe({ s, u, n, nurFan }) {
  if (nurFan) return '#2563eb';            // nur als Fan dort
  if (s > n) return '#15803d';             // positive Bilanz
  if (n > s) return '#dc2626';             // negative Bilanz
  return '#94a3b8';                        // ausgeglichen / ohne Resultat
}

// Suchtext aufbereiten: «Tenero (Losone)» → «Tenero Losone»
const sauber = t => String(t || '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();

async function nominatim(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=de&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Kartensuche: Fehler ${r.status}`);
  const j = await r.json();
  return j[0] ? { lat: +j[0].lat, lon: +j[0].lon } : null;
}
const warte = ms => new Promise(res => setTimeout(res, ms));

// Standort einer Halle suchen: zuerst «Halle, Ort», sonst nur «Ort»
export async function sucheStandort(h) {
  if (h.name) {
    const p = await nominatim(`${sauber(h.name)}, ${sauber(h.ort)}`);
    if (p) return { ...p, geo: 'auto' };
    await warte(1100);
  }
  const p = await nominatim(sauber(h.ort));
  return p ? { ...p, geo: 'ort' } : null;
}
// Mehrere nacheinander (Nominatim erlaubt max. 1 Anfrage pro Sekunde)
export async function sucheAlle(hallen, { gefunden, fortschritt, abbruch = () => false }) {
  let i = 0;
  for (const h of hallen) {
    if (abbruch()) break;
    fortschritt?.(++i, hallen.length, h);
    try {
      const p = await sucheStandort(h);
      if (p) await gefunden(h, p);
    } catch (e) { fortschritt?.(i, hallen.length, h, e); }
    await warte(1100);
  }
}
