// Pause / settings menu drawn on a canvas. Used as an in-world panel in VR and as an overlay on screens.
// Navigate with stick/d-pad/arrows, change values left/right, confirm with A/Space/trigger, or point and click.
import * as THREE from 'three';
import { roundRect } from './entities.js';
import { UI, uiTexture } from './hud.js';

const FONT = '"Press Start 2P", ui-monospace, monospace';
const W = 768, ROW = 52, PAD = 70;

export const SCHEMES = [
  ['classic', 'Classic'], ['lefty', 'Left-handed'], ['onehand', 'One controller'],
];

export class Menu {
  constructor(settings, onAction) {
    this.settings = settings; this.onAction = onAction;
    this.characters = [];
    this.index = 0; this.open = false; this.page = 'main'; this.title = false; this.mrMode = 'window';
    this.S = 2.5;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W * this.S; this.canvas.height = 900 * this.S; this.H = 900;
    this.tex = uiTexture(this.canvas);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6 * 900 / W),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, fog: false }));
    this.mesh.renderOrder = 900; this.mesh.visible = false;
    this.mesh.userData.menu = this;
    this.dom = document.getElementById('pauseCanvasWrap');
    if (this.dom) {
      this.dom.appendChild(this.canvas);
      this.canvas.addEventListener('pointermove', e => this.pointAt(...this.domUV(e)));
      this.canvas.addEventListener('click', e => { this.pointAt(...this.domUV(e)); this.click(this.domUV(e)[0]); });
    }
    this.build();
  }

  domUV(e) { const r = this.canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; }

  setCharacters(list) { this.characters = list; this.build(); }

  build() {
    const s = this.settings, cycle = (list, cur, d) => list[(list.indexOf(cur) + d + list.length) % list.length];
    const pct = v => Math.round(v * 100) + '%';
    const vr = () => document.body.classList.contains('in-xr');
    const mrOn = () => document.body.classList.contains('in-mr');
    const win = () => mrOn() && this.mrMode === 'window';
    const go = page => () => { this.page = page; this.index = 0; };
    this.items = [
      // ---- main page
      { label: () => this.title ? 'Start game' : 'Resume', act: () => this.onAction(this.title ? 'start' : 'resume') },
      { label: 'Recenter view', act: () => this.onAction('recenter'), vrOnly: true, notMr: true },
      { label: 'Move game (wall/table)', act: () => this.onAction('place'), mrOnly: true },
      { label: 'Adjust placement  ›', act: go('window'), when: mrOn },
      { label: 'Character', value: () => (this.characters.find(c => c.id === s.character) || {}).name || s.character,
        change: d => this.onAction('character', cycle(this.characters.map(c => c.id), s.character, d)) },
      { label: 'Settings  ›', act: go('settings') },
      { label: 'Show controls', act: () => this.onAction('hints'), vrOnly: true },
      { label: 'Respawn at checkpoint', act: () => this.onAction('restart'), when: () => !this.title },
      { label: 'Exit VR', act: () => this.onAction('exitvr'), vrOnly: true },

      // ---- window page (mixed reality)
      { page: 'window', label: 'Style', value: () => s.mrStyle === 'window' ? 'Window' : 'Diorama',
        change: () => { s.mrStyle = s.mrStyle === 'window' ? 'table' : 'window'; this.onAction('settings'); this.onAction('place'); } },
      { page: 'window', label: 'Snap to walls/tables', value: () => s.mrSnap ? 'On' : 'Off (free)',
        change: () => { s.mrSnap = !s.mrSnap; this.onAction('settings'); } },
      { page: 'window', when: win, label: 'Width', value: () => s.winW.toFixed(2) + ' m',
        change: d => { s.winW = clamp(round(s.winW + d * 0.1), 0.4, 4); this.onAction('settings'); } },
      { page: 'window', when: win, label: 'Height', value: () => s.winH.toFixed(2) + ' m',
        change: d => { s.winH = clamp(round(s.winH + d * 0.1), 0.3, 3); this.onAction('settings'); } },
      { page: 'window', when: win, label: 'Distance from wall', value: () => Math.round(s.winOffset * 100) + ' cm',
        change: d => { s.winOffset = clamp(round(s.winOffset + d * 0.1), 0, 2.5); this.onAction('settings'); } },
      { page: 'window', when: win, label: 'Depth into wall', value: () => Math.round(s.winDepth * 100) + ' cm',
        change: d => { s.winDepth = clamp(round(s.winDepth + d * 0.05), 0.05, 1.5); this.onAction('settings'); } },
      { page: 'window', label: 'Raise / lower', value: () => (s.winLift >= 0 ? '+' : '') + Math.round(s.winLift * 100) + ' cm',
        change: d => { s.winLift = clamp(round(s.winLift + d * 0.05), -1.5, 1.5); this.onAction('settings'); } },
      { page: 'window', label: 'Game zoom', value: () => pct(s.scale),
        change: d => { s.scale = clamp(round(s.scale + d * 0.1), 0.4, 2.5); this.onAction('settings'); } },
      { page: 'window', label: 'Reset window', act: () => { Object.assign(s, { winW: 2, winH: 1.25, winOffset: 0, winDepth: 0.26, winLift: 0, scale: 1 }); this.onAction('settings'); } },
      { page: 'window', label: 'Place somewhere else', act: () => this.onAction('place') },
      { page: 'window', label: '‹ Back', act: go('main') },

      // ---- settings page
      { page: 'settings', label: 'Controls', value: () => SCHEMES.find(x => x[0] === s.scheme)[1], vrOnly: true,
        change: d => { s.scheme = cycle(SCHEMES.map(x => x[0]), s.scheme, d); this.onAction('settings'); } },
      { page: 'settings', label: 'Camera follow', value: () => s.follow === 'tight' ? 'Tight' : 'Smooth',
        change: () => { s.follow = s.follow === 'tight' ? 'smooth' : 'tight'; this.onAction('settings'); } },
      { page: 'settings', label: 'Game size', value: () => pct(s.scale), vrOnly: true,
        change: d => { s.scale = clamp(round(s.scale + d * 0.1), 0.4, 2.5); this.onAction('settings'); } },
      { page: 'settings', label: 'Distance', value: () => s.distance.toFixed(2) + ' m', vrOnly: true, notMr: true,
        change: d => { s.distance = clamp(round(s.distance + d * 0.1), 0.5, 3); this.onAction('settings'); this.onAction('recenter-keep'); } },
      { page: 'settings', label: 'Height', value: () => (s.height >= 0 ? '+' : '') + Math.round(s.height * 100) + ' cm', vrOnly: true, notMr: true,
        change: d => { s.height = clamp(round(s.height + d * 0.05), -0.8, 0.5); this.onAction('settings'); this.onAction('recenter-keep'); } },
      { page: 'settings', label: 'Zoom', value: () => pct(s.flatZoom), flatOnly: true,
        change: d => { s.flatZoom = clamp(round(s.flatZoom + d * 0.1), 0.5, 2.5); this.onAction('settings'); } },
      { page: 'settings', label: 'Comfort vignette', value: () => s.vignette ? 'On' : 'Off', vrOnly: true, notMr: true,
        change: () => { s.vignette = !s.vignette; this.onAction('settings'); } },
      { page: 'settings', label: 'Sharpness', value: () => s.quality === 'high' ? 'High' : 'Normal', vrOnly: true,
        change: () => { s.quality = s.quality === 'high' ? 'normal' : 'high'; this.onAction('settings'); this.onAction('toast', 'Applies next time you enter VR'); } },
      { page: 'settings', label: 'Shadows', value: () => s.shadows ? 'On' : 'Off', change: () => { s.shadows = !s.shadows; this.onAction('settings'); } },
      { page: 'settings', label: 'Music', value: () => pct(s.music), change: d => { s.music = clamp(round(s.music + d * 0.1), 0, 1); this.onAction('settings'); } },
      { page: 'settings', label: 'Sound FX', value: () => pct(s.sfx), change: d => { s.sfx = clamp(round(s.sfx + d * 0.1), 0, 1); this.onAction('settings'); } },
      { page: 'settings', label: 'Haptics', value: () => s.haptics ? 'On' : 'Off', vrOnly: true,
        change: () => { s.haptics = !s.haptics; this.onAction('settings'); } },
      { page: 'settings', label: '‹ Back', act: go('main') },
    ];
    this.visibleItems = () => this.items.filter(it => (it.page || 'main') === this.page && (!it.vrOnly || vr()) && (!it.flatOnly || !vr()) && (!it.mrOnly || mrOn()) && (!it.notMr || !mrOn()) && (!it.when || it.when()));
    this.refresh();
  }

  refresh() {
    const items = this.visibleItems();
    this.index = clamp(this.index, 0, items.length - 1);
    const H = PAD + items.length * ROW + 40;
    if (this.H !== H) {
      this.H = H;
      this.canvas.height = Math.round(H * this.S);
      this.mesh.geometry.dispose();
      this.mesh.geometry = new THREE.PlaneGeometry(0.62, 0.62 * H / W);
      this.tex.dispose();
      this.tex = uiTexture(this.canvas);
      this.mesh.material.map = this.tex;
    }
    const g = this.canvas.getContext('2d');
    g.setTransform(this.S, 0, 0, this.S, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(18,14,28,0.94)'; roundRect(g, 6, 6, W - 12, H - 12, 26); g.fill();
    g.strokeStyle = '#f6d36b'; g.lineWidth = 5; g.stroke();
    g.fillStyle = '#f6d36b'; g.font = `24px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillText(this.title ? 'HAWKTHORNE VR' : this.page === 'settings' ? 'SETTINGS' : this.page === 'window' ? 'PLACEMENT' : 'PAUSED', W / 2, 40);
    items.forEach((it, i) => {
      const y = PAD + i * ROW;
      const sel = i === this.index;
      if (sel) { g.fillStyle = 'rgba(246,211,107,0.18)'; roundRect(g, 24, y, W - 48, ROW - 6, 12); g.fill(); }
      g.textAlign = 'left'; g.font = `16px ${FONT}`;
      g.fillStyle = sel ? '#fff' : '#cfc6dd';
      g.fillText(typeof it.label === 'function' ? it.label() : it.label, 44, y + ROW / 2 - 2);
      if (it.value) {
        g.textAlign = 'right';
        g.fillStyle = sel ? '#f6d36b' : '#a99fbb';
        const txt = `‹ ${it.value()} ›`, tw = Math.min(380, g.measureText(txt).width);
        g.fillText(txt, W - 44, y + ROW / 2 - 2, 380);
        it._split = (W - 44 - tw / 2) / W; // pointer: left of this = decrease, right = increase
      }
    });
    this.tex.needsUpdate = true;
  }

  update(dt, input) {
    const items = this.visibleItems();
    if (input.menuUp) { this.index = (this.index - 1 + items.length) % items.length; this.refresh(); }
    if (input.menuDown) { this.index = (this.index + 1) % items.length; this.refresh(); }
    const it = items[this.index];
    if (it && it.change && (input.menuLeft || input.menuRight)) { it.change(input.menuLeft ? -1 : 1); this.refresh(); }
    if (input.confirm && it) { if (it.act) it.act(); else if (it.change) it.change(1); this.refresh(); }
    else if (input.back) { if (this.page !== 'main') { this.page = 'main'; this.index = 0; this.refresh(); } else if (!this.title) this.onAction('resume'); }
  }

  // Pointer support (u, v in 0..1 over the panel, v from the top)
  pointAt(u, v) {
    const items = this.visibleItems();
    const y = v * this.H;
    const i = Math.floor((y - PAD) / ROW);
    if (i >= 0 && i < items.length && i !== this.index) { this.index = i; this.refresh(); return true; }
    return i >= 0 && i < items.length;
  }
  click(u) {
    const it = this.visibleItems()[this.index];
    if (!it) return;
    if (it.act) it.act(); else if (it.change) it.change(u < (it._split || 0.75) ? -1 : 1);
    this.refresh();
  }
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = v => Math.round(v * 100) / 100;
