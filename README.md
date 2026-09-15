# PIXEL DRIFT CITY

Ein Top-Down-Drift-Simulator im Stil von GTA 1/2 – Vogelperspektive, Pixel-Optik,
prozedural erzeugte Stadt und ein Lenkrad, mit dem man wirklich lenken kann.

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
| `R` | Auto zurücksetzen |
| `C` | Fahrzeug wechseln |
| `M` | Sound an/aus |
| `K` | Reifenspuren löschen |

Zusätzlich: Das **Lenkrad unten links** lässt sich mit Maus oder Finger drehen,
die Buttons unten rechts sind Gas, Bremse und Handbremse für Touch-Geräte.
Der farbige Ring um das Lenkrad zeigt den aktuellen Driftwinkel.

## So driftet man

1. Auf 60–100 km/h beschleunigen.
2. Einlenken und kurz die Handbremse antippen – das Heck bricht aus.
3. Handbremse loslassen, Gas halten und **gegenlenken**.
4. Den Drift mit kleinen Lenkkorrekturen halten: Der Multiplikator steigt alle
   1,6 Sekunden um eine Stufe (bis x10). Punkte werden erst gutgeschrieben,
   wenn der Drift sauber beendet wird – ein Crash kostet den ganzen Combo.

Umgefahrene Pylonen geben Extrapunkte. Die große Arena in der Kartenmitte ist
zum freien Üben da, die Parkplätze in der Stadt eignen sich für Donuts.

## Fahrphysik

`src/car.js` rechnet mit einem vereinfachten Schräglaufwinkel-Modell:

* Längs- und Querbewegung werden im Fahrzeugkoordinatensystem getrennt geführt.
* Für Vorder- und Hinterachse wird je ein Schräglaufwinkel bestimmt, daraus
  folgt die Seitenkraft und aus deren Differenz das Giermoment.
* Die Seitenkraft fällt hinter dem Haftungsmaximum wieder ab – dieser Abfall
  ist der Grund, warum sich ein Drift überhaupt halten lässt.
* Gas und Handbremse reduzieren die Haftung der Hinterachse gezielt
  (Power-Oversteer bzw. Drift-Einleitung).
* Untergrund zählt mit: Asphalt greift voll, Gras rutscht deutlich mehr.

Drei Fahrzeuge mit unterschiedlichem Charakter: `DRIFTER` (ausgewogen),
`MUSCLE` (schwer, viel Kraft), `TUNER` (leicht, direkte Lenkung).

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `index.html` | Seite, Titelbildschirm, Lenkrad- und Pedal-Elemente |
| `style.css` | Layout, Pixel-Skalierung, Bedienelemente |
| `src/main.js` | Spielschleife, Kamera, Punkte, HUD, Partikel |
| `src/car.js` | Fahrphysik, Kollision, Fahrzeug-Sprites |
| `src/world.js` | Stadtgenerator, Vorab-Rendering, Kollisionsgeometrie |
| `src/input.js` | Tastatur, drehbares Lenkrad, Touch-Pedale |
| `src/audio.js` | Prozeduraler Motor-, Reifen- und Crash-Sound |
| `src/font.js` | 3×5-Pixel-Font fürs HUD |

Die Stadt wird aus einem festen Seed erzeugt und einmalig auf ein
Offscreen-Canvas gerendert; pro Frame wird nur der sichtbare Ausschnitt kopiert.
Reifenspuren liegen auf einer zweiten Ebene in Weltgröße und verblassen langsam.

Interne Auflösung: 480 × 270, hochskaliert ohne Glättung – daher die harten Pixel.
