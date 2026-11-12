# Linien-Tool – Spezifikation (Stand 12.11.2026, mit Marc abgestimmt)

## Ziel
Linien jedes Trainings und Matches erfassen → Historie, wer wann mit wem gespielt hat → Auswertung (Stamm-Linien, Paare, Trios, Top 3) und **💡 Ideen** (Vorschläge) aus **Häufigkeit** sowie **Toren, Skorerpunkten und Plus/Minus** (Statistik-Tool; Linie bei Tor/Gegentor wird ab den nächsten Matches erfasst).

## ⚠️ Entscheid 12.11.: Bewertung, Chemie & Screenshot ausgebaut
Marc braucht vorerst **keine Noten, keine Chemie-Notizen und keinen Screenshot-Modus**. Ausgebaut aus der Oberfläche: Modus „⭐ Bewerten“ (Noten 1–6, Notiz pro Linie, PP/BP-Handzähler), Modus „📸 Screenshot“, Tab „Chemie“, alle Ø-Noten-Anzeigen, Gewichtung „Match ×2“, Mindestanzahl 5 bewertete Einsätze.
Die DB bleibt unverändert (Spalten `linien.note/notiz/anzahl/tore` und Tabelle `chemie` existieren weiter, werden nur nicht mehr angezeigt) → kann bei Bedarf wieder eingebaut werden (Code-Stand vor dem Ausbau: GitHub-Commit `ec6573e`). Alte Handzähler `anzahl/tore` fliessen weiterhin in die PP/BP-Quote, wenn ein Match keine Statistik hat.

## Struktur
```
Einsatz (Training | Match | Testspiel)
 └─ Version 1, 2, … (beliebig viele, kopierbar)
     ├─ Linien      (beliebig viele, Standard 4)
     ├─ Powerplay   (PP 1, PP 2 …)
     └─ Boxplay     (BP 1, BP 2 …) + Spezial 6:5
```
- Einsatz-Felder: Datum, Typ, Titel/Gegner, Notiz; bei Match zusätzlich optional Resultat, Wettbewerb (Meisterschaft/Cup), Heim/Auswärts.
- **Testspiel:** eigener Knopf 🤝, eigener Filter und Icon (lila). Technisch = `typ 'match'` + `wettbewerb 'test'` (gleich wie im Statistik-Tool).
- **Neuer Einsatz – Linien:** Standard immer „＋ Neue Linien“ (4 leere). „↻ Übernehmen“ öffnet ein Suchfeld über alle Einsätze; ohne Suchbegriff die 5 neusten, mit Suche max. 8 Treffer.
- Einsatz-Ansicht: nur Aufstellen (Versionen-Chips, Formationen mit Mini-Spielfeld, „nicht eingeteilt“).
- Goalies sind NICHT Teil der Linien. Alles löschbar mit Sicherheitsabfrage, kaskadierend.

## Systeme & Posten (Rolle V = Verteidigung, S = Sturm)
- **2-2-1 (Standard):** LV, RV (V) · LF, C (S, Mitte) · SF = Steuerflügel (S, vorne)
- **2-1-2:** LV, RV (V) · C (S) · LF, RF (S)
- **W-System:** LV, RV (V) · C (S) · LF, RF (S, hoch/breit)
- **Powerplay 5:4:** LV, RV (V, hinten) · LF, RF (S) · Slot (S)
- **Boxplay Box 4:5:** LV, RV (V) · LS, RS (S)
- **Boxplay Diamant 4:5:** V (V) · L, R (flexibel) · S (S)
- **6:5 ohne Goalie:** LV, RV (V) · LF, C, RF, Slot (S)
- **Zusatzplätze** (6er-Linie und mehr): beliebig viele, Rolle pro Person wählbar (V / S / flexibel).

## Regeln
- Einteilbar: aktive Feldspieler:innen aus dem Kader + **Gast ohne Kader** (wird nicht ausgewertet).
- Gleiche Person in mehreren Linien derselben Version: erlaubt, Hinweis „2×“.
- Keine Abwesenheit; stattdessen Liste „nicht eingeteilt“. Bedienung: Posten antippen → Person wählen.
- Archivierte Saison: nur ansehen. Kader-Person mit Linien-Historie: **Löschen gesperrt**, nur inaktiv setzen.
- Mehrere Teams: Team-Chips oben in der Linien-Übersicht (gleiche Auswahl wie Kader).
- Tabs: **Einsätze · Personen · Auswertung · 💡 Ideen**. Person: Einsätze, Training/Match, PP/BP, häufigste Partner:innen, Verlauf.

## Auswertung (`linien-auswertung.js`)
Bereiche: **Linien · 🏆 Top 3 · Paare/Trios · PP / BP**; Filter „Alle Einsätze / Nur Matches & Testspiele / Nur Trainings“, Personenfilter; Sortierung **🔁 Häufigkeit** oder **⚽ Tore** (Tore der Linie, dann Skorerpunkte, dann ±).
1. **Linien:** Stamm-Linien (mind. 4 von 5 gleich, Varianten als Hinweis). Zeigt 10, Rest aufklappbar.
2. **🏆 Top 3:** nur noch **beste 3 bewährte Linien** (ohne doppelte Personen, nur aktive, nur echte Linien). Umschalter **⚖️ Gesamt** (je 50 % Häufigkeit und Tore+Skorerpunkte) / **🔁 Häufigkeit** / **⚽ Tore/Punkte**. Der Baukasten ist in den Reiter Ideen gewandert.
3. **Paare & Trios:** Verteidigerpaare, Sturmtrios/-duos, Paar × Trio – je **Top 5**, Rest aufklappbar. PP/BP per Schalter mitzählbar.
4. **PP / BP:** Formationen mit Quote (+ Team-Quote aus Match-Statistik).
- `topDrei(R, aktiv, art)` akzeptiert als `art` auch eine eigene Bewertungsfunktion (wird von Ideen genutzt).

## 💡 Ideen (`linien-ideen.js`, 12.11.)
Vorschläge zum Ausprobieren – „Stärke“ (0–1) einer Kombi = Mittel aus Häufigkeit, Tore+Skorerpunkte und Plus/Minus (je relativ zur Liste; nur Komponenten mit Daten). Mit Plus/Minus-Daten werden Paare/Trios mit negativem ± **nie vorgeschlagen**. Nur aktive Feldspieler:innen. Hinweis, solange noch kein Plus/Minus erfasst ist. Je 5 Einträge, Rest aufklappbar; Wiederholungen (Kombi steckt ganz in schon gezeigtem Eintrag mit gleichen Zahlen) werden weggelassen.
1. **🧪 Neue Kombis zum Ausprobieren:** Top-8-Paare × Top-8-Trios ohne Überschneidung, die höchstens 1× zusammen waren; jedes Paar/Trio max. 2× vorgeschlagen.
2. **🧩 Test-Aufstellung:** Baukasten (3 Paare + 3 Trios ohne Überschneidung, bekannte Kombis bevorzugt), mit Ideen-Stärke inkl. ±; Hinweis, wenn weniger als 3 Linien möglich.
3. **🌱 Verdient mehr Einsätze:** Linien/Paare/Trios/Duos mit ≤ 3 Einsätzen, aber Toren/Punkten oder positivem ±.
4. **🆕 Frisch getestet:** Kombis, die erst in den letzten 21 Tagen (bezogen auf den neusten Einsatz) dazukamen – nur wenn es ältere Daten gibt.
5. **⚠️ Läuft (noch) nicht:** ≥ 4 Einsätze, ≥ 2 Matches, negatives ± oder (≥ 3 Matches) ohne Tor. Nur mit Statistik-Daten.
6. **💎 Geheimtipps:** Personen mit ≥ 2 Matches, positivem ± oder Skorerpunkten, aber < 50 % ihrer Einsätze in Linie 1; sortiert nach (± + Punkte)/Match.
7. **🙋 Wenig eingeteilt:** aktive Feldspieler:innen mit ≤ 40 % der Einsätze der meisteingesetzten Person (inkl. nie eingeteilt).
8. **🤝 Noch nie zusammen:** Person wählen → mit wem nie bzw. erst 1× in derselben Linie.

## Umsetzung (Updates)
- **3:** SQL 03 + `linien.js`, `linien.css`, `app.js`, `ui.js` · **4:** `linien-auswertung.js` · **Testspiel**, **Top 3 + Dialog**, **schlank**, **💡 Ideen** (12.11.): `linien.js`, `linien.css`, `linien-auswertung.js` (+ neu `linien-ideen.js`), kein SQL.
- Das Statistik-Tool nutzt ebenfalls `linien.js` / `linien-auswertung.js` (Funktion `statistikProLinie`).

## Datenmodell (SQL 03)
- `einsaetze`: id, liste_id → kaderlisten (cascade), typ ('training'|'match'), datum, titel, notiz, resultat, wettbewerb ('meisterschaft'|'cup'|'test'), ort ('heim'|'auswaerts')
- `varianten`: id, einsatz_id (cascade), nr, name
- `linien`: id, variante_id (cascade), art ('linie'|'pp'|'bp'|'6v5'), nr, name, system, note, notiz, anzahl, tore (note/notiz zurzeit unbenutzt)
- `linien_spieler`: id, linie_id (cascade), kader_id → kader (deferred, kein on delete) | gast_name, posten, rolle ('V'|'S'|'flex')
- `chemie`: id, liste_id, kader_a, kader_b, wertung, notiz (zurzeit unbenutzt)
- RLS seit SQL 05 über `darf_*()`-Funktionen (siehe `docs/vision.md`) + Realtime.
