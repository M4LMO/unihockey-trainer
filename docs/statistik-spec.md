# Statistik-Tool – Spezifikation (Stand 13.11.2026, mit Marc abgestimmt)

## Ziel
Match-Statistik aus der Swiss-Unihockey-App erfassen (Screenshots → Claude liest aus → Import in die App), händisch korrigier-/ergänzbar, und sinnvoll ins Linien-Tool einfliessen lassen.

## Entscheide
- **Datenquelle:** Marc schickt Screenshots (Match facts / Telegramm + Lineup) **im Claude-Chat**. Claude liest aus und liefert einen **Import-Text** (JSON-Codeblock, Format unten).
- **Import:** Im Tool „Statistik“ ＋ → Import-Text einfügen → **Vorschau** (Match verknüpfen/anlegen, Personen zuordnen, Telegramm) → speichern. Alles danach auch händisch bearbeitbar. Match auch ganz ohne Import von Hand erfassbar.
- **Daten:** Matchtelegramm (Tore mit Zeit, Torschütz:in, Assist; Strafen; Goalie-Wechsel) + Aufstellung (wer hat gespielt, Goalies, Start-Goalie).
- **Nicht gewünscht:** Saison-Skorerliste, Ligatabelle, fremde Resultate.
- **Gegner:** keine Namen, nur Rückennummer.
- **Goalies:** Spielzeit (Start-Goalie + Wechsel) und Gegentore. Keine Paraden.
- **Namens-Zuordnung:** gemerkt → Nummer + Name → Name → Nummer + Namensteil → nur Nummer (gelb, prüfen). Umlaute ä=ae usw. Nicht gefundene: zuordnen, „neu in Kader aufnehmen“ oder ignorieren. Zuordnungen werden gemerkt (`su_zuordnung`).
- **Ort:** eigenes Tool „Statistik“ (Kachel).
- Abzeichen „auch #…“ (andere Rückennummern) wird in der Statistik **nicht** angezeigt (Wunsch Marc 12.11.).

## Verknüpfung mit dem Linien-Tool
- Import: Match-Einsatz am gleichen Datum → verknüpfen, sonst neuen Match-Einsatz anlegen (Linien von Vorlage übernehmen, Standard = letzter Einsatz).
- Resultat, Gegner, Heim/Auswärts, Wettbewerb gehen in den Einsatz.
- **Version:** Standard ist Version 1 (= Aufstellung in der SU-App, entspricht dem Linien-Tool). Pro Tor kann eine andere Version gesetzt werden (Wechsel im Spiel) – sie gilt **ab diesem Tor** für alle folgenden, bis wieder eine andere gesetzt wird.
- **Plus/Minus (freiwillig):** pro Tor/Gegentor die Linie auf dem Feld antippen. Eishockey-Regel: PP-Tore geben kein +, Gegentore in Unterzahl kein −.
- Re-Import ersetzt die Statistik, behält aber Version/Linie/Notiz bei gleichen Ereignissen (Art + Zeit). Von Hand ergänzte Ereignisse, die nicht im Import stehen, fallen weg.
- Skorerpunkte pro Linie/Paar/Trio und automatische PP/BP-Quoten in `linien-auswertung.js` (`statistikProLinie`), Handzähler bleiben Fallback.

## Berechnungen (statistik-logik.js)
- Situation pro Tor aus Strafen: 2' endet bei Tor des Gegners, 2+2 = zwei Teile, 5'/Matchstrafe ohne frühes Ende, 10' ohne Wirkung, max. 2 gleichzeitig. Goalie raus (Goalie-Ereignis ohne Person) → 6:5. Situation von Hand überschreibbar.
- PP-/BP-Chancen = Wechsel in Über-/Unterzahl (gleichzeitige Strafen heben sich auf).
- Strafminuten: 2+2 = 4, 2+10 = 12, MS = 25.
- Abschnitte: Standard 3×20', pro Match einstellbar (U21 B z.B. 2 Halbzeiten).

## Import-Format `unihockey-statistik-1`
```json
{
  "format": "unihockey-statistik-1",
  "datum": "2026-09-27", "ort": "heim", "gegner": "UHC Beispiel",
  "wettbewerb": "meisterschaft", "liga": "U21 B …",
  "tore": [1, 3], "abschnitte": 2, "abschnitt_min": 20,
  "aufstellung": [ {"nr": 20, "name": "…", "goalie": true, "start": true}, {"nr": 8, "name": "…"} ],
  "ereignisse": [
    {"zeit": "14:05", "art": "tor", "nr": 10, "name": "…", "assist_nr": 7, "assist_name": "…"},
    {"zeit": "16:30", "art": "gegentor", "gegner_nr": 10},
    {"zeit": "20:00", "art": "strafe", "nr": 8, "name": "…", "minuten": "2", "grund": "Stockschlag"},
    {"zeit": "22:00", "art": "gegnerstrafe", "gegner_nr": 9, "minuten": "2"},
    {"zeit": "58:30", "art": "goalie", "nr": null}
  ]
}
```
- Sicht immer aus eigener Sicht (`tore` = [wir, Gegner], `tor` = eigenes Tor). Zeit durchlaufend mm:ss. Optional `"situation"` pro Tor.
- Swiss-Unihockey-App: Match facts zeigt Tore (Zeit, Schütz:in, Assist) und Spielabschnitte; Lineup zeigt Linien + Kaderliste (Nr, Name, Position).

## Ansichten
- Übersicht: Saison/Team wie Kader; Tabs **Matches** (S/U/N, Resultat, Statistik-Status), **Skorer** (Sp, T, A, P, Strafminuten, +/−, sortierbar), **Goalies** (Spiele, Spielzeit, Gegentore, GT/60'), **Team** (Bilanz, PP/BP-Quote, Strafminuten, Tore pro Abschnitt), **Strafen** (siehe unten).

## Register «Strafen» (13.11.2026, mit Marc abgestimmt)
- Nur **eigene** Strafen (keine Gegner-Strafen). Kein SQL nötig – rechnet aus `match_ereignisse` (`strafenStatistik` in `statistik-logik.js`).
- **Übersicht:** Anzahl Strafen, Strafminuten (je Ø pro Match), Quote «Strafe → Gegentor», Strafarten (2', 2+2, 10' …). Gezählt werden nur Matches mit Statistik.
- **Pro Spieler:in** (sortierbar: Str / Min / GT): Strafarten und **Gründe mit Namen** (Wunsch Marc). Strafen ohne Person = «ohne Person (Bank/Team)», immer zuunterst.
- **Nach Grund:** Rangliste (Gross-/Kleinschreibung egal), «ohne Grund» zuunterst.
- **Nach Zeitpunkt:** pro Drittel/Halbzeit (+ Verlängerung) und erste/letzte 5 Min eines Abschnitts.
- **Pro Match:** Strafminuten als Balken, Anzahl, GT; antippen → Match.
- **Folgen (GT):** Ein Gegentor in Unterzahl wird der Strafe zugerechnet, die es beendet (2'); sonst der zuerst ablaufenden (5' / MS). 2+2 kann zwei GT haben. 10' hat keine Unterzahl und zählt nicht in der Quote (`zeitleiste().folgen`).

- Match: Resultat + PP/BP/Strafminuten, Aufstellung (bearbeiten, Goalie/Start), Telegramm nach Abschnitt (Ereignis antippen → bearbeiten inkl. Version/Linie), ＋ Ereignis, Import (neu), Statistik löschen, Link zu den Linien.
