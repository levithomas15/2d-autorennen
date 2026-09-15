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
    this.wheelSprite = makeWheelSprite(spec);
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
    // Regen und Schnee kosten zusaetzlich Haftung
    const weatherGrip = settings.weather === 1 ? 0.86 : settings.weather === 2 ? 0.74 : 1;
    const gripScale = surf.grip * settings.gripGlobal * weatherGrip;

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
  drawShadow(g, offX = 2.5, offY = 3.5, alpha = 1) {
    const s = this.spec;
    const sp = this.shadowSprite;
    const w = sp.width / SS, h = sp.height / SS;
    g.save();
    g.globalAlpha = alpha;
    g.translate(this.x + offX, this.y + offY);
    g.rotate(this.heading);
    g.drawImage(sp, -w / 2, -h / 2, w, h);
    g.restore();
  }

  draw(g, ctl) {
    const s = this.spec;
    const braking = ctl && (ctl.brake > 0 || ctl.handbrake > 0);
    g.save();
    g.translate(this.x, this.y);
    g.rotate(this.heading);

    // Raeder zuerst, die Karosserie deckt sie teilweise ab
    const ws = this.wheelSprite;
    const ww = ws.width / SS, wh = ws.height / SS;
    const fx = s.len * 0.30, rx = -s.len * 0.32, wy = s.wid * 0.5 - 0.3;
    for (const [ox, oy, turn] of [[fx, -wy, 1], [fx, wy, 1], [rx, -wy, 0], [rx, wy, 0]]) {
      g.save();
      g.translate(ox, oy);
      if (turn) g.rotate(this.steer);
      g.drawImage(ws, -ww / 2, -wh / 2, ww, wh);
      if (this.wheelSpin > 0.3) {          // Felge verwischt beim Durchdrehen
        g.globalAlpha = Math.min(0.6, this.wheelSpin);
        g.fillStyle = '#9a9ab0';
        g.fillRect(-ww / 2 + 0.6, -wh / 2 + 0.8, ww - 1.2, wh - 1.6);
        g.globalAlpha = 1;
      }
      g.restore();
    }

    g.drawImage(this.sprite, -s.len / 2, -s.wid / 2, s.len, s.wid);

    // Bremslichter
    if (braking) {
      g.fillStyle = '#ff5240';
      g.fillRect(-s.len / 2, -s.wid * 0.42, 1.2, s.wid * 0.22);
      g.fillRect(-s.len / 2, s.wid * 0.2, 1.2, s.wid * 0.22);
    }
    g.restore();
  }
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// --------------------------------------------------------------- Fahrzeug-Sprite
// Sprites werden mit doppelter Aufloesung gezeichnet (SS Bildpunkte je
// Welt-Pixel), passend zur verdoppelten Renderaufloesung der Szene.
export const SS = 2;

// Halbe Karosseriebreite entlang der Laengsachse (0 = Heck, 1 = Front).
const PROFILES = {
  coupe:  (t) => 0.80 + 0.20 * Math.sin(Math.PI * Math.pow(t, 0.85)) - 0.16 * Math.pow(t, 3.2),
  muscle: (t) => 0.90 + 0.10 * Math.sin(Math.PI * t) - 0.08 * Math.pow(t, 4),
  hatch:  (t) => 0.86 + 0.14 * Math.sin(Math.PI * Math.pow(t, 0.7)) - 0.12 * Math.pow(t, 3),
  drift:  (t) => 0.78 + 0.22 * Math.sin(Math.PI * Math.pow(t, 0.9)) - 0.20 * Math.pow(t, 2.6),
  super:  (t) => 0.72 + 0.28 * Math.sin(Math.PI * Math.pow(t, 1.15)) - 0.22 * Math.pow(t, 2.2),
};

// Umriss als Pfad - dadurch laufen Rundungen sauber statt stufig
function bodyPath(spec, L, W) {
  const prof = PROFILES[spec.shape] || PROFILES.coupe;
  const cy = W / 2;
  const hw = (x) => Math.max(1.5, (W / 2) * Math.min(1, prof((x + 0.5) / L)));
  const path = new Path2D();
  path.moveTo(0.5, cy - hw(0) + 0.5);
  for (let x = 0; x <= L; x++) path.lineTo(x, cy - hw(x));
  for (let x = L; x >= 0; x--) path.lineTo(x, cy + hw(x));
  path.closePath();
  return { path, hw, cy };
}

export function makeCarSprite(spec) {
  const L = spec.len * SS, W = spec.wid * SS;
  const c = document.createElement('canvas');
  c.width = L; c.height = W;
  const g = c.getContext('2d');
  const body = spec.body;
  const { path, hw, cy } = bodyPath(spec, L, W);

  // Licht- und Schattentoene werden in der Farbe verschoben (warm aufhellen,
  // kuehl abdunkeln) - reines Weiss laesst rote Lacke sonst rosa wirken.
  const shadeD = mix(body, '#171426', 0.52);
  const shade1 = mix(body, '#241f33', 0.26);
  const light1 = mix(body, '#ffe6bc', 0.15);
  const light2 = mix(body, '#fff1d6', 0.30);

  // Karosserie in klaren Stufen statt weichem Verlauf - das bleibt scharf
  g.save();
  g.clip(path);
  const bands = [
    [0.00, 0.13, light2], [0.13, 0.28, light1], [0.28, 0.64, body],
    [0.64, 0.84, shade1], [0.84, 1.00, shadeD],
  ];
  for (const [a, b, col] of bands) {
    g.fillStyle = col;
    g.fillRect(0, W * a, L, W * (b - a) + 0.5);
  }

  const cabX = L * 0.30, cabW = L * 0.36;
  const noseX = cabX + cabW;

  // Heckdeckel und Motorhaube leicht absetzen
  g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(0, 0, cabX, W);
  g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(noseX, 0, L - noseX, W);

  // Zierstreifen zuerst, die Scheiben liegen spaeter darueber
  g.fillStyle = spec.stripe;
  if (spec.shape === 'muscle') {
    g.fillRect(cabX * 0.4, cy - 2.0 * SS, L - cabX * 0.4 - 2 * SS, 0.8 * SS);
    g.fillRect(cabX * 0.4, cy + 1.2 * SS, L - cabX * 0.4 - 2 * SS, 0.8 * SS);
  } else {
    g.fillRect(cabX * 0.5, cy - 0.45 * SS, L - cabX * 0.5 - 2 * SS, 0.9 * SS);
  }

  // Scheiben: Heckscheibe, Dach dazwischen, Frontscheibe
  windowPane(g, cabX + 0.6 * SS, cabX + 0.30 * cabW, cy, hw, false);
  windowPane(g, noseX - 0.34 * cabW, noseX - 0.6 * SS, cy, hw, true);

  // Seitenscheiben als dunkle Baender entlang der Dachkante
  g.fillStyle = 'rgba(14,18,30,.8)';
  for (let x = cabX + 0.32 * cabW; x < noseX - 0.36 * cabW; x++) {
    const h = hw(x);
    g.fillRect(x, cy - h + 0.7 * SS, 1, 0.8 * SS);
    g.fillRect(x, cy + h - 1.5 * SS, 1, 0.8 * SS);
  }

  // Fugen von Tueren und Klappen
  g.fillStyle = 'rgba(0,0,0,.45)';
  g.fillRect(Math.round(cabX), 0, 1, W);
  g.fillRect(Math.round(noseX), 0, 1, W);
  g.fillStyle = 'rgba(0,0,0,.3)';
  g.fillRect(Math.round(noseX + (L - noseX) * 0.5), 1, 1, W - 2);

  // Radhaeuser
  g.fillStyle = 'rgba(0,0,0,.34)';
  for (const wx of [L * 0.30, L * 0.74]) {
    g.fillRect(wx - 1.7 * SS, 0, 3.4 * SS, 1 * SS);
    g.fillRect(wx - 1.7 * SS, W - 1 * SS, 3.4 * SS, 1 * SS);
  }

  // modellabhaengige Details
  if (spec.shape === 'muscle') {
    g.fillStyle = shadeD;
    g.fillRect(L * 0.80, cy - 1.9 * SS, 2.6 * SS, 3.8 * SS);
    g.fillStyle = '#12121a';
    g.fillRect(L * 0.80 + 0.5 * SS, cy - 1.3 * SS, 1.6 * SS, 2.6 * SS);
  } else if (spec.shape === 'super') {
    g.fillStyle = '#12121a';
    for (let i = 0; i < 3; i++) {
      g.fillRect(cabX - 2.4 * SS, cy - 2.2 * SS + i * 1.6 * SS, 1.8 * SS, 0.9 * SS);
    }
  } else if (spec.shape === 'drift') {
    g.fillStyle = 'rgba(0,0,0,.2)';
    g.fillRect(L * 0.22, 0, L * 0.18, 1.4 * SS);
    g.fillRect(L * 0.22, W - 1.4 * SS, L * 0.18, 1.4 * SS);
  } else if (spec.shape === 'hatch') {
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.fillRect(L * 0.84, cy - 2.4 * SS, 1.6 * SS, 4.8 * SS);
  }

  // Front: Stossfaenger, Grill, Scheinwerfer
  const fh = hw(L - 1.6 * SS);
  g.fillStyle = shadeD;
  g.fillRect(L - 1.8 * SS, cy - fh, 1.8 * SS, fh * 2);
  g.fillStyle = '#0e0e16';
  g.fillRect(L - 1.4 * SS, cy - fh * 0.42, 1.4 * SS, fh * 0.84);
  headlight(g, L - 2.4 * SS, cy - fh + 0.5 * SS);
  headlight(g, L - 2.4 * SS, cy + fh - 1.9 * SS);

  // Heck: Stossfaenger, Leuchten, Auspuff
  const rh = hw(1.6 * SS);
  g.fillStyle = shadeD;
  g.fillRect(0, cy - rh, 2 * SS, rh * 2);
  taillight(g, 0.3 * SS, cy - rh + 0.6 * SS);
  taillight(g, 0.3 * SS, cy + rh - 2.0 * SS);
  g.fillStyle = '#9aa0ae';
  g.fillRect(0, cy - 1 * SS, 0.7 * SS, 0.7 * SS);
  g.fillRect(0, cy + 0.3 * SS, 0.7 * SS, 0.7 * SS);

  g.restore();

  // kleine Aussenspiegel am Fuss der Frontscheibe
  const mx = noseX - 1.2 * SS, mh = hw(mx);
  g.fillStyle = shadeD;
  g.fillRect(mx, cy - mh - 0.9 * SS, 1.2 * SS, 0.9 * SS);
  g.fillRect(mx, cy + mh, 1.2 * SS, 0.9 * SS);

  // Heckfluegel mit Stuetzen
  if (spec.spoiler) {
    const sh = hw(2.4 * SS);
    g.fillStyle = shade1;
    g.fillRect(1.6 * SS, cy - sh + 0.4 * SS, 0.9 * SS, 1.4 * SS);
    g.fillRect(1.6 * SS, cy + sh - 1.8 * SS, 0.9 * SS, 1.4 * SS);
    g.fillStyle = shadeD;
    g.fillRect(0.8 * SS, cy - sh - 1.1 * SS, 2.4 * SS, 1.1 * SS);
    g.fillRect(0.8 * SS, cy + sh, 2.4 * SS, 1.1 * SS);
    g.fillStyle = 'rgba(255,255,255,.14)';
    g.fillRect(0.8 * SS, cy - sh - 1.1 * SS, 2.4 * SS, 0.4 * SS);
  }

  // dunkle Kontur fuer klare Silhouette
  g.strokeStyle = 'rgba(6,6,10,.9)';
  g.lineWidth = 1;
  g.stroke(path);
  return c;
}

// Scheibe mit Rahmen, dunklem Glas und schmalem Spiegelstreifen
function windowPane(g, x0, x1, cy, hw, front) {
  const h0 = hw(x0), h1 = hw(x1);
  const inset = 1.1 * SS;
  g.fillStyle = front ? 'rgba(43,56,82,.92)' : 'rgba(35,45,66,.94)';
  g.beginPath();
  g.moveTo(x0, cy - h0 + inset);
  g.lineTo(x1, cy - h1 + inset);
  g.lineTo(x1, cy + h1 - inset);
  g.lineTo(x0, cy + h0 - inset);
  g.closePath();
  g.fill();
  // Spiegelung
  g.fillStyle = 'rgba(190,215,250,.3)';
  const w = Math.max(1, (x1 - x0) * 0.34);
  g.fillRect(front ? x1 - w - 0.6 : x0 + 0.6, cy - h0 + inset + 0.4 * SS, w, Math.max(1, h0 * 0.7));
  // Rahmen oben und unten
  g.fillStyle = 'rgba(0,0,0,.35)';
  g.fillRect(x0, cy - h0 + inset - 0.4 * SS, x1 - x0, 0.4 * SS);
  g.fillRect(x0, cy + h0 - inset, x1 - x0, 0.4 * SS);
}

// Scheibe mit Rahmen und schraegem Spiegelstreifen
function glass(g, x0, x1, cy, hw, W, front) {
  const w = Math.max(1, x1 - x0);
  const h0 = hw(x0), h1 = hw(x1);
  const g2 = g.createLinearGradient(x0, cy - h0, x1, cy + h1);
  g2.addColorStop(0, front ? '#33415c' : '#28334a');
  g2.addColorStop(0.55, front ? '#4d6388' : '#39496a');
  g2.addColorStop(1, '#222c40');
  g.fillStyle = g2;
  g.beginPath();
  g.moveTo(x0, cy - h0 + 1.4);
  g.lineTo(x1, cy - h1 + 1.4);
  g.lineTo(x1, cy + h1 - 1.4);
  g.lineTo(x0, cy + h0 - 1.4);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(210,230,255,.28)';
  g.fillRect(x0 + w * 0.15, cy - h0 + 1.6, Math.max(1, w * 0.3), Math.max(1, h0 * 0.8));
}

function headlight(g, x, y) {
  g.fillStyle = '#1b1f28';
  g.fillRect(x, y - 0.2 * SS, 2.4 * SS, 1.7 * SS);
  g.fillStyle = '#fff3ce';
  g.fillRect(x + 0.4 * SS, y + 0.1 * SS, 1.8 * SS, 1.1 * SS);
  g.fillStyle = '#ffffff';
  g.fillRect(x + 1.3 * SS, y + 0.25 * SS, 0.7 * SS, 0.55 * SS);
}

function taillight(g, x, y) {
  g.fillStyle = '#4d1015';
  g.fillRect(x, y, 1.6 * SS, 1.7 * SS);
  g.fillStyle = '#cf2f28';
  g.fillRect(x + 0.2 * SS, y + 0.2 * SS, 1.2 * SS, 1.2 * SS);
  g.fillStyle = '#ff7060';
  g.fillRect(x + 0.2 * SS, y + 0.2 * SS, 1.2 * SS, 0.4 * SS);
}

// Rad mit Reifenflanke und Felge
export function makeWheelSprite(spec) {
  const w = Math.round(spec.wheel * SS), h = Math.round(3.4 * SS);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#0b0b10';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#1a1a22';
  g.fillRect(1, 1, w - 2, h - 2);
  g.fillStyle = '#33333f';
  g.fillRect(w * 0.24, 1, w * 0.52, h - 2);
  g.fillStyle = '#54545f';
  g.fillRect(w * 0.32, h * 0.3, w * 0.36, h * 0.4);
  g.fillStyle = 'rgba(255,255,255,.14)';
  g.fillRect(1, 0, w - 2, 1);
  return c;
}

// weicher Schatten: mehrere versetzte Kopien des Umrisses
export function makeShadowSprite(spec) {
  const L = spec.len * SS, W = spec.wid * SS;
  const pad = 3 * SS;
  const c = document.createElement('canvas');
  c.width = L + pad * 2; c.height = W + pad * 2;
  const g = c.getContext('2d');
  g.translate(pad, pad);
  const { path } = bodyPath(spec, L, W);
  g.fillStyle = 'rgba(0,0,0,.34)';
  for (const [dx, dy, a] of [[0, 0, 0.5], [-1, -1, 0.22], [1, 1, 0.22], [2, 2, 0.14]]) {
    g.globalAlpha = a;
    g.save(); g.translate(dx, dy); g.fill(path); g.restore();
  }
  g.globalAlpha = 1;
  return c;
}

// Standbild mit Raedern - fuer Garage und Menue
export function makeCarPreview(spec) {
  const body = makeCarSprite(spec);
  const wheel = makeWheelSprite(spec);
  const L = spec.len * SS, W = spec.wid * SS;
  const c = document.createElement('canvas');
  c.width = L; c.height = W + wheel.height;
  const g = c.getContext('2d');
  const fx = L * 0.70, rx = L * 0.26;
  for (const cx of [fx, rx]) {
    g.drawImage(wheel, Math.round(cx - wheel.width / 2), 0);
    g.drawImage(wheel, Math.round(cx - wheel.width / 2), W + wheel.height / 2);
  }
  g.drawImage(body, 0, wheel.height / 2);
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
