// Sechs Karten. Jede liefert Groesse, Farbpalette und eine build()-Funktion,
// die mit den Bau-Werkzeugen der World-Klasse (fill, disc, path, ...) arbeitet.

import { T, TILE } from './world.js';

// ------------------------------------------------------------------- Stadt
function buildCity(w, opt) {
  const { blockGrid, roadW, snow } = opt;
  const onRoad = (v) => (v % blockGrid) < roadW;

  for (let ty = 0; ty < w.h; ty++) {
    for (let tx = 0; tx < w.w; tx++) {
      const rx = onRoad(tx), ry = onRoad(ty);
      w.set(tx, ty, rx && ry ? T.CROSS : (rx || ry) ? T.ROAD : T.SIDEWALK);
    }
  }

  for (let by = 0; by < w.h; by += blockGrid) {
    for (let bx = 0; bx < w.w; bx += blockGrid) {
      const x0 = bx + roadW + 1, y0 = by + roadW + 1;
      const x1 = Math.min(bx + blockGrid, w.w) - 1, y1 = Math.min(by + blockGrid, w.h) - 1;
      if (x1 - x0 < 3 || y1 - y0 < 3) continue;
      cityBlock(w, x0, y0, x1, y1, snow);
    }
  }

  // Drift-Arena in der Mitte
  const cx = w.w >> 1, cy = w.h >> 1, rad = 15;
  w.disc(cx, cy, rad, T.ARENA);
  w.arena = { x: cx * TILE, y: cy * TILE, r: rad * TILE };

  if (snow) {
    // Eisplatten auf Fahrbahn und Arena
    for (let i = 0; i < 90; i++) {
      const tx = w.rndInt(2, w.w - 3), ty = w.rndInt(2, w.h - 3);
      if (!w.isRoadTile(tx, ty)) continue;
      w.disc(tx, ty, w.rndInt(1, 3), T.ICE);
    }
  }

  paintArenaDecal(w, cx, cy, rad);

  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    w.addProp(w.arena.x + Math.cos(a) * w.arena.r * 0.62,
              w.arena.y + Math.sin(a) * w.arena.r * 0.62);
  }
  for (let n = 0; n < 220; n++) {
    const tx = w.rndInt(2, w.w - 3), ty = w.rndInt(2, w.h - 3);
    if (w.get(tx, ty) !== T.LOT) continue;
    w.addPropTile(tx, ty, w.rnd() < 0.5 ? 'cone' : 'barrel');
  }

  w.setSpawn(cx, cy + Math.round(rad * 0.55), -Math.PI / 2);
}

function cityBlock(w, x0, y0, x1, y1, snow) {
  const kind = w.rnd();
  const bw = x1 - x0, bh = y1 - y0;
  if (bw < 2 || bh < 2) return;

  if (kind < 0.16) { w.fill(x0, y0, x1, y1, snow ? T.SNOW : T.GRASS); return; }
  if (kind < 0.30) { w.fill(x0, y0, x1, y1, T.LOT); return; }

  const cols = 1 + (w.rnd() < 0.6 ? 1 : 0);
  const rows = 1 + (w.rnd() < 0.6 ? 1 : 0);
  const cw = Math.floor(bw / cols), ch = Math.floor(bh / rows);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (w.rnd() < 0.14) continue;
      const ax = x0 + cx * cw, ay = y0 + cy * ch;
      const aw = (cx === cols - 1 ? x1 - ax : cw) - (cols > 1 ? 1 : 0);
      const ah = (cy === rows - 1 ? y1 - ay : ch) - (rows > 1 ? 1 : 0);
      if (aw < 1 || ah < 1) continue;
      w.fill(ax, ay, ax + aw, ay + ah, T.BUILDING);
    }
  }
}

function paintArenaDecal(w, cxT, cyT, radT) {
  const cx = cxT * TILE, cy = cyT * TILE, r = radT * TILE;
  w.decals.push((g) => {
    g.save();
    g.strokeStyle = w.pal.arenaMark; g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, r * 0.62, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(cx, cy, r * 0.3, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(255,215,110,.35)'; g.lineWidth = 4;
    g.beginPath(); g.arc(cx, cy, r - 6, 0, Math.PI * 2); g.stroke();
    for (let y = 0; y < 6; y++)
      for (let x = 0; x < 6; x++) {
        g.fillStyle = ((x + y) & 1) ? '#d8d8e0' : '#2a2a32';
        g.fillRect(cx - 24 + x * 8, cy - 24 + y * 8, 8, 8);
      }
    g.restore();
  });
}

// ------------------------------------------------------------------- Hafen
function buildDocks(w) {
  w.fill(0, 0, w.w, w.h, T.CONCRETE);

  // Hafenbecken und offenes Wasser
  w.fill(0, 88, w.w, w.h, T.WATER);
  w.fill(72, 50, 100, 90, T.WATER);
  w.fill(0, 0, w.w, 3, T.WATER);

  // Piers ins Becken
  w.fill(76, 54, 82, 88, T.CONCRETE);
  w.fill(88, 54, 94, 88, T.CONCRETE);
  // Strand links
  w.fill(0, 80, 26, 88, T.SAND);

  // Lagerhallen in Reihen, dazwischen breite Gassen zum Driften
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 5; c++) {
      if (w.rnd() < 0.12) continue;
      const x = 6 + c * 21, y = 8 + r * 22;
      w.fill(x, y, x + 14, y + 12, T.BUILDING);
    }
  }
  // Freie Halle als Drift-Halle ohne Dach
  w.fill(6, 52, 34, 76, T.CONCRETE);
  w.outline(6, 52, 34, 76, T.WALL, 1);
  w.fill(12, 58, 28, 70, T.LOT);

  // Containerstapel als kleine Hindernisse
  for (let i = 0; i < 46; i++) {
    const tx = w.rndInt(2, w.w - 5), ty = w.rndInt(4, 84);
    if (w.get(tx, ty) !== T.CONCRETE) continue;
    if (w.get(tx + 1, ty) !== T.CONCRETE || w.get(tx + 2, ty) !== T.CONCRETE) continue;
    w.fill(tx, ty, tx + (w.rnd() < 0.5 ? 3 : 2), ty + 1, T.BUILDING);
  }

  // Fahrbahnmarkierung auf dem Kai
  w.decals.push((g) => {
    g.fillStyle = 'rgba(230,220,120,.5)';
    for (let x = 0; x < w.worldW; x += 26) g.fillRect(x, 84 * TILE - 2, 14, 3);
    g.fillStyle = 'rgba(235,235,245,.28)';
    for (let y = 4 * TILE; y < 84 * TILE; y += 26) {
      g.fillRect(52 * TILE, y, 3, 14);
      g.fillRect(70 * TILE, y, 3, 14);
    }
  });

  for (let i = 0; i < 70; i++) {
    const tx = w.rndInt(2, w.w - 3), ty = w.rndInt(4, 86);
    if (w.get(tx, ty) !== T.CONCRETE) continue;
    w.addPropTile(tx, ty, w.rnd() < 0.55 ? 'barrel' : 'cone');
  }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    w.addProp((20 + Math.cos(a) * 9) * TILE, (64 + Math.sin(a) * 6) * TILE);
  }

  w.setSpawn(50, 82, -Math.PI / 2);
}

// ----------------------------------------------------------------- Bergpass
function buildPass(w) {
  w.fill(0, 0, w.w, w.h, T.CLIFF);

  // Serpentine von unten nach oben, mit Kehren
  const pts = [
    [44, 128], [44, 116], [18, 108], [18, 96], [68, 88], [68, 76],
    [14, 66], [14, 54], [70, 46], [70, 34], [26, 26], [26, 14], [48, 8],
  ];
  w.path(pts, 4.0, T.ROAD, T.DIRT, 2.0);

  // Kehren und Aussichtsplatz aufweiten
  for (const [x, y] of [[18, 102], [68, 82], [14, 60], [70, 40], [26, 20]]) {
    w.disc(x, y, 7.5, T.DIRT); w.disc(x, y, 6, T.ROAD);
  }
  w.disc(48, 8, 10, T.DIRT); w.disc(48, 8, 8, T.ROAD);   // Gipfelplateau
  w.disc(44, 124, 8, T.DIRT); w.disc(44, 124, 6.5, T.ROAD);

  // Gras am Hang
  for (let i = 0; i < 120; i++) {
    const tx = w.rndInt(1, w.w - 2), ty = w.rndInt(1, w.h - 2);
    if (w.get(tx, ty) === T.DIRT && w.rnd() < 0.5) w.disc(tx, ty, w.rndInt(1, 2), T.GRASS);
  }

  // Mittellinie entlang der Strecke
  w.decals.push((g) => {
    g.strokeStyle = 'rgba(225,215,120,.45)';
    g.lineWidth = 2; g.setLineDash([12, 14]); g.lineCap = 'butt';
    g.beginPath();
    g.moveTo(pts[0][0] * TILE + 8, pts[0][1] * TILE + 8);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0] * TILE + 8, pts[i][1] * TILE + 8);
    g.stroke(); g.setLineDash([]);
  });

  // Laternen an den Kehren, damit der Pass nachts befahrbar bleibt
  for (const [x, y] of [[18, 102], [68, 82], [14, 60], [70, 40], [26, 20], [48, 8], [44, 124]]) {
    w.addStatic('lamp', x * TILE + 8, (y - 7) * TILE + 8);
    w.addStatic('lamp', x * TILE + 8, (y + 7) * TILE + 8);
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b2 = pts[i];
    w.addStatic('lamp', ((a[0] + b2[0]) / 2) * TILE + 8, ((a[1] + b2[1]) / 2) * TILE + 8);
  }

  // Leitpfosten entlang der Fahrbahnkante
  w.decals.push((g) => {
    for (let ty = 0; ty < w.h; ty++) {
      for (let tx = 0; tx < w.w; tx++) {
        if (w.get(tx, ty) !== T.ROAD) continue;
        const edge = w.get(tx - 1, ty) !== T.ROAD || w.get(tx + 1, ty) !== T.ROAD
                  || w.get(tx, ty - 1) !== T.ROAD || w.get(tx, ty + 1) !== T.ROAD;
        if (!edge || (tx * 3 + ty) % 4) continue;
        g.fillStyle = '#e8e8f0';
        g.fillRect(tx * TILE + 6, ty * TILE + 6, 3, 4);
        g.fillStyle = '#c4453a';
        g.fillRect(tx * TILE + 6, ty * TILE + 6, 3, 2);
      }
    }
  });

  // Pylonen in den Kurven
  for (const [x, y] of [[18, 102], [68, 82], [14, 60], [70, 40], [26, 20]]) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      w.addProp((x + Math.cos(a) * 5.4) * TILE, (y + Math.sin(a) * 5.4) * TILE);
    }
  }
  w.setSpawn(44, 126, -Math.PI / 2);
}

// ------------------------------------------------------------- Industriepark
function buildIndustry(w) {
  w.fill(0, 0, w.w, w.h, T.LOT);
  w.outline(0, 0, w.w, w.h, T.WALL, 2);

  // grosse Werkshallen
  const halls = [
    [8, 8, 34, 26], [44, 6, 74, 22], [84, 10, 104, 34],
    [8, 40, 28, 64], [78, 48, 104, 72], [40, 78, 72, 100], [8, 80, 30, 100],
  ];
  for (const [x0, y0, x1, y1] of halls) w.fill(x0, y0, x1, y1, T.BUILDING);

  // Kreisverkehr in der Mitte
  w.disc(56, 50, 16, T.CONCRETE);
  w.disc(56, 50, 5, T.GRASS);
  w.ring(56, 50, 4, 5, T.WALL);

  // Schotterflaechen und Gruenstreifen
  for (let i = 0; i < 14; i++) {
    const tx = w.rndInt(6, w.w - 10), ty = w.rndInt(6, w.h - 10);
    if (w.get(tx, ty) !== T.LOT) continue;
    w.disc(tx, ty, w.rndInt(3, 6), w.rnd() < 0.6 ? T.DIRT : T.GRASS);
  }

  // Teststrecke: langer Beton-Streifen quer durch das Gelaende
  w.fill(0, 68, w.w, 74, T.CONCRETE);
  w.decals.push((g) => {
    g.fillStyle = 'rgba(235,235,245,.30)';
    for (let x = 0; x < w.worldW; x += 30) g.fillRect(x, 71 * TILE - 1, 16, 3);
    g.strokeStyle = 'rgba(255,215,110,.30)'; g.lineWidth = 3;
    g.beginPath(); g.arc(56 * TILE + 8, 50 * TILE + 8, 15 * TILE, 0, Math.PI * 2); g.stroke();
  });

  for (let i = 0; i < 160; i++) {
    const tx = w.rndInt(3, w.w - 4), ty = w.rndInt(3, w.h - 4);
    const t = w.get(tx, ty);
    if (t !== T.LOT && t !== T.CONCRETE) continue;
    w.addPropTile(tx, ty, w.rnd() < 0.6 ? 'barrel' : 'cone');
  }
  w.setSpawn(8, 71, 0);
}

// -------------------------------------------------------------- Driftstadion
function buildStadium(w) {
  w.fill(0, 0, w.w, w.h, T.GRASS);
  const cx = 44, cy = 44;

  w.disc(cx, cy, 40, T.CONCRETE);
  w.ring(cx, cy, 38, 40, T.WALL);

  // Innenfeld mit Bande
  w.disc(cx, cy, 11, T.GRASS);
  w.ring(cx, cy, 10, 11, T.WALL);

  // Zwei Kreisel fuer die Acht
  w.disc(cx - 19, cy, 5, T.GRASS);
  w.ring(cx - 19, cy, 4, 5, T.WALL);
  w.disc(cx + 19, cy, 5, T.GRASS);
  w.ring(cx + 19, cy, 4, 5, T.WALL);

  // Eisflaechen als Extra-Herausforderung (nicht im Startbereich)
  w.disc(cx - 30, cy - 12, 5, T.ICE);
  w.disc(cx + 30, cy - 12, 5, T.ICE);
  w.disc(cx, cy - 30, 6, T.ICE);

  // Boxengasse
  w.fill(cx - 6, cy + 12, cx + 6, cy + 20, T.LOT);

  w.decals.push((g) => {
    const px = cx * TILE + 8, py = cy * TILE + 8;
    g.strokeStyle = 'rgba(255,215,110,.35)'; g.lineWidth = 4;
    g.beginPath(); g.arc(px, py, 36 * TILE, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(235,235,245,.22)'; g.lineWidth = 3;
    g.beginPath(); g.arc(px - 19 * TILE, py, 13 * TILE, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(px + 19 * TILE, py, 13 * TILE, 0, Math.PI * 2); g.stroke();
    // Start-Ziel-Karos
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 14; x++) {
        g.fillStyle = ((x + y) & 1) ? '#d8d8e0' : '#2a2a32';
        g.fillRect(px - 56 + x * 8, py + 22 * TILE + y * 8, 8, 8);
      }
  });

  // Flutlichtmasten auf der Bande
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    w.addStatic('flood', (cx + Math.cos(a) * 39) * TILE + 8, (cy + Math.sin(a) * 39) * TILE + 8);
  }

  for (const [ox, r, n] of [[-19, 9, 16], [19, 9, 16], [0, 30, 30]]) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      w.addProp((cx + ox + Math.cos(a) * r) * TILE, (cy + Math.sin(a) * r) * TILE);
    }
  }
  w.setSpawn(cx, cy + 26, 0);
}

// ------------------------------------------------------------------- Karten
export const MAPS = [
  {
    id: 'city', name: 'INNENSTADT',
    desc: 'DICHTES STRASSENRASTER MIT DRIFT-ARENA IN DER MITTE',
    w: 104, h: 104, seed: 20260915, base: T.SIDEWALK,
    grid: { blockGrid: 13, roadW: 4 },
    build: (w) => buildCity(w, { blockGrid: 13, roadW: 4, snow: false }),
  },
  {
    id: 'docks', name: 'HAFENVIERTEL',
    desc: 'WEITE KAIFLAECHEN, LAGERHALLEN UND WASSER RINGSUM',
    w: 120, h: 104, seed: 771144, base: T.CONCRETE, kerbs: false,
    palette: {
      concrete: ['#5b5b64', '#61616b', '#565660'],
      lot: ['#4b4b56'][0], ground: '#1a2634',
      roofs: ['#4a5a6b', '#5a6470', '#6b5f4a', '#46626b', '#5b5560'],
    },
    build: buildDocks,
  },
  {
    id: 'pass', name: 'BERGPASS',
    desc: 'ENGE SERPENTINEN MIT KEHREN - NICHTS FUER ANFAENGER',
    w: 88, h: 136, seed: 30301, base: T.CLIFF, kerbs: false,
    palette: {
      road: ['#4c4c58', '#52525e', '#484854'],
      cliff: ['#1f1f27', '#23232c', '#1b1b22'],
      dirt: ['#6d5638', '#775f40', '#644e33'],
      grass: ['#2f5136', '#355a3c', '#2a4a31'],
      ground: '#14141a',
    },
    build: buildPass,
  },
  {
    id: 'industry', name: 'INDUSTRIEPARK',
    desc: 'RIESIGE ASPHALTFLAECHEN, HALLEN UND EIN KREISVERKEHR',
    w: 112, h: 112, seed: 55221, base: T.LOT, kerbs: false,
    palette: {
      lot: '#4a4a55', concrete: ['#5f5f6a', '#63636e', '#5a5a65'],
      roofs: ['#6b6b76', '#7a6b4a', '#5a6470', '#6b5a4a'],
      ground: '#20202a',
    },
    build: buildIndustry,
  },
  {
    id: 'stadium', name: 'DRIFT-STADION',
    desc: 'REINE SPIELWIESE: ACHT, KREISEL UND EISFLAECHEN',
    w: 88, h: 88, seed: 9090, base: T.GRASS, kerbs: false,
    palette: {
      concrete: ['#4e4e5a', '#52525e', '#4a4a56'],
      grass: ['#2e5a3c', '#336343', '#2a5237'],
      ground: '#14141c',
    },
    build: buildStadium,
  },
  {
    id: 'winter', name: 'WINTERSTADT',
    desc: 'VERSCHNEITE STADT MIT EISPLATTEN - WENIG GRIP',
    w: 96, h: 96, seed: 11223, base: T.SIDEWALK,
    grid: { blockGrid: 12, roadW: 4 },
    palette: {
      road: ['#6e7480', '#747a86', '#69707c'],
      cross: '#767c88',
      line: '#c9c27a',
      sidewalk: ['#c7cfda', '#c1c9d4'],
      kerb: '#aab3c0',
      lot: '#8a92a0',
      arena: ['#9aa3b0', '#9ea7b4'],
      arenaMark: '#b7c0cc',
      roofs: ['#8a5a4a', '#7b6a4f', '#5e6a7b', '#7a5065', '#65704f', '#6d6570'],
      ground: '#aab3c0',
    },
    build: (w) => buildCity(w, { blockGrid: 12, roadW: 4, snow: true }),
  },
];

export function mapById(id) { return MAPS.find((m) => m.id === id) || MAPS[0]; }
