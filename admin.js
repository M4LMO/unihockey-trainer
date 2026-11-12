// ============================================================
//  Hauptseite (nur Admin): Teams, Saisons und Staff-Logins
// ============================================================
import { sb } from './supabase.js';
import { esc, toast, fehlerText } from './ui.js';
import { ladeStammdaten, setAuswahl, naechsteSaison, teamLabel } from './kontext.js';
import { SUPABASE_URL } from './config.js';

const PROJEKT = SUPABASE_URL.replace(/^https:\/\//, '').split('.')[0];
const USERS_LINK = `https://supabase.com/dashboard/project/${PROJEKT}/auth/users`;

function stil() {
  if (document.getElementById('admin-css')) return;
  const s = document.createElement('style');
  s.id = 'admin-css';
  s.textContent = `
    .zurueck { display: inline-block; margin: 4px 0 6px; color: var(--muted); text-decoration: none; font-weight: 600; }
    .adm h2 { margin: 6px 0 12px; font-size: 1.1rem; color: var(--muted); font-weight: 600; }
    .adm section { margin-bottom: 26px; }
    .adm-teams { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
    .adm-team { background: var(--card); border-radius: var(--radius); box-shadow: var(--shadow); padding: 14px; display: grid; gap: 8px; border: 2px solid transparent; }
    .adm-team:hover { border-color: var(--team); }
    .adm-team .oeffnen { all: unset; cursor: pointer; display: grid; gap: 2px; }
    .adm-team .oeffnen small { color: var(--muted); }
    .adm-team .oeffnen strong { font-size: 1.15rem; }
    .adm-team .meta { font-size: .8rem; color: var(--muted); }
    .adm-team .aktionen { display: flex; gap: 6px; flex-wrap: wrap; }
    .adm-neu { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
    .adm-neu input { flex: 1 1 140px; padding: 8px 10px; }
    .adm .vw-liste li { background: var(--card); box-shadow: var(--shadow); }
    .adm-hilfe { font-size: .85rem; line-height: 1.5; background: #eff6ff; color: #1e3a8a; border-radius: 10px; padding: 10px 12px; margin: 0; }
    .adm-hilfe a { color: inherit; font-weight: 700; }
  `;
  document.head.appendChild(s);
}

export async function mount(root) {
  stil();
  let st = { saisons: [], teams: [], listen: [] };
  let staff = [];

  root.innerHTML = `
    <div class="home adm">
      <section>
        <h2>🏒 Meine Teams</h2>
        <div class="adm-teams"><p class="muted">Lade …</p></div>
        <form class="adm-neu f-team">
          <input name="verein" placeholder="Verein, z.B. Bern Capitals" maxlength="40">
          <input name="name" placeholder="Team, z.B. U21F" maxlength="40">
          <button class="btn primary small">＋ Team</button>
        </form>
      </section>

      <section>
        <h2>📅 Saisons</h2>
        <ul class="vw-liste adm-saisons"></ul>
        <form class="adm-neu f-saison">
          <input name="name" placeholder="z.B. 2027/28" maxlength="20">
          <button class="btn primary small">＋ Saison</button>
        </form>
        <p class="muted klein" style="margin-top:6px">Saisons gelten für alle Teams. Archivierte Saisons kann man nur noch ansehen.</p>
      </section>
    </div>
    ${staffDialogHTML()}`;

  const $ = s => root.querySelector(s);
  const dlg = $('.dlg-staff');
  let dlgTeam = null;

  async function laden() {
    try {
      st = await ladeStammdaten();
      const { data, error } = await sb.rpc('staff_liste');
      if (error) throw error;
      staff = data || [];
      zeichnen();
      if (dlg.open) zeichneStaff();
    } catch (e) {
      $('.adm-teams').innerHTML = `<p class="error">${esc(fehlerText(e))}</p>`;
    }
  }

  function zeichnen() {
    $('.adm-teams').innerHTML = st.teams.map(t => {
      const saisons = st.listen.filter(l => l.team_id === t.id)
        .map(l => st.saisons.find(s => s.id === l.saison_id)?.name).filter(Boolean).sort().reverse();
      const n = staff.filter(s => s.team_id === t.id).length;
      return `
        <div class="adm-team">
          <button class="oeffnen" data-id="${t.id}">
            <small>${esc(t.verein)}</small>
            <strong>${esc(t.name)}</strong>
          </button>
          <div class="meta">📅 ${saisons.length ? esc(saisons.join(', ')) : 'noch kein Kader'} · 🔑 ${n} Staff-Login${n === 1 ? '' : 's'}</div>
          <div class="aktionen">
            <button class="btn primary small" data-act="open" data-id="${t.id}">Öffnen →</button>
            <button class="btn ghost small" data-act="staff" data-id="${t.id}">🔑 Staff</button>
            <button class="btn ghost small" data-act="edit" data-id="${t.id}" title="Umbenennen">✏️</button>
            <button class="btn danger small" data-act="del" data-id="${t.id}" title="Löschen">🗑</button>
          </div>
        </div>`;
    }).join('') || '<p class="muted">Noch kein Team – unten anlegen.</p>';

    $('.adm-saisons').innerHTML = st.saisons.map(s => `
      <li class="${s.archiviert ? 'archiviert' : ''}">
        <span class="vw-name">${esc(s.name)} ${s.archiviert ? '<span class="badge">Archiv</span>' : ''}</span>
        <button class="btn ghost small" data-act="archiv" data-id="${s.id}">${s.archiviert ? 'Reaktivieren' : 'Archivieren'}</button>
        <button class="btn danger small" data-act="del-saison" data-id="${s.id}" title="Löschen">🗑</button>
      </li>`).join('') || '<li class="muted">Noch keine Saison.</li>';

    const f = $('.f-saison');
    if (!f.name.value) f.name.value = naechsteSaison(st.saisons);
    const ft = $('.f-team');
    if (!ft.verein.value && st.teams.length) ft.verein.value = st.teams[st.teams.length - 1].verein;
  }

  function oeffne(id) {
    setAuswahl({ teamId: id });
    location.hash = '#/team';
  }

  root.addEventListener('click', async e => {
    const o = e.target.closest('.oeffnen');
    if (o) return oeffne(o.dataset.id);
    const b = e.target.closest('button[data-act]'); if (!b || dlg.contains(b)) return;
    const id = b.dataset.id;
    const t = st.teams.find(x => x.id === id);
    const s = st.saisons.find(x => x.id === id);
    let error;

    if (b.dataset.act === 'open') return oeffne(id);
    if (b.dataset.act === 'staff') return oeffneStaff(t);
    if (b.dataset.act === 'edit') {
      const verein = prompt('Verein', t.verein); if (verein === null) return;
      const name = prompt('Teamname', t.name); if (name === null) return;
      if (!verein.trim() || !name.trim()) return toast('Verein und Teamname ausfüllen', 'error');
      ({ error } = await sb.from('teams').update({ verein: verein.trim(), name: name.trim() }).eq('id', id));
      if (!error) toast('Team gespeichert', 'ok');
    }
    if (b.dataset.act === 'del') {
      if (!confirm(`Team „${teamLabel(t)}“ wirklich löschen?\n\nALLE Kader, Linien und Statistiken dieses Teams in allen Saisons werden gelöscht. Das kann nicht rückgängig gemacht werden!`)) return;
      if (prompt(`Zur Sicherheit den Teamnamen eintippen: ${t.name}`) !== t.name) return toast('Abgebrochen');
      ({ error } = await sb.from('teams').delete().eq('id', id));
      if (!error) toast(`${t.name} gelöscht`);
    }
    if (b.dataset.act === 'archiv') {
      ({ error } = await sb.from('saisons').update({ archiviert: !s.archiviert }).eq('id', id));
      if (!error) toast(s.archiviert ? `${s.name} reaktiviert` : `${s.name} archiviert`, 'ok');
    }
    if (b.dataset.act === 'del-saison') {
      if (!confirm(`Saison ${s.name} löschen?\n\nAlle Kader, Linien und Statistiken dieser Saison – in ALLEN Teams – werden gelöscht!\nTipp: „Archivieren“ behält alles.`)) return;
      ({ error } = await sb.from('saisons').delete().eq('id', id));
      if (!error) toast(`${s.name} gelöscht`);
    }
    if (error) return toast(fehlerText(error), 'error');
    await laden();
  });

  $('.f-team').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const verein = f.verein.value.trim(), name = f.name.value.trim();
    if (!verein || !name) return toast('Verein und Teamname ausfüllen', 'error');
    const { error } = await sb.from('teams').insert({ verein, name });
    if (error) return toast(fehlerText(error), 'error');
    toast(`${name} angelegt`, 'ok');
    f.name.value = '';
    await laden();
  });

  $('.f-saison').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const name = f.name.value.trim(); if (!name) return;
    const { error } = await sb.from('saisons').insert({ name });
    if (error) return toast(fehlerText(error), 'error');
    toast(`Saison ${name} angelegt`, 'ok');
    f.name.value = '';
    await laden();
  });

  // ---- Staff-Logins eines Teams -----------------------------------
  function oeffneStaff(t) {
    dlgTeam = t;
    dlg.querySelector('.dlg-titel').textContent = `🔑 Staff-Logins`;
    dlg.querySelector('.dlg-kontext').textContent = teamLabel(t);
    dlg.querySelector('.form-error').hidden = true;
    dlg.querySelector('form').email.value = '';
    zeichneStaff();
    dlg.showModal();
  }

  function zeichneStaff() {
    const liste = staff.filter(s => s.team_id === dlgTeam?.id);
    dlg.querySelector('.vw-liste').innerHTML = liste.map(s => `
      <li><span class="vw-name">${esc(s.email)}</span>
        <button type="button" class="btn danger small" data-weg="${s.user_id}" title="Zugang entfernen">✕</button></li>`).join('')
      || '<li class="muted">Noch kein Staff-Login für dieses Team.</li>';
  }

  dlg.addEventListener('click', async e => {
    const w = e.target.closest('[data-weg]');
    if (w) {
      const s = staff.find(x => x.user_id === w.dataset.weg);
      if (!confirm(`Zugang für ${s.email} zu ${dlgTeam.name} entfernen?\n\n(Der Login selbst bleibt in Supabase bestehen.)`)) return;
      const { error } = await sb.rpc('staff_entfernen', { p_user: s.user_id });
      if (error) return toast(fehlerText(error), 'error');
      toast('Zugang entfernt');
      await laden();
    }
    if (e.target.closest('.btn-schliessen')) dlg.close();
  });

  dlg.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    const email = e.target.email.value.trim();
    const err = dlg.querySelector('.form-error');
    err.hidden = true;
    if (!email) return;
    const vorher = staff.find(s => s.email.toLowerCase() === email.toLowerCase());
    if (vorher && vorher.team_id !== dlgTeam.id) {
      const alt = st.teams.find(t => t.id === vorher.team_id);
      if (!confirm(`${email} gehört zurzeit zu „${teamLabel(alt)}“.\nEin Login kann nur EIN Team haben – umhängen zu „${teamLabel(dlgTeam)}“?`)) return;
    }
    const { error } = await sb.rpc('staff_zuordnen', { p_email: email, p_team: dlgTeam.id });
    if (error) { err.textContent = fehlerText(error); err.hidden = false; return; }
    toast(`${email} hat jetzt Zugang`, 'ok');
    e.target.email.value = '';
    await laden();
  });

  await laden();
  return () => {};
}

function staffDialogHTML() {
  return `
  <dialog class="dlg dlg-verwaltung dlg-staff">
    <div class="dlg-body">
      <div>
        <h2 class="dlg-titel">🔑 Staff-Logins</h2>
        <p class="dlg-kontext muted klein"></p>
      </div>
      <ul class="vw-liste"></ul>
      <form class="vw-add" novalidate>
        <input name="email" type="email" placeholder="E-Mail des Staff-Logins" autocomplete="off">
        <button class="btn primary small">Zuordnen</button>
      </form>
      <p class="form-error error" hidden></p>
      <p class="adm-hilfe">
        <b>Neuen Staff-Login anlegen:</b> in Supabase unter
        <a href="${USERS_LINK}" target="_blank" rel="noopener">Authentication → Users</a>
        → <i>Add user</i> → <i>Create new user</i> (✅ Auto Confirm). Danach hier die E-Mail eintragen.
        Alle vom Staff dieses Teams nutzen denselben Login.
      </p>
      <div class="dlg-actions">
        <button type="button" class="btn ghost btn-schliessen">Schliessen</button>
      </div>
    </div>
  </dialog>`;
}
