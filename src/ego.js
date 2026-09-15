// Ego-Perspektive: Blick aus dem Fahrzeug in echter Zentralprojektion.
//
// Der Boden entsteht wie bei den alten Konsolen-Rennspielen zeilenweise: Fuer
// jede Bildzeile unterhalb des Horizonts steht fest, in welcher Entfernung sie
// den Boden trifft. Daraus laesst sich eine affine Abbildung Welt -> Bildschirm
// aufstellen, mit der die vorgerenderte Weltkarte streifenweise gezeichnet wird.
// Haeuser und Hindernisse werden anschliessend als echte Koerper projiziert.

import { T, TILE } from './world.js';

const FOV = 1.15;          // horizontaler Bildwinkel in rad
const CAM_H = 7.6;         // Augenhoehe in Weltpixeln (1 m = 6 px)
const NEAR = 7;            // alles naeher als das wird abgeschnitten
const FAR = 1250;
const STRIP = 2;           // Hoehe eines Bodenstreifens in Bildpunkten

export class EgoView {
  constructor(viewW, viewH) {
    this.W = viewW;
    this.H = viewH;
    this.focal = (viewW / 2) / Math.tan(FOV / 2);
    this.horizon = Math.round(viewH * 0.44);
  }

  // Kamera aus Fahrzeuglage ableiten
  setCamera(car, bob) {
    const fx = Math.cos(car.heading), fy = Math.sin(car.heading);
    this.cx = car.x + fx * car.spec.len * 0.05;
    this.cy = car.y + fy * car.spec.len * 0.05;
    this.fx = fx; this.fy = fy;
    this.rx = -fy; this.ry = fx;        // Blickrichtung nach rechts (y zeigt nach unten)
    this.camH = CAM_H + bob;
  }

  // Weltpunkt -> Kameraraum (vorne, rechts)
  toCam(x, y) {
    const dx = x - this.cx, dy = y - this.cy;
    return { f: dx * this.fx + dy * this.fy, r: dx * this.rx + dy * this.ry };
  }

  // Punkt auf Hoehe h ueber dem Boden projizieren
  project(x, y, h) {
    const { f, r } = this.toCam(x, y);
    if (f < NEAR) return null;
    return {
      x: this.W / 2 + (this.focal * r) / f,
      y: this.horizon + (this.focal * (this.camH - h)) / f,
      f,
    };
  }

  projectCam(f, r, h) {
    return {
      x: this.W / 2 + (this.focal * r) / f,
      y: this.horizon + (this.focal * (this.camH - h)) / f,
      f,
    };
  }

  // ---------------------------------------------------------------- Himmel
  drawSky(g, ambient, weather) {
    const grd = g.createLinearGradient(0, 0, 0, this.horizon + 2);
    if (ambient === 2) {                       // Nacht
      grd.addColorStop(0, '#05060f');
      grd.addColorStop(0.7, '#141a33');
      grd.addColorStop(1, '#1a2040');
    } else if (ambient === 1) {                // Abend
      grd.addColorStop(0, '#1c2140');
      grd.addColorStop(0.55, '#5b4a5e');
      grd.addColorStop(1, '#96745f');
    } else {                                   // Tag
      grd.addColorStop(0, '#5d7fb0');
      grd.addColorStop(0.7, '#9db6d4');
      grd.addColorStop(1, '#bacadb');
    }
    g.fillStyle = grd;
    g.fillRect(0, 0, this.W, this.horizon + 2);

    if (weather) {                             // trueber Himmel bei Niederschlag
      g.fillStyle = weather === 1 ? 'rgba(40,46,60,.55)' : 'rgba(190,200,215,.45)';
      g.fillRect(0, 0, this.W, this.horizon + 2);
    }
  }

  // ------------------------------------------------------------- Bodenebene
  // Je Streifen eine affine Abbildung aufstellen und die Weltkarte einsetzen.
  drawGround(g, world, rs, skid) {
    const { focal, horizon, W, H } = this;
    for (let y = horizon + 1; y < H; y += STRIP) {
      const rowsBelow = y - horizon;
      const d = (focal * this.camH) / rowsBelow;
      if (d > FAR) continue;

      const kx = focal / d;
      const ky = -(rowsBelow * rowsBelow) / (focal * this.camH);

      const a = kx * this.rx, c = kx * this.ry;
      const b = ky * this.fx, dd = ky * this.fy;
      const e = W / 2 - kx * (this.cx * this.rx + this.cy * this.ry);
      const f = y - ky * (this.cx * this.fx + this.cy * this.fy) - ky * d;

      // sichtbarer Abschnitt dieser Zeile als Ausschnitt der Weltkarte:
      // beide Endpunkte der Linie bestimmen und daraus das Rechteck bilden
      const half = (d * (W / 2)) / focal + TILE * 2;
      const mx = this.cx + this.fx * d, my = this.cy + this.fy * d;
      const ax = mx - this.rx * half, bx2 = mx + this.rx * half;
      const ay = my - this.ry * half, by2 = my + this.ry * half;
      const x0 = Math.max(0, Math.min(ax, bx2) - TILE);
      const x1 = Math.min(world.worldW, Math.max(ax, bx2) + TILE);
      const y0 = Math.max(0, Math.min(ay, by2) - TILE);
      const y1 = Math.min(world.worldH, Math.max(ay, by2) + TILE);
      if (x1 <= x0 || y1 <= y0) continue;

      g.save();
      // Die Maske wird im aktuellen Koordinatensystem gesetzt, das bereits
      // mit rs skaliert ist - hier also nicht noch einmal multiplizieren.
      g.beginPath();
      g.rect(0, y, W, STRIP + 0.6);
      g.clip();
      g.setTransform(a * rs, b * rs, c * rs, dd * rs, e * rs, f * rs);
      g.drawImage(world.canvas, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
      if (skid && d < 420) {
        g.drawImage(world.skid.canvas, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
      }
      g.restore();
    }
    g.setTransform(rs, 0, 0, rs, 0, 0);
  }

  // ---------------------------------------------------------------- Haeuser
  drawBuildings(g, world) {
    const list = [];
    for (const b of world.buildings.concat(world.blocks || [])) {
      const dx = b.cx - this.cx, dy = b.cy - this.cy;
      const f = dx * this.fx + dy * this.fy;
      if (f < -80 || f > FAR) continue;
      const r = dx * this.rx + dy * this.ry;
      if (Math.abs(r) > f * 1.6 + 260) continue;       // klar ausserhalb des Blickfelds
      b._f = f;
      list.push(b);
    }
    list.sort((p, q) => q._f - p._f);                  // hinten zuerst

    for (const b of list) {
      const corners = [
        [b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h],
      ].map(([x, y]) => {
        const { f, r } = this.toCam(x, y);
        return { f, r };
      });

      // Waende: nur die, deren Aussenseite zur Kamera zeigt
      for (let i = 0; i < 4; i++) {
        const p0 = corners[i], p1 = corners[(i + 1) % 4];
        // Sichtbarkeit ueber das Vorzeichen der Flaeche im Kameraraum
        if (p0.r * p1.f - p1.r * p0.f > 0) continue;
        const quad = this.clipQuad([
          { f: p0.f, r: p0.r, h: 0 }, { f: p1.f, r: p1.r, h: 0 },
          { f: p1.f, r: p1.r, h: b.height }, { f: p0.f, r: p0.r, h: b.height },
        ]);
        if (!quad) continue;
        const shadeF = Math.min(1, 0.45 + 0.55 * Math.min(1, 220 / Math.max(40, (p0.f + p1.f) / 2)));
        g.fillStyle = i % 2 ? b.wallA : b.wallB;
        this.fillPoly(g, quad);
        g.fillStyle = `rgba(0,0,0,${0.45 - shadeF * 0.3})`;
        this.fillPoly(g, quad);
      }

      // Dachflaeche
      const roof = this.clipQuad(corners.map((p) => ({ f: p.f, r: p.r, h: b.height })));
      if (roof) {
        g.fillStyle = b.roof;
        this.fillPoly(g, roof);
        g.strokeStyle = 'rgba(0,0,0,.45)';
        g.lineWidth = 1;
        g.stroke();
      }
    }
  }

  // Polygon an der vorderen Ebene abschneiden, sonst kippen Punkte hinter der
  // Kamera das Bild
  clipQuad(pts) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i], nxt = pts[(i + 1) % pts.length];
      const curIn = cur.f >= NEAR, nxtIn = nxt.f >= NEAR;
      if (curIn) out.push(cur);
      if (curIn !== nxtIn) {
        const t = (NEAR - cur.f) / (nxt.f - cur.f);
        out.push({
          f: NEAR,
          r: cur.r + (nxt.r - cur.r) * t,
          h: cur.h + (nxt.h - cur.h) * t,
        });
      }
    }
    if (out.length < 3) return null;
    return out.map((p) => this.projectCam(p.f, p.r, p.h));
  }

  fillPoly(g, pts) {
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.closePath();
    g.fill();
  }

  // ------------------------------------------------------------- Hindernisse
  drawProps(g, world) {
    const items = [];
    for (const p of world.props) {
      const { f, r } = this.toCam(p.x, p.y);
      if (f < NEAR || f > 520) continue;
      if (Math.abs(r) > f * 1.2 + 60) continue;
      items.push({ p, f, r });
    }
    items.sort((a, b) => b.f - a.f);
    for (const it of items) {
      const size = it.p.type === 'cone' ? 7 : 8;
      const h = it.p.hit > 0 ? 2 : size;
      const base = this.projectCam(it.f, it.r, 0);
      const top = this.projectCam(it.f, it.r, h);
      const w = (this.focal * size * 0.8) / it.f;
      if (w < 0.6) continue;
      const hgt = base.y - top.y;

      g.fillStyle = 'rgba(0,0,0,.4)';
      g.beginPath();
      g.ellipse(base.x, base.y, w * 0.7, w * 0.25, 0, 0, Math.PI * 2);
      g.fill();

      if (it.p.type === 'cone') {
        g.fillStyle = it.p.hit > 0 ? '#b8581f' : '#e9762c';
        g.beginPath();
        g.moveTo(base.x - w / 2, base.y);
        g.lineTo(base.x + w / 2, base.y);
        g.lineTo(base.x + w * 0.16, top.y);
        g.lineTo(base.x - w * 0.16, top.y);
        g.closePath(); g.fill();
        g.fillStyle = '#f4f4fa';
        g.fillRect(base.x - w * 0.32, base.y - hgt * 0.55, w * 0.64, Math.max(1, hgt * 0.16));
      } else {
        g.fillStyle = it.p.hit > 0 ? '#5d6874' : '#8996a4';
        g.fillRect(base.x - w / 2, top.y, w, hgt);
        g.fillStyle = '#c0392b';
        g.fillRect(base.x - w / 2, top.y + hgt * 0.4, w, Math.max(1, hgt * 0.2));
        g.fillStyle = 'rgba(255,255,255,.18)';
        g.fillRect(base.x - w / 2, top.y, w * 0.25, hgt);
      }
    }
  }

  // ------------------------------------------------- Scheinwerfer und Licht
  // Der Lichtkegel wird als Flaeche auf dem Boden projiziert, nicht als Sprite.
  drawHeadlights(g, ambient) {
    if (!ambient) return;
    const near = 26, far = 300;
    const spread = 0.42;
    const pts = [];
    for (const [f, r] of [[near, -near * spread], [far, -far * spread],
                          [far, far * spread], [near, near * spread]]) {
      pts.push(this.projectCam(f, r, 0));
    }
    const grd = g.createLinearGradient(0, pts[0].y, 0, pts[1].y);
    grd.addColorStop(0, 'rgba(255,238,190,.38)');
    grd.addColorStop(0.45, 'rgba(255,236,180,.16)');
    grd.addColorStop(1, 'rgba(255,234,170,0)');
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = grd;
    this.fillPoly(g, pts);
    g.restore();
  }

  // ---------------------------------------------------------------- Cockpit
  // Blick ueber die Motorhaube: Haube, Saeulen, Dachkante, Armaturenbrett und
  // ein Lenkrad, das sich mitdreht.
  drawCockpit(g, car, steer, braking) {
    const { W, H } = this;
    const body = car.spec.body;

    // Dachkante und Innenspiegel
    g.fillStyle = 'rgba(10,10,16,.92)';
    g.fillRect(0, 0, W, H * 0.055);
    g.fillStyle = '#15151d';
    roundRectPath(g, W / 2 - W * 0.09, H * 0.045, W * 0.18, H * 0.042, 3);
    g.fill();
    g.fillStyle = '#2b3546';
    g.fillRect(W / 2 - W * 0.082, H * 0.05, W * 0.164, H * 0.03);

    // A-Saeulen
    g.fillStyle = 'rgba(14,14,20,.95)';
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(W * 0.1, 0); g.lineTo(0, H * 0.72); g.closePath(); g.fill();
    g.beginPath();
    g.moveTo(W, 0); g.lineTo(W * 0.9, 0); g.lineTo(W, H * 0.72); g.closePath(); g.fill();

    // Motorhaube
    const hoodTop = H * 0.72;
    const grd = g.createLinearGradient(0, hoodTop, 0, H);
    grd.addColorStop(0, shade(body, -0.34));
    grd.addColorStop(0.35, body);
    grd.addColorStop(1, shade(body, -0.55));
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(-W * 0.05, H);
    g.lineTo(W * 0.1, hoodTop + H * 0.03);
    g.quadraticCurveTo(W / 2, hoodTop - H * 0.05, W * 0.9, hoodTop + H * 0.03);
    g.lineTo(W * 1.05, H);
    g.closePath();
    g.fill();
    // Sicke auf der Haube
    g.strokeStyle = 'rgba(255,255,255,.13)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(W * 0.3, H); g.quadraticCurveTo(W * 0.42, hoodTop + H * 0.06, W * 0.46, hoodTop + H * 0.02);
    g.stroke();
    g.beginPath();
    g.moveTo(W * 0.7, H); g.quadraticCurveTo(W * 0.58, hoodTop + H * 0.06, W * 0.54, hoodTop + H * 0.02);
    g.stroke();

    // Armaturenbrett
    g.fillStyle = '#0f0f16';
    g.beginPath();
    g.moveTo(0, H);
    g.lineTo(0, H * 0.80);
    g.quadraticCurveTo(W / 2, H * 0.70, W, H * 0.80);
    g.lineTo(W, H);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,.08)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, H * 0.805);
    g.quadraticCurveTo(W / 2, H * 0.705, W, H * 0.805);
    g.stroke();

    // Lenkrad
    const wx = W * 0.5, wy = H * 1.0, wr = H * 0.23;
    g.save();
    g.translate(wx, wy);
    g.rotate(steer * 0.9);
    g.strokeStyle = '#15151f';
    g.lineWidth = wr * 0.22;
    g.beginPath(); g.arc(0, 0, wr, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#2f2f42';
    g.lineWidth = wr * 0.15;
    g.beginPath(); g.arc(0, 0, wr, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#3c3c52';
    g.lineWidth = wr * 0.16;
    for (const a of [Math.PI, Math.PI * 1.75, Math.PI * 1.25]) {
      g.beginPath(); g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * wr, Math.sin(a) * wr); g.stroke();
    }
    g.fillStyle = '#23233a';
    g.beginPath(); g.arc(0, 0, wr * 0.3, 0, Math.PI * 2); g.fill();
    g.fillStyle = braking ? '#ff5a3c' : '#ffd96b';
    g.fillRect(-wr * 0.06, -wr - wr * 0.14, wr * 0.12, wr * 0.2);
    g.restore();
  }

  // ------------------------------------------------------------------ Nebel
  drawFog(g, ambient, weather) {
    const col = ambient === 2 ? 'rgba(26,32,58,' : ambient === 1 ? 'rgba(150,116,104,' : 'rgba(186,202,218,';
    const depth = this.H * 0.5;
    const grd = g.createLinearGradient(0, this.horizon - 1, 0, this.horizon + depth);
    grd.addColorStop(0, col + (weather ? 0.92 : 0.8) + ')');
    grd.addColorStop(0.35, col + (weather ? 0.4 : 0.3) + ')');
    grd.addColorStop(1, col + '0)');
    g.fillStyle = grd;
    g.fillRect(0, this.horizon - 1, this.W, depth);
    // schmaler Dunstsaum genau auf der Horizontlinie
    g.fillStyle = col + '0.5)';
    g.fillRect(0, this.horizon - 2, this.W, 3);
  }
}

function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g2 = (n >> 8) & 255, b = n & 255;
  const f = (v) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  return `rgb(${f(r)},${f(g2)},${f(b)})`;
}
