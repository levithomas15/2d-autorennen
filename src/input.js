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

  bindPedals() {
    const hook = (id, name) => {
      const el = document.getElementById(id);
      if (!el) return;
      const set = (v) => (e) => {
        e.preventDefault();
        this.touch[name] = v;
        el.classList.toggle('down', v);
        if (v) capture(el, e);
      };
      el.addEventListener('pointerdown', set(true));
      el.addEventListener('pointerup', set(false));
      el.addEventListener('pointercancel', set(false));
      el.addEventListener('pointerleave', (e) => {
        if (!el.hasPointerCapture?.(e.pointerId)) { this.touch[name] = false; el.classList.remove('down'); }
      });
    };
    hook('pGas', 'gas'); hook('pBrake', 'brake');
    hook('pHand', 'hand'); hook('pClutch', 'clutch');

    this.pedals = [
      { el: document.getElementById('pGas'), kind: 'gas', label: 'GAS' },
      { el: document.getElementById('pBrake'), kind: 'brake', label: 'BREMSE' },
      { el: document.getElementById('pClutch'), kind: 'clutch', label: 'KUPPLUNG' },
    ].filter((p) => p.el);
    this.leverEl = document.getElementById('pHand');
    this.pedalState = '';
  }

  // Pedalerie und Handbremshebel neu zeichnen, wenn sich etwas geaendert hat
  paintControls() {
    const key = [this.touch.gas || this.throttle, this.touch.brake || this.brake,
                 this.touch.clutch || this.clutch, this.touch.hand || this.handbrake].join('|');
    if (key === this.pedalState) return;
    this.pedalState = key;

    const pressedOf = { gas: this.throttle > 0, brake: this.brake > 0, clutch: this.clutch > 0 };
    for (const p of this.pedals) {
      if (p.el.offsetParent === null) continue;      // ausgeblendet
      paintPedal(p.el.getContext('2d'), p.el.width, p.el.height, p.kind, p.label, pressedOf[p.kind]);
    }
    if (this.leverEl) {
      paintLever(this.leverEl.getContext('2d'), this.leverEl.width, this.leverEl.height, this.handbrake > 0);
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
    this.pedalState = '';          // erzwingt ein Neuzeichnen
    this.paintControls();
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

    this.paintControls();
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
// Ein Pedal besteht aus Bodenplatte, Schwenkarm und Trittflaeche mit Riffelung.
// Beim Treten wandert die Flaeche nach unten und der Arm wird kuerzer.
const PEDAL_TINT = {
  gas: ['#3f7a45', '#66c06f'],
  brake: ['#7a3a35', '#d4584c'],
  clutch: ['#39507a', '#6e97d8'],
};

function paintPedal(g, W, H, kind, label, pressed) {
  g.clearRect(0, 0, W, H);
  const [dark, bright] = PEDAL_TINT[kind] || PEDAL_TINT.brake;
  const travel = pressed ? H * 0.11 : 0;
  const padW = W * 0.78, padH = H * 0.46;
  const padX = (W - padW) / 2, padY = H * 0.30 + travel;

  // Bodenplatte und Lagerbock
  g.fillStyle = 'rgba(12,12,20,.62)';
  roundRect(g, W * 0.08, H * 0.04, W * 0.84, H * 0.92, 10); g.fill();
  g.fillStyle = '#23233a';
  roundRect(g, W * 0.3, H * 0.06, W * 0.4, H * 0.12, 4); g.fill();

  // Schwenkarm
  g.strokeStyle = '#4a4a66';
  g.lineWidth = Math.max(4, W * 0.14);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(W / 2, H * 0.13);
  g.lineTo(W / 2, padY + padH * 0.2);
  g.stroke();

  // Trittflaeche
  const grd = g.createLinearGradient(0, padY, 0, padY + padH);
  grd.addColorStop(0, pressed ? bright : '#4d4d66');
  grd.addColorStop(1, pressed ? dark : '#2b2b42');
  g.fillStyle = grd;
  roundRect(g, padX, padY, padW, padH, 7); g.fill();
  g.strokeStyle = pressed ? bright : '#6a6a90';
  g.lineWidth = 2;
  roundRect(g, padX, padY, padW, padH, 7); g.stroke();

  // Riffelung des Gummis
  g.strokeStyle = pressed ? 'rgba(0,0,0,.45)' : 'rgba(0,0,0,.4)';
  g.lineWidth = 2;
  for (let i = 1; i < 5; i++) {
    const y = padY + (padH / 5) * i;
    g.beginPath(); g.moveTo(padX + 6, y); g.lineTo(padX + padW - 6, y); g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,.12)';
  roundRect(g, padX + 4, padY + 3, padW - 8, 3, 2); g.fill();

  // Beschriftung unter dem Pedal
  g.fillStyle = pressed ? bright : '#9a9ab8';
  g.font = `bold ${Math.round(W * (label.length > 6 ? 0.135 : 0.17))}px "Courier New", monospace`;
  g.textAlign = 'center';
  g.fillText(label, W / 2, H * 0.94);
}

// Handbremse als Hebel: angezogen kippt er nach oben
function paintLever(g, W, H, pulled) {
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(12,12,20,.62)';
  roundRect(g, W * 0.06, H * 0.12, W * 0.88, H * 0.82, 10); g.fill();

  // Konsole
  g.fillStyle = '#23233a';
  roundRect(g, W * 0.2, H * 0.62, W * 0.6, H * 0.22, 6); g.fill();

  const px = W * 0.5, py = H * 0.7;
  const ang = pulled ? -1.15 : -0.5;
  const len = H * 0.46;
  const ex = px + Math.cos(ang) * len, ey = py + Math.sin(ang) * len;

  g.strokeStyle = '#5a5a7c';
  g.lineWidth = Math.max(5, W * 0.13);
  g.lineCap = 'round';
  g.beginPath(); g.moveTo(px, py); g.lineTo(ex, ey); g.stroke();
  g.strokeStyle = '#3a3a55';
  g.lineWidth = Math.max(2, W * 0.05);
  g.beginPath(); g.moveTo(px, py); g.lineTo(ex, ey); g.stroke();

  // Griff
  g.fillStyle = pulled ? '#ff6a4a' : '#2f2f48';
  g.beginPath(); g.arc(ex, ey, W * 0.15, 0, Math.PI * 2); g.fill();
  g.strokeStyle = pulled ? '#ffb199' : '#6d6d94';
  g.lineWidth = 2; g.stroke();

  g.fillStyle = pulled ? '#ff6a4a' : '#9a9ab8';
  g.font = `bold ${Math.round(W * 0.115)}px "Courier New", monospace`;
  g.textAlign = 'center';
  g.fillText('HANDBREMSE', W / 2, H * 0.97);
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
