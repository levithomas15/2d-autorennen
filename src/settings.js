// Alle Einstellungen an einem Ort: Schema (steuert zugleich das Menue),
// Standardwerte und Speicherung im localStorage.

export const SCHEMA = [
  {
    group: 'STEUERUNG',
    items: [
      { key: 'shifterMode', label: 'GANGSCHALTUNG', type: 'choice',
        options: ['AUS', 'AUTOMATIK', 'MANUELL'], def: 0,
        help: 'AUS = arcade ohne Gaenge. MANUELL schaltest du selbst (E hoch, Q runter).' },
      { key: 'clutch', label: 'KUPPLUNG NOETIG', type: 'toggle', def: false,
        dep: (s) => s.shifterMode === 2,
        help: 'Nur mit manueller Schaltung: F oder das dritte Pedal.' },
      { key: 'showWheel', label: 'LENKRAD ANZEIGEN', type: 'toggle', def: true },
      { key: 'showPedals', label: 'PEDALE ANZEIGEN', type: 'toggle', def: true },
      { key: 'wheelSens', label: 'LENKRAD-EMPFINDLICHKEIT', type: 'range',
        min: 0.5, max: 2, step: 0.1, def: 1,
        help: 'Wie stark der Lenkradwinkel auf die Raeder wirkt.' },
      { key: 'wheelReturn', label: 'LENKRAD-RUECKSTELLUNG', type: 'range',
        min: 0, max: 3, step: 0.1, def: 1.4 },
    ],
  },
  {
    group: 'FAHRVERHALTEN',
    items: [
      { key: 'driftIntensity', label: 'DRIFT-INTENSITAET', type: 'range',
        min: 0.4, max: 2, step: 0.1, def: 1,
        help: 'Hoeher = weniger Haftung hinten, das Heck kommt viel leichter.' },
      { key: 'steerAssist', label: 'GEGENLENK-HILFE', type: 'range',
        min: 0, max: 1, step: 0.05, def: 0.3,
        help: 'Lenkt im Drift automatisch etwas gegen.' },
      { key: 'stability', label: 'STABILITAETSKONTROLLE', type: 'toggle', def: false,
        help: 'Daempft das Ausbrechen - macht das Auto zahm.' },
      { key: 'gripGlobal', label: 'GESAMT-GRIP', type: 'range',
        min: 0.7, max: 1.3, step: 0.05, def: 1 },
      { key: 'autoReset', label: 'AUTO-RESET BEIM FESTFAHREN', type: 'toggle', def: true },
    ],
  },
  {
    group: 'OPTIK',
    items: [
      { key: 'parallax', label: 'GEBAEUDEHOEHE (3D)', type: 'range',
        min: 0, max: 1.2, step: 0.05, def: 0.65,
        help: 'Wie stark sich die Hauswaende von der Bildmitte wegneigen.' },
      { key: 'weather', label: 'WETTER', type: 'choice',
        options: ['KLAR', 'REGEN', 'SCHNEE'], def: 0,
        help: 'Regen und Schnee kosten spuerbar Grip.' },
      { key: 'grade', label: 'FARBSTIMMUNG', type: 'toggle', def: true },
      { key: 'daytime', label: 'TAGESZEIT', type: 'choice',
        options: ['TAG', 'ABEND', 'NACHT'], def: 1,
        help: 'Abend und Nacht schalten die dynamische Beleuchtung ein.' },
      { key: 'cityLights', label: 'LATERNEN UND FENSTER', type: 'toggle', def: true,
        dep: (s) => s.daytime > 0 },
      { key: 'bloom', label: 'LICHTSCHEIN', type: 'range', min: 0, max: 0.6, step: 0.05, def: 0.25,
        dep: (s) => s.daytime > 0 },
      { key: 'underglow', label: 'UNTERGRUNDBELEUCHTUNG', type: 'toggle', def: true,
        help: 'Zeigt das Neon unter getunten Autos (in der Garage kaufen).' },
      { key: 'glowPulse', label: 'NEON PULSIEREN', type: 'toggle', def: true },
      { key: 'skidmarks', label: 'REIFENSPUREN', type: 'toggle', def: true },
      { key: 'skidFade', label: 'SPUREN VERBLASSEN', type: 'toggle', def: true },
      { key: 'particles', label: 'PARTIKELMENGE', type: 'range',
        min: 0, max: 1.5, step: 0.1, def: 1 },
      { key: 'shake', label: 'BILDSCHUETTELN', type: 'range', min: 0, max: 2, step: 0.1, def: 1 },
      { key: 'vignette', label: 'VIGNETTE', type: 'toggle', def: true },
      { key: 'scanlines', label: 'SCANLINES', type: 'toggle', def: false },
      { key: 'minimap', label: 'MINIMAP', type: 'toggle', def: true },
      { key: 'headlights', label: 'SCHEINWERFER', type: 'toggle', def: true },
      { key: 'zoom', label: 'KAMERA-ZOOM', type: 'range', min: 0.75, max: 1.5, step: 0.05, def: 1 },
    ],
  },
  {
    group: 'AUDIO',
    items: [
      { key: 'volMaster', label: 'GESAMTLAUTSTAERKE', type: 'range', min: 0, max: 1, step: 0.05, def: 0.5 },
      { key: 'volEngine', label: 'MOTOR', type: 'range', min: 0, max: 1, step: 0.05, def: 1 },
      { key: 'volTires', label: 'REIFEN', type: 'range', min: 0, max: 1, step: 0.05, def: 1 },
    ],
  },
];

const KEY = 'pdc_settings_v1';

export function defaults() {
  const out = {};
  for (const g of SCHEMA) for (const it of g.items) out[it.key] = it.def;
  return out;
}

export function load() {
  const s = defaults();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    for (const k of Object.keys(s)) if (k in raw) s[k] = raw[k];
  } catch { /* defekte Daten einfach ignorieren */ }
  return s;
}

export function save(settings) {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* voll oder gesperrt */ }
}

export function shifterModeName(v) { return ['off', 'auto', 'man'][v] || 'off'; }
