// Stadt-Generator + Pre-Rendering im GTA2-Pixel-Look.
// Die komplette Karte wird einmal auf ein Offscreen-Canvas gemalt und danach
// pro Frame nur noch als Ausschnitt geblittet.

export const TILE = 16;
export const MAP_W = 104;
export const MAP_H = 104;
export const WORLD_W = MAP_W * TILE;
export const WORLD_H = MAP_H * TILE;

export const T = {
  ROAD: 0,
  CROSS: 1,
  SIDEWALK: 2,
  BUILDING: 3,
  LOT: 4,
  GRASS: 5,
  ARENA: 6,
};

const SOLID = new Set([T.BUILDING]);

// deterministischer RNG, damit die Stadt bei jedem Start gleich aussieht
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PAL = {
  road:      ['#35353f', '#3a3a45', '#31313b'],
  cross:     '#3f3f4a',
  line:      '#d9cf6e',
  sidewalk:  ['#6b6b79', '#676774'],
  kerb:      '#84848f',
  lot:       '#464651',
  grass:     ['#39653f', '#40704a', '#345c3b'],
  arena:     ['#44444e', '#464651'],
  arenaMark: '#5c5c6a',
  roofs:     ['#7a4a3a', '#6b5a3f', '#4e5a6b', '#6a4055', '#55603f', '#5d5560', '#7a6640'],
  wallShade: 'rgba(0,0,0,.45)',
};

export class World {
  constructor(seed = 1337) {
    this.rng = mulberry32(seed);
    this.tiles = new Uint8Array(MAP_W * MAP_H);
    this.blockGrid = 13;   // Abstand der Strassenachsen in Tiles
    this.roadW = 4;        // Strassenbreite in Tiles
    this.buildings = [];   // {x,y,w,h} in Weltpixeln, fuer Kollision
    this.props = [];       // Kegel / Fasser -> umfahrbar, geben Punkte
    this.generate();
    this.canvas = this.render();
    this.skid = this.makeSkidLayer();
  }

  idx(tx, ty) { return ty * MAP_W + tx; }

  get(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return T.BUILDING;
    return this.tiles[this.idx(tx, ty)];
  }

  isRoadTile(tx, ty) {
    const t = this.get(tx, ty);
    return t === T.ROAD || t === T.CROSS || t === T.ARENA || t === T.LOT;
  }

  // ---------------------------------------------------------------- Generator
  generate() {
    const { blockGrid, roadW } = this;
    const onRoad = (v) => (v % blockGrid) < roadW;

    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        const rx = onRoad(tx), ry = onRoad(ty);
        let t;
        if (rx && ry) t = T.CROSS;
        else if (rx || ry) t = T.ROAD;
        else t = T.SIDEWALK;      // wird gleich zu Block-Inhalt
        this.tiles[this.idx(tx, ty)] = t;
      }
    }

    // Block-Inhalte: Gebaeude, Parkplaetze, Gruenflaechen
    for (let by = 0; by < MAP_H; by += blockGrid) {
      for (let bx = 0; bx < MAP_W; bx += blockGrid) {
        const x0 = bx + roadW, y0 = by + roadW;
        const x1 = Math.min(bx + blockGrid, MAP_W), y1 = Math.min(by + blockGrid, MAP_H);
        if (x1 - x0 < 3 || y1 - y0 < 3) continue;
        this.fillBlock(x0 + 1, y0 + 1, x1 - 1, y1 - 1);
      }
    }

    this.carveArena();
    this.collectBuildings();
    this.scatterProps();
  }

  // ein Stadtblock: Rand = Buergersteig, innen Haeuser/Parkplatz/Park
  fillBlock(x0, y0, x1, y1) {
    const r = this.rng;
    const kind = r();
    const w = x1 - x0, h = y1 - y0;
    if (w < 2 || h < 2) return;

    if (kind < 0.16) {                       // Park
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) this.tiles[this.idx(x, y)] = T.GRASS;
      return;
    }
    if (kind < 0.30) {                       // Parkplatz -> gut zum Driften
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) this.tiles[this.idx(x, y)] = T.LOT;
      return;
    }

    // Haeuserzeile: Block in 1-3 Teile splitten
    const cols = 1 + (r() < 0.6 ? 1 : 0);
    const rows = 1 + (r() < 0.6 ? 1 : 0);
    const cw = Math.floor(w / cols), ch = Math.floor(h / rows);
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        if (r() < 0.14) continue;            // Luecke = Hinterhof
        const ax = x0 + cx * cw, ay = y0 + cy * ch;
        const aw = (cx === cols - 1 ? x1 - ax : cw) - (cols > 1 ? 1 : 0);
        const ah = (cy === rows - 1 ? y1 - ay : ch) - (rows > 1 ? 1 : 0);
        if (aw < 1 || ah < 1) continue;
        for (let y = ay; y < ay + ah; y++)
          for (let x = ax; x < ax + aw; x++) this.tiles[this.idx(x, y)] = T.BUILDING;
      }
    }
  }

  // Grosse freie Drift-Arena in der Kartenmitte
  carveArena() {
    const cx = MAP_W >> 1, cy = MAP_H >> 1, rad = 15;
    for (let ty = cy - rad; ty <= cy + rad; ty++) {
      for (let tx = cx - rad; tx <= cx + rad; tx++) {
        if (tx < 1 || ty < 1 || tx >= MAP_W - 1 || ty >= MAP_H - 1) continue;
        const d = Math.hypot(tx - cx, ty - cy);
        if (d <= rad) this.tiles[this.idx(tx, ty)] = T.ARENA;
      }
    }
    this.arena = { x: cx * TILE, y: cy * TILE, r: rad * TILE };
  }

  // zusammenhaengende Gebaeude-Tiles zu Rechtecken zusammenfassen (Kollision)
  collectBuildings() {
    const seen = new Uint8Array(MAP_W * MAP_H);
    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        const i = this.idx(tx, ty);
        if (seen[i] || !SOLID.has(this.tiles[i])) continue;
        // maximale Breite
        let w = 0;
        while (tx + w < MAP_W && SOLID.has(this.get(tx + w, ty)) && !seen[this.idx(tx + w, ty)]) w++;
        // maximale Hoehe bei dieser Breite
        let h = 0;
        outer: while (ty + h < MAP_H) {
          for (let k = 0; k < w; k++) {
            const j = this.idx(tx + k, ty + h);
            if (!SOLID.has(this.tiles[j]) || seen[j]) break outer;
          }
          h++;
        }
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) seen[this.idx(tx + x, ty + y)] = 1;
        this.buildings.push({ x: tx * TILE, y: ty * TILE, w: w * TILE, h: h * TILE });
      }
    }
  }

  scatterProps() {
    const r = this.rng;
    const a = this.arena;
    // Kegel-Kreis in der Arena
    for (let i = 0; i < 26; i++) {
      const ang = (i / 26) * Math.PI * 2;
      this.props.push({
        x: a.x + Math.cos(ang) * (a.r * 0.62),
        y: a.y + Math.sin(ang) * (a.r * 0.62),
        type: 'cone', hit: 0, vx: 0, vy: 0,
      });
    }
    // Kegel/Fasser auf Parkplaetzen
    for (let n = 0; n < 220; n++) {
      const tx = 2 + Math.floor(r() * (MAP_W - 4));
      const ty = 2 + Math.floor(r() * (MAP_H - 4));
      if (this.get(tx, ty) !== T.LOT) continue;
      this.props.push({
        x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2,
        type: r() < 0.5 ? 'cone' : 'barrel', hit: 0, vx: 0, vy: 0,
      });
    }
  }

  // ------------------------------------------------------------- Pre-Rendering
  render() {
    const c = document.createElement('canvas');
    c.width = WORLD_W; c.height = WORLD_H;
    const g = c.getContext('2d');
    const r = this.rng;

    g.fillStyle = '#23232b';
    g.fillRect(0, 0, WORLD_W, WORLD_H);

    // Boden-Tiles
    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        const t = this.get(tx, ty);
        const x = tx * TILE, y = ty * TILE;
        switch (t) {
          case T.ROAD:
            g.fillStyle = PAL.road[(tx * 7 + ty * 3) % PAL.road.length];
            g.fillRect(x, y, TILE, TILE);
            break;
          case T.CROSS:
            g.fillStyle = PAL.cross; g.fillRect(x, y, TILE, TILE); break;
          case T.SIDEWALK:
            g.fillStyle = PAL.sidewalk[(tx + ty) & 1];
            g.fillRect(x, y, TILE, TILE); break;
          case T.BUILDING:
            g.fillStyle = '#1d1d24'; g.fillRect(x, y, TILE, TILE); break;
          case T.LOT:
            g.fillStyle = PAL.lot; g.fillRect(x, y, TILE, TILE); break;
          case T.GRASS:
            g.fillStyle = PAL.grass[(tx * 5 + ty * 11) % PAL.grass.length];
            g.fillRect(x, y, TILE, TILE); break;
          case T.ARENA:
            g.fillStyle = PAL.arena[(tx + ty) & 1];
            g.fillRect(x, y, TILE, TILE); break;
        }
      }
    }

    this.paintKerbs(g);
    this.paintRoadMarkings(g);
    this.paintArena(g);
    this.paintBuildings(g, r);
    this.paintGrain(g, r);
    return c;
  }

  paintKerbs(g) {
    g.fillStyle = PAL.kerb;
    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        if (this.get(tx, ty) !== T.SIDEWALK) continue;
        const x = tx * TILE, y = ty * TILE;
        if (this.isRoadTile(tx, ty - 1)) g.fillRect(x, y, TILE, 2);
        if (this.isRoadTile(tx, ty + 1)) g.fillRect(x, y + TILE - 2, TILE, 2);
        if (this.isRoadTile(tx - 1, ty)) g.fillRect(x, y, 2, TILE);
        if (this.isRoadTile(tx + 1, ty)) g.fillRect(x + TILE - 2, y, 2, TILE);
      }
    }
  }

  paintRoadMarkings(g) {
    const { blockGrid, roadW } = this;
    g.fillStyle = PAL.line;
    const mid = (roadW * TILE) / 2;

    for (let b = 0; b < MAP_W; b += blockGrid) {           // vertikale Strassen
      const cx = b * TILE + mid - 1;
      for (let y = 0; y < WORLD_H; y += 24) {
        const ty = Math.floor((y + 6) / TILE);
        if (this.get(b + 1, ty) !== T.ROAD || this.get(b + 1, ty + 1) !== T.ROAD) continue;
        g.fillRect(cx, y, 2, 12);
      }
    }
    for (let b = 0; b < MAP_H; b += blockGrid) {           // horizontale Strassen
      const cy = b * TILE + mid - 1;
      for (let x = 0; x < WORLD_W; x += 24) {
        const tx = Math.floor((x + 6) / TILE);
        if (this.get(tx, b + 1) !== T.ROAD || this.get(tx + 1, b + 1) !== T.ROAD) continue;
        g.fillRect(x, cy, 12, 2);
      }
    }

    // Zebrastreifen an den Kreuzungsraendern
    g.fillStyle = 'rgba(210,210,220,.55)';
    for (let by = 0; by < MAP_H; by += blockGrid) {
      for (let bx = 0; bx < MAP_W; bx += blockGrid) {
        const x = bx * TILE, y = by * TILE, s = roadW * TILE;
        const road = (px, py) => {
          const t = this.get(Math.floor(px / TILE), Math.floor(py / TILE));
          return t === T.ROAD || t === T.CROSS;
        };
        for (let i = 2; i < s - 2; i += 6) {
          if (road(x + i, y - 4)) g.fillRect(x + i, y - 7, 3, 6);
          if (road(x + i, y + s + 4)) g.fillRect(x + i, y + s + 1, 3, 6);
          if (road(x - 4, y + i)) g.fillRect(x - 7, y + i, 6, 3);
          if (road(x + s + 4, y + i)) g.fillRect(x + s + 1, y + i, 6, 3);
        }
      }
    }
  }

  paintArena(g) {
    const a = this.arena;
    g.save();
    g.strokeStyle = PAL.arenaMark; g.lineWidth = 3;
    g.beginPath(); g.arc(a.x, a.y, a.r * 0.62, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(a.x, a.y, a.r * 0.3, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(255,215,110,.35)'; g.lineWidth = 4;
    g.beginPath(); g.arc(a.x, a.y, a.r - 6, 0, Math.PI * 2); g.stroke();
    // Startfeld-Karos in der Mitte
    for (let y = 0; y < 6; y++)
      for (let x = 0; x < 6; x++) {
        g.fillStyle = ((x + y) & 1) ? '#d8d8e0' : '#2a2a32';
        g.fillRect(a.x - 24 + x * 8, a.y - 24 + y * 8, 8, 8);
      }
    g.restore();
  }

  // Faux-3D-Extrusion: Wand nach unten-rechts, dann Dach obendrauf
  paintBuildings(g, r) {
    const ex = 5, ey = 6;
    for (const b of this.buildings) {
      const roof = PAL.roofs[Math.floor(r() * PAL.roofs.length)];
      g.fillStyle = 'rgba(0,0,0,.35)';
      g.fillRect(b.x + ex, b.y + ey, b.w, b.h);              // Schlagschatten
      g.fillStyle = shade(roof, -0.45);
      g.fillRect(b.x, b.y, b.w + ex, b.h + ey);              // Wandflaechen
      g.fillStyle = PAL.wallShade;
      g.fillRect(b.x, b.y + b.h, b.w + ex, ey);
      g.fillStyle = roof;
      g.fillRect(b.x, b.y, b.w, b.h);                        // Dach
      g.fillStyle = shade(roof, 0.18);
      g.fillRect(b.x, b.y, b.w, 2);
      g.fillStyle = shade(roof, -0.2);
      g.fillRect(b.x, b.y + b.h - 2, b.w, 2);

      // Dachdetails: Lueftung, Kanten, Fenster an der Wandseite
      g.fillStyle = shade(roof, -0.3);
      for (let i = 0; i < Math.max(1, (b.w * b.h) / 2600); i++) {
        const w = 6 + Math.floor(r() * 10), h = 6 + Math.floor(r() * 10);
        if (b.w - w - 6 <= 4 || b.h - h - 6 <= 4) continue;
        g.fillRect(b.x + 4 + Math.floor(r() * (b.w - w - 6)),
                   b.y + 4 + Math.floor(r() * (b.h - h - 6)), w, h);
      }
      g.fillStyle = 'rgba(255,220,150,.5)';
      for (let x = b.x + 3; x < b.x + b.w - 2; x += 7) {
        if (r() < 0.45) g.fillRect(x, b.y + b.h + 1, 3, 3);
      }
    }
  }

  paintGrain(g, r) {
    g.globalAlpha = 0.05;
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = r() < 0.5 ? '#000' : '#fff';
      g.fillRect(Math.floor(r() * WORLD_W), Math.floor(r() * WORLD_H), 1, 1);
    }
    g.globalAlpha = 1;
  }

  makeSkidLayer() {
    const c = document.createElement('canvas');
    c.width = WORLD_W; c.height = WORLD_H;
    return { canvas: c, ctx: c.getContext('2d') };
  }

  clearSkids() {
    this.skid.ctx.clearRect(0, 0, WORLD_W, WORLD_H);
  }

  // Reifenspuren langsam verblassen lassen, damit die Karte nicht zuschmiert
  fadeSkids() {
    const g = this.skid.ctx;
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = 'rgba(0,0,0,0.035)';
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    g.globalCompositeOperation = 'source-over';
  }

  // --------------------------------------------------------------- Kollision
  // Kreis gegen Gebaeude-Rechtecke; liefert Korrekturvektor + Normale
  resolveCircle(x, y, radius) {
    let hit = null;
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    const span = Math.ceil(radius / TILE) + 1;
    for (let j = ty - span; j <= ty + span; j++) {
      for (let i = tx - span; i <= tx + span; i++) {
        if (this.get(i, j) !== T.BUILDING) continue;
        const bx = i * TILE, by = j * TILE;
        const nx = Math.max(bx, Math.min(x, bx + TILE));
        const ny = Math.max(by, Math.min(y, by + TILE));
        const dx = x - nx, dy = y - ny;
        const d2 = dx * dx + dy * dy;
        if (d2 >= radius * radius) continue;
        let d = Math.sqrt(d2), ux, uy;
        if (d < 0.0001) {           // Mittelpunkt steckt im Tile
          const cxr = bx + TILE / 2, cyr = by + TILE / 2;
          ux = x - cxr; uy = y - cyr;
          const l = Math.hypot(ux, uy) || 1;
          ux /= l; uy /= l; d = 0.01;
        } else { ux = dx / d; uy = dy / d; }
        const push = radius - d;
        if (!hit || push > hit.push) hit = { nx: ux, ny: uy, push };
      }
    }
    return hit;
  }

  surfaceAt(x, y) {
    const t = this.get(Math.floor(x / TILE), Math.floor(y / TILE));
    if (t === T.GRASS) return { grip: 0.55, drag: 2.6, dust: '#6b8f5e' };
    if (t === T.SIDEWALK) return { grip: 0.9, drag: 1.4, dust: '#9a9aa8' };
    return { grip: 1, drag: 1, dust: '#6e6e78' };
  }
}

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (v) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
