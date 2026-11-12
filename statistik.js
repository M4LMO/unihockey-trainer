// ============================================================
//  Tool: Statistik – Match-Statistik aus der Swiss-Unihockey-App
//  (Screenshots → Claude → Import-Text) + von Hand bearbeiten.
//
//  Ansichten (Hash):
//    #/statistik            Übersicht (Tabs: Matches / Skorer / Goalies / Team)
//    #/statistik/<tab>
//    #/statistik/m/<id>     ein Match (Telegramm, Aufstellung, Plus/Minus)
//  Ein Match ist ein Match-Einsatz aus dem Linien-Tool.
// ============================================================
import { sb } from './supabase.js';
import { esc, toast, fehlerText } from './ui.js';
import { ladeStammdaten, ladeKader, getAuswahl, setAuswahl, teamLabel } from './kontext.js';
import * as L from './statistik-logik.js';
import { andereNummern, auchNr } from './nummern.js';

const TABS = ['matches', 'skorer', 'goalies', 'team'];
const WETTBEWERB = { meisterschaft: 'Meisterschaft', cup: 'Cup', test: 'Testspiel' };
const ORT = { heim: 'Heim', auswaerts: 'Auswärts' };
const ARTEN_LINIE = { linie: 'Linie', pp: 'PP', bp: 'BP', '6v5': '6:5' };
const ART_REIHE = ['linie', 'pp', 'bp', '6v5'];

const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
function datumText(d, mitTag = true) {
  if (!d) return '';
  const [y, m, t] = d.split('-').map(Number);
  return `${mitTag ? WT[new Date(y, m - 1, t).getDay()] + ' ' : ''}${t}.${m}.${y}`;
}
const heute = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const istGoalie = k => k.position === 'Goalie';
const istSpieler = k => k.rolle === 'spieler';
const nachArt = (a, b) => ART_REIHE.indexOf(a.art) - ART_REIHE.indexOf(b.art) || a.nr - b.nr;
const ergebnis = e => e.tore_fuer == null || e.tore_gegen == null ? null
  : e.tore_fuer > e.tore_gegen ? 's' : e.tore_fuer < e.tore_gegen ? 'n' : 'u';
const resText = e => e.tore_fuer != null && e.tore_gegen != null ? `${e.tore_fuer}:${e.tore_gegen}` : (e.resultat || '');
const plural = (n, ein, mehr) => `${n} ${n === 1 ? ein : mehr}`;
const pct = (a, b) => b ? Math.round(100 * a / b) : null;

function ladeCss() {
  if (document.querySelector('link[data-statistik]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = 'statistik.css'; l.dataset.statistik = '1';
  document.head.appendChild(l);
}

// ================================================================
export async function mount(root) {
  ladeCss();
  const teile = location.hash.replace(/^#\/?/, '').split('/');
  const route = teile[1] === 'm' && teile[2] ? { typ: 'match', id: teile[2] }
    : { typ: 'start', tab: TABS.includes(teile[1]) ? teile[1] : 'matches' };

  root.innerHTML = `<div class="st"><p class="muted pad">Lade …</p></div><dialog class="dlg st-dlg"></dialog>`;
  const box = root.querySelector('.st');
  const dlg = root.querySelector('.st-dlg');

  const S = {
    st: { saisons: [], teams: [], listen: [] },
    saisonId: null, teamId: null, liste: null,
    kader: [], kMap: new Map(),
  };
  const saison = () => S.st.saisons.find(s => s.id === S.saisonId);
  const team = () => S.st.teams.find(t => t.id === S.teamId);
  const nurLesen = () => !!saison()?.archiviert;
  const kName = id => id ? (S.kMap.get(id)?.name ?? '?') : '';
  const kNr = id => S.kMap.get(id)?.nummer;
  const kLabel = id => { const n = kNr(id); return `<span class="st-kl">${n != null ? `<b>${n}</b> ` : ''}${esc(kName(id))}</span>`; };

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
    S.kader = S.liste ? await ladeKader(S.liste.id) : [];
    S.kMap = new Map(S.kader.map(k => [k.id, k]));
  }

  // ---- Dialog / DB -------------------------------------------
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

  // ---- Live-Updates ------------------------------------------
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
  dlg.addEventListener('close', () => { if (wartet) { wartet = false; spaeter(); } });
  const kanal = sb.channel('statistik-live');
  for (const table of ['einsaetze', 'match_aufstellung', 'match_ereignisse', 'kader', 'varianten', 'linien', 'linien_spieler'])
    kanal.on('postgres_changes', { event: '*', schema: 'public', table }, spaeter);
  kanal.subscribe();

  const aufraeumen = () => { clearTimeout(timer); sb.removeChannel(kanal); if (dlg.open) dlg.close(); };

  try {
    if (route.typ === 'match') await zeigeMatch(route.id);
    else await zeigeStart(route.tab);
  } catch (e) {
    box.innerHTML = `<p class="error pad">${esc(fehlerText(e))}</p>`;
  }
  return aufraeumen;

  // ---- Matches eines Kaders mit Statistik --------------------
  async function ladeMatches(listeId) {
    const d = await db(sb.from('einsaetze')
      .select('*, match_aufstellung(*), match_ereignisse(*)')
      .eq('liste_id', listeId).eq('typ', 'match'));
    return d.sort((a, b) => b.datum.localeCompare(a.datum) || b.erstellt_am.localeCompare(a.erstellt_am));
  }
  // Wer stand in welcher Linie (für Plus/Minus)
  async function ladeLinienSpieler(linieIds) {
    const ids = [...new Set(linieIds.filter(Boolean))];
    if (!ids.length) return new Map();
    const d = await db(sb.from('linien').select('id, linien_spieler(kader_id)').in('id', ids));
    return new Map(d.map(l => [l.id, new Set(l.linien_spieler.map(r => r.kader_id).filter(Boolean))]));
  }

  // ==============================================================
  //  ÜBERSICHT
  // ==============================================================
  async function zeigeStart(tab) {
    neuLaden = async () => { await ladeBasis(); await zeichne(); };
    let sort = 'p';

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
        <div class="st-inhalt"></div>
        <button class="fab" hidden aria-label="Match importieren">＋</button>`;
      box.querySelector('.sel-saison').onchange = e => { S.saisonId = e.target.value; setAuswahl({ saisonId: S.saisonId }); neuLaden(); };
      box.querySelector('.team-chips').onclick = e => {
        const b = e.target.closest('.chip'); if (!b) return;
        S.teamId = b.dataset.id; setAuswahl({ teamId: S.teamId }); neuLaden();
      };

      const inhalt = box.querySelector('.st-inhalt');
      if (!S.liste) {
        inhalt.innerHTML = `<div class="hinweis">
          <p>${!S.st.saisons.length || !S.st.teams.length ? 'Es gibt noch keine Saison bzw. kein Team.'
            : `<b>${esc(teamLabel(team()))}</b> hat in der Saison <b>${esc(saison()?.name)}</b> noch keinen Kader.`}</p>
          <a class="btn primary" href="#/kader">Zum Kader</a></div>`;
        return;
      }
      inhalt.innerHTML = `
        <div class="seg st-tabs">
          <button data-t="matches" class="${tab === 'matches' ? 'on' : ''}">Matches</button>
          <button data-t="skorer" class="${tab === 'skorer' ? 'on' : ''}">Skorer</button>
          <button data-t="goalies" class="${tab === 'goalies' ? 'on' : ''}">Goalies</button>
          <button data-t="team" class="${tab === 'team' ? 'on' : ''}">Team</button>
        </div>
        <div class="st-tab"><p class="muted pad">Lade …</p></div>`;
      inhalt.querySelector('.st-tabs').onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        tab = b.dataset.t;
        history.replaceState(null, '', tab === 'matches' ? '#/statistik' : `#/statistik/${tab}`);
        zeichne();
      };
      const fab = box.querySelector('.fab');
      fab.hidden = nurLesen() || tab !== 'matches';
      fab.onclick = () => importDialog();

      const ziel = inhalt.querySelector('.st-tab');
      const matches = await ladeMatches(S.liste.id);
      if (tab === 'matches') tabMatches(ziel, matches);
      else if (tab === 'skorer') await tabSkorer(ziel, matches);
      else if (tab === 'goalies') tabGoalies(ziel, matches);
      else tabTeam(ziel, matches);
    }

    // ---- Matches ----------------------------------------------
    function tabMatches(ziel, matches) {
      ziel.innerHTML = matches.length ? `
        <ul class="st-liste">${matches.map(m => {
          const r = ergebnis(m), tore = m.match_ereignisse.filter(e => e.art === 'tor' || e.art === 'gegentor').length;
          const info = [datumText(m.datum), m.ort ? ORT[m.ort] : null, m.wettbewerb ? WETTBEWERB[m.wettbewerb] : null].filter(Boolean).join(' · ');
          return `<li><a class="karte" href="#/statistik/m/${m.id}">
            <span class="nr st-erg ${r || 'leer'}">${r ? r.toUpperCase() : '–'}</span>
            <span class="info"><strong>${esc(m.titel || 'Match')}${resText(m) ? ` <span class="st-res">${esc(resText(m))}</span>` : ''}</strong>
              <small>${esc(info)}</small>
              <small class="${m.stat_am || tore ? 'st-ok' : 'st-fehlt'}">${m.stat_am || tore || m.match_aufstellung.length
                ? `📊 ${m.match_aufstellung.length} Personen · ${tore} Tore erfasst` : 'noch keine Statistik'}</small></span>
          </a></li>`;
        }).join('')}</ul>`
        : `<p class="muted pad leer">Noch keine Matches.${nurLesen() ? '' : '<br>Tippe auf <b>＋</b> und füge den Import-Text von Claude ein.'}</p>`;
    }

    // ---- Skorer -----------------------------------------------
    async function tabSkorer(ziel, matches) {
      const ls = await ladeLinienSpieler(matches.flatMap(m => m.match_ereignisse.map(e => e.linie_id)));
      const { P, pmErfasst, pmTotal } = L.personenStatistik(matches, ls);
      const andere = andereNummern(S.kader, matches.flatMap(m => m.match_aufstellung));
      const zeigeTabelle = () => {
        const reihen = S.kader.filter(k => istSpieler(k) && !istGoalie(k))
          .map(k => ({ k, s: P.get(k.id) || { sp: 0, t: 0, a: 0, pim: 0, ppT: 0, plus: 0, minus: 0 } }))
          .filter(x => x.k.aktiv || x.s.sp || x.s.t || x.s.a || x.s.pim)
          .map(x => ({ ...x, p: x.s.t + x.s.a, pm: x.s.plus - x.s.minus }));
        const wert = { p: x => x.p, t: x => x.s.t, a: x => x.s.a, pim: x => x.s.pim, pm: x => x.pm, sp: x => x.s.sp };
        reihen.sort((a, b) => wert[sort](b) - wert[sort](a) || b.p - a.p || b.s.t - a.s.t || (a.k.nummer ?? 99) - (b.k.nummer ?? 99));
        const max = Math.max(1, ...reihen.map(x => x.p));
        const th = (k, t, titel) => `<th class="${sort === k ? 'on' : ''}" data-s="${k}" title="${titel}">${t}</th>`;
        ziel.querySelector('.st-tabelle').innerHTML = reihen.length ? `
          <table class="st-tab">
            <thead><tr><th class="li">Spieler:in</th>${th('sp', 'Sp', 'Spiele')}${th('t', 'T', 'Tore')}${th('a', 'A', 'Assists')}${th('p', 'P', 'Punkte')}${th('pim', "Str'", 'Strafminuten')}${th('pm', '+/−', 'Plus/Minus')}</tr></thead>
            <tbody>${reihen.map(x => `<tr class="${x.k.aktiv ? '' : 'st-inaktiv'}">
              <td class="li"><span class="st-name">${kLabel(x.k.id)}</span>${auchNr(andere.get(x.k.id)).replace('nr-auch', 'nr-auch st-auch')}<span class="st-bar"><i style="width:${Math.round(100 * x.p / max)}%"></i></span></td>
              <td>${x.s.sp}</td><td>${x.s.t}${x.s.ppT ? `<small title="davon im Powerplay">${x.s.ppT}pp</small>` : ''}</td><td>${x.s.a}</td>
              <td class="fett">${x.p}</td><td>${x.s.pim || ''}</td>
              <td class="${x.pm > 0 ? 'plus' : x.pm < 0 ? 'minus' : ''}">${x.s.plus || x.s.minus ? (x.pm > 0 ? '+' : '') + x.pm : ''}</td>
            </tr>`).join('')}</tbody>
          </table>` : '<p class="muted pad leer">Noch keine Daten.</p>';
        ziel.querySelector('thead')?.addEventListener('click', e => {
          const t = e.target.closest('th[data-s]'); if (!t) return;
          sort = t.dataset.s; zeigeTabelle();
        });
      };
      ziel.innerHTML = `
        <p class="summary muted">${plural(matches.length, 'Match', 'Matches')} · Spalte antippen zum Sortieren</p>
        <div class="st-tabelle"></div>
        <p class="muted klein st-fuss">+/− zählt nur Tore mit erfasster Linie (${pmErfasst} von ${pmTotal}). Wie im Eishockey: Powerplay-Tore geben kein +, Gegentore in Unterzahl kein −.</p>`;
      zeigeTabelle();
    }

    // ---- Goalies ----------------------------------------------
    function tabGoalies(ziel, matches) {
      const { P } = L.personenStatistik(matches);
      const andere = andereNummern(S.kader, matches.flatMap(m => m.match_aufstellung));
      const reihen = [...P.entries()].filter(([, s]) => s.goalie.sp).map(([id, s]) => ({ id, g: s.goalie }))
        .sort((a, b) => b.g.sek - a.g.sek);
      ziel.innerHTML = reihen.length ? `
        <ul class="st-goalies">${reihen.map(({ id, g }) => {
          const gaa = g.sek ? g.gt * 3600 / g.sek : 0;
          return `<li class="st-karte">
            <div class="st-g-kopf"><span class="st-g-nr">${kNr(id) ?? '🥅'}</span><strong>${esc(kName(id))}${auchNr(andere.get(id))}</strong></div>
            <div class="st-kpis">
              <div><b>${g.sp}</b><small>Spiele</small></div>
              <div><b>${Math.round(g.sek / 60)}'</b><small>Spielzeit</small></div>
              <div><b>${g.gt}</b><small>Gegentore</small></div>
              <div><b>${gaa.toFixed(2)}</b><small>Gegentore / 60'</small></div>
            </div></li>`;
        }).join('')}</ul>
        <p class="muted klein st-fuss">Spielzeit aus Start-Goalie und Goalie-Wechseln. Leeres Tor zählt für niemanden.</p>`
        : '<p class="muted pad leer">Noch keine Goalie-Einsätze erfasst.<br>In der Aufstellung eines Matches Goalies markieren.</p>';
    }

    // ---- Team -------------------------------------------------
    function tabTeam(ziel, matches) {
      const mitRes = matches.filter(m => ergebnis(m));
      const z = { s: 0, u: 0, n: 0 }; mitRes.forEach(m => z[ergebnis(m)]++);
      const tf = mitRes.reduce((a, m) => a + m.tore_fuer, 0), tg = mitRes.reduce((a, m) => a + m.tore_gegen, 0);
      const pp = { chancen: 0, tore: 0, gegentore: 0 }, bp = { chancen: 0, gegentore: 0, tore: 0 };
      let pimE = 0, pimG = 0;
      const abschnitte = new Map();   // Abschnitt → {f, g}
      let gemischt = false; const formate = new Set();
      for (const m of matches) {
        const ev = m.match_ereignisse;
        if (!ev.length) continue;
        const R = L.zeitleiste(ev);
        for (const k of ['chancen', 'tore', 'gegentore']) { pp[k] += R.pp[k]; bp[k] += R.bp[k]; }
        ev.forEach(e => {
          if (e.art === 'strafe') pimE += L.strafMinuten(e.minuten);
          if (e.art === 'gegnerstrafe') pimG += L.strafMinuten(e.minuten);
          if (e.art === 'tor' || e.art === 'gegentor') {
            const a = L.abschnittVon(e.zeit, m);
            const x = abschnitte.get(a) || { f: 0, g: 0 };
            e.art === 'tor' ? x.f++ : x.g++; abschnitte.set(a, x);
          }
        });
        formate.add(L.abschnittZahl(m));
      }
      gemischt = formate.size > 1;
      const nAbsch = Math.max(0, ...formate);
      const keys = [...Array(nAbsch)].map((_, i) => i + 1).concat(abschnitte.has('V') ? ['V'] : []);
      const maxA = Math.max(1, ...[...abschnitte.values()].flatMap(x => [x.f, x.g]));
      const vorlage = { abschnitte: nAbsch };
      const kpi = (wert, text, sub = '') => `<div><b>${wert}</b><small>${text}</small>${sub ? `<em>${sub}</em>` : ''}</div>`;
      ziel.innerHTML = !matches.length ? '<p class="muted pad leer">Noch keine Matches.</p>' : `
        <section class="st-karte">
          <h3 class="gruppe">Bilanz <span>${plural(mitRes.length, 'Match', 'Matches')}</span></h3>
          <div class="st-kpis">
            ${kpi(z.s, 'Siege')}${kpi(z.u, 'Unentsch.')}${kpi(z.n, 'Niederl.')}
            ${kpi(`${tf}:${tg}`, 'Tore', mitRes.length ? `Ø ${(tf / mitRes.length).toFixed(1)} : ${(tg / mitRes.length).toFixed(1)}` : '')}
          </div>
        </section>
        <section class="st-karte">
          <h3 class="gruppe">Spezialsituationen</h3>
          <div class="st-kpis">
            ${kpi(pp.chancen ? `${pct(pp.tore, pp.chancen)} %` : '–', 'Powerplay', `${plural(pp.tore, 'Tor', 'Tore')} aus ${pp.chancen}`)}
            ${kpi(bp.chancen ? `${pct(bp.chancen - Math.min(bp.gegentore, bp.chancen), bp.chancen)} %` : '–', 'Boxplay', `${plural(bp.gegentore, 'Gegentor', 'Gegentore')} in ${bp.chancen}`)}
            ${kpi(pimE, "Strafminuten", `Gegner: ${pimG}`)}
            ${kpi(bp.tore, 'Tore in Unterzahl', pp.gegentore ? `${pp.gegentore} Gegentore im PP` : '')}
          </div>
          <p class="muted klein">Über-/Unterzahlen werden aus den Strafen berechnet (2' endet bei einem Tor).</p>
        </section>
        <section class="st-karte">
          <h3 class="gruppe">Tore pro ${nAbsch === 2 ? 'Halbzeit' : nAbsch === 3 ? 'Drittel' : 'Abschnitt'}</h3>
          ${keys.length ? `<div class="st-abschnitte">${keys.map(k => {
            const x = abschnitte.get(k) || { f: 0, g: 0 };
            return `<div class="st-abs">
              <span class="st-abs-l">${k === 'V' ? 'Verl.' : L.abschnittName(k, vorlage).replace('. ', '.&nbsp;')}</span>
              <span class="st-abs-bar f"><i style="width:${Math.round(100 * x.f / maxA)}%"></i><b>${x.f}</b></span>
              <span class="st-abs-bar g"><i style="width:${Math.round(100 * x.g / maxA)}%"></i><b>${x.g}</b></span>
            </div>`;
          }).join('')}<p class="muted klein"><span class="st-dot f"></span> erzielt <span class="st-dot g"></span> erhalten${gemischt ? ' · Matches mit unterschiedlichem Format gemischt' : ''}</p></div>`
            : '<p class="muted klein">Noch keine Tore erfasst.</p>'}
        </section>`;
    }

    await ladeBasis();
    await zeichne();
  }

  // ==============================================================
  //  IMPORT
  // ==============================================================
  function importDialog(fuerMatch = null) {
    oeffneDialog(`
      <h2>📥 Match importieren</h2>
      <p class="muted klein">Schick Claude die Screenshots aus der Swiss-Unihockey-App (Match facts / Telegramm und Lineup) und füge hier den Import-Text ein, den du zurückbekommst.</p>
      <label>Import-Text<textarea name="text" rows="8" placeholder='{ "format": "${L.IMPORT_FORMAT}", … }'></textarea></label>
      <p class="error" hidden></p>
      <div class="dlg-actions">
        <button class="btn ghost btn-zu">Abbrechen</button>
        <button class="btn primary btn-ok">Weiter ›</button>
      </div>
      ${fuerMatch ? '' : `<details class="st-manuell"><summary>Ohne Import: Match von Hand erfassen</summary>
        <label>Datum<input type="date" name="datum" value="${heute()}"></label>
        <label>Gegner<input name="gegner" autocomplete="off" placeholder="z.B. UHC Muster"></label>
        <label>Heim / Auswärts<select name="ort"><option value="heim">Heim</option><option value="auswaerts">Auswärts</option></select></label>
        <button class="btn ghost btn-manuell">Weiter ›</button>
      </details>`}`, d => {
      d.querySelector('.btn-zu').onclick = schliesse;
      d.querySelector('.btn-ok').onclick = () => {
        const err = d.querySelector('.error');
        try {
          const daten = L.parseImport(d.querySelector('[name=text]').value);
          schliesse(); zeigeVorschau(daten, fuerMatch);
        } catch (e) { err.textContent = e.message; err.hidden = false; }
      };
      d.querySelector('.btn-manuell')?.addEventListener('click', () => {
        const f = n => d.querySelector(`[name=${n}]`).value.trim();
        schliesse();
        zeigeVorschau({ datum: f('datum') || heute(), gegner: f('gegner') || null, ort: f('ort'), wettbewerb: null,
          tore_fuer: null, tore_gegen: null, abschnitte: null, abschnitt_min: null, aufstellung: [], ereignisse: [], manuell: true });
      });
    });
  }

  async function zeigeVorschau(D, fuerMatch = null) {
    neuLaden = async () => {};   // während der Vorschau nichts überschreiben
    if (fuerMatch) await ladeBasis(fuerMatch.liste_id);
    if (!S.liste) { toast('Zuerst Saison und Team wählen', 'error'); return; }
    const [alle, gemerkt] = await Promise.all([
      db(sb.from('einsaetze').select('id, datum, typ, titel, erstellt_am, stat_am, varianten(id, nr, name)').eq('liste_id', S.liste.id)),
      db(sb.from('su_zuordnung').select('*').eq('liste_id', S.liste.id)),
    ]);
    alle.sort((a, b) => b.datum.localeCompare(a.datum) || b.erstellt_am.localeCompare(a.erstellt_am));
    const gMap = new Map(gemerkt.map(g => [g.su_name, g.kader_id]));

    // Personen aus Aufstellung + Ereignissen (falls jemand nur im Telegramm steht)
    const leute = [];
    const finde = (nr, name) => leute.find(p => (name && L.normName(p.name) === L.normName(name)) || (!name && nr != null && p.nr === nr)
      || (name && !p.name && p.nr === nr));
    const merke = (nr, name, goalie = false, start = false) => {
      if (nr == null && !name) return null;
      let p = finde(nr, name);
      if (!p) leute.push(p = { nr, name: name || '', goalie, start, nurTelegramm: true });
      return p;
    };
    D.aufstellung.forEach(a => { const p = merke(a.nr, a.name, a.goalie, a.start); p.nurTelegramm = false; p.goalie = a.goalie; p.start = a.start; });
    D.ereignisse.forEach(e => {
      if (e.art === 'tor' || e.art === 'strafe' || e.art === 'goalie') e._p = merke(e.nr, e.name, e.art === 'goalie');
      if (e.art === 'tor') e._a = merke(e.assist_nr, e.assist_name);
    });
    leute.forEach(p => { Object.assign(p, L.zuordnen(p, S.kader.filter(istSpieler), gMap)); p.wahl = p.kader_id || ''; });

    // Einsatz finden: Match am gleichen Datum
    const kandidaten = alle.filter(e => e.datum === D.datum);
    // Vorschlag: gleicher Gegner → sonst Match ohne Statistik → sonst neu (nie still einen anderen Match überschreiben)
    const gleich = (a, b) => { const x = L.normName(a), y = L.normName(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };
    const matchK = kandidaten.filter(e => e.typ === 'match');
    const vorschlag = fuerMatch?.id
      || (D.gegner && matchK.find(e => gleich(e.titel, D.gegner))?.id)
      || matchK.find(e => !e.stat_am && (!D.gegner || !e.titel))?.id
      || 'neu';
    const vorlagen = alle.filter(e => e.datum <= D.datum).slice(0, 15).flatMap(x => [...x.varianten].sort((a, b) => b.nr - a.nr).map(v => ({
      id: v.id, text: `${datumText(x.datum)} · ${x.titel || (x.typ === 'match' ? 'Match' : 'Training')}${x.varianten.length > 1 ? ` · ${v.name || 'Version ' + v.nr}` : ''}`,
    })));

    const goaliesKader = S.kader.filter(istSpieler);
    const personOpts = p => `<option value="">– nicht zuordnen –</option>
      <option value="neu" ${p.wahl === 'neu' ? 'selected' : ''}>＋ neu in den Kader aufnehmen</option>
      <optgroup label="Kader">${goaliesKader.map(k => `<option value="${k.id}" ${k.id === p.wahl ? 'selected' : ''}>${k.nummer != null ? `#${k.nummer} ` : ''}${esc(k.name)}${k.aktiv ? '' : ' (inaktiv)'}${istGoalie(k) ? ' 🥅' : ''}</option>`).join('')}</optgroup>`;

    const pName = p => {
      if (!p) return '';
      if (p.wahl && p.wahl !== 'neu') return kLabel(p.wahl);
      return `${p.nr != null ? `<b>${p.nr}</b> ` : ''}${esc(p.name)}${p.wahl === 'neu' ? ' <small>(neu)</small>' : ' <small class="st-warn">⚠️</small>'}`;
    };
    const evText = e => {
      if (e.art === 'tor') return `${pName(e._p) || '?'}${e._a ? ` <small>· Assist ${pName(e._a)}</small>` : ''}`;
      if (e.art === 'gegentor') return `Gegentor${e.gegner_nr != null ? ` (#${e.gegner_nr})` : ''}`;
      if (e.art === 'strafe') return `${pName(e._p) || '?'} <small>· ${esc(e.minuten || '?')}'${e.grund ? ` ${esc(e.grund)}` : ''}</small>`;
      if (e.art === 'gegnerstrafe') return `Gegner${e.gegner_nr != null ? ` #${e.gegner_nr}` : ''} <small>· ${esc(e.minuten || '?')}'${e.grund ? ` ${esc(e.grund)}` : ''}</small>`;
      return e._p ? `${pName(e._p)} ins Tor` : 'Tor leer (6. Feldspieler:in)';
    };

    function zeichne() {
      const offen = leute.filter(p => !p.wahl).length;
      const einsatzWahl = box.querySelector('[name=einsatz]')?.value ?? vorschlag;
      box.innerHTML = `
        <div class="ln-kopf st-kopf">
          <button class="btn ghost small st-zurueck">‹</button>
          <div class="st-kopf-info">
            <strong>📥 ${D.manuell ? 'Neuer Match' : 'Vorschau Import'}</strong>
            <small class="muted">${esc(teamLabel(team()))} · ${esc(saison()?.name || '')}</small>
          </div>
        </div>
        <section class="st-karte">
          <div class="st-vs">
            <div><small class="muted">${datumText(D.datum)}${D.ort ? ` · ${ORT[D.ort]}` : ''}${D.wettbewerb ? ` · ${WETTBEWERB[D.wettbewerb]}` : ''}</small>
              <strong>${esc(D.gegner || 'Gegner?')}</strong>${D.liga ? `<small class="muted">${esc(D.liga)}</small>` : ''}</div>
            ${D.tore_fuer != null ? `<span class="st-gross-res ${D.tore_fuer > D.tore_gegen ? 's' : D.tore_fuer < D.tore_gegen ? 'n' : 'u'}">${D.tore_fuer}:${D.tore_gegen}</span>` : ''}
          </div>
          <label>Match im Linien-Tool
            <select name="einsatz">
              <option value="neu" ${einsatzWahl === 'neu' ? 'selected' : ''}>＋ Neuen Match-Einsatz anlegen</option>
              ${kandidaten.length ? `<optgroup label="Am ${datumText(D.datum, false)}">${kandidaten.map(e => `<option value="${e.id}" ${e.id === einsatzWahl ? 'selected' : ''}>${e.typ === 'match' ? '🏆' : '🏋️'} ${esc(e.titel || (e.typ === 'match' ? 'Match' : 'Training'))}${e.stat_am ? ' · hat schon Statistik' : ''}</option>`).join('')}</optgroup>` : ''}
              ${fuerMatch && !kandidaten.some(e => e.id === fuerMatch.id) ? `<option value="${fuerMatch.id}" selected>🏆 ${esc(fuerMatch.titel || 'Match')} (${datumText(fuerMatch.datum)})</option>` : ''}
            </select></label>
          <label class="st-vorlage" ${einsatzWahl === 'neu' ? '' : 'hidden'}>Linien für den neuen Einsatz
            <select name="vorlage"><option value="">Leer starten (4 Linien)</option>
              ${vorlagen.length ? `<optgroup label="Übernehmen von …">${vorlagen.map((v, i) => `<option value="${v.id}" ${i === 0 ? 'selected' : ''}>${esc(v.text)}</option>`).join('')}</optgroup>` : ''}
            </select></label>
          <p class="banner st-ersetzt" hidden>Dieser Match hat schon Statistik – sie wird ersetzt. Version/Linie (Plus/Minus) und Notizen bleiben bei gleichen Ereignissen erhalten; von Hand ergänzte Ereignisse, die nicht im Import stehen, fallen weg.</p>
        </section>

        ${leute.length ? `<h3 class="gruppe">Personen zuordnen <span>${leute.length}</span>${offen ? `<em class="st-warn">${offen} offen</em>` : ''}</h3>
        <ul class="st-zuord">${leute.map((p, i) => `
          <li class="${!p.wahl ? 'offen' : !p.sicher && (p.wahl || null) === (p.kader_id || null) ? 'pruefen' : ''}">
            <div class="st-zu-su"><span class="st-g-nr">${p.nr ?? '–'}</span><span><strong>${esc(p.name || '?')}</strong>
              <small class="muted">${p.goalie ? '🥅 Goalie' : 'Feld'}${p.start ? ' · Start' : ''}${p.nurTelegramm ? ' · nur im Telegramm' : ''} · ${esc((p.wahl || null) === (p.kader_id || null) ? p.grund : 'von Hand')}</small>
              ${(() => { const k = S.kMap.get(p.wahl); return k && p.nr != null && k.nummer != null && k.nummer !== p.nr ? `<small class="st-sonst">Nummer weicht ab (Kader: ${k.nummer}) – wird nur für diesen Match gespeichert</small>` : ''; })()}</span></div>
            <select data-i="${i}">${personOpts(p)}</select>
          </li>`).join('')}</ul>
        <p class="muted klein">Nicht zugeordnete Personen werden nicht gespeichert (ihre Tore zählen nur fürs Resultat). Zuordnungen werden für nächste Importe gemerkt.</p>` : ''}

        ${D.ereignisse.length ? `<h3 class="gruppe">Telegramm <span>${D.ereignisse.length}</span></h3>
        <ul class="st-tele">${[...D.ereignisse].sort((a, b) => a.zeit - b.zeit).map(e => `
          <li class="st-ev ${e.art}"><span class="st-zeit">${L.zeitText(e.zeit)}</span><span class="st-ev-icon">${L.ART[e.art].icon}</span>
            <span class="st-ev-text">${evText(e)}</span>${e.situation ? `<span class="st-sit ${e.situation}">${L.SITUATION[e.situation].kurz}</span>` : ''}</li>`).join('')}</ul>` : ''}
        ${D.manuell ? '<p class="muted klein pad">Aufstellung und Ereignisse erfasst du nach dem Speichern im Match.</p>' : ''}

        <div class="st-aktionen">
          <button class="btn ghost st-zurueck">Abbrechen</button>
          <button class="btn primary st-speichern">💾 Speichern</button>
        </div>`;

      const selE = box.querySelector('[name=einsatz]');
      const update = () => {
        box.querySelector('.st-vorlage').hidden = selE.value !== 'neu';
        box.querySelector('.st-ersetzt').hidden = !alle.find(e => e.id === selE.value)?.stat_am;
      };
      selE.onchange = update; update();
      box.querySelectorAll('.st-zurueck').forEach(b => b.onclick = () => {
        if (fuerMatch) zeigeMatch(fuerMatch.id);
        else zeigeStart('matches');
      });
      box.querySelector('.st-zuord')?.addEventListener('change', e => {
        const s = e.target.closest('select[data-i]'); if (!s) return;
        leute[+s.dataset.i].wahl = s.value; zeichne();
      });
      box.querySelector('.st-speichern').onclick = async ev => {
        ev.target.disabled = true;
        try { await speichere(); } catch (e) { ev.target.disabled = false; if (e?.message) toast(fehlerText(e), 'error'); }
      };
    }

    async function speichere() {
      const einsatzWahl = box.querySelector('[name=einsatz]').value;
      const vorlage = box.querySelector('[name=vorlage]')?.value || '';
      // 1) neue Personen in den Kader
      for (const p of leute.filter(x => x.wahl === 'neu')) {
        const k = await db(sb.from('kader').insert({
          liste_id: S.liste.id, name: p.name || `Nr. ${p.nr}`, nummer: p.nr, rolle: 'spieler',
          position: p.goalie ? 'Goalie' : 'Feld', aktiv: true,
        }).select().single());
        p.wahl = k.id;
      }
      // 2) Einsatz anlegen oder ergänzen
      const daten = {
        tore_fuer: D.tore_fuer, tore_gegen: D.tore_gegen,
        abschnitte: D.abschnitte, abschnitt_min: D.abschnitt_min,
        stat_am: D.manuell ? null : new Date().toISOString(),
      };
      if (D.tore_fuer != null && D.tore_gegen != null) daten.resultat = `${D.tore_fuer}:${D.tore_gegen}`;
      let einsatzId = einsatzWahl;
      if (einsatzWahl === 'neu') {
        const neu = await db(sb.from('einsaetze').insert({
          ...daten, liste_id: S.liste.id, typ: 'match', datum: D.datum, titel: D.gegner,
          ort: D.ort, wettbewerb: D.wettbewerb,
        }).select().single());
        einsatzId = neu.id;
        await neueVersion(einsatzId, vorlage);
      } else {
        const alt = (await db(sb.from('einsaetze').select('*').eq('id', einsatzId)))[0];
        const upd = { ...daten, typ: 'match' };
        if (!alt.titel && D.gegner) upd.titel = D.gegner;
        if (!alt.ort && D.ort) upd.ort = D.ort;
        if (!alt.wettbewerb && D.wettbewerb) upd.wettbewerb = D.wettbewerb;
        for (const k of ['tore_fuer', 'tore_gegen', 'abschnitte', 'abschnitt_min']) if (upd[k] == null) delete upd[k];
        if (D.manuell) delete upd.stat_am;
        await db(sb.from('einsaetze').update(upd).eq('id', einsatzId));
      }
      // 3) Statistik ersetzen – Version/Linie/Notiz gleicher Ereignisse behalten
      if (!D.manuell) {
        const altEv = await db(sb.from('match_ereignisse').select('*').eq('einsatz_id', einsatzId));
        const behalte = new Map(altEv.map(e => [`${e.art}|${e.zeit}`, e]));
        await db(sb.from('match_ereignisse').delete().eq('einsatz_id', einsatzId));
        await db(sb.from('match_aufstellung').delete().eq('einsatz_id', einsatzId));
        const kid = p => p && p.wahl && p.wahl !== 'neu' ? p.wahl : null;
        const auf = new Map();
        D.aufstellung.forEach(a => {
          const p = finde(a.nr, a.name); const id = kid(p);
          if (id && !auf.has(id)) auf.set(id, { einsatz_id: einsatzId, kader_id: id, nummer: a.nr, goalie: a.goalie, start: a.start });
        });
        if (auf.size) await db(sb.from('match_aufstellung').insert([...auf.values()]));
        const rows = D.ereignisse.map(e => {
          const alt = behalte.get(`${e.art}|${e.zeit}`);
          return {
            einsatz_id: einsatzId, art: e.art, zeit: e.zeit,
            kader_id: kid(e._p), assist_id: kid(e._a), gegner_nr: e.gegner_nr,
            minuten: e.minuten, grund: e.grund, situation: e.situation ?? alt?.situation ?? null,
            variante_id: alt?.variante_id ?? null, linie_id: alt?.linie_id ?? null, notiz: alt?.notiz ?? null,
          };
        });
        if (rows.length) await db(sb.from('match_ereignisse').insert(rows));
      }
      // 4) Zuordnungen merken
      const merk = leute.filter(p => p.name && p.wahl && p.wahl !== 'neu')
        .map(p => ({ liste_id: S.liste.id, su_name: L.normName(p.name), kader_id: p.wahl }));
      if (merk.length) await db(sb.from('su_zuordnung').upsert(merk, { onConflict: 'liste_id,su_name' }));
      toast(D.manuell ? 'Match angelegt' : 'Statistik importiert', 'ok');
      const ziel = `#/statistik/m/${einsatzId}`;
      if (location.hash === ziel) await zeigeMatch(einsatzId); else location.hash = ziel;
    }
    zeichne();
  }

  // Version 1 für einen neuen Einsatz: von Vorlage kopieren oder leer
  async function neueVersion(einsatzId, vorlageId) {
    const v = await db(sb.from('varianten').insert({ einsatz_id: einsatzId, nr: 1, name: null }).select().single());
    if (!vorlageId) {
      await db(sb.from('linien').insert([1, 2, 3, 4].map(n => ({ variante_id: v.id, art: 'linie', nr: n, system: '2-2-1' }))));
      return;
    }
    const linien = await db(sb.from('linien').select('*, linien_spieler(*)').eq('variante_id', vorlageId));
    for (const l of linien.sort(nachArt)) {
      const neu = await db(sb.from('linien').insert({ variante_id: v.id, art: l.art, nr: l.nr, name: l.name, system: l.system }).select().single());
      const leute = l.linien_spieler.filter(r => !r.kader_id || S.kMap.get(r.kader_id)?.aktiv);
      if (leute.length) await db(sb.from('linien_spieler').insert(leute.map(r => ({
        linie_id: neu.id, kader_id: r.kader_id, gast_name: r.gast_name, posten: r.posten, rolle: r.rolle, sort: r.sort,
      }))));
    }
  }

  // ==============================================================
  //  EIN MATCH
  // ==============================================================
  async function zeigeMatch(id) {
    let E = null, V = [];

    async function lade() {
      const e = await db(sb.from('einsaetze').select('*, match_aufstellung(*), match_ereignisse(*)').eq('id', id));
      E = e[0];
      if (!E) { box.innerHTML = `<div class="hinweis"><p>Dieser Match existiert nicht (mehr).</p><a class="btn primary" href="#/statistik">Zur Übersicht</a></div>`; return false; }
      await ladeBasis(E.liste_id);
      V = await db(sb.from('varianten').select('id, nr, name, linien(id, art, nr, name, linien_spieler(kader_id, posten, rolle))').eq('einsatz_id', id));
      V.sort((a, b) => a.nr - b.nr);
      V.forEach(v => v.linien.sort(nachArt));
      return true;
    }
    neuLaden = async () => { if (await lade()) zeichne(); };

    const vName = v => v ? (v.name ? `V${v.nr} · ${v.name}` : `Version ${v.nr}`) : '';
    // Nummer in diesem Match (aus der Aufstellung); weicht sie vom Kader ab → Hinweis „sonst …“
    const mNr = id => E.match_aufstellung.find(a => a.kader_id === id)?.nummer ?? kNr(id) ?? null;
    const mLabel = id => {
      const n = mNr(id), k = kNr(id);
      return `<span class="st-kl">${n != null ? `<b>${n}</b> ` : ''}${esc(kName(id))}${n != null && k != null && n !== k ? ` <small class="st-sonst">(sonst ${k})</small>` : ''}</span>`;
    };
    const linieName = l => l ? `${ARTEN_LINIE[l.art]} ${l.nr}${l.name ? ` · ${l.name}` : ''}` : '';
    const findeLinie = lid => { for (const v of V) { const l = v.linien.find(x => x.id === lid); if (l) return { v, l }; } return null; };

    function zeichne() {
      const ro = nurLesen();
      const ev = [...E.match_ereignisse].sort((a, b) => a.zeit - b.zeit || (a.art === 'goalie' ? -1 : 0));
      const R = L.zeitleiste(ev);
      const ver = L.versionen(ev, V);
      const goalies = L.goalieBilanz(E, E.match_aufstellung, ev);
      const auf = [...E.match_aufstellung].sort((a, b) => (b.goalie - a.goalie) || (mNr(a.kader_id) ?? 99) - (mNr(b.kader_id) ?? 99));
      const r = ergebnis(E);
      const info = [datumText(E.datum), E.ort ? ORT[E.ort] : null, E.wettbewerb ? WETTBEWERB[E.wettbewerb] : null,
        `${L.abschnittZahl(E)}×${L.abschnittMin(E)}'`].filter(Boolean).join(' · ');
      const tore = ev.filter(e => e.art === 'tor' || e.art === 'gegentor');
      const mitLinie = tore.filter(e => e.linie_id).length;

      // Ereignisse nach Abschnitt gruppieren
      let absch = null;
      const zeilen = ev.map(e => {
        const a = L.abschnittVon(e.zeit, E);
        const kopf = a !== absch ? `<li class="st-abs-kopf">${L.abschnittName(a, E)}</li>` : '';
        absch = a;
        const s = R.sit.get(e.id);
        let text;
        if (e.art === 'tor') text = `${e.kader_id ? mLabel(e.kader_id) : '<i>unbekannt</i>'}${e.assist_id ? ` <small>· Assist ${mLabel(e.assist_id)}</small>` : ''}`;
        else if (e.art === 'gegentor') text = `Gegentor${e.gegner_nr != null ? ` <small>#${e.gegner_nr}</small>` : ''}`;
        else if (e.art === 'strafe') text = `${e.kader_id ? mLabel(e.kader_id) : '<i>unbekannt</i>'} <small>· ${esc(e.minuten || '?')}'${e.grund ? ` ${esc(e.grund)}` : ''}</small>`;
        else if (e.art === 'gegnerstrafe') text = `Gegner${e.gegner_nr != null ? ` #${e.gegner_nr}` : ''} <small>· ${esc(e.minuten || '?')}'${e.grund ? ` ${esc(e.grund)}` : ''}</small>`;
        else text = e.kader_id ? `${mLabel(e.kader_id)} <small>ins Tor</small>` : 'Tor leer <small>(6. Feldspieler:in)</small>';
        const istTor = e.art === 'tor' || e.art === 'gegentor';
        const vEff = V.find(v => v.id === ver.get(e.id));
        const li = e.linie_id ? findeLinie(e.linie_id) : null;
        const feld = istTor ? `<span class="st-feld ${li ? 'gesetzt' : ''}">${li
          ? `${V.length > 1 ? `${esc(vName(li.v))} · ` : ''}${esc(linieName(li.l))}`
          : `${V.length > 1 && vEff ? `${esc(vName(vEff))}${e.variante_id ? ' ✱' : ''} · ` : ''}Linie ?`}</span>` : '';
        return `${kopf}<li><button class="st-ev ${e.art}" data-id="${e.id}" ${ro ? 'disabled' : ''}>
          <span class="st-zeit">${L.zeitText(e.zeit)}</span><span class="st-ev-icon">${L.ART[e.art].icon}</span>
          <span class="st-ev-text">${text}${feld}</span>
          ${istTor && s && s !== 'eq' ? `<span class="st-sit ${s}" title="${L.SITUATION[s].text}${e.situation ? ' (von Hand)' : ''}">${L.SITUATION[s].kurz}</span>` : ''}
        </button></li>`;
      }).join('');

      box.innerHTML = `
        <div class="ln-kopf st-kopf">
          <a class="btn ghost small" href="#/statistik">‹</a>
          <div class="st-kopf-info">
            <strong>🏆 ${esc(E.titel || 'Match')}</strong>
            <small class="muted">${esc(info)}</small>
          </div>
          ${ro ? '' : '<button class="btn ghost small st-edit" title="Match bearbeiten">✏️</button>'}
        </div>
        ${ro ? '<div class="banner">📦 Archivierte Saison – nur Ansicht</div>' : ''}
        <section class="st-karte st-score">
          <span class="st-gross-res ${r || ''}">${resText(E) || '–:–'}</span>
          <div class="st-kpis klein">
            <div><b>${R.pp.chancen ? `${R.pp.tore}/${R.pp.chancen}` : '–'}</b><small>Powerplay</small></div>
            <div><b>${R.bp.chancen ? `${R.bp.gegentore}/${R.bp.chancen}` : '–'}</b><small>Gegentore im BP</small></div>
            <div><b>${ev.filter(e => e.art === 'strafe').reduce((a, e) => a + L.strafMinuten(e.minuten), 0)}'</b><small>Strafminuten</small></div>
          </div>
          <div class="st-links">
            <a class="btn ghost small" href="#/linien/e/${E.id}">🧩 Linien</a>
            ${ro ? '' : '<button class="btn ghost small st-import">📥 Import (neu)</button>'}
          </div>
        </section>

        <h3 class="gruppe">Aufstellung <span>${auf.length}</span>${ro ? '' : '<button class="btn ghost small st-auf-edit">Bearbeiten</button>'}</h3>
        ${auf.length ? `<div class="st-auf">${auf.map(a => {
          const g = goalies.get(a.kader_id);
          return `<span class="st-pers ${a.goalie ? 'goalie' : ''}">${a.goalie ? '🥅 ' : ''}${mLabel(a.kader_id)}${a.goalie && g?.sek ? ` <small>${Math.round(g.sek / 60)}' · ${g.gegentore} GT</small>` : ''}</span>`;
        }).join('')}</div>` : '<p class="muted klein">Noch keine Aufstellung.</p>'}

        <h3 class="gruppe">Telegramm <span>${ev.length}</span>${tore.length ? `<em class="muted">Linie bei ${mitLinie}/${tore.length} Toren</em>` : ''}</h3>
        ${ev.length ? `<ul class="st-tele">${zeilen}</ul>
          ${ro ? '' : '<p class="muted klein">Tor antippen → auch eintragen, welche Version/Linie auf dem Feld war (für Plus/Minus und Wechsel im Spiel).</p>'}`
          : `<p class="muted pad leer">Noch keine Ereignisse.${ro ? '' : '<br>Tippe auf <b>＋</b> oder importiere den Text von Claude.'}</p>`}

        ${ro || (!ev.length && !auf.length) ? '' : '<div class="st-aktionen"><button class="btn danger small st-loeschen">Statistik löschen</button></div>'}
        ${ro ? '' : '<button class="fab" aria-label="Ereignis hinzufügen">＋</button>'}`;

      box.querySelector('.st-edit')?.addEventListener('click', matchDialog);
      box.querySelector('.st-import')?.addEventListener('click', () => importDialog(E));
      box.querySelector('.st-auf-edit')?.addEventListener('click', aufstellungDialog);
      box.querySelector('.fab')?.addEventListener('click', () => ereignisDialog(null, ev));
      box.querySelector('.st-tele')?.addEventListener('click', e => {
        const b = e.target.closest('.st-ev'); if (!b || b.disabled) return;
        ereignisDialog(E.match_ereignisse.find(x => x.id === b.dataset.id), ev);
      });
      box.querySelector('.st-loeschen')?.addEventListener('click', async () => {
        if (!confirm('Aufstellung und alle Ereignisse dieses Matches löschen? Der Einsatz mit den Linien bleibt.')) return;
        await db(sb.from('match_ereignisse').delete().eq('einsatz_id', E.id));
        await db(sb.from('match_aufstellung').delete().eq('einsatz_id', E.id));
        await db(sb.from('einsaetze').update({ stat_am: null }).eq('id', E.id), 'Statistik gelöscht');
        neuLaden();
      });
    }

    // ---- Match-Daten bearbeiten ---------------------------------
    function matchDialog() {
      oeffneDialog(`
        <h2>Match bearbeiten</h2>
        <label>Datum<input type="date" name="datum" value="${E.datum}"></label>
        <label>Gegner<input name="titel" value="${esc(E.titel || '')}" autocomplete="off"></label>
        <div class="st-2">
          <label>Tore wir<input type="number" inputmode="numeric" min="0" name="tf" value="${E.tore_fuer ?? ''}"></label>
          <label>Tore Gegner<input type="number" inputmode="numeric" min="0" name="tg" value="${E.tore_gegen ?? ''}"></label>
        </div>
        <div class="st-2">
          <label>Heim / Auswärts<select name="ort"><option value="">–</option>${Object.entries(ORT).map(([k, v]) => `<option value="${k}" ${E.ort === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>Wettbewerb<select name="wettbewerb"><option value="">–</option>${Object.entries(WETTBEWERB).map(([k, v]) => `<option value="${k}" ${E.wettbewerb === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        </div>
        <div class="st-2">
          <label>Spielabschnitte<select name="abs">${[[3, '3 Drittel'], [2, '2 Halbzeiten']].map(([n, t]) => `<option value="${n}" ${L.abschnittZahl(E) === n ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <label>Minuten pro Abschnitt<input type="number" inputmode="numeric" min="5" max="30" name="min" value="${L.abschnittMin(E)}"></label>
        </div>
        <div class="dlg-actions">
          <button class="btn ghost btn-zu">Abbrechen</button>
          <button class="btn primary btn-ok">Speichern</button>
        </div>`, d => {
        d.querySelector('.btn-zu').onclick = schliesse;
        d.querySelector('.btn-ok').onclick = async () => {
          const f = n => d.querySelector(`[name=${n}]`).value.trim();
          const zahl = n => f(n) === '' ? null : Math.max(0, parseInt(f(n), 10) || 0);
          const tf = zahl('tf'), tg = zahl('tg');
          await db(sb.from('einsaetze').update({
            datum: f('datum') || E.datum, titel: f('titel') || null, ort: f('ort') || null, wettbewerb: f('wettbewerb') || null,
            tore_fuer: tf, tore_gegen: tg, resultat: tf != null && tg != null ? `${tf}:${tg}` : E.resultat,
            abschnitte: +f('abs'), abschnitt_min: Math.min(30, Math.max(5, zahl('min') || 20)),
          }).eq('id', E.id), 'Gespeichert');
          schliesse(); neuLaden();
        };
      });
    }

    // ---- Aufstellung --------------------------------------------
    function aufstellungDialog() {
      const drin = new Map(E.match_aufstellung.map(a => [a.kader_id, a]));
      const personen = S.kader.filter(k => istSpieler(k) && (k.aktiv || drin.has(k.id)))
        .sort((a, b) => istGoalie(b) - istGoalie(a) || (a.nummer ?? 99) - (b.nummer ?? 99));
      oeffneDialog(`
        <h2>Aufstellung</h2>
        <p class="muted klein">Wer hat gespielt? Bei Goalies den Start-Goalie mit ▶ markieren. Die Nummer gilt nur für diesen Match (z.B. anderes Trikot).</p>
        <ul class="st-auf-liste">${personen.map(k => {
          const a = drin.get(k.id);
          const goalie = a ? a.goalie : istGoalie(k);
          return `<li data-id="${k.id}">
            <label class="st-check"><input type="checkbox" class="c-dabei" ${a ? 'checked' : ''}><span>${esc(k.name)}</span></label>
            <input class="st-nr c-nr" type="number" inputmode="numeric" min="0" max="99" value="${a?.nummer ?? k.nummer ?? ''}" placeholder="Nr" title="Nummer in diesem Match${k.nummer != null ? ` (Kader: ${k.nummer})` : ''}">
            <button class="st-mini c-goalie ${goalie ? 'on' : ''}" title="Goalie">🥅</button>
            <button class="st-mini c-start ${a?.start ? 'on' : ''}" title="Start-Goalie" ${goalie ? '' : 'hidden'}>▶</button>
          </li>`;
        }).join('')}</ul>
        <div class="dlg-actions">
          <button class="btn ghost btn-alle">Alle aktiven</button><span style="flex:1"></span>
          <button class="btn ghost btn-zu">Abbrechen</button>
          <button class="btn primary btn-ok">Speichern</button>
        </div>`, d => {
        const liste = d.querySelector('.st-auf-liste');
        liste.onclick = e => {
          const li = e.target.closest('li'); if (!li) return;
          if (e.target.closest('.c-goalie')) {
            const b = li.querySelector('.c-goalie'); b.classList.toggle('on');
            li.querySelector('.c-start').hidden = !b.classList.contains('on');
            li.querySelector('.c-dabei').checked = true;
          }
          if (e.target.closest('.c-start')) {
            const an = !li.querySelector('.c-start').classList.contains('on');
            liste.querySelectorAll('.c-start').forEach(x => x.classList.remove('on'));
            if (an) li.querySelector('.c-start').classList.add('on');
            li.querySelector('.c-dabei').checked = true;
          }
        };
        d.querySelector('.btn-alle').onclick = () => liste.querySelectorAll('li').forEach(li => {
          if (S.kMap.get(li.dataset.id)?.aktiv) li.querySelector('.c-dabei').checked = true;
        });
        d.querySelector('.btn-zu').onclick = schliesse;
        d.querySelector('.btn-ok').onclick = async () => {
          const rows = [...liste.querySelectorAll('li')].filter(li => li.querySelector('.c-dabei').checked).map(li => {
            const goalie = li.querySelector('.c-goalie').classList.contains('on');
            const nr = li.querySelector('.c-nr').value.trim();
            return { einsatz_id: E.id, kader_id: li.dataset.id, nummer: nr === '' ? null : Math.min(99, Math.max(0, parseInt(nr, 10) || 0)),
              goalie, start: goalie && li.querySelector('.c-start').classList.contains('on') };
          });
          await db(sb.from('match_aufstellung').delete().eq('einsatz_id', E.id));
          if (rows.length) await db(sb.from('match_aufstellung').insert(rows));
          toast('Aufstellung gespeichert', 'ok');
          schliesse(); neuLaden();
        };
      });
    }

    // ---- Ereignis (Tor, Strafe, Goalie-Wechsel) -----------------
    function ereignisDialog(x, alleEv) {
      const ver = L.versionen(alleEv, V);
      const R = L.zeitleiste(alleEv);
      const im = new Set(E.match_aufstellung.map(a => a.kader_id));
      const personen = S.kader.filter(k => istSpieler(k) && (k.aktiv || im.has(k.id) || k.id === x?.kader_id || k.id === x?.assist_id))
        .sort((a, b) => (im.has(b.id) - im.has(a.id)) || (a.nummer ?? 99) - (b.nummer ?? 99));
      const pOpts = (sel, leer = '– wählen –', nurGoalies = false) => `<option value="">${leer}</option>` +
        personen.filter(k => !nurGoalies || istGoalie(k) || E.match_aufstellung.some(a => a.kader_id === k.id && a.goalie))
          .map(k => `<option value="${k.id}" ${k.id === sel ? 'selected' : ''}>${k.nummer != null ? `#${k.nummer} ` : ''}${esc(k.name)}${im.has(k.id) ? '' : ' (nicht in Aufstellung)'}</option>`).join('');
      // Version, die vor diesem Ereignis galt
      const vorher = () => {
        const t = L.parseZeit(d0?.querySelector('[name=zeit]')?.value) ?? x?.zeit ?? 0;
        const frueher = alleEv.filter(e => e.id !== x?.id && e.zeit <= t);
        const letzte = frueher[frueher.length - 1];
        return letzte ? ver.get(letzte.id) : V[0]?.id;
      };
      let d0 = null;
      let art = x?.art || 'tor';
      let varWahl = x?.variante_id || '';
      let linie = x?.linie_id || '';

      oeffneDialog(`
        <h2>${x ? 'Ereignis bearbeiten' : 'Neues Ereignis'}</h2>
        <div class="seg st-art">${Object.entries(L.ART).map(([k, v]) => `<button data-a="${k}" class="${art === k ? 'on' : ''}" title="${v.text}">${v.icon}<small>${v.text.replace('Gegner-', 'Geg.-').replace('-Wechsel', '')}</small></button>`).join('')}</div>
        <label>Spielzeit (mm:ss)<input name="zeit" inputmode="numeric" placeholder="z.B. 14:05" value="${x ? L.zeitText(x.zeit) : ''}" autocomplete="off"></label>
        <label data-zeige="tor strafe">${'<span class="lbl-person">Torschütz:in</span>'}<select name="person">${pOpts(x?.kader_id)}</select></label>
        <label data-zeige="goalie">Goalie ins Tor<select name="goalie">${pOpts(x?.kader_id, '– Tor leer (6. Feldspieler:in) –', true)}</select></label>
        <label data-zeige="tor">Assist<select name="assist">${pOpts(x?.assist_id, '– kein Assist –')}</select></label>
        <label data-zeige="gegentor gegnerstrafe">Rückennummer Gegner:in (optional)<input name="gnr" type="number" inputmode="numeric" min="0" max="99" value="${x?.gegner_nr ?? ''}"></label>
        <div class="st-2" data-zeige="strafe gegnerstrafe">
          <label>Strafe<select name="minuten">${L.MINUTEN.map(m => `<option value="${m}" ${(x?.minuten || '2') === m ? 'selected' : ''}>${m === 'MS' ? 'Matchstrafe' : m + "'"}</option>`).join('')}</select></label>
          <label>Grund<input name="grund" value="${esc(x?.grund || '')}" autocomplete="off" placeholder="z.B. Stockschlag"></label>
        </div>
        <label data-zeige="tor gegentor">Situation<select name="sit">
          <option value="">automatisch${x && R.sit.get(x.id) ? ` (${L.SITUATION[R.sit.get(x.id)].kurz})` : ''}</option>
          ${Object.entries(L.SITUATION).map(([k, v]) => `<option value="${k}" ${x?.situation === k ? 'selected' : ''}>${v.kurz} – ${v.text}</option>`).join('')}
        </select></label>
        <fieldset class="st-feldwahl" data-zeige="tor gegentor">
          <legend>Auf dem Feld <small class="muted">(freiwillig)</small></legend>
          ${V.length > 1 ? `<div class="st-vwahl"></div>` : ''}
          <div class="st-lwahl"></div>
        </fieldset>
        <label>Notiz<textarea name="notiz" rows="2">${esc(x?.notiz || '')}</textarea></label>
        <p class="error" hidden></p>
        <div class="dlg-actions">
          ${x ? '<button class="btn danger btn-del">Löschen</button><span style="flex:1"></span>' : ''}
          <button class="btn ghost btn-zu">Abbrechen</button>
          <button class="btn primary btn-ok">Speichern</button>
        </div>`, d => {
        d0 = d;
        const zeigeArt = () => {
          d.querySelectorAll('.st-art button').forEach(b => b.classList.toggle('on', b.dataset.a === art));
          d.querySelectorAll('[data-zeige]').forEach(el => { el.hidden = !el.dataset.zeige.split(' ').includes(art); });
          d.querySelector('.lbl-person').textContent = art === 'tor' ? 'Torschütz:in' : 'Bestrafte Person';
        };
        const zeigeFeld = () => {
          const effektiv = varWahl || vorher();
          const vw = d.querySelector('.st-vwahl');
          if (vw) vw.innerHTML = `<p class="muted klein">Version (Wechsel im Spiel gelten ab diesem Tor):</p>
            <div class="st-chips">${V.map(v => `<button class="chip ${v.id === effektiv ? 'on' : ''} ${v.id === varWahl ? 'fix' : ''}" data-v="${v.id}">${esc(vName(v))}</button>`).join('')}
            ${varWahl ? '<button class="chip st-v-weg" title="Keine Änderung hier">↺ wie vorher</button>' : ''}</div>`;
          const v = V.find(y => y.id === effektiv);
          const passend = art === 'tor' ? ['linie', 'pp', '6v5'] : ['linie', 'bp'];
          const linien = (v?.linien || []).filter(l => passend.includes(l.art) || l.id === linie);
          d.querySelector('.st-lwahl').innerHTML = v ? `<div class="st-chips">
            <button class="chip ${!linie ? 'on' : ''}" data-l="">keine Angabe</button>
            ${linien.map(l => `<button class="chip ${l.id === linie ? 'on' : ''}" data-l="${l.id}" title="${esc(l.linien_spieler.map(r => r.kader_id ? kName(r.kader_id) : '').filter(Boolean).join(', '))}">${esc(linieName(l))}</button>`).join('')}
          </div>` : '<p class="muted klein">Für diesen Match sind keine Linien erfasst.</p>';
        };
        zeigeArt(); zeigeFeld();
        d.querySelector('.st-art').onclick = e => { const b = e.target.closest('button'); if (!b) return; art = b.dataset.a; zeigeArt(); zeigeFeld(); };
        d.querySelector('[name=zeit]').addEventListener('change', zeigeFeld);
        d.querySelector('.st-feldwahl').onclick = e => {
          const b = e.target.closest('.chip'); if (!b) return;
          e.preventDefault();
          if (b.classList.contains('st-v-weg')) { varWahl = ''; linie = ''; }
          else if (b.dataset.v) { const neu = b.dataset.v; if (neu !== (varWahl || vorher())) linie = ''; varWahl = neu === vorher() && !x?.variante_id ? '' : neu; }
          else linie = b.dataset.l;
          zeigeFeld();
        };
        d.querySelector('.btn-zu').onclick = schliesse;
        d.querySelector('.btn-del')?.addEventListener('click', async () => {
          if (!confirm('Dieses Ereignis löschen?')) return;
          await db(sb.from('match_ereignisse').delete().eq('id', x.id), 'Gelöscht');
          schliesse(); neuLaden();
        });
        d.querySelector('.btn-ok').onclick = async () => {
          const f = n => d.querySelector(`[name=${n}]`).value.trim();
          const err = d.querySelector('.error');
          const zeit = L.parseZeit(f('zeit'));
          if (zeit == null) { err.textContent = 'Bitte die Spielzeit als mm:ss eingeben, z.B. 14:05.'; err.hidden = false; return; }
          const istTor = art === 'tor' || art === 'gegentor';
          const daten = {
            art, zeit,
            kader_id: art === 'goalie' ? (f('goalie') || null) : (art === 'tor' || art === 'strafe') ? (f('person') || null) : null,
            assist_id: art === 'tor' ? (f('assist') || null) : null,
            gegner_nr: art === 'gegentor' || art === 'gegnerstrafe' ? (f('gnr') === '' ? null : Math.min(99, Math.max(0, parseInt(f('gnr'), 10) || 0))) : null,
            minuten: art === 'strafe' || art === 'gegnerstrafe' ? f('minuten') : null,
            grund: art === 'strafe' || art === 'gegnerstrafe' ? (f('grund') || null) : null,
            situation: istTor ? (f('sit') || null) : null,
            variante_id: istTor ? (varWahl || null) : null,
            linie_id: istTor ? (linie || null) : null,
            notiz: f('notiz') || null,
          };
          if (daten.assist_id && daten.assist_id === daten.kader_id) { err.textContent = 'Torschütz:in und Assist sind dieselbe Person.'; err.hidden = false; return; }
          if (x) await db(sb.from('match_ereignisse').update(daten).eq('id', x.id), 'Gespeichert');
          else await db(sb.from('match_ereignisse').insert({ ...daten, einsatz_id: E.id }), 'Gespeichert');
          // Resultat nachführen, wenn Tore von Hand dazukommen/wegfallen
          if (istTor || x?.art === 'tor' || x?.art === 'gegentor') await resultatNachfuehren();
          schliesse(); neuLaden();
        };
      });
    }

    // Resultat = gezählte Tore, falls bisher identisch (sonst nicht anfassen, z.B. Forfait)
    async function resultatNachfuehren() {
      const ev = await db(sb.from('match_ereignisse').select('art').eq('einsatz_id', E.id));
      const tf = ev.filter(e => e.art === 'tor').length, tg = ev.filter(e => e.art === 'gegentor').length;
      const vorher = E.match_ereignisse;
      const altF = vorher.filter(e => e.art === 'tor').length, altG = vorher.filter(e => e.art === 'gegentor').length;
      const passteVorher = E.tore_fuer == null || (E.tore_fuer === altF && E.tore_gegen === altG);
      if (passteVorher && (tf !== E.tore_fuer || tg !== E.tore_gegen))
        await db(sb.from('einsaetze').update({ tore_fuer: tf, tore_gegen: tg, resultat: `${tf}:${tg}` }).eq('id', E.id));
    }

    if (await lade()) zeichne();
  }
}
