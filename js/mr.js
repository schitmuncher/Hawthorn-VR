// Mixed reality (passthrough): point at a wall to hang the game there as a window into the forest,
// or at a table/floor to stand the diorama on it.
import * as THREE from 'three';

export class MixedReality {
  constructor(renderer, scene, anchor, stage) {
    this.renderer = renderer; this.scene = scene; this.anchor = anchor; this.stage = stage;
    this.active = false; this.placing = false; this.mode = 'window'; // 'window' | 'table'
    this.hitSources = new Map(); // inputSource -> XRHitTestSource
    this.hitTestSupported = false;

    // Placement reticle
    const ring = new THREE.RingGeometry(0.05, 0.065, 40);
    this.reticle = new THREE.Group();
    const rm = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xf6d36b, depthTest: false, transparent: true }));
    rm.renderOrder = 999;
    this.reticle.add(rm);
    this.preview = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
      new THREE.LineBasicMaterial({ color: 0xf6d36b, transparent: true, opacity: 0.8, depthTest: false }));
    this.preview.renderOrder = 999;
    this.reticle.add(this.preview);
    this.reticle.visible = false;
    scene.add(this.reticle);

    // The window: occluders around a hole + a frame + a recessed box with a sky backdrop.
    this.window = new THREE.Group();
    this.window.name = 'mr-window';
    this.windowParts = {};
    anchor.add(this.window);
    this.window.visible = false;
    this.size = { w: 1.6, h: 1.2, depth: 0.55 };
  }

  buildWindow(w, h, skyColor, depth = 0.55) {
    this.size.depth = depth;
    const key = w.toFixed(3) + 'x' + h.toFixed(3) + 'x' + depth.toFixed(3);
    if (this.builtKey === key) return;
    this.builtKey = key;
    this.size.w = w; this.size.h = h;
    const g = this.window;
    while (g.children.length) { const c = g.children.pop(); c.geometry && c.geometry.dispose(); }
    const D = this.size.depth;
    // Invisible "wall" with a hole: writes depth only, so anything behind the wall is hidden except through the hole.
    const occ = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true });
    const big = 30;
    const add = (geo, mat, x, y, z, ro = -100) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.renderOrder = ro; g.add(m); return m; };
    add(new THREE.PlaneGeometry(big, big), occ, 0, h / 2 + big / 2, 0);
    add(new THREE.PlaneGeometry(big, big), occ, 0, -h / 2 - big / 2, 0);
    add(new THREE.PlaneGeometry(big, h), occ, -w / 2 - big / 2, 0, 0);
    add(new THREE.PlaneGeometry(big, h), occ, w / 2 + big / 2, 0, 0);
    // Reveal (the inside edges of the hole)
    const reveal = new THREE.MeshBasicMaterial({ color: 0x2a2036, side: THREE.DoubleSide });
    const revealDark = new THREE.MeshBasicMaterial({ color: 0x1b1424, side: THREE.DoubleSide });
    const top = add(new THREE.PlaneGeometry(w, D), revealDark, 0, h / 2, -D / 2, 0); top.rotation.x = Math.PI / 2;
    const bot = add(new THREE.PlaneGeometry(w, D), reveal, 0, -h / 2, -D / 2, 0); bot.rotation.x = -Math.PI / 2;
    const lft = add(new THREE.PlaneGeometry(D, h), reveal, -w / 2, 0, -D / 2, 0); lft.rotation.y = Math.PI / 2;
    const rgt = add(new THREE.PlaneGeometry(D, h), reveal, w / 2, 0, -D / 2, 0); rgt.rotation.y = -Math.PI / 2;
    // Sky backdrop far behind the wall (only visible through the hole)
    this.skyMat = new THREE.MeshBasicMaterial({ color: skyColor, fog: false });
    add(new THREE.PlaneGeometry(40, 30), this.skyMat, 0, 0, -6, -50);
    // Frame on the wall
    const frameMat = new THREE.MeshBasicMaterial({ color: 0x4a3a60 });
    const trim = new THREE.MeshBasicMaterial({ color: 0xf6d36b });
    const t = 0.05, fd = 0.04;
    const bar = (bw, bh, x, y) => { add(new THREE.BoxGeometry(bw, bh, fd), frameMat, x, y, fd / 2, 1); };
    bar(w + 2 * t, t, 0, h / 2 + t / 2); bar(w + 2 * t, t, 0, -h / 2 - t / 2);
    bar(t, h, -w / 2 - t / 2, 0); bar(t, h, w / 2 + t / 2, 0);
    // Thin gold inner trim
    const tt = 0.008;
    add(new THREE.BoxGeometry(w, tt, fd + 0.004), trim, 0, h / 2 - tt / 2, fd / 2, 2);
    add(new THREE.BoxGeometry(w, tt, fd + 0.004), trim, 0, -h / 2 + tt / 2, fd / 2, 2);
    add(new THREE.BoxGeometry(tt, h, fd + 0.004), trim, -w / 2 + tt / 2, 0, fd / 2, 2);
    add(new THREE.BoxGeometry(tt, h, fd + 0.004), trim, w / 2 - tt / 2, 0, fd / 2, 2);
  }

  setSky(color) { if (this.skyMat) this.skyMat.color.copy(color); }

  async start(session) {
    this.active = true; this.placing = true;
    this.hitSources.clear();
    this.hitTestSupported = typeof session.requestHitTestSource === 'function';
    const make = async src => {
      if (!this.hitTestSupported || this.hitSources.has(src)) return;
      try { this.hitSources.set(src, await session.requestHitTestSource({ space: src.targetRaySpace })); } catch (e) { this.hitTestSupported = false; }
    };
    for (const s of session.inputSources) make(s);
    session.addEventListener('inputsourceschange', e => {
      e.added.forEach(make);
      e.removed.forEach(s => { const h = this.hitSources.get(s); if (h) h.cancel(); this.hitSources.delete(s); });
    });
  }

  stop() {
    this.active = false; this.placing = false;
    this.reticle.visible = false; this.window.visible = false;
    for (const h of this.hitSources.values()) try { h.cancel(); } catch (e) {}
    this.hitSources.clear();
  }

  beginPlacing() { this.placing = true; }

  /**
   * While placing: aim with the controller of `hand`, pull its trigger to place.
   * Returns true on the frame the game was placed.
   */
  update(frame, refSpace, sources, triggerPressed, hand, windowSize) {
    if (!this.active || !this.placing) { this.reticle.visible = false; return false; }
    const src = sources.find(s => s.handedness === hand && s.targetRaySpace) || sources.find(s => s.targetRaySpace);
    if (!src || !frame) return false;
    let pos = null, normal = null;
    const hs = this.hitSources.get(src);
    if (hs) {
      const hit = frame.getHitTestResults(hs)[0];
      const pose = hit && hit.getPose(refSpace);
      if (pose) {
        const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
        pos = new THREE.Vector3().setFromMatrixPosition(m);
        normal = new THREE.Vector3(0, 1, 0).applyMatrix4(new THREE.Matrix4().extractRotation(m)).normalize();
      }
    }
    if (!pos) {
      // No surface found: float it 1.6 m along the pointer, facing you
      const rp = frame.getPose(src.targetRaySpace, refSpace);
      if (!rp) return false;
      const m = new THREE.Matrix4().fromArray(rp.transform.matrix);
      const o = new THREE.Vector3().setFromMatrixPosition(m);
      const dir = new THREE.Vector3(0, 0, -1).applyMatrix4(new THREE.Matrix4().extractRotation(m));
      pos = o.addScaledVector(dir, 1.6);
      normal = dir.clone().negate(); normal.y = 0; normal.normalize();
    }
    const wall = Math.abs(normal.y) < 0.6;
    this.reticle.visible = true;
    this.reticle.position.copy(pos);
    // Orient reticle to the surface; preview rectangle shows the window size on walls
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    if (wall) {
      const yaw = Math.atan2(normal.x, normal.z);
      q.setFromEuler(new THREE.Euler(0, yaw, 0));
      this.preview.scale.set(windowSize.w, windowSize.h, 1);
      this.preview.rotation.set(0, 0, 0);
    } else {
      this.preview.scale.set(windowSize.w, 0.5, 1);
      this.preview.rotation.set(0, 0, 0);
    }
    this.reticle.quaternion.copy(q);
    this.pending = { pos, normal, wall };
    // Live preview: the game follows your pointer until you pull the trigger
    this.place(this.pending, !!triggerPressed);
    return !!triggerPressed;
  }

  place({ pos, normal, wall }, final = true) {
    if (final) { this.placing = false; this.reticle.visible = false; }
    this.mode = wall ? 'window' : 'table';
    this.placedAt = { pos: pos.clone(), normal: normal.clone(), wall };
    this.anchor.position.copy(pos);
    if (wall) {
      this.anchor.rotation.set(0, Math.atan2(normal.x, normal.z), 0);
      this.anchor.position.addScaledVector(new THREE.Vector3(normal.x, 0, normal.z).normalize(), 0.002);
    } else {
      // Table: face the diorama towards the viewer
      const cam = this.renderer.xr.getCamera().getWorldPosition(new THREE.Vector3());
      this.anchor.rotation.set(0, Math.atan2(cam.x - pos.x, cam.z - pos.z), 0);
    }
    this.window.visible = wall;
  }
}
