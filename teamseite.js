// ============================================================
//  Team-Startseite (#/team bzw. #/ bei Staff)
//  - Team ist fix (gewählt auf der Hauptseite / eigenes Team bei Staff)
//  - Saison wählen (nur Saisons, in denen dieses Team einen Kader hat)
//  - Admin: neue Saison für dieses Team anlegen (optional Kader übernehmen)
//  - Kacheln der Tools
// ============================================================
import { sb } from './supabase.js';
import { esc, toast, fehlerText } from './ui.js';
import { ladeStammdaten, ladeKader, setAuswahl, naechsteSaison, teamLabel, ladeIch, waehleTeamKontext } from './kontext.js';

const plural = (n, ein, mehr) => `${n} ${n === 1 ? ein : mehr}`;

// tools: [{id, name, icon, desc}] ; zurueck: «← Alle Teams» zeigen (Admin)
export async function mount(root, { tools = [], zurueck = false } = {}) {
  root.innerHTML = '<div class="home"><p class="muted">Lade …</p></div>';
  const box = root.querySelector('.home');
  const ich = await ladeIch().catch(() => null);
  const vollAdmin = !!ich?.admin && !ich?.nurLesen;
  let st, K, personen = [], formOffen = false;

  async function laden(saisonId) {
    st = await ladeStammdaten();
    K = waehleTeamKontext(st, saisonId ? { saisonId } : {});
    personen = K.liste ? await ladeKader(K.liste.id, { nurAktive: true }).catch(() => []) : [];
  }

  function zeichne() {
    const { team, saisons, saison } = K;
    const kacheln = `<div class="tiles">${tools.map(t => `
      <a class="tile" href="#/${t.id}">
        <span class="tile-icon">${t.icon}</span>
        <strong>${esc(t.name)}</strong>
        <small>${esc(t.desc)}</small>
      </a>`).join('')}</div>`;
    if (!team) {
      box.innerHTML = `${zurueck ? '<a href="#/" class="zurueck">← Alle Teams</a>' : ''}
        <div class="hinweis"><p>Kein Team gewählt.</p>${zurueck ? '<a class="btn primary" href="#/">Team auswählen</a>' : '<p class="muted klein">Bitte beim Admin melden.</p>'}</div>`;
      return;
    }
    const sp = personen.filter(p => p.rolle === 'spieler').length, stf = personen.length - sp;
    const vorschlag = naechsteSaison(saisons);
    const freie = st.saisons.filter(s => !s.archiviert && !saisons.some(x => x.id === s.id));
    box.innerHTML = `
      ${zurueck ? '<a href="#/" class="zurueck">← Alle Teams</a>' : ''}
      <h2 class="team-titel">${esc(teamLabel(team))}</h2>

      <section class="team-saison">
        <div class="team-saison-kopf">
          <h3>📅 Saison</h3>
          ${vollAdmin && !formOffen ? '<button class="btn ghost small btn-neu">＋ Neue Saison</button>' : ''}
        </div>
        ${saisons.length ? `
          <div class="team-chips saison-chips">${saisons.map(s => `
            <button class="chip ${s.id === saison?.id ? 'on' : ''}" data-id="${s.id}">${esc(s.name)}${s.archiviert ? ' <small>📦 Archiv</small>' : ''}</button>`).join('')}</div>
          <p class="muted klein">${plural(sp, 'Spieler:in', 'Spieler:innen')} · ${stf} Staff im Kader ${esc(saison?.name || '')}${saison?.archiviert ? ' · archiviert (nur Ansicht)' : ''}</p>`
          : `<p class="muted klein">${vollAdmin ? 'Dieses Team hat noch keine Saison. Lege die erste an:' : 'Für dieses Team ist noch keine Saison eingerichtet. Bitte beim Admin melden.'}</p>`}
        ${vollAdmin && (formOffen || !saisons.length) ? `
          <form class="team-neu">
            <label>Saison
              <input name="name" list="saison-vorschlaege" value="${esc(vorschlag)}" maxlength="20" autocomplete="off" placeholder="z.B. ${esc(vorschlag)}">
              <datalist id="saison-vorschlaege">${freie.map(s => `<option value="${esc(s.name)}">`).join('')}</datalist>
            </label>
            ${saisons.length ? `<label>Kader übernehmen aus
              <select name="quelle">
                ${saisons.map((s, i) => `<option value="${s.id}" ${i === 0 ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
                <option value="">– leer starten –</option>
              </select>
            </label>
            <p class="muted klein">Übernommen werden alle aktiven Personen mit Nummer und Position. Abgänge danach im Kader auf inaktiv setzen oder löschen.</p>` : ''}
            <p class="error" hidden></p>
            <div class="dlg-actions">
              ${saisons.length ? '<button type="button" class="btn ghost btn-abbr">Abbrechen</button>' : ''}
              <button class="btn primary">Saison anlegen</button>
            </div>
          </form>` : ''}
        ${vollAdmin ? '<p class="muted klein">Saisons archivieren oder löschen: auf der Hauptseite (gilt für alle Teams).</p>' : ''}
      </section>

      ${kacheln}`;

    box.querySelector('.saison-chips')?.addEventListener('click', async e => {
      const b = e.target.closest('.chip'); if (!b) return;
      setAuswahl({ saisonId: b.dataset.id });
      await laden(b.dataset.id); zeichne();
    });
    box.querySelector('.btn-neu')?.addEventListener('click', () => { formOffen = true; zeichne(); box.querySelector('.team-neu input')?.focus(); });
    box.querySelector('.btn-abbr')?.addEventListener('click', () => { formOffen = false; zeichne(); });
    box.querySelector('.team-neu')?.addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target, err = f.querySelector('.error');
      const zeig = t => { err.textContent = t; err.hidden = false; };
      const name = f.name.value.trim();
      if (!name) return zeig('Bitte einen Saison-Namen eingeben, z.B. ' + vorschlag);
      if (saisons.some(s => s.name.toLowerCase() === name.toLowerCase())) return zeig(`${team.name} hat die Saison ${name} schon.`);
      f.querySelector('.btn.primary').disabled = true;
      try {
        // Saison gibt es evtl. schon (Saisons gelten für alle Teams) – sonst neu anlegen
        let s = st.saisons.find(x => x.name.toLowerCase() === name.toLowerCase());
        if (s?.archiviert) throw new Error(`Die Saison ${s.name} ist archiviert. Zuerst auf der Hauptseite reaktivieren.`);
        if (!s) {
          const r = await sb.from('saisons').insert({ name }).select().single();
          if (r.error) {
            if (/duplicate|unique|23505/i.test(`${r.error.code} ${r.error.message}`))
              throw new Error(`Die Saison ${name} liegt im Papierkorb. Zuerst auf der Hauptseite wiederherstellen.`);
            throw r.error;
          }
          s = r.data;
        }
        const r2 = await sb.from('kaderlisten').insert({ saison_id: s.id, team_id: team.id }).select().single();
        if (r2.error) throw r2.error;
        let txt = `Saison ${s.name} angelegt`;
        const quelle = f.quelle?.value;
        if (quelle) {
          const ql = st.listen.find(l => l.team_id === team.id && l.saison_id === quelle);
          const alt = ql ? await ladeKader(ql.id, { nurAktive: true }) : [];
          if (alt.length) {
            const r3 = await sb.from('kader').insert(alt.map(p => ({
              liste_id: r2.data.id, name: p.name, nummer: p.nummer, position: p.position, rolle: p.rolle,
            })));
            if (r3.error) throw r3.error;
          }
          txt += ` · ${plural(alt.length, 'Person', 'Personen')} übernommen`;
        }
        toast(txt, 'ok');
        formOffen = false;
        setAuswahl({ saisonId: s.id });
        await laden(s.id); zeichne();
      } catch (ex) {
        zeig(ex.message && !ex.code ? ex.message : fehlerText(ex));
        f.querySelector('.btn.primary').disabled = false;
      }
    });
  }

  try { await laden(); zeichne(); }
  catch (e) { box.innerHTML = `<p class="error pad">${esc(fehlerText(e))}</p>`; }
  return () => {};
}
