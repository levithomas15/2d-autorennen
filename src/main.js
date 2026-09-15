// PIXEL DRIFT CITY - Top-Down Drift-Simulator im GTA2-Look.
import { World, TILE, MAP_W, MAP_H, WORLD_W, WORLD_H, T } from './world.js';
import { Car, CAR_TYPES, PX_PER_M } from './car.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { drawText, drawTextShadow, textWidth } from './font.js';

const VIEW_W = 480, VIEW_H = 270;

const screen = document.getElementById('screen');
const ctx = screen.getContext('2d');
ctx.imageSmoothingEnabled = false;

const world = new World(20260915);
const input = new Input();
const sfx = new Sfx();

const spawn = { x: world.arena.x, y: world.arena.y + world.arena.r * 0.55, h: -Math.PI / 2 };
const car = new Car(spawn.x, spawn.y, 0);
car.reset(spawn.x, spawn.y, spawn.h);

const cam = { x: car.x, y: car.y, shake: 0 };
const particles = [];
const popups = [];

const state = {
  score: 0,
  pending: 0,
  multiplier: 1,
  driftTime: 0,
  grace: 0,
  drifting: false,
  best: Number(localStorage.getItem('pdc_best') || 0),
  topSpeed: 0,
  cones: 0,
  flash: 0,
  message: '',
  messageTime: 0,
  running: false,
};

// ------------------------------------------------------------------ Minimap
const miniScale = 1;
const mini = document.createElement('canvas');
mini.width = MAP_W * miniScale; mini.height = MAP_H * miniScale;
{
  const g = mini.getContext('2d');
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      const t = world.get(tx, ty);
      g.fillStyle =
        t === T.BUILDING ? '#2a2a34' :
        t === T.GRASS ? '#2f5136' :
        t === T.ARENA ? '#5a5a6e' :
        t === T.LOT ? '#3f3f4c' :
        t === T.SIDEWALK ? '#43434f' : '#6a6a80';
      g.fillRect(tx * miniScale, ty * miniScale, miniScale, miniScale);
    }
  }
}

// ------------------------------------------------------------------ Skalierung
function resize() {
  const pad = 0;
  const sx = (innerWidth - pad) / VIEW_W, sy = (innerHeight - pad) / VIEW_H;
  const s = Math.max(1, Math.floor(Math.min(sx, sy) * 2) / 2);   // halbe Stufen erlaubt
  screen.style.width = VIEW_W * s + 'px';
  screen.style.height = VIEW_H * s + 'px';
}
addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ Start/Keys
const overlay = document.getElementById('overlay');
const controls = document.getElementById('controls');

function startGame() {
  overlay.classList.add('hidden');
  controls.classList.add('on');
  state.running = true;
  sfx.start();
  say('LOS GEHTS!');
}
document.getElementById('startBtn').addEventListener('click', startGame);

input.onKey = (code) => {
  if (!state.running) {
    if (code === 'Enter' || code === 'Space') startGame();
    return;
  }
  if (code === 'KeyR') resetCar();
  if (code === 'KeyC') {
    car.setType(car.typeIndex + 1);
    say(car.spec.name);
    sfx.blip(880);
  }
  if (code === 'KeyM') say(sfx.toggle() ? 'SOUND AN' : 'SOUND AUS');
  if (code === 'KeyK') { world.clearSkids(); say('SPUREN GELOESCHT'); }
};

function resetCar() {
  car.reset(spawn.x, spawn.y, spawn.h);
  cam.x = car.x; cam.y = car.y;
  loseCombo();
  say('RESET');
}

function say(msg) { state.message = msg; state.messageTime = 1.8; }

// ------------------------------------------------------------------ Drift-Logik
function bankCombo() {
  if (state.pending > 0) {
    const total = Math.round(state.pending * state.multiplier);
    state.score += total;
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
  const speed = car.speed;
  const isDrift = slip > 0.19 && speed > 5.5;

  if (isDrift) {
    state.drifting = true;
    state.grace = 0.9;
    state.driftTime += dt;
    state.pending += speed * slip * 26 * dt;
    state.multiplier = Math.min(10, 1 + Math.floor(state.driftTime / 1.6));
  } else if (state.grace > 0) {
    state.grace -= dt;
    state.drifting = false;
    if (state.grace <= 0) bankCombo();
  } else {
    state.drifting = false;
  }
}

// ------------------------------------------------------------------ Partikel
function addSmoke(x, y, color, power) {
  if (particles.length > 420) return;
  particles.push({
    x, y,
    vx: (Math.random() - 0.5) * 12 - car.vxWorld * 1.2,
    vy: (Math.random() - 0.5) * 12 - car.vyWorld * 1.2,
    r: 1.5 + Math.random() * 2, grow: 7 + power * 8,
    life: 0.5 + Math.random() * 0.5 + power * 0.4, max: 1,
    color, air: true,
  });
  particles[particles.length - 1].max = particles[particles.length - 1].life;
}

function addSpark(x, y, n, color) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = 20 + Math.random() * 90;
    particles.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      r: 1, grow: 0, life: 0.25 + Math.random() * 0.35, max: 0.6,
      color, air: false,
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

// ------------------------------------------------------------------ Skidmarks
let skidPrev = null;
function paintSkids(dt) {
  const wheels = car.wheelPositions();
  const slip = Math.abs(car.slip);
  const hb = input.handbrake;
  const intensity = Math.min(1, slip / 0.65) * Math.min(1, car.speed / 8) + (hb && car.speed > 2 ? 0.55 : 0) + car.wheelSpin * 0.7;
  const surf = world.surfaceAt(car.x, car.y);

  if (intensity > 0.14) {
    const g = world.skid.ctx;
    g.lineCap = 'round';
    g.lineWidth = 2.5;
    g.strokeStyle = `rgba(14,12,16,${Math.min(0.7, 0.26 + intensity * 0.4)})`;
    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i];
      if (!w.rear && intensity < 0.55) continue;         // vorne erst bei starkem Drift
      if (skidPrev && skidPrev[i]) {
        const p = skidPrev[i];
        if (Math.hypot(w.x - p.x, w.y - p.y) < 30) {
          g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(w.x, w.y); g.stroke();
        }
      }
    }
    // Rauch an den durchdrehenden Raedern
    if (Math.random() < Math.min(1, intensity * 1.6)) {
      const w = wheels[2 + (Math.random() < 0.5 ? 0 : 1)];
      addSmoke(w.x, w.y, surf.dust, intensity);
    }
  }
  skidPrev = wheels;
}

// ------------------------------------------------------------------ Props
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
    if (car.speed > 3) { car.vLong *= 0.985; }
  }
}

// ------------------------------------------------------------------ Update
let last = performance.now();
let skidFadeAcc = 0;

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, 1 / 30);

  input.update(dt);

  if (state.running) {
    // Physik in festen Teilschritten -> stabiles Driftverhalten
    const steps = 3, sdt = dt / steps;
    let impact = 0;
    for (let i = 0; i < steps; i++) {
      impact = Math.max(impact, car.update(sdt, input, world));
    }
    if (impact > 0) {
      cam.shake = Math.min(7, impact * 0.9);
      sfx.crash(impact);
      addSpark(car.x + Math.cos(car.heading) * 12, car.y + Math.sin(car.heading) * 12, 10, '#ffd96b');
      if (impact > 3) loseCombo();
      state.flash = 0.12;
    }

    updateDrift(dt);
    paintSkids(dt);
    updateProps(dt);
    state.topSpeed = Math.max(state.topSpeed, car.kmh);

    skidFadeAcc += dt;
    if (skidFadeAcc > 1.2) { world.fadeSkids(); skidFadeAcc = 0; }

    const rpm = Math.min(1, car.kmh / 150) * 0.75 + car.wheelSpin * 0.25 + (input.throttle ? 0.12 : 0);
    const squeal = Math.min(1, Math.max(0, (Math.abs(car.slip) - 0.14) * 2.2) * Math.min(1, car.speed / 7) + car.wheelSpin * 0.6);
    sfx.update(Math.min(1, rpm), input.throttle, squeal);
  }

  updateParticles(dt);

  // Kamera mit Vorausschau in Fahrtrichtung
  const lookX = car.x + car.vxWorld * 3.2;
  const lookY = car.y + car.vyWorld * 3.2;
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

// ------------------------------------------------------------------ Rendering
function render() {
  const shx = cam.shake ? (Math.random() - 0.5) * cam.shake : 0;
  const shy = cam.shake ? (Math.random() - 0.5) * cam.shake : 0;
  let ox = Math.round(clamp(cam.x - VIEW_W / 2 + shx, 0, WORLD_W - VIEW_W));
  let oy = Math.round(clamp(cam.y - VIEW_H / 2 + shy, 0, WORLD_H - VIEW_H));

  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  ctx.drawImage(world.canvas, ox, oy, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);
  ctx.drawImage(world.skid.canvas, ox, oy, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);

  ctx.save();
  ctx.translate(-ox, -oy);

  // Props
  for (const p of world.props) {
    if (p.x < ox - 8 || p.y < oy - 8 || p.x > ox + VIEW_W + 8 || p.y > oy + VIEW_H + 8) continue;
    drawProp(ctx, p);
  }

  // Boden-Partikel (Funken)
  for (const p of particles) if (!p.air) drawParticle(ctx, p);

  // Fahrzeugschatten + Fahrzeug
  ctx.save();
  ctx.globalAlpha = 0.32; ctx.fillStyle = '#000';
  ctx.translate(car.x + 2, car.y + 3); ctx.rotate(car.heading);
  ctx.fillRect(-car.spec.len / 2, -car.spec.wid / 2, car.spec.len, car.spec.wid);
  ctx.restore();
  car.draw(ctx);

  // Rauch ueber dem Auto
  for (const p of particles) if (p.air) drawParticle(ctx, p);

  // Punkte-Popups
  for (const p of popups) {
    const a = Math.min(1, p.life / 0.4);
    ctx.globalAlpha = a;
    drawTextShadow(ctx, p.text, p.x - textWidth(p.text, 1) / 2, p.y, 1, p.color);
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  // Vignette fuer den Konsolen-Look
  const grd = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.35, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.85);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, 'rgba(0,0,0,.45)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  if (state.flash > 0) {
    ctx.fillStyle = `rgba(255,220,160,${state.flash * 1.6})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  drawHud();
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

function drawHud() {
  // --- Tacho mittig unten (links/rechts bleiben fuer Lenkrad und Pedale frei)
  const kmh = Math.round(car.kmh);
  const kmhTxt = String(kmh);
  const kmhW = textWidth(kmhTxt, 3), unitW = textWidth('KM/H', 1);
  const cxHud = VIEW_W / 2;
  const grpX = cxHud - (kmhW + 4 + unitW) / 2;
  drawTextShadow(ctx, kmhTxt, grpX, VIEW_H - 24, 3, '#ffd96b');
  drawTextShadow(ctx, 'KM/H', grpX + kmhW + 4, VIEW_H - 14, 1, '#b9b9cf');

  // Drehzahlbalken
  const barW = 74, barX = cxHud - barW / 2, barY = VIEW_H - 32;
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(barX - 1, barY - 1, barW + 2, 5);
  const fill = Math.min(1, car.kmh / 160);
  for (let i = 0; i < barW; i += 3) {
    if (i / barW > fill) break;
    ctx.fillStyle = i / barW > 0.82 ? '#ff5a3c' : i / barW > 0.6 ? '#ffd96b' : '#8ee6c8';
    ctx.fillRect(barX + i, barY, 2, 3);
  }

  // --- Score oben links
  drawTextShadow(ctx, 'SCORE ' + state.score, 8, 8, 2, '#f2f2f6');
  drawTextShadow(ctx, 'BEST ' + state.best, 8, 22, 1, '#8ee6c8');
  drawTextShadow(ctx, car.spec.name + ' [C]', 8, 31, 1, '#b9b9cf');

  // --- Drift-Combo mittig oben
  if (state.pending > 0) {
    const txt = Math.round(state.pending) + ' X' + state.multiplier;
    const scale = state.drifting ? 2 : 1;
    const w = textWidth(txt, scale);
    const alpha = state.drifting ? 1 : Math.max(0.25, state.grace / 0.9);
    ctx.globalAlpha = alpha;
    const col = state.multiplier >= 6 ? '#ff5a3c' : state.multiplier >= 3 ? '#ffd96b' : '#8ee6c8';
    drawTextShadow(ctx, txt, (VIEW_W - w) / 2, 12, scale, col);
    if (state.drifting) {
      drawTextShadow(ctx, 'DRIFT', (VIEW_W - textWidth('DRIFT', 1)) / 2, 30, 1, col);
      // Combo-Timer-Balken
      const cw = 90, cx = (VIEW_W - cw) / 2;
      const frac = (state.driftTime % 1.6) / 1.6;
      ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(cx, 40, cw, 3);
      ctx.fillStyle = col; ctx.fillRect(cx, 40, cw * frac, 3);
    }
    ctx.globalAlpha = 1;
  }

  // --- Minimap oben rechts
  const mw = 72, mx = VIEW_W - mw - 8, my = 8;
  ctx.fillStyle = 'rgba(8,8,14,.75)';
  ctx.fillRect(mx - 2, my - 2, mw + 4, mw + 4);
  ctx.drawImage(mini, 0, 0, mini.width, mini.height, mx, my, mw, mw);
  const px = mx + (car.x / WORLD_W) * mw, py = my + (car.y / WORLD_H) * mw;
  ctx.fillStyle = '#ffd96b'; ctx.fillRect(Math.round(px) - 1, Math.round(py) - 1, 3, 3);
  ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1;
  ctx.strokeRect(mx - 1.5, my - 1.5, mw + 3, mw + 3);
  drawTextShadow(ctx, 'KEGEL ' + state.cones, mx, my + mw + 5, 1, '#b9b9cf');

  // --- Handbremse / Meldung
  if (input.handbrake) {
    drawTextShadow(ctx, 'HANDBREMSE', (VIEW_W - textWidth('HANDBREMSE', 1)) / 2, VIEW_H - 42, 1, '#ff5a3c');
  }
  if (state.messageTime > 0) {
    ctx.globalAlpha = Math.min(1, state.messageTime / 0.5);
    const w = textWidth(state.message, 2);
    drawTextShadow(ctx, state.message, (VIEW_W - w) / 2, VIEW_H - 54, 2, '#f2f2f6');
    ctx.globalAlpha = 1;
  }
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

requestAnimationFrame(frame);

// Debug-Zugriff aus der Konsole: __dbg.car, __dbg.state
window.__dbg = { car, state, input, world };
