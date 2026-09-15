# PIXEL DRIFT CITY

Ein Top-Down-Drift-Simulator im Stil von GTA 1/2 – Vogelperspektive, Pixel-Optik,
prozedural erzeugte Stadt, Lenkrad, Pedale und optionale Gangschaltung.

Reines HTML5 + Canvas + ES-Module. Keine Abhängigkeiten, kein Build-Schritt.

## Starten

```bash
# irgendein statischer Server (ES-Module brauchen http://, file:// reicht nicht)
npx http-server -p 8080 .
# dann http://localhost:8080 öffnen
```

## Steuerung

| Eingabe | Funktion |
| --- | --- |
| `W` / `↑` | Gas |
| `S` / `↓` | Bremse, im Stand rückwärts |
| `A` `D` / `←` `→` | Lenken |
| `Leertaste` | Handbremse – leitet den Drift ein |
| `E` / `Shift` | Hochschalten (bei manueller Schaltung) |
| `Q` / `Strg` | Runterschalten |
| `F` | Kupplung (wenn aktiviert) |
| `R` | Auto zurücksetzen |
| `C` | Auto wechseln |
| `M` | Sound an/aus |
| `K` | Reifenspuren löschen |
| `Esc` / `P` | Menü |

Bedienelemente auf dem Bildschirm: **Lenkrad** unten links (mit Maus oder Finger
drehen, der farbige Ring zeigt den Driftwinkel), **Pedale** unten rechts
(Gas, Bremse, Handbremse und – wenn aktiviert – Kupplung) und der
**Schalthebel**, der sich nach oben oder unten ziehen lässt. Jedes Element lässt
sich in den Einstellungen ausblenden.

## Gangschaltung

In den Einstellungen unter *Steuerung* in drei Stufen:

* **AUS** – Arcade, keine Gänge, leistungsbegrenzte Schubkraft.
* **AUTOMATIK** – Getriebe wird simuliert und schaltet selbst, Rückwärtsgang
  legt sich im Stand beim Bremsen ein.
* **MANUELL** – du schaltest selbst, optional mit Kupplungszwang.

Simuliert werden Drehmomentkurve, Drehzahlbegrenzer, Motorbremse,
Turbo mit Ladedruckaufbau und die einzelnen Übersetzungen. Das HUD zeigt dann
Gang, Drehzahlband und Ladedruck.

## Garage

Fünf Fahrzeuge mit eigenem Charakter:

| Auto | Preis | Charakter |
| --- | --- | --- |
| DRIFTER | frei | ausgewogen, guter Einstieg |
| MUSCLE | 9.000 | schwer, brutales Drehmoment |
| TUNER | 14.000 | leicht, drehfreudig, direkt |
| SLIDEKING | 22.000 | Heck kommt von allein |
| HYPER | 40.000 | extrem schnell, viel Grip |

Getunt wird in fünf Kategorien mit je vier Stufen – **Motor**, **Turbo**,
**Reifen**, **Fahrwerk**, **Getriebe** – dazu **Lackierung** aus zehn Farben und
die **Untergrundbeleuchtung** (Neon in sechs Farben, optional pulsierend).
Bezahlt wird mit Geld aus Drifts: Jeder sauber beendete Drift bringt so viel
Geld wie Punkte, Pylonen geben extra. Besitz, Tuning und Geld bleiben im
localStorage gespeichert.

## Einstellungen

* **Steuerung** – Gangschaltung, Kupplung, Lenkrad-Empfindlichkeit und
  -Rückstellung, Sichtbarkeit von Lenkrad und Pedalen.
* **Fahrverhalten** – Drift-Intensität, Gegenlenk-Hilfe,
  Stabilitätskontrolle, Gesamt-Grip, Auto-Reset beim Festfahren.
* **Optik** – Untergrundbeleuchtung, Neon-Pulsieren, Reifenspuren und deren
  Verblassen, Partikelmenge, Bildschütteln, Vignette, Scanlines, Minimap,
  Scheinwerfer, Kamera-Zoom.
* **Audio** – Gesamtlautstärke, Motor, Reifen.

Alles wirkt sofort und wird gespeichert.

## So driftet man

1. Auf 60–100 km/h beschleunigen.
2. Einlenken und kurz die Handbremse antippen – das Heck bricht aus.
3. Handbremse loslassen, Gas halten und **gegenlenken**.
4. Den Drift mit kleinen Lenkkorrekturen halten: Der Multiplikator steigt alle
   1,6 Sekunden um eine Stufe (bis x10). Punkte gibt es erst beim sauberen
   Beenden – ein Crash kostet den ganzen Combo.

Die große Arena in der Kartenmitte ist zum freien Üben da, die Parkplätze in der
Stadt eignen sich für Donuts.

## Fahrphysik

`src/car.js` rechnet mit einem vereinfachten Schräglaufwinkel-Modell:

* Längs- und Querbewegung werden im Fahrzeugkoordinatensystem getrennt geführt.
* Für Vorder- und Hinterachse wird je ein Schräglaufwinkel bestimmt, daraus
  folgt die Seitenkraft und aus deren Differenz das Giermoment.
* Die Seitenkraft fällt hinter dem Haftungsmaximum wieder ab – dieser Abfall
  ist der Grund, warum sich ein Drift überhaupt halten lässt. Die
  Drift-Intensität aus den Einstellungen steuert genau diesen Abfall.
* Gas und Handbremse reduzieren die Haftung der Hinterachse gezielt
  (Power-Oversteer bzw. Drift-Einleitung).
* Untergrund zählt mit: Asphalt greift voll, Gras rutscht deutlich mehr.
* Bei Wandkontakt wird die Geschwindigkeit in Normal- und Tangentialanteil
  zerlegt, das Auto schrammt entlang statt hängenzubleiben.

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `index.html` | Seite, Bedienelemente, Menü-Gerüst |
| `style.css` | Layout, Pixel-Skalierung, Menü und Bedienelemente |
| `src/main.js` | Spielschleife, Kamera, Wertung, HUD, Partikel, Effekte |
| `src/car.js` | Fahrwerksphysik, Kollision, Fahrzeug-Sprites |
| `src/drivetrain.js` | Drehmomentkurve, Turbo, Getriebe, Automatik |
| `src/cars.js` | Fahrzeugdaten, Tuning-Stufen, effektive Fahrwerte |
| `src/garage.js` | Geld, Besitz und Tuning-Stand (localStorage) |
| `src/settings.js` | Einstellungs-Schema, Standardwerte, Speicherung |
| `src/ui.js` | Menü: Start, Garage, Einstellungen, Hilfe |
| `src/world.js` | Stadtgenerator, Vorab-Rendering, Kollisionsgeometrie |
| `src/input.js` | Tastatur, Lenkrad, Pedale, Schalthebel |
| `src/audio.js` | Prozeduraler Motor-, Reifen- und Crash-Sound |
| `src/font.js` | 3×5-Pixel-Font fürs HUD |

Die Stadt wird aus einem festen Seed erzeugt und einmalig auf ein
Offscreen-Canvas gerendert; pro Frame wird nur der sichtbare Ausschnitt kopiert.
Reifenspuren liegen auf einer zweiten Ebene in Weltgröße und verblassen langsam.

Interne Auflösung: 480 × 270, hochskaliert ohne Glättung – daher die harten Pixel.
