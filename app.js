// ============================================================
//  Hauptprogramm: Login, Startseiten und Navigation zwischen Tools
//  - Admin:  #/        = Hauptseite (alle Teams, Saisons, Staff-Logins)
//            #/team    = Tools des gewählten Teams
//  - Staff:  #/        = Tools des eigenen Teams
// ============================================================
import { sb } from './supabase.js';
import { APP_NAME } from './config.js';
import { esc, toast, fehlerText } from './ui.js';
import { ladeIch, vergissIch, getAuswahl, setAuswahl, teamLabel } from './kontext.js';
import * as admin from './admin.js';
import * as kader from './kader.js';
import * as linien from './linien.js';
import * as statistik from './statistik.js';

// ---- Liste aller Tools ---------------------------------------
// Neue Tools werden hier eingetragen (soon: true = noch in Arbeit, wird auf der Startseite ausgeblendet)
const TOOLS = [
  { id: 'kader',     name: 'Kader',            icon: '👥', desc: 'Spieler:innen & Staff pro Saison', modul: kader },
  { id: 'linien',    name: 'Linien',           icon: '🧩', desc: 'Aufstellen & bewerten',     modul: linien },
  { id: 'praesenz',  name: 'Präsenz',          icon: '✅', desc: 'Anwesenheit im Training',   soon: true },
  { id: 'taktik',    name: 'Taktikboard',      icon: '📋', desc: 'Spielzüge zeichnen',        soon: true },
  { id: 'statistik', name: 'Statistik',        icon: '📊', desc: 'Tore, Strafen, Skorer',     modul: statistik },
  { id: 'training',  name: 'Trainingsplanung', icon: '🗓️', desc: 'Übungen & Lektionen',       soon: true },
];

const $ = sel => document.querySelector(sel);
const view = () => $('#view');
let aufraeumen = null; // Funktion, die das aktuelle Tool beim Verlassen schliesst
let ich = null;        // { admin, teamId, … }

document.title = APP_NAME;
$('#app-title').textContent = APP_NAME;

// ---- Login / Logout ------------------------------------------
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector('button');
  const err = $('#login-error');
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Einloggen …';
  const { error } = await sb.auth.signInWithPassword({
    email: f.email.value.trim(),
    password: f.password.value,
  });
  btn.disabled = false;
  btn.textContent = 'Einloggen';
  if (error) {
    err.textContent = fehlerText(error);
    err.hidden = false;
  }
});

$('#logout').addEventListener('click', async () => {
  await sb.auth.signOut();
  toast('Abgemeldet');
});

function zeigeLogin() {
  schliesseTool();
  vergissIch();
  ich = null;
  $('#boot').hidden = true;
  $('#app-view').hidden = true;
  $('#login-view').hidden = false;
}

async function zeigeApp() {
  $('#boot').hidden = true;
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  view().innerHTML = '<p class="muted pad">Lade …</p>';
  try {
    ich = await ladeIch(true);
  } catch (e) {
    view().innerHTML = `<p class="error pad">${esc(fehlerText(e))}</p>`;
    return;
  }
  // Staff arbeitet immer im eigenen Team
  if (ich && !ich.admin && ich.teamId) setAuswahl({ teamId: ich.teamId });
  route();
}

let eingeloggt = null;
sb.auth.onAuthStateChange((_event, session) => {
  const jetzt = !!session;
  if (jetzt === eingeloggt) return; // nur bei echtem Wechsel neu zeichnen
  eingeloggt = jetzt;
  // kurz entkoppeln, damit Supabase-Abfragen nicht im Auth-Callback hängen
  setTimeout(() => (jetzt ? zeigeApp() : zeigeLogin()), 0);
});

// ---- Navigation (#/kader, #/linien, …) -------------------------
window.addEventListener('hashchange', () => eingeloggt && ich && route());

function schliesseTool() {
  if (aufraeumen) { try { aufraeumen(); } catch {} aufraeumen = null; }
}

async function route() {
  schliesseTool();
  window.scrollTo(0, 0);

  if (ich?.ohneZugang) {
    $('#page-title').textContent = '';
    view().innerHTML = `
      <div class="home"><div class="hinweis">
        <h3>🔒 Kein Zugang</h3>
        <p>Dieser Login ist noch keinem Team zugeordnet. Bitte beim Admin melden.</p>
      </div></div>`;
    return;
  }

  const id = location.hash.replace(/^#\/?/, '').split('/')[0];
  const tool = TOOLS.find(t => t.id === id && t.modul);

  if (!tool) {
    $('#page-title').textContent = '';
    if (ich?.admin && !ich.alt && id !== 'team') {
      try { aufraeumen = await admin.mount(view()); }
      catch (e) { view().innerHTML = `<p class="error pad">Fehler: ${esc(fehlerText(e))}</p>`; }
      return;
    }
    await teamStart();
    return;
  }
  $('#page-title').textContent = tool.name;
  view().innerHTML = '';
  try {
    aufraeumen = await tool.modul.mount(view());
  } catch (e) {
    view().innerHTML = `<p class="error pad">Fehler: ${esc(fehlerText(e))}</p>`;
  }
}

// Startseite eines Teams: Kacheln der Tools
async function teamStart() {
  let titel = '';
  try {
    const { data } = await sb.from('teams').select('*');
    const teams = data || [];
    const t = teams.find(x => x.id === getAuswahl().teamId) || teams[0];
    if (t) { setAuswahl({ teamId: t.id }); titel = teamLabel(t); }
  } catch {}
  const zurueck = ich?.admin && !ich.alt;
  view().innerHTML = `
    <div class="home">
      ${zurueck ? '<a href="#/" class="zurueck">← Alle Teams</a>' : ''}
      <h2>${titel ? esc(titel) : 'Tools'}</h2>
      <div class="tiles">
        ${TOOLS.filter(t => t.modul && !t.soon).map(t => `
          <a class="tile" href="#/${t.id}">
            <span class="tile-icon">${t.icon}</span>
            <strong>${esc(t.name)}</strong>
            <small>${esc(t.desc)}</small>
          </a>`).join('')}
      </div>
    </div>`;
}
