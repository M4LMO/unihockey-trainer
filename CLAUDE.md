# CLAUDE.md – Trainer Tools (Unihockey)

Web-App für den Trainerstaff im Unihockey (Kader, Linien, Statistik …). Besitzer und Admin: **Marc**.
Hosting: GitHub Pages aus `main` (Root) → https://m4lmo.github.io/unihockey-trainer · Datenbank/Login: Supabase.

**Lies zuerst `docs/vision.md`** (Grundsätze, Zugang/RLS, Datenmodell, Code-Struktur, Backlog).
Tool-Details: `docs/linien-spec.md`, `docs/statistik-spec.md`. SQL-Historie: `sql/` (nächste freie Nummer steht in vision.md).

## Grundsätze (immer einhalten)
- **Datenschutz:** Personen nur mit Name, Rückennummer, Position, Rolle. Keine weiteren Personendaten (keine Gründe für Absenzen, keine Gesundheit, keine Entwicklungsnotizen). Gegner:innen nur mit Rückennummer.
- **Sprache der App:** Deutsch (Schweiz, „ss“ statt „ß“), immer auch die **weibliche Form** (Spieler:in, Feldspieler:innen, Betreuer:in …).
- Positionen nur **Goalie** oder **Feld**.
- Grosse Löschungen (Team, Saison) nur über Papierkorb + Bestätigungsdialog.
- Repo ist **öffentlich**: keine E-Mail-Adressen, Passwörter oder Secret-/service_role-Keys in Code oder Commits. Supabase-URL und Publishable Key in `config.js` sind öffentlich gedacht.

## Arbeitsweise mit Marc
- Marc ist kein Profi-Entwickler: Antworten auf Deutsch, locker, kurz. Bei allem, was er selbst tun muss (Supabase, GitHub), **Schritt für Schritt** mit direkten Links anleiten und „Melde dich, wenn …“.
- Er arbeitet iterativ: lieber kleine, testbare Schritte; bei grösseren Umbauten offene Fragen vorher klären.
- **Jeder Merge auf `main` ist sofort live für den ganzen Staff.** Darum: Änderungen auf einem eigenen Branch + **Pull Request**; Marc testet und merged. Nie direkt auf `main` pushen, ausser Marc verlangt es ausdrücklich.
- Datenbank-Änderungen kann Claude nicht selbst ausführen: neue Datei `sql/NN_name.sql` anlegen und Marc den SQL-Text im Chat geben (Supabase SQL Editor: https://supabase.com/dashboard/project/psfygduxfqtxpyfwebew/sql/new). **SQL muss laufen, bevor der Pull Request gemerged wird.**
- Am Ende jeder Lieferung diese Checkliste zeigen (angepasst):

> **✅ Update-Checkliste**
> 1. Läuft noch ein anderer Pull Request? → Erst diesen fertig machen.
> 2. **SQL zuerst** ausführen (falls vorhanden) → „Success“ abwarten.
> 3. Pull Request auf GitHub **mergen**.
> 4. 1–2 Min warten, dann **hart neu laden** (Ctrl/Cmd + Shift + R, Handy: Tab schliessen) und kurz testen.
> 5. Erst danach den nächsten Pull Request mergen.

## Technik-Regeln
- Flaches Vanilla-JS mit ES-Modulen, **kein Build-Schritt**, keine Frameworks. Neue Tools als eigene Datei(en) (`xyz.js`, ggf. `xyz.css`, das die JS-Datei selbst lädt), mit `export async function mount(container)` → Aufräumfunktion, eingetragen in `TOOLS` in `app.js`.
- Saison/Team-Auswahl und Rolle immer über `kontext.js` (`ladeStammdaten`, `ladeKader`, `getAuswahl`/`setAuswahl`, `ladeIch`).
- Neue Tabellen: Bezug zu `kaderlisten`/`einsaetze`, RLS-Policy über passende `darf_*()`-Funktion (nie `using (true)`), Realtime aktivieren, in `TABELLEN` in `admin.js` (Sicherung) eintragen.
- Vor jedem PR testen: JS-Syntax (`node --check`), Oberfläche im Headless-Browser mit gemocktem Supabase-Modul (CDN abfangen), RLS/SQL lokal mit PGlite (`@electric-sql/pglite`, auth-Schema nachbauen: `auth.users`, `auth.uid()` über `set_config`).
- Mobile-first (390 px Breite prüfen); Eingabefelder mind. 16 px (kein iPhone-Zoom).
- Nach jeder Änderung `docs/vision.md` (und ggf. Specs) aktuell halten.
