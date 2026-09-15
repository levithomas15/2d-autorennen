// Lichtsystem: baut pro Frame eine Lichtkarte in Bildschirmgroesse auf und
// multipliziert sie ueber die Szene. Dadurch wird die Umgebung abgedunkelt und
// nur dort aufgehellt, wo Lampen, Fenster, Scheinwerfer oder Neon leuchten.
// Ein zweiter, additiver Durchgang erzeugt den Schein um helle Quellen.

const SPRITE = 128;

export class LightLayer {
  constructor(w, h) {
    // Zwei Ebenen: nur die Lichter (additiv) und daraus die fertige
    // Helligkeitskarte. Getrennt, damit der Schein nicht das Umgebungslicht
    // mitaddiert und dadurch die dunklen Flaechen aufhellt.
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.mix = document.createElement('canvas');
    this.mix.width = w; this.mix.height = h;
    this.mixCtx = this.mix.getContext('2d');
    this.sprites = new Map();
    this.cones = new Map();
  }

  // weiche runde Lichtquelle, einmal je Farbe vorgerendert
  spriteFor(color) {
    let s = this.sprites.get(color);
    if (s) return s;
    s = document.createElement('canvas');
    s.width = s.height = SPRITE;
    const g = s.getContext('2d');
    const r = SPRITE / 2;
    const grd = g.createRadialGradient(r, r, 1, r, r, r);
    grd.addColorStop(0, rgba(color, 1));
    grd.addColorStop(0.35, rgba(color, 0.55));
    grd.addColorStop(0.7, rgba(color, 0.16));
    grd.addColorStop(1, rgba(color, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, SPRITE, SPRITE);
    this.sprites.set(color, s);
    return s;
  }

  // Scheinwerferkegel: mehrere Keile von schmal-hell nach breit-schwach,
  // dadurch laeuft der Rand weich aus statt hart abzuschneiden.
  coneFor(color) {
    let s = this.cones.get(color);
    if (s) return s;
    s = document.createElement('canvas');
    s.width = s.height = SPRITE;
    const g = s.getContext('2d');
    const r = SPRITE / 2;
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const spread = 0.16 + i * 0.1;
      const a = 0.34 - i * 0.055;
      const grd = g.createRadialGradient(r, r, 2, r, r, r);
      grd.addColorStop(0, rgba(color, a * 2.6));
      grd.addColorStop(0.4, rgba(color, a * 1.3));
      grd.addColorStop(1, rgba(color, 0));
      g.save();
      g.beginPath();
      g.moveTo(r, r);
      g.arc(r, r, r, -spread, spread);
      g.closePath();
      g.clip();
      g.fillStyle = grd;
      g.fillRect(0, 0, SPRITE, SPRITE);
      g.restore();
    }
    this.cones.set(color, s);
    return s;
  }

  begin() {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.globalCompositeOperation = 'lighter';
  }

  // Weltkoordinaten -> gleiche Transformation wie die Szene
  setTransform(zoom, ox, oy) {
    this.ctx.setTransform(zoom, 0, 0, zoom, -ox * zoom, -oy * zoom);
  }

  point(x, y, radius, color, intensity = 1) {
    if (intensity <= 0.01) return;
    const s = this.spriteFor(color);
    this.ctx.globalAlpha = Math.min(1, intensity);
    this.ctx.drawImage(s, x - radius, y - radius, radius * 2, radius * 2);
  }

  cone(x, y, heading, length, color, intensity = 1) {
    const s = this.coneFor(color);
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    c.rotate(heading);
    c.globalAlpha = Math.min(1, intensity);
    c.drawImage(s, -length, -length, length * 2, length * 2);
    c.restore();
  }

  // Helligkeitskarte ueber die Szene multiplizieren, danach nur die
  // Lichtebene additiv als Schein daruebergeben.
  composite(target, ambient, bloom = 0.25) {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';

    const m = this.mixCtx;
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.globalCompositeOperation = 'source-over';
    m.globalAlpha = 1;
    m.fillStyle = ambient;
    m.fillRect(0, 0, this.mix.width, this.mix.height);
    m.globalCompositeOperation = 'lighter';
    m.drawImage(this.canvas, 0, 0);

    target.save();
    target.globalCompositeOperation = 'multiply';
    target.drawImage(this.mix, 0, 0);
    if (bloom > 0) {
      target.globalCompositeOperation = 'lighter';
      target.globalAlpha = bloom;
      target.drawImage(this.canvas, 0, 0);
    }
    target.restore();
  }
}

function rgba(hex, a) {
  if (hex[0] !== '#') return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Umgebungslicht je Tageszeit: 0 = Tag, 1 = Abend, 2 = Nacht
export const AMBIENT = [null, '#9c8f9b', '#4e5788'];
export const AMBIENT_NAME = ['TAG', 'ABEND', 'NACHT'];
