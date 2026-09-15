// Fahrzeug: Reifen-/Fahrwerksphysik, Kollision, Pixel-Sprite.
// Laengs- und Querkraefte werden getrennt aus den Schraeglaufwinkeln von
// Vorder- und Hinterachse berechnet, die Antriebskraft liefert der
// Antriebsstrang (src/drivetrain.js).

import { Drivetrain } from './drivetrain.js';

export const PX_PER_M = 6;

const RESISTANCE = 12;   // Rollwiderstand
const DRAG = 1.05;       // Luftwiderstand
const G = 9.81;

export class Car {
  constructor(x, y, spec) {
    this.drivetrain = new Drivetrain(spec);
    this.applySpec(spec);
    this.reset(x, y, 0);
  }

  applySpec(spec) {
    this.spec = spec;
    this.sprite = makeCarSprite(spec);
    this.shadowSprite = makeShadowSprite(spec);
    this.wheelbaseF = 1.05;
    this.wheelbaseR = 1.45;
    this.drivetrain.setSpec(spec);
  }

  reset(x, y, heading = 0) {
    this.x = x; this.y = y;
    this.heading = heading;
    this.vLong = 0; this.vLat = 0;
    this.yaw = 0;
    this.steer = 0;
    this.slip = 0;
    this.wheelSpin = 0;
    this.crashCooldown = 0;
    this.stuckTime = 0;
    this.tele = { rpm: this.spec.idle, gearLabel: '-', boost: 0, shifting: false, limiter: false };
    this.drivetrain.reset();
  }

  get speed() { return Math.hypot(this.vLong, this.vLat); }
  get kmh() { return Math.abs(this.speed) * 3.6; }
  get vxWorld() { return Math.cos(this.heading) * this.vLong - Math.sin(this.heading) * this.vLat; }
  get vyWorld() { return Math.sin(this.heading) * this.vLong + Math.cos(this.heading) * this.vLat; }
  get rpmFrac() {
    const s = this.spec;
    return Math.max(0, Math.min(1.05, (this.tele.rpm - s.idle) / (s.redline - s.idle)));
  }

  /**
   * @param ctl {throttle, brake, steer, handbrake, clutch, mode}
   * @returns Aufprallstaerke (0 = keine Kollision)
   */
  update(dt, ctl, world, settings) {
    const s = this.spec;

    // ---- Lenkung: mit dem Tempo weicher, plus optionale Gegenlenk-Hilfe
    const speedFactor = 1 - Math.min(0.55, Math.abs(this.vLong) / 55);
    let target = ctl.steer * s.maxSteer * speedFactor;
    const assist = settings.steerAssist;
    if (assist > 0 && Math.abs(this.vLong) > 3) {
      const slipNow = Math.atan2(this.vLat, Math.abs(this.vLong));
      target = clamp(target + assist * slipNow * 1.1, -s.maxSteer, s.maxSteer);
    }
    const rate = Math.abs(target) > Math.abs(this.steer) ? 7.5 : 11.0;
    this.steer += (target - this.steer) * Math.min(1, rate * dt);

    const surf = world.surfaceAt(this.x, this.y);
    const gripScale = surf.grip * settings.gripGlobal;

    // ---- Antrieb
    const dv = this.drivetrain.update(dt, ctl, this.vLong);
    this.tele = dv;

    // ---- Schraeglaufwinkel vorne/hinten
    const vLongSafe = Math.abs(this.vLong) < 0.6 ? Math.sign(this.vLong || 1) * 0.6 : this.vLong;
    const slipF = Math.atan2(this.vLat + this.yaw * this.wheelbaseF, Math.abs(vLongSafe))
                  - this.steer * Math.sign(vLongSafe);
    const slipR = Math.atan2(this.vLat - this.yaw * this.wheelbaseR, Math.abs(vLongSafe));

    const hb = ctl.handbrake ? 1 : 0;
    // Unter Gas verliert die angetriebene Hinterachse Seitenfuehrung
    // (Reibungsbudget), die Handbremse blockiert sie fast ganz.
    const powerOff = 1 - 0.24 * ctl.throttle;
    const maxGripF = s.grip * gripScale;
    const maxGripR = s.grip * gripScale * s.rearGrip * powerOff * (1 - 0.62 * hb);
    const caR = s.caR * powerOff * (1 - 0.55 * hb);

    // Seitenkraft faellt hinter dem Haftungsmaximum ab -> Drift wird haltbar
    const falloff = (a, amount) => 1 - amount * Math.min(1, Math.max(0, (Math.abs(a) - 0.32) / 0.85));
    const load = s.mass * G * 0.5;
    const fLat = clamp(s.caF * slipF, -maxGripF, maxGripF) * load * falloff(slipF, s.falloffF);
    const rLat = clamp(caR * slipR, -maxGripR, maxGripR) * load * falloff(slipR, s.falloffR);

    // ---- Laengskraft inkl. Handbremse und Traktionsgrenze
    let drive = dv.force;
    if (hb) drive -= Math.sign(this.vLong) * s.arcadeForce * 0.6;

    const tractionLimit = load * 2 * 1.9;
    if (Math.abs(drive) > tractionLimit) {
      this.wheelSpin = Math.min(1, this.wheelSpin + dt * 3);
      drive = Math.sign(drive) * (tractionLimit + (Math.abs(drive) - tractionLimit) * 0.35);
    } else {
      this.wheelSpin = Math.max(0, this.wheelSpin - dt * 2.2);
    }
    if (dv.wantSpin > 0.5 && Math.abs(this.vLong) < 8 && ctl.throttle > 0.5) {
      this.wheelSpin = Math.min(1, this.wheelSpin + dt * 1.4 * dv.wantSpin);
    }

    const resLong = -(RESISTANCE * surf.drag * this.vLong + DRAG * this.vLong * Math.abs(this.vLong));
    const resLat = -(RESISTANCE * surf.drag * 2.5 * this.vLat + DRAG * this.vLat * Math.abs(this.vLat));

    const fx = drive - Math.sin(this.steer) * fLat + resLong;
    const fy = Math.cos(this.steer) * fLat + rLat + resLat;
    const torque = this.wheelbaseF * Math.cos(this.steer) * fLat - this.wheelbaseR * rLat;

    // ---- Integration im Fahrzeugsystem (Zentripetalterm inklusive)
    const aLong = fx / s.mass + this.yaw * this.vLat;
    const aLat = fy / s.mass - this.yaw * this.vLong;
    this.vLong += aLong * dt;
    this.vLat += aLat * dt;
    this.yaw += (torque / s.inertia) * dt;

    this.yaw *= Math.pow(0.45, dt);

    // Stabilitaetskontrolle: bremst Gierbewegung und Querversatz ein
    if (settings.stability) {
      const sl = Math.abs(Math.atan2(this.vLat, Math.max(1, Math.abs(this.vLong))));
      if (sl > 0.18) {
        const k = Math.min(1, (sl - 0.18) * 3);
        this.yaw *= Math.pow(0.25, dt * k);
        this.vLat *= Math.pow(0.3, dt * k);
      }
    }

    if (this.speed < 0.35 && ctl.throttle === 0) {
      this.vLong *= Math.pow(0.02, dt); this.vLat *= Math.pow(0.02, dt); this.yaw *= Math.pow(0.02, dt);
    }

    this.heading += this.yaw * dt;
    this.x += this.vxWorld * PX_PER_M * dt;
    this.y += this.vyWorld * PX_PER_M * dt;

    this.slip = Math.abs(this.vLong) > 1.2 ? Math.atan2(this.vLat, Math.abs(this.vLong)) : 0;
    this.crashCooldown = Math.max(0, this.crashCooldown - dt);

    // Festgefahren erkennen (Vollgas, aber nichts passiert)
    if (ctl.throttle > 0.5 && this.kmh < 4) this.stuckTime += dt;
    else this.stuckTime = 0;

    return this.collide(world);
  }

  collide(world) {
    const s = this.spec;
    const r = s.wid * 0.5 + 1;
    const half = s.len * 0.5 - r;
    const cs = Math.cos(this.heading), sn = Math.sin(this.heading);
    let impact = 0;

    for (const off of [half, -half]) {
      const px = this.x + cs * off, py = this.y + sn * off;
      const hit = world.resolveCircle(px, py, r);
      if (!hit) continue;

      this.x += hit.nx * hit.push;
      this.y += hit.ny * hit.push;

      // Normalanteil prallt gedaempft ab, Tangentialanteil bleibt erhalten
      // -> das Auto schrammt an der Wand entlang statt zu kleben.
      const vx = this.vxWorld, vy = this.vyWorld;
      const vn = vx * hit.nx + vy * hit.ny;
      if (vn < 0) {
        impact = Math.max(impact, -vn);
        const tx = -hit.ny, ty = hit.nx;
        const vt = vx * tx + vy * ty;
        const wx = hit.nx * (-vn * 0.35) + tx * (vt * 0.88);
        const wy = hit.ny * (-vn * 0.35) + ty * (vt * 0.88);
        this.vLong = cs * wx + sn * wy;
        this.vLat = -sn * wx + cs * wy;
        this.yaw += Math.sign(off) * (hit.nx * -sn + hit.ny * cs) * -vn * 0.07;
        this.yaw = clamp(this.yaw, -4, 4);
      }
    }
    if (impact > 1.5 && this.crashCooldown <= 0) { this.crashCooldown = 0.25; return impact; }
    return 0;
  }

  wheelPositions() {
    const s = this.spec;
    const cs = Math.cos(this.heading), sn = Math.sin(this.heading);
    const fx = s.len * 0.32, rx = -s.len * 0.32, wy = s.wid * 0.42;
    const out = [];
    for (const [ox, oy, rear] of [[fx, -wy, 0], [fx, wy, 0], [rx, -wy, 1], [rx, wy, 1]]) {
      out.push({ x: this.x + cs * ox - sn * oy, y: this.y + sn * ox + cs * oy, rear });
    }
    return out;
  }

  // Schatten in Richtung des globalen Lichteinfalls
  drawShadow(g, offX = 2.5, offY = 3.5, alpha = 0.34) {
    const sp = this.shadowSprite;
    g.save();
    g.globalAlpha = alpha;
    g.translate(this.x + offX, this.y + offY);
    g.rotate(this.heading);
    g.drawImage(sp, -sp.width / 2, -sp.height / 2);
    g.restore();
  }

  draw(g, ctl) {
    const s = this.spec;
    const braking = ctl && (ctl.brake > 0 || ctl.handbrake > 0);
    g.save();
    g.translate(this.x, this.y);
    g.rotate(this.heading);

    // Raeder zuerst, damit die Karosserie sie teilweise ueberdeckt
    const fx = s.len * 0.30, rx = -s.len * 0.32, wy = s.wid * 0.5 - 0.5;
    const ww = s.wheel, wh = 3;
    for (const [ox, oy, turn] of [[fx, -wy, 1], [fx, wy, 1], [rx, -wy, 0], [rx, wy, 0]]) {
      g.save();
      g.translate(ox, oy);
      if (turn) g.rotate(this.steer);
      g.fillStyle = '#0c0c10';
      g.fillRect(-ww / 2, -wh / 2, ww, wh);
      // Felge blitzt auf, solange sich das Rad dreht
      g.fillStyle = this.wheelSpin > 0.3 ? '#8a8a9c' : '#3a3a46';
      g.fillRect(-ww / 2 + 1, -wh / 2 + 1, ww - 2, 1);
      g.restore();
    }

    const sp = this.sprite;
    g.drawImage(sp, -sp.width / 2, -sp.height / 2);

    // Bremslichter
    if (braking) {
      g.fillStyle = '#ff4433';
      g.fillRect(-s.len / 2, -s.wid / 2 + 2, 2, 2);
      g.fillRect(-s.len / 2, s.wid / 2 - 4, 2, 2);
    }
    g.restore();
  }
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// --------------------------------------------------------------- Pixel-Sprite
// Halbe Karosseriebreite entlang der Laengsachse (0 = Heck, 1 = Front).
// Jede Form hat dadurch eine eigene Silhouette.
const PROFILES = {
  coupe:  (t) => 0.78 + 0.22 * Math.sin(Math.PI * Math.pow(t, 0.85)) - 0.16 * Math.pow(t, 3.2),
  muscle: (t) => 0.88 + 0.12 * Math.sin(Math.PI * t) - 0.08 * Math.pow(t, 4),
  hatch:  (t) => 0.84 + 0.16 * Math.sin(Math.PI * Math.pow(t, 0.7)) - 0.12 * Math.pow(t, 3),
  drift:  (t) => 0.76 + 0.24 * Math.sin(Math.PI * Math.pow(t, 0.9)) - 0.20 * Math.pow(t, 2.6),
  super:  (t) => 0.70 + 0.30 * Math.sin(Math.PI * Math.pow(t, 1.15)) - 0.22 * Math.pow(t, 2.2),
};

function bodyMask(spec) {
  const L = spec.len, W = spec.wid;
  const prof = PROFILES[spec.shape] || PROFILES.coupe;
  const cy = W / 2;
  const rows = [];
  for (let x = 0; x < L; x++) {
    const t = (x + 0.5) / L;
    const hw = Math.max(1, (W / 2) * Math.min(1, prof(t)));
    rows.push([Math.round(cy - hw), Math.round(cy + hw)]);   // [y0, y1)
  }
  return rows;
}

export function makeCarSprite(spec) {
  const L = spec.len, W = spec.wid;
  const c = document.createElement('canvas');
  c.width = L; c.height = W;
  const g = c.getContext('2d');
  const body = spec.body;
  const rows = bodyMask(spec);

  const dark = mix(body, '#000', 0.5);
  const mid = mix(body, '#000', 0.22);
  const lite = mix(body, '#fff', 0.18);
  const glass = '#2b3546';   // dunkles Blaugrau fuer die Scheiben

  // Karosserie mit Licht von oben-links
  for (let x = 0; x < L; x++) {
    const [y0, y1] = rows[x];
    g.fillStyle = body;
    g.fillRect(x, y0, 1, y1 - y0);
    g.fillStyle = lite; g.fillRect(x, y0, 1, 1);                 // Lichtkante oben
    g.fillStyle = dark; g.fillRect(x, y1 - 1, 1, 1);             // Schattenkante unten
  }

  // Front- und Heckabschluss abdunkeln
  for (let x = 0; x < 2; x++) {
    const [y0, y1] = rows[x];
    g.fillStyle = mid; g.fillRect(x, y0 + 1, 1, Math.max(0, y1 - y0 - 2));
  }

  // Kabine: koerperfarbenes Dach, davor und dahinter je eine Scheibe
  const cabX = Math.round(L * 0.28), cabW = Math.round(L * 0.42);
  const roofCol = mix(body, '#000', 0.16);
  for (let x = cabX; x < cabX + cabW; x++) {
    const [y0, y1] = rows[x];
    g.fillStyle = roofCol;
    g.fillRect(x, y0 + 1, 1, Math.max(0, y1 - y0 - 2));
  }
  const inset = W > 12 ? 2 : 1;
  const winY = (x) => {
    const [y0, y1] = rows[x];
    return [y0 + inset, Math.max(1, y1 - y0 - inset * 2)];
  };
  const [wy0, wh0] = winY(cabX + cabW - 3);
  g.fillStyle = '#4a6182';   // Frontscheibe, heller als hinten
  g.fillRect(cabX + cabW - 3, wy0, 3, wh0);
  g.fillStyle = 'rgba(255,255,255,.22)';
  g.fillRect(cabX + cabW - 3, wy0, 1, wh0);
  const [wy1, wh1] = winY(cabX + 1);
  g.fillStyle = glass;                                         // Heckscheibe
  g.fillRect(cabX + 1, wy1, 2, wh1);
  // Seitenscheiben als dunkle Linien entlang der Dachkante
  g.fillStyle = mix(glass, '#000', 0.25);
  for (let x = cabX + 3; x < cabX + cabW - 3; x++) {
    const [y0, y1] = rows[x];
    g.fillRect(x, y0 + 1, 1, 1);
    g.fillRect(x, y1 - 2, 1, 1);
  }

  // Dachstreifen
  g.fillStyle = spec.stripe;
  g.fillRect(cabX + 3, Math.floor(W / 2) - 1, Math.max(2, cabW - 7), 2);

  // Motorhaube: Lufteinlass und Fugen
  const hoodX = cabX + cabW + 1;
  g.fillStyle = mix(body, '#000', 0.3);
  g.fillRect(hoodX, Math.floor(W / 2) - 2, Math.max(2, L - hoodX - 4), 1);
  g.fillRect(hoodX, Math.floor(W / 2) + 1, Math.max(2, L - hoodX - 4), 1);
  g.fillStyle = mix(body, '#000', 0.45);
  g.fillRect(cabX - 1, rows[cabX][0] + 1, 1, Math.max(0, rows[cabX][1] - rows[cabX][0] - 2));
  g.fillRect(cabX + cabW, rows[cabX + cabW][0] + 1, 1,
             Math.max(0, rows[cabX + cabW][1] - rows[cabX + cabW][0] - 2));

  // Aussenspiegel
  g.fillStyle = dark;
  g.fillRect(cabX + cabW - 2, rows[cabX + cabW - 2][0] - 1, 2, 1);
  g.fillRect(cabX + cabW - 2, rows[cabX + cabW - 2][1], 2, 1);

  // Heckfluegel
  if (spec.spoiler) {
    const [sy0, sy1] = rows[2];
    g.fillStyle = dark;
    g.fillRect(1, Math.max(0, sy0 - 1), 2, 1);
    g.fillRect(1, Math.min(W - 1, sy1), 2, 1);
    g.fillStyle = mid;
    g.fillRect(1, sy0, 2, Math.max(1, sy1 - sy0));
  }

  // Scheinwerfer und Rueckleuchten - bei schmaler Front nur eine Einheit,
  // sonst wuerden beide zu einem Klotz verschmelzen
  const [fy0, fy1] = rows[L - 2];
  g.fillStyle = '#fff4cf';
  if (fy1 - fy0 >= 7) { g.fillRect(L - 2, fy0 + 1, 2, 2); g.fillRect(L - 2, fy1 - 3, 2, 2); }
  else g.fillRect(L - 2, Math.round((fy0 + fy1) / 2) - 1, 2, 2);
  const [by0, by1] = rows[1];
  g.fillStyle = '#b02a26';
  if (by1 - by0 >= 7) { g.fillRect(0, by0 + 1, 2, 2); g.fillRect(0, by1 - 3, 2, 2); }
  else g.fillRect(0, Math.round((by0 + by1) / 2) - 1, 2, 2);

  return c;
}

// Standbild mit Raedern - fuer Garage und Streckenauswahl
export function makeCarPreview(spec) {
  const body = makeCarSprite(spec);
  const L = spec.len, W = spec.wid;
  const c = document.createElement('canvas');
  c.width = L; c.height = W + 4;
  const g = c.getContext('2d');
  const fx = Math.round(L * 0.30 + L / 2), rx = Math.round(-L * 0.32 + L / 2);
  const ww = spec.wheel, wh = 3;
  for (const cx of [fx, rx]) {
    for (const cy of [1, W + 1]) {
      g.fillStyle = '#0c0c10';
      g.fillRect(cx - ww / 2, cy, ww, wh);
      g.fillStyle = '#3a3a46';
      g.fillRect(cx - ww / 2 + 1, cy + 1, ww - 2, 1);
    }
  }
  g.drawImage(body, 0, 2);
  return c;
}

// schwarze Silhouette fuer den Schlagschatten
function makeShadowSprite(spec) {
  const L = spec.len, W = spec.wid;
  const c = document.createElement('canvas');
  c.width = L + 2; c.height = W + 2;
  const g = c.getContext('2d');
  const rows = bodyMask(spec);
  g.fillStyle = '#000';
  for (let x = 0; x < L; x++) {
    const [y0, y1] = rows[x];
    g.fillRect(x + 1, y0, 1, y1 - y0);
  }
  return c;
}

function mix(a, b, t) {
  const pa = hex(a), pb = hex(b);
  const f = (i) => Math.round(pa[i] + (pb[i] - pa[i]) * t);
  return `rgb(${f(0)},${f(1)},${f(2)})`;
}
function hex(h) {
  if (h[0] !== '#') return [0, 0, 0];
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
