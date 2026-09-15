// Besitzstand: Geld, gekaufte Autos und deren Tuning-Stufen.

import { CARS, TUNING, defaultGarage, upgradeCost, GLOW_PRICE, PAINT_PRICE } from './cars.js';

const KEY = 'pdc_garage_v1';

export function loadGarage() {
  const g = defaultGarage();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (typeof raw.cash === 'number') g.cash = Math.max(0, raw.cash);
    if (raw.selected && CARS.some((c) => c.id === raw.selected)) g.selected = raw.selected;
    if (raw.owned) for (const c of CARS) if (raw.owned[c.id]) g.owned[c.id] = true;
    g.owned.drifter = true;
    if (raw.cars) {
      for (const c of CARS) {
        const src = raw.cars[c.id];
        if (!src) continue;
        const dst = g.cars[c.id];
        for (const t of TUNING) {
          if (typeof src[t.key] === 'number') dst[t.key] = Math.max(0, Math.min(3, src[t.key] | 0));
        }
        if (typeof src.paint === 'string') dst.paint = src.paint;
        if (typeof src.glowColor === 'string') dst.glowColor = src.glowColor;
        dst.glow = !!src.glow;
      }
    }
  } catch { /* defekte Daten ignorieren */ }
  return g;
}

export function saveGarage(g) {
  try { localStorage.setItem(KEY, JSON.stringify(g)); } catch { /* voll oder gesperrt */ }
}

export function canAfford(g, price) { return price != null && g.cash >= price; }

export function buyCar(g, carId) {
  const car = CARS.find((c) => c.id === carId);
  if (!car || g.owned[carId] || g.cash < car.price) return false;
  g.cash -= car.price;
  g.owned[carId] = true;
  saveGarage(g);
  return true;
}

export function buyUpgrade(g, carId, key) {
  const t = g.cars[carId];
  if (!t) return false;
  const next = (t[key] | 0) + 1;
  const cost = upgradeCost(key, next);
  if (cost == null || g.cash < cost) return false;
  g.cash -= cost;
  t[key] = next;
  saveGarage(g);
  return true;
}

export function buyGlow(g, carId) {
  const t = g.cars[carId];
  if (!t || t.glow || g.cash < GLOW_PRICE) return false;
  g.cash -= GLOW_PRICE;
  t.glow = true;
  saveGarage(g);
  return true;
}

export function setPaint(g, carId, color) {
  const t = g.cars[carId];
  if (!t || t.paint === color) return false;
  if (g.cash < PAINT_PRICE) return false;
  g.cash -= PAINT_PRICE;
  t.paint = color;
  saveGarage(g);
  return true;
}

export function addCash(g, amount) {
  g.cash = Math.max(0, Math.round(g.cash + amount));
  saveGarage(g);
}
