// ============================================================
//  Tool: Kader – Spieler & Staff verwalten
//  Gespeichert werden NUR: Name, Rückennummer, Position, Rolle
// ============================================================
import { sb } from './supabase.js';
import { esc, toast, fehlerText } from './ui.js';

export const POSITIONEN = ['Goalie', 'Feld'];
const GRUPPEN_TITEL = { Goalie: 'Goalies', Feld: 'Feldspieler' };
export const STAFF_FUNKTIONEN = ['Headcoach', 'Assistenztrainer', 'Torhütertrainer', 'Athletiktrainer', 'Betreuer', 'Physio'];

// Kader laden – auch für andere Tools nutzbar (Linien, Präsenz, …)
export async function ladeKader({ nurAktive = false } = {}) {
  let q = sb.from('kader').select('*');
  if (nurAktive) q = q.eq('aktiv', true);
  const { data, error } = await q;
  if (error) throw error;
  return sortiere(data);
}

function sortiere(liste) {
  return [...liste].sort((a, b) =>
    (a.nummer ?? 999) - (b.nummer ?? 999) || a.name.localeCompare(b.name, 'de'));
}

// ---------------------------------------------------------------
export async function mount(root) {
  let alle = [];
  let filter = 'aktiv'; // 'aktiv' | 'archiv'
  let suche = '';

  root.innerHTML = `
    <div class="kader">
      <div class="toolbar">
        <div class="seg" role="tablist">
          <button data-f="aktiv" class="on">Aktiv</button>
          <button data-f="archiv">Archiv</button>
        </div>
        <input type="search" class="search" placeholder="Suchen …" aria-label="Suchen">
      </div>
      <p class="summary muted"></p>
      <div class="liste"><p class="muted pad">Lade Kader …</p></div>
      <button class="fab" aria-label="Person hinzufügen">＋</button>
    </div>
    ${dialogHTML()}`;

  const liste = root.querySelector('.liste');
  const summary = root.querySelector('.summary');
  const dlg = root.querySelector('dialog');
  const form = dlg.querySelector('form');

  // ---- Daten laden + live aktualisieren ------------------------
  async function laden() {
    try {
      alle = await ladeKader();
      zeichnen();
    } catch (e) {
      liste.innerHTML = `<p class="error pad">${esc(fehlerText(e))}</p>`;
    }
  }

  const kanal = sb.channel('kader-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'kader' }, laden)
    .subscribe();

  await laden();

  // ---- Liste zeichnen -----------------------------------------
  function zeichnen() {
    const aktiv = alle.filter(p => p.aktiv);
    const sp = aktiv.filter(p => p.rolle === 'spieler').length;
    const st = aktiv.filter(p => p.rolle === 'staff').length;
    summary.textContent = `${sp} Spieler · ${st} Staff` +
      (alle.length - aktiv.length ? ` · ${alle.length - aktiv.length} im Archiv` : '');

    const s = suche.toLowerCase();
    const sichtbar = alle.filter(p =>
      (filter === 'aktiv' ? p.aktiv : !p.aktiv) &&
      (!s || p.name.toLowerCase().includes(s) || String(p.nummer ?? '').startsWith(s) ||
        (p.position || '').toLowerCase().includes(s)));

    if (!sichtbar.length) {
      liste.innerHTML = `<p class="muted pad leer">${
        suche ? 'Keine Treffer.' :
        filter === 'aktiv' ? 'Noch niemand erfasst.<br>Tippe auf <b>＋</b> um zu starten.' :
        'Archiv ist leer.'}</p>`;
      return;
    }

    // Gruppen in Unihockey-Reihenfolge
    const gruppen = [
      ...POSITIONEN.map(pos => ({
        titel: GRUPPEN_TITEL[pos] || pos,
        items: sichtbar.filter(p => p.rolle === 'spieler' && p.position === pos),
      })),
      { titel: 'Spieler (ohne Position)',
        items: sichtbar.filter(p => p.rolle === 'spieler' && !POSITIONEN.includes(p.position)) },
      { titel: 'Staff', items: sichtbar.filter(p => p.rolle === 'staff') },
    ].filter(g => g.items.length);

    liste.innerHTML = gruppen.map(g => `
      <h3 class="gruppe">${esc(g.titel)} <span>${g.items.length}</span></h3>
      <ul class="karten">
        ${g.items.map(p => `
          <li><button class="karte ${p.rolle}" data-id="${p.id}">
            <span class="nr">${p.nummer ?? (p.rolle === 'staff' ? '★' : '–')}</span>
            <span class="info">
              <strong>${esc(p.name)}</strong>
              <small>${esc(p.rolle === 'staff' ? (p.position || 'Staff') : p.position === 'Feld' ? 'Feldspieler' : (p.position || 'keine Position'))}</small>
            </span>
          </button></li>`).join('')}
      </ul>`).join('');
  }

  // ---- Bedienung ----------------------------------------------
  root.querySelector('.seg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    filter = b.dataset.f;
    root.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
    zeichnen();
  });
  root.querySelector('.search').addEventListener('input', e => { suche = e.target.value.trim(); zeichnen(); });
  root.querySelector('.fab').addEventListener('click', () => oeffne(null));
  liste.addEventListener('click', e => {
    const b = e.target.closest('.karte'); if (!b) return;
    oeffne(alle.find(p => p.id === b.dataset.id));
  });

  // ---- Formular (neu / bearbeiten) ----------------------------
  let aktuell = null;

  function setzeRolle(rolle) {
    form.rolle.value = rolle;
    dlg.querySelectorAll('.rolle-seg button').forEach(b => b.classList.toggle('on', b.dataset.r === rolle));
    dlg.querySelector('.feld-pos-spieler').hidden = rolle !== 'spieler';
    dlg.querySelector('.feld-pos-staff').hidden = rolle !== 'staff';
    dlg.querySelector('.nr-hint').textContent = rolle === 'staff' ? '(optional)' : '';
  }

  function oeffne(p) {
    aktuell = p;
    form.reset();
    dlg.querySelector('.dlg-titel').textContent = p ? 'Bearbeiten' : 'Neue Person';
    dlg.querySelector('.nur-edit').hidden = !p;
    dlg.querySelector('.form-error').hidden = true;
    setzeRolle(p?.rolle || 'spieler');
    form.name.value = p?.name || '';
    form.nummer.value = p?.nummer ?? '';
    if (p?.rolle === 'staff') form.pos_staff.value = p.position || '';
    else form.pos_spieler.value = POSITIONEN.includes(p?.position) ? p.position : 'Feld';
    const arch = dlg.querySelector('.btn-archiv');
    arch.textContent = p && !p.aktiv ? 'Reaktivieren' : 'Archivieren';
    dlg.showModal();
    if (!p) setTimeout(() => form.name.focus(), 50);
  }

  function fehler(msg) {
    const el = dlg.querySelector('.form-error');
    el.textContent = msg; el.hidden = false;
  }

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
      const doppelt = alle.find(p => p.aktiv && p.rolle === 'spieler' && p.nummer === nummer && p.id !== aktuell?.id);
      if (doppelt) return fehler(`Nr. ${nummer} hat bereits ${doppelt.name}.`);
    }

    const daten = { name, nummer, position, rolle };
    const btn = form.querySelector('.btn-speichern');
    btn.disabled = true;
    const { error } = aktuell
      ? await sb.from('kader').update(daten).eq('id', aktuell.id)
      : await sb.from('kader').insert(daten);
    btn.disabled = false;
    if (error) return fehler(fehlerText(error));
    dlg.close();
    toast(aktuell ? 'Gespeichert' : `${name} hinzugefügt`, 'ok');
    laden();
  });

  dlg.querySelector('.btn-archiv').addEventListener('click', async () => {
    if (!aktuell) return;
    const neu = !aktuell.aktiv;
    const { error } = await sb.from('kader').update({ aktiv: neu }).eq('id', aktuell.id);
    if (error) return fehler(fehlerText(error));
    dlg.close();
    toast(neu ? `${aktuell.name} reaktiviert` : `${aktuell.name} archiviert`, 'ok');
    laden();
  });

  dlg.querySelector('.btn-loeschen').addEventListener('click', async () => {
    if (!aktuell) return;
    if (!confirm(`${aktuell.name} endgültig löschen?\n\nTipp: „Archivieren“ blendet nur aus.`)) return;
    const { error } = await sb.from('kader').delete().eq('id', aktuell.id);
    if (error) return fehler(fehlerText(error));
    dlg.close();
    toast(`${aktuell.name} gelöscht`);
    laden();
  });

  // Aufräumen beim Verlassen des Tools
  return () => { sb.removeChannel(kanal); };
}

// ---------------------------------------------------------------
function dialogHTML() {
  return `
  <dialog class="dlg">
    <form method="dialog" novalidate>
      <h2 class="dlg-titel">Neue Person</h2>

      <input type="hidden" name="rolle" value="spieler">
      <div class="seg rolle-seg">
        <button type="button" data-r="spieler" class="on">Spieler</button>
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
          <option value="Feld">Feldspieler</option>
          <option value="Goalie">Goalie</option>
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
        <button type="button" class="btn ghost small btn-archiv">Archivieren</button>
        <button type="button" class="btn danger small btn-loeschen">Löschen</button>
      </div>
    </form>
  </dialog>`;
}
