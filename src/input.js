// Eingabe: Tastatur + drehbares Lenkrad (Maus/Touch) + Touch-Pedale.
// Das Lenkrad ist gleichzeitig Anzeige und Bedienelement.

const MAX_WHEEL = 2.5;   // rad Lenkradausschlag bei Vollausschlag

export class Input {
  constructor() {
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = 0;
    this.steer = 0;
    this.wheelAngle = 0;

    this.keys = new Set();
    this.keySteer = 0;
    this.dragging = false;
    this.dragStart = 0;
    this.dragBase = 0;
    this.touchGas = false;
    this.touchBrake = false;
    this.touchHand = false;
    this.onKey = null;   // Callback fuer Einmal-Tasten (R, C, M)

    this.bindKeyboard();
    this.bindWheel();
    this.bindPedals();
  }

  bindKeyboard() {
    const handled = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
    addEventListener('keydown', (e) => {
      if (handled.has(e.code)) e.preventDefault();
      if (!e.repeat && this.onKey) this.onKey(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  bindWheel() {
    const box = document.getElementById('wheelBox');
    if (!box) return;
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
    const hook = (id, set) => {
      const el = document.getElementById(id);
      if (!el) return;
      const on = (v) => (e) => {
        e.preventDefault();
        set(v); el.classList.toggle('down', v);
        if (v) el.setPointerCapture?.(e.pointerId);
      };
      el.addEventListener('pointerdown', on(true));
      el.addEventListener('pointerup', on(false));
      el.addEventListener('pointercancel', on(false));
      el.addEventListener('pointerleave', (e) => { if (!el.hasPointerCapture?.(e.pointerId)) { set(false); el.classList.remove('down'); } });
    };
    hook('pGas', (v) => (this.touchGas = v));
    hook('pBrake', (v) => (this.touchBrake = v));
    hook('pHand', (v) => (this.touchHand = v));
  }

  has(...codes) { return codes.some((c) => this.keys.has(c)); }

  update(dt) {
    const left = this.has('KeyA', 'ArrowLeft');
    const right = this.has('KeyD', 'ArrowRight');
    const gas = this.has('KeyW', 'ArrowUp') || this.touchGas;
    const brk = this.has('KeyS', 'ArrowDown') || this.touchBrake;
    const hb = this.has('Space') || this.touchHand;

    // Lenkrad per Tastatur drehen bzw. selbststaendig zurueckstellen
    if (!this.dragging) {
      const dir = (right ? 1 : 0) - (left ? 1 : 0);
      if (dir !== 0) {
        this.wheelAngle = clamp(this.wheelAngle + dir * MAX_WHEEL * 2.2 * dt, -MAX_WHEEL, MAX_WHEEL);
      } else {
        const back = MAX_WHEEL * 3.4 * dt;
        this.wheelAngle = Math.abs(this.wheelAngle) <= back ? 0 : this.wheelAngle - Math.sign(this.wheelAngle) * back;
      }
    }

    this.steer = clamp(this.wheelAngle / MAX_WHEEL, -1, 1);
    this.throttle = gas ? 1 : 0;
    this.brake = brk ? 1 : 0;
    this.handbrake = hb ? 1 : 0;
  }

  // ------------------------------------------------------------ Lenkrad malen
  drawWheel(slip, handbrake) {
    const g = this.wheelCtx;
    if (!g) return;
    const S = this.wheelCanvas.width, c = S / 2, R = S * 0.42;
    g.clearRect(0, 0, S, S);

    // Gehaeuse
    g.save();
    g.translate(c, c);
    g.beginPath(); g.arc(0, 0, R + 10, 0, Math.PI * 2);
    g.fillStyle = 'rgba(12,12,20,.55)'; g.fill();

    // Drift-Anzeige als Ring um das Lenkrad
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

    // Speichen
    g.strokeStyle = '#2f2f42'; g.lineWidth = 9; g.lineCap = 'round';
    for (const a of [Math.PI, Math.PI * 0.18, Math.PI * 0.82]) {
      g.beginPath(); g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * (R - 4), Math.sin(a) * (R - 4));
      g.stroke();
    }
    // Nabe + Markierung oben
    g.beginPath(); g.arc(0, 0, R * 0.3, 0, Math.PI * 2);
    g.fillStyle = '#23233a'; g.fill();
    g.strokeStyle = '#4a4a66'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#ffd96b';
    g.fillRect(-3, -R - 6, 6, 10);
    g.restore();
  }
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
