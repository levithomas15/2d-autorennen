// Menue-System: Start, Garage (Autos kaufen + tunen), Einstellungen, Hilfe.
// Wird komplett aus dem Schema bzw. den Fahrzeugdaten aufgebaut.

import { SCHEMA, save as saveSettings } from './settings.js';
import {
  CARS, TUNING, PAINTS, GLOW_COLORS, GLOW_PRICE, PAINT_PRICE,
  carById, buildSpec, statBars, upgradeCost,
} from './cars.js';
import { buyCar, buyUpgrade, buyGlow, setPaint, saveGarage } from './garage.js';

export class Menu {
  constructor(opts) {
    this.settings = opts.settings;
    this.garage = opts.garage;
    this.onChange = opts.onChange || (() => {});
    this.onCarChange = opts.onCarChange || (() => {});
    this.onPlay = opts.onPlay || (() => {});
    this.tab = 'start';
    this.started = false;

    this.root = document.getElementById('menu');
    this.tabsEl = document.getElementById('menuTabs');
    this.bodyEl = document.getElementById('menuBody');
    this.cashEl = document.getElementById('menuCash');
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root && this.started) this.close();
    });
  }

  get isOpen() { return !this.root.classList.contains('hidden'); }

  open(tab) {
    this.tab = tab || this.tab;
    this.root.classList.remove('hidden');
    this.render();
  }

  close() {
    if (!this.started) return;
    this.root.classList.add('hidden');
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  render() {
    this.renderTabs();
    this.cashEl.textContent = '$ ' + this.garage.cash.toLocaleString('de-DE');
    this.bodyEl.innerHTML = '';
    if (this.tab === 'start') this.renderStart();
    else if (this.tab === 'garage') this.renderGarage();
    else if (this.tab === 'settings') this.renderSettings();
    else this.renderHelp();
  }

  renderTabs() {
    const tabs = [
      ['start', this.started ? 'WEITER' : 'START'],
      ['garage', 'GARAGE'],
      ['settings', 'EINSTELLUNGEN'],
      ['help', 'HILFE'],
    ];
    this.tabsEl.innerHTML = '';
    for (const [id, label] of tabs) {
      const b = el('button', 'tab' + (this.tab === id ? ' active' : ''), label);
      b.onclick = () => {
        if (id === 'start' && this.started) { this.close(); return; }
        this.tab = id; this.render();
      };
      this.tabsEl.appendChild(b);
    }
  }

  // ------------------------------------------------------------------ Start
  renderStart() {
    const box = el('div', 'startBox');
    box.appendChild(el('h2', '', 'PIXEL DRIFT CITY'));
    box.appendChild(el('p', 'lead',
      'Top-Down-Drift-Simulator. Drifte lange und sauber, kassiere Geld und ' +
      'bau dir in der Garage das Auto, das du willst.'));

    const car = carById(this.garage.selected);
    box.appendChild(el('p', 'lead small', 'AKTUELLES AUTO: ' + car.name));

    const play = el('button', 'big', this.started ? 'WEITERFAHREN' : 'LOSFAHREN');
    play.onclick = () => { this.started = true; this.onPlay(); this.close(); };
    box.appendChild(play);

    const hint = el('div', 'hintRow');
    hint.appendChild(el('span', '', 'W/S GAS+BREMSE'));
    hint.appendChild(el('span', '', 'A/D LENKEN'));
    hint.appendChild(el('span', '', 'LEERTASTE HANDBREMSE'));
    hint.appendChild(el('span', '', 'ESC MENUE'));
    box.appendChild(hint);
    this.bodyEl.appendChild(box);
  }

  // ----------------------------------------------------------------- Garage
  renderGarage() {
    const wrap = el('div', 'garage');

    // Auto-Auswahl
    const list = el('div', 'carList');
    for (const c of CARS) {
      const owned = !!this.garage.owned[c.id];
      const sel = this.garage.selected === c.id;
      const card = el('button', 'carCard' + (sel ? ' sel' : '') + (owned ? '' : ' locked'));
      card.appendChild(carThumb(c, this.garage.cars[c.id].paint));
      card.appendChild(el('b', '', c.name));
      card.appendChild(el('span', 'price', owned ? (sel ? 'AKTIV' : 'BESITZT')
        : '$ ' + c.price.toLocaleString('de-DE')));
      card.onclick = () => {
        if (owned) {
          this.garage.selected = c.id; saveGarage(this.garage); this.onCarChange();
        } else if (buyCar(this.garage, c.id)) {
          this.garage.selected = c.id; saveGarage(this.garage); this.onCarChange();
        } else {
          flash(card);
        }
        this.render();
      };
      list.appendChild(card);
    }
    wrap.appendChild(list);

    const car = carById(this.garage.selected);
    const tune = this.garage.cars[car.id];
    const spec = buildSpec(car, tune, this.settings);

    const panel = el('div', 'tunePanel');
    const head = el('div', 'tuneHead');
    head.appendChild(carThumb(car, tune.paint, 3));
    const info = el('div', '');
    info.appendChild(el('h3', '', car.name));
    info.appendChild(el('p', 'small', car.blurb));
    const bars = el('div', 'stats');
    for (const [name, v] of statBars(spec)) {
      const row = el('div', 'statRow');
      row.appendChild(el('span', 'statName', name));
      const track = el('div', 'statTrack');
      const fill = el('div', 'statFill');
      fill.style.width = Math.round(v * 100) + '%';
      track.appendChild(fill);
      row.appendChild(track);
      bars.appendChild(row);
    }
    info.appendChild(bars);
    head.appendChild(info);
    panel.appendChild(head);

    // Tuning-Stufen
    for (const t of TUNING) {
      const lvl = tune[t.key] | 0;
      const row = el('div', 'tuneRow');
      const left = el('div', 'tuneInfo');
      left.appendChild(el('b', '', t.name));
      left.appendChild(el('span', 'small', t.desc));
      row.appendChild(left);

      const pips = el('div', 'pips');
      for (let i = 0; i < 4; i++) pips.appendChild(el('i', i <= lvl ? 'pip on' : 'pip'));
      row.appendChild(pips);

      const cost = upgradeCost(t.key, lvl + 1);
      const btn = el('button', 'buy', cost == null ? 'MAX' : '$ ' + cost.toLocaleString('de-DE'));
      btn.disabled = cost == null;
      if (cost != null && this.garage.cash < cost) btn.classList.add('poor');
      btn.onclick = () => {
        if (buyUpgrade(this.garage, car.id, t.key)) { this.onCarChange(); this.render(); }
        else flash(btn);
      };
      row.appendChild(btn);
      panel.appendChild(row);
    }

    // Lackierung
    const paintRow = el('div', 'tuneRow');
    const pl = el('div', 'tuneInfo');
    pl.appendChild(el('b', '', 'LACKIERUNG'));
    pl.appendChild(el('span', 'small', 'FARBWECHSEL KOSTET $ ' + PAINT_PRICE));
    paintRow.appendChild(pl);
    const swatches = el('div', 'swatches');
    for (const col of PAINTS) {
      const s = el('button', 'swatch' + (tune.paint === col ? ' sel' : ''));
      s.style.background = col;
      s.onclick = () => {
        if (tune.paint === col) return;
        if (setPaint(this.garage, car.id, col)) { this.onCarChange(); this.render(); }
        else flash(s);
      };
      swatches.appendChild(s);
    }
    paintRow.appendChild(swatches);
    panel.appendChild(paintRow);

    // Untergrundbeleuchtung
    const glowRow = el('div', 'tuneRow');
    const gl = el('div', 'tuneInfo');
    gl.appendChild(el('b', '', 'UNTERGRUNDBELEUCHTUNG'));
    gl.appendChild(el('span', 'small', tune.glow
      ? 'FARBE WAEHLEN - ANZEIGE IN DEN EINSTELLUNGEN'
      : 'NEON UNTER DEM AUTO - $ ' + GLOW_PRICE.toLocaleString('de-DE')));
    glowRow.appendChild(gl);

    if (tune.glow) {
      const gs = el('div', 'swatches');
      for (const col of GLOW_COLORS) {
        const s = el('button', 'swatch glowSw' + (tune.glowColor === col ? ' sel' : ''));
        s.style.background = col;
        s.style.boxShadow = `0 0 10px ${col}`;
        s.onclick = () => { tune.glowColor = col; saveGarage(this.garage); this.onCarChange(); this.render(); };
        gs.appendChild(s);
      }
      glowRow.appendChild(gs);
    } else {
      const btn = el('button', 'buy', '$ ' + GLOW_PRICE.toLocaleString('de-DE'));
      if (this.garage.cash < GLOW_PRICE) btn.classList.add('poor');
      btn.onclick = () => {
        if (buyGlow(this.garage, car.id)) { this.onCarChange(); this.render(); }
        else flash(btn);
      };
      glowRow.appendChild(btn);
    }
    panel.appendChild(glowRow);

    wrap.appendChild(panel);
    this.bodyEl.appendChild(wrap);
  }

  // ------------------------------------------------------------ Einstellungen
  renderSettings() {
    const wrap = el('div', 'settings');
    for (const group of SCHEMA) {
      const g = el('div', 'setGroup');
      g.appendChild(el('h3', '', group.group));
      for (const item of group.items) {
        if (item.dep && !item.dep(this.settings)) continue;
        g.appendChild(this.settingRow(item));
      }
      wrap.appendChild(g);
    }
    const reset = el('button', 'buy wide', 'ALLES ZURUECKSETZEN');
    reset.onclick = () => {
      if (!confirm('Einstellungen, Geld und Tuning zuruecksetzen?')) return;
      localStorage.removeItem('pdc_settings_v1');
      localStorage.removeItem('pdc_garage_v1');
      localStorage.removeItem('pdc_best');
      location.reload();
    };
    wrap.appendChild(reset);
    this.bodyEl.appendChild(wrap);
  }

  settingRow(item) {
    const row = el('div', 'setRow');
    const label = el('div', 'setLabel');
    label.appendChild(el('b', '', item.label));
    if (item.help) label.appendChild(el('span', 'small', item.help));
    row.appendChild(label);

    const val = this.settings[item.key];
    if (item.type === 'toggle') {
      const b = el('button', 'switch' + (val ? ' on' : ''), val ? 'AN' : 'AUS');
      b.onclick = () => { this.set(item.key, !this.settings[item.key]); this.render(); };
      row.appendChild(b);
    } else if (item.type === 'choice') {
      const box = el('div', 'choices');
      item.options.forEach((opt, i) => {
        const b = el('button', 'choice' + (val === i ? ' on' : ''), opt);
        b.onclick = () => { this.set(item.key, i); this.render(); };
        box.appendChild(b);
      });
      row.appendChild(box);
    } else {
      const box = el('div', 'rangeBox');
      const input = document.createElement('input');
      input.type = 'range';
      input.min = item.min; input.max = item.max; input.step = item.step;
      input.value = val;
      const out = el('span', 'rangeVal', fmt(val));
      input.oninput = () => { out.textContent = fmt(+input.value); this.set(item.key, +input.value); };
      box.appendChild(input); box.appendChild(out);
      row.appendChild(box);
    }
    return row;
  }

  set(key, value) {
    this.settings[key] = value;
    saveSettings(this.settings);
    this.onChange(key, value);
  }

  // ------------------------------------------------------------------- Hilfe
  renderHelp() {
    const wrap = el('div', 'help');
    wrap.appendChild(block('SO DRIFTET MAN', [
      '1. AUF 60-100 KM/H BESCHLEUNIGEN',
      '2. EINLENKEN UND HANDBREMSE KURZ ANTIPPEN',
      '3. HANDBREMSE LOSLASSEN, GAS HALTEN, GEGENLENKEN',
      '4. MIT KLEINEN KORREKTUREN HALTEN - DER MULTIPLIKATOR STEIGT',
      'PUNKTE GIBT ES ERST BEIM SAUBEREN BEENDEN. EIN CRASH KOSTET DEN COMBO.',
    ]));
    wrap.appendChild(block('TASTATUR', [
      'W / PFEIL HOCH - GAS',
      'S / PFEIL RUNTER - BREMSE, IM STAND RUECKWAERTS',
      'A D / PFEILE - LENKEN',
      'LEERTASTE - HANDBREMSE',
      'E / SHIFT - HOCHSCHALTEN     Q / STRG - RUNTERSCHALTEN',
      'F - KUPPLUNG (WENN AKTIVIERT)',
      'R - RESET     C - AUTO WECHSELN     M - SOUND     K - SPUREN LOESCHEN',
      'ESC / P - MENUE',
    ]));
    wrap.appendChild(block('GANGSCHALTUNG', [
      'IN DEN EINSTELLUNGEN UNTER STEUERUNG AKTIVIERBAR.',
      'AUS = ARCADE OHNE GAENGE.',
      'AUTOMATIK = GAENGE WERDEN SIMULIERT UND SELBST GESCHALTET.',
      'MANUELL = DU SCHALTEST SELBST, OPTIONAL MIT KUPPLUNG.',
      'DER HEBEL RECHTS LAESST SICH AUCH MIT DER MAUS ZIEHEN.',
    ]));
    wrap.appendChild(block('GELD VERDIENEN', [
      'JEDER GEBANKTE DRIFT BRINGT GELD IN GLEICHER HOEHE.',
      'PYLONEN UMFAHREN GIBT EXTRAPUNKTE.',
      'DAMIT IN DER GARAGE AUTOS KAUFEN UND TUNEN.',
    ]));
    this.bodyEl.appendChild(wrap);
  }
}

// ----------------------------------------------------------------- Helfer
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function block(title, lines) {
  const b = el('div', 'setGroup');
  b.appendChild(el('h3', '', title));
  for (const l of lines) b.appendChild(el('p', 'small', l));
  return b;
}

function fmt(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, '');
}

function flash(node) {
  node.classList.remove('nope');
  void node.offsetWidth;
  node.classList.add('nope');
}

// kleines Vorschaubild des Autos fuer Liste und Tuning-Kopf
function carThumb(car, paint, scale = 2) {
  const c = document.createElement('canvas');
  c.width = car.len * scale; c.height = car.wid * scale;
  c.className = 'thumb';
  c.style.width = car.len * scale * 2 + 'px';
  c.style.height = car.wid * scale * 2 + 'px';
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.scale(scale, scale);
  const body = paint || car.color;
  g.fillStyle = body;
  g.fillRect(0, 1, car.len, car.wid - 2);
  g.fillRect(1, 0, car.len - 2, car.wid);
  g.fillStyle = '#1a1f2b';
  g.fillRect(Math.round(car.len * 0.3), 1, Math.round(car.len * 0.4), car.wid - 2);
  g.fillStyle = car.stripe;
  g.fillRect(Math.round(car.len * 0.36), Math.floor(car.wid / 2) - 1, Math.round(car.len * 0.28), 2);
  g.fillStyle = '#ffe9a8';
  g.fillRect(car.len - 2, 2, 2, 2); g.fillRect(car.len - 2, car.wid - 4, 2, 2);
  return c;
}
