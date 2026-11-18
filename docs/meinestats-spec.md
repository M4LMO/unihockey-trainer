# Meine Stats – Spezifikation (Stand 17.11.2026)

## Ziel
Marcs persönliche Statistik (bisher OneNote): eigene Spiele **als Trainer**, **als Spieler (Goalie)** und **als Fan**, mit Rangtabellen und Auswertungen. Unabhängig von den Teams/Kadern der App.

## Zugang
- Kachel **🏅 Meine Stats** oben auf der Hauptseite (`admin.js`), Route `#/meinestats` (in `TOOLS` mit `persoenlich: true` → nicht auf der Team-Startseite).
- Lesen: Admin + Zuschauer:in (`sieht_alles()`), Schreiben: nur voller Admin (`ist_admin()`). Staff sieht nichts.
- Ausnahme zur Regel «neue Tabellen mit Bezug zu kaderlisten/einsaetze»: die Daten sind persönlich, nicht teambezogen.

## Datenmodell (SQL 09)
- `ms_vereine` (name unique, land) – jeder Verein nur einmal, **ein Name** (Spiele/Tabellen zeigen auf die id → Umbenennen wirkt überall). Suche ohne Akzente/Gross-klein. Spalte `aliase` seit SQL 11 leer und unbenutzt (Wunsch Marc 17.11.).
- `ms_hallen` (ort, name; unique) – «Ort, Halle».
- `ms_abschnitte` = eine Saison/ein Turnierjahr (Sortierung: Turnierjahr 2026 = Saison 2026/27) mit einem Team: bereich (trainer|spieler|fan), saison (frei: «2023/24» oder «2025»), kategorie (Meisterschaft, Prague Games …), verein_id, team, gruppe, staff (Text), notiz, geloescht_am (Papierkorb).
- `ms_spiele`: teil (Unterabschnitt, z.B. «La Saga Tenero»), datum, zeit, halle_id, livestream, eigene Spiele: gegner_id + gegner_zusatz (z.B. «U17»), Fan: heim_id/gast_id + liga; tore1/tore2 (= wir/Gegner bzw. Heim/Gast), entscheid (nv|np), spielart (meisterschaft, cup, test, turnier, ko, playoff, abstieg, laenderspiel), ich (Trainer: dabei|nicht; Spieler: tor|ersatz|nicht), abgesagt, notiz.
- `ms_werdegang` (SQL 13): Junioren-Werdegang, **ungefähr und isoliert** (fliesst in keine andere Zahl ein): saison, verein_id, team, liga, ohne_meisterschaft, spiele (ca., optional), notiz (Skorerpunkte, Position usw. als Text). Fehlt die Tabelle, wird das Kapitel ausgeblendet.
- `ms_tabellen`: Rangtabellen-Zeilen pro Abschnitt (titel trennt mehrere Tabellen), rang, verein_id, team (Zusatz), eigenes, sp, s, u, snv, nnv, n, tore, gegentore, punkte (leere Spalten werden nicht angezeigt).
- In der 💾 Sicherung enthalten. Realtime aktiv.

## Ansichten
- **Übersicht:** grosse Zahl = «Spiele als Trainer oder Spieler (Aktiv-Bereich)» = Trainer dabei + Spieler auf dem Matchblatt ohne Testspiele, darunter Aufteilung + Hallen, Fan-Spiele nur klein «dazu X als Fan geschaut»; Trainer (Spiele dabei, S/U/N, Siegquote, Tore), Goalie (Hinweis «im Aktiv-Bereich, nicht Junioren · Testspiele nicht eingerechnet» – Testspiele werden hier und in der grossen Zahl auch wirklich weggelassen, Matchblatt, im Tor, Ersatz, Bilanz im Tor, Gegentore + Ø, erstes Spiel), **🏑 Mein Unihockey** (unter der grossen Zahl: «seit 2012/13» = früheste Saison aus Werdegang + Spieler-Saisons, «16. Saison · läuft aktuell (2026/27)» = aktuelle Saison ab Beginn gezählt, die Einstiegs-Saison zählt nicht (war nicht komplett; Saisonwechsel 1. Juli), Saisons gespielt = Anzahl verschiedener Saisons ohne Einstiegs-Saison, inkl. laufende (passt zur «x. Saison»), Junioren/Aktiv getrennt, beides zählt einmal; reine Trainer-Saisons zählen nicht; `laufbahn()`), **🧒 Junioren-Werdegang** (zugeklappt, unter Goalie: Warnhinweis «ungefähre Angaben», «X Saisons · ca. Y Spiele», Liste pro Saison/Team neueste oben, **gleiche Saison in einem blauen Kasten mit «2 Teams»**, Admin: ＋ Eintrag / antippen zum Ändern), Fan (Hinweis «ab Saison 26/27» = früheste Fan-Saison, Spiele, Halle/Livestream, meistgesehenes Team, Tore); zuletzt gespielte Spiele.
- **Spiele:** Trainer/Spieler/Fan, aufklappbare Blöcke pro Saison/Team (Gruppe, Staff, Knöpfe, Notiz, Spiele **neueste oben**, ohne Datum unten, Rangtabellen). Admin-Knöpfe oben im Block: ＋ Spiel, ＋ Rangtabelle, ✏️ Saison/Team (🗑 → Papierkorb), runder ＋ = neue Saison/Team.
- **Auswertung:** Filter Bereich, **Saison** (Turnierjahr zählt zur Saison, die im Sommer beginnt: Prague Games 2026 → 2026/27; `saisonName()`), **Kategorie** (Meisterschaft, Prague Games …), **Team** (ein Team oder «Verein (alle Teams)»), – die Listen schränken sich **gegenseitig** ein (jede zeigt nur, was zu den anderen Auswahlen passt; unpassende Auswahl wird zurückgesetzt), Spielart-Knöpfe nur für vorhandene Spielarten (mit Anzahl), «Zählen» (nur meine Spiele = Trainer dabei / im Tor · inkl. Ersatz · alle Teamspiele), Spielarten. Bilanz pro Saison/Team (mit Schlussrang), Gegner-Bilanz (Suche, Sortierung, aufklappbar mit Spielen, neueste oben), Fan: Ligen + meistgesehene Teams, **Hallen & Orte** (umschaltbar Hallen/Orte, Suche, Balken + Anzahl + Aufteilung 🎽🥅👀 + Bilanz der eigenen Spiele; antippen → alle Spiele dort, neueste oben; Livestream als eigener Eintrag).
- **Verwaltung:** Vereine & Hallen bearbeiten, **zusammenführen** (alles geht an den Ziel-Eintrag, alter Eintrag wird gelöscht), Papierkorb (wiederherstellen / endgültig mit Eintippen).
- Resultatfarben: Sieg grün, Niederlage rot, Unentschieden orange; n.V./n.P. zählen als Sieg/Niederlage (separat ausgewiesen).

## Eingabe-Hilfen
- Spiel-Dialog: Feld Gegner/Heim/Gast bzw. Halle antippen ohne zu tippen → Vorschläge aus diesem Block (häufigste zuerst), dann aus anderen Saisons desselben Teams.
- Saison/Team-Dialog: «Mein Verein» schlägt bisherige eigene Vereine vor; Team und Gruppe schlagen Werte vor, die zum gewählten Verein (und Team) passen.

## Dateien
`meinestats.js` (Oberfläche), `meinestats.css`, `meinestats-logik.js` (Rechnen, Suche; ohne Oberfläche).

## Startdaten
SQL 12: «2025 ZPGD – B14 White» getrennt in **La Saga** (Tenero, Kategorie «La Saga») und **Prague Games** (je eigener Block mit Spielen + Rangtabelle). Grundsatz: jedes Turnier = eigener Block, nicht als «Teil» im selben Block.

## Startdaten (Import)
Einmaliger Import aus dem OneNote-PDF (13 Saisons/Teams, 187 Spiele, 65 Tabellenzeilen) – bewusst **nicht im Repo** (öffentlich, enthält Staff-Namen); SQL wurde Marc direkt gegeben.
