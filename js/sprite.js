// Pixel sprites rendered as a stack of planes so they read as chunky 3D cut-outs in VR.
import * as THREE from 'three';
import { loadImage, pixelTexture } from './level.js';

const texCache = new Map();
export async function spriteTexture(src) {
  if (!texCache.has(src)) texCache.set(src, loadImage(src).then(img => pixelTexture(img)));
  return texCache.get(src);
}

// anim8 frame spec: ['2-4,1', '3,1'] -> [[2,1],[3,1],[4,1],[3,1]] (1-based col,row)
export function parseFrames(spec) {
  const out = [];
  const range = s => { const [a, b] = s.split('-').map(Number); const r = []; if (b === undefined) return [a]; for (let i = a; a <= b ? i <= b : i >= b; i += a <= b ? 1 : -1) r.push(i); return r; };
  for (const s of spec) {
    const [cs, rs] = s.split(',');
    for (const r of range(rs)) for (const c of range(cs)) out.push([c, r]);
  }
  return out;
}

export class Anim {
  constructor(def) { // def: [mode, frames, duration]
    this.mode = def[0]; this.frames = parseFrames(def[1]); this.dur = def[2]; this.t = 0;
  }
  reset() { this.t = 0; }
  frame() {
    const n = this.frames.length;
    let i = Math.floor(this.t / this.dur);
    i = this.mode === 'once' ? Math.min(i, n - 1) : i % n;
    return this.frames[i];
  }
  get done() { return this.mode === 'once' && this.t >= this.dur * this.frames.length; }
}

export class Sprite {
  /**
   * @param tex THREE.Texture of the sheet
   * @param fw, fh frame size in px
   * @param opts.layers number of stacked planes, opts.thickness total depth in px
   */
  constructor(tex, fw, fh, opts = {}) {
    this.tex = tex; this.fw = fw; this.fh = fh;
    this.sw = tex.image.width; this.sh = tex.image.height;
    this.geo = new THREE.PlaneGeometry(fw, fh);
    this.group = new THREE.Group();
    const layers = opts.layers ?? 4, thick = opts.thickness ?? 6;
    this.mats = [];
    for (let i = 0; i < layers; i++) {
      const f = layers === 1 ? 0.5 : i / (layers - 1);
      // Back slices are darker so the silhouette edge reads as a side wall.
      const shade = i === layers - 1 ? 1 : 0.55 + 0.3 * f;
      const mat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, color: new THREE.Color(shade, shade, shade), side: THREE.DoubleSide });
      this.mats.push(mat);
      const m = new THREE.Mesh(this.geo, mat);
      m.position.z = (f - 0.5) * thick;
      m.renderOrder = 2;
      this.group.add(m);
    }
    this.setFrame(1, 1);
  }
  setFrame(col, row, flipX = false) {
    if (this._c === col && this._r === row && this._f === flipX) return;
    this._c = col; this._r = row; this._f = flipX;
    this.setRect((col - 1) * this.fw, (row - 1) * this.fh, this.fw, this.fh, flipX);
  }
  setRect(x, y, w, h, flipX = false) {
    const W = this.sw, H = this.sh, e = 0.01;
    let u0 = (x + e) / W, u1 = (x + w - e) / W;
    if (flipX) [u0, u1] = [u1, u0];
    const v0 = 1 - (y + h - e) / H, v1 = 1 - (y + e) / H;
    const uv = this.geo.attributes.uv;
    // PlaneGeometry order: tl, tr, bl, br
    uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
    uv.needsUpdate = true;
  }
  // x, y: top-left of the frame in game px
  place(x, y, z = 0) { this.group.position.set(x + this.fw / 2, -(y + this.fh / 2), z); }
  tint(r, g, b) { for (let i = 0; i < this.mats.length; i++) { const base = i === this.mats.length - 1 ? 1 : 0.55 + 0.3 * (i / Math.max(1, this.mats.length - 1)); this.mats[i].color.setRGB(base * r, base * g, base * b); } }
  set visible(v) { this.group.visible = v; }
  dispose() { this.geo.dispose(); this.mats.forEach(m => m.dispose()); this.group.removeFromParent(); }
}

// A tile-like sprite (24x24 block art) extruded into a real box.
export function extrudedBox(tex, rect, w, h, front, back) {
  const W = tex.image.width, H = tex.image.height;
  const uv = (x, y, ww, hh, e = 0.02) => [(x + e) / W, 1 - (y + hh - e) / H, (x + ww - e) / W, 1 - (y + e) / H];
  const pos = [], uvs = [], col = [], idx = [];
  const quad = (v, r, shade) => {
    const b = pos.length / 3; const [u0, v0, u1, v1] = r;
    const q = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    for (let i = 0; i < 4; i++) { pos.push(...v[i]); uvs.push(...q[i]); col.push(shade, shade, shade); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const [x, y] = rect;
  const x0 = -w / 2, x1 = w / 2, y0 = h / 2, y1 = -h / 2, F = front, B = -back;
  quad([[x0, y1, F], [x1, y1, F], [x1, y0, F], [x0, y0, F]], uv(x, y, w, h), 0.9);
  quad([[x0, y0, F], [x1, y0, F], [x1, y0, B], [x0, y0, B]], uv(x, y, w, 1, 0.3), 1);
  quad([[x0, y1, B], [x0, y1, F], [x0, y0, F], [x0, y0, B]], uv(x, y, 1, h, 0.3), 0.68);
  quad([[x1, y1, F], [x1, y1, B], [x1, y0, B], [x1, y0, F]], uv(x + w - 1, y, 1, h, 0.3), 0.68);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }));
}
