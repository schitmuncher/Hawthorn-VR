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
    this.index = 0; this.open = false;
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
    this.items = [
      { label: 'Resume', act: () => this.onAction('resume') },
      { label: 'Recenter view', act: () => this.onAction('recenter'), vrOnly: true, notMr: true },
      { label: 'Move game (wall/table)', act: () => this.onAction('place'), mrOnly: true },
      { label: 'Character', value: () => (this.characters.find(c => c.id === s.character) || {}).name || s.character,
        change: d => this.onAction('character', cycle(this.characters.map(c => c.id), s.character, d)) },
      { label: 'Controls', value: () => SCHEMES.find(x => x[0] === s.scheme)[1], vrOnly: true,
        change: d => { s.scheme = cycle(SCHEMES.map(x => x[0]), s.scheme, d); this.onAction('settings'); } },
      { label: 'Show controls', act: () => this.onAction('hints'), vrOnly: true },
      { label: 'Camera follow', value: () => s.follow === 'tight' ? 'Tight' : 'Smooth',
        change: () => { s.follow = s.follow === 'tight' ? 'smooth' : 'tight'; this.onAction('settings'); } },
      { label: 'Sharpness', value: () => s.quality === 'high' ? 'High' : 'Normal', vrOnly: true,
        change: () => { s.quality = s.quality === 'high' ? 'normal' : 'high'; this.onAction('settings'); this.onAction('toast', 'Applies next time you enter VR'); } },
      { label: 'Comfort vignette', value: () => s.vignette ? 'On' : 'Off', vrOnly: true, notMr: true,
        change: () => { s.vignette = !s.vignette; this.onAction('settings'); } },
      { label: 'Game size', value: () => pct(s.scale), vrOnly: true,
        change: d => { s.scale = clamp(round(s.scale + d * 0.1), 0.5, 2.5); this.onAction('settings'); } },
      { label: 'Distance', value: () => s.distance.toFixed(2) + ' m', vrOnly: true, notMr: true,
        change: d => { s.distance = clamp(round(s.distance + d * 0.1), 0.5, 3); this.onAction('settings'); this.onAction('recenter-keep'); } },
      { label: 'Height', value: () => (s.height >= 0 ? '+' : '') + Math.round(s.height * 100) + ' cm', vrOnly: true, notMr: true,
        change: d => { s.height = clamp(round(s.height + d * 0.05), -0.8, 0.5); this.onAction('settings'); this.onAction('recenter-keep'); } },
      { label: 'Zoom', value: () => pct(s.flatZoom), flatOnly: true,
        change: d => { s.flatZoom = clamp(round(s.flatZoom + d * 0.1), 0.5, 2.5); this.onAction('settings'); } },
      { label: 'Shadows', value: () => s.shadows ? 'On' : 'Off', change: () => { s.shadows = !s.shadows; this.onAction('settings'); } },
      { label: 'Music', value: () => pct(s.music), change: d => { s.music = clamp(round(s.music + d * 0.1), 0, 1); this.onAction('settings'); } },
      { label: 'Sound FX', value: () => pct(s.sfx), change: d => { s.sfx = clamp(round(s.sfx + d * 0.1), 0, 1); this.onAction('settings'); } },
      { label: 'Haptics', value: () => s.haptics ? 'On' : 'Off', vrOnly: true,
        change: () => { s.haptics = !s.haptics; this.onAction('settings'); } },
      { label: 'Respawn at checkpoint', act: () => this.onAction('restart') },
      { label: 'Exit to title', act: () => this.onAction('exitvr'), vrOnly: true },
    ];
    this.visibleItems = () => this.items.filter(it => (!it.vrOnly || vr()) && (!it.flatOnly || !vr()) && (!it.mrOnly || mrOn()) && (!it.notMr || !mrOn()));
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
    g.fillText('PAUSED', W / 2, 40);
    items.forEach((it, i) => {
      const y = PAD + i * ROW;
      const sel = i === this.index;
      if (sel) { g.fillStyle = 'rgba(246,211,107,0.18)'; roundRect(g, 24, y, W - 48, ROW - 6, 12); g.fill(); }
      g.textAlign = 'left'; g.font = `16px ${FONT}`;
      g.fillStyle = sel ? '#fff' : '#cfc6dd';
      g.fillText(it.label, 44, y + ROW / 2 - 2);
      if (it.value) {
        g.textAlign = 'right';
        g.fillStyle = sel ? '#f6d36b' : '#a99fbb';
        g.fillText(`‹ ${it.value()} ›`, W - 44, y + ROW / 2 - 2, 380);
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
    else if (input.back) this.onAction('resume');
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
    if (it.act) it.act(); else if (it.change) it.change(u > 0.4 && u < 0.62 ? -1 : 1);
    this.refresh();
  }
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = v => Math.round(v * 100) / 100;
