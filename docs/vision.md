# Trainer Tools – Vision & Technik (Stand 13.11.2026)

## Ziel
Eine gemeinsame App für den ganzen Trainerstaff, die die Trainerarbeit im Unihockey vereinfacht. Tools werden Stück für Stück erarbeitet und in die App eingebettet.

## Grundsätze
- **Datenschutz:** Pro Spieler:in/Staff nur Name, Rückennummer, Position (+ Rolle). Keine weiteren Personendaten. Gegner:innen werden ohne Namen gespeichert (nur Rückennummer).
- **Sprache:** Immer auch die weibliche Form verwenden (Spieler:in, Feldspieler:innen, Betreuer:in …).
- Positionen nur **Goalie** oder **Feld** (Anzeige: Goalies / Feldspieler:innen).
- **Löschen absichern:** Grosse Löschungen (Team, Saison) nie direkt, sondern über Papierkorb + klaren Bestätigungsdialog.

## Technik
- Staff greift **ohne Claude-Konto** zu.
- Hosting: **GitHub Pages** (Branch `main`, Root) → jeder Merge auf `main` ist sofort live.
- Datenbank + Login: **Supabase** (Gratis-Tier, keine herunterladbaren Backups → eigene Sicherung in der App).
- App als PWA (Icon auf Homescreen, kein Service Worker).
- **Cache-Busting:** `index.html` holt `version.json` immer frisch (`no-store`) und lädt dann alle JS-/CSS-Dateien mit `?v=<Version>` (Import-Map, Liste `MODULE` in `index.html`; `window.APP_V`). Ist die App offen und es gibt eine neue Version → Knopf „🔄 Neue Version – tippen zum Laden“ (Check beim Zurückkehren in die App und alle 5 Min). **Bei jedem PR `version.json` erhöhen** (Format `JJJJ-MM-TT.N`); **neue JS-Datei → in `MODULE` eintragen**, CSS aus Tools mit `window.APP_V` laden. Nur `index.html` selbst kann noch bis ~10 Min alt sein (ändert sich selten).
- Supabase SQL Editor: neuen leeren Tab nehmen; UPDATE zeigt „No rows returned“ auch bei Erfolg; Platzhalter in SQL immer mit Anführungszeichen erklären.

## Zugang
- **Admin (Marc)**: sieht alles. Startseite `#/` = **Hauptseite** (`admin.js`): Teams anlegen/umbenennen/in Papierkorb, Saisons anlegen/archivieren/in Papierkorb, Papierkorb (wiederherstellen / endgültig löschen mit Namen eintippen), Staff-Logins pro Team, 👀 Zuschauer-Logins, 💾 Sicherung. „Öffnen →“ setzt Team-Auswahl und geht auf `#/team` (Tool-Kacheln, „← Alle Teams“).
- **Staff: individuelle Logins** (eigene E-Mail pro Person), beliebig viele pro Team; **ein Login = genau ein Team** (Erweiterung auf mehrere Teams pro Login möglich, falls nötig). Startseite = Tool-Kacheln des eigenen Teams. Sieht per RLS nur das eigene Team (nicht, wenn Team im Papierkorb). **Keine Teams/Saisons/Kaderlisten ändern** (neue Saison für ein Team = neuer Kader → immer Admin; Staff sieht „Bitte beim Admin melden“).
- **Rechte pro Staff-Login** (SQL 07, im 🔑-Staff-Dialog umschaltbar): **✏️ Darf bearbeiten** = Kader, Linien, Statistik im eigenen Team ändern · **👀 Nur lesen** = alles sehen, nichts ändern (Banner, Bearbeiten-Knöpfe ausgeblendet). DB-sicher über RLS.
- **Archivierte Saison** ist in der DB gesperrt – auch für den Admin (zum Ändern zuerst reaktivieren).
- **👀 Zuschauer:in** (SQL 08, Hauptseite → „Zuschauer-Logins“): sieht alles wie der Admin (alle Teams inkl. Papierkorb, Saisons, Staff-Logins mit E-Mail), kann nichts ändern. Keine 💾 Sicherung (wäre eine Kopie aller Daten). In `zugang`: admin = true **und** nur_lesen = true.
- Erstes Team: **Bern Capitals – U21F**.
- Login ohne Eintrag in `zugang` → „Kein Zugang“.
- Logins im Supabase-Dashboard anlegen (Authentication → Users → Add user, Auto Confirm, Start-Passwort); Zuordnung in der App (🔑 Staff) über RPC `staff_zuordnen(email, team)`.
- **Passwort ändern:** 🔑-Knopf in der Kopfzeile (alle Logins), `sb.auth.updateUser({password})`, min. 8 Zeichen.
- **Evtl. später:** Tools pro Login ein-/ausblenden. Bewusst nicht: Rechte pro Tool (lesen/bearbeiten je Tool).

## Konfiguration (öffentliche Werte – dürfen im Code stehen)
- Repo: https://github.com/M4LMO/unihockey-trainer · App: https://m4lmo.github.io/unihockey-trainer
- Supabase Project URL: `https://psfygduxfqtxpyfwebew.supabase.co` (Region eu-west-3 Paris)
- Supabase Publishable Key: `sb_publishable_bYbMux1UFuRF8PSPSQzDsQ_cZfNhv7u`
- ⚠️ Secret / service_role Key NIE in Code, Commits oder Chat. Keine E-Mail-Adressen oder Passwörter ins Repo (öffentlich!).

## Datenmodell
- `teams`: id, verein, name, geloescht_am (Papierkorb) — gilt über alle Saisons
- `saisons`: id, name (unique, z.B. "2026/27"), archiviert (→ nur Ansicht), geloescht_am — global für alle Teams
- `kaderlisten`: id, saison_id, team_id (unique Paar) — ein Kader pro Saison+Team
- `kader`: id, liste_id, name, nummer (0–99, optional; „normale“ Nummer), position ('Goalie'|'Feld' bzw. Staff-Funktion frei), rolle ('spieler'|'staff'), aktiv (bool), erstellt_am
- `zugang` (SQL 05/07/08): user_id (PK → auth.users), admin (bool), team_id, nur_lesen (bool); admin+nur_lesen = Zuschauer:in. Funktionen (security definer): `ist_admin()` (= voller Admin: admin und nicht nur_lesen → für alles Schreiben), `sieht_alles()` (Admin oder Zuschauer:in → Lesen), `ich_nur_lesen()` (Staff-Leser:in oder Zuschauer:in), Lesen: `darf_team(t)` (sieht_alles() oder Staff, wenn Team nicht im Papierkorb), `darf_liste(l)`, `darf_einsatz(e)`, `darf_variante(v)`, `darf_linie(x)`; Schreiben: `darf_liste_schreiben(l)` (= darf_liste + nicht nur_lesen + Saison nicht archiviert), `darf_einsatz_schreiben`, `darf_variante_schreiben`, `darf_linie_schreiben`; RPCs: `staff_liste()` (Staff + Zuschauer:innen, mit nur_lesen/zuschauer; Admin + Zuschauer:in), nur Admin: `staff_zuordnen(p_email, p_team)`, `zuschauer_zuordnen(p_email)`, `staff_entfernen(p_user)` (Staff + Zuschauer:in, nie Admin), `staff_nur_lesen(p_user, p_wert)` (nur Staff).
- Linien-Tool (SQL 03): `einsaetze`, `varianten`, `linien`, `linien_spieler`, `chemie` – Details in `docs/linien-spec.md`.
- Statistik-Tool (SQL 04): `einsaetze` + tore_fuer, tore_gegen, abschnitte, abschnitt_min, stat_am; `match_aufstellung` (nummer = Nummer in diesem Match), `match_ereignisse`, `su_zuordnung` – Details in `docs/statistik-spec.md`.
- **RLS:** pro Tabelle 4 Policies „Lesen“ (`darf_*`) / „Anlegen“ / „Ändern“ / „Löschen“ (`darf_*_schreiben`) (teams: lesen darf_team, schreiben Admin; saisons: lesen alle, schreiben Admin; kaderlisten: lesen darf_team, schreiben nur Admin; zugang: eigenen lesen, Admin alles). **Neue Tabellen** brauchen diese 4 Policies mit den passenden `darf_*`-Funktionen – NICHT `using (true)`! Im UI `sperrGrund(saison, ich)` aus `kontext.js` für `nurLesen()` verwenden. Dazu Realtime aktivieren und die Tabelle in `TABELLEN` in `admin.js` (Sicherung) eintragen. Löschen kaskadiert.
- SQL-Historie in `sql/`: 01 kader, 02 Saison/Team, 03 Linien, 04 Statistik, 05 Zugang, 06 Papierkorb, 07 Rechte (Nur lesen, Archiv-Sperre, Kaderlisten nur Admin), 08 Zuschauer:in. **Nächste freie Nummer: 09.**

## Rückennummern pro Match
- Kader-Nummer = normale Nummer. Abweichende Nummer pro Match in `match_aufstellung.nummer`.
- Anzeige im Match: Match-Nummer, mit „(sonst 39)“ in der Statistik-Match-Ansicht.
- Oranges Abzeichen „auch #87 (4×)“ (`nummern.js`) in Kader und Linien (Personen + Historie). **Nicht** in der Statistik und nicht in der Linien-Auswertung.

## Code-Struktur (flach, Vanilla JS ES-Module, kein Build)
- `index.html` (Start mit Version, Import-Map), `version.json`, `style.css` (Vereinsfarbe `--team`), `config.js`, `supabase.js` (supabase-js v2 via jsDelivr), `ui.js` (esc, toast, fehlerText)
- `app.js` – Auth, Routing: Admin `#/` → admin.js, `#/team` → Tool-Kacheln; Staff `#/` → Tool-Kacheln. Nur fertige Tools als Kacheln (`soon` wird ausgeblendet). Neue Tools in `TOOLS`; Modul exportiert `mount(container)` → Aufräumfunktion. Auth-Callback ruft zeigeApp über setTimeout auf. 🔑-Knopf „Passwort ändern“.
- `admin.js` – Hauptseite (nur Admin), CSS selbst eingefügt. Bestätigungsdialog `frage({titel, html, knopf, tippen})`. Papierkorb = `geloescht_am`; endgültig = delete nur nach Namen eintippen. 💾 Sicherung: alle Tabellen in `TABELLEN` (paginiert à 1000) als JSON `trainer-tools-sicherung-1`. Wiederherstellen aus Datei gibt es (noch) nicht.
- `kontext.js` – ladeStammdaten({mitGeloeschten}) (Standard: Papierkorb ausgeblendet), ladeKader(listeId), get/setAuswahl() (localStorage: saisonId, teamId), naechsteSaison(), teamLabel(), ladeIch() ({admin, teamId, email, ohneZugang, nurLesen, zuschauer}; „voller Admin“ = admin && !nurLesen), vergissIch(), sperrGrund(saison, ich) (Banner-Text, '' = darf ändern)
- `nummern.js` – andere Rückennummern aus Matches
- `kader.js` – Tool Kader (Verwaltung Saisons & Teams nur Admin, ohne Löschen; Staff ohne Saison → „beim Admin melden“)
- `linien.js` + `linien.css` + `linien-auswertung.js` + `linien-ideen.js` – Tool Linien (`docs/linien-spec.md`)
- `statistik.js` + `statistik.css` + `statistik-logik.js` – Tool Statistik inkl. Register Strafen (`docs/statistik-spec.md`)
- `manifest.webmanifest`, `icon.svg`, `icon-180/192/512.png`

## Backlog (Empfehlung 12.11.)
- [ ] Präsenz (anwesend/abwesend/entschuldigt, **keine Gründe**) → Linien-Tool nur Anwesende
- [ ] Trainingsplanung + Übungsbibliothek
- [ ] Taktikboard (Skizzen in Übungen wiederverwendbar)
- [ ] Match-Live / Coaching (Linie auf dem Feld, Wechsel-Timer)
- [ ] Dashboard Startseite, Gegner-Notizen
- [ ] Statistik evtl.: Timeouts, Eigentor-Kennzeichnung
- [ ] Linien-Tool evtl.: Chemie-Matrix, Coaching-Hilfen, saisonübergreifend über Namen
- Bewusst nicht: Entwicklungs-/Gesprächsnotizen pro Spieler:in (Datenschutz-Grundsatz).
