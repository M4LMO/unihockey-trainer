// ============================================================
//  Tool: Kader – Spieler:innen & Staff pro Saison und Team
//  Gespeichert werden NUR: Name, Rückennummer, Position, Rolle
// ============================================================
import { sb } from './supabase.js';
import { esc, toast, fehlerText } from './ui.js';
import { ladeAndereNummern, auchNr } from './nummern.js';
import {
  ladeStammdaten, ladeKader, getAuswahl, setAuswahl, naechsteSaison, teamLabel, ladeIch, sperrGrund,
} from './kontext.js';

export { ladeKader };
export const POSITIONEN = ['Goalie', 'Feld'];
export const POSITION_LABEL = { Goalie: 'Goalie', Feld: 'Feldspieler:in' };
const GRUPPEN_TITEL = { Goalie: 'Goalies', Feld: 'Feldspieler:innen' };
export const STAFF_FUNKTIONEN = [
  'Headcoach', 'Assistenztrainer:in', 'Goalietrainer:in',
  'Athletiktrainer:in', 'Betreuer:in', 'Physio',
];

const plural = (n, ein, mehr) => `${n} ${n === 1 ? ein : mehr}`;

// ---------------------------------------------------------------
export async function mount(root) {
  let st = { saisons: [], teams: [], listen: [] };
  let personen = [];
  let saisonId = null, teamId = null;
  let filter = 'aktiv', suche = '';
  let inhaltKey = '';

  root.innerHTML = `
    <div class="kader">
      <div class="kontext">
        <label class="sel-wrap">Saison
          <select class="sel-saison"></select>
        </label>
        <button class="btn ghost small btn-verwalten">⚙︎ Saisons & Teams</button>
      </div>
      <div class="team-chips" role="tablist"></div>
      <div class="inhalt"><p class="muted pad">Lade …</p></div>
      <button class="fab" hidden aria-label="Person hinzufügen">＋</button>
    </div>
    ${personDialogHTML()}
    ${verwaltungDialogHTML()}`;

  const $ = s => root.querySelector(s);
  const inhalt = $('.inhalt');
  const fab = $('.fab');
  const dlg = $('.dlg-person');
  const form = dlg.querySelector('form');
  const vw = $('.dlg-verwaltung');

  // Saisons & Teams verwaltet nur der Admin
  const ich = await ladeIch().catch(() => null);
  const vollAdmin = !!ich?.admin && !ich?.nurLesen;
  if (!vollAdmin) $('.btn-verwalten').hidden = true;

  const saison = () => st.saisons.find(s => s.id === saisonId);
  const team = () => st.teams.find(t => t.id === teamId);
  const liste = () => st.listen.find(l => l.saison_id === saisonId && l.team_id === teamId);
  const nurLesen = () => !!sperrGrund(saison(), ich);
  const banner = () => `<div class="banner">${esc(sperrGrund(saison(), ich))}</div>`;

  // ---- Laden ----------------------------------------------------
  let andere = new Map();   // andere Rückennummern aus Matches
  async function ladeAlles() {
    try {
      st = await ladeStammdaten();
      waehleKontext();
      const l = liste();
      personen = l ? await ladeKader(l.id) : [];
      andere = await ladeAndereNummern(personen);
      zeichneKontext();
      zeichneInhalt();
      if (vw.open) zeichneVerwaltung();
    } catch (e) {
      inhalt.innerHTML = `<p class="error pad">${esc(fehlerText(e))}</p>`;
    }
  }

  function waehleKontext() {
    const a = getAuswahl();
    const sOk = id => st.saisons.some(s => s.id === id);
    const tOk = id => st.teams.some(t => t.id === id);
    saisonId = sOk(saisonId) ? saisonId : sOk(a.saisonId) ? a.saisonId
      : (st.saisons.find(s => !s.archiviert) || st.saisons[0])?.id ?? null;
    teamId = tOk(teamId) ? teamId : tOk(a.teamId) ? a.teamId : st.teams[0]?.id ?? null;
  }

  let timer;
  const spaeterLaden = () => { clearTimeout(timer); timer = setTimeout(ladeAlles, 200); };
  const kanal = sb.channel('kader-live');
  for (const table of ['kader', 'teams', 'saisons', 'kaderlisten'])
    kanal.on('postgres_changes', { event: '*', schema: 'public', table }, spaeterLaden);
  kanal.subscribe();

  // ---- Saison-Auswahl + Team-Chips -----------------------------
  function zeichneKontext() {
    const aktiv = st.saisons.filter(s => !s.archiviert);
    const archiv = st.saisons.filter(s => s.archiviert);
    const opt = s => `<option value="${s.id}" ${s.id === saisonId ? 'selected' : ''}>${esc(s.name)}</option>`;
    $('.sel-saison').innerHTML = st.saisons.length
      ? aktiv.map(opt).join('') + (archiv.length ? `<optgroup label="📦 Archiv">${archiv.map(opt).join('')}</optgroup>` : '')
      : '<option>– keine –</option>';
    $('.sel-saison').disabled = !st.saisons.length;

    const vereine = new Set(st.teams.map(t => t.verein));
    $('.team-chips').innerHTML = st.teams.map(t => `
      <button class="chip ${t.id === teamId ? 'on' : ''}" data-id="${t.id}" role="tab">
        ${vereine.size > 1 ? `<small>${esc(t.verein)}</small>` : ''}${esc(t.name)}
      </button>`).join('');
  }

  $('.sel-saison').addEventListener('change', e => {
    saisonId = e.target.value; setAuswahl({ saisonId }); wechsle();
  });
  $('.team-chips').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    teamId = b.dataset.id; setAuswahl({ teamId }); wechsle();
  });

  async function wechsle() {
    zeichneKontext();
    const l = liste();
    personen = [];
    inhaltKey = '';
    inhalt.innerHTML = '<p class="muted pad">Lade …</p>';
    try { if (l) personen = await ladeKader(l.id); andere = await ladeAndereNummern(personen); } catch (e) { return toast(fehlerText(e), 'error'); }
    zeichneInhalt();
  }

  // ---- Hauptbereich ---------------------------------------------
  function zeichneInhalt() {
    const l = liste();
    const zustand = !st.saisons.length || !st.teams.length ? 'setup' : l ? 'liste' : 'leer';
    const key = `${zustand}|${saisonId}|${teamId}|${l?.id}|${nurLesen()}`;
    fab.hidden = zustand !== 'liste' || nurLesen();

    if (key === inhaltKey && zustand === 'liste') return zeichneListe();
    inhaltKey = key;

    if (zustand === 'setup' && !vollAdmin) {
      inhalt.innerHTML = `
        <div class="hinweis">
          <h3>👋 Willkommen!</h3>
          <p>Für dieses Team ist noch keine Saison eingerichtet. Bitte beim Admin melden.</p>
        </div>`;
      return;
    }
    if (zustand === 'setup') {
      inhalt.innerHTML = `
        <div class="hinweis">
          <h3>👋 Willkommen!</h3>
          <p>Lege zuerst mindestens <b>eine Saison</b> und <b>ein Team</b> an.</p>
          <button class="btn primary btn-setup">Saisons & Teams einrichten</button>
        </div>`;
      inhalt.querySelector('.btn-setup').onclick = oeffneVerwaltung;
      return;
    }

    if (zustand === 'leer') {
      const quellen = st.listen
        .filter(x => x.team_id === teamId && x.saison_id !== saisonId)
        .map(x => ({ liste: x, saison: st.saisons.find(s => s.id === x.saison_id) }))
        .filter(x => x.saison)
        .sort((a, b) => b.saison.name.localeCompare(a.saison.name, 'de'));
      inhalt.innerHTML = saison()?.archiviert ? `
        <div class="hinweis"><p>📦 Für <b>${esc(teamLabel(team()))}</b> gibt es in der archivierten
        Saison <b>${esc(saison()?.name)}</b> keinen Kader.</p></div>` : !vollAdmin ? `
        <div class="hinweis"><p><b>${esc(teamLabel(team()))}</b> hat in der Saison
        <b>${esc(saison()?.name)}</b> noch keinen Kader. Bitte beim Admin melden.</p></div>` : `
        <div class="hinweis">
          <h3>Neuer Kader</h3>
          <p><b>${esc(teamLabel(team()))}</b> hat in der Saison <b>${esc(saison()?.name)}</b> noch keinen Kader.</p>
          ${quellen.length ? `
            <label>Aus früherer Saison übernehmen
              <select class="sel-quelle">
                ${quellen.map(q => `<option value="${q.liste.id}">${esc(q.saison.name)}</option>`).join('')}
              </select>
            </label>
            <p class="muted klein">Übernommen werden alle aktiven Personen mit Nummer und Position –
              danach kannst du Abgänge entfernen und Neue ergänzen.</p>
            <button class="btn primary btn-kopie">Kader übernehmen</button>
            <button class="btn ghost btn-leer">Leer starten</button>` : `
            <button class="btn primary btn-leer">Kader erstellen</button>`}
        </div>`;
      if (!inhalt.querySelector('.btn-leer')) return;
      inhalt.querySelector('.btn-leer').onclick = () => kaderErstellen(null);
      inhalt.querySelector('.btn-kopie')?.addEventListener('click', () =>
        kaderErstellen(inhalt.querySelector('.sel-quelle').value));
      return;
    }

    inhalt.innerHTML = `
      ${nurLesen() ? banner() : ''}
      <div class="toolbar">
        <div class="seg seg-filter" role="tablist">
          <button data-f="aktiv" class="${filter === 'aktiv' ? 'on' : ''}">Aktiv</button>
          <button data-f="inaktiv" class="${filter === 'inaktiv' ? 'on' : ''}">Inaktiv</button>
        </div>
        <input type="search" class="search" placeholder="Suchen …" aria-label="Suchen" value="${esc(suche)}">
      </div>
      <p class="summary muted"></p>
      <div class="liste"></div>`;
    inhalt.querySelector('.seg-filter').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      filter = b.dataset.f;
      inhalt.querySelectorAll('.seg-filter button').forEach(x => x.classList.toggle('on', x === b));
      zeichneListe();
    });
    inhalt.querySelector('.search').addEventListener('input', e => { suche = e.target.value.trim(); zeichneListe(); });
    inhalt.querySelector('.liste').addEventListener('click', e => {
      const b = e.target.closest('.karte'); if (!b || nurLesen()) return;
      oeffnePerson(personen.find(p => p.id === b.dataset.id));
    });
    zeichneListe();
  }

  function zeichneListe() {
    const listeEl = inhalt.querySelector('.liste');
    const summary = inhalt.querySelector('.summary');
    if (!listeEl) return;

    const aktiv = personen.filter(p => p.aktiv);
    const sp = aktiv.filter(p => p.rolle === 'spieler').length;
    const stf = aktiv.filter(p => p.rolle === 'staff').length;
    const inakt = personen.length - aktiv.length;
    summary.textContent = `${plural(sp, 'Spieler:in', 'Spieler:innen')} · ${stf} Staff` +
      (inakt ? ` · ${inakt} inaktiv` : '');

    const s = suche.toLowerCase();
    const sichtbar = personen.filter(p =>
      (filter === 'aktiv' ? p.aktiv : !p.aktiv) &&
      (!s || p.name.toLowerCase().includes(s) || String(p.nummer ?? '').startsWith(s) ||
        (p.position || '').toLowerCase().includes(s)));

    if (!sichtbar.length) {
      listeEl.innerHTML = `<p class="muted pad leer">${
        suche ? 'Keine Treffer.' :
        filter === 'inaktiv' ? 'Keine inaktiven Personen.' :
        nurLesen() ? 'Dieser Kader ist leer.' :
        'Noch niemand erfasst.<br>Tippe auf <b>＋</b> um zu starten.'}</p>`;
      return;
    }

    const gruppen = [
      ...POSITIONEN.map(pos => ({
        titel: GRUPPEN_TITEL[pos],
        items: sichtbar.filter(p => p.rolle === 'spieler' && p.position === pos),
      })),
      { titel: 'Spieler:innen ohne Position',
        items: sichtbar.filter(p => p.rolle === 'spieler' && !POSITIONEN.includes(p.position)) },
      { titel: 'Staff', items: sichtbar.filter(p => p.rolle === 'staff') },
    ].filter(g => g.items.length);

    listeEl.innerHTML = gruppen.map(g => `
      <h3 class="gruppe">${esc(g.titel)} <span>${g.items.length}</span></h3>
      <ul class="karten">
        ${g.items.map(p => `
          <li><button class="karte ${p.rolle}" data-id="${p.id}" ${nurLesen() ? 'tabindex="-1"' : ''}>
            <span class="nr">${p.nummer ?? (p.rolle === 'staff' ? '★' : '–')}</span>
            <span class="info">
              <strong>${esc(p.name)}${auchNr(andere.get(p.id))}</strong>
              <small>${esc(p.rolle === 'staff' ? (p.position || 'Staff') : (POSITION_LABEL[p.position] || 'keine Position'))}</small>
            </span>
          </button></li>`).join('')}
      </ul>`).join('');
  }

  async function kaderErstellen(quelleId) {
    const { data: neu, error } = await sb.from('kaderlisten')
      .insert({ saison_id: saisonId, team_id: teamId }).select().single();
    if (error) return toast(fehlerText(error), 'error');
    if (quelleId) {
      try {
        const alt = await ladeKader(quelleId, { nurAktive: true });
        if (alt.length) {
          const { error: e2 } = await sb.from('kader').insert(alt.map(p => ({
            liste_id: neu.id, name: p.name, nummer: p.nummer, position: p.position, rolle: p.rolle,
          })));
          if (e2) throw e2;
        }
        toast(`${alt.length} Personen übernommen`, 'ok');
      } catch (e) { toast(fehlerText(e), 'error'); }
    } else toast('Kader erstellt', 'ok');
    await ladeAlles();
  }

  // ---- Person bearbeiten ----------------------------------------
  let aktuell = null;
  fab.addEventListener('click', () => oeffnePerson(null));

  let rolleAktuell = 'spieler';
  const rolleHint = (r = rolleAktuell) => r === 'staff' ? '(optional)' : '';
  function setzeRolle(rolle) {
    rolleAktuell = rolle;
    form.rolle.value = rolle;
    dlg.querySelectorAll('.rolle-seg button').forEach(b => b.classList.toggle('on', b.dataset.r === rolle));
    dlg.querySelector('.feld-pos-spieler').hidden = rolle !== 'spieler';
    dlg.querySelector('.feld-pos-staff').hidden = rolle !== 'staff';
    dlg.querySelector('.nr-hint').textContent = rolleHint(rolle);
  }

  function oeffnePerson(p) {
    aktuell = p;
    form.reset();
    dlg.querySelector('.dlg-titel').textContent = p ? 'Bearbeiten' : 'Neue Person';
    dlg.querySelector('.dlg-kontext').textContent = `${teamLabel(team())} · ${saison()?.name ?? ''}`;
    dlg.querySelector('.nur-edit').hidden = !p;
    dlg.querySelector('.form-error').hidden = true;
    setzeRolle(p?.rolle || 'spieler');
    form.name.value = p?.name || '';
    form.nummer.value = p?.nummer ?? '';
    if (p?.rolle === 'staff') form.pos_staff.value = p.position || '';
    else form.pos_spieler.value = POSITIONEN.includes(p?.position) ? p.position : 'Feld';
    dlg.querySelector('.btn-aktiv').textContent = p && !p.aktiv ? 'Reaktivieren' : 'Inaktiv setzen';
    const auch = p ? andere.get(p.id) : null;
    dlg.querySelector('.nr-hint').innerHTML = rolleHint() + (auch ? ` ${auchNr(auch)}` : '');
    dlg.showModal();
    if (!p) setTimeout(() => form.name.focus(), 50);
  }

  const fehler = msg => {
    const el = dlg.querySelector('.form-error'); el.textContent = msg; el.hidden = false;
  };

  dlg.querySelector('.rolle-seg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (b) setzeRolle(b.dataset.r);
  });
  dlg.querySelector('.btn-abbrechen').addEventListener('click', () => dlg.close());

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const rolle = form.rolle.value;
    const name = form.name.value.trim().replace(/\s+/g, ' ');
    const nrTxt = form.nummer.value.trim();
    const nummer = nrTxt === '' ? null : Number(nrTxt);
    const position = (rolle === 'staff' ? form.pos_staff.value : form.pos_spieler.value).trim() || null;

    if (!name) return fehler('Bitte einen Namen eingeben.');
    if (nummer !== null && !(Number.isInteger(nummer) && nummer >= 0 && nummer <= 99))
      return fehler('Rückennummer muss zwischen 0 und 99 liegen.');
    if (rolle === 'spieler' && nummer !== null) {
      const doppelt = personen.find(p => p.aktiv && p.rolle === 'spieler' && p.nummer === nummer && p.id !== aktuell?.id);
      if (doppelt) return fehler(`Nr. ${nummer} hat bereits ${doppelt.name}.`);
    }

    const daten = { name, nummer, position, rolle };
    const btn = form.querySelector('.btn-speichern');
    btn.disabled = true;
    const { error } = aktuell
      ? await sb.from('kader').update(daten).eq('id', aktuell.id)
      : await sb.from('kader').insert({ ...daten, liste_id: liste().id });
    btn.disabled = false;
    if (error) return fehler(fehlerText(error));
    dlg.close();
    toast(aktuell ? 'Gespeichert' : `${name} hinzugefügt`, 'ok');
    ladeAlles();
  });

  dlg.querySelector('.btn-aktiv').addEventListener('click', async () => {
    if (!aktuell) return;
    const neu = !aktuell.aktiv;
    const { error } = await sb.from('kader').update({ aktiv: neu }).eq('id', aktuell.id);
    if (error) return fehler(fehlerText(error));
    dlg.close();
    toast(neu ? `${aktuell.name} reaktiviert` : `${aktuell.name} ist jetzt inaktiv`, 'ok');
    ladeAlles();
  });

  dlg.querySelector('.btn-loeschen').addEventListener('click', async () => {
    if (!aktuell) return;
    if (!confirm(`${aktuell.name} endgültig löschen?\n\nTipp: „Inaktiv setzen“ blendet nur aus.`)) return;
    const { error } = await sb.from('kader').delete().eq('id', aktuell.id);
    if (error) return fehler(fehlerText(error));
    dlg.close();
    toast(`${aktuell.name} gelöscht`);
    ladeAlles();
  });

  // ---- Saisons & Teams verwalten --------------------------------
  const fSaison = vw.querySelector('.vw-add-saison');
  const fTeam = vw.querySelector('.vw-add-team');

  function oeffneVerwaltung() {
    fSaison.name.value = naechsteSaison(st.saisons);
    teamFormReset();
    zeichneVerwaltung();
    vw.showModal();
  }
  $('.btn-verwalten').addEventListener('click', oeffneVerwaltung);
  vw.querySelector('.btn-schliessen').addEventListener('click', () => vw.close());

  function zeichneVerwaltung() {
    vw.querySelector('.vw-saisons').innerHTML = st.saisons.map(s => `
      <li class="${s.archiviert ? 'archiviert' : ''}">
        <span class="vw-name">${esc(s.name)} ${s.archiviert ? '<span class="badge">Archiv</span>' : ''}</span>
        <button class="btn ghost small" data-act="archiv" data-id="${s.id}">${s.archiviert ? 'Reaktivieren' : 'Archivieren'}</button>
      </li>`).join('') || '<li class="muted">Noch keine Saison.</li>';

    vw.querySelector('.vw-teams').innerHTML = st.teams.map(t => `
      <li>
        <span class="vw-name"><small class="muted">${esc(t.verein)}</small> ${esc(t.name)}</span>
        <button class="btn ghost small" data-act="edit-team" data-id="${t.id}" title="Umbenennen">✏️</button>
      </li>`).join('') || '<li class="muted">Noch kein Team.</li>';
  }

  vw.addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const id = b.dataset.id;
    let error;
    if (b.dataset.act === 'archiv') {
      const s = st.saisons.find(x => x.id === id);
      ({ error } = await sb.from('saisons').update({ archiviert: !s.archiviert }).eq('id', id));
      if (!error) toast(s.archiviert ? `${s.name} reaktiviert` : `${s.name} archiviert`, 'ok');
    } else if (b.dataset.act === 'del-saison') {
      const s = st.saisons.find(x => x.id === id);
      if (!confirm(`Saison ${s.name} löschen?\n\nAlle Kader dieser Saison werden ebenfalls gelöscht!\nTipp: „Archivieren“ behält alles.`)) return;
      ({ error } = await sb.from('saisons').delete().eq('id', id));
      if (!error) toast(`${s.name} gelöscht`);
    } else if (b.dataset.act === 'del-team') {
      const t = st.teams.find(x => x.id === id);
      if (!confirm(`Team „${teamLabel(t)}“ löschen?\n\nDie Kader dieses Teams in ALLEN Saisons werden ebenfalls gelöscht!`)) return;
      ({ error } = await sb.from('teams').delete().eq('id', id));
      if (!error) toast(`${t.name} gelöscht`);
    } else if (b.dataset.act === 'edit-team') {
      const t = st.teams.find(x => x.id === id);
      fTeam.id.value = t.id; fTeam.verein.value = t.verein; fTeam.name.value = t.name;
      fTeam.querySelector('.btn-team').textContent = 'Speichern';
      vw.querySelector('.btn-team-abbr').hidden = false;
      fTeam.name.focus();
      return;
    }
    if (error) return toast(fehlerText(error), 'error');
    await ladeAlles();
  });

  fSaison.addEventListener('submit', async e => {
    e.preventDefault();
    const name = fSaison.name.value.trim();
    if (!name) return;
    const { data, error } = await sb.from('saisons').insert({ name }).select().single();
    if (error) return toast(fehlerText(error), 'error');
    toast(`Saison ${name} angelegt`, 'ok');
    saisonId = data.id; setAuswahl({ saisonId });
    fSaison.name.value = '';
    await ladeAlles();
    fSaison.name.value = naechsteSaison(st.saisons);
  });

  function teamFormReset() {
    fTeam.id.value = ''; fTeam.name.value = '';
    fTeam.verein.value = st.teams[st.teams.length - 1]?.verein || '';
    fTeam.querySelector('.btn-team').textContent = 'Hinzufügen';
    vw.querySelector('.btn-team-abbr').hidden = true;
  }
  vw.querySelector('.btn-team-abbr').addEventListener('click', teamFormReset);

  fTeam.addEventListener('submit', async e => {
    e.preventDefault();
    const verein = fTeam.verein.value.trim(), name = fTeam.name.value.trim();
    if (!verein || !name) return toast('Verein und Teamname ausfüllen', 'error');
    const id = fTeam.id.value;
    if (id) {
      const { error } = await sb.from('teams').update({ verein, name }).eq('id', id);
      if (error) return toast(fehlerText(error), 'error');
      toast('Team gespeichert', 'ok');
    } else {
      const { data, error } = await sb.from('teams').insert({ verein, name }).select().single();
      if (error) return toast(fehlerText(error), 'error');
      toast(`${name} angelegt`, 'ok');
      teamId = data.id; setAuswahl({ teamId });
    }
    await ladeAlles();
    teamFormReset();
  });

  await ladeAlles();
  return () => { clearTimeout(timer); sb.removeChannel(kanal); };
}

// ---------------------------------------------------------------
function personDialogHTML() {
  return `
  <dialog class="dlg dlg-person">
    <form method="dialog" novalidate>
      <div>
        <h2 class="dlg-titel">Neue Person</h2>
        <p class="dlg-kontext muted klein"></p>
      </div>

      <input type="hidden" name="rolle" value="spieler">
      <div class="seg rolle-seg">
        <button type="button" data-r="spieler" class="on">Spieler:in</button>
        <button type="button" data-r="staff">Staff</button>
      </div>

      <label>Name
        <input name="name" autocomplete="off" maxlength="60" placeholder="Vorname Nachname">
      </label>

      <label>Rückennummer <span class="nr-hint muted"></span>
        <input name="nummer" type="number" inputmode="numeric" min="0" max="99" placeholder="z.B. 17">
      </label>

      <label class="feld-pos-spieler">Position
        <select name="pos_spieler">
          ${POSITIONEN.map(p => `<option value="${p}">${POSITION_LABEL[p]}</option>`).join('')}
        </select>
      </label>

      <label class="feld-pos-staff" hidden>Funktion
        <input name="pos_staff" list="staff-funktionen" maxlength="40" placeholder="z.B. Headcoach">
        <datalist id="staff-funktionen">
          ${STAFF_FUNKTIONEN.map(p => `<option value="${p}">`).join('')}
        </datalist>
      </label>

      <p class="form-error error" hidden></p>

      <div class="dlg-actions">
        <button type="button" class="btn ghost btn-abbrechen">Abbrechen</button>
        <button type="submit" class="btn primary btn-speichern">Speichern</button>
      </div>

      <div class="nur-edit dlg-danger" hidden>
        <button type="button" class="btn ghost small btn-aktiv">Inaktiv setzen</button>
        <button type="button" class="btn danger small btn-loeschen">Löschen</button>
      </div>
    </form>
  </dialog>`;
}

function verwaltungDialogHTML() {
  return `
  <dialog class="dlg dlg-verwaltung">
    <div class="dlg-body">
      <h2>Saisons & Teams</h2>

      <h3 class="gruppe">Saisons</h3>
      <ul class="vw-liste vw-saisons"></ul>
      <form class="vw-add vw-add-saison">
        <input name="name" placeholder="z.B. 2027/28" maxlength="20" aria-label="Neue Saison">
        <button class="btn primary small">Hinzufügen</button>
      </form>
      <p class="muted klein">Archivierte Saisons bleiben einsehbar, können aber nicht mehr bearbeitet werden.</p>

      <h3 class="gruppe">Teams</h3>
      <ul class="vw-liste vw-teams"></ul>
      <form class="vw-add vw-add-team">
        <input type="hidden" name="id">
        <input name="verein" placeholder="Verein" maxlength="40" aria-label="Verein">
        <input name="name" placeholder="Team, z.B. Herren 1" maxlength="40" aria-label="Teamname">
        <button class="btn primary small btn-team">Hinzufügen</button>
        <button type="button" class="btn ghost small btn-team-abbr" hidden>Abbrechen</button>
      </form>
      <p class="muted klein">Ein Team gibt es über alle Saisons hinweg – pro Saison bekommt es einen eigenen Kader.<br>🗑 Löschen von Teams und Saisons: auf der Hauptseite (mit Papierkorb).</p>

      <div class="dlg-actions">
        <button type="button" class="btn ghost btn-schliessen">Schliessen</button>
      </div>
    </div>
  </dialog>`;
}
