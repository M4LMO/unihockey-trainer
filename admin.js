// ============================================================
//  Hauptseite (nur Admin): Teams, Saisons, Staff-Logins,
//  Papierkorb und Sicherung
// ============================================================
import { sb } from './supabase.js';
import { esc, toast, fehlerText } from './ui.js';
import { ladeStammdaten, setAuswahl, naechsteSaison, teamLabel } from './kontext.js';
import { SUPABASE_URL } from './config.js';

const PROJEKT = SUPABASE_URL.replace(/^https:\/\//, '').split('.')[0];
const USERS_LINK = `https://supabase.com/dashboard/project/${PROJEKT}/auth/users`;

// Alle Tabellen für die Sicherung (Reihenfolge = Abhängigkeiten)
const TABELLEN = [
  'teams', 'saisons', 'kaderlisten', 'kader', 'einsaetze', 'varianten', 'linien',
  'linien_spieler', 'chemie', 'match_aufstellung', 'match_ereignisse', 'su_zuordnung', 'zugang',
];

const datum = iso => iso ? new Date(iso).toLocaleDateString('de-CH') : '';

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
    .adm .vw-liste li { background: var(--card); box-shadow: var(--shadow); flex-wrap: wrap; }
    .dlg-staff .vw-liste li { flex-wrap: wrap; }
    .dlg-staff .vw-name { flex: 1 1 100%; overflow-wrap: anywhere; }
    .dlg-staff .sel-recht { flex: 1; font-size: 16px; padding: 6px 8px; }
    .adm-hilfe { font-size: .85rem; line-height: 1.5; background: #eff6ff; color: #1e3a8a; border-radius: 10px; padding: 10px 12px; margin: 0; }
    .adm-hilfe a { color: inherit; font-weight: 700; }
    .adm-papierkorb li { opacity: .85; }
    .adm-papierkorb .vw-name { flex: 1 1 100%; }
    .adm-papierkorb .vw-name small { display: block; }
    .adm-sicherung { background: var(--card); border-radius: var(--radius); box-shadow: var(--shadow); padding: 14px; display: grid; gap: 10px; }
    .adm-sicherung p { margin: 0; }
    .dlg-frage .warnung { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; border-radius: 10px; padding: 10px 12px; font-size: .9rem; line-height: 1.5; }
    .dlg-frage .warnung ul { margin: 6px 0 0; padding-left: 18px; }
    .dlg-frage .btn-ja { background: var(--err); color: #fff; }
    .dlg-frage .btn-ja:disabled { opacity: .4; }
  `;
  document.head.appendChild(s);
}

export async function mount(root) {
  stil();
  let st = { saisons: [], teams: [], listen: [] };   // inkl. Papierkorb
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

      <section class="sec-papierkorb" hidden>
        <h2>🗑 Papierkorb</h2>
        <ul class="vw-liste adm-papierkorb"></ul>
        <p class="muted klein" style="margin-top:6px">Alles im Papierkorb ist für den Staff unsichtbar, aber noch vollständig vorhanden.</p>
      </section>

      <section>
        <h2>💾 Sicherung</h2>
        <div class="adm-sicherung">
          <p class="klein">Lädt <b>alle Daten</b> (alle Teams, Saisons, Kader, Linien, Statistiken) als Datei herunter.
            Am besten ab und zu machen – z.B. vor grösseren Änderungen oder am Saisonende.</p>
          <div><button class="btn primary small btn-sicherung">💾 Sicherung herunterladen</button></div>
        </div>
      </section>
    </div>
    ${staffDialogHTML()}
    ${frageDialogHTML()}`;

  const $ = s => root.querySelector(s);
  const dlg = $('.dlg-staff');
  let dlgTeam = null;

  const aktivTeams = () => st.teams.filter(t => !t.geloescht_am);
  const aktivSaisons = () => st.saisons.filter(s => !s.geloescht_am);

  async function laden() {
    try {
      st = await ladeStammdaten({ mitGeloeschten: true });
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
    $('.adm-teams').innerHTML = aktivTeams().map(t => {
      const saisons = st.listen.filter(l => l.team_id === t.id)
        .map(l => aktivSaisons().find(s => s.id === l.saison_id)?.name).filter(Boolean).sort().reverse();
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
            <button class="btn danger small" data-act="weg-team" data-id="${t.id}" title="In den Papierkorb">🗑</button>
          </div>
        </div>`;
    }).join('') || '<p class="muted">Noch kein Team – unten anlegen.</p>';

    $('.adm-saisons').innerHTML = aktivSaisons().map(s => `
      <li class="${s.archiviert ? 'archiviert' : ''}">
        <span class="vw-name">${esc(s.name)} ${s.archiviert ? '<span class="badge">Archiv</span>' : ''}</span>
        <button class="btn ghost small" data-act="archiv" data-id="${s.id}">${s.archiviert ? 'Reaktivieren' : 'Archivieren'}</button>
        <button class="btn danger small" data-act="weg-saison" data-id="${s.id}" title="In den Papierkorb">🗑</button>
      </li>`).join('') || '<li class="muted">Noch keine Saison.</li>';

    const korb = [
      ...st.teams.filter(t => t.geloescht_am).map(t => ({ typ: 'team', id: t.id, name: teamLabel(t), am: t.geloescht_am })),
      ...st.saisons.filter(s => s.geloescht_am).map(s => ({ typ: 'saison', id: s.id, name: `Saison ${s.name}`, am: s.geloescht_am })),
    ];
    $('.sec-papierkorb').hidden = !korb.length;
    $('.adm-papierkorb').innerHTML = korb.map(k => `
      <li>
        <span class="vw-name">${k.typ === 'team' ? '🏒' : '📅'} ${esc(k.name)}<small class="muted">gelöscht am ${datum(k.am)}</small></span>
        <button class="btn ghost small" data-act="zurueck" data-typ="${k.typ}" data-id="${k.id}">↩︎ Wiederherstellen</button>
        <button class="btn danger small" data-act="endgueltig" data-typ="${k.typ}" data-id="${k.id}">Endgültig löschen</button>
      </li>`).join('');

    const f = $('.f-saison');
    if (!f.name.value) f.name.value = naechsteSaison(aktivSaisons());
    const ft = $('.f-team');
    const at = aktivTeams();
    if (!ft.verein.value && at.length) ft.verein.value = at[at.length - 1].verein;
  }

  // Was hängt an einem Team bzw. einer Saison? (für die Warnung)
  async function umfang(listenIds) {
    if (!listenIds.length) return { personen: 0, trainings: 0, matches: 0 };
    const [k, e] = await Promise.all([
      sb.from('kader').select('id').in('liste_id', listenIds),
      sb.from('einsaetze').select('id, typ').in('liste_id', listenIds),
    ]);
    const ein = e.data || [];
    return {
      personen: (k.data || []).length,
      trainings: ein.filter(x => x.typ === 'training').length,
      matches: ein.filter(x => x.typ === 'match').length,
    };
  }
  const umfangHTML = (u, kader) => `
    <ul>
      <li>${kader} Kader (${kader === 1 ? 'eine Saison' : 'Saisons'})</li>
      <li>${u.personen} ${u.personen === 1 ? 'Person' : 'Personen'} im Kader</li>
      <li>${u.trainings} ${u.trainings === 1 ? 'Training' : 'Trainings'} und ${u.matches} ${u.matches === 1 ? 'Match' : 'Matches'} mit Linien und Statistik</li>
    </ul>`;

  function oeffne(id) {
    setAuswahl({ teamId: id });
    location.hash = '#/team';
  }

  root.addEventListener('click', async e => {
    const o = e.target.closest('.oeffnen');
    if (o) return oeffne(o.dataset.id);
    const b = e.target.closest('button[data-act]');
    if (!b || dlg.contains(b) || b.closest('.dlg-frage')) return;
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

    if (b.dataset.act === 'archiv') {
      ({ error } = await sb.from('saisons').update({ archiviert: !s.archiviert }).eq('id', id));
      if (!error) toast(s.archiviert ? `${s.name} reaktiviert` : `${s.name} archiviert`, 'ok');
    }

    // ---- In den Papierkorb -----------------------------------------
    if (b.dataset.act === 'weg-team') {
      const listen = st.listen.filter(l => l.team_id === id);
      const u = await umfang(listen.map(l => l.id));
      const n = staff.filter(x => x.team_id === id).length;
      const ok = await frage({
        titel: `🗑 Team „${teamLabel(t)}“ in den Papierkorb?`,
        html: `<div class="warnung">Betroffen sind:${umfangHTML(u, listen.length)}
          ${n ? `<p style="margin:8px 0 0"><b>${n} Staff-Login${n === 1 ? '' : 's'}</b> verlieren den Zugang, solange das Team im Papierkorb liegt.</p>` : ''}
          </div>
          <p class="klein muted">Nichts wird gelöscht – du kannst das Team im Papierkorb jederzeit wiederherstellen.</p>`,
        knopf: 'In den Papierkorb',
      });
      if (!ok) return;
      ({ error } = await sb.from('teams').update({ geloescht_am: new Date().toISOString() }).eq('id', id));
      if (!error) toast(`${t.name} liegt im Papierkorb`);
    }
    if (b.dataset.act === 'weg-saison') {
      const listen = st.listen.filter(l => l.saison_id === id);
      const u = await umfang(listen.map(l => l.id));
      const ok = await frage({
        titel: `🗑 Saison ${s.name} in den Papierkorb?`,
        html: `<div class="warnung">Die Saison verschwindet für <b>alle Teams</b>. Betroffen sind:${umfangHTML(u, listen.length)}</div>
          <p class="klein muted">Tipp: Für abgeschlossene Saisons ist <b>Archivieren</b> meist besser – dann bleibt alles sichtbar.
          Aus dem Papierkorb kannst du die Saison jederzeit wiederherstellen.</p>`,
        knopf: 'In den Papierkorb',
      });
      if (!ok) return;
      ({ error } = await sb.from('saisons').update({ geloescht_am: new Date().toISOString() }).eq('id', id));
      if (!error) toast(`Saison ${s.name} liegt im Papierkorb`);
    }

    // ---- Papierkorb: wiederherstellen / endgültig löschen ------------
    if (b.dataset.act === 'zurueck') {
      const tab = b.dataset.typ === 'team' ? 'teams' : 'saisons';
      ({ error } = await sb.from(tab).update({ geloescht_am: null }).eq('id', id));
      if (!error) toast('Wiederhergestellt ↩︎', 'ok');
    }
    if (b.dataset.act === 'endgueltig') {
      const istTeam = b.dataset.typ === 'team';
      const listen = st.listen.filter(l => (istTeam ? l.team_id : l.saison_id) === id);
      const u = await umfang(listen.map(l => l.id));
      const name = istTeam ? t.name : s.name;
      const ok = await frage({
        titel: `⚠️ ${istTeam ? `Team „${teamLabel(t)}“` : `Saison ${s.name}`} endgültig löschen?`,
        html: `<div class="warnung"><b>Das kann NICHT rückgängig gemacht werden!</b> Gelöscht werden:${umfangHTML(u, listen.length)}</div>
          <p class="klein muted">Tipp: Vorher unten eine 💾 Sicherung herunterladen.</p>`,
        knopf: 'Endgültig löschen',
        tippen: name,
      });
      if (!ok) return;
      ({ error } = await sb.from(istTeam ? 'teams' : 'saisons').delete().eq('id', id));
      if (!error) toast(`${name} endgültig gelöscht`);
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
    if (st.saisons.some(s => s.geloescht_am && s.name === name))
      return toast(`Saison ${name} liegt im Papierkorb – dort wiederherstellen`, 'error');
    const { error } = await sb.from('saisons').insert({ name });
    if (error) return toast(fehlerText(error), 'error');
    toast(`Saison ${name} angelegt`, 'ok');
    f.name.value = '';
    await laden();
  });

  // ---- Sicherung herunterladen --------------------------------------
  $('.btn-sicherung').addEventListener('click', async e => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = '💾 Lade Daten …';
    try {
      const daten = {};
      for (const tab of TABELLEN) {
        const rows = [];
        for (let von = 0; ; von += 1000) {
          const { data, error } = await sb.from(tab).select('*').range(von, von + 999);
          if (error) throw error;
          rows.push(...data);
          if (data.length < 1000) break;
        }
        daten[tab] = rows;
      }
      const datei = {
        format: 'trainer-tools-sicherung-1',
        erstellt: new Date().toISOString(),
        anzahl: Object.fromEntries(Object.entries(daten).map(([k, v]) => [k, v.length])),
        daten,
      };
      const blob = new Blob([JSON.stringify(datei, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `trainer-tools-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      toast('Sicherung heruntergeladen', 'ok');
    } catch (err) {
      toast(fehlerText(err), 'error');
    }
    btn.disabled = false;
    btn.textContent = '💾 Sicherung herunterladen';
  });

  // ---- Bestätigungs-Dialog ------------------------------------------
  const fd = $('.dlg-frage');
  function frage({ titel, html, knopf, tippen }) {
    return new Promise(resolve => {
      fd.querySelector('.f-titel').textContent = titel;
      fd.querySelector('.f-inhalt').innerHTML = html;
      const ja = fd.querySelector('.btn-ja');
      const feld = fd.querySelector('.f-tippen');
      const inp = feld.querySelector('input');
      ja.textContent = knopf;
      feld.hidden = !tippen;
      inp.value = '';
      if (tippen) feld.querySelector('.f-soll').textContent = tippen;
      const pruefe = () => { ja.disabled = !!tippen && inp.value.trim() !== tippen; };
      pruefe();
      inp.oninput = pruefe;
      const fertig = wert => { fd.close(); resolve(wert); };
      ja.onclick = () => fertig(true);
      fd.querySelector('.btn-nein').onclick = () => fertig(false);
      fd.oncancel = () => resolve(false);
      fd.showModal();
      setTimeout(() => (tippen ? inp : fd.querySelector('.btn-nein')).focus(), 50);
    });
  }

  // ---- Staff-Logins eines Teams -------------------------------------
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
        <select class="sel-recht" data-recht="${s.user_id}" aria-label="Rechte">
          <option value="schreiben" ${s.nur_lesen ? '' : 'selected'}>✏️ Darf bearbeiten</option>
          <option value="lesen" ${s.nur_lesen ? 'selected' : ''}>👀 Nur lesen</option>
        </select>
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

  dlg.addEventListener('change', async e => {
    const sel = e.target.closest('[data-recht]'); if (!sel) return;
    const s = staff.find(x => x.user_id === sel.dataset.recht);
    const wert = sel.value === 'lesen';
    const { error } = await sb.rpc('staff_nur_lesen', { p_user: s.user_id, p_wert: wert });
    if (error) { toast(fehlerText(error), 'error'); return laden(); }
    toast(wert ? `${s.email}: nur lesen` : `${s.email}: darf bearbeiten`, 'ok');
    await laden();
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

function frageDialogHTML() {
  return `
  <dialog class="dlg dlg-verwaltung dlg-frage">
    <div class="dlg-body">
      <h2 class="f-titel"></h2>
      <div class="f-inhalt"></div>
      <label class="f-tippen" hidden><span>Zur Bestätigung <b class="f-soll"></b> eintippen</span>
        <input autocomplete="off" autocapitalize="off" spellcheck="false">
      </label>
      <div class="dlg-actions">
        <button type="button" class="btn ghost btn-nein">Abbrechen</button>
        <button type="button" class="btn btn-ja">Löschen</button>
      </div>
    </div>
  </dialog>`;
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
        Jedes Staff-Mitglied bekommt einen eigenen Login.
      </p>
      <p class="adm-hilfe">
        <b>✏️ Darf bearbeiten:</b> Kader, Linien und Statistik im Team ändern.
        <b>👀 Nur lesen:</b> sieht alles, kann nichts ändern.
        Saisons, Teams und neue Kader legst immer du an.
      </p>
      <div class="dlg-actions">
        <button type="button" class="btn ghost btn-schliessen">Schliessen</button>
      </div>
    </div>
  </dialog>`;
}
