// Welt: Kacheln, Kollisionsgeometrie und einmaliges Vorab-Rendering.
// Die eigentliche Form einer Karte kommt aus src/maps.js - diese Klasse
// stellt nur die Bau-Werkzeuge, das Rendering und die Physik-Abfragen.

export const TILE = 16;

export const T = {
  ROAD: 0, CROSS: 1, SIDEWALK: 2, BUILDING: 3, LOT: 4, GRASS: 5, ARENA: 6,
  WATER: 7, SAND: 8, SNOW: 9, ICE: 10, DIRT: 11, CONCRETE: 12, CLIFF: 13, WALL: 14,
};

const SOLID = new Set([T.BUILDING, T.WATER, T.CLIFF, T.WALL]);

// Griffigkeit, Rollwiderstand und Staubfarbe je Untergrund
const SURFACE = {
  [T.ROAD]:     { grip: 1.00, drag: 1.0, dust: '#6e6e78' },
  [T.CROSS]:    { grip: 1.00, drag: 1.0, dust: '#6e6e78' },
  [T.ARENA]:    { grip: 1.00, drag: 1.0, dust: '#6e6e78' },
  [T.LOT]:      { grip: 1.00, drag: 1.0, dust: '#6e6e78' },
  [T.CONCRETE]: { grip: 0.98, drag: 1.0, dust: '#8a8a94' },
  [T.SIDEWALK]: { grip: 0.90, drag: 1.4, dust: '#9a9aa8' },
  [T.DIRT]:     { grip: 0.70, drag: 1.8, dust: '#9c7a4e' },
  [T.GRASS]:    { grip: 0.55, drag: 2.6, dust: '#6b8f5e' },
  [T.SAND]:     { grip: 0.50, drag: 3.2, dust: '#d8c48a' },
  [T.SNOW]:     { grip: 0.45, drag: 2.0, dust: '#e6ecf5' },
  [T.ICE]:      { grip: 0.22, drag: 0.8, dust: '#cfe6f2' },
};
const DEFAULT_SURFACE = { grip: 1, drag: 1, dust: '#6e6e78' };

const BASE_PAL = {
  road:      ['#35353f', '#3a3a45', '#31313b'],
  cross:     '#3f3f4a',
  line:      '#d9cf6e',
  sidewalk:  ['#6b6b79', '#676774'],
  kerb:      '#84848f',
  lot:       '#464651',
  grass:     ['#39653f', '#40704a', '#345c3b'],
  arena:     ['#44444e', '#464651'],
  arenaMark: '#5c5c6a',
  water:     ['#1d3a56', '#1a3450', '#20405e'],
  sand:      ['#c9b078', '#c3a970', '#cfb681'],
  snow:      ['#d8dee8', '#d2d9e4', '#dde3ec'],
  ice:       ['#a9c9dc', '#b3d2e4'],
  dirt:      ['#6b5336', '#73593b', '#645031'],
  concrete:  ['#585863', '#5d5d68', '#545460'],
  cliff:     ['#3a3a42', '#42424b', '#33333b'],
  wall:      '#5a5a6e',
  roofs:     ['#7a4a3a', '#6b5a3f', '#4e5a6b', '#6a4055', '#55603f', '#5d5560', '#7a6640'],
  wallShade: 'rgba(0,0,0,.45)',
  ground:    '#23232b',
};

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class World {
  // opts.tilesOnly: nur Kacheln erzeugen (fuer Vorschaubilder), kein Rendering
  constructor(map, opts = {}) {
    this.map = map;
    this.w = map.w; this.h = map.h;
    this.worldW = this.w * TILE;
    this.worldH = this.h * TILE;
    this.pal = Object.assign({}, BASE_PAL, map.palette || {});
    this.rng = mulberry32(map.seed);
    this.tiles = new Uint8Array(this.w * this.h).fill(map.base ?? T.GRASS);
    this.buildings = [];       // nur fuer die Fassaden-Darstellung
    this.props = [];
    this.decals = [];          // vom Kartenbauer nachgereichte Malbefehle
    this.lights = [];          // statische Lichtquellen (Laternen, Fenster, Schilder)
    this.statics = [];         // Baeume, Laternenmasten, Hydranten - im Vorab-Rendering
    this.spawn = { x: this.worldW / 2, y: this.worldH / 2, h: 0 };

    map.build(this);
    if (opts.tilesOnly) return;

    this.hasWater = this.tiles.includes(T.WATER);
    this.collectBuildings();
    this.assignBuildingLooks();
    this.canvas = this.render();
    this.roofCanvas = this.renderRoofs();
    this.skid = this.makeSkidLayer();
  }

  // -------------------------------------------------------- Bau-Werkzeuge
  rnd() { return this.rng(); }
  rndInt(a, b) { return a + Math.floor(this.rng() * (b - a + 1)); }
  pick(arr) { return arr[Math.floor(this.rng() * arr.length)]; }

  idx(tx, ty) { return ty * this.w + tx; }
  inside(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }

  get(tx, ty) {
    if (!this.inside(tx, ty)) return T.BUILDING;
    return this.tiles[this.idx(tx, ty)];
  }

  set(tx, ty, t) {
    if (this.inside(tx, ty)) this.tiles[this.idx(tx, ty)] = t;
  }

  fill(x0, y0, x1, y1, t) {
    for (let y = Math.max(0, y0); y < Math.min(this.h, y1); y++)
      for (let x = Math.max(0, x0); x < Math.min(this.w, x1); x++) this.tiles[this.idx(x, y)] = t;
  }

  outline(x0, y0, x1, y1, t, thickness = 1) {
    for (let i = 0; i < thickness; i++) {
      for (let x = x0 + i; x < x1 - i; x++) { this.set(x, y0 + i, t); this.set(x, y1 - 1 - i, t); }
      for (let y = y0 + i; y < y1 - i; y++) { this.set(x0 + i, y, t); this.set(x1 - 1 - i, y, t); }
    }
  }

  disc(cx, cy, r, t) {
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r2) this.set(x, y, t);
      }
  }

  ring(cx, cy, rInner, rOuter, t) {
    const ri2 = rInner * rInner, ro2 = rOuter * rOuter;
    for (let y = Math.floor(cy - rOuter); y <= Math.ceil(cy + rOuter); y++)
      for (let x = Math.floor(cx - rOuter); x <= Math.ceil(cx + rOuter); x++) {
        const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
        if (d2 >= ri2 && d2 <= ro2) this.set(x, y, t);
      }
  }

  // breiter Strich von A nach B - fuer Passstrassen und Rundkurse
  stroke(x0, y0, x1, y1, radius, t) {
    const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      this.disc(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, radius, t);
    }
  }

  // Polygonzug mit Rand (erst Bankett, dann Fahrbahn)
  path(points, radius, t, edgeT, edgeExtra = 1.6) {
    if (edgeT != null) {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        this.stroke(a[0], a[1], b[0], b[1], radius + edgeExtra, edgeT);
      }
    }
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      this.stroke(a[0], a[1], b[0], b[1], radius, t);
    }
  }

  addProp(x, y, type = 'cone') {
    this.props.push({ x, y, type, hit: 0, vx: 0, vy: 0 });
  }

  addPropTile(tx, ty, type = 'cone') {
    this.addProp(tx * TILE + TILE / 2, ty * TILE + TILE / 2, type);
  }

  setSpawn(tx, ty, heading = 0) {
    this.spawn = { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, h: heading };
  }

  isRoadTile(tx, ty) {
    const t = this.get(tx, ty);
    return t === T.ROAD || t === T.CROSS || t === T.ARENA || t === T.LOT || t === T.CONCRETE;
  }

  isSolid(tx, ty) { return SOLID.has(this.get(tx, ty)); }

  // --------------------------------------------- Kollisionsrechtecke sammeln
  collectBuildings() {
    const seen = new Uint8Array(this.w * this.h);
    for (let ty = 0; ty < this.h; ty++) {
      for (let tx = 0; tx < this.w; tx++) {
        const i = this.idx(tx, ty);
        if (seen[i] || this.tiles[i] !== T.BUILDING) continue;
        let w = 0;
        while (tx + w < this.w && this.get(tx + w, ty) === T.BUILDING && !seen[this.idx(tx + w, ty)]) w++;
        let h = 0;
        outer: while (ty + h < this.h) {
          for (let k = 0; k < w; k++) {
            const j = this.idx(tx + k, ty + h);
            if (this.tiles[j] !== T.BUILDING || seen[j]) break outer;
          }
          h++;
        }
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) seen[this.idx(tx + x, ty + y)] = 1;
        this.buildings.push({
          x: tx * TILE, y: ty * TILE, w: w * TILE, h: h * TILE,
          cx: tx * TILE + w * TILE / 2, cy: ty * TILE + h * TILE / 2,
        });
      }
    }
  }

  // ------------------------------------------------------------- Rendering
  render() {
    const c = document.createElement('canvas');
    c.width = this.worldW; c.height = this.worldH;
    const g = c.getContext('2d');
    const P = this.pal;

    g.fillStyle = P.ground;
    g.fillRect(0, 0, this.worldW, this.worldH);

    for (let ty = 0; ty < this.h; ty++) {
      for (let tx = 0; tx < this.w; tx++) {
        const t = this.get(tx, ty);
        const x = tx * TILE, y = ty * TILE;
        const v = (tx * 7 + ty * 5);
        switch (t) {
          case T.ROAD: g.fillStyle = P.road[v % P.road.length]; break;
          case T.CROSS: g.fillStyle = P.cross; break;
          case T.SIDEWALK: g.fillStyle = P.sidewalk[(tx + ty) & 1]; break;
          case T.BUILDING: g.fillStyle = '#1d1d24'; break;
          case T.LOT: g.fillStyle = P.lot; break;
          case T.GRASS: g.fillStyle = P.grass[(tx * 5 + ty * 11) % P.grass.length]; break;
          case T.ARENA: g.fillStyle = P.arena[(tx + ty) & 1]; break;
          case T.WATER: g.fillStyle = P.water[v % P.water.length]; break;
          case T.SAND: g.fillStyle = P.sand[v % P.sand.length]; break;
          case T.SNOW: g.fillStyle = P.snow[v % P.snow.length]; break;
          case T.ICE: g.fillStyle = P.ice[(tx + ty) & 1]; break;
          case T.DIRT: g.fillStyle = P.dirt[v % P.dirt.length]; break;
          case T.CONCRETE: g.fillStyle = P.concrete[v % P.concrete.length]; break;
          case T.CLIFF: g.fillStyle = P.cliff[v % P.cliff.length]; break;
          case T.WALL: g.fillStyle = P.wall; break;
          default: g.fillStyle = P.ground;
        }
        g.fillRect(x, y, TILE, TILE);
      }
    }

    this.paintGroundDetail(g);
    this.paintWaterEdges(g);
    this.paintCliffs(g);
    this.paintWalls(g);
    if (this.map.kerbs !== false) this.paintKerbs(g);
    if (this.map.grid) this.paintGridMarkings(g, this.map.grid);
    this.paintLotMarkings(g);
    for (const d of this.decals) d(g, this);
    this.paintBuildingShadows(g);
    this.placeStreetFurniture();
    this.paintStatics(g);
    this.paintGrain(g);
    return c;
  }

  // Feinstruktur des Bodens: Koernung, Risse, Flicken, Wellen, Grasbueschel
  paintGroundDetail(g) {
    for (let ty = 0; ty < this.h; ty++) {
      for (let tx = 0; tx < this.w; tx++) {
        const t = this.get(tx, ty);
        const x = tx * TILE, y = ty * TILE;
        switch (t) {
          case T.ROAD: case T.CROSS: case T.LOT: case T.ARENA: case T.CONCRETE: {
            // Asphaltkoernung
            for (let i = 0; i < 5; i++) {
              g.fillStyle = this.rnd() < 0.5 ? 'rgba(0,0,0,.16)' : 'rgba(255,255,255,.05)';
              g.fillRect(x + this.rndInt(0, 15), y + this.rndInt(0, 15), 1, 1);
            }
            if (this.rnd() < 0.05) {          // Asphaltflicken
              g.fillStyle = 'rgba(0,0,0,.14)';
              const w = this.rndInt(5, 11), h = this.rndInt(4, 9);
              g.fillRect(x + this.rndInt(0, 16 - w), y + this.rndInt(0, 16 - h), w, h);
            }
            if (this.rnd() < 0.04) {          // Riss
              g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 1;
              g.beginPath();
              let px = x + this.rndInt(1, 14), py = y + this.rndInt(1, 14);
              g.moveTo(px, py);
              for (let k = 0; k < 3; k++) {
                px += this.rndInt(-5, 5); py += this.rndInt(-5, 5);
                g.lineTo(px, py);
              }
              g.stroke();
            }
            if (this.rnd() < 0.012) {         // Kanaldeckel
              g.fillStyle = '#2a2a33';
              g.beginPath(); g.arc(x + 8, y + 8, 4, 0, Math.PI * 2); g.fill();
              g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1; g.stroke();
            }
            break;
          }
          case T.SIDEWALK: {
            g.fillStyle = 'rgba(0,0,0,.14)';
            g.fillRect(x, y + 7, TILE, 1);
            g.fillRect(x + 7, y, 1, TILE);
            g.fillStyle = 'rgba(255,255,255,.05)';
            g.fillRect(x, y + 8, TILE, 1);
            if (this.rnd() < 0.05) { g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(x + 4, y + 4, 8, 8); }
            break;
          }
          case T.GRASS: {
            for (let i = 0; i < 6; i++) {
              g.fillStyle = this.rnd() < 0.5 ? 'rgba(0,0,0,.14)' : 'rgba(180,230,160,.12)';
              g.fillRect(x + this.rndInt(0, 15), y + this.rndInt(0, 15), 1, 2);
            }
            break;
          }
          case T.WATER: {
            if (this.rnd() < 0.5) {
              g.fillStyle = 'rgba(190,225,245,.10)';
              g.fillRect(x + this.rndInt(0, 8), y + this.rndInt(2, 13), this.rndInt(4, 8), 1);
            }
            break;
          }
          case T.SAND: case T.SNOW: {
            for (let i = 0; i < 4; i++) {
              g.fillStyle = this.rnd() < 0.5 ? 'rgba(0,0,0,.07)' : 'rgba(255,255,255,.14)';
              g.fillRect(x + this.rndInt(0, 14), y + this.rndInt(0, 14), this.rndInt(1, 3), 1);
            }
            break;
          }
          case T.ICE: {
            g.fillStyle = 'rgba(255,255,255,.18)';
            g.fillRect(x + this.rndInt(0, 9), y + this.rndInt(0, 12), this.rndInt(3, 7), 1);
            break;
          }
          case T.DIRT: {
            for (let i = 0; i < 5; i++) {
              g.fillStyle = this.rnd() < 0.5 ? 'rgba(0,0,0,.18)' : 'rgba(255,230,190,.08)';
              g.fillRect(x + this.rndInt(0, 15), y + this.rndInt(0, 15), 1, 1);
            }
            break;
          }
        }
      }
    }
  }

  // Stellplatzmarkierungen auf Parkflaechen
  paintLotMarkings(g) {
    g.fillStyle = 'rgba(235,235,245,.16)';
    for (let ty = 0; ty < this.h; ty++) {
      for (let tx = 0; tx < this.w; tx++) {
        if (this.get(tx, ty) !== T.LOT) continue;
        if (this.get(tx, ty - 1) !== T.LOT || this.get(tx, ty + 1) !== T.LOT) continue;
        if ((tx + ty * 2) % 3) continue;
        g.fillRect(tx * TILE + 2, ty * TILE + 3, 1, 10);
      }
    }
  }

  // Laternen an Strassenraendern, Baeume auf Gruenflaechen
  placeStreetFurniture() {
    for (let ty = 1; ty < this.h - 1; ty++) {
      for (let tx = 1; tx < this.w - 1; tx++) {
        const t = this.get(tx, ty);
        if (t === T.SIDEWALK) {
          const atRoad = this.isRoadTile(tx - 1, ty) || this.isRoadTile(tx + 1, ty)
                      || this.isRoadTile(tx, ty - 1) || this.isRoadTile(tx, ty + 1);
          if (atRoad && (tx * 3 + ty * 7) % 23 === 0) {
            this.addStatic('lamp', tx * TILE + 8, ty * TILE + 8);
          }
        } else if (t === T.GRASS && this.rnd() < 0.10) {
          this.addStatic('tree', tx * TILE + this.rndInt(3, 13), ty * TILE + this.rndInt(3, 13));
        }
      }
    }
  }

  addStatic(type, x, y) {
    this.statics.push({ type, x, y });
    if (type === 'lamp') this.lights.push({ x, y: y - 2, r: 52, color: '#ffd9a0', intensity: 1 });
    if (type === 'flood') this.lights.push({ x, y: y - 3, r: 150, color: '#dfe9ff', intensity: 1 });
  }

  paintStatics(g) {
    for (const o of this.statics) {
      const x = Math.round(o.x), y = Math.round(o.y);
      if (o.type === 'lamp') {
        g.fillStyle = 'rgba(0,0,0,.35)';
        g.fillRect(x - 1, y + 1, 9, 3);
        g.fillStyle = '#3a3a46'; g.fillRect(x - 1, y - 1, 3, 4);   // Mast
        g.fillStyle = '#4c4c5c'; g.fillRect(x - 2, y - 3, 5, 2);   // Ausleger
        g.fillStyle = '#ffe9b0'; g.fillRect(x - 1, y - 3, 3, 2);   // Leuchte
      } else if (o.type === 'tree') {
        g.fillStyle = 'rgba(0,0,0,.34)';
        g.beginPath(); g.ellipse(x + 3, y + 3, 5, 4, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#3b2a1c'; g.fillRect(x - 1, y - 1, 2, 3);
        g.fillStyle = '#2f5c34';
        g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#3d7040';
        g.beginPath(); g.arc(x - 1, y - 1, 3.4, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#4c8a4e';
        g.beginPath(); g.arc(x - 2, y - 2, 1.8, 0, Math.PI * 2); g.fill();
      } else if (o.type === 'flood') {
        g.fillStyle = 'rgba(0,0,0,.42)';
        g.fillRect(x - 2, y + 2, 12, 4);
        g.fillStyle = '#2f2f3a'; g.fillRect(x - 2, y - 4, 5, 9);      // Mast
        g.fillStyle = '#44444f'; g.fillRect(x - 4, y - 7, 9, 4);      // Traeger
        g.fillStyle = '#f2f6ff'; g.fillRect(x - 3, y - 6, 3, 2);      // Strahler
        g.fillRect(x + 1, y - 6, 3, 2);
      } else if (o.type === 'hydrant') {
        g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x - 1, y + 2, 5, 2);
        g.fillStyle = '#b8342a'; g.fillRect(x - 1, y - 2, 3, 4);
        g.fillStyle = '#e05a44'; g.fillRect(x - 1, y - 2, 3, 1);
      }
    }
  }

  paintKerbs(g) {
    g.fillStyle = this.pal.kerb;
    for (let ty = 0; ty < this.h; ty++) {
      for (let tx = 0; tx < this.w; tx++) {
        if (this.get(tx, ty) !== T.SIDEWALK) continue;
        const x = tx * TILE, y = ty * TILE;
        if (this.isRoadTile(tx, ty - 1)) g.fillRect(x, y, TILE, 2);
        if (this.isRoadTile(tx, ty + 1)) g.fillRect(x, y + TILE - 2, TILE, 2);
        if (this.isRoadTile(tx - 1, ty)) g.fillRect(x, y, 2, TILE);
        if (this.isRoadTile(tx + 1, ty)) g.fillRect(x + TILE - 2, y, 2, TILE);
      }
    }
  }

  // Schaumkante am Ufer
  paintWaterEdges(g) {
    g.fillStyle = 'rgba(180,215,235,.35)';
    for (let ty = 0; ty < this.h; ty++) {
      for (let tx = 0; tx < this.w; tx++) {
        if (this.get(tx, ty) !== T.WATER) continue;
        const x = tx * TILE, y = ty * TILE;
        if (this.get(tx, ty - 1) !== T.WATER) g.fillRect(x, y, TILE, 2);
        if (this.get(tx, ty + 1) !== T.WATER) g.fillRect(x, y + TILE - 2, TILE, 2);
        if (this.get(tx - 1, ty) !== T.WATER) g.fillRect(x, y, 2, TILE);
        if (this.get(tx + 1, ty) !== T.WATER) g.fillRect(x + TILE - 2, y, 2, TILE);
      }
    }
  }

  // Felswand bekommt eine Kante nach unten, damit Hoehe erkennbar wird
  paintCliffs(g) {
    for (let ty = 0; ty < this.h; ty++) {
      for (let tx = 0; tx < this.w; tx++) {
        if (this.get(tx, ty) !== T.CLIFF) continue;
        const x = tx * TILE, y = ty * TILE;
        if (this.get(tx, ty + 1) !== T.CLIFF) {
          g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(x, y + TILE - 5, TILE, 5);
          g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(x, y, TILE, 2);
        }
        if (this.rnd() < 0.18) {
          g.fillStyle = 'rgba(255,255,255,.05)';
          g.fillRect(x + this.rndInt(1, 10), y + this.rndInt(1, 10), 4, 3);
        }
      }
    }
  }

  paintWalls(g) {
    for (let ty = 0; ty < this.h; ty++) {
      for (let tx = 0; tx < this.w; tx++) {
        if (this.get(tx, ty) !== T.WALL) continue;
        const x = tx * TILE, y = ty * TILE;
        g.fillStyle = ((tx + ty) & 1) ? '#c4453a' : '#e8e8f0';
        g.fillRect(x, y, TILE, TILE);
        g.fillStyle = 'rgba(0,0,0,.35)';
        g.fillRect(x, y + TILE - 4, TILE, 4);
      }
    }
  }

  // Mittellinien und Zebrastreifen fuer Karten mit Strassenraster
  paintGridMarkings(g, grid) {
    const { blockGrid, roadW } = grid;
    const P = this.pal;
    g.fillStyle = P.line;
    const mid = (roadW * TILE) / 2;

    for (let b = 0; b < this.w; b += blockGrid) {
      const cx = b * TILE + mid - 1;
      for (let y = 0; y < this.worldH; y += 24) {
        const ty = Math.floor((y + 6) / TILE);
        if (this.get(b + 1, ty) !== T.ROAD || this.get(b + 1, ty + 1) !== T.ROAD) continue;
        g.fillRect(cx, y, 2, 12);
      }
    }
    for (let b = 0; b < this.h; b += blockGrid) {
      const cy = b * TILE + mid - 1;
      for (let x = 0; x < this.worldW; x += 24) {
        const tx = Math.floor((x + 6) / TILE);
        if (this.get(tx, b + 1) !== T.ROAD || this.get(tx + 1, b + 1) !== T.ROAD) continue;
        g.fillRect(x, cy, 12, 2);
      }
    }

    g.fillStyle = 'rgba(210,210,220,.55)';
    for (let by = 0; by < this.h; by += blockGrid) {
      for (let bx = 0; bx < this.w; bx += blockGrid) {
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

  // Jedes Haus bekommt Hoehe und feste Farben. Gezeichnet werden die
  // Waende spaeter pro Bild, weil sie sich mit der Kameraposition neigen.
  assignBuildingLooks() {
    const P = this.pal;
    const hScale = this.map.buildHeight ?? 1;
    for (const b of this.buildings) {
      const area = b.w * b.h;
      const base = 9 + Math.sqrt(area) * 0.22 + this.rnd() * 10;
      b.height = Math.max(6, Math.min(52, base * hScale));
      b.roof = this.pick(P.roofs);
      b.wallA = shade(b.roof, -0.22);     // von der Seite beleuchtete Wand
      b.wallB = shade(b.roof, -0.44);     // abgewandte Wand
      b.winSeed = Math.floor(this.rnd() * 65536);
      b.winLit = 0.3 + this.rnd() * 0.3;
      // beleuchtete Fassaden werfen Licht auf die Strasse
      if (this.rnd() < 0.55) {
        this.lights.push({ x: b.cx, y: b.y + b.h + 5, r: 40, color: '#ffc477', intensity: 0.45 });
      }
      if (this.rnd() < 0.45) {
        this.lights.push({ x: b.x + b.w + 5, y: b.cy, r: 40, color: '#ffc477', intensity: 0.4 });
      }
    }
  }

  // Bodenschatten und Verschattung am Sockel - bleibt im Vorab-Rendering
  paintBuildingShadows(g) {
    const sx = 0.55, sy = 0.7;           // Richtung des Sonnenschattens
    for (const b of this.buildings) {
      const dx = b.height * sx, dy = b.height * sy;
      g.fillStyle = 'rgba(0,0,0,.34)';
      g.beginPath();
      g.moveTo(b.x, b.y);
      g.lineTo(b.x + b.w, b.y);
      g.lineTo(b.x + b.w + dx, b.y + dy);
      g.lineTo(b.x + b.w + dx, b.y + b.h + dy);
      g.lineTo(b.x + dx, b.y + b.h + dy);
      g.lineTo(b.x, b.y + b.h);
      g.closePath();
      g.fill();

      // weiche Verschattung rund um den Sockel
      const pad = 10;
      const grd = g.createLinearGradient(b.x, b.y - pad, b.x, b.y);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(1, 'rgba(0,0,0,.3)');
      g.fillStyle = grd;
      g.fillRect(b.x - pad, b.y - pad, b.w + pad * 2, pad);
      const grd2 = g.createLinearGradient(b.x - pad, 0, b.x, 0);
      grd2.addColorStop(0, 'rgba(0,0,0,0)');
      grd2.addColorStop(1, 'rgba(0,0,0,.3)');
      g.fillStyle = grd2;
      g.fillRect(b.x - pad, b.y - pad, pad, b.h + pad * 2);
    }
  }

  // Dachflaechen auf eigener Ebene, damit sie pro Bild versetzt werden koennen
  renderRoofs() {
    const c = document.createElement('canvas');
    c.width = this.worldW; c.height = this.worldH;
    const g = c.getContext('2d');
    for (const b of this.buildings) {
      const roof = b.roof;
      g.fillStyle = roof;
      g.fillRect(b.x, b.y, b.w, b.h);
      for (let i = 0; i < (b.w * b.h) / 900; i++) {
        g.fillStyle = this.rnd() < 0.5 ? 'rgba(0,0,0,.10)' : 'rgba(255,255,255,.05)';
        g.fillRect(b.x + this.rndInt(0, b.w - 1), b.y + this.rndInt(0, b.h - 1),
                   this.rndInt(2, 7), this.rndInt(2, 5));
      }
      g.fillStyle = shade(roof, 0.3); g.fillRect(b.x, b.y, b.w, 2);
      g.fillStyle = shade(roof, 0.18); g.fillRect(b.x, b.y, 2, b.h);
      g.fillStyle = shade(roof, -0.3); g.fillRect(b.x, b.y + b.h - 2, b.w, 2);
      g.fillStyle = shade(roof, -0.22); g.fillRect(b.x + b.w - 2, b.y, 2, b.h);
      this.paintRoofClutter(g, b, roof);
    }
    return c;
  }

  // Lueftung, Oberlichter, Wassertank, Treppenhaus - alles mit eigenem Schatten
  paintRoofClutter(g, b, roof) {
    const inner = { x: b.x + 4, y: b.y + 4, w: b.w - 8, h: b.h - 8 };
    if (inner.w < 8 || inner.h < 8) return;
    const count = Math.max(1, Math.round((b.w * b.h) / 3400));

    for (let i = 0; i < count; i++) {
      const kind = this.rnd();
      const w = this.rndInt(5, Math.min(14, inner.w - 2));
      const h = this.rndInt(5, Math.min(12, inner.h - 2));
      const x = inner.x + this.rndInt(0, Math.max(0, inner.w - w));
      const y = inner.y + this.rndInt(0, Math.max(0, inner.h - h));

      g.fillStyle = 'rgba(0,0,0,.36)';
      g.fillRect(x + 2, y + 3, w, h);

      if (kind < 0.42) {
        g.fillStyle = '#6f7480'; g.fillRect(x, y, w, h);
        g.fillStyle = '#888e9b'; g.fillRect(x, y, w, 1);
        g.fillStyle = '#4b505a';
        for (let k = 2; k < w - 1; k += 3) g.fillRect(x + k, y + 2, 1, Math.max(1, h - 4));
      } else if (kind < 0.68) {
        g.fillStyle = '#9fb4c4'; g.fillRect(x, y, w, h);
        g.fillStyle = 'rgba(255,255,255,.38)'; g.fillRect(x + 1, y + 1, w - 2, 1);
        g.fillStyle = 'rgba(0,0,0,.25)';
        for (let k = 3; k < w - 1; k += 4) g.fillRect(x + k, y, 1, h);
      } else if (kind < 0.86) {
        g.fillStyle = shade(roof, -0.28); g.fillRect(x, y, w, h);
        g.fillStyle = shade(roof, -0.06); g.fillRect(x, y, w, 2);
        g.fillStyle = '#2a2a33'; g.fillRect(x + 1, y + h - 3, 3, 3);
      } else {
        const r = Math.min(w, h) / 2;
        g.fillStyle = '#7a5c42';
        g.beginPath(); g.arc(x + r, y + r, r, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(147,112,81,.6)';
        g.beginPath(); g.arc(x + r - 1, y + r - 1, r * 0.6, 0, Math.PI * 2); g.fill();
      }
    }

    if (b.height > 28 && this.rnd() < 0.6) {
      const ax = b.x + Math.round(b.w / 2), ay = b.y + Math.round(b.h / 2);
      g.strokeStyle = '#8c8c9c'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax + 6, ay - 9); g.stroke();
      g.fillStyle = '#ff5a4a'; g.fillRect(ax + 5, ay - 11, 2, 2);
      this.lights.push({ x: ax + 6, y: ay - 10, r: 16, color: '#ff5a4a', intensity: 0.7 });
    }
  }

  paintGrain(g) {
    g.globalAlpha = 0.05;
    const n = Math.round((this.worldW * this.worldH) / 300);
    for (let i = 0; i < n; i++) {
      g.fillStyle = this.rnd() < 0.5 ? '#000' : '#fff';
      g.fillRect(Math.floor(this.rnd() * this.worldW), Math.floor(this.rnd() * this.worldH), 1, 1);
    }
    g.globalAlpha = 1;
  }

  makeSkidLayer() {
    const c = document.createElement('canvas');
    c.width = this.worldW; c.height = this.worldH;
    return { canvas: c, ctx: c.getContext('2d') };
  }

  clearSkids() { this.skid.ctx.clearRect(0, 0, this.worldW, this.worldH); }

  fadeSkids() {
    const g = this.skid.ctx;
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = 'rgba(0,0,0,0.035)';
    g.fillRect(0, 0, this.worldW, this.worldH);
    g.globalCompositeOperation = 'source-over';
  }

  // --------------------------------------------------------------- Physik
  resolveCircle(x, y, radius) {
    let hit = null;
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    const span = Math.ceil(radius / TILE) + 1;
    for (let j = ty - span; j <= ty + span; j++) {
      for (let i = tx - span; i <= tx + span; i++) {
        if (!SOLID.has(this.get(i, j))) continue;
        const bx = i * TILE, by = j * TILE;
        const nx = Math.max(bx, Math.min(x, bx + TILE));
        const ny = Math.max(by, Math.min(y, by + TILE));
        const dx = x - nx, dy = y - ny;
        const d2 = dx * dx + dy * dy;
        if (d2 >= radius * radius) continue;
        let d = Math.sqrt(d2), ux, uy;
        if (d < 0.0001) {
          ux = x - (bx + TILE / 2); uy = y - (by + TILE / 2);
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
    return SURFACE[this.get(Math.floor(x / TILE), Math.floor(y / TILE))] || DEFAULT_SURFACE;
  }
}

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (v) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

// Farben der Uebersichtskarte - auch fuer die Kartenvorschau im Menue
export const MINI_COLORS = {
  [T.BUILDING]: '#2a2a34', [T.GRASS]: '#2f5136', [T.ARENA]: '#5a5a6e',
  [T.LOT]: '#3f3f4c', [T.SIDEWALK]: '#43434f', [T.WATER]: '#1d3a56',
  [T.SAND]: '#c9b078', [T.SNOW]: '#cdd5e0', [T.ICE]: '#a9c9dc',
  [T.DIRT]: '#6b5336', [T.CONCRETE]: '#585863', [T.CLIFF]: '#26262e',
  [T.WALL]: '#8d8da4',
};

export function minimapCanvas(wd) {
  const c = document.createElement('canvas');
  c.width = wd.w; c.height = wd.h;
  const g = c.getContext('2d');
  for (let ty = 0; ty < wd.h; ty++) {
    for (let tx = 0; tx < wd.w; tx++) {
      g.fillStyle = MINI_COLORS[wd.get(tx, ty)] || '#6a6a80';
      g.fillRect(tx, ty, 1, 1);
    }
  }
  return c;
}
