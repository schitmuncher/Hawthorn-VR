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

  beginPlacing() { this.placing = true; this.smooth = null; this.lastHit = null; }

  /**
   * Placement mode. The game previews where it will go and follows your pointer smoothly.
   *  opts.style: 'window' (upright, on walls) | 'table' (lying on a surface)
   *  opts.snap: true = stick to detected walls/tables (falls back to free when none), false = free placement
   *  opts.distance: free-placement distance along the pointer (metres)
   * Returns true on the frame the user confirms.
   */
  update(frame, refSpace, sources, hand, opts) {
    if (!this.active || !this.placing) { this.reticle.visible = false; return false; }
    const src = sources.find(s => s.handedness === hand && s.targetRaySpace) || sources.find(s => s.targetRaySpace);
    if (!src || !frame) return false;
    const rp = frame.getPose(src.targetRaySpace, refSpace);
    if (!rp) return false;
    const rm = new THREE.Matrix4().fromArray(rp.transform.matrix);
    const origin = new THREE.Vector3().setFromMatrixPosition(rm);
    const dir = new THREE.Vector3(0, 0, -1).applyMatrix4(new THREE.Matrix4().extractRotation(rm)).normalize();
    const cam = this.renderer.xr.getCamera().getWorldPosition(new THREE.Vector3());

    let pos = null, normal = null, snapped = false;
    const wantWall = opts.style === 'window';
    const hs = opts.snap ? this.hitSources.get(src) : null;
    if (hs) {
      for (const hit of frame.getHitTestResults(hs)) {
        const pose = hit.getPose(refSpace);
        if (!pose) continue;
        const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
        const n = new THREE.Vector3(0, 1, 0).applyMatrix4(new THREE.Matrix4().extractRotation(m)).normalize();
        const isWall = Math.abs(n.y) < 0.5, isTop = n.y > 0.8;
        if ((wantWall && isWall) || (!wantWall && isTop)) {
          pos = new THREE.Vector3().setFromMatrixPosition(m); normal = n; snapped = true; break;
        }
      }
      // Ignore tiny hit-test jitter so the preview doesn't shimmer on the wall
      if (snapped && this.lastHit && pos.distanceTo(this.lastHit.pos) < 0.015 && normal.angleTo(this.lastHit.normal) < 0.05) {
        pos = this.lastHit.pos; normal = this.lastHit.normal;
      }
      if (snapped) this.lastHit = { pos: pos.clone(), normal: normal.clone() };
    }
    if (!pos) {
      // Free placement: along the pointer at the chosen distance, facing you, upright
      pos = origin.clone().addScaledVector(dir, opts.distance);
      normal = new THREE.Vector3(cam.x - pos.x, 0, cam.z - pos.z);
      if (normal.lengthSq() < 1e-4) normal.set(-dir.x, 0, -dir.z);
      normal.normalize();
      if (!wantWall) normal.set(0, 1, 0);
    }
    // Facing: walls face out along their normal; tables/free face the viewer
    let yaw;
    if (wantWall) yaw = Math.atan2(normal.x, normal.z);
    else yaw = Math.atan2(cam.x - pos.x, cam.z - pos.z);
    // Smooth the preview so it glides instead of jumping between frames
    if (!this.smooth) this.smooth = { pos: pos.clone(), yaw };
    const k = 1 - Math.exp(-(opts.dt || 0.016) * (snapped ? 18 : 12));
    this.smooth.pos.lerp(pos, k);
    let dy = yaw - this.smooth.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.smooth.yaw += dy * k;

    this.reticle.visible = true;
    this.reticle.position.copy(this.smooth.pos);
    if (wantWall) { this.reticle.rotation.set(0, this.smooth.yaw, 0); this.preview.scale.set(opts.size.w, opts.size.h, 1); }
    else { this.reticle.rotation.set(-Math.PI / 2, 0, this.smooth.yaw); this.preview.scale.set(opts.size.w * 0.75, 0.5, 1); }
    this.snapped = snapped;
    const flatNormal = new THREE.Vector3(Math.sin(this.smooth.yaw), 0, Math.cos(this.smooth.yaw));
    this.pending = { pos: this.smooth.pos.clone(), normal: wantWall ? flatNormal : new THREE.Vector3(0, 1, 0), wall: wantWall, yaw: this.smooth.yaw };
    this.place(this.pending, !!opts.confirm);
    return !!opts.confirm;
  }

  place({ pos, normal, wall, yaw }, final = true) {
    if (final) { this.placing = false; this.reticle.visible = false; this.smooth = null; }
    this.mode = wall ? 'window' : 'table';
    this.placedAt = { pos: pos.clone(), normal: normal.clone(), wall, yaw };
    this.anchor.position.copy(pos);
    if (yaw === undefined) {
      const cam = this.renderer.xr.getCamera().getWorldPosition(new THREE.Vector3());
      yaw = wall ? Math.atan2(normal.x, normal.z) : Math.atan2(cam.x - pos.x, cam.z - pos.z);
      this.placedAt.yaw = yaw;
    }
    this.anchor.rotation.set(0, yaw, 0);
    this.window.visible = wall;
  }
}
