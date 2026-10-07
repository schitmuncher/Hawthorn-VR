// Room-scale surroundings for VR: a forest floor built from the level's own tiles, drifting pollen,
// and a soft shadow under the floating diorama. Hidden in mixed reality.
import * as THREE from 'three';
import { loadImage, pixelTexture } from './level.js';
import { platformType } from './collision.js';

export class Environment {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'environment';
    scene.add(this.group);

    // Floor (texture set per level)
    this.floorMat = new THREE.MeshBasicMaterial({ color: 0x8a7aa0 });
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(14, 48), this.floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.renderOrder = -5;
    this.group.add(this.floor);

    // Shadow under the diorama
    const sc = document.createElement('canvas'); sc.width = sc.height = 128;
    const g = sc.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.45)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.005;
    this.group.add(this.shadow);

    // Pollen / fireflies drifting through the room
    const N = 220;
    const pos = new Float32Array(N * 3);
    this.seeds = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = 0.6 + Math.random() * 5, a = Math.random() * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = 0.2 + Math.random() * 2.6; pos[i * 3 + 2] = Math.sin(a) * r;
      this.seeds[i * 3] = Math.random() * 10; this.seeds[i * 3 + 1] = 0.3 + Math.random() * 0.7; this.seeds[i * 3 + 2] = Math.random();
    }
    this.base = pos.slice();
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dot = document.createElement('canvas'); dot.width = dot.height = 32;
    const dg = dot.getContext('2d');
    const rg = dg.createRadialGradient(16, 16, 0, 16, 16, 16);
    rg.addColorStop(0, 'rgba(255,250,200,1)'); rg.addColorStop(0.35, 'rgba(255,240,160,0.6)'); rg.addColorStop(1, 'rgba(255,240,160,0)');
    dg.fillStyle = rg; dg.fillRect(0, 0, 32, 32);
    this.pollen = new THREE.Points(pg, new THREE.PointsMaterial({
      size: 0.035, map: new THREE.CanvasTexture(dot), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
    }));
    this.pollen.frustumCulled = false;
    this.group.add(this.pollen);
    this.t = 0;
  }

  async setLevel(data) {
    // Pick a solid "earth" tile from the level to texture the room floor.
    const W = data.width, coll = data.collision || [];
    let gid = 0;
    outer: for (let c = 2; c < Math.min(W, 40); c++) {
      for (let r = 0; r < data.height - 2; r++) {
        const id = coll[r * W + c];
        if (id >= 0 && platformType(id) === 'block') {
          const rr = Math.min(data.height - 1, r + 2);
          for (const l of data.layers) if (!l.properties.parallax && l.data[rr * W + c]) gid = l.data[rr * W + c];
          if (gid) break outer;
          break;
        }
      }
    }
    const ts = data.tilesets.filter(t => t.image).sort((a, b) => a.firstgid - b.firstgid).filter(t => gid >= t.firstgid).pop();
    if (!gid || !ts) return;
    const img = await loadImage(ts.image);
    const cols = Math.floor(ts.width / ts.tilewidth), local = gid - ts.firstgid;
    const cv = document.createElement('canvas'); cv.width = cv.height = 24;
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
    g.drawImage(img, (local % cols) * 24, Math.floor(local / cols) * 24, 24, 24, 0, 0, 24, 24);
    const tex = pixelTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(14 * 2 / 0.3, 14 * 2 / 0.3); // ~30 cm tiles
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.anisotropy = 8;
    tex.needsUpdate = true;
    if (this.floorMat.map) this.floorMat.map.dispose();
    this.floorMat.map = tex; this.floorMat.color.setRGB(0.75, 0.75, 0.75); this.floorMat.needsUpdate = true;
  }

  // anchorPos: where the diorama sits; size: its footprint in metres
  update(dt, anchor, width) {
    this.t += dt;
    this.shadow.position.x = anchor.position.x; this.shadow.position.z = anchor.position.z;
    this.shadow.rotation.z = anchor.rotation.y;
    this.shadow.scale.set(width, 0.9, 1);
    const p = this.pollen.geometry.attributes.position, b = this.base, s = this.seeds;
    for (let i = 0; i < p.count; i++) {
      const ph = s[i * 3] + this.t * s[i * 3 + 1];
      p.array[i * 3] = b[i * 3] + Math.sin(ph * 0.7) * 0.25;
      p.array[i * 3 + 1] = b[i * 3 + 1] + Math.sin(ph) * 0.12;
      p.array[i * 3 + 2] = b[i * 3 + 2] + Math.cos(ph * 0.5) * 0.25;
    }
    p.needsUpdate = true;
    this.pollen.material.opacity = 0.55 + 0.25 * Math.sin(this.t * 1.7);
  }
}
