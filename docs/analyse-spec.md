# Analyse-Tool – Spezifikation (Stand 16.11.2026)

## Ziel
Grafische Auswertung der Statistik-Daten: Wann fallen Tore/Gegentore, wie verläuft ein Match, wie ist die Form über die Saison.
Nur Ansicht – ändert nichts, **kein eigenes SQL**. Grundlage: `einsaetze` (typ = match) + `match_ereignisse` aus dem Statistik-Tool.

## Dateien
- `analyse.js` (Oberfläche, SVG-Diagramme), `analyse.css`, `analyse-logik.js` (Rechnen, ohne Oberfläche).
- `zeitleiste()` in `statistik-logik.js` liefert dafür zusätzlich `wechsel` (Zeitpunkte, an denen Über-/Unterzahl beginnt/endet).

## Ansichten (`#/analyse`, `#/analyse/verlauf/<id>`, `#/analyse/saison`)
- Kopf wie Statistik: Saison, Team-Chips. Filter: Wettbewerb-Auswahl **Alle / Meisterschaft / Cup / Testspiele**, mehrere wählbar, Standard Meisterschaft (gleich wie in der Statistik, gemeinsam gemerkt) und **Alle / Heim / Auswärts**.
- **Tore:** gespiegeltes Balkendiagramm pro 5 Minuten (Tore nach oben, Gegentore nach unten, Abschnitts-Grenzen gestrichelt, Verlängerung separat), Tabelle zum Aufklappen. Pro Drittel/Halbzeit mit Differenz, stärkster/schwächster Abschnitt, erste/letzte 5 Min. **Reaktion:** Antwort innert 5 Min nach Gegentor, Gegentor innert 2 Min nach eigenem Tor. Tore nach Situation (Gleichzahl, PP, BP, 6:5 …).
- **Matchverlauf:** Match wählen → Treppenlinie Spielstand (Wir/Gegner), Über-/Unterzahl als farbige Bänder, Tor-Punkte antippen (Zeit, Stand, Torschütz:in + Assist bzw. Gegner-Nummer). Spielstand-Anteile (Führung/Gleichstand/Rückstand), erstes Tor, höchste Führung/Rückstand, Link zum Telegramm. Hinweis, wenn die erfassten Tore nicht zum Resultat passen.
- **Saison:** Formkurve (Tordifferenz pro Match, älteste links; zweimal antippen → Matchverlauf), letzte 5 + Serie, Spielstand-Anteile über die Saison, Siegquote nach erstem Tor / erstem Gegentor, Comebacks (Rückstand gedreht zum Sieg) und verspielte Führungen (mit Links), grösste Führung/Rückstand, Heim/Auswärts-Bilanz.

## Darstellung
- Farben: **Wir = Vereinsfarbe** (`--team`), **Gegner = Blau** `#2563eb` (farbenblind-tauglich geprüft). Führung/Gleich/Rückstand = grün/grau/rot, immer mit Beschriftung.
- Diagramme als SVG in Containerbreite, neu gezeichnet bei Grössenänderung; Tooltip per Antippen/Hover.
