// Builds a 3D diorama from a converted Hawkthorne level.
// Root-local units are game pixels: x right, y up (game y is negated), z towards the viewer.
import * as THREE from 'three';
import { platformType, isSloped, slopeEdges } from './collision.js';

export const DEPTH = { front: 10, back: 40, decor: -34, oneBack: -22 };
const SCREEN_W = 528, SCREEN_H = 336; // original game viewport, used for parallax alignment

const imageCache = new Map();
export function loadImage(src) {
  if (!imageCache.has(src)) {
    imageCache.set(src, new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('Failed to load ' + src));
      img.src = src;
    }));
  }
  return imageCache.get(src);
}

export function pixelTexture(source) {
  const t = new THREE.Texture(source);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

class Batch {
  constructor() { this.pos = []; this.uv = []; this.col = []; this.idx = []; }
  quad(v, uv, shade) {
    const base = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      this.pos.push(v[i][0], v[i][1], v[i][2]);
      this.uv.push(uv[i][0], uv[i][1]);
      this.col.push(shade, shade, shade);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build(material) {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.frustumCulled = false; // long strip; it is always partly visible
    return m;
  }
}

// UV rectangle for pixel rect (x, y, w, h) in an image of size W x H. Inset avoids bleeding.
function uvRect(x, y, w, h, W, H, inset = 0.02) {
  const u0 = (x + inset) / W, u1 = (x + w - inset) / W;
  const v0 = 1 - (y + h - inset) / H, v1 = 1 - (y + inset) / H;
  return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]; // bl, br, tr, tl
}

export async function buildLevel(data, opts = {}) {
  const { width: W, height: H, tilewidth: tw, tileheight: th } = data;
  const tilesets = data.tilesets.filter(t => t.image).sort((a, b) => a.firstgid - b.firstgid);
  for (const ts of tilesets) {
    ts.img = await loadImage(ts.image);
    ts.cols = Math.floor(ts.width / ts.tilewidth);
    ts.texture = pixelTexture(ts.img);
  }
  const tsFor = gid => { let r = null; for (const t of tilesets) if (gid >= t.firstgid) r = t; return r; };

  const map = { width: W, height: H, tilewidth: tw, tileheight: th, coll: Int16Array.from(data.collision || []) };
  const solidAt = (c, r) => {
    if (c < 0 || c >= W || r < 0 || r >= H) return false;
    const id = map.coll[r * W + c];
    if (id < 0) return false;
    const p = platformType(id);
    return (p === 'block' || p === 'ice-block') && !isSloped(id);
  };
  const kindAt = i => { const id = map.coll[i]; return id < 0 ? null : platformType(id); };

  const visible = data.layers.filter(l => l.visible !== false);
  const flatLayers = visible.filter(l => !l.properties.parallax || +l.properties.parallax === 1);
  const parallaxLayers = visible.filter(l => l.properties.parallax && +l.properties.parallax !== 1);

  // --- Composite atlas for solid cells (all flat layers stacked into one 24x24 image).
  const atlasCols = 64;
  const entries = new Map();
  const cellEntry = new Int32Array(W * H).fill(-1);
  const onewayTop = new Int32Array(W * H).fill(-1);   // gid drawn as the platform face
  const onewayLayer = new Int32Array(W * H).fill(-1);
  for (let i = 0; i < W * H; i++) {
    const kind = kindAt(i);
    if (kind === 'block' || kind === 'ice-block') {
      const gids = [];
      for (const l of flatLayers) if (l.data[i] && !l.properties.foreground && l.opacity >= 1) gids.push(l.data[i]);
      if (!gids.length) continue;
      const key = gids.join(',');
      if (!entries.has(key)) entries.set(key, { gids, index: entries.size });
      cellEntry[i] = entries.get(key).index;
    } else if (kind === 'oneway' || kind === 'no-drop') {
      for (let li = flatLayers.length - 1; li >= 0; li--) {
        const g = flatLayers[li].data[i];
        if (g && !flatLayers[li].properties.foreground && flatLayers[li].opacity >= 1) { onewayTop[i] = g; onewayLayer[i] = li; break; }
      }
      if (onewayTop[i] > 0) {
        const key = String(onewayTop[i]);
        if (!entries.has(key)) entries.set(key, { gids: [onewayTop[i]], index: entries.size });
        cellEntry[i] = entries.get(key).index;
      }
    }
  }
  const atlasRows = Math.max(1, Math.ceil(entries.size / atlasCols));
  const canvas = document.createElement('canvas');
  canvas.width = atlasCols * tw; canvas.height = atlasRows * th;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  for (const e of entries.values()) {
    const ax = (e.index % atlasCols) * tw, ay = Math.floor(e.index / atlasCols) * th;
    for (const gid of e.gids) {
      const ts = tsFor(gid); if (!ts) continue;
      const local = gid - ts.firstgid;
      ctx.drawImage(ts.img, (local % ts.cols) * tw, Math.floor(local / ts.cols) * th, tw, th, ax, ay, tw, th);
    }
    // First opaque row/columns: used to texture the extruded faces.
    const px = ctx.getImageData(ax, ay, tw, th).data;
    const op = (x, y) => px[(y * tw + x) * 4 + 3] > 127;
    e.ax = ax; e.ay = ay;
    e.topRow = 0; outer: for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) if (op(x, y)) { e.topRow = y; break outer; }
    e.leftCol = 0; outer2: for (let x = 0; x < tw; x++) for (let y = 0; y < th; y++) if (op(x, y)) { e.leftCol = x; break outer2; }
    e.rightCol = tw - 1; outer3: for (let x = tw - 1; x >= 0; x--) for (let y = 0; y < th; y++) if (op(x, y)) { e.rightCol = x; break outer3; }
  }
  const byIndex = [...entries.values()].sort((a, b) => a.index - b.index);
  const atlasTex = pixelTexture(canvas);
  const AW = canvas.width, AH = canvas.height;

  const root = new THREE.Group();
  root.name = 'level';
  const { front: F, back: B, decor: DZ, oneBack: OB } = DEPTH;

  // --- Extruded solid geometry
  const solid = new Batch();
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = r * W + c;
    const kind = kindAt(i);
    if (cellEntry[i] < 0) continue;
    const e = byIndex[cellEntry[i]];
    const x0 = c * tw, x1 = x0 + tw, y0 = r * th, y1 = y0 + th;
    const id = map.coll[i];
    if (kind === 'block' || kind === 'ice-block') {
      let yl = y0, yr = y0;
      const sloped = isSloped(id);
      if (sloped) { const [l, rr] = slopeEdges(id); yl = y0 + l; yr = y0 + rr; }
      solid.quad([[x0, -y1, F], [x1, -y1, F], [x1, -y0, F], [x0, -y0, F]], uvRect(e.ax, e.ay, tw, th, AW, AH), 0.9);
      if (sloped || !solidAt(c, r - 1)) {
        const row = sloped ? Math.min(th - 1, e.topRow + 1) : e.topRow;
        const uv = uvRect(e.ax, e.ay + row, tw, 1, AW, AH, 0.3);
        solid.quad([[x0, -yl, F], [x1, -yr, F], [x1, -yr, -B], [x0, -yl, -B]], uv, 1.0);
      }
      if (!solidAt(c - 1, r)) {
        const uv = uvRect(e.ax + e.leftCol, e.ay, 1, th, AW, AH, 0.3);
        // u runs across the depth: rotate uv so the strip maps vertically
        solid.quad([[x0, -y1, -B], [x0, -y1, F], [x0, -yl, F], [x0, -yl, -B]], [uv[0], uv[1], uv[2], uv[3]], 0.68);
      }
      if (!solidAt(c + 1, r)) {
        const uv = uvRect(e.ax + e.rightCol, e.ay, 1, th, AW, AH, 0.3);
        solid.quad([[x1, -y1, F], [x1, -y1, -B], [x1, -yr, -B], [x1, -yr, F]], [uv[0], uv[1], uv[2], uv[3]], 0.68);
      }
      if (!solidAt(c, r + 1) && kindAt(i + W) !== 'block') {
        const uv = uvRect(e.ax, e.ay + th - 1, tw, 1, AW, AH, 0.3);
        solid.quad([[x0, -y1, -B], [x1, -y1, -B], [x1, -y1, F], [x0, -y1, F]], uv, 0.45);
      }
    } else {
      // One-way platform: a thin plank you can stand on.
      let yl = y0, yr = y0;
      if (isSloped(id)) { const [l, rr] = slopeEdges(id); yl = y0 + l; yr = y0 + rr; }
      const T = 4;
      const uvTop = uvRect(e.ax, e.ay + e.topRow, tw, 1, AW, AH, 0.3);
      solid.quad([[x0, -yl, F - 1], [x1, -yr, F - 1], [x1, -yr, OB], [x0, -yl, OB]], uvTop, 1.0);
      const uvUnder = uvRect(e.ax, e.ay + Math.min(th - 1, e.topRow + T), tw, 1, AW, AH, 0.3);
      solid.quad([[x0, -yl - T, OB], [x1, -yr - T, OB], [x1, -yr - T, F - 1], [x0, -yl - T, F - 1]], uvUnder, 0.45);
      const uvL = uvRect(e.ax + e.leftCol, e.ay + e.topRow, 1, T, AW, AH, 0.3);
      if (kindAt(i - 1) !== kind) solid.quad([[x0, -yl - T, OB], [x0, -yl - T, F - 1], [x0, -yl, F - 1], [x0, -yl, OB]], uvL, 0.68);
      const uvR = uvRect(e.ax + e.rightCol, e.ay + e.topRow, 1, T, AW, AH, 0.3);
      if (kindAt(i + 1) !== kind) solid.quad([[x1, -yr - T, F - 1], [x1, -yr - T, OB], [x1, -yr, OB], [x1, -yr, F - 1]], uvR, 0.68);
      // Face of the platform art, flush with the front of the plank
      solid.quad([[x0, -y1, F - 1], [x1, -y1, F - 1], [x1, -y0, F - 1], [x0, -y0, F - 1]], uvRect(e.ax, e.ay, tw, th, AW, AH), 0.95);
    }
  }
  const solidMat = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });
  const solidMesh = solid.build(solidMat);
  if (solidMesh) { solidMesh.name = 'solid'; root.add(solidMesh); }

  // --- Flat tile layers (decor and edges)
  const isSolidCell = i => { const k = kindAt(i); return k === 'block' || k === 'ice-block'; };
  flatLayers.forEach((layer, li) => {
    let onSolid = 0, total = 0;
    for (let i = 0; i < W * H; i++) if (layer.data[i]) { total++; if (kindAt(i) !== null) onSolid++; }
    const ground = total > 0 && onSolid / total >= 0.5;
    let z;
    if (layer.properties.foreground) z = F + 6 + li * 0.05;
    else if (ground) z = F - 1.5 + li * 0.02;
    else z = DZ + li * 0.3;
    const batches = new Map();
    for (let i = 0; i < W * H; i++) {
      const gid = layer.data[i];
      if (!gid) continue;
      if (!layer.properties.foreground && layer.opacity >= 1) {
        if (isSolidCell(i) && cellEntry[i] >= 0) continue;           // baked into the extruded block
        if (onewayLayer[i] === li && onewayTop[i] === gid) continue;  // baked into the plank
      }
      const ts = tsFor(gid); if (!ts) continue;
      if (!batches.has(ts)) batches.set(ts, new Batch());
      const local = gid - ts.firstgid;
      const c = i % W, r = Math.floor(i / W);
      const x0 = c * tw, y0 = r * th;
      batches.get(ts).quad([[x0, -(y0 + th), z], [x0 + tw, -(y0 + th), z], [x0 + tw, -y0, z], [x0, -y0, z]],
        uvRect((local % ts.cols) * tw, Math.floor(local / ts.cols) * th, tw, th, ts.width, ts.height), 1);
    }
    for (const [ts, b] of batches) {
      const translucent = layer.opacity < 1;
      const mat = new THREE.MeshBasicMaterial({ map: ts.texture, vertexColors: true, transparent: translucent,
        opacity: layer.opacity, alphaTest: translucent ? 0.02 : 0.5, depthWrite: !translucent });
      const mesh = b.build(mat);
      if (mesh) { mesh.name = 'layer:' + layer.name; mesh.renderOrder = translucent ? 10 + li : 0; root.add(mesh); }
    }
  });

  // --- Parallax layers become real depth planes
  const parallaxGroups = [];
  const offsetTiles = +(data.properties.offset || 0);
  for (const layer of parallaxLayers) {
    const p = +layer.properties.parallax;
    const b = new Batch();
    const ts = tsFor(layer.data.find(g => g) || 1);
    for (let i = 0; i < W * H; i++) {
      const gid = layer.data[i];
      if (!gid) continue;
      const local = gid - ts.firstgid;
      const c = i % W, r = Math.floor(i / W);
      const x0 = c * tw, y0 = r * th;
      b.quad([[x0, -(y0 + th), 0], [x0 + tw, -(y0 + th), 0], [x0 + tw, -y0, 0], [x0, -y0, 0]],
        uvRect((local % ts.cols) * tw, Math.floor(local / ts.cols) * th, tw, th, ts.width, ts.height), 1);
    }
    const mat = new THREE.MeshBasicMaterial({ map: ts.texture, vertexColors: true, alphaTest: 0.5,
      transparent: layer.opacity < 1, opacity: layer.opacity, fog: true });
    const mesh = b.build(mat);
    if (!mesh) continue;
    const g = new THREE.Group();
    g.name = 'parallax:' + layer.name;
    g.add(mesh);
    root.add(g);
    parallaxGroups.push({ group: g, p });
  }
  // Positions parallax planes so that, seen from viewDistancePx, they scroll exactly like the 2D original.
  function setViewDistance(viewDistancePx) {
    for (const { group, p } of parallaxGroups) {
      const k = 1 / p;
      group.scale.setScalar(k);
      group.position.set(-(k - 1) * SCREEN_W / 2, (k - 1) * (SCREEN_H / 2 + th * offsetTiles), -(k - 1) * viewDistancePx);
    }
  }
  setViewDistance(opts.viewDistancePx || 600);

  const props = data.properties;
  const sky = new THREE.Color(`rgb(${props.red || 115},${props.green || 222},${props.blue || 250})`);
  return { root, map, data, setViewDistance, sky, pixelW: W * tw, pixelH: H * th };
}
