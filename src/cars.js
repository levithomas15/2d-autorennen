// Fahrzeugdaten, Tuning-Stufen und die Berechnung der effektiven Fahrwerte.
// Ein "spec" ist immer das Ergebnis aus Basisauto + gekauftem Tuning +
// Einstellungen (z.B. Drift-Intensitaet).

export const PAINTS = [
  '#e03e3e', '#2f6fd0', '#33c07a', '#ffd23f', '#f2f2f6',
  '#8c4ad6', '#ff7a1a', '#1b1b24', '#00c8c8', '#e85a9b',
];

export const GLOW_COLORS = [
  '#ff2e88', '#00e5ff', '#7cff3a', '#ff8a00', '#b44cff', '#ffffff',
];

export const CARS = [
  {
    id: 'drifter', shape: 'coupe', spoiler: false, wheel: 6, name: 'DRIFTER', price: 0,
    blurb: 'AUSGEWOGEN - GUTER EINSTIEG',
    color: '#e03e3e', stripe: '#f6e3c8',
    mass: 1150, inertia: 1250, caF: -5.2, caR: -4.6,
    grip: 2.05, rear: 0.86, maxSteer: 0.60, len: 26, wid: 12,
    peakTorque: 390, peakRpm: 4600, redline: 7000, idle: 900,
    power: 185000, arcadeForce: 11000,
    gears: [3.32, 2.13, 1.54, 1.21, 1.00, 0.84], final: 3.9,
  },
  {
    id: 'muscle', shape: 'muscle', spoiler: false, wheel: 7, name: 'MUSCLE', price: 9000,
    blurb: 'SCHWER, BRUTALES DREHMOMENT',
    color: '#2f6fd0', stripe: '#eaeaf2',
    mass: 1520, inertia: 1780, caF: -5.0, caR: -4.8,
    grip: 2.2, rear: 0.83, maxSteer: 0.50, len: 30, wid: 13,
    peakTorque: 560, peakRpm: 3600, redline: 6000, idle: 750,
    power: 215000, arcadeForce: 13500,
    gears: [2.97, 1.78, 1.30, 1.00, 0.74], final: 3.55,
  },
  {
    id: 'tuner', shape: 'hatch', spoiler: true, wheel: 5, name: 'TUNER', price: 14000,
    blurb: 'LEICHT, DREHFREUDIG, DIREKT',
    color: '#33c07a', stripe: '#1b2a24',
    mass: 980, inertia: 1020, caF: -5.6, caR: -5.2,
    grip: 2.3, rear: 0.88, maxSteer: 0.66, len: 24, wid: 11,
    peakTorque: 300, peakRpm: 5600, redline: 8600, idle: 1050,
    power: 175000, arcadeForce: 10200,
    gears: [3.58, 2.30, 1.70, 1.34, 1.06, 0.87], final: 4.3,
  },
  {
    id: 'slideking', shape: 'drift', spoiler: true, wheel: 6, name: 'SLIDEKING', price: 22000,
    blurb: 'HECK KOMMT VON ALLEIN - PROFIS',
    color: '#f2f2f6', stripe: '#ff7a1a',
    mass: 1060, inertia: 1080, caF: -6.0, caR: -4.2,
    grip: 2.1, rear: 0.74, maxSteer: 0.72, len: 26, wid: 12,
    peakTorque: 360, peakRpm: 5000, redline: 8000, idle: 1000,
    power: 190000, arcadeForce: 11200,
    gears: [3.48, 2.20, 1.60, 1.25, 1.00, 0.82], final: 4.1,
  },
  {
    id: 'hyper', shape: 'super', spoiler: true, wheel: 7, name: 'HYPER', price: 40000,
    blurb: 'EXTREM SCHNELL, VIEL GRIP',
    color: '#ffd23f', stripe: '#1b1b24',
    mass: 1320, inertia: 1400, caF: -5.8, caR: -5.6,
    grip: 2.5, rear: 0.93, maxSteer: 0.56, len: 28, wid: 13,
    peakTorque: 620, peakRpm: 5200, redline: 8200, idle: 1000,
    power: 330000, arcadeForce: 16000,
    gears: [3.10, 2.05, 1.52, 1.20, 0.98, 0.80, 0.68], final: 3.7,
  },
];

// Tuning-Kategorien: Stufe 0 ist immer serienmaessig.
export const TUNING = [
  {
    key: 'engine', name: 'MOTOR', icon: 'M',
    desc: 'MEHR DREHMOMENT UND LEISTUNG',
    costs: [0, 1500, 4000, 9000],
  },
  {
    key: 'turbo', name: 'TURBO', icon: 'T',
    desc: 'LADEDRUCK - SCHIEBT AB MITTLERER DREHZAHL',
    costs: [0, 2000, 5000, 11000],
  },
  {
    key: 'tires', name: 'REIFEN', icon: 'R',
    desc: 'MEHR SEITENFUEHRUNG, PRAEZISER AM LIMIT',
    costs: [0, 1200, 3000, 7000],
  },
  {
    key: 'chassis', name: 'FAHRWERK', icon: 'F',
    desc: 'WENIGER TRAEGHEIT, MEHR LENKWINKEL',
    costs: [0, 1300, 3200, 7500],
  },
  {
    key: 'gearbox', name: 'GETRIEBE', icon: 'G',
    desc: 'KUERZERE UEBERSETZUNG, SCHNELLERE SCHALTUNG',
    costs: [0, 1400, 3400, 8000],
  },
];

export const GLOW_PRICE = 2500;
export const PAINT_PRICE = 600;

export function defaultGarage() {
  const g = { cash: 0, selected: 'drifter', owned: { drifter: true }, cars: {} };
  for (const c of CARS) {
    g.cars[c.id] = {
      engine: 0, turbo: 0, tires: 0, chassis: 0, gearbox: 0,
      paint: c.color, glow: false, glowColor: GLOW_COLORS[0],
    };
  }
  return g;
}

export function carById(id) {
  return CARS.find((c) => c.id === id) || CARS[0];
}

export function upgradeCost(key, level) {
  const t = TUNING.find((x) => x.key === key);
  if (!t || level >= t.costs.length) return null;
  return t.costs[level];
}

// Basisauto + Tuning + Einstellungen -> konkrete Fahrwerte
export function buildSpec(car, tune, settings) {
  const t = tune || {};
  const lv = (k) => Math.max(0, Math.min(3, t[k] | 0));
  const eng = lv('engine'), turbo = lv('turbo'), tires = lv('tires');
  const chas = lv('chassis'), gbox = lv('gearbox');

  const drift = settings ? settings.driftIntensity : 1;
  // Hoehere Drift-Intensitaet = weniger Haftung hinten und steilerer Abfall
  // der Seitenkraft nach dem Haftungsmaximum.
  const rearMul = 1.25 - 0.25 * drift;
  const falloffR = 0.42 * (0.55 + 0.45 * drift);

  const powerMul = 1 + 0.14 * eng;

  return {
    id: car.id,
    name: car.name,
    body: t.paint || car.color,
    stripe: car.stripe,
    shape: car.shape,
    spoiler: car.spoiler,
    wheel: car.wheel,
    glow: !!t.glow,
    glowColor: t.glowColor || GLOW_COLORS[0],

    mass: car.mass,
    inertia: car.inertia * (1 - 0.055 * chas),
    caF: car.caF * (1 + 0.05 * tires),
    caR: car.caR * (1 + 0.04 * tires),
    grip: car.grip * (1 + 0.06 * tires),
    rearGrip: car.rear * rearMul,
    falloffR,
    falloffF: 0.15,
    maxSteer: car.maxSteer + 0.025 * chas,
    len: car.len, wid: car.wid,

    peakTorque: car.peakTorque * powerMul,
    peakRpm: car.peakRpm,
    redline: car.redline,
    idle: car.idle,
    power: car.power * powerMul,
    arcadeForce: car.arcadeForce * powerMul,

    turboLevel: turbo,
    boostMax: turbo === 0 ? 0 : 0.10 + 0.09 * turbo,   // max. Drehmomentzuwachs
    spool: 1.1 + 0.45 * turbo,

    gears: car.gears.map((g) => g * (1 - 0.04 * gbox)),
    final: car.final,
    shiftTime: 0.34 - 0.07 * gbox,
  };
}

// Kennwerte 0..1 fuer die Balken in der Garage
export function statBars(spec) {
  return [
    ['POWER', clamp01((spec.power / 1000 - 140) / 280)],
    ['GRIP', clamp01((spec.grip - 1.9) / 0.9)],
    ['AGIL', clamp01((1900 - spec.inertia) / 1100)],
    ['DRIFT', clamp01((1.0 - spec.rearGrip) / 0.45)],
    ['TURBO', spec.turboLevel / 3],
  ];
}
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
