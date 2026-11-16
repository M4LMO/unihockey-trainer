// ============================================================
//  Tool: Kader – Spieler:innen & Staff pro Saison und Team
//  Gespeichert werden NUR: Name, Rückennummer, Position, Rolle
// ============================================================
import { sb } from './supabase.js';
import { esc, toast, fehlerText } from './ui.js';
import { ladeAndereNummern, auchNr } from './nummern.js';
import {
  ladeStammdaten, ladeKader, setAuswahl, teamLabel, ladeIch, sperrGrund,
  waehleTeamKontext, kontextKopf, keinKaderHinweis,
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
      <div class="kader-kopf"></div>
      <div class="inhalt"><p class="muted pad">Lade …</p></div>
      <button class="fab" hidden aria-label="Person hinzufügen">＋</button>
    </div>
    ${personDialogHTML()}`;

  const $ = s => root.querySelector(s);
  const inhalt = $('.inhalt');
  const fab = $('.fab');
  const dlg = $('.dlg-person');
  const form = dlg.querySelector('form');

  // Team ist fix (Hauptseite). Saisons des Teams werden auf der Team-Startseite verwaltet.
  const ich = await ladeIch().catch(() => null);
  let teamSaisons = [];

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
    } catch (e) {
      inhalt.innerHTML = `<p class="error pad">${esc(fehlerText(e))}</p>`;
    }
  }

  function waehleKontext() {
    const K = waehleTeamKontext(st, { saisonId });
    teamId = K.team?.id ?? null; saisonId = K.saison?.id ?? null; teamSaisons = K.saisons;
  }

  let timer;
  const spaeterLaden = () => { clearTimeout(timer); timer = setTimeout(ladeAlles, 200); };
  const kanal = sb.channel('kader-live');
  for (const table of ['kader', 'teams', 'saisons', 'kaderlisten'])
    kanal.on('postgres_changes', { event: '*', schema: 'public', table }, spaeterLaden);
  kanal.subscribe();

  // ---- Kopf: «← Team» + Saison-Auswahl (nur Saisons dieses Teams) ----
  function zeichneKontext() {
    $('.kader-kopf').innerHTML = kontextKopf(team(), teamSaisons, saisonId);
    $('.kader-kopf .sel-saison')?.addEventListener('change', e => {
      saisonId = e.target.value; setAuswahl({ saisonId }); wechsle();
    });
  }

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
    const zustand = l ? 'liste' : 'keine';
    const key = `${zustand}|${saisonId}|${teamId}|${l?.id}|${nurLesen()}`;
    fab.hidden = zustand !== 'liste' || nurLesen();

    if (key === inhaltKey && zustand === 'liste') return zeichneListe();
    inhaltKey = key;

    if (zustand === 'keine') { inhalt.innerHTML = keinKaderHinweis(team()); return; }

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
