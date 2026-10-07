// HUD drawn to canvases: shown as floating panels in VR and mirrored into the page on screens.
import * as THREE from 'three';
import { roundRect } from './entities.js';
import { loadImage } from './level.js';

const FONT = '"Press Start 2P", ui-monospace, monospace';
const ICONS = ['rock', 'stick', 'leaf'];

// UI canvases are drawn at several times their logical size so text stays crisp on the Quest panels.
export const UI = { scale: 3, anisotropy: 4 };
export function uiCanvas(w, h, scale = UI.scale) {
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const g = c.getContext('2d');
  g.setTransform(scale, 0, 0, scale, 0, 0);
  c.logical = { w, h, scale };
  return c;
}
export function uiTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = UI.anisotropy;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  return t;
}

export class Hud {
  constructor() {
    this.canvas = uiCanvas(512, 128);
    this.ctx = this.canvas.getContext('2d');
    this.tex = uiTexture(this.canvas);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.11),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, fog: false }));
    this.mesh.renderOrder = 50;

    this.toastCanvas = uiCanvas(1024, 160, 2);
    this.toastTex = uiTexture(this.toastCanvas);
    this.toastMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.125),
      new THREE.MeshBasicMaterial({ map: this.toastTex, transparent: true, depthWrite: false, depthTest: false, fog: false }));
    this.toastMesh.renderOrder = 60;
    this.toastTime = 0; this.toastDur = 0;

    this.hintCanvas = uiCanvas(640, 300);
    this.hintTex = uiTexture(this.hintCanvas);
    this.hintMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46 * 300 / 640),
      new THREE.MeshBasicMaterial({ map: this.hintTex, transparent: true, depthWrite: false, fog: false, opacity: 0 }));
    this.hintMesh.renderOrder = 55;
    this.hintTime = 0; this.hintDur = 0;

    this.icons = {};
    ICONS.forEach(k => loadImage(`assets/images/materials/${k}.png`).then(img => { this.icons[k] = img; this.dirty = true; }));
    this.dirty = true;
    this.last = '';
    if (document.fonts && document.fonts.load) document.fonts.load(`16px ${FONT}`).then(() => {
      this.dirty = true;
      if (this.hintDur) this.showHints(this.hintScheme, Math.max(1, this.hintDur - this.hintTime));
    }).catch(() => {});
    this.dom = document.getElementById('hud');
    if (this.dom) this.dom.appendChild(this.canvas);
  }

  toast(text, seconds = 2, big = false) {
    const g = this.toastCanvas.getContext('2d');
    g.clearRect(0, 0, 1024, 160);
    g.font = `${big ? 40 : 24}px ${FONT}`;
    const w = Math.min(1000, g.measureText(text).width + 60);
    g.fillStyle = 'rgba(20,16,30,0.82)'; roundRect(g, 512 - w / 2, 30, w, 100, 18); g.fill();
    g.strokeStyle = '#f6d36b'; g.lineWidth = 4; g.stroke();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 512, 82, 960);
    this.toastTex.needsUpdate = true;
    this.toastTime = 0; this.toastDur = seconds;
  }

  showHints(scheme, seconds = 12) {
    this.hintScheme = scheme;
    const L = {
      classic: [['Left stick', 'move · up climb · down crouch'], ['A / X', 'jump  (down + A: drop)'], ['Trigger / B', 'punch'],
        ['Grip', 'grab & move the world'], ['Right stick', 'resize'], ['Y', 'menu   · left stick click: recenter']],
      lefty: [['Right stick', 'move · up climb · down crouch'], ['A / X', 'jump  (down + X: drop)'], ['Trigger / Y', 'punch'],
        ['Grip', 'grab & move the world'], ['Left stick', 'resize'], ['B', 'menu   · right stick click: recenter']],
      onehand: [['Stick', 'move · up climb · down crouch'], ['A / X', 'jump'], ['Trigger / B / Y', 'punch'],
        ['Stick click', 'menu'], ['', ''], ['', '']],
    }[scheme] || [];
    const g = this.hintCanvas.getContext('2d');
    g.clearRect(0, 0, 640, 300);
    g.fillStyle = 'rgba(20,16,30,0.82)'; roundRect(g, 4, 4, 632, 292, 18); g.fill();
    g.strokeStyle = 'rgba(246,211,107,0.9)'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#f6d36b'; g.font = `16px ${FONT}`; g.textBaseline = 'middle';
    g.fillText('CONTROLS', 24, 34);
    L.forEach(([k, v], i) => {
      if (!k) return;
      const y = 78 + i * 37;
      g.fillStyle = '#fff'; g.font = `16px ${FONT}`; g.fillText(k, 24, y, 190);
      g.fillStyle = '#e4dcef'; g.font = `12px ${FONT}`; g.fillText(v, 220, y, 400);
    });
    this.hintTex.needsUpdate = true;
    this.hintTime = 0; this.hintDur = seconds;
  }

  update(dt, world, settings) {
    this.hintTime += dt;
    const ha = this.hintTime < 0.3 ? this.hintTime / 0.3 : Math.max(0, 1 - (this.hintTime - this.hintDur) / 0.6);
    this.hintMesh.material.opacity = ha;
    this.hintMesh.visible = ha > 0.01;
    // Toast fade
    this.toastTime += dt;
    const a = this.toastTime < 0.2 ? this.toastTime / 0.2 : Math.max(0, 1 - (this.toastTime - this.toastDur) / 0.4);
    this.toastMesh.material.opacity = a;
    this.toastMesh.scale.setScalar(0.9 + 0.1 * Math.min(1, this.toastTime / 0.2));

    const p = world.player;
    const key = [Math.ceil(p.health), world.inventory.rock, world.inventory.stick, world.inventory.leaf, p.character.name].join('|');
    if (key === this.last && !this.dirty) return;
    this.last = key; this.dirty = false;

    const g = this.ctx;
    g.clearRect(0, 0, 512, 128);
    g.fillStyle = 'rgba(20,16,30,0.78)'; roundRect(g, 4, 4, 504, 120, 18); g.fill();
    g.strokeStyle = 'rgba(246,211,107,0.9)'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#fff'; g.font = `16px ${FONT}`; g.textBaseline = 'top';
    g.fillText(p.character.name.toUpperCase(), 22, 20, 300);
    // Health bar
    const hp = Math.max(0, p.health) / p.maxHealth;
    g.fillStyle = '#2b2236'; roundRect(g, 22, 52, 300, 26, 8); g.fill();
    g.fillStyle = hp > 0.5 ? '#5fd36b' : hp > 0.25 ? '#f6c544' : '#ec5a5a';
    if (hp > 0) { roundRect(g, 25, 55, Math.max(12, 294 * hp), 20, 6); g.fill(); }
    g.font = `12px ${FONT}`; g.fillStyle = '#fff'; g.fillText(`${Math.ceil(p.health)} HP`, 30, 87);
    // Materials
    g.imageSmoothingEnabled = false;
    ICONS.forEach((k, i) => {
      const x = 350 + i * 52;
      if (this.icons[k]) g.drawImage(this.icons[k], 0, 0, 24, 24, x, 26, 40, 40);
      g.font = `16px ${FONT}`; g.fillStyle = '#fff'; g.textAlign = 'center';
      g.fillText(String(world.inventory[k] || 0), x + 20, 76);
      g.textAlign = 'left';
    });
    this.tex.needsUpdate = true;
  }
}
