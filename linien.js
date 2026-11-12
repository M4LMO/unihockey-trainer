// ============================================================
//  Tool: Linien – Linien, Powerplay, Boxplay pro Training/Match
//  erfassen und nachschauen (Bewertung/Chemie ausgebaut 12.11.;
//  Spalten note/notiz und Tabelle chemie bleiben in der DB unbenutzt).
//
//  Ansichten (Hash):
//    #/linien            Übersicht (Tabs: Einsätze / Personen / Auswertung / Ideen)
//    #/linien/e/<id>     ein Einsatz (Aufstellen; Screenshot-Modus ausgebaut 12.11.)
//    #/linien/p/<id>     Historie einer Person
// ============================================================
import { sb } from './supabase.js';
import { esc, toast, fehlerText } from './ui.js';
import { ladeStammdaten, ladeKader, getAuswahl, setAuswahl, teamLabel } from './kontext.js';
import { zeichneAuswertung } from './linien-auswertung.js';
import { zeichneIdeen } from './linien-ideen.js';
import { andereNummern, auchNr } from './nummern.js';

// ---- Arten von Formationen und Systeme -------------------------
const ARTEN = {
  linie: { titel: 'Linien',        kurz: 'Linie', neu: '＋ Linie',      systeme: ['2-2-1', '2-1-2', 'W'] },
  pp:    { titel: 'Powerplay 5:4', kurz: 'PP',    neu: '＋ Powerplay',  systeme: ['PP'] },
  bp:    { titel: 'Boxplay 4:5',   kurz: 'BP',    neu: '＋ Boxplay',    systeme: ['Box', 'Diamant'] },
  '6v5': { titel: '6 gegen 5',     kurz: '6:5',   neu: '＋ 6 gegen 5',  systeme: ['6v5'] },
};
const ART_REIHE = ['linie', 'pp', 'bp', '6v5'];

// Posten: [Kürzel, x %, y %, Rolle]  – oben = Angriffsrichtung, eigenes Tor unten
const SYSTEME = {
  '2-2-1':  { label: '2-2-1', posten: [['LV', 25, 82, 'V'], ['RV', 75, 82, 'V'], ['LF', 25, 50, 'S'], ['C', 75, 50, 'S'], ['SF', 50, 18, 'S']] },
  '2-1-2':  { label: '2-1-2', posten: [['LV', 25, 82, 'V'], ['RV', 75, 82, 'V'], ['C', 50, 50, 'S'], ['LF', 25, 18, 'S'], ['RF', 75, 18, 'S']] },
  'W':      { label: 'W-System', posten: [['LV', 36, 82, 'V'], ['RV', 64, 82, 'V'], ['C', 50, 54, 'S'], ['LF', 15, 20, 'S'], ['RF', 85, 20, 'S']] },
  'PP':     { label: 'Standard', posten: [['LV', 32, 82, 'V'], ['RV', 68, 82, 'V'], ['LF', 13, 48, 'S'], ['RF', 87, 48, 'S'], ['Slot', 50, 18, 'S']] },
  'Box':    { label: 'Box', posten: [['LV', 30, 78, 'V'], ['RV', 70, 78, 'V'], ['LS', 30, 38, 'S'], ['RS', 70, 38, 'S']] },
  'Diamant':{ label: 'Diamant', posten: [['V', 50, 84, 'V'], ['L', 17, 52, 'flex'], ['R', 83, 52, 'flex'], ['S', 50, 20, 'S']] },
  '6v5':    { label: '6 gegen 5', posten: [['LV', 30, 84, 'V'], ['RV', 70, 84, 'V'], ['LF', 13, 46, 'S'], ['C', 50, 56, 'S'], ['RF', 87, 46, 'S'], ['Slot', 50, 16, 'S']] },
};
const ROLLEN = { V: 'Verteidigung', S: 'Sturm', flex: 'flexibel' };
const WETTBEWERB = { meisterschaft: 'Meisterschaft', cup: 'Cup', test: 'Testspiel' };
const ORT = { heim: 'Heim', auswaerts: 'Auswärts' };
const TABS = ['einsaetze', 'personen', 'auswertung', 'ideen'];

// ---- kleine Helfer ---------------------------------------------
const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
function datumText(d, mitTag = true) {
  if (!d) return '';
  const [y, m, t] = d.split('-').map(Number);
  const wt = WT[new Date(y, m - 1, t).getDay()];
  return `${mitTag ? wt + ' ' : ''}${t}.${m}.${y}`;
}
const heute = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const formLabel = l => `${ARTEN[l.art].kurz} ${l.nr}`;
const istFeld = k => k.rolle === 'spieler' && k.position !== 'Goalie';
// Testspiel = Match mit Wettbewerb 'test' (gleich wie im Statistik-Tool)
const istTest = e => e?.typ === 'match' && e?.wettbewerb === 'test';
const artVon = e => istTest(e) ? 'test' : e.typ;
const typIcon = e => ({ training: '🏋️', match: '🏆', test: '🤝' })[artVon(e)];
const typText = e => ({ training: 'Training', match: 'Match', test: 'Testspiel' })[artVon(e)];
const nachArt = (a, b) => ART_REIHE.indexOf(a.art) - ART_REIHE.indexOf(b.art) || a.nr - b.nr;
const plural = (n, ein, mehr) => `${n} ${n === 1 ? ein : mehr}`;

function ladeCss() {
  if (document.querySelector('link[data-linien]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = 'linien.css'; l.dataset.linien = '1';
  document.head.appendChild(l);
}

// ================================================================
export async function mount(root) {
  ladeCss();
  const teile = location.hash.replace(/^#\/?/, '').split('/');
  const route = teile[1] === 'e' && teile[2] ? { typ: 'einsatz', id: teile[2] }
    : teile[1] === 'p' && teile[2] ? { typ: 'person', id: teile[2] }
    : { typ: 'start', tab: TABS.includes(teile[1]) ? teile[1] : 'einsaetze' };

  root.innerHTML = `<div class="ln"><p class="muted pad">Lade …</p></div><dialog class="dlg ln-dlg"></dialog>`;
  const box = root.querySelector('.ln');
  const dlg = root.querySelector('.ln-dlg');

  // Gemeinsamer Zustand
  const S = {
    st: { saisons: [], teams: [], listen: [] },
    saisonId: null, teamId: null, liste: null,
    kader: [], kMap: new Map(), kurz: new Map(),
  };
  const saison = () => S.st.saisons.find(s => s.id === S.saisonId);
  const team = () => S.st.teams.find(t => t.id === S.teamId);
  const nurLesen = () => !!saison()?.archiviert;
  const feldAktiv = () => S.kader.filter(k => istFeld(k) && k.aktiv);

  function setzeKader(liste) {
    S.kader = liste;
    S.kMap = new Map(liste.map(k => [k.id, k]));
    // Kurzname = Vorname, bei Doppelten mit Initiale des Nachnamens
    const vor = k => k.name.split(' ')[0];
    const zahl = {};
    liste.forEach(k => { zahl[vor(k)] = (zahl[vor(k)] || 0) + 1; });
    S.kurz = new Map(liste.map(k => {
      const t = k.name.split(' ');
      return [k.id, zahl[t[0]] > 1 && t[1] ? `${t[0]} ${t[1][0]}.` : t[0]];
    }));
  }
  const nameVon = r => r.kader_id ? (S.kMap.get(r.kader_id)?.name ?? '?') : `${r.gast_name} (Gast)`;
  const kurzVon = r => r.kader_id ? (S.kurz.get(r.kader_id) ?? '?') : r.gast_name;

  // Saison/Team bestimmen (wie im Kader-Tool) und Kader laden
  async function ladeBasis(listeId = null) {
    S.st = await ladeStammdaten();
    if (listeId) {
      const l = S.st.listen.find(x => x.id === listeId);
      if (l) { S.saisonId = l.saison_id; S.teamId = l.team_id; setAuswahl({ saisonId: l.saison_id, teamId: l.team_id }); }
    }
    const a = getAuswahl();
    const sOk = id => S.st.saisons.some(s => s.id === id);
    const tOk = id => S.st.teams.some(t => t.id === id);
    S.saisonId = sOk(S.saisonId) ? S.saisonId : sOk(a.saisonId) ? a.saisonId
      : (S.st.saisons.find(s => !s.archiviert) || S.st.saisons[0])?.id ?? null;
    S.teamId = tOk(S.teamId) ? S.teamId : tOk(a.teamId) ? a.teamId : S.st.teams[0]?.id ?? null;
    S.liste = S.st.listen.find(l => l.saison_id === S.saisonId && l.team_id === S.teamId) || null;
    setzeKader(S.liste ? await ladeKader(S.liste.id) : []);
  }

  // ---- Dialog-Helfer ------------------------------------------
  function oeffneDialog(html, setup) {
    dlg.innerHTML = `<div class="dlg-body">${html}</div>`;
    dlg.showModal();
    setup?.(dlg);
  }
  const schliesse = () => dlg.open && dlg.close();
  async function db(promise, ok) {
    const { data, error } = await promise;
    if (error) { toast(fehlerText(error), 'error'); throw error; }
    if (ok) toast(ok, 'ok');
    return data;
  }

  // ---- Live-Updates: Ansicht neu laden (nicht während Eingabe) -
  let neuLaden = async () => {};
  let timer, wartet = false;
  const tippt = () => {
    const a = document.activeElement;
    return a && root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
  };
  const spaeter = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (dlg.open || tippt()) { wartet = true; return; }
      neuLaden().catch(() => {});
    }, 300);
  };
  root.addEventListener('focusout', () => setTimeout(() => {
    if (wartet && !tippt() && !dlg.open) { wartet = false; neuLaden().catch(() => {}); }
  }, 50));
  dlg.addEventListener('close', () => { if (wartet) { wartet = false; spaeter(); } });

  const kanal = sb.channel('linien-live');
  for (const table of ['einsaetze', 'varianten', 'linien', 'linien_spieler', 'kader'])
    kanal.on('postgres_changes', { event: '*', schema: 'public', table }, spaeter);
  kanal.subscribe();

  const aufraeumen = () => {
    clearTimeout(timer);
    sb.removeChannel(kanal);
    if (dlg.open) dlg.close();
  };

  try {
    if (route.typ === 'einsatz') await zeigeEinsatz(route.id);
    else if (route.typ === 'person') await zeigePerson(route.id);
    else await zeigeStart(route.tab);
  } catch (e) {
    box.innerHTML = `<p class="error pad">${esc(fehlerText(e))}</p>`;
  }
  return aufraeumen;

  // ==============================================================
  //  ÜBERSICHT
  // ==============================================================
  async function zeigeStart(tab) {
    let filter = 'alle';
    let einsaetze = [];

    neuLaden = async () => { await ladeBasis(); await zeichne(); };

    async function zeichne() {
      const vereine = new Set(S.st.teams.map(t => t.verein));
      const opt = s => `<option value="${s.id}" ${s.id === S.saisonId ? 'selected' : ''}>${esc(s.name)}</option>`;
      const aktiv = S.st.saisons.filter(s => !s.archiviert), archiv = S.st.saisons.filter(s => s.archiviert);
      box.innerHTML = `
        <div class="kontext">
          <label class="sel-wrap">Saison
            <select class="sel-saison" ${S.st.saisons.length ? '' : 'disabled'}>
              ${aktiv.map(opt).join('')}${archiv.length ? `<optgroup label="📦 Archiv">${archiv.map(opt).join('')}</optgroup>` : ''}
            </select>
          </label>
        </div>
        <div class="team-chips">${S.st.teams.map(t => `
          <button class="chip ${t.id === S.teamId ? 'on' : ''}" data-id="${t.id}">
            ${vereine.size > 1 ? `<small>${esc(t.verein)}</small>` : ''}${esc(t.name)}</button>`).join('')}</div>
        ${nurLesen() ? '<div class="banner">📦 Archivierte Saison – nur Ansicht</div>' : ''}
        <div class="ln-inhalt"></div>
        <button class="fab" hidden aria-label="Neu">＋</button>`;

      box.querySelector('.sel-saison').onchange = e => { S.saisonId = e.target.value; setAuswahl({ saisonId: S.saisonId }); neuLaden(); };
      box.querySelector('.team-chips').onclick = e => {
        const b = e.target.closest('.chip'); if (!b) return;
        S.teamId = b.dataset.id; setAuswahl({ teamId: S.teamId }); neuLaden();
      };

      const inhalt = box.querySelector('.ln-inhalt');
      if (!S.st.saisons.length || !S.st.teams.length || !S.liste) {
        inhalt.innerHTML = `<div class="hinweis">
          <p>${!S.st.saisons.length || !S.st.teams.length ? 'Es gibt noch keine Saison bzw. kein Team.'
            : `<b>${esc(teamLabel(team()))}</b> hat in der Saison <b>${esc(saison()?.name)}</b> noch keinen Kader.`}</p>
          <a class="btn primary" href="#/kader">Zum Kader</a></div>`;
        return;
      }

      inhalt.innerHTML = `
        <div class="seg ln-tabs">
          <button data-t="einsaetze" class="${tab === 'einsaetze' ? 'on' : ''}">Einsätze</button>
          <button data-t="personen" class="${tab === 'personen' ? 'on' : ''}">Personen</button>
          <button data-t="auswertung" class="${tab === 'auswertung' ? 'on' : ''}">Auswertung</button>
          <button data-t="ideen" class="${tab === 'ideen' ? 'on' : ''}">💡 Ideen</button>
        </div>
        <div class="ln-tab"><p class="muted pad">Lade …</p></div>`;
      inhalt.querySelector('.ln-tabs').onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        tab = b.dataset.t;
        history.replaceState(null, '', tab === 'einsaetze' ? '#/linien' : `#/linien/${tab}`);
        zeichne();
      };
      const ziel = inhalt.querySelector('.ln-tab');
      const fab = box.querySelector('.fab');
      fab.hidden = nurLesen() || tab !== 'einsaetze';
      if (tab === 'einsaetze') await tabEinsaetze(ziel, fab);
      else if (tab === 'personen') await tabPersonen(ziel);
      else if (tab === 'ideen') zeichneIdeen(ziel, await ladeBaum(S.liste.id),
        { kMap: S.kMap, kurz: S.kurz, personen: S.kader.filter(istFeld) });
      else zeichneAuswertung(ziel, await ladeBaum(S.liste.id),
        { kMap: S.kMap, kurz: S.kurz, personen: S.kader.filter(istFeld) });
    }

    // ---- Tab Einsätze -------------------------------------------
    async function tabEinsaetze(ziel, fab) {
      einsaetze = await db(sb.from('einsaetze')
        .select('*, varianten(id, nr, name)')
        .eq('liste_id', S.liste.id).order('datum', { ascending: false }));
      einsaetze.sort((a, b) => b.datum.localeCompare(a.datum) || b.erstellt_am.localeCompare(a.erstellt_am));
      fab.onclick = () => einsatzDialog(null, einsaetze);

      const zeigen = () => {
        const liste = einsaetze.filter(e => filter === 'alle' || artVon(e) === filter);
        ziel.querySelector('.ln-liste').innerHTML = liste.length ? liste.map(e => {
          const info = [datumText(e.datum), e.varianten.length > 1 ? `${e.varianten.length} Versionen` : null,
            e.typ === 'match' && e.wettbewerb && !istTest(e) ? WETTBEWERB[e.wettbewerb] : null,
            e.typ === 'match' && e.ort ? ORT[e.ort] : null].filter(Boolean).join(' · ');
          return `<a class="karte ln-einsatz" href="#/linien/e/${e.id}">
            <span class="nr ln-typ ${artVon(e)}">${typIcon(e)}</span>
            <span class="info"><strong>${esc(e.titel || typText(e))}${e.resultat ? ` <span class="ln-res">${esc(e.resultat)}</span>` : ''}</strong>
              <small>${esc(info)}</small></span>
          </a>`;
        }).join('') : `<p class="muted pad leer">${einsaetze.length ? 'Keine Einträge für diesen Filter.'
          : nurLesen() ? 'Keine Einsätze erfasst.' : 'Noch keine Einsätze.<br>Tippe auf <b>＋</b> für das erste Training oder den ersten Match.'}</p>`;
      };
      ziel.innerHTML = `
        <div class="seg ln-filter">
          <button data-f="alle" class="${filter === 'alle' ? 'on' : ''}">Alle</button>
          <button data-f="training" class="${filter === 'training' ? 'on' : ''}">🏋️ Training</button>
          <button data-f="match" class="${filter === 'match' ? 'on' : ''}">🏆 Match</button>
          <button data-f="test" class="${filter === 'test' ? 'on' : ''}">🤝 Test</button>
        </div>
        <div class="ln-liste"></div>`;
      ziel.querySelector('.ln-filter').onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        filter = b.dataset.f;
        ziel.querySelectorAll('.ln-filter button').forEach(x => x.classList.toggle('on', x === b));
        zeigen();
      };
      zeigen();
    }

    // ---- Tab Personen -------------------------------------------
    async function tabPersonen(ziel) {
      const baum = await ladeBaum(S.liste.id);
      const stat = new Map();
      for (const e of baum) for (const v of e.varianten) for (const l of v.linien) for (const r of l.linien_spieler) {
        if (!r.kader_id) continue;
        const s = stat.get(r.kader_id) || { einsaetze: new Set() };
        s.einsaetze.add(e.id);
        stat.set(r.kader_id, s);
      }
      const personen = S.kader.filter(istFeld).sort((a, b) => (b.aktiv - a.aktiv) || (a.nummer ?? 999) - (b.nummer ?? 999) || a.name.localeCompare(b.name, 'de'));
      const andere = andereNummern(S.kader, baum.flatMap(e => e.match_aufstellung || []));
      ziel.innerHTML = personen.length ? `
        <p class="summary muted">Tippe auf eine Person für ihre Linien-Historie.</p>
        <ul class="karten">${personen.map(k => {
          const s = stat.get(k.id);
          return `<li><a class="karte ${k.aktiv ? '' : 'ln-inaktiv'}" href="#/linien/p/${k.id}">
            <span class="nr">${k.nummer ?? '–'}</span>
            <span class="info"><strong>${esc(k.name)}${auchNr(andere.get(k.id))}</strong>
              <small>${s ? plural(s.einsaetze.size, 'Einsatz', 'Einsätze') : 'noch keine Einsätze'}${k.aktiv ? '' : ' · inaktiv'}</small></span>
          </a></li>`;
        }).join('')}</ul>` : '<p class="muted pad leer">Keine Feldspieler:innen im Kader.</p>';
    }

    await ladeBasis();
    await zeichne();
  }

  // Alle Einsätze eines Kaders mit Versionen, Linien und Personen
  async function ladeBaum(listeId) {
    const d = await db(sb.from('einsaetze')
      .select('id, datum, typ, titel, wettbewerb, erstellt_am, varianten(id, nr, name, linien(id, art, nr, name, system, note, anzahl, tore, linien_spieler(kader_id, gast_name, posten, rolle))), match_ereignisse(id, art, zeit, kader_id, assist_id, situation, minuten, variante_id, linie_id), match_aufstellung(kader_id, nummer)')
      .eq('liste_id', listeId));
    return d.sort((a, b) => b.datum.localeCompare(a.datum) || b.erstellt_am.localeCompare(a.erstellt_am));
  }

  // ---- Einsatz anlegen / bearbeiten ----------------------------
  function einsatzDialog(e, alle = []) {
    // Vorlagen zum Übernehmen (Suche über alle Einsätze dieses Kaders)
    const vorlagen = alle.flatMap(x => [...x.varianten].sort((a, b) => a.nr - b.nr).map(v => ({
      id: v.id, icon: typIcon(x),
      text: `${datumText(x.datum)} · ${x.titel || typText(x)}${x.varianten.length > 1 ? ` · ${v.name || 'Version ' + v.nr}` : ''}`,
      such: `${datumText(x.datum)} ${x.datum} ${x.titel || ''} ${typText(x)} ${v.name || ''} version ${v.nr}`.toLowerCase(),
    })));
    const typ0 = e ? artVon(e) : 'training';
    oeffneDialog(`
      <h2>${e ? 'Einsatz bearbeiten' : 'Neuer Einsatz'}</h2>
      <div class="seg ln-etyp"><button data-t="training" class="${typ0 === 'training' ? 'on' : ''}">🏋️ Training</button><button data-t="match" class="${typ0 === 'match' ? 'on' : ''}">🏆 Match</button><button data-t="test" class="${typ0 === 'test' ? 'on' : ''}">🤝 Testspiel</button></div>
      <label>Datum<input type="date" name="datum" value="${e?.datum || heute()}" required></label>
      <label><span class="ln-titel-lbl">Titel</span><input name="titel" value="${esc(e?.titel || '')}" autocomplete="off"></label>
      <div class="ln-nur-match">
        <label>Resultat<input name="resultat" value="${esc(e?.resultat || '')}" placeholder="z.B. 6:4" autocomplete="off"></label>
        <label class="ln-wettb">Wettbewerb<select name="wettbewerb"><option value="">–</option>
          ${Object.entries(WETTBEWERB).filter(([k]) => k !== 'test').map(([k, v]) => `<option value="${k}" ${e?.wettbewerb === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Heim / Auswärts<select name="ort"><option value="">–</option>
          ${Object.entries(ORT).map(([k, v]) => `<option value="${k}" ${e?.ort === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      </div>
      <label>Notiz<textarea name="notiz" rows="2">${esc(e?.notiz || '')}</textarea></label>
      ${e ? '' : `<div class="ln-vorlage"><span class="ln-lbl">Linien</span>
        <div class="seg ln-vmodus"><button data-v="neu" class="on">＋ Neue Linien</button><button data-v="kopie" ${vorlagen.length ? '' : 'disabled'}>↻ Übernehmen</button></div>
        <div class="ln-vsuche" hidden>
          <input type="search" class="ln-vsuch" placeholder="Suchen: Datum, Gegner, Titel …" autocomplete="off">
          <ul class="ln-vtreffer"></ul>
          <p class="muted klein">Übernommen werden Linien, Powerplay & Boxplay mit allen aktiven Personen.</p>
        </div></div>`}
      <p class="error ln-v-err" hidden></p>
      <div class="dlg-actions">
        ${e ? '<button class="btn danger btn-del">Löschen</button><span style="flex:1"></span>' : ''}
        <button class="btn ghost btn-zu">Abbrechen</button>
        <button class="btn primary btn-ok">${e ? 'Speichern' : 'Erstellen'}</button>
      </div>`, d => {
      let typ = typ0;
      const setTyp = t => {
        typ = t;
        d.querySelectorAll('.ln-etyp button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
        d.querySelector('.ln-nur-match').hidden = t === 'training';
        d.querySelector('.ln-wettb').hidden = t !== 'match';
        d.querySelector('.ln-titel-lbl').textContent = t === 'training' ? 'Titel / Thema (optional)' : 'Gegner';
        d.querySelector('[name=titel]').placeholder = t === 'training' ? 'z.B. Abschlusstraining' : 'z.B. UHC Muster';
      };
      setTyp(typ);
      // Linien: neu (Standard) oder von früherem Einsatz übernehmen (mit Suche)
      let vmodus = 'neu', vorlage = null;
      const zeigeTreffer = () => {
        const q = d.querySelector('.ln-vsuch').value.toLowerCase().split(/\s+/).filter(Boolean);
        const treffer = (q.length ? vorlagen.filter(v => q.every(w => v.such.includes(w))) : vorlagen).slice(0, q.length ? 8 : 5);
        d.querySelector('.ln-vtreffer').innerHTML = treffer.length ? treffer.map(v =>
          `<li><button class="ln-vt ${v.id === vorlage ? 'on' : ''}" data-v="${v.id}">${v.icon} ${esc(v.text)}</button></li>`).join('')
          : '<li class="muted klein">Nichts gefunden.</li>';
      };
      d.querySelector('.ln-vmodus')?.addEventListener('click', ev => {
        const b = ev.target.closest('button'); if (!b || b.disabled) return;
        vmodus = b.dataset.v;
        d.querySelectorAll('.ln-vmodus button').forEach(x => x.classList.toggle('on', x === b));
        d.querySelector('.ln-vsuche').hidden = vmodus !== 'kopie';
        if (vmodus === 'kopie') { zeigeTreffer(); d.querySelector('.ln-vsuch').focus(); }
      });
      d.querySelector('.ln-vsuch')?.addEventListener('input', zeigeTreffer);
      d.querySelector('.ln-vtreffer')?.addEventListener('click', ev => {
        const b = ev.target.closest('.ln-vt'); if (!b) return;
        vorlage = b.dataset.v; d.querySelector('.ln-v-err').hidden = true; zeigeTreffer();
      });
      d.querySelector('.ln-etyp').onclick = ev => { const b = ev.target.closest('button'); if (b) setTyp(b.dataset.t); };
      d.querySelector('.btn-zu').onclick = schliesse;
      d.querySelector('.btn-del')?.addEventListener('click', async () => {
        if (!confirm('Diesen Einsatz mit allen Versionen und Linien löschen?')) return;
        await db(sb.from('einsaetze').delete().eq('id', e.id), 'Einsatz gelöscht');
        schliesse(); location.hash = '#/linien';
      });
      d.querySelector('.btn-ok').onclick = async () => {
        const f = n => d.querySelector(`[name=${n}]`).value.trim() || null;
        const spiel = typ !== 'training';   // Match oder Testspiel
        const daten = { typ: spiel ? 'match' : 'training', datum: f('datum') || heute(), titel: f('titel'), notiz: f('notiz'),
          resultat: spiel ? f('resultat') : null,
          wettbewerb: typ === 'test' ? 'test' : typ === 'match' ? f('wettbewerb') : null,
          ort: spiel ? f('ort') : null };
        if (!e && vmodus === 'kopie' && !vorlage) {
          const err = d.querySelector('.ln-v-err');
          err.textContent = 'Bitte einen Einsatz zum Übernehmen auswählen – oder „Neue Linien“.'; err.hidden = false; return;
        }
        const btn = d.querySelector('.btn-ok'); btn.disabled = true;
        try {
          if (e) {
            await db(sb.from('einsaetze').update(daten).eq('id', e.id), 'Gespeichert');
            schliesse(); neuLaden();
          } else {
            const neu = await db(sb.from('einsaetze').insert({ ...daten, liste_id: S.liste.id }).select().single());
            if (vmodus === 'kopie' && vorlage) await kopiereVariante(vorlage, neu.id, 1, null);
            else await neueVariante(neu.id, 1, null);
            toast('Einsatz erstellt', 'ok');
            schliesse(); location.hash = `#/linien/e/${neu.id}`;
          }
        } catch { btn.disabled = false; }
      };
    });
  }

  async function neueVariante(einsatzId, nr, name) {
    const v = await db(sb.from('varianten').insert({ einsatz_id: einsatzId, nr, name }).select().single());
    await db(sb.from('linien').insert([1, 2, 3, 4].map(n => ({ variante_id: v.id, art: 'linie', nr: n, system: '2-2-1' }))));
    return v;
  }

  async function kopiereVariante(quelleId, einsatzId, nr, name) {
    const linien = await db(sb.from('linien').select('*, linien_spieler(*)').eq('variante_id', quelleId));
    const v = await db(sb.from('varianten').insert({ einsatz_id: einsatzId, nr, name }).select().single());
    for (const l of linien.sort(nachArt)) {
      const neu = await db(sb.from('linien').insert({ variante_id: v.id, art: l.art, nr: l.nr, name: l.name, system: l.system }).select().single());
      const leute = l.linien_spieler.filter(r => !r.kader_id || S.kMap.get(r.kader_id)?.aktiv);
      if (leute.length) await db(sb.from('linien_spieler').insert(leute.map(r => ({
        linie_id: neu.id, kader_id: r.kader_id, gast_name: r.gast_name, posten: r.posten, rolle: r.rolle, sort: r.sort,
      }))));
    }
    return v;
  }

  // ==============================================================
  //  EINSATZ
  // ==============================================================
  async function zeigeEinsatz(id) {
    let E = null, V = [], aktivVar = null;

    async function lade() {
      const e = await db(sb.from('einsaetze').select('*, match_ereignisse(id), match_aufstellung(kader_id, nummer)').eq('id', id));
      E = e[0];
      if (!E) { box.innerHTML = `<div class="hinweis"><p>Dieser Einsatz existiert nicht (mehr).</p><a class="btn primary" href="#/linien">Zur Übersicht</a></div>`; return false; }
      await ladeBasis(E.liste_id);
      V = await db(sb.from('varianten').select('*, linien(*, linien_spieler(*))').eq('einsatz_id', id));
      V.sort((a, b) => a.nr - b.nr);
      V.forEach(v => { v.linien.sort(nachArt); v.linien.forEach(l => l.linien_spieler.sort((a, b) => a.sort - b.sort || a.erstellt_am?.localeCompare(b.erstellt_am))); });
      if (!V.some(v => v.id === aktivVar)) aktivVar = V[0]?.id ?? null;
      return true;
    }
    neuLaden = async () => { if (await lade()) zeichne(); };
    const variante = () => V.find(v => v.id === aktivVar);

    function zeichne() {
      const ro = nurLesen();
      const info = [datumText(E.datum), typText(E), E.typ === 'match' && E.wettbewerb && !istTest(E) ? WETTBEWERB[E.wettbewerb] : null,
        E.typ === 'match' && E.ort ? ORT[E.ort] : null, teamLabel(team())].filter(Boolean).join(' · ');
      box.innerHTML = `
        <div class="ln-kopf">
          <a class="btn ghost small" href="#/linien">‹</a>
          <div class="ln-kopf-info">
            <strong>${typIcon(E)} ${esc(E.titel || typText(E))}${E.resultat ? ` <span class="ln-res">${esc(E.resultat)}</span>` : ''}</strong>
            <small class="muted">${esc(info)}</small>
          </div>
          ${E.typ === 'match' ? `<a class="btn ghost small ln-stat-link" href="#/statistik/m/${E.id}" title="Match-Statistik">📊</a>` : ''}
          ${ro ? '' : '<button class="btn ghost small ln-e-edit" title="Bearbeiten">✏️</button>'}
        </div>
        ${E.notiz ? `<p class="ln-e-notiz">${esc(E.notiz)}</p>` : ''}
        ${ro ? '<div class="banner">📦 Archivierte Saison – nur Ansicht</div>' : ''}
        <div class="team-chips ln-versionen">
          ${V.map(v => `<button class="chip ${v.id === aktivVar ? 'on' : ''}" data-v="${v.id}">${esc(v.name ? `${v.nr} · ${v.name}` : `Version ${v.nr}`)}</button>`).join('')}
          ${ro ? '' : `${V.length ? '<button class="chip ln-v-mehr" title="Version bearbeiten">⋯</button>' : ''}<button class="chip ln-v-neu">＋ Version</button>`}
        </div>
        <div class="ln-body"></div>`;

      box.querySelector('.ln-e-edit')?.addEventListener('click', () => einsatzDialog(E));
      box.querySelector('.ln-versionen').onclick = ev => {
        const b = ev.target.closest('.chip'); if (!b) return;
        if (b.classList.contains('ln-v-neu')) return versionDialog(null);
        if (b.classList.contains('ln-v-mehr')) return versionDialog(variante());
        aktivVar = b.dataset.v; zeichne();
      };

      const body = box.querySelector('.ln-body');
      if (!V.length) {
        body.innerHTML = `<p class="muted pad leer">Dieser Einsatz hat keine Version.${ro ? '' : '<br>Tippe auf <b>＋ Version</b>.'}</p>`;
        return;
      }
      zeichneAufstellen(body, ro);
    }

    // Wo steht eine Person sonst noch in dieser Version?
    function einsaetzeIn(v, kaderId) {
      return v.linien.flatMap(l => l.linien_spieler.filter(r => r.kader_id === kaderId).map(r => ({ l, r })));
    }

    // Rückennummer: im Match die Nummer aus der Match-Statistik, sonst die Kader-Nummer
    const nrVon = kid => E?.match_aufstellung?.find(a => a.kader_id === kid)?.nummer ?? S.kMap.get(kid)?.nummer ?? null;

    // ---- Spielfeld einer Formation -------------------------------
    function feldHTML(l, v, { klickbar = true } = {}) {
      const sys = SYSTEME[l.system] || SYSTEME[ARTEN[l.art].systeme[0]];
      const posten = sys.posten.map(([p, x, y, rolle]) => {
        const r = l.linien_spieler.find(s => s.posten === p);
        const doppelt = r?.kader_id && l.art === 'linie' &&
          einsaetzeIn(v, r.kader_id).filter(z => z.l.art === 'linie').length > 1;
        return `<button class="ln-post rolle-${rolle} ${r ? 'voll' : 'leer'}" style="left:${x}%;top:${y}%"
            data-l="${l.id}" data-p="${p}" ${klickbar ? '' : 'disabled tabindex="-1"'} title="${esc(p)}">
          <span class="ln-kreis">${r ? esc(r.kader_id ? (nrVon(r.kader_id) ?? '–') : 'G') : esc(p)}</span>
          <span class="ln-name">${r ? esc(kurzVon(r)) : (klickbar ? '＋' : '')}</span>
          ${r ? `<span class="ln-tag">${esc(p)}</span>` : ''}
          ${doppelt ? '<span class="ln-2x" title="Steht in mehreren Linien">2×</span>' : ''}
        </button>`;
      }).join('');
      const zusatz = l.linien_spieler.filter(s => s.posten === 'Z');
      return `<div class="ln-feld"><span class="ln-tor"></span>${posten}</div>
        ${zusatz.length || klickbar ? `<div class="ln-zusatz">
          ${zusatz.map(r => `<button class="ln-zchip rolle-${r.rolle}" data-l="${l.id}" data-z="${r.id}" ${klickbar ? '' : 'disabled'}>
            <b>${esc(r.kader_id ? (nrVon(r.kader_id) ?? '–') : 'G')}</b> ${esc(kurzVon(r))} <small>${r.rolle === 'flex' ? 'flex' : r.rolle}</small></button>`).join('')}
          ${klickbar ? `<button class="ln-zchip neu" data-l="${l.id}" data-z="neu">＋ Zusatz</button>` : ''}
        </div>` : ''}`;
    }

    // ---- Modus Aufstellen ----------------------------------------
    function zeichneAufstellen(body, ro) {
      const v = variante();
      const html = ART_REIHE.map(art => {
        const formen = v.linien.filter(l => l.art === art);
        if (!formen.length) return '';
        return `<h3 class="gruppe">${ARTEN[art].titel} <span>${formen.length}</span></h3>
          <div class="ln-formen">${formen.map(l => `
            <div class="ln-form" data-id="${l.id}">
              <div class="ln-form-kopf">
                <strong>${formLabel(l)}</strong>${l.name ? `<span class="ln-fname">${esc(l.name)}</span>` : ''}
                <span style="flex:1"></span>
                ${ARTEN[art].systeme.length > 1 && !ro ? `<select class="ln-system" data-l="${l.id}">${ARTEN[art].systeme.map(s =>
                  `<option value="${s}" ${s === l.system ? 'selected' : ''}>${SYSTEME[s].label}</option>`).join('')}</select>`
                  : `<span class="muted klein">${SYSTEME[l.system]?.label ?? ''}</span>`}
                ${ro ? '' : `<button class="btn ghost small ln-f-mehr" data-l="${l.id}" title="Umbenennen / Löschen">⋯</button>`}
              </div>
              ${feldHTML(l, v, { klickbar: !ro })}
            </div>`).join('')}</div>
          ${ro ? '' : `<button class="btn ghost small ln-f-neu" data-art="${art}">${ARTEN[art].neu}</button>`}`;
      }).join('');
      const fehlend = ro ? [] : ART_REIHE.filter(a => !v.linien.some(l => l.art === a));
      body.innerHTML = html + (fehlend.length ? `<div class="ln-neu-arten">${fehlend.map(a =>
        `<button class="btn ghost small ln-f-neu" data-art="${a}">${ARTEN[a].neu}</button>`).join('')}</div>` : '')
        + nichtEingeteiltHTML(v);

      body.onclick = ev => {
        const t = ev.target.closest('button'); if (!t || ro) return;
        const l = v.linien.find(x => x.id === t.dataset.l);
        if (t.classList.contains('ln-post')) return pickDialog(l, t.dataset.p, null);
        if (t.classList.contains('ln-zchip')) return pickDialog(l, 'Z', t.dataset.z === 'neu' ? null : l.linien_spieler.find(r => r.id === t.dataset.z));
        if (t.classList.contains('ln-f-mehr')) return formDialog(l);
        if (t.classList.contains('ln-f-neu')) return neueForm(t.dataset.art);
      };
      body.onchange = ev => {
        if (ev.target.classList.contains('ln-system')) wechsleSystem(v.linien.find(x => x.id === ev.target.dataset.l), ev.target.value);
      };
    }

    function nichtEingeteiltHTML(v) {
      const drin = new Set(v.linien.filter(l => l.art === 'linie').flatMap(l => l.linien_spieler.map(r => r.kader_id)));
      const frei = feldAktiv().filter(k => !drin.has(k.id));
      return `<div class="ln-frei"><h3 class="gruppe">Nicht in einer Linie <span>${frei.length}</span></h3>
        <p>${frei.length ? frei.map(k => `${nrVon(k.id) != null ? `<b>${nrVon(k.id)}</b> ` : ''}${esc(k.name)}`).join(' · ') : 'Alle aktiven Feldspieler:innen sind eingeteilt. 👍'}</p></div>`;
    }

    // ---- Person auf Posten setzen ---------------------------------
    function pickDialog(l, posten, zRow) {
      const v = variante();
      const istZ = posten === 'Z';
      const sys = SYSTEME[l.system];
      const def = sys.posten.find(p => p[0] === posten);
      const aktuell = istZ ? zRow : l.linien_spieler.find(r => r.posten === posten);
      let rolle = istZ ? (zRow?.rolle || 'flex') : def[3];
      const leute = feldAktiv();
      oeffneDialog(`
        <h2>${formLabel(l)} · ${istZ ? 'Zusatzplatz' : esc(posten)}</h2>
        ${istZ ? `<div class="seg ln-rolle">${Object.entries(ROLLEN).map(([k, t]) => `<button data-r="${k}" class="${k === rolle ? 'on' : ''}">${t}</button>`).join('')}</div>`
          : `<p class="muted klein">${ROLLEN[rolle]}</p>`}
        <ul class="ln-pick">${leute.map(k => {
          const sonst = einsaetzeIn(v, k.id).filter(z => !(z.l.id === l.id && z.r.id === aktuell?.id));
          return `<li><button class="ln-pick-p ${aktuell?.kader_id === k.id ? 'on' : ''}" data-k="${k.id}">
            <span class="nr">${nrVon(k.id) ?? '–'}</span>
            <span class="info"><strong>${esc(k.name)}</strong>${sonst.length ? `<small>schon: ${sonst.map(z => `${formLabel(z.l)} ${z.r.posten === 'Z' ? '(Zusatz)' : z.r.posten}`).join(', ')}</small>` : ''}</span>
          </button></li>`;
        }).join('') || '<li class="muted pad">Keine aktiven Feldspieler:innen im Kader.</li>'}</ul>
        <div class="ln-gast"><input name="gast" placeholder="Gast (nicht im Kader)" value="${esc(aktuell?.gast_name || '')}" autocomplete="off"><button class="btn ghost small btn-gast">Gast setzen</button></div>
        <div class="dlg-actions">
          ${aktuell ? `<button class="btn danger btn-leer">${istZ ? 'Entfernen' : 'Leeren'}</button><span style="flex:1"></span>` : ''}
          ${istZ && aktuell ? '<button class="btn ghost btn-rolle">Rolle speichern</button>' : ''}
          <button class="btn ghost btn-zu">Abbrechen</button>
        </div>`, d => {
        d.querySelector('.ln-rolle')?.addEventListener('click', ev => {
          const b = ev.target.closest('button'); if (!b) return;
          rolle = b.dataset.r; d.querySelectorAll('.ln-rolle button').forEach(x => x.classList.toggle('on', x === b));
        });
        d.querySelector('.btn-zu').onclick = schliesse;
        const fertig = async () => { schliesse(); await neuLaden(); };
        d.querySelector('.btn-leer')?.addEventListener('click', async () => {
          await db(sb.from('linien_spieler').delete().eq('id', aktuell.id));
          fertig();
        });
        d.querySelector('.btn-rolle')?.addEventListener('click', async () => {
          await db(sb.from('linien_spieler').update({ rolle }).eq('id', aktuell.id), 'Gespeichert');
          fertig();
        });
        const setze = async wer => {
          // gleiche Person schon in dieser Linie auf anderem Platz → dorthin verschieben
          if (wer.kader_id) {
            const alt = l.linien_spieler.find(r => r.kader_id === wer.kader_id && r.id !== aktuell?.id);
            if (alt) await db(sb.from('linien_spieler').delete().eq('id', alt.id));
          }
          if (aktuell) await db(sb.from('linien_spieler').update({ ...wer, rolle }).eq('id', aktuell.id));
          else await db(sb.from('linien_spieler').insert({
            linie_id: l.id, posten, rolle, ...wer,
            sort: istZ ? Math.max(0, ...l.linien_spieler.map(r => r.sort)) + 1 : 0,
          }));
          fertig();
        };
        d.querySelector('.ln-pick').onclick = ev => {
          const b = ev.target.closest('.ln-pick-p'); if (b) setze({ kader_id: b.dataset.k, gast_name: null }).catch(() => {});
        };
        d.querySelector('.btn-gast').onclick = () => {
          const g = d.querySelector('[name=gast]').value.trim().replace(/\s+/g, ' ');
          if (!g) return toast('Name des Gasts eingeben', 'error');
          setze({ kader_id: null, gast_name: g }).catch(() => {});
        };
      });
    }

    // System wechseln: Personen behalten ihren Posten, wo es ihn gibt;
    // sonst nächster freier Posten mit gleicher Rolle; sonst Zusatzplatz.
    async function wechsleSystem(l, neu) {
      const neuPosten = SYSTEME[neu].posten;
      const namen = new Set(neuPosten.map(p => p[0]));
      const normal = l.linien_spieler.filter(r => r.posten !== 'Z');
      const belegt = new Set(normal.filter(r => namen.has(r.posten)).map(r => r.posten));
      try {
        await db(sb.from('linien').update({ system: neu }).eq('id', l.id));
        for (const r of normal.filter(r => !namen.has(r.posten))) {
          const ziel = neuPosten.find(p => !belegt.has(p[0]) && p[3] === r.rolle) || neuPosten.find(p => !belegt.has(p[0]));
          if (ziel) { belegt.add(ziel[0]); await db(sb.from('linien_spieler').update({ posten: ziel[0], rolle: ziel[3] }).eq('id', r.id)); }
          else await db(sb.from('linien_spieler').update({ posten: 'Z' }).eq('id', r.id));
        }
        toast(`System ${SYSTEME[neu].label}`, 'ok');
      } catch {}
      neuLaden();
    }

    async function neueForm(art) {
      const v = variante();
      const nr = Math.max(0, ...v.linien.filter(l => l.art === art).map(l => l.nr)) + 1;
      await db(sb.from('linien').insert({ variante_id: v.id, art, nr, system: ARTEN[art].systeme[0] }), `${ARTEN[art].kurz} ${nr} hinzugefügt`);
      neuLaden();
    }

    function formDialog(l) {
      oeffneDialog(`
        <h2>${formLabel(l)}</h2>
        <label>Name (optional)<input name="name" value="${esc(l.name || '')}" placeholder="z.B. Junge Wilde" autocomplete="off"></label>
        <div class="dlg-actions">
          <button class="btn danger btn-del">Löschen</button><span style="flex:1"></span>
          <button class="btn ghost btn-zu">Abbrechen</button>
          <button class="btn primary btn-ok">Speichern</button>
        </div>`, d => {
        d.querySelector('.btn-zu').onclick = schliesse;
        d.querySelector('.btn-ok').onclick = async () => {
          await db(sb.from('linien').update({ name: d.querySelector('[name=name]').value.trim() || null }).eq('id', l.id), 'Gespeichert');
          schliesse(); neuLaden();
        };
        d.querySelector('.btn-del').onclick = async () => {
          if (!confirm(`${formLabel(l)} mit Aufstellung löschen?`)) return;
          await db(sb.from('linien').delete().eq('id', l.id), `${formLabel(l)} gelöscht`);
          // Nachfolgende neu nummerieren
          for (const x of variante().linien.filter(x => x.art === l.art && x.nr > l.nr))
            await db(sb.from('linien').update({ nr: x.nr - 1 }).eq('id', x.id));
          schliesse(); neuLaden();
        };
      });
    }

    function versionDialog(v) {
      oeffneDialog(`
        <h2>${v ? `Version ${v.nr}` : 'Neue Version'}</h2>
        <label>Name (optional)<input name="name" value="${esc(v?.name || '')}" placeholder="z.B. Test neue 1. Linie" autocomplete="off"></label>
        ${v ? '' : `<label>Vorlage<select name="vorlage">
          ${V.map(x => `<option value="${x.id}" ${x.id === aktivVar ? 'selected' : ''}>Kopie von ${esc(x.name ? `${x.nr} · ${x.name}` : `Version ${x.nr}`)}</option>`).join('')}
          <option value="">Leer (4 Linien)</option></select></label>`}
        <div class="dlg-actions">
          ${v ? '<button class="btn danger btn-del">Löschen</button><span style="flex:1"></span>' : ''}
          <button class="btn ghost btn-zu">Abbrechen</button>
          <button class="btn primary btn-ok">${v ? 'Speichern' : 'Erstellen'}</button>
        </div>`, d => {
        d.querySelector('.btn-zu').onclick = schliesse;
        d.querySelector('.btn-ok').onclick = async () => {
          const name = d.querySelector('[name=name]').value.trim() || null;
          const btn = d.querySelector('.btn-ok'); btn.disabled = true;
          try {
            if (v) await db(sb.from('varianten').update({ name }).eq('id', v.id), 'Gespeichert');
            else {
              const nr = Math.max(0, ...V.map(x => x.nr)) + 1;
              const vorlage = d.querySelector('[name=vorlage]').value;
              const neu = vorlage ? await kopiereVariante(vorlage, id, nr, name) : await neueVariante(id, nr, name);
              aktivVar = neu.id;
              toast(`Version ${nr} erstellt`, 'ok');
            }
            schliesse(); neuLaden();
          } catch { btn.disabled = false; }
        };
        d.querySelector('.btn-del')?.addEventListener('click', async () => {
          if (!confirm(`Version ${v.nr} mit allen Linien löschen?`)) return;
          await db(sb.from('varianten').delete().eq('id', v.id), 'Version gelöscht');
          aktivVar = null; schliesse(); neuLaden();
        });
      });
    }

    if (await lade()) zeichne();
  }

  // ==============================================================
  //  PERSON – Historie
  // ==============================================================
  async function zeigePerson(kaderId) {
    neuLaden = async () => {
      const k = await db(sb.from('kader').select('*').eq('id', kaderId));
      if (!k[0]) { box.innerHTML = `<div class="hinweis"><p>Diese Person gibt es nicht (mehr).</p><a class="btn primary" href="#/linien/personen">Zurück</a></div>`; return; }
      await ladeBasis(k[0].liste_id);
      const p = S.kMap.get(kaderId) || k[0];
      const baum = await ladeBaum(k[0].liste_id);

      const eintraege = [];
      const partner = new Map();
      for (const e of baum) for (const v of [...e.varianten].sort((a, b) => a.nr - b.nr)) for (const l of [...v.linien].sort(nachArt)) {
        const ich = l.linien_spieler.find(r => r.kader_id === kaderId);
        if (!ich) continue;
        const andere = l.linien_spieler.filter(r => r !== ich);
        eintraege.push({ e, v, l, ich, andere, mehrVersionen: e.varianten.length > 1 });
        if (l.art === 'linie') for (const r of andere) if (r.kader_id) {
          const s = partner.get(r.kader_id) || { n: 0 };
          s.n++;
          partner.set(r.kader_id, s);
        }
      }
      const einsatzIds = new Set(eintraege.map(x => x.e.id));
      const anz = t => new Set(eintraege.filter(x => x.e.typ === t).map(x => x.e.id)).size;
      const zahlArt = a => eintraege.filter(x => x.l.art === a).length;
      const top = [...partner.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 6);

      box.innerHTML = `
        <div class="ln-kopf">
          <a class="btn ghost small" href="#/linien/personen">‹</a>
          <div class="ln-kopf-info"><strong>${p.nummer != null ? `#${p.nummer} ` : ''}${esc(p.name)}${auchNr(andereNummern([p], baum.flatMap(e => e.match_aufstellung || [])).get(p.id))}</strong>
            <small class="muted">${esc([p.position === 'Feld' ? 'Feldspieler:in' : null, saison()?.name, teamLabel(team()), p.aktiv ? null : 'inaktiv'].filter(Boolean).join(' · '))}</small></div>
        </div>
        <div class="ln-kacheln">
          <div><b>${einsatzIds.size}</b><small>Einsätze</small></div>
          <div><b>${anz('training')} / ${anz('match')}</b><small>Training / Match</small></div>
          <div><b>${zahlArt('pp')} / ${zahlArt('bp')}</b><small>PP / BP</small></div>
        </div>
        ${top.length ? `<h3 class="gruppe">Häufigste Partner:innen (Linien)</h3>
          <ul class="ln-partner">${top.map(([id, s]) => `<li><span>${esc(S.kMap.get(id)?.name ?? '?')}</span>
            <small class="muted">${s.n}×</small></li>`).join('')}</ul>` : ''}
        <h3 class="gruppe">Verlauf <span>${eintraege.length}</span></h3>
        ${eintraege.length ? `<ul class="ln-verlauf">${eintraege.map(x => `
          <li><a href="#/linien/e/${x.e.id}">
            <div class="ln-v-kopf"><span>${typIcon(x.e)} <b>${esc(datumText(x.e.datum))}</b> ${esc(x.e.titel || '')}${(() => { const n = x.e.match_aufstellung?.find(a => a.kader_id === p.id)?.nummer; return n != null && n !== p.nummer ? ` <span class="nr-auch">#${n}</span>` : ''; })()}</span></div>
            <small>${esc(formLabel(x.l))}${x.l.name ? ` „${esc(x.l.name)}“` : ''} · ${x.ich.posten === 'Z' ? `Zusatz (${ROLLEN[x.ich.rolle]})` : esc(x.ich.posten)}${x.mehrVersionen ? ` · ${esc(x.v.name || 'Version ' + x.v.nr)}` : ''}</small>
            <small class="muted">mit ${x.andere.length ? x.andere.map(r => esc(nameVon(r))).join(', ') : 'niemandem'}</small>
          </a></li>`).join('')}</ul>` : '<p class="muted pad leer">Noch in keiner Linie eingeteilt.</p>'}`;
    };
    await neuLaden();
  }
}
