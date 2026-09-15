// Eingabe: Tastatur, drehbares Lenkrad, Pedale (Gas/Bremse/Handbremse/Kupplung)
// und ein sequenzieller Schalthebel. Alle Bedienelemente lassen sich in den
// Einstellungen ein- und ausblenden.

const MAX_WHEEL = 2.5;   // Lenkradausschlag in rad bei Vollausschlag

export class Input {
  constructor(settings) {
    this.settings = settings;
    this.throttle = 0; this.brake = 0; this.handbrake = 0; this.clutch = 0;
    this.steer = 0; this.wheelAngle = 0;
    this.shiftRequest = 0;       // +1 hoch, -1 runter, wird pro Frame geleert
    this.menuOpen = false;

    this.keys = new Set();
    this.dragging = false; this.dragStart = 0; this.dragBase = 0;
    this.touch = { gas: false, brake: false, hand: false, clutch: false };
    this.onKey = null;
    this.gearLabel = '-';

    this.bindKeyboard();
    this.bindWheel();
    this.bindPedals();
    this.bindShifter();
  }

  bindKeyboard() {
    const swallow = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
    addEventListener('keydown', (e) => {
      if (swallow.has(e.code)) e.preventDefault();
      if (!e.repeat) {
        if (e.code === 'KeyE' || e.code === 'ShiftLeft') this.shiftRequest = 1;
        if (e.code === 'KeyQ' || e.code === 'ControlLeft') this.shiftRequest = -1;
        if (this.onKey) this.onKey(e.code);
      }
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.resetTouch(); });
  }

  resetTouch() {
    for (const k of Object.keys(this.touch)) this.touch[k] = false;
    document.querySelectorAll('.pedal.down').forEach((el) => el.classList.remove('down'));
  }

  bindWheel() {
    const box = document.getElementById('wheelBox');
    if (!box) return;
    this.wheelBox = box;
    this.wheelCanvas = document.getElementById('wheel');
    this.wheelCtx = this.wheelCanvas.getContext('2d');

    const angleOf = (e) => {
      const r = box.getBoundingClientRect();
      return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
    };
    box.addEventListener('pointerdown', (e) => {
      capture(box, e);
      this.dragging = true;
      this.dragStart = angleOf(e);
      this.dragBase = this.wheelAngle;
      e.preventDefault();
    });
    box.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      let d = angleOf(e) - this.dragStart;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.wheelAngle = clamp(this.dragBase + d, -MAX_WHEEL, MAX_WHEEL);
    });
    const end = () => { this.dragging = false; };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    box.addEventListener('lostpointercapture', end);
  }

  // Alle drei Pedale liegen auf einer Flaeche, damit sie eine gemeinsame
  // Perspektive haben. Getroffen wird ueber die Spalte, in der gedrueckt wird;
  // mehrere Finger gleichzeitig sind moeglich (Bremse und Gas zusammen).
  bindPedals() {
    const el = document.getElementById('pedalBox');
    this.press = { gas: 0, brake: 0, clutch: 0, hand: 0 };   // gezeichnete Stellung
    if (!el) return;
    this.pedalEl = el;
    this.pedalCtx = el.getContext('2d');
    const held = new Map();                                   // Zeiger -> Pedal

    const pick = (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      if (y < 0.05) return null;
      let best = null, bestD = 0.135;
      for (const ped of PEDALS) {
        if (ped.key === 'clutch' && !this.clutchVisible()) continue;
        const d = Math.abs(x - ped.x);
        if (d < bestD) { bestD = d; best = ped.key; }
      }
      return best;
    };
    const stillHeld = (key, exceptId) => {
      for (const [id, k] of held) if (k === key && id !== exceptId) return true;
      return false;
    };

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const k = pick(e);
      if (!k) return;
      capture(el, e);
      held.set(e.pointerId, k);
      this.touch[k] = true;
    });
    el.addEventListener('pointermove', (e) => {          // Rutschen auf ein anderes Pedal
      if (!held.has(e.pointerId)) return;
      const prev = held.get(e.pointerId);
      const k = pick(e);
      if (k === prev) return;
      held.delete(e.pointerId);
      if (!stillHeld(prev, e.pointerId)) this.touch[prev] = false;
      if (k) { held.set(e.pointerId, k); this.touch[k] = true; }
    });
    const release = (e) => {
      const k = held.get(e.pointerId);
      if (!k) return;
      held.delete(e.pointerId);
      if (!stillHeld(k, e.pointerId)) this.touch[k] = false;
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);

    // Handbremshebel
    const lever = document.getElementById('pHand');
    if (!lever) return;
    this.leverEl = lever;
    this.leverCtx = lever.getContext('2d');
    const set = (v) => (e) => { e.preventDefault(); this.touch.hand = v; if (v) capture(lever, e); };
    lever.addEventListener('pointerdown', set(true));
    lever.addEventListener('pointerup', set(false));
    lever.addEventListener('pointercancel', set(false));
    lever.addEventListener('lostpointercapture', set(false));
  }

  clutchVisible() {
    return this.settings.shifterMode === 2 && this.settings.clutch;
  }

  // Pedalstellungen weich nachfuehren und zeichnen - ein Pedal springt nicht,
  // es faehrt in ein paar Hundertstel herunter.
  paintControls(dt) {
    const target = {
      gas: this.throttle, brake: this.brake,
      clutch: this.clutch, hand: this.handbrake,
    };
    let moving = false;
    for (const k of Object.keys(this.press)) {
      const d = target[k] - this.press[k];
      if (Math.abs(d) > 0.001) {
        this.press[k] += d * Math.min(1, (dt || 0.016) * 22);
        moving = true;
      } else if (this.press[k] !== target[k]) {
        this.press[k] = target[k]; moving = true;
      }
    }
    if (!moving && this.controlsDrawn) return;
    this.controlsDrawn = true;

    if (this.pedalCtx && this.pedalEl.offsetParent !== null) {
      paintPedalBox(this.pedalCtx, this.pedalEl.width, this.pedalEl.height,
                    this.press, this.clutchVisible());
    }
    if (this.leverCtx) {
      paintLever(this.leverCtx, this.leverEl.width, this.leverEl.height, this.press.hand);
    }
  }

  // Schalthebel: nach oben ziehen = hochschalten, nach unten = runter
  bindShifter() {
    const box = document.getElementById('shifter');
    if (!box) return;
    this.shifterBox = box;
    this.shifterKnob = document.getElementById('shiftKnob');
    this.gearReadout = document.getElementById('gearReadout');
    let startY = 0, fired = false;

    box.addEventListener('pointerdown', (e) => {
      capture(box, e);
      startY = e.clientY; fired = false;
      box.classList.add('grab');
      e.preventDefault();
    });
    box.addEventListener('pointermove', (e) => {
      if (!box.classList.contains('grab')) return;
      const dy = e.clientY - startY;
      this.shifterKnob.style.transform = `translateY(${clamp(dy, -26, 26)}px)`;
      if (!fired && Math.abs(dy) > 18) {
        this.shiftRequest = dy < 0 ? 1 : -1;
        fired = true;
      }
    });
    const end = () => {
      box.classList.remove('grab');
      if (this.shifterKnob) this.shifterKnob.style.transform = '';
    };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    box.addEventListener('lostpointercapture', end);

    document.getElementById('shiftUp')?.addEventListener('pointerdown', (e) => {
      e.preventDefault(); this.shiftRequest = 1;
    });
    document.getElementById('shiftDown')?.addEventListener('pointerdown', (e) => {
      e.preventDefault(); this.shiftRequest = -1;
    });
  }

  has(...codes) { return codes.some((c) => this.keys.has(c)); }

  // Sichtbarkeit der Bedienelemente an die Einstellungen anpassen
  syncVisibility() {
    const s = this.settings;
    const manual = s.shifterMode === 2;
    toggle(this.wheelBox, s.showWheel);
    toggle(document.getElementById('pedals'), s.showPedals);
    toggle(document.getElementById('pClutch'), s.showPedals && manual && s.clutch);
    toggle(document.getElementById('shifter'), s.shifterMode !== 0);
    const dn = document.getElementById('shiftDown'), up = document.getElementById('shiftUp');
    toggle(dn, manual); toggle(up, manual);
    this.controlsDrawn = false;     // erzwingt ein Neuzeichnen
    this.paintControls(0);
  }

  update(dt) {
    const s = this.settings;
    const left = this.has('KeyA', 'ArrowLeft');
    const right = this.has('KeyD', 'ArrowRight');
    const gas = this.has('KeyW', 'ArrowUp') || this.touch.gas;
    const brk = this.has('KeyS', 'ArrowDown') || this.touch.brake;
    const hb = this.has('Space') || this.touch.hand;
    const cl = this.has('KeyF') || this.touch.clutch;

    if (!this.dragging) {
      const dir = (right ? 1 : 0) - (left ? 1 : 0);
      if (dir !== 0) {
        this.wheelAngle = clamp(this.wheelAngle + dir * MAX_WHEEL * 2.2 * dt, -MAX_WHEEL, MAX_WHEEL);
      } else {
        const back = MAX_WHEEL * 2.4 * s.wheelReturn * dt;
        this.wheelAngle = Math.abs(this.wheelAngle) <= back
          ? 0 : this.wheelAngle - Math.sign(this.wheelAngle) * back;
      }
    }

    this.steer = clamp((this.wheelAngle / MAX_WHEEL) * s.wheelSens, -1, 1);
    this.throttle = gas ? 1 : 0;
    this.brake = brk ? 1 : 0;
    this.handbrake = hb ? 1 : 0;
    this.clutch = cl ? 1 : 0;

    this.paintControls(dt);
  }

  takeShift() { const r = this.shiftRequest; this.shiftRequest = 0; return r; }

  setGearLabel(g) {
    if (g === this.gearLabel) return;
    this.gearLabel = g;
    if (this.gearReadout) this.gearReadout.textContent = g;
  }

  // ------------------------------------------------------------ Lenkrad malen
  drawWheel(slip, handbrake) {
    const g = this.wheelCtx;
    if (!g || !this.settings.showWheel) return;
    const S = this.wheelCanvas.width, c = S / 2, R = S * 0.42;
    g.clearRect(0, 0, S, S);

    g.save();
    g.translate(c, c);
    g.beginPath(); g.arc(0, 0, R + 10, 0, Math.PI * 2);
    g.fillStyle = 'rgba(12,12,20,.55)'; g.fill();

    const d = Math.min(1, Math.abs(slip) / 0.75);
    if (d > 0.05) {
      g.beginPath();
      g.arc(0, 0, R + 6, -Math.PI / 2, -Math.PI / 2 + d * Math.PI * 2 * Math.sign(slip || 1), slip < 0);
      g.strokeStyle = handbrake ? '#ff5a3c' : `hsl(${50 - d * 45},95%,${55 + d * 10}%)`;
      g.lineWidth = 5; g.lineCap = 'round'; g.stroke();
    }

    g.rotate(this.wheelAngle);
    g.strokeStyle = '#15151f'; g.lineWidth = 15;
    g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#2f2f42'; g.lineWidth = 11;
    g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#4a4a66'; g.lineWidth = 3;
    g.beginPath(); g.arc(0, 0, R - 4, 0, Math.PI * 2); g.stroke();

    g.strokeStyle = '#2f2f42'; g.lineWidth = 9; g.lineCap = 'round';
    for (const a of [Math.PI, Math.PI * 0.18, Math.PI * 0.82]) {
      g.beginPath(); g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * (R - 4), Math.sin(a) * (R - 4));
      g.stroke();
    }
    g.beginPath(); g.arc(0, 0, R * 0.3, 0, Math.PI * 2);
    g.fillStyle = '#23233a'; g.fill();
    g.strokeStyle = '#4a4a66'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#ffd96b'; g.fillRect(-3, -R - 6, 6, 10);
    g.restore();
  }
}

// ------------------------------------------------------- Pedalerie zeichnen
// Blick des Fahrers in den Fussraum: Die Pedale haengen an Schwenkarmen, das
// Gaspedal ist wie ueblich am Boden gelagert. Die Trittflaechen sind
// Trapeze - oben schmaler, weil weiter weg - aus Alu mit Bohrungen und
// Gummistegen. Beim Treten wandern sie nach unten und kippen von der Kamera weg.
const PEDALS = [
  { key: 'clutch', label: 'KUPPLUNG', x: 0.205, wBot: 0.200, wTop: 0.166, top: 0.43, bot: 0.715, hinge: 'top' },
  { key: 'brake',  label: 'BREMSE',   x: 0.505, wBot: 0.250, wTop: 0.206, top: 0.41, bot: 0.715, hinge: 'top' },
  { key: 'gas',    label: 'GAS',      x: 0.820, wBot: 0.132, wTop: 0.102, top: 0.36, bot: 0.845, hinge: 'floor' },
];

let pedalBg = null;      // statischer Hintergrund, einmal vorgerendert

function paintPedalBox(g, W, H, press, showClutch) {
  if (!pedalBg || pedalBg.width !== W || pedalBg.height !== H || pedalBg.clutch !== showClutch) {
    pedalBg = makePedalBg(W, H, showClutch);
  }
  g.clearRect(0, 0, W, H);
  g.drawImage(pedalBg, 0, 0);
  for (const ped of PEDALS) {
    if (ped.key === 'clutch' && !showClutch) continue;
    drawPedal(g, W, H, ped, press[ped.key] || 0);
  }
}

// Fussraum: Spritzwand, Teppich und die Lagerungen - aendert sich nie
function makePedalBg(W, H, showClutch) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H; c.clutch = showClutch;
  const g = c.getContext('2d');

  g.fillStyle = 'rgba(8,8,14,.72)';
  roundRect(g, 0, 0, W, H, H * 0.09); g.fill();

  // Spritzwand oben, Teppich unten
  const wall = g.createLinearGradient(0, 0, 0, H * 0.62);
  wall.addColorStop(0, '#1b1b26');
  wall.addColorStop(1, '#101017');
  g.fillStyle = wall;
  roundRect(g, W * 0.02, H * 0.03, W * 0.96, H * 0.62, H * 0.06); g.fill();

  const rug = g.createLinearGradient(0, H * 0.55, 0, H);
  rug.addColorStop(0, '#24242f');
  rug.addColorStop(1, '#15151d');
  g.fillStyle = rug;
  g.beginPath();
  g.moveTo(W * 0.06, H * 0.58);
  g.lineTo(W * 0.94, H * 0.58);
  g.lineTo(W, H * 0.97);
  g.lineTo(0, H * 0.97);
  g.closePath(); g.fill();

  // Teppichstruktur
  for (let i = 0; i < W * 1.6; i++) {
    const y = H * 0.58 + Math.random() * H * 0.39;
    const x = Math.random() * W;
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.14)';
    g.fillRect(x, y, 2, 1);
  }
  // Fussleiste
  g.fillStyle = '#2e2e3c';
  g.fillRect(W * 0.04, H * 0.555, W * 0.92, 3);
  g.fillStyle = 'rgba(255,255,255,.1)';
  g.fillRect(W * 0.04, H * 0.555, W * 0.92, 1);

  // Quertraeger, an dem die haengenden Pedale sitzen
  const beam = g.createLinearGradient(0, H * 0.1, 0, H * 0.19);
  beam.addColorStop(0, '#3c3c4e');
  beam.addColorStop(0.4, '#262633');
  beam.addColorStop(1, '#15151d');
  g.fillStyle = beam;
  roundRect(g, W * 0.1, H * 0.1, W * 0.62, H * 0.09, 4); g.fill();
  g.fillStyle = 'rgba(255,255,255,.1)';
  g.fillRect(W * 0.1, H * 0.1, W * 0.62, 1.5);

  for (const ped of PEDALS) {
    if (ped.key === 'clutch' && !showClutch) continue;
    const cx = ped.x * W;
    if (ped.hinge === 'top') {
      g.fillStyle = '#31313f';
      roundRect(g, cx - W * 0.026, H * 0.12, W * 0.052, H * 0.07, 2); g.fill();
      bolt(g, cx, H * 0.145, Math.max(2.5, W * 0.013));
    }
  }

  // Fussstuetze links neben der Kupplung
  const fx = W * 0.082, fyT = H * 0.48, fyB = H * 0.76;
  g.beginPath();
  g.moveTo(fx - W * 0.03, fyT); g.lineTo(fx + W * 0.03, fyT);
  g.lineTo(fx + W * 0.042, fyB); g.lineTo(fx - W * 0.042, fyB);
  g.closePath();
  const rest = g.createLinearGradient(0, fyT, 0, fyB);
  rest.addColorStop(0, '#6d7381');
  rest.addColorStop(0.5, '#454b57');
  rest.addColorStop(1, '#5c6270');
  g.fillStyle = rest; g.fill();
  g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1; g.stroke();
  g.strokeStyle = 'rgba(255,255,255,.18)';
  for (let i = 1; i < 5; i++) {
    const t = i / 5, y = fyT + (fyB - fyT) * t;
    const hw = (0.03 + 0.012 * t) * W;
    g.beginPath(); g.moveTo(fx - hw + 2, y); g.lineTo(fx + hw - 2, y); g.stroke();
  }
  return c;
}

function drawPedal(g, W, H, ped, press) {
  const cx = ped.x * W;
  const travel = H * 0.075 * press;          // Pedalweg
  const yTop = ped.top * H + travel;
  const yBot = ped.bot * H + travel;
  // beim Treten kippt die Flaeche weg: oben wird sie breiter, unten schmaler
  const wTop = (ped.wTop + (ped.wBot - ped.wTop) * 0.45 * press) * W;
  const wBot = (ped.wBot - (ped.wBot - ped.wTop) * 0.25 * press) * W;

  // Schatten auf dem Boden
  g.save();
  g.globalAlpha = 0.5 - press * 0.22;
  g.fillStyle = '#000';
  g.beginPath();
  g.ellipse(cx + W * 0.012, yBot + H * 0.035, wBot * 0.62, H * 0.028, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // Schwenkarm als runder Stab (nur bei haengenden Pedalen sichtbar)
  if (ped.hinge === 'top') {
    const armW = Math.max(4, W * 0.026);
    const arm = g.createLinearGradient(cx - armW, 0, cx + armW, 0);
    arm.addColorStop(0, '#22222e');
    arm.addColorStop(0.35, '#6a6a80');
    arm.addColorStop(0.6, '#3d3d50');
    arm.addColorStop(1, '#1c1c26');
    g.strokeStyle = arm;
    g.lineWidth = armW;
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx, H * 0.145); g.lineTo(cx, yTop + H * 0.05); g.stroke();
  } else {
    // Bodenlager des Gaspedals
    bolt(g, cx, yBot + H * 0.012, Math.max(3, W * 0.016));
  }

  // Trittflaeche: Alurahmen
  pad(g, cx, yTop, yBot, wTop, wBot);
  const frame = g.createLinearGradient(cx - wBot / 2, yTop, cx + wBot / 2, yBot);
  frame.addColorStop(0, '#9aa0ad');
  frame.addColorStop(0.28, '#cdd3dd');
  frame.addColorStop(0.52, '#767c89');
  frame.addColorStop(0.78, '#a8aeba');
  frame.addColorStop(1, '#5a606c');
  g.fillStyle = frame;
  g.fill();

  // Kante oben hell, unten dunkel
  g.strokeStyle = 'rgba(255,255,255,.45)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(cx - wTop / 2, yTop); g.lineTo(cx + wTop / 2, yTop); g.stroke();
  g.strokeStyle = 'rgba(0,0,0,.6)';
  g.beginPath();
  g.moveTo(cx - wBot / 2, yBot); g.lineTo(cx + wBot / 2, yBot); g.stroke();

  // Gummieinlage mit Bohrungen
  const inset = 0.72;
  const iTop = yTop + (yBot - yTop) * 0.10, iBot = yBot - (yBot - yTop) * 0.10;
  const iwTop = wTop * inset, iwBot = wBot * inset;
  pad(g, cx, iTop, iBot, iwTop, iwBot);
  const rub = g.createLinearGradient(0, iTop, 0, iBot);
  rub.addColorStop(0, '#2a2a33');
  rub.addColorStop(1, '#16161c');
  g.fillStyle = rub;
  g.fill();

  g.save();
  pad(g, cx, iTop, iBot, iwTop, iwBot);
  g.clip();
  const rows = 3, cols = 2;
  for (let r = 0; r < rows; r++) {
    const t = (r + 0.5) / rows;
    const y = iTop + (iBot - iTop) * t;
    const w = iwTop + (iwBot - iwTop) * t;
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const x = cx + (cIdx - (cols - 1) / 2) * (w * 0.42);
      const rx = Math.max(2, w * 0.155), ry = rx * (0.46 + t * 0.3);
      g.fillStyle = '#0a0a0e';                       // Bohrung
      g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.22)';       // Lichtkante unten in der Bohrung
      g.lineWidth = 1;
      g.beginPath(); g.ellipse(x, y + 0.6, rx * 0.86, ry * 0.86, 0, 0.15 * Math.PI, 0.85 * Math.PI);
      g.stroke();
    }
    // Gummisteg zwischen den Lochreihen
    if (r < rows - 1) {
      const yb = iTop + (iBot - iTop) * ((r + 1) / rows);
      const wb = iwTop + (iwBot - iwTop) * ((r + 1) / rows);
      g.fillStyle = 'rgba(255,255,255,.07)';
      g.fillRect(cx - wb / 2, yb - 1, wb, 1);
      g.fillStyle = 'rgba(0,0,0,.4)';
      g.fillRect(cx - wb / 2, yb, wb, 1.4);
    }
  }
  g.restore();

  // Glanz ueber der Platte, wandert beim Treten
  g.save();
  pad(g, cx, yTop, yBot, wTop, wBot);
  g.clip();
  const sheen = g.createLinearGradient(cx - wBot / 2, yTop, cx + wBot / 2, yBot);
  sheen.addColorStop(Math.max(0, 0.15 + press * 0.3), 'rgba(255,255,255,0)');
  sheen.addColorStop(Math.min(0.98, 0.34 + press * 0.3), `rgba(255,255,255,${0.3 - press * 0.16})`);
  sheen.addColorStop(Math.min(1, 0.55 + press * 0.3), 'rgba(255,255,255,0)');
  g.fillStyle = sheen;
  g.fillRect(cx - wBot, yTop, wBot * 2, yBot - yTop);
  g.restore();

  // Rand
  pad(g, cx, yTop, yBot, wTop, wBot);
  g.strokeStyle = 'rgba(0,0,0,.55)';
  g.lineWidth = 1;
  g.stroke();

  // Beschriftung
  g.fillStyle = press > 0.5 ? '#ffd96b' : 'rgba(190,190,214,.85)';
  g.font = `bold ${Math.round(W * 0.036)}px "Courier New", monospace`;
  g.textAlign = 'center';
  g.fillText(ped.label, cx, H * 0.985);
}

// Trapez der Trittflaeche
function pad(g, cx, yTop, yBot, wTop, wBot) {
  g.beginPath();
  g.moveTo(cx - wTop / 2, yTop);
  g.lineTo(cx + wTop / 2, yTop);
  g.lineTo(cx + wBot / 2, yBot);
  g.lineTo(cx - wBot / 2, yBot);
  g.closePath();
}

function bolt(g, x, y, r) {
  const grd = g.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
  grd.addColorStop(0, '#c9cedb');
  grd.addColorStop(1, '#4a4f5c');
  g.fillStyle = grd;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1; g.stroke();
}

// Handbremse: verchromter Schaft im Faltenbalg, geriffelter Griff mit
// rotem Entriegelungsknopf. Angezogen kippt der Hebel nach oben.
function paintLever(g, W, H, press) {
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(8,8,14,.72)';
  roundRect(g, 0, H * 0.06, W, H * 0.9, H * 0.08); g.fill();

  // Mitteltunnel
  const tun = g.createLinearGradient(0, H * 0.6, 0, H * 0.95);
  tun.addColorStop(0, '#262633');
  tun.addColorStop(1, '#14141c');
  g.fillStyle = tun;
  g.beginPath();
  g.moveTo(W * 0.1, H * 0.66); g.lineTo(W * 0.9, H * 0.66);
  g.lineTo(W, H * 0.94); g.lineTo(0, H * 0.94);
  g.closePath(); g.fill();

  const px = W * 0.46, py = H * 0.78;
  const ang = -0.52 - press * 0.62;
  const len = H * 0.5;
  const ex = px + Math.cos(ang) * len, ey = py + Math.sin(ang) * len;

  // Faltenbalg am Fuss
  g.fillStyle = '#1a1a22';
  g.beginPath(); g.ellipse(px, py, W * 0.16, H * 0.055, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    g.beginPath();
    g.ellipse(px + Math.cos(ang) * len * 0.07 * i, py + Math.sin(ang) * len * 0.07 * i,
              W * (0.15 - i * 0.022), H * (0.05 - i * 0.007), 0, 0, Math.PI * 2);
    g.stroke();
  }

  // Schaft als Chromrohr
  const nx = -Math.sin(ang), ny = Math.cos(ang);
  const sw = Math.max(5, W * 0.1);
  const shaft = g.createLinearGradient(px + nx * sw, py + ny * sw, px - nx * sw, py - ny * sw);
  shaft.addColorStop(0, '#191922');
  shaft.addColorStop(0.3, '#b9c0cc');
  shaft.addColorStop(0.5, '#767d8b');
  shaft.addColorStop(0.75, '#e2e7ef');
  shaft.addColorStop(1, '#2a2a36');
  g.strokeStyle = shaft;
  g.lineWidth = sw;
  g.lineCap = 'butt';
  g.beginPath(); g.moveTo(px, py); g.lineTo(ex, ey); g.stroke();

  // Griff
  g.save();
  g.translate(ex, ey);
  g.rotate(ang);
  const gw = H * 0.3, gh = Math.max(9, W * 0.2);
  const grip = g.createLinearGradient(0, -gh / 2, 0, gh / 2);
  grip.addColorStop(0, '#41414f');
  grip.addColorStop(0.4, '#23232e');
  grip.addColorStop(1, '#101016');
  g.fillStyle = grip;
  roundRect(g, -gw * 0.72, -gh / 2, gw, gh, gh * 0.45); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1;
  roundRect(g, -gw * 0.72, -gh / 2, gw, gh, gh * 0.45); g.stroke();
  // Riffelung
  g.strokeStyle = 'rgba(255,255,255,.1)';
  for (let i = 1; i < 6; i++) {
    const x = -gw * 0.72 + (gw / 6) * i;
    g.beginPath(); g.moveTo(x, -gh * 0.34); g.lineTo(x, gh * 0.34); g.stroke();
  }
  // Entriegelungsknopf
  g.fillStyle = press > 0.5 ? '#ff7a5e' : '#c4453a';
  roundRect(g, gw * 0.14, -gh * 0.28, gw * 0.16, gh * 0.56, 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,.3)';
  g.fillRect(gw * 0.14, -gh * 0.28, gw * 0.16, 1.5);
  g.restore();

  g.fillStyle = press > 0.5 ? '#ff8a6a' : 'rgba(190,190,214,.85)';
  g.font = `bold ${Math.round(W * 0.13)}px "Courier New", monospace`;
  g.textAlign = 'center';
  g.fillText('HANDBREMSE', W / 2, H * 0.995);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Zeiger am Element festhalten. Schlaegt das fehl, darf die Bedienung
// trotzdem weiterlaufen - sonst bliebe das Element beim Ziehen haengen.
function capture(el, e) {
  try { el.setPointerCapture?.(e.pointerId); } catch { /* Zeiger nicht mehr aktiv */ }
}

function toggle(el, on) { if (el) el.style.display = on ? '' : 'none'; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
