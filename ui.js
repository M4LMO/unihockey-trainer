// Kleine Hilfsfunktionen für die Oberfläche

// Text sicher in HTML einsetzen
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Kurze Meldung unten am Bildschirm
let toastTimer;
export function toast(msg, type = 'info') {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 3000);
}

// Fehlermeldungen von Supabase verständlich machen
export function fehlerText(err) {
  const m = err?.message || String(err);
  if (/Invalid login credentials/i.test(m)) return 'E-Mail oder Passwort falsch.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Keine Verbindung – Internet prüfen.';
  if (/JWT|expired/i.test(m)) return 'Sitzung abgelaufen – bitte neu einloggen.';
  return m;
}
