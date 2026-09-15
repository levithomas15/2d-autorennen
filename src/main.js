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

const VIEW_W = 480, VIEW_H = 270;

const screen = document.getElementById('screen');
const ctx = screen.getContext('2d');
ctx.imageSmoothingEnabled = false;

const settings = Settings.load();
const garage = loadGarage();
const input = new Input(settings);
const sfx = new Sfx(settings);

const MAP_KEY = 'pdc_map_v1';
let world = new World(mapById(localStorage.getItem(MAP_KEY) || 'city'));
let mini = minimapCanvas(world);

const car = new Car(world.spawn.x, world.spawn.y, currentSpec());
car.reset(world.spawn.x, world.spawn.y, world.spawn.h);

const cam = { x: car.x, y: car.y, shake: 0 };
const particles = [];
const popups = [];
let skidPrev = null;

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
    if (key === 'shifterMode' || key === 'clutch' || key === 'showWheel' || key === 'showPedals') {
      input.syncVisibility();
      car.drivetrain.reset();
    }
    sfx.applySettings();
  },
  onCarChange: () => { refitCar(); },
  onMapChange: (id) => { loadMap(id); },
  mapId: () => world.map.id,
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
  cam.x = car.x; cam.y = car.y;
  state.cones = 0;
  say(world.map.name);
}

// ---------------------------------------------------------------- Skalierung
function resize() {
  const s = Math.max(1, Math.floor(Math.min(innerWidth / VIEW_W, innerHeight / VIEW_H) * 2) / 2);
  screen.style.width = VIEW_W * s + 'px';
  screen.style.height = VIEW_H * s + 'px';
}
addEventListener('resize', resize);
resize();

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
  cam.x = car.x; cam.y = car.y;
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
      g.lineWidth = 2.5;
      g.strokeStyle = `rgba(14,12,16,${Math.min(0.7, 0.26 + intensity * 0.4)})`;
      for (let i = 0; i < wheels.length; i++) {
        const w = wheels[i];
        if (!w.rear && intensity < 0.55) continue;
        const p = skidPrev && skidPrev[i];
        if (p && Math.hypot(w.x - p.x, w.y - p.y) < 30) {
          g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(w.x, w.y); g.stroke();
        }
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

  const lookX = car.x + car.vxWorld * 3.2, lookY = car.y + car.vyWorld * 3.2;
  const k = 1 - Math.pow(0.0015, dt);
  cam.x += (lookX - cam.x) * k;
  cam.y += (lookY - cam.y) * k;
  cam.shake *= Math.pow(0.02, dt);
  state.flash = Math.max(0, state.flash - dt);
  state.messageTime = Math.max(0, state.messageTime - dt);

  render();
  input.drawWheel(car.slip, input.handbrake);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- Rendering
function render() {
  const z = settings.zoom;
  const vw = VIEW_W / z, vh = VIEW_H / z;
  const shx = cam.shake ? (Math.random() - 0.5) * cam.shake : 0;
  const shy = cam.shake ? (Math.random() - 0.5) * cam.shake : 0;
  const ox = clamp(cam.x - vw / 2 + shx, 0, Math.max(0, world.worldW - vw));
  const oy = clamp(cam.y - vh / 2 + shy, 0, Math.max(0, world.worldH - vh));

  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  ctx.drawImage(world.canvas, ox, oy, vw, vh, 0, 0, VIEW_W, VIEW_H);
  ctx.drawImage(world.skid.canvas, ox, oy, vw, vh, 0, 0, VIEW_W, VIEW_H);

  ctx.save();
  ctx.scale(z, z);
  ctx.translate(-ox, -oy);

  for (const p of world.props) {
    if (p.x < ox - 8 || p.y < oy - 8 || p.x > ox + vw + 8 || p.y > oy + vh + 8) continue;
    drawProp(ctx, p);
  }
  for (const p of particles) if (!p.air) drawParticle(ctx, p);

  if (settings.underglow && car.spec.glow) drawUnderglow(ctx);
  if (settings.headlights) drawHeadlights(ctx);

  ctx.save();
  ctx.globalAlpha = 0.32; ctx.fillStyle = '#000';
  ctx.translate(car.x + 2, car.y + 3); ctx.rotate(car.heading);
  ctx.fillRect(-car.spec.len / 2, -car.spec.wid / 2, car.spec.len, car.spec.wid);
  ctx.restore();
  car.draw(ctx);

  for (const p of particles) if (p.air) drawParticle(ctx, p);

  for (const p of popups) {
    ctx.globalAlpha = Math.min(1, p.life / 0.4);
    drawTextShadow(ctx, p.text, p.x - textWidth(p.text, 1) / 2, p.y, 1, p.color);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

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

function drawHeadlights(g) {
  const cs = Math.cos(car.heading), sn = Math.sin(car.heading);
  const bx = car.x + cs * (car.spec.len * 0.5), by = car.y + sn * (car.spec.len * 0.5);
  const len = 56, spread = 0.36;
  const grd = g.createRadialGradient(bx, by, 2, bx, by, len);
  grd.addColorStop(0, 'rgba(255,238,180,.16)');
  grd.addColorStop(0.55, 'rgba(255,232,165,.07)');
  grd.addColorStop(1, 'rgba(255,230,160,0)');
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(bx, by);
  g.lineTo(bx + Math.cos(car.heading - spread) * len, by + Math.sin(car.heading - spread) * len);
  g.lineTo(bx + Math.cos(car.heading + spread) * len, by + Math.sin(car.heading + spread) * len);
  g.closePath(); g.fill();
  g.restore();
}

function drawParticle(g, p) {
  const a = Math.max(0, p.life / p.max);
  g.globalAlpha = a * (p.air ? 0.45 : 0.9);
  g.fillStyle = p.color;
  const r = Math.max(1, p.r);
  g.fillRect(Math.round(p.x - r), Math.round(p.y - r), Math.round(r * 2), Math.round(r * 2));
  g.globalAlpha = 1;
}

function drawProp(g, p) {
  const x = Math.round(p.x), y = Math.round(p.y);
  const down = p.hit > 0;
  if (p.type === 'cone') {
    g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x - 2, y + 1, 5, 2);
    g.fillStyle = down ? '#b8552a' : '#ff8a3c';
    g.fillRect(x - 2, y - 2, 5, 4);
    g.fillStyle = '#f2f2f6'; g.fillRect(x - 2, y - 1, 5, 1);
  } else {
    g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x - 3, y + 2, 7, 2);
    g.fillStyle = down ? '#6d7a86' : '#9aa7b4';
    g.fillRect(x - 3, y - 3, 7, 7);
    g.fillStyle = '#d24a3a'; g.fillRect(x - 3, y - 1, 7, 2);
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
window.__dbg = { car, state, input, settings, garage, menu, MAPS, loadMap,
  get world() { return world; } };
