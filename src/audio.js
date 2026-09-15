// Minimaler prozeduraler Sound: Motor (2 Oszillatoren), Reifenquietschen
// (gefiltertes Rauschen) und ein Crash-Noise-Burst. Kein Asset noetig.

export class Sfx {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.enabled = true;
    this.started = false;
  }

  get masterVol() { return this.enabled ? this.settings.volMaster : 0; }

  applySettings() {
    if (this.master) this.master.gain.value = this.masterVol;
  }

  start() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    const ctx = new AC();
    this.ctx = ctx;
    this.started = true;

    this.master = ctx.createGain();
    this.master.gain.value = this.masterVol;
    this.master.connect(ctx.destination);

    // --- Motor
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    const engFilter = ctx.createBiquadFilter();
    engFilter.type = 'lowpass'; engFilter.frequency.value = 1400;
    this.engGain.connect(engFilter); engFilter.connect(this.master);

    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'square';
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    this.osc1.connect(this.engGain); this.osc2.connect(g2); g2.connect(this.engGain);
    this.osc1.frequency.value = 60; this.osc2.frequency.value = 30;
    this.osc1.start(); this.osc2.start();

    // --- Rauschquelle fuer Reifen + Crash
    this.noiseBuf = this.makeNoise(ctx, 2);
    this.tire = ctx.createBufferSource();
    this.tire.buffer = this.noiseBuf; this.tire.loop = true;
    this.tireFilter = ctx.createBiquadFilter();
    this.tireFilter.type = 'bandpass';
    this.tireFilter.frequency.value = 1800; this.tireFilter.Q.value = 5;
    this.tireGain = ctx.createGain(); this.tireGain.gain.value = 0;
    this.tire.connect(this.tireFilter); this.tireFilter.connect(this.tireGain);
    this.tireGain.connect(this.master);
    this.tire.start();
  }

  makeNoise(ctx, sec) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  toggle() {
    this.enabled = !this.enabled;
    this.applySettings();
    return this.enabled;
  }

  // rpm 0..1 (Drehzahl), load 0..1 (Gas), squeal 0..1 (Reifen)
  update(rpm, load, squeal, limiter) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const st = this.settings;
    // Am Begrenzer stottert die Zuendung hoerbar
    const cut = limiter && ((t * 40) % 2 < 1) ? 0.35 : 1;
    const base = 55 + rpm * 260;
    this.osc1.frequency.setTargetAtTime(base, t, 0.04);
    this.osc2.frequency.setTargetAtTime(base * 0.5, t, 0.04);
    this.engGain.gain.setTargetAtTime((0.055 + load * 0.075) * st.volEngine * cut, t, 0.07);
    this.tireGain.gain.setTargetAtTime(squeal * 0.16 * st.volTires, t, 0.05);
    this.tireFilter.frequency.setTargetAtTime(1200 + squeal * 1600, t, 0.08);
  }

  crash(power) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.5, 0.12 + power * 0.05), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.4);
  }

  blip(freq = 660, dur = 0.09) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
}
