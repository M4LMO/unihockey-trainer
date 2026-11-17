// ============================================================
//  Tool: Meine Stats – persönliche Statistik (nur Admin + Zuschauer:in)
//  Eigene Spiele als Trainer, als Spieler (Goalie) und als Fan,
//  Rangtabellen und Auswertungen. Unabhängig von den Teams der App.
//
//  Ansichten (Hash):
//    #/meinestats              Übersicht (Karriere-Total)
//    #/meinestats/spiele       Spiele pro Saison/Team (erfassen, ändern)
//    #/meinestats/auswertung   Bilanzen, Gegner, Hallen, Ligen
//    #/meinestats/verwaltung   Vereine, Hallen, Papierkorb
// ============================================================
import { sb } from './supabase.js';
import { esc, toast, fehlerText } from './ui.js';
import { ladeIch, sperrGrund } from './kontext.js';
import * as M from './meinestats-logik.js';

const TABS = { uebersicht: 'Übersicht', spiele: 'Spiele', auswertung: 'Auswertung', verwaltung: 'Verwaltung' };
const TABELLEN = ['ms_vereine', 'ms_hallen', 'ms_abschnitte', 'ms_spiele', 'ms_tabellen'];
const SPEICHER = 'tt-meinestats';
// Spalten der Rangtabelle (Editor)
const SPALTEN = [['rang', '#'], ['sp', 'Sp'], ['s', 'S'], ['u', 'U'], ['snv', 'SnV'], ['nnv', 'NnV'], ['n', 'N'], ['tore', 'T'], ['gegentore', 'GT'], ['punkte', 'P']];
const plural = (n, ein, mehr) => `${n} ${n === 1 ? ein : mehr}`;
const kpi = (wert, text, sub = '') => `<div><b>${wert}</b><small>${text}</small>${sub ? `<em>${sub}</em>` : ''}</div>`;
const heute = () => new Date().toISOString().slice(0, 10);

function getEinst() { try { return JSON.parse(localStorage.getItem(SPEICHER)) || {}; } catch { return {}; } }
function setEinst(neu) { try { localStorage.setItem(SPEICHER, JSON.stringify({ ...getEinst(), ...neu })); } catch {} }

function ladeCss() {
  if (document.querySelector('link[data-meinestats]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = 'meinestats.css' + (window.APP_V ? `?v=${encodeURIComponent(window.APP_V)}` : ''); l.dataset.meinestats = '1';
  document.head.appendChild(l);
}

async function ladeAlle(tab) {
  const rows = [];
  for (let von = 0; ; von += 1000) {
    const { data, error } = await sb.from(tab).select('*').range(von, von + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

// ================================================================
export async function mount(root) {
  ladeCss();
  const ich = await ladeIch().catch(() => null);
  if (!ich?.admin) {
    root.innerHTML = `<div class="home"><div class="hinweis"><p>🔒 Dieses Tool gibt es nur für den Admin.</p><a class="btn primary" href="#/">Zur Startseite</a></div></div>`;
    return () => {};
  }
  const ro = !!ich.nurLesen;

  const teile = location.hash.replace(/^#\/?/, '').split('/');
  let tab = TABS[teile[1]] ? teile[1] : 'uebersicht';
  const E = getEinst();
  let bereich = M.BEREICHE[E.bereich] ? E.bereich : 'trainer';          // Tab Spiele
  const F = {                                                              // Tab Auswertung
    bereich: E.aBereich || 'alle',
    modus: M.MODI[E.modus] ? E.modus : 'meine',
    arten: Array.isArray(E.arten) ? E.arten : Object.keys(M.SPIELARTEN),
    saison: '',
    team: '',        // '' | 'v:<vereinId>' (alle Teams des Vereins) | 't:<vereinId>|<team>'
    kategorie: '',
    suche: '',
    sort: 'anzahl',
    ho: 'halle',     // Hallen-Liste: 'halle' | 'ort'
    hSuche: '',
  };
  const offen = new Set();         // aufgeklappte Saison-Blöcke
  let ersterAufbau = true;
  let vwSuche = '';

  const D = { V: [], H: [], A: [], SP: [], TB: [] };
  let VM = new Map(), HM = new Map(), AM = new Map();

  root.innerHTML = `<div class="ms"><p class="muted pad">Lade …</p></div>${dialogeHTML()}`;
  const box = root.querySelector('.ms');

  async function laden() {
    const [V, H, A, SP, TB] = await Promise.all(TABELLEN.map(ladeAlle));
    Object.assign(D, { V: V.sort((a, b) => a.name.localeCompare(b.name, 'de')), H, A, SP, TB });
    VM = new Map(D.V.map(v => [v.id, v])); HM = new Map(H.map(h => [h.id, h])); AM = new Map(A.map(a => [a.id, a]));
    // Datalists (Saisons, Kategorien, Ligen, Teile, Vereine)
    const dl = (id, werte) => { const el = root.querySelector(`#${id}`); if (el) el.innerHTML = [...new Set(werte.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de')).map(w => `<option value="${esc(w)}">`).join(''); };
    dl('ms-dl-saison', A.map(a => a.saison));
    dl('ms-dl-kat', ['Meisterschaft', 'Prague Games', 'Turnier', ...A.map(a => a.kategorie)]);
    dl('ms-dl-liga', SP.map(s => s.liga));
    dl('ms-dl-verein', D.V.map(v => v.name));
  }

  // Aktive (nicht im Papierkorb) Abschnitte + ihre Spiele
  const aktivA = () => D.A.filter(a => !a.geloescht_am);
  const spieleVon = id => M.sortiereSpiele(D.SP.filter(s => s.abschnitt_id === id));
  // Anzeige: neueste oben, Spiele ohne Datum (z.B. abgesagt) bleiben unten
  const neuesteZuerst = liste => [...liste.filter(s => s.datum).reverse(), ...liste.filter(s => !s.datum)];
  const aktiveSpiele = () => { const ids = new Set(aktivA().map(a => a.id)); return D.SP.filter(s => ids.has(s.abschnitt_id)); };
  const bereichVon = sp => AM.get(sp.abschnitt_id)?.bereich;
  const vName = id => VM.get(id)?.name ?? '';
  const vLand = id => { const l = VM.get(id)?.land; return l ? ` <span class="ms-land">${esc(l)}</span>` : ''; };
  const gegnerHTML = sp => sp.gegner_id ? `${esc(vName(sp.gegner_id))}${sp.gegner_zusatz ? ` ${esc(sp.gegner_zusatz)}` : ''}${vLand(sp.gegner_id)}` : '<span class="muted">–</span>';
  const fanHTML = sp => (sp.heim_id || sp.gast_id)
    ? `${sp.heim_id ? esc(vName(sp.heim_id)) + vLand(sp.heim_id) : '?'} – ${sp.gast_id ? esc(vName(sp.gast_id)) + vLand(sp.gast_id) : '?'}`
    : '<span class="muted">Teams unbekannt</span>';
  const abschnittTitel = a => a.bereich === 'fan' ? `Fan-Spiele ${a.saison}` : [vName(a.verein_id), a.team].filter(Boolean).join(' – ') || 'Ohne Team';

  // ---- Live-Updates ---------------------------------------------
  let timer;
  const spaeter = () => { clearTimeout(timer); timer = setTimeout(() => laden().then(zeichneTab).catch(() => {}), 500); };
  const kanal = sb.channel('meinestats-live');
  for (const table of TABELLEN) kanal.on('postgres_changes', { event: '*', schema: 'public', table }, spaeter);
  kanal.subscribe();
  const aufraeumen = () => { clearTimeout(timer); sb.removeChannel(kanal); };

  try { await laden(); zeichne(); }
  catch (e) {
    const fehlt = /ms_|does not exist|PGRST205|42P01/i.test(`${e?.code} ${e?.message}`);
    box.innerHTML = `<p class="error pad">${fehlt ? 'Die Datenbank für «Meine Stats» ist noch nicht eingerichtet (SQL 09 ausführen).' : esc(fehlerText(e))}</p>`;
  }
  return aufraeumen;

  // ==============================================================
  function zeichne() {
    box.innerHTML = `
      <a href="#/" class="zurueck">← Hauptseite</a>
      ${ro ? `<div class="banner">${esc(sperrGrund(null, ich))}</div>` : ''}
      <div class="seg ms-tabs">${Object.entries(TABS).map(([k, t]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="ms-tab"></div>
      ${!ro ? '<button class="fab ms-fab" title="Neue Saison / neues Team" aria-label="Neue Saison / neues Team" hidden>＋</button>' : ''}`;
    box.querySelector('.ms-tabs').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      tab = b.dataset.t;
      box.querySelectorAll('.ms-tabs button').forEach(x => x.classList.toggle('on', x === b));
      zeichneTab(); window.scrollTo(0, 0);
    };
    box.querySelector('.ms-fab')?.addEventListener('click', () => oeffneAbschnitt(null));
    zeichneTab();
  }

  function zeichneTab() {
    const ziel = box.querySelector('.ms-tab');
    if (!ziel) return;
    history.replaceState(null, '', tab === 'uebersicht' ? '#/meinestats' : `#/meinestats/${tab}`);
    const fab = box.querySelector('.ms-fab');
    if (fab) fab.hidden = tab !== 'spiele';
    ziel.onclick = null;
    if (tab === 'uebersicht') tabUebersicht(ziel);
    else if (tab === 'spiele') tabSpiele(ziel);
    else if (tab === 'auswertung') tabAuswertung(ziel);
    else tabVerwaltung(ziel);
  }

  // ==============================================================
  //  ÜBERSICHT (Karriere-Total)
  // ==============================================================
  function tabUebersicht(ziel) {
    const alle = aktiveSpiele();
    const von = b => alle.filter(s => bereichVon(s) === b);
    const tr = von('trainer'), spl = von('spieler'), fan = von('fan').filter(s => !s.abgesagt);
    const trDabei = tr.filter(s => M.zaehlt(s, 'trainer', 'meine'));
    const bT = M.bilanz(trDabei);
    const imTor = spl.filter(s => M.zaehlt(s, 'spieler', 'meine'));
    const blatt = spl.filter(s => M.zaehlt(s, 'spieler', 'blatt'));
    const bS = M.bilanz(imTor);
    const ersteS = M.sortiereSpiele(blatt.filter(s => s.datum))[0];
    const aB = b => aktivA().filter(a => a.bereich === b);
    const teamsT = new Set(aB('trainer').map(a => `${a.verein_id}|${a.team}`)).size;
    const vereineS = new Set(aB('spieler').map(a => a.verein_id).filter(Boolean)).size;
    const live = fan.filter(s => s.livestream).length;
    const fanTeams = M.zaehle(fan.flatMap(s => [s.heim_id, s.gast_id]), x => x)[0];
    const ligen = new Set(fan.map(s => s.liga).filter(Boolean)).size;
    // Fan-Spiele werden erst seit dieser Saison erfasst (früheste Fan-Saison, kurz: «26/27»)
    const fanErste = aB('fan').map(a => M.saisonSchluessel(a.saison)).filter(Boolean).sort((x, y) => x - y)[0];
    const fanAb = fanErste ? `${String(fanErste % 100).padStart(2, '0')}/${String((fanErste + 1) % 100).padStart(2, '0')}` : '';
    // Grosse Zahl: nur Spiele als Trainer (dabei) oder Spieler (Matchblatt); Fan-Spiele separat darunter
    const hallen = new Set([...trDabei, ...blatt].map(s => s.halle_id).filter(Boolean)).size;
    const gespielt = trDabei.length + blatt.length;
    const zuletzt = M.sortiereSpiele([...trDabei, ...blatt, ...fan].filter(s => s.datum && s.datum <= heute())).reverse().slice(0, 6);
    const offeneSpiele = alle.filter(s => !s.abgesagt && s.datum && s.tore1 == null && bereichVon(s) !== 'fan').length;
    const sun = b => `${b.s}<small>S</small> ${b.u}<small>U</small> ${b.n}<small>N</small>`;

    ziel.innerHTML = `
      <section class="ms-karte ms-total">
        <div class="ms-gross"><b>${gespielt}</b><span>Spiele als Trainer oder Spieler</span></div>
        <p class="muted klein">${trDabei.length} als Trainer dabei · ${blatt.length} als Goalie auf dem Matchblatt · in ${hallen} Hallen</p>
        ${fan.length ? `<p class="muted klein">dazu ${plural(fan.length, 'Spiel', 'Spiele')} als Fan geschaut</p>` : ''}
      </section>

      <section class="ms-karte">
        <h3 class="gruppe">🎽 Als Trainer <span>${plural(teamsT, 'Team', 'Teams')}</span></h3>
        <div class="ms-kpis">
          ${kpi(trDabei.length, 'Spiele dabei', `von ${tr.filter(s => !s.abgesagt).length} Teamspielen`)}
          ${kpi(sun(bT), 'Bilanz', bT.snv || bT.nnv ? `davon ${bT.snv} S / ${bT.nnv} N n.V./n.P.` : '')}
          ${kpi(`${bT.quote}%`, 'Siegquote')}
          ${kpi(`${bT.t}:${bT.gt}`, 'Tore', `Ø ${M.zahl1(bT.schnittT)} : ${M.zahl1(bT.schnittGT)}`)}
        </div>
      </section>

      <section class="ms-karte">
        <h3 class="gruppe">🥅 Als Spieler (Goalie) <span>${plural(vereineS, 'Verein', 'Vereine')}</span></h3>
        <p class="muted klein">im Aktiv-Bereich, nicht Junioren</p>
        <div class="ms-kpis">
          ${kpi(blatt.length, 'auf dem Matchblatt', `${imTor.length} im Tor · ${blatt.length - imTor.length} Ersatz`)}
          ${kpi(sun(bS), 'Bilanz im Tor', bS.snv || bS.nnv ? `davon ${bS.snv} S / ${bS.nnv} N n.V./n.P.` : '')}
          ${kpi(bS.gt, 'Gegentore', `Ø ${M.zahl1(bS.schnittGT)} pro Spiel im Tor`)}
          ${ersteS ? kpi(M.datumLang(ersteS.datum), 'Erstes Spiel', `${esc(vName(AM.get(ersteS.abschnitt_id)?.verein_id))} – ${esc(vName(ersteS.gegner_id))} ${esc(M.resultatText(ersteS))}`) : ''}
        </div>
      </section>

      <section class="ms-karte">
        <h3 class="gruppe">👀 Als Fan <span>${plural(ligen, 'Liga', 'Ligen')}</span></h3>
        ${fanAb ? `<p class="muted klein">ab Saison ${esc(fanAb)}</p>` : ''}
        <div class="ms-kpis">
          ${kpi(fan.length, 'Spiele geschaut', `${fan.length - live} in der Halle · ${live} 📺 Livestream`)}
          ${fanTeams ? kpi(fanTeams.n, 'am meisten gesehen', esc(vName(fanTeams.key))) : ''}
          ${kpi(fan.reduce((a, s) => a + (s.tore1 ?? 0) + (s.tore2 ?? 0), 0), 'Tore gesehen')}
        </div>
      </section>

      ${zuletzt.length ? `<section class="ms-karte">
        <h3 class="gruppe">Zuletzt</h3>
        <ul class="ms-spiele">${zuletzt.map(s => spielZeile(s, { mitBereich: true })).join('')}</ul>
        ${offeneSpiele ? `<p class="muted klein">${plural(offeneSpiele, 'Spiel', 'Spiele')} ohne Resultat → unter «Spiele» nachtragen.</p>` : ''}
      </section>` : ''}
      ${!D.A.length ? `<div class="hinweis"><p>Noch keine Daten. Unter <b>Spiele</b> mit ＋ die erste Saison anlegen.</p></div>` : ''}`;
    ziel.querySelectorAll('.ms-spiele [data-sp]').forEach(b => b.addEventListener('click', () => oeffneSpiel(D.SP.find(s => s.id === b.dataset.sp))));
  }

  // Eine Spiel-Zeile (Liste)
  function spielZeile(s, { mitBereich = false } = {}) {
    const a = AM.get(s.abschnitt_id);
    const b = a?.bereich;
    const e = b === 'fan' ? null : M.ergebnis(s);
    const halle = M.halleText(HM.get(s.halle_id));
    const meta = [
      s.livestream ? '📺 Livestream' : halle && esc(halle),
      b === 'fan' && s.liga && esc(s.liga),
      s.spielart !== 'meisterschaft' && b !== 'fan' && `<span class="ms-art">${esc(M.SPIELARTEN[s.spielart])}</span>`,
      s.notiz && `<i>${esc(s.notiz)}</i>`,
    ].filter(Boolean).join(' · ');
    const ichT = b === 'trainer' ? (s.ich === 'nicht' ? '<span class="ms-ich nicht">nicht dabei</span>' : '')
      : b === 'spieler' ? (s.ich === 'tor' ? '<span class="ms-ich tor">🥅 im Tor</span>' : s.ich === 'ersatz' ? '<span class="ms-ich ersatz">Ersatz</span>' : '<span class="ms-ich nicht">nicht dabei</span>')
      : '';
    const wer = mitBereich ? `<small class="ms-wer">${M.BEREICHE[b]?.icon || ''} ${esc(b === 'fan' ? '' : abschnittTitel(a))}</small>` : '';
    if (s.abgesagt && !s.datum && !s.gegner_id && !s.heim_id) {
      return `<li><button class="ms-sp abgesagt nur" data-sp="${s.id}" ${ro ? 'tabindex="-1"' : ''}><span class="ms-d"></span><span class="ms-mitte"><b>Abgesagt</b>${s.notiz ? `<small>${esc(s.notiz)}</small>` : ''}</span><span></span></button></li>`;
    }
    return `<li><button class="ms-sp ${s.abgesagt ? 'abgesagt' : ''} ${s.ich === 'nicht' ? 'ohne-mich' : ''}" data-sp="${s.id}">
      <span class="ms-d">${esc(M.datumKurz(s.datum))}<small>${esc(M.zeitKurz(s.zeit))}</small></span>
      <span class="ms-mitte">${wer}<b>${b === 'fan' ? fanHTML(s) : gegnerHTML(s)}</b>${meta ? `<small>${meta}</small>` : ''}</span>
      <span class="ms-rechts">${s.abgesagt ? '<span class="ms-res">abgesagt</span>' : `<span class="ms-res ${e || 'leer'}">${esc(M.resultatText(s)) || '–'}</span>`}${ichT}</span>
    </button></li>`;
  }

  // ==============================================================
  //  SPIELE (pro Saison/Team)
  // ==============================================================
  function tabSpiele(ziel) {
    const liste = M.sortiereAbschnitte(aktivA().filter(a => a.bereich === bereich));
    if (ersterAufbau && liste[0]) { offen.add(liste[0].id); ersterAufbau = false; }
    ziel.innerHTML = `
      <div class="seg ms-bereich">${Object.entries(M.BEREICHE).map(([k, b]) => `<button data-b="${k}" class="${bereich === k ? 'on' : ''}">${b.icon} ${b.name}</button>`).join('')}</div>
      <div class="ms-bloecke">${liste.map(blockHTML).join('') || `<div class="hinweis"><p>Noch nichts erfasst.</p>${!ro ? '<button class="btn primary ms-neu-a">＋ Saison / Team anlegen</button>' : ''}</div>`}</div>`;
    ziel.querySelector('.ms-bereich').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      bereich = b.dataset.b; setEinst({ bereich });
      const l = M.sortiereAbschnitte(aktivA().filter(a => a.bereich === bereich));
      if (l[0] && ![...offen].some(id => l.some(a => a.id === id))) offen.add(l[0].id);
      tabSpiele(ziel);
    };
    ziel.querySelector('.ms-neu-a')?.addEventListener('click', () => oeffneAbschnitt(null));
    ziel.querySelectorAll('details[data-a]').forEach(d => d.addEventListener('toggle', () => d.open ? offen.add(d.dataset.a) : offen.delete(d.dataset.a)));
    ziel.onclick = e => {
      const sp = e.target.closest('[data-sp]');
      if (sp) return oeffneSpiel(D.SP.find(s => s.id === sp.dataset.sp));
      const k = e.target.closest('button[data-act]'); if (!k) return;
      const a = AM.get(k.dataset.a);
      if (k.dataset.act === 'spiel') oeffneSpiel(null, a);
      if (k.dataset.act === 'edit') oeffneAbschnitt(a);
      if (k.dataset.act === 'tabelle') oeffneTabelle(a, k.dataset.titel ?? null);
    };
  }

  function blockHTML(a) {
    const sp = spieleVon(a.id);
    const fan = a.bereich === 'fan';
    const gezaehlt = sp.filter(s => !s.abgesagt);
    const bTeam = M.bilanz(gezaehlt);
    const meine = gezaehlt.filter(s => M.zaehlt(s, a.bereich, 'meine'));
    const raenge = M.schlussrang(D.TB, a.id);
    let info;
    if (fan) info = `${plural(gezaehlt.length, 'Spiel', 'Spiele')} · ${gezaehlt.filter(s => s.livestream).length} 📺`;
    else {
      info = `${bTeam.sp} Sp · ${bTeam.s}S ${bTeam.u}U ${bTeam.n}N`;
      if (a.bereich === 'trainer') info += ` · ich ${meine.length}× dabei`;
      if (a.bereich === 'spieler') info += ` · ${meine.length}× im Tor, ${gezaehlt.filter(s => s.ich === 'ersatz').length}× Ersatz`;
      if (raenge.length) info += ` · ${raenge.map(r => `${r.rang}./${r.von}`).join(', ')}`;
    }
    // Spiele gruppiert nach Teil (z.B. «La Saga Tenero», «Prague Games») – neueste oben
    let zuletztTeil = null;
    const zeilen = neuesteZuerst(sp).map(s => {
      const kopf = (s.teil || '') !== (zuletztTeil || '') && s.teil ? `<li class="ms-teil">${esc(s.teil)}</li>` : '';
      zuletztTeil = s.teil || zuletztTeil;
      return kopf + spielZeile(s);
    }).join('');
    const titel = [...new Set(D.TB.filter(z => z.abschnitt_id === a.id).map(z => z.titel))];
    return `
      <details class="ms-block" data-a="${a.id}" ${offen.has(a.id) ? 'open' : ''}>
        <summary>
          <span class="ms-saison">${esc(a.saison)}${a.kategorie ? ` · ${esc(a.kategorie)}` : ''}</span>
          <b>${esc(abschnittTitel(a))}</b>
          <small>${info}</small>
        </summary>
        <div class="ms-block-inhalt">
          ${a.gruppe || a.staff ? `<p class="ms-meta">${a.gruppe ? `<b>${esc(a.gruppe)}</b>` : ''}${a.staff ? `<span>${esc(a.staff).replace(/\n/g, '<br>')}</span>` : ''}</p>` : ''}
          ${!ro ? `<div class="ms-aktionen">
            <button class="btn primary small" data-act="spiel" data-a="${a.id}">＋ Spiel</button>
            ${!fan ? `<button class="btn ghost small" data-act="tabelle" data-a="${a.id}">＋ Rangtabelle</button>` : ''}
            <button class="btn ghost small" data-act="edit" data-a="${a.id}">✏️ ${fan ? 'Saison' : 'Saison/Team'}</button>
          </div>` : ''}
          ${a.notiz ? `<p class="ms-notiz">${esc(a.notiz)}</p>` : ''}
          <ul class="ms-spiele">${zeilen || '<li class="muted klein">Noch keine Spiele.</li>'}</ul>
          ${titel.map(t => tabelleHTML(a, t)).join('')}
        </div>
      </details>`;
  }

  // Rangtabelle anzeigen (leere Spalten weglassen)
  function tabelleHTML(a, titel) {
    const z = D.TB.filter(x => x.abschnitt_id === a.id && x.titel === titel).sort((x, y) => (x.rang ?? 99) - (y.rang ?? 99));
    const hat = k => z.some(x => x[k] != null);
    const sp = [['sp', 'Sp'], ['s', 'S'], ['u', 'U'], ['snv', 'SnV'], ['nnv', 'NnV'], ['n', 'N']].filter(([k]) => hat(k));
    const tore = hat('tore') || hat('gegentore');
    return `
      <div class="ms-tab-box">
        <div class="ms-tab-kopf"><b>🏆 ${esc(titel || 'Rangtabelle')}</b>
          ${!ro ? `<button class="btn ghost small" data-act="tabelle" data-a="${a.id}" data-titel="${esc(titel)}">✏️</button>` : ''}</div>
        <div class="ms-scroll"><table class="ms-rang">
          <thead><tr><th>#</th><th class="l">Team</th>${sp.map(([, t]) => `<th>${t}</th>`).join('')}${tore ? '<th>Tore</th><th>+/-</th>' : ''}${hat('punkte') ? '<th>P</th>' : ''}</tr></thead>
          <tbody>${z.map(x => `<tr class="${x.eigenes ? 'eigen' : ''}">
            <td>${x.rang ?? ''}</td>
            <td class="l">${esc(vName(x.verein_id) || '?')}${x.team ? ` <small>${esc(x.team)}</small>` : ''}</td>
            ${sp.map(([k]) => `<td>${x[k] ?? ''}</td>`).join('')}
            ${tore ? `<td>${x.tore ?? ''}:${x.gegentore ?? ''}</td><td>${x.tore != null && x.gegentore != null ? (x.tore - x.gegentore > 0 ? '+' : '') + (x.tore - x.gegentore) : ''}</td>` : ''}
            ${hat('punkte') ? `<td><b>${x.punkte ?? ''}</b></td>` : ''}
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`;
  }

  // ==============================================================
  //  AUSWERTUNG
  // ==============================================================
  function tabAuswertung(ziel) {
    const bListe = F.bereich === 'alle' ? ['trainer', 'spieler', 'fan'] : [F.bereich];
    const abschnitte = aktivA().filter(a => bListe.includes(a.bereich));
    // Auswahl-Listen hängen voneinander ab: jede Liste zeigt nur, was zu den anderen Auswahlen passt
    const katVon = a => a.kategorie || 'Ohne Kategorie';
    const teamKey = a => `t:${a.verein_id}|${a.team || ''}`;
    const passtSaison = a => !F.saison || M.saisonName(a.saison) === F.saison;
    const passtKat = a => !F.kategorie || (a.bereich !== 'fan' && katVon(a) === F.kategorie);
    const passtTeam = a => !F.team || (a.bereich !== 'fan' && (F.team.startsWith('v:') ? a.verein_id === F.team.slice(2) : teamKey(a) === F.team));
    let saisons, kategorien, vereinOpt, teamOpt;
    for (let runde = 0; runde < 3; runde++) {   // ungültige Auswahl zurücksetzen, bis alles zusammenpasst
      saisons = [...new Set(abschnitte.filter(a => passtKat(a) && passtTeam(a)).map(a => M.saisonName(a.saison)))]
        .sort((x, y) => M.saisonSchluessel(y) - M.saisonSchluessel(x));
      kategorien = [...new Set(abschnitte.filter(a => a.bereich !== 'fan' && passtSaison(a) && passtTeam(a)).map(katVon))]
        .sort((x, y) => x.localeCompare(y, 'de'));
      const mitTeam = abschnitte.filter(a => a.bereich !== 'fan' && a.verein_id && passtSaison(a) && passtKat(a));
      vereinOpt = [...new Set(mitTeam.map(a => a.verein_id))].map(id => ({ v: `v:${id}`, t: `${vName(id)} (alle Teams)` }))
        .sort((x, y) => x.t.localeCompare(y.t, 'de'));
      teamOpt = [...new Map(mitTeam.map(a => [teamKey(a), `${vName(a.verein_id)}${a.team ? ` – ${a.team}` : ''}`])).entries()]
        .map(([v, t]) => ({ v, t })).sort((x, y) => x.t.localeCompare(y.t, 'de'));
      let ok = true;
      if (F.saison && !saisons.includes(F.saison)) { F.saison = ''; ok = false; }
      if (F.kategorie && !kategorien.includes(F.kategorie)) { F.kategorie = ''; ok = false; }
      if (F.team && ![...vereinOpt, ...teamOpt].some(o => o.v === F.team)) { F.team = ''; ok = false; }
      if (ok) break;
    }
    const aIds = new Set(abschnitte.filter(a => passtSaison(a) && passtKat(a) && passtTeam(a)).map(a => a.id));
    // Spielarten: nur die anzeigen, die in dieser Auswahl vorkommen (mit Anzahl)
    const artAnz = M.zaehle(D.SP.filter(s => aIds.has(s.abschnitt_id) && M.zaehlt(s, bereichVon(s), F.modus)), s => s.spielart);
    const artN = k => artAnz.find(x => x.key === k)?.n || 0;
    const opt = (wert, aktuell, text) => `<option value="${esc(wert)}" ${wert === aktuell ? 'selected' : ''}>${esc(text)}</option>`;
    const spiele = D.SP.filter(s => aIds.has(s.abschnitt_id) && F.arten.includes(s.spielart) && M.zaehlt(s, bereichVon(s), F.modus));
    const eigene = spiele.filter(s => bereichVon(s) !== 'fan');
    const fan = spiele.filter(s => bereichVon(s) === 'fan');
    const mitEigenen = F.bereich !== 'fan';
    const mitFan = F.bereich === 'alle' || F.bereich === 'fan';

    ziel.innerHTML = `
      <div class="seg ms-bereich ms-f-bereich">${[['alle', 'Alle'], ...Object.entries(M.BEREICHE).map(([k, b]) => [k, `${b.icon} ${b.name}`])].map(([k, t]) => `<button data-b="${k}" class="${F.bereich === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="ms-filter">
        <label class="sel-wrap">Saison
          <select class="f-saison"><option value="">Alle</option>${saisons.map(s => opt(s, F.saison, s)).join('')}</select>
        </label>
        ${mitEigenen ? `<label class="sel-wrap">Kategorie
          <select class="f-kat"><option value="">Alle</option>${kategorien.map(k => opt(k, F.kategorie, k)).join('')}</select>
        </label>
        <label class="sel-wrap ms-modus">Team
          <select class="f-team"><option value="">Alle Teams</option>
            ${vereinOpt.length && teamOpt.length > vereinOpt.length ? `<optgroup label="Verein">${vereinOpt.map(o => opt(o.v, F.team, o.t)).join('')}</optgroup>` : ''}
            <optgroup label="Team">${teamOpt.map(o => opt(o.v, F.team, o.t)).join('')}</optgroup>
          </select>
        </label>` : ''}
        ${mitEigenen ? `<label class="sel-wrap ms-modus">Zählen
          <select class="f-modus">${Object.entries(M.MODI).map(([k, t]) => `<option value="${k}" ${F.modus === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
        </label>` : ''}
      </div>
      <div class="ms-arten">${Object.entries(M.SPIELARTEN).filter(([k]) => artN(k)).map(([k, t]) => `<button class="chip ${F.arten.includes(k) ? 'on' : ''}" data-art="${k}">${t} <small>${artN(k)}</small></button>`).join('')}</div>
      <div class="ms-aw"></div>`;

    ziel.querySelector('.ms-f-bereich').onclick = e => { const b = e.target.closest('button'); if (!b) return; F.bereich = b.dataset.b; setEinst({ aBereich: F.bereich }); tabAuswertung(ziel); };
    ziel.querySelector('.f-saison').onchange = e => { F.saison = e.target.value; tabAuswertung(ziel); };
    ziel.querySelector('.f-kat')?.addEventListener('change', e => { F.kategorie = e.target.value; tabAuswertung(ziel); });
    ziel.querySelector('.f-team')?.addEventListener('change', e => { F.team = e.target.value; tabAuswertung(ziel); });
    ziel.querySelector('.f-modus')?.addEventListener('change', e => { F.modus = e.target.value; setEinst({ modus: F.modus }); tabAuswertung(ziel); });
    ziel.querySelector('.ms-arten').onclick = e => {
      const b = e.target.closest('[data-art]'); if (!b) return;
      F.arten = F.arten.includes(b.dataset.art) ? F.arten.filter(x => x !== b.dataset.art) : [...F.arten, b.dataset.art];
      setEinst({ arten: F.arten }); tabAuswertung(ziel);
    };
    const aw = ziel.querySelector('.ms-aw');
    if (!spiele.length) { aw.innerHTML = '<p class="muted pad leer">Keine Spiele für diese Auswahl.</p>'; return; }

    let html = '';
    // ---- Bilanz pro Saison/Team ----
    if (mitEigenen && eigene.length) {
      const zeilen = M.sortiereAbschnitte(abschnitte.filter(a => a.bereich !== 'fan' && aIds.has(a.id)))
        .map(a => ({ a, b: M.bilanz(eigene.filter(s => s.abschnitt_id === a.id)), r: M.schlussrang(D.TB, a.id) }))
        .filter(z => z.b.sp || z.b.offen);
      const tot = M.bilanz(eigene);
      html += `
        <section class="ms-karte">
          <h3 class="gruppe">Bilanz pro Saison/Team</h3>
          <div class="ms-kpis klein">
            ${kpi(tot.sp, 'Spiele')}${kpi(`${tot.s}-${tot.u}-${tot.n}`, 'S-U-N')}${kpi(`${tot.quote}%`, 'Siegquote')}
            ${kpi(`${tot.t}:${tot.gt}`, 'Tore')}${kpi(M.zahl1(tot.schnittGT), 'Ø Gegentore')}
          </div>
          <div class="ms-scroll"><table class="ms-tab">
            <thead><tr><th class="l">Saison / Team</th><th>Sp</th><th>S</th><th>U</th><th>N</th><th>Tore</th><th>Ø GT</th><th>Rang</th></tr></thead>
            <tbody>${zeilen.map(({ a, b, r }) => `<tr>
              <td class="l">${M.BEREICHE[a.bereich].icon} <b>${esc(M.saisonName(a.saison))}</b> ${esc(abschnittTitel(a))}${a.kategorie && a.kategorie !== 'Meisterschaft' ? ` <small>${esc(a.kategorie)}</small>` : ''}</td>
              <td>${b.sp}</td><td>${b.s}${b.snv ? `<small>(${b.snv})</small>` : ''}</td><td>${b.u}</td><td>${b.n}${b.nnv ? `<small>(${b.nnv})</small>` : ''}</td>
              <td>${b.t}:${b.gt}</td><td>${b.sp ? M.zahl1(b.schnittGT) : ''}</td><td>${r.map(x => `${x.rang}/${x.von}`).join(' ')}</td>
            </tr>`).join('')}</tbody>
          </table></div>
          <p class="muted klein">(x) = davon nach Verlängerung/Penaltys. Rang aus der erfassten Rangtabelle.</p>
        </section>`;
    }
    // ---- Gegner-Bilanz ----
    if (mitEigenen && eigene.length) {
      html += `
        <section class="ms-karte">
          <h3 class="gruppe">Gegner-Bilanz <span class="ms-g-anz"></span></h3>
          <div class="ms-filter">
            <input class="ms-g-suche" type="search" placeholder="Gegner suchen …" value="${esc(F.suche)}" autocomplete="off">
            <select class="ms-g-sort" aria-label="Sortieren">
              <option value="anzahl" ${F.sort === 'anzahl' ? 'selected' : ''}>Meiste Spiele</option>
              <option value="quote" ${F.sort === 'quote' ? 'selected' : ''}>Beste Bilanz</option>
              <option value="schlecht" ${F.sort === 'schlecht' ? 'selected' : ''}>Schlechteste Bilanz</option>
              <option value="name" ${F.sort === 'name' ? 'selected' : ''}>A–Z</option>
            </select>
          </div>
          <ul class="ms-gegner"></ul>
        </section>`;
    }
    // ---- Fan: Teams + Ligen ----
    if (mitFan && fan.length) {
      const teams = M.zaehle(fan.flatMap(s => [s.heim_id, s.gast_id]), x => x).slice(0, 15);
      const ligen = M.zaehle(fan, s => s.liga);
      const live = fan.filter(s => s.livestream).length;
      html += `
        <section class="ms-karte">
          <h3 class="gruppe">👀 Fan: ${plural(fan.length, 'Spiel', 'Spiele')}</h3>
          <div class="ms-kpis klein">${kpi(fan.length - live, 'in der Halle')}${kpi(live, '📺 Livestream')}${kpi(ligen.length, 'Ligen')}</div>
          <div class="ms-zwei">
            <div><h4>Ligen / Wettbewerbe</h4>${balkenListe(ligen.map(x => ({ t: x.key, n: x.n })))}</div>
            <div><h4>Am meisten gesehen</h4>${balkenListe(teams.map(x => ({ t: vName(x.key), n: x.n })))}</div>
          </div>
        </section>`;
    }
    // ---- Hallen & Orte (antippen → alle Spiele dort) ----
    const mitOrt = spiele.filter(s => s.halle_id || s.livestream);
    if (mitOrt.length) {
      html += `
        <section class="ms-karte">
          <h3 class="gruppe">Hallen & Orte <span class="ms-h-anz"></span></h3>
          <div class="ms-filter">
            <div class="seg ms-ho">${[['halle', 'Hallen'], ['ort', 'Orte']].map(([k, t]) => `<button data-ho="${k}" class="${F.ho === k ? 'on' : ''}">${t}</button>`).join('')}</div>
            <input class="ms-h-suche" type="search" placeholder="Halle oder Ort suchen …" value="${esc(F.hSuche)}" autocomplete="off">
          </div>
          <ul class="ms-gegner ms-hl"></ul>
          <p class="muted klein">Antippen zeigt alle Spiele dort. Bilanz nur aus eigenen Spielen (Trainer/Spieler).</p>
        </section>`;
    }
    aw.innerHTML = html;

    // Hallen-/Orte-Liste
    const hl = aw.querySelector('.ms-hl');
    if (hl) {
      const LIVE = '📺 Livestream';
      const schluessel = sp => sp.livestream ? LIVE : F.ho === 'ort' ? HM.get(sp.halle_id)?.ort : sp.halle_id;
      const name = k => k === LIVE || F.ho === 'ort' ? k : M.halleText(HM.get(k));
      const zeichneH = () => {
        const gruppen = new Map();
        for (const sp of mitOrt) { const k = schluessel(sp); if (!k) continue; if (!gruppen.has(k)) gruppen.set(k, []); gruppen.get(k).push(sp); }
        const q = M.norm(F.hSuche);
        const l = [...gruppen.entries()].map(([k, liste]) => ({ k, liste, t: name(k) }))
          .filter(x => !q || M.norm(x.t).includes(q))
          .sort((x, y) => y.liste.length - x.liste.length || x.t.localeCompare(y.t, 'de'));
        const mx = Math.max(1, ...l.map(x => x.liste.length));
        const nH = new Set(mitOrt.filter(x => x.halle_id).map(x => x.halle_id)).size;
        const nO = new Set(mitOrt.filter(x => x.halle_id).map(x => HM.get(x.halle_id)?.ort)).size;
        aw.querySelector('.ms-h-anz').textContent = `${plural(nH, 'Halle', 'Hallen')} · ${plural(nO, 'Ort', 'Orte')}`;
        hl.innerHTML = l.map(x => {
          const b = M.bilanz(x.liste.filter(sp => bereichVon(sp) !== 'fan'));
          const proB = ['trainer', 'spieler', 'fan'].map(k => [k, x.liste.filter(sp => bereichVon(sp) === k).length]).filter(([, n]) => n);
          return `<li><details><summary>
            <span class="ms-g-name">${esc(x.t)}
              <span class="ms-balken"><i style="width:${Math.round(100 * x.liste.length / mx)}%"></i></span>
              ${proB.length > 1 ? `<small class="ms-h-b">${proB.map(([k, n]) => `${M.BEREICHE[k].icon}${n}`).join(' ')}</small>` : ''}</span>
            <span class="ms-g-zahlen"><b>${x.liste.length}</b> Sp${b.sp ? ` · <span class="s">${b.s}</span>-<span class="u">${b.u}</span>-<span class="n">${b.n}</span>` : ''}</span>
          </summary><ul class="ms-spiele">${neuesteZuerst(M.sortiereSpiele(x.liste)).map(sp => spielZeile(sp, { mitBereich: true })).join('')}</ul></details></li>`;
        }).join('') || '<li class="muted klein">Nichts gefunden.</li>';
      };
      zeichneH();
      aw.querySelector('.ms-h-suche').addEventListener('input', e => { F.hSuche = e.target.value; zeichneH(); });
      aw.querySelector('.ms-ho').addEventListener('click', e => {
        const b = e.target.closest('[data-ho]'); if (!b) return;
        F.ho = b.dataset.ho;
        aw.querySelectorAll('.ms-ho button').forEach(x => x.classList.toggle('on', x === b));
        zeichneH();
      });
      hl.addEventListener('click', e => { const b = e.target.closest('[data-sp]'); if (b) oeffneSpiel(D.SP.find(sp => sp.id === b.dataset.sp)); });
    }

    // Gegner-Liste (mit Suche, ohne die ganze Seite neu zu zeichnen)
    const gl = aw.querySelector('.ms-gegner:not(.ms-hl)');
    if (gl) {
      const alleG = M.gegnerBilanz(eigene);
      const zeichneG = () => {
        const q = M.norm(F.suche);
        let l = alleG.filter(g => !q || M.norm(vName(g.id)).includes(q));
        const pq = g => g.sp ? (g.s - g.n) / g.sp : 0;
        l.sort(F.sort === 'name' ? (x, y) => vName(x.id).localeCompare(vName(y.id), 'de')
          : F.sort === 'quote' ? (x, y) => pq(y) - pq(x) || y.sp - x.sp
          : F.sort === 'schlecht' ? (x, y) => pq(x) - pq(y) || y.sp - x.sp
          : (x, y) => y.anzahl - x.anzahl || vName(x.id).localeCompare(vName(y.id), 'de'));
        aw.querySelector('.ms-g-anz').textContent = plural(l.length, 'Gegner', 'Gegner');
        gl.innerHTML = l.map(g => `
          <li><details><summary>
            <span class="ms-g-name">${esc(vName(g.id))}${vLand(g.id)}</span>
            <span class="ms-g-zahlen"><b>${g.anzahl}</b> Sp · <span class="s">${g.s}</span>-<span class="u">${g.u}</span>-<span class="n">${g.n}</span> · ${g.t}:${g.gt}</span>
          </summary><ul class="ms-spiele">${neuesteZuerst(g.spiele).map(s => spielZeile(s, { mitBereich: true })).join('')}</ul></details></li>`).join('')
          || '<li class="muted klein">Kein Gegner gefunden.</li>';
      };
      zeichneG();
      aw.querySelector('.ms-g-suche').addEventListener('input', e => { F.suche = e.target.value; zeichneG(); });
      aw.querySelector('.ms-g-sort').addEventListener('change', e => { F.sort = e.target.value; zeichneG(); });
      gl.addEventListener('click', e => { const b = e.target.closest('[data-sp]'); if (b) oeffneSpiel(D.SP.find(s => s.id === b.dataset.sp)); });
    }
  }

  function balkenListe(werte, max = 0) {
    const mx = Math.max(1, ...werte.map(w => w.n));
    const zeile = w => `<li><span class="t">${esc(w.t)}${w.sub ? ` <small>${w.sub}</small>` : ''}</span><span class="ms-balken"><i style="width:${Math.round(100 * w.n / mx)}%"></i></span><b>${w.n}</b></li>`;
    if (!werte.length) return '<p class="muted klein">–</p>';
    if (!max || werte.length <= max) return `<ul class="ms-bl">${werte.map(zeile).join('')}</ul>`;
    return `<ul class="ms-bl">${werte.slice(0, max).map(zeile).join('')}</ul>
      <details class="ms-mehr"><summary>Alle ${werte.length} anzeigen</summary><ul class="ms-bl">${werte.slice(max).map(zeile).join('')}</ul></details>`;
  }

  // ==============================================================
  //  VERWALTUNG (Vereine, Hallen, Papierkorb)
  // ==============================================================
  function tabVerwaltung(ziel) {
    const nutzV = id => D.SP.filter(s => s.gegner_id === id || s.heim_id === id || s.gast_id === id).length
      + D.TB.filter(z => z.verein_id === id).length + D.A.filter(a => a.verein_id === id).length;
    const nutzH = id => D.SP.filter(s => s.halle_id === id).length;
    const korb = D.A.filter(a => a.geloescht_am);
    const q = M.norm(vwSuche);
    const passt = t => !q || M.norm(t).includes(q);
    const vereine = D.V.filter(v => passt(v.name));
    const hallen = [...D.H].sort((a, b) => M.halleText(a).localeCompare(M.halleText(b), 'de')).filter(h => passt(M.halleText(h)));
    ziel.innerHTML = `
      <p class="muted klein ms-vw-info">Jeder Verein und jede Halle gibt es nur einmal – so stimmen die Statistiken.
        Namen hier ändern = überall geändert. Doppelte Einträge mit <b>Zusammenführen</b> vereinen.</p>
      <input class="ms-vw-suche" type="search" placeholder="Suchen …" value="${esc(vwSuche)}" autocomplete="off">
      <section class="ms-karte">
        <h3 class="gruppe">🏒 Vereine & Teams <span>${D.V.length}</span>${!ro ? '<button class="btn ghost small ms-neu-v">＋ Verein</button>' : ''}</h3>
        <ul class="vw-liste ms-vw">${vereine.map(v => `
          <li><button class="ms-vw-zeile" data-v="${v.id}" ${ro ? 'disabled' : ''}>
            <span class="vw-name">${esc(v.name)}${vLand(v.id)}</span>
            <span class="badge">${nutzV(v.id)}</span>
          </button></li>`).join('') || '<li class="muted">Keine.</li>'}</ul>
      </section>
      <section class="ms-karte">
        <h3 class="gruppe">🏟 Hallen <span>${D.H.length}</span>${!ro ? '<button class="btn ghost small ms-neu-h">＋ Halle</button>' : ''}</h3>
        <ul class="vw-liste ms-vw">${hallen.map(h => `
          <li><button class="ms-vw-zeile" data-h="${h.id}" ${ro ? 'disabled' : ''}>
            <span class="vw-name">${esc(h.ort)}${h.name ? `<small class="muted">${esc(h.name)}</small>` : ''}</span>
            <span class="badge">${nutzH(h.id)}</span>
          </button></li>`).join('') || '<li class="muted">Keine.</li>'}</ul>
      </section>
      ${korb.length ? `<section class="ms-karte">
        <h3 class="gruppe">🗑 Papierkorb</h3>
        <ul class="vw-liste">${korb.map(a => `
          <li><span class="vw-name">${M.BEREICHE[a.bereich].icon} ${esc(a.saison)} ${esc(abschnittTitel(a))}
            <small class="muted">${plural(D.SP.filter(s => s.abschnitt_id === a.id).length, 'Spiel', 'Spiele')} · gelöscht am ${new Date(a.geloescht_am).toLocaleDateString('de-CH')}</small></span>
            ${!ro ? `<button class="btn ghost small" data-zurueck="${a.id}">↩︎</button><button class="btn danger small" data-weg="${a.id}">Endgültig</button>` : ''}
          </li>`).join('')}</ul>
      </section>` : ''}`;
    const suche = ziel.querySelector('.ms-vw-suche');
    suche.addEventListener('input', e => { vwSuche = e.target.value; const pos = suche.selectionStart; tabVerwaltung(ziel); const n = ziel.querySelector('.ms-vw-suche'); n.focus(); n.setSelectionRange(pos, pos); });
    ziel.onclick = async e => {
      if (ro) return;
      if (e.target.closest('.ms-neu-v')) return oeffneVerein(null);
      if (e.target.closest('.ms-neu-h')) return oeffneHalle(null);
      const v = e.target.closest('[data-v]'); if (v) return oeffneVerein(VM.get(v.dataset.v));
      const h = e.target.closest('[data-h]'); if (h) return oeffneHalle(HM.get(h.dataset.h));
      const z = e.target.closest('[data-zurueck]');
      if (z) {
        const { error } = await sb.from('ms_abschnitte').update({ geloescht_am: null }).eq('id', z.dataset.zurueck);
        if (error) return toast(fehlerText(error), 'error');
        toast('Wiederhergestellt ↩︎', 'ok'); return neu();
      }
      const w = e.target.closest('[data-weg]');
      if (w) {
        const a = AM.get(w.dataset.weg);
        const n = D.SP.filter(s => s.abschnitt_id === a.id).length;
        const ok = await frage({
          titel: `⚠️ ${a.saison} ${abschnittTitel(a)} endgültig löschen?`,
          html: `<div class="warnung"><b>Das kann NICHT rückgängig gemacht werden!</b> Gelöscht werden ${plural(n, 'Spiel', 'Spiele')} und die Rangtabellen.</div>`,
          knopf: 'Endgültig löschen', tippen: a.saison,
        });
        if (!ok) return;
        const { error } = await sb.from('ms_abschnitte').delete().eq('id', a.id);
        if (error) return toast(fehlerText(error), 'error');
        toast('Endgültig gelöscht'); return neu();
      }
    };
  }

  async function neu() { await laden(); zeichneTab(); }

  // ==============================================================
  //  AUSWAHL-FELD (Verein / Halle) mit Vorschlägen
  // ==============================================================
  // leer: Vorschläge, solange noch nichts getippt ist (z.B. Gegner dieser Saison)
  function machePicker(wrap, { suche, text, sub = () => '', leer = () => [] }) {
    const inp = wrap.querySelector('input'), vor = wrap.querySelector('.ms-vor');
    let liste = [];
    const zeige = () => {
      const q = inp.value.trim();
      liste = q ? suche(q) : leer().slice(0, 8);
      const exakt = liste.some(t => M.norm(text(t)) === M.norm(q));
      vor.innerHTML = liste.map((t, i) => `<button type="button" data-i="${i}">${esc(text(t))}${sub(t, q)}</button>`).join('')
        + (q && !exakt ? `<button type="button" class="neu" data-neu>＋ «${esc(q)}» neu</button>` : '');
      vor.hidden = !vor.innerHTML || document.activeElement !== inp;
    };
    inp.addEventListener('input', () => { wrap.dataset.id = ''; zeige(); });
    inp.addEventListener('focus', zeige);
    inp.addEventListener('blur', () => setTimeout(() => { vor.hidden = true; }, 150));
    vor.addEventListener('mousedown', e => e.preventDefault());
    vor.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.i != null) { const t = liste[+b.dataset.i]; wrap.dataset.id = t.id; inp.value = text(t); }
      vor.hidden = true;
    });
    return {
      set(item) { wrap.dataset.id = item?.id || ''; inp.value = item ? text(item) : ''; },
      text: () => inp.value.trim(),
      id: () => wrap.dataset.id || null,
    };
  }
  function aliasSub(v, q) {
    return v.land ? ` <small>${esc(v.land)}</small>` : '';
  }
  function vereinPicker(wrap, leerIds) {
    return machePicker(wrap, { suche: q => M.sucheVereine(D.V, q), text: v => v.name, sub: aliasSub, leer: () => (leerIds?.() || []).map(id => VM.get(id)).filter(Boolean) });
  }
  function hallenPicker(wrap, leerIds) {
    return machePicker(wrap, { suche: q => M.sucheHallen(D.H, q), text: M.halleText, leer: () => (leerIds?.() || []).map(id => HM.get(id)).filter(Boolean) });
  }
  // Häufigste Werte zuerst – zuerst aus diesem Block, dann aus den anderen Saisons desselben Teams
  function vorschlaege(a, felder) {
    const gleichesTeam = x => x.bereich === a.bereich && x.verein_id === a.verein_id && (x.team || '') === (a.team || '');
    const andere = aktivA().filter(x => x.id !== a.id && gleichesTeam(x)).map(x => x.id);
    const ids = liste => M.zaehle(D.SP.filter(s => liste.includes(s.abschnitt_id)).flatMap(s => felder.map(f => s[f])), x => x).map(x => x.key);
    return [...new Set([...ids([a.id]), ...ids(andere)])];
  }

  // Verein aus Picker holen – unbekannter Name → nachfragen und neu anlegen
  async function vereinAus(p, was) {
    if (p.id()) return p.id();
    const t = p.text(); if (!t) return null;
    const v = M.findeVerein(D.V, t); if (v) return v.id;
    if (!confirm(`«${t}» gibt es noch nicht als Verein.\n\nNeu anlegen? (Prüfe vorher die Vorschläge, damit derselbe Verein nicht doppelt vorkommt.)`)) throw new Error(`${was}: bitte einen Verein aus der Liste wählen.`);
    const { data, error } = await sb.from('ms_vereine').insert({ name: t }).select().single();
    if (error) throw error;
    D.V.push(data); VM.set(data.id, data);
    return data.id;
  }
  async function halleAus(p) {
    if (p.id()) return p.id();
    const t = p.text(); if (!t) return null;
    const h = M.findeHalle(D.H, t); if (h) return h.id;
    const { ort, name } = M.teileHalle(t);
    if (!confirm(`Neue Halle anlegen?\n\nOrt: ${ort}\nHalle: ${name || '(leer)'}\n\nTipp: «Ort, Halle» mit Komma eingeben.`)) throw new Error('Halle: bitte aus der Liste wählen.');
    const { data, error } = await sb.from('ms_hallen').insert({ ort, name }).select().single();
    if (error) throw error;
    D.H.push(data); HM.set(data.id, data);
    return data.id;
  }

  // ==============================================================
  //  DIALOG: Spiel
  // ==============================================================
  function oeffneSpiel(sp, abschnitt) {
    if (!sp && ro) return;
    if (sp && ro) return;   // Zuschauer:in: nur ansehen
    const a = abschnitt || AM.get(sp?.abschnitt_id);
    if (!a) return;
    const b = a.bereich, fan = b === 'fan';
    const dlg = root.querySelector('.ms-dlg-spiel');
    const f = dlg.querySelector('form');
    const vorher = spieleVon(a.id).filter(s => !s.abgesagt).at(-1);
    const teile = [...new Set(spieleVon(a.id).map(s => s.teil).filter(Boolean))];
    const ichOpt = Object.entries(M.ICH[b] || {});
    f.innerHTML = `
      <div><h2>${sp ? 'Spiel ändern' : '＋ Spiel'}</h2><p class="muted klein">${M.BEREICHE[b].icon} ${esc(a.saison)} · ${esc(abschnittTitel(a))}</p></div>
      ${teile.length || a.kategorie && a.kategorie !== 'Meisterschaft' ? `<label>Teil (optional, z.B. Turnier)<input name="teil" list="ms-dl-teil" autocomplete="off" placeholder="z.B. La Saga Tenero">
        <datalist id="ms-dl-teil">${teile.map(t => `<option value="${esc(t)}">`).join('')}</datalist></label>` : ''}
      <div class="ms-reihe">
        <label>Datum<input type="date" name="datum"></label>
        <label class="schmal">Zeit<input type="time" name="zeit"></label>
      </div>
      <div class="ms-pick p-halle"><span class="lbl">Ort, Halle</span><input autocomplete="off" placeholder="z.B. Konolfingen, SLM Arena"><div class="ms-vor" hidden></div></div>
      <label class="ms-check"><input type="checkbox" name="livestream"> 📺 Livestream (statt Halle)</label>
      ${fan ? `
        <div class="ms-pick p-heim"><span class="lbl">Heim</span><input autocomplete="off" placeholder="Verein suchen …"><div class="ms-vor" hidden></div></div>
        <div class="ms-pick p-gast"><span class="lbl">Gast</span><input autocomplete="off" placeholder="Verein suchen …"><div class="ms-vor" hidden></div></div>
        <label>Liga / Wettbewerb<input name="liga" list="ms-dl-liga" autocomplete="off" placeholder="z.B. M L-UPL, W Cup"></label>`
      : `<div class="ms-reihe">
          <div class="ms-pick p-gegner"><span class="lbl">Gegner</span><input autocomplete="off" placeholder="Verein suchen …"><div class="ms-vor" hidden></div></div>
          <label class="schmal">Zusatz<input name="gegner_zusatz" placeholder="z.B. U17" autocomplete="off"></label>
        </div>`}
      <div class="ms-reihe ms-res-reihe">
        <label class="schmal">${fan ? 'Heim' : 'Wir'}<input type="number" name="tore1" min="0" max="99" inputmode="numeric"></label>
        <span class="ms-doppel">:</span>
        <label class="schmal">${fan ? 'Gast' : 'Gegner'}<input type="number" name="tore2" min="0" max="99" inputmode="numeric"></label>
        <label>Entscheid<select name="entscheid"><option value="">regulär</option><option value="nv">n. Verlängerung</option><option value="np">n. Penaltys</option></select></label>
      </div>
      <label>Spielart<select name="spielart">${Object.entries(M.SPIELARTEN).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
      ${ichOpt.length ? `<div><span class="lbl">Ich</span><div class="seg ms-ich-wahl">${ichOpt.map(([k, t]) => `<label><input type="radio" name="ich" value="${k}">${t}</label>`).join('')}</div></div>` : ''}
      <label class="ms-check"><input type="checkbox" name="abgesagt"> Abgesagt / nicht gespielt</label>
      <label>Notiz<input name="notiz" autocomplete="off" placeholder="z.B. The Game!!, out 1/8-Final"></label>
      <p class="form-error error" hidden></p>
      <div class="dlg-actions">
        ${sp ? '<button type="button" class="btn danger btn-weg">Löschen</button><span class="ms-luecke"></span>' : ''}
        <button type="button" class="btn ghost btn-abbr">Abbrechen</button>
        <button class="btn primary">Speichern</button>
      </div>`;
    const pH = hallenPicker(f.querySelector('.p-halle'), () => vorschlaege(a, ['halle_id']));
    const pG = !fan ? vereinPicker(f.querySelector('.p-gegner'), () => vorschlaege(a, ['gegner_id'])) : null;
    const pHeim = fan ? vereinPicker(f.querySelector('.p-heim'), () => vorschlaege(a, ['heim_id', 'gast_id'])) : null;
    const pGast = fan ? vereinPicker(f.querySelector('.p-gast'), () => vorschlaege(a, ['heim_id', 'gast_id'])) : null;
    const s = sp || {
      teil: vorher?.teil || '', spielart: vorher?.spielart || (fan ? 'meisterschaft' : 'meisterschaft'),
      liga: vorher?.liga || '', ich: b === 'trainer' ? 'dabei' : b === 'spieler' ? 'tor' : null,
    };
    if (f.teil) f.teil.value = s.teil || '';
    f.datum.value = s.datum || '';
    f.zeit.value = M.zeitKurz(s.zeit);
    pH.set(HM.get(s.halle_id));
    f.livestream.checked = !!s.livestream;
    if (pG) { pG.set(VM.get(s.gegner_id)); f.gegner_zusatz.value = s.gegner_zusatz || ''; }
    if (fan) { pHeim.set(VM.get(s.heim_id)); pGast.set(VM.get(s.gast_id)); f.liga.value = s.liga || ''; }
    f.tore1.value = s.tore1 ?? ''; f.tore2.value = s.tore2 ?? '';
    f.entscheid.value = s.entscheid || '';
    f.spielart.value = s.spielart || 'meisterschaft';
    f.querySelectorAll('[name=ich]').forEach(r => { r.checked = r.value === s.ich; });
    f.abgesagt.checked = !!s.abgesagt;
    f.notiz.value = s.notiz || '';
    const halleSichtbar = () => { f.querySelector('.p-halle').hidden = f.livestream.checked; };
    f.livestream.onchange = halleSichtbar; halleSichtbar();
    const fehler = msg => { const el = f.querySelector('.form-error'); el.textContent = msg; el.hidden = !msg; };

    f.querySelector('.btn-abbr').onclick = () => dlg.close();
    f.querySelector('.btn-weg')?.addEventListener('click', async () => {
      if (!confirm('Dieses Spiel löschen?')) return;
      const { error } = await sb.from('ms_spiele').delete().eq('id', sp.id);
      if (error) return fehler(fehlerText(error));
      dlg.close(); toast('Spiel gelöscht'); neu();
    });
    f.onsubmit = async e => {
      e.preventDefault();
      fehler('');
      const t1 = f.tore1.value === '' ? null : +f.tore1.value, t2 = f.tore2.value === '' ? null : +f.tore2.value;
      if ((t1 == null) !== (t2 == null)) return fehler('Resultat: beide Zahlen ausfüllen (oder beide leer lassen).');
      if (f.entscheid.value && t1 === t2) return fehler('Nach Verlängerung/Penaltys kann es nicht unentschieden stehen.');
      const knopf = f.querySelector('.btn.primary'); knopf.disabled = true;
      try {
        const row = {
          abschnitt_id: a.id,
          teil: f.teil?.value.trim() || null,
          datum: f.datum.value || null,
          zeit: f.zeit.value || null,
          livestream: f.livestream.checked,
          halle_id: f.livestream.checked ? null : await halleAus(pH),
          tore1: t1, tore2: t2,
          entscheid: f.entscheid.value || null,
          spielart: f.spielart.value,
          ich: f.querySelector('[name=ich]:checked')?.value || null,
          abgesagt: f.abgesagt.checked,
          notiz: f.notiz.value.trim() || null,
        };
        if (fan) { row.heim_id = await vereinAus(pHeim, 'Heim'); row.gast_id = await vereinAus(pGast, 'Gast'); row.liga = f.liga.value.trim() || null; }
        else { row.gegner_id = await vereinAus(pG, 'Gegner'); row.gegner_zusatz = f.gegner_zusatz.value.trim() || null; }
        const { error } = sp ? await sb.from('ms_spiele').update(row).eq('id', sp.id) : await sb.from('ms_spiele').insert(row);
        if (error) throw error;
        offen.add(a.id);
        dlg.close(); toast('Gespeichert', 'ok'); neu();
      } catch (err) { fehler(fehlerText(err)); }
      knopf.disabled = false;
    };
    dlg.showModal();
  }

  // ==============================================================
  //  DIALOG: Saison/Team (Abschnitt)
  // ==============================================================
  function oeffneAbschnitt(a) {
    if (ro) return;
    const dlg = root.querySelector('.ms-dlg-abschnitt');
    const f = dlg.querySelector('form');
    const b0 = a?.bereich || bereich;
    f.innerHTML = `
      <h2>${a ? 'Saison/Team ändern' : '＋ Saison / Team'}</h2>
      <label>Bereich<select name="bereich">${Object.entries(M.BEREICHE).map(([k, x]) => `<option value="${k}" ${k === b0 ? 'selected' : ''}>${x.icon} ${x.lang}</option>`).join('')}</select></label>
      <div class="ms-reihe">
        <label>Saison / Jahr<input name="saison" list="ms-dl-saison" placeholder="z.B. 2026/27 oder 2026" autocomplete="off" required></label>
        <label class="n-fan">Kategorie<input name="kategorie" list="ms-dl-kat" placeholder="Meisterschaft" autocomplete="off"></label>
      </div>
      <div class="ms-pick p-verein n-fan"><span class="lbl">Mein Verein</span><input autocomplete="off" placeholder="z.B. UHC Lions Konolfingen"><div class="ms-vor" hidden></div></div>
      <div class="ms-reihe n-fan">
        <label>Team / Liga<input name="team" list="ms-dl-team" placeholder="z.B. Herren GF 3. Liga" autocomplete="off"></label>
        <label>Gruppe<input name="gruppe" list="ms-dl-gruppe" placeholder="z.B. Gruppe 1" autocomplete="off"></label>
        <datalist id="ms-dl-team"></datalist><datalist id="ms-dl-gruppe"></datalist>
      </div>
      <label class="n-fan">Staff (eine Zeile pro Funktion)<textarea name="staff" rows="3" placeholder="HC: …&#10;AC: …"></textarea></label>
      <label>Notiz<textarea name="notiz" rows="3" placeholder="z.B. Zusammenfassung, «Keine Tabelle ersichtlich»"></textarea></label>
      <p class="form-error error" hidden></p>
      <div class="dlg-actions">
        ${a ? '<button type="button" class="btn danger btn-weg">🗑</button><span class="ms-luecke"></span>' : ''}
        <button type="button" class="btn ghost btn-abbr">Abbrechen</button>
        <button class="btn primary">Speichern</button>
      </div>`;
    const pV = vereinPicker(f.querySelector('.p-verein'), () => [...new Set(aktivA().filter(x => x.bereich === f.bereich.value && x.verein_id).map(x => x.verein_id))]);
    // Team- und Gruppen-Vorschläge passend zum gewählten Verein (und Team)
    const vorschlagListe = (id, werte) => { f.querySelector(`#${id}`).innerHTML = [...new Set(werte.filter(Boolean))].sort((x, y) => x.localeCompare(y, 'de')).map(w => `<option value="${esc(w)}">`).join(''); };
    const meinVerein = () => pV.id() || M.findeVerein(D.V, pV.text())?.id || null;
    f.team.addEventListener('focus', () => vorschlagListe('ms-dl-team', aktivA().filter(x => !meinVerein() || x.verein_id === meinVerein()).map(x => x.team)));
    f.gruppe.addEventListener('focus', () => vorschlagListe('ms-dl-gruppe', aktivA().filter(x => (!meinVerein() || x.verein_id === meinVerein()) && (!f.team.value.trim() || x.team === f.team.value.trim())).map(x => x.gruppe)));
    f.saison.value = a?.saison || '';
    f.kategorie.value = a?.kategorie || (a ? '' : 'Meisterschaft');
    pV.set(VM.get(a?.verein_id));
    f.team.value = a?.team || ''; f.gruppe.value = a?.gruppe || '';
    f.staff.value = a?.staff || ''; f.notiz.value = a?.notiz || '';
    const fanSicht = () => f.querySelectorAll('.n-fan').forEach(x => { x.hidden = f.bereich.value === 'fan'; });
    f.bereich.onchange = fanSicht; fanSicht();
    const fehler = msg => { const el = f.querySelector('.form-error'); el.textContent = msg; el.hidden = !msg; };
    f.querySelector('.btn-abbr').onclick = () => dlg.close();
    f.querySelector('.btn-weg')?.addEventListener('click', async () => {
      const n = spieleVon(a.id).length;
      const ok = await frage({
        titel: `🗑 ${a.saison} ${abschnittTitel(a)} in den Papierkorb?`,
        html: `<div class="warnung">${plural(n, 'Spiel', 'Spiele')} und die Rangtabellen verschwinden aus allen Ansichten und Statistiken.</div>
          <p class="klein muted">Nichts wird gelöscht – unter <b>Verwaltung → Papierkorb</b> kannst du alles wiederherstellen.</p>`,
        knopf: 'In den Papierkorb',
      });
      if (!ok) return;
      const { error } = await sb.from('ms_abschnitte').update({ geloescht_am: new Date().toISOString() }).eq('id', a.id);
      if (error) return fehler(fehlerText(error));
      dlg.close(); toast('Liegt im Papierkorb'); neu();
    });
    f.onsubmit = async e => {
      e.preventDefault();
      fehler('');
      const fan = f.bereich.value === 'fan';
      const row = {
        bereich: f.bereich.value,
        saison: f.saison.value.trim(),
        kategorie: fan ? null : f.kategorie.value.trim() || null,
        team: fan ? null : f.team.value.trim() || null,
        gruppe: fan ? null : f.gruppe.value.trim() || null,
        staff: fan ? null : f.staff.value.trim() || null,
        notiz: f.notiz.value.trim() || null,
      };
      if (!row.saison) return fehler('Saison oder Jahr ausfüllen.');
      try {
        row.verein_id = fan ? null : await vereinAus(pV, 'Mein Verein');
        const r = a ? await sb.from('ms_abschnitte').update(row).eq('id', a.id).select().single()
          : await sb.from('ms_abschnitte').insert(row).select().single();
        if (r.error) throw r.error;
        offen.add(r.data.id);
        bereich = row.bereich; setEinst({ bereich });
        dlg.close(); toast('Gespeichert', 'ok');
        if (tab !== 'spiele') { tab = 'spiele'; zeichne(); }
        neu();
      } catch (err) { fehler(fehlerText(err)); }
    };
    dlg.showModal();
  }

  // ==============================================================
  //  DIALOG: Rangtabelle
  // ==============================================================
  function oeffneTabelle(a, titel) {
    if (ro) return;
    const dlg = root.querySelector('.ms-dlg-tabelle');
    const f = dlg.querySelector('form');
    const neuT = titel == null;
    const alt = neuT ? [] : D.TB.filter(z => z.abschnitt_id === a.id && z.titel === titel).sort((x, y) => (x.rang ?? 99) - (y.rang ?? 99));
    const zeile = (z = {}) => `<tr>
      <td><input name="rang" type="number" min="1" inputmode="numeric" value="${z.rang ?? ''}"></td>
      <td><input name="verein" list="ms-dl-verein" class="breit" value="${esc(vName(z.verein_id))}" placeholder="Verein" autocomplete="off"></td>
      <td><input name="team" class="mittel" value="${esc(z.team || '')}" placeholder="z.B. U14" autocomplete="off"></td>
      ${SPALTEN.slice(1).map(([k]) => `<td><input name="${k}" type="number" inputmode="numeric" value="${z[k] ?? ''}"></td>`).join('')}
      <td><input name="eigenes" type="radio" ${z.eigenes ? 'checked' : ''} aria-label="Mein Team"></td>
      <td><button type="button" class="btn ghost small z-weg" aria-label="Zeile entfernen">✕</button></td>
    </tr>`;
    f.innerHTML = `
      <div><h2>🏆 Rangtabelle</h2><p class="muted klein">${esc(a.saison)} · ${esc(abschnittTitel(a))}</p></div>
      <label>Titel (bei mehreren Tabellen, sonst leer)<input name="titel" value="${esc(titel || '')}" placeholder="z.B. Gruppe 1, Tenero U14B" autocomplete="off"></label>
      <p class="muted klein">Vereine aus der Liste wählen (wird beim Tippen vorgeschlagen). ◉ = mein Team. Leere Felder sind ok.</p>
      <div class="ms-scroll"><table class="ms-edit">
        <thead><tr>${SPALTEN.slice(0, 1).map(([, t]) => `<th>${t}</th>`).join('')}<th>Verein</th><th>Zusatz</th>${SPALTEN.slice(1).map(([, t]) => `<th>${t}</th>`).join('')}<th>◉</th><th></th></tr></thead>
        <tbody>${(alt.length ? alt : [{}, {}, {}, {}, {}, {}, {}, {}]).map(zeile).join('')}</tbody>
      </table></div>
      <div><button type="button" class="btn ghost small z-neu">＋ Zeile</button></div>
      <p class="form-error error" hidden></p>
      <div class="dlg-actions">
        ${!neuT ? '<button type="button" class="btn danger btn-weg">🗑</button><span class="ms-luecke"></span>' : ''}
        <button type="button" class="btn ghost btn-abbr">Abbrechen</button>
        <button class="btn primary">Speichern</button>
      </div>`;
    const tbody = f.querySelector('tbody');
    // Radio-Gruppe über alle Zeilen (nur eine «mein Team»)
    tbody.addEventListener('change', e => { if (e.target.name === 'eigenes') tbody.querySelectorAll('[name=eigenes]').forEach(r => { if (r !== e.target) r.checked = false; }); });
    f.querySelector('.z-neu').onclick = () => {
      tbody.insertAdjacentHTML('beforeend', zeile({ rang: tbody.rows.length + 1 }));
    };
    tbody.addEventListener('click', e => { if (e.target.closest('.z-weg')) e.target.closest('tr').remove(); });
    const fehler = msg => { const el = f.querySelector('.form-error'); el.textContent = msg; el.hidden = !msg; };
    f.querySelector('.btn-abbr').onclick = () => dlg.close();
    const loescheAlt = () => sb.from('ms_tabellen').delete().eq('abschnitt_id', a.id).eq('titel', titel);
    f.querySelector('.btn-weg')?.addEventListener('click', async () => {
      if (!confirm('Diese Rangtabelle löschen?')) return;
      const { error } = await loescheAlt();
      if (error) return fehler(fehlerText(error));
      dlg.close(); toast('Tabelle gelöscht'); neu();
    });
    f.onsubmit = async e => {
      e.preventDefault();
      fehler('');
      const nt = f.titel.value.trim();
      if (nt !== (titel ?? '') && D.TB.some(z => z.abschnitt_id === a.id && z.titel === nt)) return fehler('Eine Tabelle mit diesem Titel gibt es schon.');
      const zahl = v => v === '' ? null : Math.trunc(+v);
      const zeilen = [...tbody.rows].map(tr => {
        const g = n => tr.querySelector(`[name=${n}]`);
        return { tr, verein: g('verein').value.trim(), team: g('team').value.trim() || null, eigenes: g('eigenes').checked,
          ...Object.fromEntries(SPALTEN.map(([k]) => [k, zahl(g(k).value)])) };
      }).filter(z => z.verein || z.sp != null || z.punkte != null);
      const unbekannt = [...new Set(zeilen.filter(z => z.verein && !M.findeVerein(D.V, z.verein)).map(z => z.verein))];
      if (zeilen.some(z => !z.verein)) return fehler('Jede Zeile braucht einen Verein.');
      if (unbekannt.length && !confirm(`Diese Vereine gibt es noch nicht und werden neu angelegt:\n\n${unbekannt.join('\n')}\n\nOk?`)) return;
      const knopf = f.querySelector('.btn.primary'); knopf.disabled = true;
      try {
        for (const name of unbekannt) {
          const { data, error } = await sb.from('ms_vereine').insert({ name }).select().single();
          if (error) throw error;
          D.V.push(data);
        }
        const rows = zeilen.map(({ tr, verein, ...z }) => ({ ...z, abschnitt_id: a.id, titel: nt, verein_id: M.findeVerein(D.V, verein).id }));
        if (!neuT) { const { error } = await loescheAlt(); if (error) throw error; }
        if (rows.length) { const { error } = await sb.from('ms_tabellen').insert(rows); if (error) throw error; }
        offen.add(a.id);
        dlg.close(); toast('Tabelle gespeichert', 'ok'); neu();
      } catch (err) { fehler(fehlerText(err)); }
      knopf.disabled = false;
    };
    dlg.showModal();
  }

  // ==============================================================
  //  DIALOG: Verein / Halle (inkl. Zusammenführen)
  // ==============================================================
  function oeffneVerein(v) {
    const dlg = root.querySelector('.ms-dlg-verein');
    const f = dlg.querySelector('form');
    f.innerHTML = `
      <h2>${v ? 'Verein ändern' : '＋ Verein'}</h2>
      <label>Name<input name="name" required autocomplete="off"></label>
      <label>Land (leer = Schweiz)<input name="land" placeholder="z.B. CZE, FIN, SWE" maxlength="10" autocomplete="off"></label>
      ${v ? `<details class="ms-merge"><summary>🔗 Mit anderem Verein zusammenführen …</summary>
        <p class="muted klein">Alle Spiele und Tabellen von «${esc(v.name)}» gehen an den gewählten Verein. «${esc(v.name)}» wird danach gelöscht.</p>
        <div class="ms-pick p-ziel"><span class="lbl">Zusammenführen mit</span><input autocomplete="off" placeholder="Verein suchen …"><div class="ms-vor" hidden></div></div>
        <button type="button" class="btn ghost small btn-merge">Zusammenführen</button>
      </details>` : ''}
      <p class="form-error error" hidden></p>
      <div class="dlg-actions">
        ${v ? '<button type="button" class="btn danger btn-weg">🗑</button><span class="ms-luecke"></span>' : ''}
        <button type="button" class="btn ghost btn-abbr">Abbrechen</button>
        <button class="btn primary">Speichern</button>
      </div>`;
    f.name.value = v?.name || ''; f.land.value = v?.land || '';
    const fehler = msg => { const el = f.querySelector('.form-error'); el.textContent = msg; el.hidden = !msg; };
    f.querySelector('.btn-abbr').onclick = () => dlg.close();
    const pZ = v ? machePicker(f.querySelector('.p-ziel'), { suche: q => M.sucheVereine(D.V.filter(x => x.id !== v.id), q), text: x => x.name, sub: aliasSub }) : null;
    f.querySelector('.btn-merge')?.addEventListener('click', async () => {
      const ziel = VM.get(pZ.id()) || M.findeVerein(D.V.filter(x => x.id !== v.id), pZ.text());
      if (!ziel) return fehler('Ziel-Verein aus der Liste wählen.');
      if (!confirm(`«${v.name}» mit «${ziel.name}» zusammenführen?\n\nAlles von «${v.name}» gehört danach zu «${ziel.name}».`)) return;
      try {
        for (const [tab, spalten] of [['ms_spiele', ['gegner_id', 'heim_id', 'gast_id']], ['ms_tabellen', ['verein_id']], ['ms_abschnitte', ['verein_id']]])
          for (const sp of spalten) { const { error } = await sb.from(tab).update({ [sp]: ziel.id }).eq(sp, v.id); if (error) throw error; }
        const r = await sb.from('ms_vereine').delete().eq('id', v.id); if (r.error) throw r.error;
        dlg.close(); toast(`Zusammengeführt mit ${ziel.name}`, 'ok'); neu();
      } catch (err) { fehler(fehlerText(err)); }
    });
    f.querySelector('.btn-weg')?.addEventListener('click', async () => {
      if (!confirm(`«${v.name}» löschen?`)) return;
      const { error } = await sb.from('ms_vereine').delete().eq('id', v.id);
      if (error) return fehler(fehlerText(error));
      dlg.close(); toast('Gelöscht'); neu();
    });
    f.onsubmit = async e => {
      e.preventDefault();
      const name = f.name.value.trim();
      if (!name) return fehler('Name ausfüllen.');
      const doppelt = D.V.find(x => x.id !== v?.id && M.norm(name) === M.norm(x.name));
      if (doppelt) return fehler(`«${doppelt.name}» gibt es schon – stattdessen «Zusammenführen» verwenden.`);
      const row = { name, land: f.land.value.trim().toUpperCase() || null };
      const { error } = v ? await sb.from('ms_vereine').update(row).eq('id', v.id) : await sb.from('ms_vereine').insert(row);
      if (error) return fehler(fehlerText(error));
      dlg.close(); toast('Gespeichert', 'ok'); neu();
    };
    dlg.showModal();
  }

  function oeffneHalle(h) {
    const dlg = root.querySelector('.ms-dlg-verein');
    const f = dlg.querySelector('form');
    f.innerHTML = `
      <h2>${h ? 'Halle ändern' : '＋ Halle'}</h2>
      <label>Ort<input name="ort" required autocomplete="off"></label>
      <label>Halle (darf leer sein)<input name="name" autocomplete="off"></label>
      ${h ? `<details class="ms-merge"><summary>🔗 Mit anderer Halle zusammenführen …</summary>
        <p class="muted klein">Alle Spiele in «${esc(M.halleText(h))}» gehen an die gewählte Halle, diese hier wird gelöscht.</p>
        <div class="ms-pick p-ziel"><span class="lbl">Zusammenführen mit</span><input autocomplete="off" placeholder="Halle suchen …"><div class="ms-vor" hidden></div></div>
        <button type="button" class="btn ghost small btn-merge">Zusammenführen</button>
      </details>` : ''}
      <p class="form-error error" hidden></p>
      <div class="dlg-actions">
        ${h ? '<button type="button" class="btn danger btn-weg">🗑</button><span class="ms-luecke"></span>' : ''}
        <button type="button" class="btn ghost btn-abbr">Abbrechen</button>
        <button class="btn primary">Speichern</button>
      </div>`;
    f.ort.value = h?.ort || ''; f.name.value = h?.name || '';
    const fehler = msg => { const el = f.querySelector('.form-error'); el.textContent = msg; el.hidden = !msg; };
    f.querySelector('.btn-abbr').onclick = () => dlg.close();
    const pZ = h ? machePicker(f.querySelector('.p-ziel'), { suche: q => M.sucheHallen(D.H.filter(x => x.id !== h.id), q), text: M.halleText }) : null;
    f.querySelector('.btn-merge')?.addEventListener('click', async () => {
      const ziel = HM.get(pZ.id()) || M.findeHalle(D.H.filter(x => x.id !== h.id), pZ.text());
      if (!ziel) return fehler('Ziel-Halle aus der Liste wählen.');
      if (!confirm(`«${M.halleText(h)}» mit «${M.halleText(ziel)}» zusammenführen?`)) return;
      let r = await sb.from('ms_spiele').update({ halle_id: ziel.id }).eq('halle_id', h.id);
      if (!r.error) r = await sb.from('ms_hallen').delete().eq('id', h.id);
      if (r.error) return fehler(fehlerText(r.error));
      dlg.close(); toast('Zusammengeführt', 'ok'); neu();
    });
    f.querySelector('.btn-weg')?.addEventListener('click', async () => {
      const n = D.SP.filter(s => s.halle_id === h.id).length;
      if (!confirm(n ? `«${M.halleText(h)}» wird in ${plural(n, 'Spiel', 'Spielen')} verwendet – dort wird die Halle leer. Trotzdem löschen?` : `«${M.halleText(h)}» löschen?`)) return;
      const { error } = await sb.from('ms_hallen').delete().eq('id', h.id);
      if (error) return fehler(fehlerText(error));
      dlg.close(); toast('Gelöscht'); neu();
    });
    f.onsubmit = async e => {
      e.preventDefault();
      const row = { ort: f.ort.value.trim(), name: f.name.value.trim() };
      if (!row.ort) return fehler('Ort ausfüllen.');
      const { error } = h ? await sb.from('ms_hallen').update(row).eq('id', h.id) : await sb.from('ms_hallen').insert(row);
      if (error) return fehler(fehlerText(error));
      dlg.close(); toast('Gespeichert', 'ok'); neu();
    };
    dlg.showModal();
  }

  // ---- Bestätigungs-Dialog (wie Hauptseite) ----------------------
  function frage({ titel, html, knopf, tippen }) {
    const fd = root.querySelector('.ms-dlg-frage');
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
    });
  }
}

function dialogeHTML() {
  return `
  <datalist id="ms-dl-saison"></datalist><datalist id="ms-dl-kat"></datalist>
  <datalist id="ms-dl-liga"></datalist><datalist id="ms-dl-verein"></datalist>
  <dialog class="dlg ms-dlg ms-dlg-spiel"><form class="dlg-body ms-form" novalidate></form></dialog>
  <dialog class="dlg ms-dlg ms-dlg-abschnitt"><form class="dlg-body ms-form" novalidate></form></dialog>
  <dialog class="dlg ms-dlg ms-dlg-tabelle"><form class="dlg-body ms-form" novalidate></form></dialog>
  <dialog class="dlg ms-dlg ms-dlg-verein"><form class="dlg-body ms-form" novalidate></form></dialog>
  <dialog class="dlg ms-dlg ms-dlg-frage">
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
