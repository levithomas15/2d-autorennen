// Fahrzeug: Physik (vereinfachtes Reifen-Schraeglauf-Modell) + Pixel-Sprite.
// Laengs-/Querkraefte werden getrennt berechnet, dadurch bricht das Heck
// realistisch aus und laesst sich mit Gegenlenken + Gas halten.

export const PX_PER_M = 6;

export const CAR_TYPES = [
  {
    name: 'DRIFTER',  body: '#e03e3e', stripe: '#f6e3c8',
    mass: 1150, inertia: 1250, engine: 11800, brake: 14500,
    caF: -5.2, caR: -4.6, grip: 2.05, maxSteer: 0.60, len: 26, wid: 12,
  },
  {
    name: 'MUSCLE',   body: '#2f6fd0', stripe: '#eaeaf2',
    mass: 1450, inertia: 1700, engine: 15000, brake: 15500,
    caF: -5.0, caR: -4.9, grip: 2.2, maxSteer: 0.52, len: 29, wid: 13,
  },
  {
    name: 'TUNER',    body: '#33c07a', stripe: '#1b2a24',
    mass: 980,  inertia: 1020, engine: 10400, brake: 13500,
    caF: -5.6, caR: -5.4, grip: 2.35, maxSteer: 0.66, len: 24, wid: 11,
  },
];

const RESISTANCE = 26;   // Rollwiderstand
const DRAG = 5.0;        // Luftwiderstand
const G = 9.81;

export class Car {
  constructor(x, y, typeIndex = 0) {
    this.setType(typeIndex);
    this.reset(x, y, 0);
  }

  setType(i) {
    this.typeIndex = i % CAR_TYPES.length;
    this.spec = CAR_TYPES[this.typeIndex];
    this.sprite = makeCarSprite(this.spec);
    this.wheelbaseF = 1.05;
    this.wheelbaseR = 1.45;
  }

  reset(x, y, heading = 0) {
    this.x = x; this.y = y;          // Weltpixel
    this.heading = heading;          // rad, 0 = nach rechts
    this.vLong = 0; this.vLat = 0;   // m/s im Fahrzeugkoordinatensystem
    this.yaw = 0;                    // rad/s
    this.steer = 0;                  // aktueller Radeinschlag
    this.slip = 0;                   // Driftwinkel (rad)
    this.wheelSpin = 0;
    this.crashCooldown = 0;
  }

  get speed() { return Math.hypot(this.vLong, this.vLat); }
  get kmh() { return Math.abs(this.speed) * 3.6; }
  get vxWorld() { return Math.cos(this.heading) * this.vLong - Math.sin(this.heading) * this.vLat; }
  get vyWorld() { return Math.sin(this.heading) * this.vLong + Math.cos(this.heading) * this.vLat; }

  // input: {throttle 0..1, brake 0..1, steer -1..1, handbrake 0|1}
  update(dt, input, world) {
    const s = this.spec;

    // ---- Lenkung: geschwindigkeitsabhaengig weicher werden lassen
    const speedFactor = 1 - Math.min(0.55, Math.abs(this.vLong) / 55);
    const target = input.steer * s.maxSteer * speedFactor;
    const rate = (Math.abs(target) > Math.abs(this.steer) ? 7.5 : 11.0);
    this.steer += (target - this.steer) * Math.min(1, rate * dt);

    const surf = world.surfaceAt(this.x, this.y);
    const gripScale = surf.grip;

    // ---- Schraeglaufwinkel vorne/hinten
    const vLongSafe = Math.abs(this.vLong) < 0.6 ? Math.sign(this.vLong || 1) * 0.6 : this.vLong;
    const slipF = Math.atan2(this.vLat + this.yaw * this.wheelbaseF, Math.abs(vLongSafe)) - this.steer * Math.sign(vLongSafe);
    const slipR = Math.atan2(this.vLat - this.yaw * this.wheelbaseR, Math.abs(vLongSafe));

    const hb = input.handbrake ? 1 : 0;
    // Hinten weniger Haftung als vorne (Uebersteuern) und unter Gas zusaetzlich
    // weniger, weil der Antrieb einen Teil des Reibungsbudgets verbraucht.
    const powerOff = 1 - 0.24 * input.throttle;
    const maxGripF = s.grip * gripScale;
    const maxGripR = s.grip * gripScale * 0.86 * powerOff * (1 - 0.62 * hb);
    const caR = s.caR * powerOff * (1 - 0.55 * hb);

    // Nach dem Haftungsmaximum faellt die Seitenkraft wieder ab (wie eine echte
    // Reifenkennlinie). Genau dieser Abfall macht einen Drift kontrollierbar.
    const falloff = (a, amount) => 1 - amount * Math.min(1, Math.max(0, (Math.abs(a) - 0.32) / 0.85));
    const load = s.mass * G * 0.5;
    const fLat = clamp(s.caF * slipF, -maxGripF, maxGripF) * load * falloff(slipF, 0.15);
    const rLat = clamp(caR * slipR, -maxGripR, maxGripR) * load * falloff(slipR, 0.42);

    // ---- Laengskraft
    let drive = 0;
    if (input.throttle > 0) drive += s.engine * input.throttle;
    if (input.brake > 0) {
      if (this.vLong > 0.5) drive -= s.brake * input.brake;
      else drive -= s.engine * 0.45 * input.brake;   // Rueckwaerts
    }
    if (hb) drive -= Math.sign(this.vLong) * s.brake * 0.55;

    // Traktionsverlust beim Anfahren mit Vollgas -> Burnout
    const spinLimit = load * 2.4;
    if (Math.abs(drive) > spinLimit && input.throttle > 0.5) {
      this.wheelSpin = Math.min(1, this.wheelSpin + dt * 3);
      drive *= 0.78;
    } else {
      this.wheelSpin = Math.max(0, this.wheelSpin - dt * 2.2);
    }

    const resLong = -(RESISTANCE * surf.drag * this.vLong + DRAG * this.vLong * Math.abs(this.vLong));
    const resLat = -(RESISTANCE * surf.drag * this.vLat + DRAG * this.vLat * Math.abs(this.vLat));

    const fx = drive - Math.sin(this.steer) * fLat + resLong;
    const fy = Math.cos(this.steer) * fLat + rLat + resLat;
    const torque = this.wheelbaseF * Math.cos(this.steer) * fLat - this.wheelbaseR * rLat;

    // ---- Integration im Fahrzeugsystem (Zentripetalterm nicht vergessen)
    const aLong = fx / s.mass + this.yaw * this.vLat;
    const aLat = fy / s.mass - this.yaw * this.vLong;
    this.vLong += aLong * dt;
    this.vLat += aLat * dt;
    this.yaw += (torque / s.inertia) * dt;

    // leichte Gierdaempfung fuer Stabilitaet - zu viel wuerde jeden Drift ersticken
    this.yaw *= Math.pow(0.45, dt);
    if (this.speed < 0.35 && input.throttle === 0) {
      this.vLong *= Math.pow(0.02, dt); this.vLat *= Math.pow(0.02, dt); this.yaw *= Math.pow(0.02, dt);
    }

    this.heading += this.yaw * dt;
    this.x += this.vxWorld * PX_PER_M * dt;
    this.y += this.vyWorld * PX_PER_M * dt;

    this.slip = Math.abs(this.vLong) > 1.2 ? Math.atan2(this.vLat, Math.abs(this.vLong)) : 0;
    this.crashCooldown = Math.max(0, this.crashCooldown - dt);

    return this.collide(world);
  }

  // Front- und Heckpunkt gegen Gebaeude pruefen
  collide(world) {
    const s = this.spec;
    const r = s.wid * 0.5 + 1;
    const half = (s.len * 0.5 - r) ;
    const cs = Math.cos(this.heading), sn = Math.sin(this.heading);
    let impact = 0;

    for (const off of [half, -half]) {
      const px = this.x + cs * off, py = this.y + sn * off;
      const hit = world.resolveCircle(px, py, r);
      if (!hit) continue;

      this.x += hit.nx * hit.push;
      this.y += hit.ny * hit.push;

      // Geschwindigkeit in Normal- und Tangentialanteil zerlegen: der
      // Normalanteil prallt gedaempft ab, der Tangentialanteil bleibt weitgehend
      // erhalten -> das Auto schrammt an Waenden entlang statt zu kleben.
      const vx = this.vxWorld, vy = this.vyWorld;
      const vn = vx * hit.nx + vy * hit.ny;
      if (vn < 0) {
        impact = Math.max(impact, -vn);
        const tx2 = -hit.ny, ty2 = hit.nx;
        const vt = vx * tx2 + vy * ty2;
        const nvn = -vn * 0.35;
        const nvt = vt * 0.88;
        const wx = hit.nx * nvn + tx2 * nvt;
        const wy = hit.ny * nvn + ty2 * nvt;
        this.vLong = cs * wx + sn * wy;
        this.vLat = -sn * wx + cs * wy;
        // Drehimpuls je nachdem, ob vorne oder hinten getroffen wurde
        this.yaw += Math.sign(off) * (hit.nx * -sn + hit.ny * cs) * -vn * 0.07;
        this.yaw = clamp(this.yaw, -4, 4);
      }
    }
    if (impact > 1.5 && this.crashCooldown <= 0) { this.crashCooldown = 0.25; return impact; }
    return 0;
  }

  // Positionen der vier Raeder in Weltpixeln (fuer Skidmarks/Rauch)
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

  draw(g) {
    const sp = this.sprite;
    g.save();
    g.translate(Math.round(this.x), Math.round(this.y));
    g.rotate(this.heading);
    g.drawImage(sp, -sp.width / 2, -sp.height / 2);
    g.restore();
  }
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// --------------------------------------------------------------- Pixel-Sprite
function makeCarSprite(spec) {
  const L = spec.len, W = spec.wid;
  const c = document.createElement('canvas');
  c.width = L; c.height = W;
  const g = c.getContext('2d');
  const body = spec.body;

  const dark = mix(body, '#000', 0.45);
  const lite = mix(body, '#fff', 0.22);

  // Karosserie mit abgerundeter Front/Heck (per Pixel-Zeilen)
  for (let y = 0; y < W; y++) {
    const t = Math.abs((y + 0.5) / W - 0.5) * 2;   // 0 = Mitte, 1 = Rand
    const inset = t > 0.82 ? 2 : t > 0.6 ? 1 : 0;
    g.fillStyle = body;
    g.fillRect(inset, y, L - inset * 2, 1);
  }
  // Seitenschatten / Highlight
  g.fillStyle = dark; g.fillRect(2, W - 1, L - 4, 1);
  g.fillStyle = lite; g.fillRect(2, 0, L - 4, 1);

  // Dach + Scheiben
  const cabX = Math.round(L * 0.3), cabW = Math.round(L * 0.4);
  g.fillStyle = '#1a1f2b';
  g.fillRect(cabX, 1, cabW, W - 2);
  g.fillStyle = '#3d4d63';
  g.fillRect(cabX + cabW - 3, 2, 2, W - 4);           // Frontscheibe
  g.fillRect(cabX + 1, 2, 2, W - 4);                  // Heckscheibe
  g.fillStyle = spec.stripe;
  g.fillRect(cabX + 3, Math.floor(W / 2) - 1, cabW - 7, 2);  // Dachstreifen

  // Front: Scheinwerfer, Heck: Ruecklichter
  g.fillStyle = '#ffe9a8';
  g.fillRect(L - 2, 2, 2, 2); g.fillRect(L - 2, W - 4, 2, 2);
  g.fillStyle = '#c4282a';
  g.fillRect(0, 2, 2, 2); g.fillRect(0, W - 4, 2, 2);

  // Raeder
  g.fillStyle = '#101014';
  const wr = Math.round(L * 0.3);
  g.fillRect(wr + 1, -0 + 0, 4, 1); g.fillRect(wr + 1, W - 1, 4, 1);
  g.fillRect(L - wr - 5, 0, 4, 1); g.fillRect(L - wr - 5, W - 1, 4, 1);

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
