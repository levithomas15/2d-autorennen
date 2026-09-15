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
      box.setPointerCapture(e.pointerId);
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
        if (v) el.setPointerCapture?.(e.pointerId);
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
      box.setPointerCapture(e.pointerId);
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

function toggle(el, on) { if (el) el.style.display = on ? '' : 'none'; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
