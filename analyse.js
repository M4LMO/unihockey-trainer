// ============================================================
//  Tool: Analyse – Torzeiten, Matchverlauf, Saison-Trends
//  Nur Ansicht (ändert nichts), rechnet aus den Statistik-Daten.
//
//  Ansichten (Hash):
//    #/analyse                 Tab «Tore» (wann fallen Tore/Gegentore)
//    #/analyse/verlauf[/<id>]  Matchverlauf eines Matches
//    #/analyse/saison          Form, Spielstand, erstes Tor, Comebacks
// ============================================================
import { sb } from './supabase.js';
import { esc, toast, fehlerText } from './ui.js';
import { ladeStammdaten, ladeKader, setAuswahl, waehleTeamKontext, kontextKopf, keinKaderHinweis } from './kontext.js';
import * as L from './statistik-logik.js';
import * as A from './analyse-logik.js';

const TABS = { tore: 'Tore', verlauf: 'Matchverlauf', saison: 'Saison' };
const WETTBEWERB = { meisterschaft: 'Meisterschaft', cup: 'Cup', test: 'Testspiel' };
const ERG = { s: 'Sieg', u: 'Unentschieden', n: 'Niederlage' };
const SVG = 'http://www.w3.org/2000/svg';

const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
function datumText(d, mitTag = true) {
  if (!d) return '';
  const [y, m, t] = d.split('-').map(Number);
  return `${mitTag ? WT[new Date(y, m - 1, t).getDay()] + ' ' : ''}${t}.${m}.${mitTag ? y : ''}`;
}
const plural = (n, ein, mehr) => `${n} ${n === 1 ? ein : mehr}`;
const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
const minText = sek => `${Math.floor(sek / 60)}'`;
const kpi = (wert, text, sub = '') => `<div><b>${wert}</b><small>${text}</small>${sub ? `<em>${sub}</em>` : ''}</div>`;
const legende = (...x) => `<div class="an-leg">${x.map(([k, t]) => `<span><i class="an-sw ${k}"></i>${t}</span>`).join('')}</div>`;

function ladeCss() {
  if (document.querySelector('link[data-analyse]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = 'analyse.css' + (window.APP_V ? `?v=${encodeURIComponent(window.APP_V)}` : ''); l.dataset.analyse = '1';
  document.head.appendChild(l);
}

// ---- kleine SVG-Helfer ------------------------------------------
const el = (tag, attr = {}, text) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attr)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
};
// Balken mit abgerundetem Ende nur auf der Datenseite (Basis bleibt eckig)
function balken(x, y0, w, h, nachOben) {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  if (nachOben) {
    const y = y0 - h;
    return `M${x},${y0}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y0}Z`;
  }
  const y = y0 + h;
  return `M${x},${y0}V${y - r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y - r}V${y0}Z`;
}

// Tooltip in einem Diagramm-Rahmen (Antippen auf dem Handy, Hover am PC)
function tooltip(rahmen) {
  const t = document.createElement('div');
  t.className = 'an-tip'; t.hidden = true;
  rahmen.appendChild(t);
  return {
    zeige(html, x, y) {
      t.innerHTML = html; t.hidden = false;
      const bw = rahmen.clientWidth, tw = t.offsetWidth, th = t.offsetHeight;
      t.style.left = `${Math.max(4, Math.min(bw - tw - 4, x - tw / 2))}px`;
      t.style.top = `${Math.max(0, y - th - 10)}px`;
    },
    weg() { t.hidden = true; },
  };
}

// ================================================================
export async function mount(root) {
  ladeCss();
  const teile = location.hash.replace(/^#\/?/, '').split('/');
  let tab = TABS[teile[1]] ? teile[1] : 'tore';
  let matchId = tab === 'verlauf' ? teile[2] || null : null;
  let filter = { wettbewerb: L.getWbFilter(), ort: '' };

  root.innerHTML = `<div class="an"><p class="muted pad">Lade …</p></div>`;
  const box = root.querySelector('.an');
  const S = { st: { saisons: [], teams: [], listen: [] }, saisonId: null, teamId: null, liste: null, kMap: new Map(), matches: [] };
  const saison = () => S.st.saisons.find(s => s.id === S.saisonId);
  const team = () => S.st.teams.find(t => t.id === S.teamId);
  const kName = id => S.kMap.get(id)?.name ?? '?';
  const kNr = id => S.kMap.get(id)?.nummer;
  const person = id => { const n = kNr(id); return `${n != null ? `${n} ` : ''}${esc(kName(id))}`; };

  async function ladeBasis() {
    S.st = await ladeStammdaten();
    // Team ist fix (Hauptseite), Saison nur aus den Saisons dieses Teams
    const K = waehleTeamKontext(S.st, { saisonId: S.saisonId });
    S.teamId = K.team?.id ?? null; S.saisonId = K.saison?.id ?? null; S.liste = K.liste; S.teamSaisons = K.saisons;
    const kader = S.liste ? await ladeKader(S.liste.id) : [];
    S.kMap = new Map(kader.map(k => [k.id, k]));
    S.matches = [];
    if (S.liste) {
      const { data, error } = await sb.from('einsaetze').select('*, match_ereignisse(*)').eq('liste_id', S.liste.id).eq('typ', 'match');
      if (error) { toast(fehlerText(error), 'error'); throw error; }
      S.matches = data.sort((a, b) => b.datum.localeCompare(a.datum) || String(b.erstellt_am).localeCompare(String(a.erstellt_am)));
    }
  }
  const gefiltert = () => S.matches.filter(m => L.imWettbewerb(filter.wettbewerb)(m) && (!filter.ort || m.ort === filter.ort));

  // ---- Live-Updates + Grösse ändern ------------------------------
  let timer, rTimer;
  const spaeter = () => { clearTimeout(timer); timer = setTimeout(() => ladeBasis().then(zeichne).catch(() => {}), 400); };
  const kanal = sb.channel('analyse-live');
  for (const table of ['einsaetze', 'match_ereignisse', 'kader'])
    kanal.on('postgres_changes', { event: '*', schema: 'public', table }, spaeter);
  kanal.subscribe();
  let breite = 0;
  const beiGroesse = () => {
    clearTimeout(rTimer);
    rTimer = setTimeout(() => { if (Math.abs(box.clientWidth - breite) > 8) zeichneTab(); }, 200);
  };
  window.addEventListener('resize', beiGroesse);
  const aufraeumen = () => { clearTimeout(timer); clearTimeout(rTimer); window.removeEventListener('resize', beiGroesse); sb.removeChannel(kanal); };

  try { await ladeBasis(); zeichne(); }
  catch (e) { box.innerHTML = `<p class="error pad">${esc(fehlerText(e))}</p>`; }
  return aufraeumen;

  // ==============================================================
  function zeichne() {
    box.innerHTML = `
      ${kontextKopf(team(), S.teamSaisons, S.saisonId)}
      <div class="an-inhalt"></div>`;
    box.querySelector('.sel-saison')?.addEventListener('change', e => { S.saisonId = e.target.value; setAuswahl({ saisonId: S.saisonId }); matchId = null; ladeBasis().then(zeichne); });
    const inhalt = box.querySelector('.an-inhalt');
    if (!S.liste) { inhalt.innerHTML = keinKaderHinweis(team()); return; }
    const knopf = (k, v, aktuell, text) => `<button data-k="${k}" data-v="${v}" class="${aktuell === v ? 'on' : ''}">${text}</button>`;
    inhalt.innerHTML = `
      <div class="seg an-tabs">${Object.entries(TABS).map(([k, t]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="an-filter">
        ${L.wbUmschalter(filter.wettbewerb, 'an-wb')}
        <div class="seg an-ort">${knopf('ort', '', filter.ort, 'Alle')}${knopf('ort', 'heim', filter.ort, 'Heim')}${knopf('ort', 'auswaerts', filter.ort, 'Auswärts')}</div>
      </div>
      <div class="an-tab"></div>`;
    inhalt.querySelector('.an-tabs').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      tab = b.dataset.t; zeichne();
    };
    inhalt.querySelector('.an-wb').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      filter.wettbewerb = L.wbKlick(filter.wettbewerb, b.dataset.wb); L.setWbFilter(filter.wettbewerb); zeichne();
    };
    inhalt.querySelector('.an-ort').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      filter.ort = b.dataset.v; zeichne();
    };
    zeichneTab();
  }

  function zeichneTab() {
    const ziel = box.querySelector('.an-tab');
    if (!ziel) return;
    breite = box.clientWidth;
    history.replaceState(null, '', tab === 'tore' ? '#/analyse' : tab === 'verlauf' && matchId ? `#/analyse/verlauf/${matchId}` : `#/analyse/${tab}`);
    if (!filter.wettbewerb.length) { ziel.innerHTML = L.WB_LEER_HINWEIS; return; }
    const ms = gefiltert();
    if (!ms.some(A.hatTore) && tab !== 'saison') {
      ziel.innerHTML = `<p class="muted pad leer">${S.matches.length ? `Keine Matches mit erfassten Toren (${esc(L.wbText(filter.wettbewerb))}${filter.ort ? `, ${filter.ort === 'heim' ? 'Heim' : 'Auswärts'}` : ''}).`
        : 'Noch keine Matches.'}<br>Tore werden im Tool <a href="#/statistik">Statistik</a> erfasst.</p>`;
      return;
    }
    if (tab === 'tore') tabTore(ziel, ms);
    else if (tab === 'verlauf') tabVerlauf(ziel, ms);
    else tabSaison(ziel, ms);
  }

  // ==============================================================
  //  TAB «TORE»
  // ==============================================================
  function tabTore(ziel, ms) {
    const Z = A.torZeiten(ms), R = A.reaktion(ms), sit = A.nachSituation(ms);
    const tf = Z.buckets.reduce((a, b) => a + b.f, 0) + Z.v.f, tg = Z.buckets.reduce((a, b) => a + b.g, 0) + Z.v.g;
    const nAbs = Z.format.abschnitte, absWort = nAbs === 2 ? 'Halbzeit' : nAbs === 3 ? 'Drittel' : 'Abschnitt';
    const jedes = nAbs === 2 ? 'jeder Halbzeit' : nAbs === 3 ? 'jedes Drittels' : 'jedes Abschnitts';
    const [staerk, schwaech] = nAbs === 2 ? ['Stärkste', 'Schwächste'] : nAbs === 3 ? ['Stärkstes', 'Schwächstes'] : ['Stärkster', 'Schwächster'];
    // Bester / schwächster Abschnitt (Tordifferenz)
    const absListe = [...Z.abschnitte.entries()].filter(([k]) => k !== 'V').sort((a, b) => a[0] - b[0]);
    const diff = ([, x]) => x.f - x.g;
    const bester = [...absListe].sort((a, b) => diff(b) - diff(a))[0], schwach = [...absListe].sort((a, b) => diff(a) - diff(b))[0];
    const absName = k => L.abschnittName(k, Z.format);
    const SIT = [['eq', 'Gleichzahl'], ['pp', 'Überzahl (PP)'], ['bp', 'Unterzahl (BP)'], ['6v5', 'ohne eigenen Goalie'], ['5v6', 'Gegner ohne Goalie'], ['pen', 'Penalty']]
      .filter(([k]) => sit.has(k));
    const maxSit = Math.max(1, ...[...sit.values()].flatMap(x => [x.f, x.g]));

    ziel.innerHTML = `
      <section class="an-karte">
        <h3 class="gruppe">Wann fallen die Tore? <span>${plural(Z.matches, 'Match', 'Matches')}</span></h3>
        ${legende(['f', `Tore (${tf})`], ['g', `Gegentore (${tg})`])}
        <div class="an-chart an-torzeit"></div>
        <p class="muted klein">Pro 5 Minuten Spielzeit, alle Matches zusammengezählt. Balken antippen für Details.${Z.format.gemischt ? ' Matches mit unterschiedlichem Format gemischt.' : ''}</p>
        <details class="an-tabelle"><summary>Als Tabelle</summary>
          <table><thead><tr><th>Minute</th><th>Tore</th><th>Gegentore</th></tr></thead><tbody>
          ${Z.buckets.map(b => `<tr><td>${b.von / 60 + 1}.–${b.bis / 60}.</td><td>${b.f}</td><td>${b.g}</td></tr>`).join('')}
          ${Z.v.f || Z.v.g ? `<tr><td>Verlängerung</td><td>${Z.v.f}</td><td>${Z.v.g}</td></tr>` : ''}
          </tbody></table></details>
      </section>

      <section class="an-karte">
        <h3 class="gruppe">Pro ${absWort}</h3>
        <div class="an-abs">${absListe.concat(Z.abschnitte.has('V') ? [['V', Z.abschnitte.get('V')]] : []).map(([k, x]) => {
          const d = x.f - x.g;
          return `<div><small>${k === 'V' ? 'Verl.' : esc(absName(k))}</small><b>${x.f}:${x.g}</b>
            <em class="${d > 0 ? 'plus' : d < 0 ? 'minus' : ''}">${d > 0 ? '+' : ''}${d}</em></div>`;
        }).join('')}</div>
        ${absListe.length > 1 && diff(bester) !== diff(schwach) ? `<p class="klein">💪 ${staerk}: <b>${esc(absName(bester[0]))}</b> · 😬 ${schwaech}: <b>${esc(absName(schwach[0]))}</b></p>` : ''}
        <div class="an-kpis klein">
          ${kpi(`${Z.frueh.f}:${Z.frueh.g}`, 'erste 5 Min', jedes)}
          ${kpi(`${Z.spaet.f}:${Z.spaet.g}`, 'letzte 5 Min', jedes)}
        </div>
      </section>

      <section class="an-karte">
        <h3 class="gruppe">Reaktion</h3>
        <div class="an-kpis">
          ${kpi(R.gegentore ? `${pct(R.antwort, R.gegentore)} %` : '–', 'Antwort auf Gegentor', `${R.antwort} von ${R.gegentore}× innert 5 Min selbst getroffen`)}
          ${kpi(R.tore ? `${pct(R.sofortGegen, R.tore)} %` : '–', 'Gegentor nach eigenem Tor', `${R.sofortGegen} von ${R.tore}× innert 2 Min kassiert`)}
        </div>
        <p class="muted klein">Zeigt, wie das Team auf Tore reagiert: zurückschlagen nach einem Gegentor – und konzentriert bleiben nach einem eigenen Tor.</p>
      </section>

      <section class="an-karte">
        <h3 class="gruppe">Tore nach Situation</h3>
        ${legende(['f', 'Tore'], ['g', 'Gegentore'])}
        <div class="an-sit">${SIT.map(([k, t]) => {
          const x = sit.get(k);
          return `<div class="an-sit-z"><span>${t}</span>
            <span class="an-hbar f"><i style="width:${100 * x.f / maxSit}%"></i><b>${x.f}</b></span>
            <span class="an-hbar g"><i style="width:${100 * x.g / maxSit}%"></i><b>${x.g}</b></span></div>`;
        }).join('')}</div>
      </section>`;
    chartTorzeit(ziel.querySelector('.an-torzeit'), Z);
  }

  // Gespiegeltes Balkendiagramm: Tore nach oben, Gegentore nach unten
  function chartTorzeit(rahmen, Z) {
    const W = Math.max(280, rahmen.clientWidth), H = 230;
    const pad = { l: 22, r: 6, t: 14, b: 26 };
    const mitV = Z.v.f || Z.v.g;
    const spalten = Z.buckets.map(b => ({ ...b, label: `${b.von / 60 + 1}.–${b.bis / 60}. Minute` }));
    if (mitV) spalten.push({ f: Z.v.f, g: Z.v.g, label: 'Verlängerung', v: true });
    const n = spalten.length;
    const plotW = W - pad.l - pad.r - (mitV ? 8 : 0);
    const bw = plotW / n;
    const max = Math.max(1, ...spalten.flatMap(s => [s.f, s.g]));
    const halb = (H - pad.t - pad.b) / 2, y0 = pad.t + halb;
    const sy = v => v / max * (halb - 2);
    const xVon = i => pad.l + i * bw + (spalten[i].v ? 8 : 0);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': 'Tore und Gegentore pro 5 Minuten' });
    // Raster: nur Mittellinie + Max-Werte
    const ganz = Math.ceil(max);
    for (const v of [ganz, -ganz]) {
      const y = y0 - Math.sign(v) * sy(Math.abs(v));
      svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y, y2: y, class: 'an-grid' }));
      svg.append(el('text', { x: pad.l - 5, y: y + 4, class: 'an-ax', 'text-anchor': 'end' }, Math.abs(v)));
    }
    // Abschnitts-Grenzen
    for (const g of Z.grenzen) {
      const x = pad.l + g / A.BUCKET * bw;
      svg.append(el('line', { x1: x, x2: x, y1: pad.t - 6, y2: H - pad.b + 4, class: 'an-grenze' }));
    }
    // Balken
    const gap = Math.min(2, bw * 0.15);
    spalten.forEach((s, i) => {
      const x = xVon(i) + gap / 2, w = bw - gap;
      if (s.f) svg.append(el('path', { d: balken(x, y0 - 1, w, sy(s.f), true), class: 'an-f' }));
      if (s.g) svg.append(el('path', { d: balken(x, y0 + 1, w, sy(s.g), false), class: 'an-g' }));
    });
    svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y0, y2: y0, class: 'an-achse' }));
    // Spitzen beschriften (nur das Maximum jeder Seite)
    for (const [k, oben] of [['f', true], ['g', false]]) {
      const m = Math.max(...spalten.map(s => s[k]));
      if (!m) continue;
      const i = spalten.findIndex(s => s[k] === m);
      svg.append(el('text', { x: xVon(i) + bw / 2, y: oben ? y0 - sy(m) - 4 : y0 + sy(m) + 11, class: 'an-wert', 'text-anchor': 'middle' }, m));
    }
    // x-Achse: Minuten alle 10'
    const lang = Z.buckets.length * A.BUCKET;
    for (let t = 0; t <= lang; t += 600) {
      svg.append(el('text', { x: pad.l + t / A.BUCKET * bw, y: H - 8, class: 'an-ax', 'text-anchor': t === 0 ? 'start' : 'middle' }, `${t / 60}'`));
    }
    if (mitV) svg.append(el('text', { x: xVon(n - 1) + bw / 2, y: H - 8, class: 'an-ax', 'text-anchor': 'middle' }, 'V'));
    // Treffflächen (ganze Höhe)
    const tip = tooltip(rahmen);
    const markiert = el('rect', { class: 'an-hover', y: pad.t, height: H - pad.t - pad.b, width: bw, rx: 4, visibility: 'hidden' });
    svg.insertBefore(markiert, svg.firstChild);
    spalten.forEach((s, i) => {
      const r = el('rect', { x: xVon(i), y: 0, width: bw, height: H, fill: 'transparent' });
      const zeig = () => {
        markiert.setAttribute('x', xVon(i)); markiert.setAttribute('visibility', 'visible');
        tip.zeige(`<b>${s.label}</b><span><i class="an-sw f"></i>${plural(s.f, 'Tor', 'Tore')}</span><span><i class="an-sw g"></i>${plural(s.g, 'Gegentor', 'Gegentore')}</span>`,
          xVon(i) + bw / 2, pad.t);
      };
      r.addEventListener('pointerenter', zeig); r.addEventListener('click', zeig);
      svg.append(r);
    });
    svg.addEventListener('pointerleave', () => { tip.weg(); markiert.setAttribute('visibility', 'hidden'); });
    rahmen.prepend(svg);
  }

  // ==============================================================
  //  TAB «MATCHVERLAUF»
  // ==============================================================
  function tabVerlauf(ziel, ms) {
    const mitTore = ms.filter(A.hatTore);
    if (!mitTore.some(m => m.id === matchId)) matchId = mitTore[0].id;
    const m = mitTore.find(x => x.id === matchId);
    const V = A.matchVerlauf(m), r = A.resultat(m), erg = A.ergebnis(r);
    const fT = V.punkte.at(-1)?.f ?? 0, gT = V.punkte.at(-1)?.g ?? 0;
    // n.P.: das Siegtor im Penaltyschiessen steht nicht im Telegramm
    const unvollst = r && (r.f !== fT || r.g !== gT) && !(m.entscheid === 'np' && fT === gT && Math.min(r.f, r.g) === fT);
    const sum = V.zeit.vorne + V.zeit.gleich + V.zeit.hinten || 1;
    const teil = (k, text) => V.zeit[k] ? `<span class="an-st ${k}" style="flex:${V.zeit[k]}" title="${text}"><b>${pct(V.zeit[k], sum)} %</b></span>` : '';
    ziel.innerHTML = `
      <label class="an-match">Match
        <select>${mitTore.map(x => {
          const rr = A.resultat(x);
          return `<option value="${x.id}" ${x.id === m.id ? 'selected' : ''}>${esc(datumText(x.datum, false))} · ${esc(x.titel || 'Match')}${rr ? ` · ${esc(rr.text)}` : ''}</option>`;
        }).join('')}</select>
      </label>
      <section class="an-karte">
        <div class="an-kopf">
          <span class="an-erg-b ${erg || 'leer'}">${erg ? erg.toUpperCase() : '–'}</span>
          <div><strong>${esc(m.titel || 'Match')}</strong><small class="muted">${esc(datumText(m.datum))}${m.wettbewerb ? ` · ${esc(WETTBEWERB[m.wettbewerb] || m.wettbewerb)}` : ''}</small></div>
          <b class="an-res">${r ? `${r.f}:${r.g}${r.f !== r.g && L.ENTSCHEID[m.entscheid] ? `<small>${L.ENTSCHEID[m.entscheid]}</small>` : ''}` : ''}</b>
        </div>
        ${legende(['f', 'Wir'], ['g', 'Gegner'], ['pp', 'Überzahl'], ['bp', 'Unterzahl'])}
        <div class="an-chart an-verlauf"></div>
        <p class="muted klein">Punkte antippen für Details.${unvollst ? ` ⚠️ Im Telegramm sind ${fT}:${gT} Tore erfasst, Resultat ist ${esc(r.text)}.` : ''}</p>
      </section>
      <section class="an-karte">
        <h3 class="gruppe">Spielstand</h3>
        <div class="an-stand">${teil('vorne', 'Führung')}${teil('gleich', 'Gleichstand')}${teil('hinten', 'Rückstand')}</div>
        <div class="an-stand-leg"><span><i class="an-sw vorne"></i>Führung ${minText(V.zeit.vorne)}</span><span><i class="an-sw gleich"></i>Gleichstand ${minText(V.zeit.gleich)}</span><span><i class="an-sw hinten"></i>Rückstand ${minText(V.zeit.hinten)}</span></div>
        <div class="an-kpis klein">
          ${kpi(V.erstes === 'tor' ? '✅' : V.erstes === 'gegentor' ? '❌' : '–', 'Erstes Tor', V.erstes === 'tor' ? 'wir' : V.erstes === 'gegentor' ? 'Gegner' : '')}
          ${kpi(V.maxVorne ? `+${V.maxVorne}` : '–', 'Höchste Führung')}
          ${kpi(V.maxHinten ? `−${V.maxHinten}` : '–', 'Höchster Rückstand')}
        </div>
        <a class="btn ghost small an-link" href="#/statistik/m/${m.id}">Zum Matchtelegramm →</a>
      </section>`;
    ziel.querySelector('.an-match select').onchange = e => { matchId = e.target.value; zeichneTab(); };
    chartVerlauf(ziel.querySelector('.an-verlauf'), m, V);
  }

  function chartVerlauf(rahmen, m, V) {
    const W = Math.max(280, rahmen.clientWidth), H = 240;
    const pad = { l: 22, r: 50, t: 18, b: 26 };
    const maxY = Math.max(1, ...V.punkte.flatMap(p => [p.f, p.g]));
    const sx = t => pad.l + t / V.ende * (W - pad.l - pad.r);
    const sy = v => H - pad.b - v / maxY * (H - pad.t - pad.b);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': 'Spielstand über die Zeit' });
    // Über-/Unterzahl als Bänder
    for (const p of V.phasen) {
      svg.append(el('rect', { x: sx(p.von), y: pad.t - 8, width: Math.max(1, sx(p.bis) - sx(p.von)), height: H - pad.b - pad.t + 8, class: `an-band ${p.z}` }));
    }
    // Raster (ganze Tore)
    const schritt = maxY > 8 ? 2 : 1;
    for (let v = 0; v <= maxY; v += schritt) {
      svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: sy(v), y2: sy(v), class: v ? 'an-grid' : 'an-achse' }));
      svg.append(el('text', { x: pad.l - 6, y: sy(v) + 4, class: 'an-ax', 'text-anchor': 'end' }, v));
    }
    // Abschnitte
    V.grenzen.forEach(g => svg.append(el('line', { x1: sx(g), x2: sx(g), y1: pad.t - 8, y2: H - pad.b + 4, class: 'an-grenze' })));
    const absMitte = [0, ...V.grenzen, Math.min(V.ende, L.spielSek(m))];
    for (let i = 0; i < absMitte.length - 1; i++) {
      svg.append(el('text', { x: (sx(absMitte[i]) + sx(absMitte[i + 1])) / 2, y: H - 8, class: 'an-ax', 'text-anchor': 'middle' },
        L.abschnittZahl(m) === 3 ? `${i + 1}. Drittel` : L.abschnittZahl(m) === 2 ? `${i + 1}. HZ` : `${i + 1}.`));
    }
    if (V.ende > L.spielSek(m)) svg.append(el('text', { x: (sx(L.spielSek(m)) + sx(V.ende)) / 2, y: H - 8, class: 'an-ax', 'text-anchor': 'middle' }, 'V'));
    // Treppenlinien
    const linie = k => {
      let d = `M${sx(0)},${sy(0)}`, y = 0;
      for (const p of V.punkte) { if (p[k] !== y) { d += `H${sx(p.t)}V${sy(p[k])}`; y = p[k]; } }
      return d + `H${sx(V.ende)}`;
    };
    svg.append(el('path', { d: linie('g'), class: 'an-linie g' }));
    svg.append(el('path', { d: linie('f'), class: 'an-linie f' }));
    // Endbeschriftung direkt an der Linie
    const fE = V.punkte.at(-1)?.f ?? 0, gE = V.punkte.at(-1)?.g ?? 0;
    let yf = sy(fE) + 4, yg = sy(gE) + 4;
    if (Math.abs(yf - yg) < 13) { if (fE >= gE) { yf -= 7; yg += 7; } else { yf += 7; yg -= 7; } }
    svg.append(el('text', { x: W - pad.r + 5, y: yf, class: 'an-endlabel' }, `Wir ${fE}`));
    svg.append(el('text', { x: W - pad.r + 5, y: yg, class: 'an-endlabel' }, `Geg. ${gE}`));
    // Tor-Punkte + Tooltip
    const tip = tooltip(rahmen);
    for (const p of V.punkte) {
      const k = p.e.art === 'tor' ? 'f' : 'g';
      const x = sx(p.t), y = sy(p[k]);
      svg.append(el('circle', { cx: x, cy: y, r: 4.5, class: `an-punkt ${k}` }));
      const hit = el('circle', { cx: x, cy: y, r: 14, fill: 'transparent' });
      const wer = p.e.art === 'tor'
        ? (p.e.kader_id ? person(p.e.kader_id) : 'Tor') + (p.e.assist_id ? ` <small>(Assist ${person(p.e.assist_id)})</small>` : '')
        : `Gegentor${p.e.gegner_nr != null ? ` <small>(#${esc(p.e.gegner_nr)})</small>` : ''}`;
      const sitTxt = p.sit !== 'eq' ? ` · ${L.SITUATION[p.sit]?.kurz || ''}` : '';
      const zeig = () => tip.zeige(`<b>${L.zeitText(p.t)} · ${p.f}:${p.g}${sitTxt}</b><span><i class="an-sw ${k}"></i>${wer}</span>`, x, y - 4);
      hit.addEventListener('pointerenter', zeig); hit.addEventListener('click', zeig);
      svg.append(hit);
    }
    svg.addEventListener('pointerleave', () => tip.weg());
    rahmen.prepend(svg);
  }

  // ==============================================================
  //  TAB «SAISON»
  // ==============================================================
  function tabSaison(ziel, ms) {
    const B = A.saisonBilanz(ms);
    if (!B.form.length && !B.verlaufMatches) { ziel.innerHTML = '<p class="muted pad leer">Noch keine Resultate.</p>'; return; }
    const sum = B.zeit.vorne + B.zeit.gleich + B.zeit.hinten || 1;
    const teil = k => B.zeit[k] ? `<span class="an-st ${k}" style="flex:${B.zeit[k]}"><b>${pct(B.zeit[k], sum)} %</b></span>` : '';
    const bilanz = x => `${x.s}-${x.u}-${x.n}`;
    const n = x => x.s + x.u + x.n;
    const bil = (x, text) => kpi(n(x) ? `${pct(x.s, n(x))} %` : '–', text, n(x) ? `Siege · ${bilanz(x)} (S-U-N)` : 'noch nie');
    const letzte = B.form.slice(-5);
    const serie = (() => {
      if (!B.form.length) return '';
      const last = B.form.at(-1).erg; let k = 0;
      for (let i = B.form.length - 1; i >= 0 && B.form[i].erg === last; i--) k++;
      return k >= 2 ? `${k} ${last === 's' ? 'Siege' : last === 'n' ? 'Niederlagen' : 'Unentschieden'} in Folge` : '';
    })();
    const matchKurz = x => `${esc(x.m.titel || 'Match')} <small class="muted">${esc(datumText(x.m.datum, false))}</small>`;
    ziel.innerHTML = `
      <section class="an-karte">
        <h3 class="gruppe">Formkurve <span>${plural(B.form.length, 'Match', 'Matches')}</span></h3>
        ${B.form.length ? `
        <div class="an-form5">Letzte ${letzte.length}: ${letzte.map(x => `<span class="an-erg-b ${x.erg}" title="${esc(ERG[x.erg])}">${x.erg.toUpperCase()}</span>`).join('')}
          ${serie ? `<em>${serie}</em>` : ''}</div>
        <div class="an-chart an-formchart"></div>
        <p class="muted klein">Tordifferenz pro Match (älteste links). Balken antippen → Matchverlauf.</p>` : '<p class="muted klein">Noch keine Resultate.</p>'}
      </section>
      ${B.verlaufMatches ? `
      <section class="an-karte">
        <h3 class="gruppe">Spielstand über die Saison</h3>
        <div class="an-stand">${teil('vorne')}${teil('gleich')}${teil('hinten')}</div>
        <div class="an-stand-leg"><span><i class="an-sw vorne"></i>Führung</span><span><i class="an-sw gleich"></i>Gleichstand</span><span><i class="an-sw hinten"></i>Rückstand</span></div>
        <p class="muted klein">Anteil der Spielzeit, in der ihr geführt habt, gleich auf wart oder hinten lagt.</p>
      </section>
      <section class="an-karte">
        <h3 class="gruppe">Erstes Tor</h3>
        <div class="an-kpis">
          ${bil(B.erstesTor, 'wenn wir 1:0 machen')}
          ${bil(B.erstesGegentor, 'wenn der Gegner 0:1 macht')}
        </div>
      </section>
      <section class="an-karte">
        <h3 class="gruppe">Moral</h3>
        <div class="an-kpis">
          ${kpi(B.comebacks.length, 'Comebacks 🔥', 'Rückstand gedreht zum Sieg')}
          ${kpi(B.verspielt.length, 'Führung verspielt', 'geführt, aber nicht gewonnen')}
        </div>
        ${B.comebacks.length || B.verspielt.length ? `<ul class="an-liste">
          ${B.comebacks.map(x => `<li><a href="#/analyse/verlauf/${x.m.id}">🔥 ${matchKurz(x)} <span>nach −${x.rueckstand}</span></a></li>`).join('')}
          ${B.verspielt.map(x => `<li><a href="#/analyse/verlauf/${x.m.id}">😬 ${matchKurz(x)} <span>nach +${x.fuehrung}</span></a></li>`).join('')}
        </ul>` : ''}
        ${B.groessteFuehrung || B.groessterRueckstand ? `<p class="klein muted">
          ${B.groessteFuehrung ? `Grösste Führung: <b>+${B.groessteFuehrung.n}</b> (${esc(B.groessteFuehrung.m.titel || 'Match')})` : ''}
          ${B.groessteFuehrung && B.groessterRueckstand ? ' · ' : ''}
          ${B.groessterRueckstand ? `Grösster Rückstand: <b>−${B.groessterRueckstand.n}</b> (${esc(B.groessterRueckstand.m.titel || 'Match')})` : ''}</p>` : ''}
      </section>` : ''}
      ${!filter.ort ? `<section class="an-karte">
        <h3 class="gruppe">Heim / Auswärts</h3>
        <div class="an-kpis">
          ${kpi(bilanz(B.ort.heim), 'Heim', 'S-U-N')}
          ${kpi(bilanz(B.ort.auswaerts), 'Auswärts', 'S-U-N')}
        </div>
      </section>` : ''}`;
    ziel.querySelectorAll('.an-liste a').forEach(a => a.addEventListener('click', e => {
      e.preventDefault(); matchId = a.getAttribute('href').split('/').pop(); tab = 'verlauf'; zeichne();
    }));
    const fc = ziel.querySelector('.an-formchart');
    if (fc) chartForm(fc, B.form);
  }

  // Tordifferenz pro Match (nach oben = gewonnen)
  function chartForm(rahmen, form) {
    const W = Math.max(280, rahmen.clientWidth), H = 170;
    const pad = { l: 22, r: 6, t: 12, b: 12 };
    const max = Math.max(1, ...form.map(x => Math.abs(x.diff)));
    const halb = (H - pad.t - pad.b) / 2, y0 = pad.t + halb;
    const bw = Math.min(36, (W - pad.l - pad.r) / form.length);
    const x0 = pad.l;
    const sy = v => Math.abs(v) / max * (halb - 2);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': 'Tordifferenz pro Match' });
    for (const v of [max, -max]) {
      const y = y0 - Math.sign(v) * sy(v);
      svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y, y2: y, class: 'an-grid' }));
      svg.append(el('text', { x: pad.l - 5, y: y + 4, class: 'an-ax', 'text-anchor': 'end' }, v > 0 ? `+${v}` : `−${-v}`));
    }
    svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y0, y2: y0, class: 'an-achse' }));
    const gap = Math.min(3, bw * 0.2);
    const tip = tooltip(rahmen);
    form.forEach((f, i) => {
      const x = x0 + i * bw + gap / 2, w = bw - gap;
      if (f.diff) svg.append(el('path', { d: balken(x, f.diff > 0 ? y0 - 1 : y0 + 1, w, sy(f.diff), f.diff > 0), class: `an-erg ${f.erg}` }));
      else svg.append(el('rect', { x, y: y0 - 2, width: w, height: 4, rx: 2, class: 'an-erg u' }));
      const hit = el('rect', { x: x0 + i * bw, y: 0, width: bw, height: H, fill: 'transparent', style: 'cursor:pointer' });
      const zeig = () => tip.zeige(`<b>${esc(datumText(f.m.datum, false))} · ${esc(f.r.text)}</b><span>${esc(f.m.titel || 'Match')}</span><small>${A.hatTore(f.m) ? 'Nochmals antippen → Verlauf' : 'Kein Telegramm erfasst'}</small>`,
        x0 + i * bw + bw / 2, Math.min(y0 - sy(Math.max(0, f.diff)), y0) - 2);
      hit.addEventListener('pointerenter', zeig);
      hit.addEventListener('click', () => {
        if (rahmen.dataset.zuletzt === String(i) && A.hatTore(f.m)) { matchId = f.m.id; tab = 'verlauf'; zeichne(); return; }
        rahmen.dataset.zuletzt = String(i); zeig();
      });
      svg.append(hit);
    });
    svg.addEventListener('pointerleave', () => { tip.weg(); delete rahmen.dataset.zuletzt; });
    rahmen.prepend(svg);
  }
}
