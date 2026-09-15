// PIXEL DRIFT CITY - Top-Down-Drift-Simulator im GTA2-Look.
import { World, TILE, T, minimapCanvas } from './world.js';
import { MAPS, mapById } from './maps.js';
import { Car, PX_PER_M } from './car.js';
import { CARS, carById, buildSpec } from './cars.js';
import { loadGarage, saveGarage, addCash } from './garage.js';
import * as Settings from './settings.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { Menu } from './ui.js';
import { drawTextShadow, textWidth } from './font.js';
import { LightLayer, AMBIENT } from './light.js';
import { EgoView } from './ego.js';

// Sichtbarer Ausschnitt in Welt-Pixeln. Gezeichnet wird mit doppelter
// Aufloesung (RS), damit Fahrzeuge, Hindernisse und Licht doppelt so fein
// aufgeloest sein koennen wie die Kacheln der Welt.
const VIEW_W = 480, VIEW_H = 270;
export const RS = 2;
const CW = VIEW_W * RS, CH = VIEW_H * RS;

const screen = document.getElementById('screen');
screen.width = CW; screen.height = CH;
const ctx = screen.getContext('2d');
ctx.imageSmoothingEnabled = false;
const light = new LightLayer(CW, CH);
const ego = new EgoView(VIEW_W, VIEW_H);

const settings = Settings.load();
const garage = loadGarage();
const input = new Input(settings);
const sfx = new Sfx(settings);

const MAP_KEY = 'pdc_map_v1';
let world = new World(mapById(localStorage.getItem(MAP_KEY) || 'city'));
let mini = minimapCanvas(world);

const car = new Car(world.spawn.x, world.spawn.y, currentSpec());
car.reset(world.spawn.x, world.spawn.y, world.spawn.h);

const cam = { x: car.x, y: car.y, lookX: 0, lookY: 0, shake: 0 };
const particles = [];
const popups = [];
let skidPrev = null;
let lastCtl = null;   // letzte Fahrereingabe, fuer Brems- und Ruecklicht

const state = {
  score: 0, pending: 0, multiplier: 1,
  driftTime: 0, grace: 0, drifting: false,
  best: Number(localStorage.getItem('pdc_best') || 0),
  cones: 0, flash: 0, running: false,
  message: '', messageTime: 0,
};

function currentSpec() {
  const c = carById(garage.selected);
  return buildSpec(c, garage.cars[c.id], settings);
}

function refitCar() {
  car.applySpec(currentSpec());
}

// ------------------------------------------------------------------- Menue
const menu = new Menu({
  settings, garage,
  onChange: (key) => {
    if (key === 'driftIntensity' || key === 'gripGlobal') refitCar();
    if (key === 'pixelSnap') resize();
    if (key === 'shifterMode' || key === 'clutch' || key === 'showWheel' || key === 'showPedals') {
      input.syncVisibility();
      car.drivetrain.reset();
    }
    sfx.applySettings();
  },
  onCarChange: () => { refitCar(); },
  onMapChange: (id) => { loadMap(id); },
  mapId: () => world.map.id,
  tools: {
    addCash: (n) => { addCash(garage, n); },
    unlockAll: () => {
      for (const c of CARS) garage.owned[c.id] = true;
      saveGarage(garage);
    },
    maxTune: () => {
      const t = garage.cars[garage.selected];
      for (const k of ['engine', 'turbo', 'tires', 'chassis', 'gearbox']) t[k] = 3;
      t.glow = true;
      saveGarage(garage);
      refitCar();
    },
    resetCar: () => resetCar(),
    clearSkids: () => world.clearSkids(),
    resetScore: () => {
      state.score = 0; state.best = 0; state.cones = 0;
      localStorage.setItem('pdc_best', '0');
    },
    teleportArena: () => {
      const a = world.arena;
      if (!a) { say('KEINE ARENA AUF DIESER STRECKE'); return; }
      car.reset(a.x, a.y + a.r * 0.5, -Math.PI / 2);
      cam.x = car.x; cam.y = car.y; cam.lookX = 0; cam.lookY = 0;
    },
    status: () => ({
      cash: garage.cash, score: state.score, best: state.best, cones: state.cones,
      map: world.map.name, car: car.spec.name, kmh: Math.round(car.kmh),
    }),
  },
  onPlay: () => {
    state.running = true;
    document.getElementById('controls').classList.add('on');
    input.syncVisibility();
    sfx.start();
  },
});
menu.open('start');

// --------------------------------------------------------------- Kartenwahl
// Karte wechseln: Welt neu bauen, Auto und Kamera zuruecksetzen
function loadMap(id) {
  world = new World(mapById(id));
  mini = minimapCanvas(world);
  localStorage.setItem(MAP_KEY, id);
  skidPrev = null;
  particles.length = 0; popups.length = 0;
  loseCombo();
  car.reset(world.spawn.x, world.spawn.y, world.spawn.h);
  cam.x = car.x; cam.y = car.y; cam.lookX = 0; cam.lookY = 0;
  state.cones = 0;
  say(world.map.name);
}

// ---------------------------------------------------------------- Skalierung
function resize() {
  let w, h;
  const k = Math.floor(Math.min(innerWidth / CW, innerHeight / CH));
  if (settings.pixelSnap && k >= 1) {
    // ganzzahlige Vergroesserung: jeder Bildpunkt ist gleich gross, nichts flimmert
    w = CW * k; h = CH * k;
  } else {
    const f = Math.min(innerWidth / CW, innerHeight / CH);
    w = Math.round(CW * f); h = Math.round(CH * f);
  }
  screen.style.width = w + 'px';
  screen.style.height = h + 'px';
}
addEventListener('resize', resize);
resize();

// Auf Touchgeraeten soll das Bedienen der Steuerung nicht die Seite bewegen:
// kein Wischen, kein Zoomen, kein Kontextmenue. Im Menue bleibt Scrollen moeglich.
const inMenu = (el) => !!(el && el.closest && el.closest('#menu'));
addEventListener('touchmove', (e) => { if (!inMenu(e.target)) e.preventDefault(); }, { passive: false });
addEventListener('gesturestart', (e) => e.preventDefault());
addEventListener('gesturechange', (e) => e.preventDefault());
addEventListener('contextmenu', (e) => { if (!inMenu(e.target)) e.preventDefault(); });

// Dreimal kurz in die obere rechte Ecke tippen oeffnet das Werkzeugmenue
let cornerTaps = 0, cornerTime = 0;
addEventListener('pointerdown', (e) => {
  if (menu.isOpen || inMenu(e.target)) return;
  const inCorner = e.clientX > innerWidth * 0.80 && e.clientY < innerHeight * 0.20;
  const now = performance.now();
  if (!inCorner || now - cornerTime > 1400) { cornerTaps = inCorner ? 1 : 0; cornerTime = now; return; }
  cornerTime = now;
  if (++cornerTaps >= 3) {
    cornerTaps = 0;
    menu.open('tools');
    sfx.blip(880, 0.08);
  }
});
addEventListener('dblclick', (e) => { if (!inMenu(e.target)) e.preventDefault(); });

// --------------------------------------------------------------- Tasteneingabe
input.onKey = (code) => {
  if (code === 'Escape' || code === 'KeyP') {
    if (menu.isOpen) menu.close(); else menu.open();
    return;
  }
  if (menu.isOpen || !state.running) return;
  if (code === 'KeyR') resetCar();
  if (code === 'KeyC') cycleCar();
  if (code === 'KeyM') say(sfx.toggle() ? 'SOUND AN' : 'SOUND AUS');
  if (code === 'KeyK') { world.clearSkids(); say('SPUREN GELOESCHT'); }
  if (code === 'KeyV') {
    settings.view = settings.view ? 0 : 1;
    Settings.save(settings);
    say(settings.view ? 'EGO-KAMERA' : 'VERFOLGER-KAMERA');
  }
  if (code === 'KeyN') {
    const i = MAPS.findIndex((m) => m.id === world.map.id);
    loadMap(MAPS[(i + 1) % MAPS.length].id);
  }
};

function cycleCar() {
  const owned = CARS.filter((c) => garage.owned[c.id]);
  if (owned.length < 2) { say('NUR EIN AUTO - GARAGE BESUCHEN'); return; }
  const i = owned.findIndex((c) => c.id === garage.selected);
  garage.selected = owned[(i + 1) % owned.length].id;
  saveGarage(garage);
  refitCar();
  say(car.spec.name);
  sfx.blip(880);
}

function resetCar() {
  car.reset(world.spawn.x, world.spawn.y, world.spawn.h);
  cam.x = car.x; cam.y = car.y; cam.lookX = 0; cam.lookY = 0;
  loseCombo();
  say('RESET');
}

// naechstgelegene befahrbare Kachel suchen (Auto-Reset beim Festfahren)
function freeSpotNear(x, y) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  for (let r = 1; r < 14; r++) {
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        if (world.isRoadTile(tx + i, ty + j)) {
          return { x: (tx + i) * TILE + TILE / 2, y: (ty + j) * TILE + TILE / 2 };
        }
      }
    }
  }
  return { x: world.spawn.x, y: world.spawn.y };
}

function say(msg) { state.message = msg; state.messageTime = 1.8; }

// ------------------------------------------------------------------ Wertung
function bankCombo() {
  if (state.pending > 0) {
    const total = Math.round(state.pending * state.multiplier);
    state.score += total;
    addCash(garage, total);
    popups.push({ x: car.x, y: car.y - 14, life: 1.5, text: '+' + total, color: '#ffd96b' });
    if (state.score > state.best) {
      state.best = state.score;
      localStorage.setItem('pdc_best', String(state.best));
    }
    sfx.blip(520 + Math.min(600, state.multiplier * 90), 0.12);
  }
  state.pending = 0; state.multiplier = 1; state.driftTime = 0; state.grace = 0;
}

function loseCombo() {
  if (state.pending > 100) {
    popups.push({ x: car.x, y: car.y - 14, life: 1.2, text: 'CRASH!', color: '#ff5a3c' });
  }
  state.pending = 0; state.multiplier = 1; state.driftTime = 0; state.grace = 0;
}

function updateDrift(dt) {
  const slip = Math.abs(car.slip);
  const isDrift = slip > 0.19 && car.speed > 5.5;
  if (isDrift) {
    state.drifting = true;
    state.grace = 0.9;
    state.driftTime += dt;
    state.pending += car.speed * slip * 26 * dt;
    state.multiplier = Math.min(10, 1 + Math.floor(state.driftTime / 1.6));
  } else if (state.grace > 0) {
    state.grace -= dt;
    state.drifting = false;
    if (state.grace <= 0) bankCombo();
  } else {
    state.drifting = false;
  }
}

// ----------------------------------------------------------------- Partikel
function addSmoke(x, y, color, power) {
  if (particles.length > 420 || settings.particles <= 0) return;
  const p = {
    x, y,
    vx: (Math.random() - 0.5) * 12 - car.vxWorld * 1.2,
    vy: (Math.random() - 0.5) * 12 - car.vyWorld * 1.2,
    r: 1.5 + Math.random() * 2, grow: 7 + power * 8,
    life: 0.5 + Math.random() * 0.5 + power * 0.4, max: 1, color, air: true,
  };
  p.max = p.life;
  particles.push(p);
}

function addSpark(x, y, n, color) {
  n = Math.round(n * settings.particles);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = 20 + Math.random() * 90;
    particles.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      r: 1, grow: 0, life: 0.25 + Math.random() * 0.35, max: 0.6, color, air: false,
    });
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= Math.pow(0.25, dt); p.vy *= Math.pow(0.25, dt);
    p.r += p.grow * dt;
  }
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    p.life -= dt; p.y -= 14 * dt;
    if (p.life <= 0) popups.splice(i, 1);
  }
}

// ---------------------------------------------------------------- Skidmarks
function paintSkids() {
  const wheels = car.wheelPositions();
  const slip = Math.abs(car.slip);
  const hb = input.handbrake;
  const intensity = Math.min(1, slip / 0.65) * Math.min(1, car.speed / 8)
    + (hb && car.speed > 2 ? 0.55 : 0) + car.wheelSpin * 0.7;
  const surf = world.surfaceAt(car.x, car.y);

  if (intensity > 0.14) {
    if (settings.skidmarks) {
      const g = world.skid.ctx;
      g.lineCap = 'round';
      for (let i = 0; i < wheels.length; i++) {
        const w = wheels[i];
        if (!w.rear && intensity < 0.55) continue;
        const p = skidPrev && skidPrev[i];
        if (!p || Math.hypot(w.x - p.x, w.y - p.y) >= 30) continue;
        // breiter, blasser Abrieb und darin ein dunkler Kern
        g.lineWidth = 3.2;
        g.strokeStyle = `rgba(18,16,20,${Math.min(0.34, 0.1 + intensity * 0.2)})`;
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(w.x, w.y); g.stroke();
        g.lineWidth = 1.6;
        g.strokeStyle = `rgba(10,9,12,${Math.min(0.62, 0.22 + intensity * 0.36)})`;
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(w.x, w.y); g.stroke();
      }
    }
    if (Math.random() < Math.min(1, intensity * 1.6) * settings.particles) {
      const w = wheels[2 + (Math.random() < 0.5 ? 0 : 1)];
      addSmoke(w.x, w.y, surf.dust, intensity);
    }
  }
  skidPrev = wheels;
}

// -------------------------------------------------------------------- Props
function updateProps(dt) {
  for (const p of world.props) {
    if (p.hit > 0) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= Math.pow(0.1, dt); p.vy *= Math.pow(0.1, dt);
      p.hit = Math.max(0, p.hit - dt * 0.35);
      continue;
    }
    const dx = p.x - car.x, dy = p.y - car.y;
    if (Math.abs(dx) > 22 || Math.abs(dy) > 22) continue;
    if (Math.hypot(dx, dy) > 11) continue;

    p.hit = 1;
    const sp = Math.max(30, car.speed * PX_PER_M * 0.8);
    const l = Math.hypot(dx, dy) || 1;
    p.vx = (dx / l) * sp; p.vy = (dy / l) * sp;
    state.cones++;
    const pts = Math.round(150 * (state.drifting ? state.multiplier : 1));
    state.pending += 150;
    popups.push({ x: p.x, y: p.y, life: 1.0, text: '+' + pts, color: '#8ee6c8' });
    addSpark(p.x, p.y, 6, p.type === 'cone' ? '#ff8a3c' : '#c9c9d6');
    sfx.blip(300, 0.06);
  }
}

// ------------------------------------------------------------------- Update
let last = performance.now();
let skidFadeAcc = 0;

function frame(now) {
  let dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;

  const active = state.running && !menu.isOpen;
  input.update(active ? dt : 0);

  if (active) {
    const mode = Settings.shifterModeName(settings.shifterMode);
    const ctl = {
      throttle: input.throttle, brake: input.brake, steer: input.steer,
      handbrake: input.handbrake,
      clutch: settings.shifterMode === 2 && settings.clutch ? input.clutch : 0,
      mode,
    };
    lastCtl = ctl;

    const shift = input.takeShift();
    if (shift && mode === 'man') {
      if (shift > 0) car.drivetrain.shiftUp(); else car.drivetrain.shiftDown();
      sfx.blip(shift > 0 ? 440 : 330, 0.05);
    }

    const steps = 3, sdt = dt / steps;
    let impact = 0;
    for (let i = 0; i < steps; i++) impact = Math.max(impact, car.update(sdt, ctl, world, settings));

    if (impact > 0) {
      cam.shake = Math.min(7, impact * 0.9) * settings.shake;
      sfx.crash(impact);
      addSpark(car.x + Math.cos(car.heading) * 12, car.y + Math.sin(car.heading) * 12, 10, '#ffd96b');
      if (impact > 3) loseCombo();
      state.flash = 0.12;
    }

    updateDrift(dt);
    paintSkids();
    updateProps(dt);
    input.setGearLabel(car.tele.gearLabel);

    if (settings.autoReset && car.stuckTime > 2.5) {
      const spot = freeSpotNear(car.x, car.y);
      car.reset(spot.x, spot.y, car.heading);
      say('FREIGESETZT');
    }

    skidFadeAcc += dt;
    if (settings.skidFade && skidFadeAcc > 1.2) { world.fadeSkids(); skidFadeAcc = 0; }

    const squeal = Math.min(1, Math.max(0, (Math.abs(car.slip) - 0.14) * 2.2)
      * Math.min(1, car.speed / 7) + car.wheelSpin * 0.6);
    sfx.update(car.rpmFrac, input.throttle, squeal, car.tele.limiter);
  } else {
    sfx.update(0, 0, 0, false);
  }

  updateParticles(active ? dt : 0);
  updateWeather(active ? dt : 0);

  // Vorausschau erst glaetten - im Drift schwenkt der Geschwindigkeitsvektor
  // so schnell, dass die Kamera sonst hin und her schaukelt.
  const lk = 1 - Math.pow(0.12, dt);
  cam.lookX += (car.vxWorld * 3.2 - cam.lookX) * lk;
  cam.lookY += (car.vyWorld * 3.2 - cam.lookY) * lk;
  const k = 1 - Math.pow(0.0015, dt);
  cam.x += (car.x + cam.lookX - cam.x) * k;
  cam.y += (car.y + cam.lookY - cam.y) * k;
  cam.shake *= Math.pow(0.02, dt);
  state.flash = Math.max(0, state.flash - dt);
  state.messageTime = Math.max(0, state.messageTime - dt);

  render();
  input.drawWheel(car.slip, input.handbrake);
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------- Wetter
const drops = [];
for (let i = 0; i < 300; i++) {
  drops.push({
    x: Math.random() * VIEW_W, y: Math.random() * VIEW_H,
    v: 0.6 + Math.random() * 0.7, sway: Math.random() * Math.PI * 2,
  });
}
const splashes = [];

function updateWeather(dt) {
  const mode = settings.weather;
  if (!mode) return;
  const rain = mode === 1;
  for (const d of drops) {
    if (rain) {
      d.y += (620 + d.v * 260) * dt;
      d.x -= (110 + d.v * 60) * dt;
    } else {
      d.sway += dt * 2.2;
      d.y += (44 + d.v * 40) * dt;
      d.x += Math.sin(d.sway) * 22 * dt;
    }
    if (d.y > VIEW_H) { d.y -= VIEW_H + 8; d.x = Math.random() * VIEW_W; }
    if (d.x < -8) d.x += VIEW_W + 8;
    if (d.x > VIEW_W + 8) d.x -= VIEW_W + 8;
  }
  if (rain) {
    for (let i = 0; i < 3; i++) {
      splashes.push({ x: Math.random() * VIEW_W, y: Math.random() * VIEW_H, life: 0.22 });
    }
  }
  for (let i = splashes.length - 1; i >= 0; i--) {
    splashes[i].life -= dt;
    if (splashes[i].life <= 0) splashes.splice(i, 1);
  }
}

// Niederschlag liegt im Bildschirmraum, deshalb ohne Kameratransformation
function drawWeather() {
  const mode = settings.weather;
  if (!mode) return;
  if (mode === 1) {
    ctx.strokeStyle = 'rgba(186,212,240,.34)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const d of drops) {
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x + 2.5, d.y - 9);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(200,225,245,.3)';
    for (const sp of splashes) {
      const r = (1 - sp.life / 0.22) * 3 + 1;
      ctx.fillRect(sp.x - r, sp.y, r * 2, 1);
    }
  } else {
    ctx.fillStyle = 'rgba(240,246,255,.75)';
    for (const d of drops) {
      const s = d.v > 1.05 ? 2 : 1;
      ctx.fillRect(Math.round(d.x), Math.round(d.y), s, s);
    }
  }
}

// Farbstimmung: kuehle Schatten oben, warme Lichter unten, leicht mehr Tiefe
let gradeCache = null;
function paintGrade() {
  if (!gradeCache) {
    gradeCache = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    gradeCache.addColorStop(0, 'rgba(70,110,180,.20)');
    gradeCache.addColorStop(0.5, 'rgba(128,128,128,.04)');
    gradeCache.addColorStop(1, 'rgba(255,168,96,.18)');
  }
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = gradeCache;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgba(255,244,230,.10)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.restore();
}

// ---------------------------------------------------------------- Rendering
function render() {
  if (settings.view === 1) { renderEgo(); return; }
  renderChase();
}

// ------------------------------------------------------------ Ego-Perspektive
function renderEgo() {
  const amb = settings.daytime;
  // leichtes Nicken und Wanken, damit die Sicht lebendig wirkt
  const bob = Math.sin(performance.now() / 260) * 0.25 + Math.min(2, car.speed * 0.02);
  ego.setCamera(car, bob);

  ctx.setTransform(RS, 0, 0, RS, 0, 0);
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  ego.drawSky(ctx, amb, settings.weather);
  ego.drawGround(ctx, world, RS, settings.skidmarks);
  ctx.setTransform(RS, 0, 0, RS, 0, 0);
  ego.drawFog(ctx, amb, settings.weather);
  ego.drawBuildings(ctx, world);
  ego.drawProps(ctx, world);
  if (settings.headlights) ego.drawHeadlights(ctx, amb);

  // Umgebungslicht als flacher Durchgang - die Lichtkarte der Aufsicht passt
  // in dieser Projektion nicht
  if (amb > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = AMBIENT[amb];
    ctx.fillRect(0, ego.horizon, VIEW_W, VIEW_H - ego.horizon);
    ctx.restore();
  }

  ego.drawCockpit(ctx, car, input.steer, lastCtl && (lastCtl.brake > 0 || lastCtl.handbrake > 0));

  drawWeather();
  if (settings.grade) paintGrade();
  if (state.flash > 0) {
    ctx.fillStyle = `rgba(255,220,160,${state.flash * 1.6})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  if (settings.scanlines) {
    ctx.fillStyle = 'rgba(0,0,0,.16)';
    for (let y = 0; y < VIEW_H; y += 2) ctx.fillRect(0, y, VIEW_W, 1);
  }
  drawHud();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function renderChase() {
  const z = settings.zoom;
  const vw = VIEW_W / z, vh = VIEW_H / z;
  const shx = cam.shake ? (Math.random() - 0.5) * cam.shake : 0;
  const shy = cam.shake ? (Math.random() - 0.5) * cam.shake : 0;
  // Auf ganze Bildpunkte einrasten: wird die Welt an gebrochenen Positionen
  // abgetastet, zittert bei jeder Bewegung das gesamte Kachelbild.
  const snap = z * RS;
  const ox = Math.round(clamp(cam.x - vw / 2 + shx, 0, Math.max(0, world.worldW - vw)) * snap) / snap;
  const oy = Math.round(clamp(cam.y - vh / 2 + shy, 0, Math.max(0, world.worldH - vh)) * snap) / snap;

  ctx.clearRect(0, 0, CW, CH);
  ctx.drawImage(world.canvas, ox, oy, vw, vh, 0, 0, CW, CH);
  ctx.drawImage(world.skid.canvas, ox, oy, vw, vh, 0, 0, CW, CH);

  ctx.save();
  ctx.scale(z * RS, z * RS);
  ctx.translate(-ox, -oy);

  if (world.hasWater) drawWaterWaves(ox, oy, vw, vh);

  for (const p of world.props) {
    if (p.x < ox - 8 || p.y < oy - 8 || p.x > ox + vw + 8 || p.y > oy + vh + 8) continue;
    drawProp(ctx, p);
  }
  for (const p of particles) if (!p.air) drawParticle(ctx, p);

  if (settings.underglow && car.spec.glow) drawUnderglow(ctx);

  drawCar3D(ctx, ox, oy, vw, vh);

  for (const p of particles) if (p.air) drawParticle(ctx, p);

  if (settings.parallax > 0) drawBuildings(ctx, ox, oy, vw, vh);

  for (const p of popups) {
    ctx.globalAlpha = Math.min(1, p.life / 0.4);
    drawTextShadow(ctx, p.text, p.x - textWidth(p.text, 1) / 2, p.y, 1, p.color);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  if (settings.daytime > 0) paintLights(z, ox, oy);

  ctx.save();
  ctx.scale(RS, RS);
  drawWeather();
  if (settings.grade) paintGrade();

  if (settings.vignette) {
    const grd = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.35,
                                         VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.85);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,.45)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  if (state.flash > 0) {
    ctx.fillStyle = `rgba(255,220,160,${state.flash * 1.6})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  if (settings.scanlines) {
    ctx.fillStyle = 'rgba(0,0,0,.16)';
    for (let y = 0; y < VIEW_H; y += 2) ctx.fillRect(0, y, VIEW_W, 1);
  }

  drawHud();
  ctx.restore();
}

// Lichtkarte aufbauen: Laternen, Fenster, Scheinwerfer, Brems- und Neonlicht
function paintLights(z, ox, oy) {
  const vw = VIEW_W / z, vh = VIEW_H / z;
  light.begin();
  light.setTransform(z * RS, ox, oy);

  if (settings.cityLights) {
    for (const L of world.lights) {
      if (L.x < ox - L.r || L.y < oy - L.r || L.x > ox + vw + L.r || L.y > oy + vh + L.r) continue;
      light.point(L.x, L.y, L.r, L.color, L.intensity);
    }
  }

  const s = car.spec;
  const cs = Math.cos(car.heading), sn = Math.sin(car.heading);
  // schwaches Eigenlicht, damit das Auto im Dunkeln lesbar bleibt
  light.point(car.x, car.y, s.len * 1.7, '#aab6de', 0.34);
  if (settings.headlights) {
    const bx = car.x + cs * s.len * 0.45, by = car.y + sn * s.len * 0.45;
    light.cone(bx, by, car.heading, 78, '#ffeec4', 0.9);
    light.point(bx, by, 16, '#ffeec4', 0.5);
  }
  const braking = lastCtl && (lastCtl.brake > 0 || lastCtl.handbrake > 0);
  const rx = car.x - cs * s.len * 0.5, ry = car.y - sn * s.len * 0.5;
  light.point(rx, ry, braking ? 22 : 12, '#ff3b2e', braking ? 0.95 : 0.35);

  if (settings.underglow && s.glow) {
    const pulse = settings.glowPulse ? 0.8 + 0.2 * Math.sin(performance.now() / 260) : 1;
    light.point(car.x, car.y, s.len * 1.15, s.glowColor, 0.8 * pulse);
  }
  light.composite(ctx, AMBIENT[settings.daytime], settings.bloom);
  if (settings.weather === 1) light.wetReflection(ctx, 0.16);
}

// Das Auto wird genauso aufgebaut wie die Haeuser: Grundriss am Boden, die
// Karosserie darueber, dazwischen die Seitenflaechen. Weil die Kamera dem Wagen
// vorausblickt, sitzt er selten genau in der Bildmitte - dadurch sieht man im
// Fahrbetrieb tatsaechlich die Flanken.
function drawCar3D(g, ox, oy, vw, vh) {
  const s = car.spec;
  const height = 7.5 * settings.carDepth;
  const camCX = ox + vw / 2, camCY = oy + vh / 2;
  const px = (car.x - camCX) / (vw / 2);
  const py = (car.y - camCY) / (vh / 2);
  const k = settings.parallax * height;
  const dx = px * k, dy = py * k;

  car.drawShadow(g, 2.5 + dx * 0.5, 3.5 + dy * 0.5);
  car.drawWheels(g);

  if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) {
    const c = car.corners();
    const dark = shadeHex(s.body, -0.5);
    const mid = shadeHex(s.body, -0.32);
    for (let i = 0; i < 4; i++) {
      const p0 = c[i], p1 = c[(i + 1) % 4];
      const mx = (p0.x + p1.x) / 2 - car.x, my = (p0.y + p1.y) / 2 - car.y;
      if (mx * dx + my * dy <= 0) continue;          // Flanke zeigt zur Kamera
      g.fillStyle = i % 2 ? mid : dark;
      g.beginPath();
      g.moveTo(p0.x, p0.y);
      g.lineTo(p1.x, p1.y);
      g.lineTo(p1.x + dx, p1.y + dy);
      g.lineTo(p0.x + dx, p0.y + dy);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(0,0,0,.22)';               // Verschattung am Fuss
      g.beginPath();
      g.moveTo(p0.x, p0.y);
      g.lineTo(p1.x, p1.y);
      g.lineTo(p1.x + dx * 0.4, p1.y + dy * 0.4);
      g.lineTo(p0.x + dx * 0.4, p0.y + dy * 0.4);
      g.closePath();
      g.fill();
    }
  }
  car.drawBody(g, dx, dy, lastCtl);
}

function shadeHex(hex, amt) {
  if (hex[0] !== '#') return hex;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  const f = (v) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  return `rgb(${f(r)},${f(gg)},${f(b)})`;
}

// Haeuser mit Hoehe: die Waende neigen sich von der Bildmitte weg, genau wie
// im Vorbild. Die Dachflaeche liegt als eigene Ebene bereit und wird nur
// versetzt kopiert; die Waende entstehen pro Bild aus wenigen Flaechen.
function drawBuildings(g, ox, oy, vw, vh) {
  const camCX = ox + vw / 2, camCY = oy + vh / 2;
  const k = settings.parallax;
  const list = [];
  for (const b of world.buildings) {
    if (b.x > ox + vw + 80 || b.y > oy + vh + 80 ||
        b.x + b.w < ox - 80 || b.y + b.h < oy - 80) continue;
    const px = (b.cx - camCX) / (vw / 2);
    const py = (b.cy - camCY) / (vh / 2);
    b._dx = px * b.height * k;
    b._dy = py * b.height * k;
    b._d = px * px + py * py;
    list.push(b);
  }
  list.sort((a, b) => b._d - a._d);          // aussen liegende zuerst
  for (const b of list) drawBuilding(g, b);
}

function drawBuilding(g, b) {
  const dx = b._dx, dy = b._dy;
  const x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;

  // Sockel: schliesst die Luecke, die entsteht wenn das Dach wegwandert
  g.fillStyle = b.wallB;
  g.fillRect(x0, y0, b.w, b.h);

  // senkrechte Wand (links oder rechts)
  if (Math.abs(dx) > 0.4) {
    const ex = dx > 0 ? x1 : x0;
    g.fillStyle = dx > 0 ? b.wallB : b.wallA;
    g.beginPath();
    g.moveTo(ex, y0); g.lineTo(ex, y1);
    g.lineTo(ex + dx, y1 + dy); g.lineTo(ex + dx, y0 + dy);
    g.closePath(); g.fill();
    wallWindows(g, b, ex, y0, 0, y1 - y0, dx, dy);
  }
  // waagerechte Wand (oben oder unten)
  if (Math.abs(dy) > 0.4) {
    const ey = dy > 0 ? y1 : y0;
    g.fillStyle = dy > 0 ? b.wallB : b.wallA;
    g.beginPath();
    g.moveTo(x0, ey); g.lineTo(x1, ey);
    g.lineTo(x1 + dx, ey + dy); g.lineTo(x0 + dx, ey + dy);
    g.closePath(); g.fill();
    wallWindows(g, b, x0, ey, x1 - x0, 0, dx, dy);
  }

  // Sockelverschattung: unten an der Wand dunkler
  if (Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4) {
    g.save();
    g.globalAlpha = 0.28;
    g.fillStyle = '#000';
    if (Math.abs(dx) > 0.4) {
      const ex = dx > 0 ? x1 : x0;
      g.beginPath();
      g.moveTo(ex, y0); g.lineTo(ex, y1);
      g.lineTo(ex + dx * 0.35, y1 + dy * 0.35); g.lineTo(ex + dx * 0.35, y0 + dy * 0.35);
      g.closePath(); g.fill();
    }
    if (Math.abs(dy) > 0.4) {
      const ey = dy > 0 ? y1 : y0;
      g.beginPath();
      g.moveTo(x0, ey); g.lineTo(x1, ey);
      g.lineTo(x1 + dx * 0.35, ey + dy * 0.35); g.lineTo(x0 + dx * 0.35, ey + dy * 0.35);
      g.closePath(); g.fill();
    }
    g.restore();
  }

  // Dachflaeche versetzt kopieren, danach eine Kante fuer klare Silhouette
  g.drawImage(world.roofCanvas, b.x, b.y, b.w, b.h, b.x + dx, b.y + dy, b.w, b.h);
  g.strokeStyle = 'rgba(0,0,0,.4)';
  g.lineWidth = 1;
  g.strokeRect(Math.round(b.x + dx) + 0.5, Math.round(b.y + dy) + 0.5, b.w - 1, b.h - 1);
}

// Fensterraster auf der geneigten Wand - zwei Reihen entlang der Neigung
function wallWindows(g, b, ax, ay, spanX, spanY, dx, dy) {
  const span = Math.max(Math.abs(spanX), Math.abs(spanY));
  if (span < 12 || (Math.abs(dx) + Math.abs(dy)) < 3) return;
  const step = 8;
  const night = settings.daytime > 0;
  for (let i = 6; i < span - 4; i += step) {
    const bx = ax + (spanX ? i : 0);
    const by = ay + (spanY ? i : 0);
    for (const f of [0.3, 0.58, 0.86]) {
      const h = hash2(b.winSeed, i * 7 + f * 100);
      const on = night && h < b.winLit;
      const wx = Math.round(bx + dx * f) - 1, wy = Math.round(by + dy * f) - 1;
      g.fillStyle = on ? '#ffd792' : 'rgba(10,12,20,.55)';
      g.fillRect(wx, wy, 3, 3);
      g.fillStyle = on ? 'rgba(255,240,200,.7)' : 'rgba(255,255,255,.10)';
      g.fillRect(wx, wy, 3, 1);
    }
  }
}

function hash2(a, b) {
  let t = (a * 374761393 + b * 668265263) | 0;
  t = (t ^ (t >>> 13)) * 1274126177;
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

// Wellen auf dem Wasser: zwei wandernde Striche je sichtbarer Wasserkachel
function drawWaterWaves(ox, oy, vw, vh) {
  const t = performance.now() / 1000;
  const x0 = Math.max(0, Math.floor(ox / TILE)), x1 = Math.min(world.w, Math.ceil((ox + vw) / TILE));
  const y0 = Math.max(0, Math.floor(oy / TILE)), y1 = Math.min(world.h, Math.ceil((oy + vh) / TILE));
  ctx.fillStyle = 'rgba(200,232,252,.16)';
  for (let ty = y0; ty < y1; ty++) {
    for (let tx = x0; tx < x1; tx++) {
      if (world.get(tx, ty) !== T.WATER) continue;
      const px = tx * TILE, py = ty * TILE;
      const phase = (tx * 0.7 + ty * 1.3);
      const a = ((t * 7 + phase * 5) % 16);
      const b2 = ((t * 5 + phase * 9 + 8) % 16);
      ctx.fillRect(px + 2 + Math.sin(t * 2 + phase) * 2, py + a, 6, 1);
      ctx.fillRect(px + 8 + Math.cos(t * 1.6 + phase) * 2, py + b2, 4, 1);
    }
  }
}

function drawUnderglow(g) {
  const s = car.spec;
  const pulse = settings.glowPulse ? 0.78 + 0.22 * Math.sin(performance.now() / 260) : 1;
  const r = s.len * 0.95;
  const grd = g.createRadialGradient(car.x, car.y, 2, car.x, car.y, r);
  grd.addColorStop(0, hexA(s.glowColor, 0.55 * pulse));
  grd.addColorStop(0.45, hexA(s.glowColor, 0.26 * pulse));
  grd.addColorStop(1, hexA(s.glowColor, 0));
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = grd;
  g.fillRect(car.x - r, car.y - r, r * 2, r * 2);
  g.restore();
}

// weiche Wolke je Farbe, einmal vorgerendert
const puffCache = new Map();
function puffSprite(color) {
  let c = puffCache.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(16, 16, 1, 16, 16, 16);
  grd.addColorStop(0, hexA(color, 0.85));
  grd.addColorStop(0.45, hexA(color, 0.42));
  grd.addColorStop(1, hexA(color, 0));
  g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
  puffCache.set(color, c);
  return c;
}

function drawParticle(g, p) {
  const a = Math.max(0, p.life / p.max);
  const r = Math.max(1, p.r);
  if (p.air) {
    g.globalAlpha = a * 0.5;
    g.drawImage(puffSprite(p.color), p.x - r * 1.6, p.y - r * 1.6, r * 3.2, r * 3.2);
  } else {
    g.globalAlpha = Math.min(1, a * 1.3);
    g.fillStyle = p.color;
    g.fillRect(Math.round(p.x - r), Math.round(p.y - r), Math.round(r * 2), Math.round(r * 2));
  }
  g.globalAlpha = 1;
}

function drawProp(g, p) {
  const x = p.x, y = p.y;
  const down = p.hit > 0;

  // Schlagschatten
  g.fillStyle = 'rgba(0,0,0,.4)';
  g.beginPath();
  g.ellipse(x + 1.6, y + 1.8, down ? 4.6 : 3.4, down ? 2.6 : 2.4, 0, 0, Math.PI * 2);
  g.fill();

  if (p.type === 'cone') {
    if (down) {                                   // umgefahren: liegt flach
      g.fillStyle = '#b8581f'; g.fillRect(x - 4, y - 1.5, 8, 3);
      g.fillStyle = '#e9e9f0'; g.fillRect(x - 0.5, y - 1.5, 2, 3);
      g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x - 4, y + 1, 8, 0.5);
      return;
    }
    // Fuss
    g.fillStyle = '#b3541f';
    g.fillRect(x - 3.5, y - 3.5, 7, 7);
    g.fillStyle = '#c96227';
    g.fillRect(x - 3.5, y - 3.5, 7, 1);
    // Kegelkoerper, nach oben schmaler
    g.fillStyle = '#e9762c';
    g.fillRect(x - 2.5, y - 2.5, 5, 5);
    g.fillStyle = '#ff9448';
    g.fillRect(x - 2.5, y - 2.5, 2, 5);           // Lichtseite
    g.fillStyle = '#f4f4fa';
    g.fillRect(x - 2.5, y - 1, 5, 1.5);           // Reflexband
    g.fillStyle = 'rgba(255,255,255,.5)';
    g.fillRect(x - 1.2, y - 1.2, 2.4, 2.4);       // Spitze
  } else {
    // Fass mit Deckelring
    g.fillStyle = down ? '#4f5a66' : '#78838f';
    g.beginPath(); g.arc(x, y, 3.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = down ? '#5d6874' : '#94a0ad';
    g.beginPath(); g.arc(x - 0.5, y - 0.5, 2.8, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c0392b';
    g.fillRect(x - 3.4, y - 1, 6.8, 2);
    g.fillStyle = 'rgba(255,255,255,.28)';
    g.fillRect(x - 3.4, y - 1, 6.8, 0.6);
    g.fillStyle = 'rgba(0,0,0,.3)';
    g.beginPath(); g.arc(x, y, 1.2, 0, Math.PI * 2); g.fill();
  }
}

// -------------------------------------------------------------------- HUD
function drawHud() {
  const cxHud = VIEW_W / 2;
  const withGears = settings.shifterMode !== 0;

  // Tacho mittig unten
  const kmhTxt = String(Math.round(car.kmh));
  const kmhW = textWidth(kmhTxt, 3), unitW = textWidth('KM/H', 1);
  const grpX = cxHud - (kmhW + 4 + unitW) / 2;
  drawTextShadow(ctx, kmhTxt, grpX, VIEW_H - 24, 3, '#ffd96b');
  drawTextShadow(ctx, 'KM/H', grpX + kmhW + 4, VIEW_H - 14, 1, '#b9b9cf');

  // Drehzahlband (mit Getriebe: echte Drehzahl, sonst Tempo)
  const barW = 90, barX = cxHud - barW / 2, barY = VIEW_H - 34;
  const fill = withGears ? Math.min(1, car.rpmFrac) : Math.min(1, car.kmh / 190);
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(barX - 1, barY - 1, barW + 2, 6);
  for (let i = 0; i < barW; i += 3) {
    const f = i / barW;
    if (f > fill) break;
    ctx.fillStyle = f > 0.88 ? '#ff5a3c' : f > 0.65 ? '#ffd96b' : '#8ee6c8';
    ctx.fillRect(barX + i, barY, 2, 4);
  }
  if (car.tele.limiter) {
    drawTextShadow(ctx, 'LIMIT', barX + barW + 5, barY - 1, 1, '#ff5a3c');
  }

  if (withGears) {
    // Gang links neben dem Tacho
    const gl = car.tele.gearLabel;
    drawTextShadow(ctx, gl, barX - textWidth(gl, 3) - 10, VIEW_H - 26, 3,
      car.tele.shifting ? '#8b8ba6' : '#f2f2f6');
    drawTextShadow(ctx, 'GANG', barX - textWidth('GANG', 1) - 10, VIEW_H - 9, 1, '#8b8ba6');

    // Ladedruck
    if (car.spec.turboLevel > 0) {
      const bw = 40, bx = barX + barW + 8, by = VIEW_H - 24;
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(bx - 1, by - 1, bw + 2, 5);
      ctx.fillStyle = '#4ad6ff';
      ctx.fillRect(bx, by, Math.round(bw * Math.min(1, car.tele.boost)), 3);
      drawTextShadow(ctx, 'TURBO', bx, by + 6, 1, '#8b8ba6');
    }
  }

  // Score / Geld
  drawTextShadow(ctx, 'SCORE ' + state.score, 8, 8, 2, '#f2f2f6');
  drawTextShadow(ctx, 'BEST ' + state.best, 8, 22, 1, '#8ee6c8');
  drawTextShadow(ctx, 'CASH ' + garage.cash, 8, 31, 1, '#ffd96b');
  drawTextShadow(ctx, car.spec.name, 8, 40, 1, '#b9b9cf');

  // Drift-Combo
  if (state.pending > 0) {
    const txt = Math.round(state.pending) + ' X' + state.multiplier;
    const scale = state.drifting ? 2 : 1;
    const w = textWidth(txt, scale);
    ctx.globalAlpha = state.drifting ? 1 : Math.max(0.25, state.grace / 0.9);
    const col = state.multiplier >= 6 ? '#ff5a3c' : state.multiplier >= 3 ? '#ffd96b' : '#8ee6c8';
    drawTextShadow(ctx, txt, (VIEW_W - w) / 2, 12, scale, col);
    if (state.drifting) {
      drawTextShadow(ctx, 'DRIFT', (VIEW_W - textWidth('DRIFT', 1)) / 2, 30, 1, col);
      const cw = 90, cx = (VIEW_W - cw) / 2;
      ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(cx, 40, cw, 3);
      ctx.fillStyle = col; ctx.fillRect(cx, 40, cw * ((state.driftTime % 1.6) / 1.6), 3);
    }
    ctx.globalAlpha = 1;
  }

  // Minimap
  if (settings.minimap) {
    const mw = 72, mx = VIEW_W - mw - 8, my = 8;
    ctx.fillStyle = 'rgba(8,8,14,.75)';
    ctx.fillRect(mx - 2, my - 2, mw + 4, mw + 4);
    ctx.drawImage(mini, 0, 0, mini.width, mini.height, mx, my, mw, mw);
    ctx.fillStyle = '#ffd96b';
    ctx.fillRect(Math.round(mx + (car.x / world.worldW) * mw) - 1,
                 Math.round(my + (car.y / world.worldH) * mw) - 1, 3, 3);
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1;
    ctx.strokeRect(mx - 1.5, my - 1.5, mw + 3, mw + 3);
    drawTextShadow(ctx, 'KEGEL ' + state.cones, mx, my + mw + 5, 1, '#b9b9cf');
  }

  if (input.handbrake) {
    drawTextShadow(ctx, 'HANDBREMSE', (VIEW_W - textWidth('HANDBREMSE', 1)) / 2, VIEW_H - 44, 1, '#ff5a3c');
  }
  if (state.messageTime > 0) {
    ctx.globalAlpha = Math.min(1, state.messageTime / 0.5);
    drawTextShadow(ctx, state.message, (VIEW_W - textWidth(state.message, 2)) / 2, VIEW_H - 62, 2, '#f2f2f6');
    ctx.globalAlpha = 1;
  }
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

requestAnimationFrame(frame);

// Debug-Zugriff aus der Konsole: __dbg.car, __dbg.state, __dbg.settings
window.__dbg = { car, state, input, settings, garage, menu, MAPS, loadMap, cam,
  get world() { return world; } };
