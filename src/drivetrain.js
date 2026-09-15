// Antriebsstrang: Drehmomentkurve, Turbo mit Ladedruckaufbau und Getriebe.
// Modus 'off'  -> Arcade, kein Getriebe (leistungsbegrenzte Schubkraft)
// Modus 'auto' -> Getriebe schaltet selbst
// Modus 'man'  -> Spieler schaltet, optional mit Kupplung

const WHEEL_R = 0.31;          // Reifenradius in m
const RPM_PER_RAD = 60 / (2 * Math.PI);

export class Drivetrain {
  constructor(spec) { this.setSpec(spec); this.reset(); }

  setSpec(spec) { this.spec = spec; }

  reset() {
    this.gear = 1;             // -1 = R, 0 = N, 1..n = Vorwaertsgaenge
    this.rpm = this.spec.idle;
    this.boost = 0;
    this.shiftTimer = 0;
    this.limiter = 0;
    this.lastShift = 0;
    this.stalled = false;
  }

  get gearLabel() {
    if (this.gear === -1) return 'R';
    if (this.gear === 0) return 'N';
    return String(this.gear);
  }
  get topGear() { return this.spec.gears.length; }
  get ratio() {
    if (this.gear === -1) return -this.spec.gears[0] * 1.08;
    if (this.gear === 0) return 0;
    return this.spec.gears[this.gear - 1];
  }

  shiftUp() {
    if (this.shiftTimer > 0) return false;
    if (this.gear >= this.topGear) return false;
    this.gear = this.gear + 1 === 0 ? 1 : this.gear + 1;   // R -> 1 (N ueberspringen beim Hochschalten aus R)
    this.shiftTimer = this.spec.shiftTime;
    return true;
  }

  shiftDown() {
    if (this.shiftTimer > 0) return false;
    if (this.gear <= -1) return false;
    this.gear -= 1;
    this.shiftTimer = this.spec.shiftTime;
    return true;
  }

  rpmForSpeed(vLong, ratio) {
    if (!ratio) return 0;
    const wheelRad = Math.abs(vLong) / WHEEL_R;             // rad/s
    return wheelRad * Math.abs(ratio) * this.spec.final * RPM_PER_RAD;
  }

  // normierte Drehmomentkurve: sanfter Anstieg, Maximum bei peakRpm, Abfall darueber
  torqueFactor(rpm) {
    const s = this.spec;
    const x = rpm / s.peakRpm;
    let f;
    if (x < 1) f = 0.55 + 0.45 * Math.pow(x, 0.75);
    else f = 1 - 0.55 * Math.pow((rpm - s.peakRpm) / (s.redline - s.peakRpm), 1.6);
    return Math.max(0.22, Math.min(1, f));
  }

  /**
   * @returns {{force:number, rpm:number, gearLabel:string, boost:number,
   *            shifting:boolean, limiter:boolean, wantSpin:number}}
   */
  update(dt, ctl, vLong) {
    const s = this.spec;
    const mode = ctl.mode;
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    this.limiter = Math.max(0, this.limiter - dt);

    // ---------------------------------------------------- Arcade ohne Getriebe
    if (mode === 'off') {
      const v = Math.max(1.5, Math.abs(vLong));
      const fMax = Math.min(s.arcadeForce, s.power / v);
      let force = 0;
      if (ctl.throttle > 0) force += fMax * ctl.throttle * (vLong < -0.5 ? 1.6 : 1);
      if (ctl.brake > 0) {
        if (vLong > 0.5) force -= s.arcadeForce * 1.25 * ctl.brake;
        else force -= Math.min(s.arcadeForce * 0.5, s.power * 0.35 / v) * ctl.brake;
      }
      this.rpm = s.idle + Math.min(1, Math.abs(vLong) / 42) * (s.redline - s.idle);
      this.boost += ((s.boostMax > 0 ? ctl.throttle : 0) - this.boost) * Math.min(1, s.spool * dt);
      return {
        force: force * (1 + this.boost * s.boostMax * 0.6),
        rpm: this.rpm, gearLabel: '-', boost: this.boost,
        shifting: false, limiter: false, wantSpin: ctl.throttle,
      };
    }

    // --------------------------------------------------------- mit Getriebe
    const clutchIn = ctl.clutch > 0.5 || this.shiftTimer > 0;

    // Automatik: Gang waehlen
    if (mode === 'auto') this.autoShift(dt, ctl, vLong);

    const ratio = this.ratio;
    let rpmTarget;
    if (ratio === 0 || clutchIn) {
      rpmTarget = s.idle + ctl.throttle * (s.redline * 0.82 - s.idle);
    } else {
      rpmTarget = this.rpmForSpeed(vLong, ratio);
      // Kupplung rutscht beim Anfahren, damit der Motor nicht abstirbt
      const launch = s.idle + ctl.throttle * 2600;
      if (rpmTarget < launch) rpmTarget = launch * (0.55 + 0.45 * Math.min(1, Math.abs(vLong) / 6)) + rpmTarget * 0.2;
    }
    const follow = ratio === 0 || clutchIn ? 4.5 : 12;
    this.rpm += (rpmTarget - this.rpm) * Math.min(1, follow * dt);
    this.rpm = Math.max(s.idle * 0.7, this.rpm);

    // Drehzahlbegrenzer
    let cut = 1;
    if (this.rpm > s.redline) {
      this.rpm = s.redline + (this.rpm - s.redline) * 0.25;
      this.limiter = 0.12;
      cut = 0.12;
    }

    // Ladedruck: baut sich mit Drehzahl und Gas auf, faellt ohne Gas ab
    const boostTarget = s.boostMax > 0
      ? ctl.throttle * Math.min(1, Math.max(0, (this.rpm / s.redline - 0.28) / 0.45))
      : 0;
    const spoolRate = boostTarget > this.boost ? s.spool : s.spool * 2.2;
    this.boost += (boostTarget - this.boost) * Math.min(1, spoolRate * dt);

    let force = 0;
    if (!clutchIn && ratio !== 0) {
      const torque = s.peakTorque * this.torqueFactor(this.rpm) * (1 + this.boost * s.boostMax);
      const drive = (torque * ratio * s.final * 0.92) / WHEEL_R;
      force += drive * ctl.throttle * cut;
      // Motorbremse
      if (ctl.throttle < 0.05) {
        force -= Math.sign(ratio) * (s.peakTorque * 0.09 * Math.abs(ratio) * s.final) / WHEEL_R
                 * Math.min(1, this.rpm / s.peakRpm);
      }
    }

    // Bremse wirkt immer
    if (ctl.brake > 0) {
      if (vLong > 0.3) force -= s.arcadeForce * 1.3 * ctl.brake;
      else if (vLong < -0.3) force += s.arcadeForce * 1.3 * ctl.brake;
      else force -= Math.sign(vLong) * s.arcadeForce * 0.4 * ctl.brake;
    }

    return {
      force,
      rpm: this.rpm,
      gearLabel: this.gearLabel,
      boost: this.boost,
      shifting: this.shiftTimer > 0,
      limiter: this.limiter > 0,
      wantSpin: clutchIn ? 0 : ctl.throttle * Math.min(1, 2.2 / Math.max(0.4, Math.abs(ratio))),
    };
  }

  autoShift(dt, ctl, vLong) {
    const s = this.spec;
    this.lastShift = Math.max(0, this.lastShift - dt);
    const stopped = Math.abs(vLong) < 0.8;

    // Rueckwaerts automatisch einlegen, wenn im Stand gebremst wird
    if (stopped && ctl.brake > 0.5 && this.gear >= 0) { this.gear = -1; this.lastShift = 0.4; return; }
    if (this.gear === -1 && stopped && ctl.throttle > 0.5) { this.gear = 1; this.lastShift = 0.4; return; }
    if (this.gear === -1) return;
    if (this.gear === 0) { this.gear = 1; return; }
    if (this.lastShift > 0 || this.shiftTimer > 0) return;

    const up = s.redline * 0.93;
    const down = s.redline * 0.42;
    if (this.rpm > up && this.gear < this.topGear && ctl.throttle > 0.1) {
      this.shiftUp(); this.lastShift = 0.35;
    } else if (this.gear > 1) {
      // Drehzahl im naechstniedrigeren Gang abschaetzen
      const nextRpm = this.rpmForSpeed(vLong, s.gears[this.gear - 2]);
      if (this.rpm < down && nextRpm < s.redline * 0.9) { this.shiftDown(); this.lastShift = 0.35; }
    }
  }
}
