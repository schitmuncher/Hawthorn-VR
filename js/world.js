// Level lifecycle: loading, entities, interactions, transitions.
import * as THREE from 'three';
import { buildLevel } from './level.js';
import { Player, Enemy, Breakable, Pickup, Liquid, Sign, overlap } from './entities.js';
import { sfx, music } from './audio.js';

export const LEVELS = ['forest', 'forest-2'];

export class World {
  constructor(stage, charMap) {
    this.stage = stage; this.charMap = charMap;
    this.level = null; this.player = null;
    this.events = []; // {type, ...} consumed by main (toasts, haptics, transitions)
    this.particles = [];
    this.inventory = { rock: 0, stick: 0, leaf: 0 };
    this.coins = 0;
    this.busy = false;
  }

  emit(e) { this.events.push(e); }

  async setCharacter(character) {
    const old = this.player;
    this.player = await Player.create(character, this.charMap);
    if (old) { this.player.x = old.x; this.player.y = old.y; this.player.facing = old.facing; old.sprite.dispose(); }
    if (this.level) this.level.root.add(this.player.sprite.group);
  }

  async load(name, doorName = 'main', viewDistancePx = 600) {
    this.busy = true;
    const data = await (await fetch(`assets/levels/${name}.json`)).json();
    const level = await buildLevel(data, { viewDistancePx });
    if (this.level) {
      this.player && this.player.sprite.group.removeFromParent();
      this.level.root.removeFromParent();
      disposeTree(this.level.root);
    }
    this.level = level; this.name = name;
    this.map = level.map; this.pixelW = level.pixelW; this.pixelH = level.pixelH;
    this.stage.add(level.root);

    const objs = data.objects;
    this.enemies = []; this.breakables = []; this.pickups = []; this.liquids = []; this.signs = [];
    this.doors = []; this.climbables = []; this.killers = [];
    const jobs = [];
    for (const o of objs) {
      const box = { x: o.x, y: o.y, w: o.width, h: o.height, node: o };
      switch (o.type) {
        case 'enemy': jobs.push(Enemy.create(o).then(e => { if (e) { this.enemies.push(e); level.root.add(e.sprite.group); } })); break;
        case 'breakable_block': jobs.push(Breakable.create(o, this.map).then(b => { this.breakables.push(b); level.root.add(b.group); })); break;
        case 'material': jobs.push(Pickup.create(o).then(p => { this.pickups.push(p); level.root.add(p.sprite.group); })); break;
        case 'liquid': jobs.push(Liquid.create(o).then(l => { this.liquids.push(l); level.root.add(l.group); })); break;
        case 'info': { const s = new Sign(o); this.signs.push(s); level.root.add(s.panel); break; }
        case 'door': this.doors.push(box); break;
        case 'climbable': this.climbables.push(box); break;
        case 'killing_floor': this.killers.push(box); break;
      }
    }
    await Promise.all(jobs);
    if (!this.player) throw new Error('setCharacter before load');
    level.root.add(this.player.sprite.group);
    this.spawnAt(doorName);
    this.particles.forEach(p => p.mesh.removeFromParent()); this.particles = [];
    music(data.properties.soundtrack || 'forest-2');
    this.emit({ type: 'title', text: data.properties.title || name });
    this.busy = false;
  }

  spawnAt(doorName) {
    const p = this.player;
    const door = this.doors.find(d => d.node.name === doorName && !d.node.properties.instant)
      || this.doors.find(d => d.node.name === 'main') || { x: 48, y: 0, w: 24, h: 48 };
    p.reset(door.x + door.w / 2 - p.w / 2, door.y + door.h - p.bbox.height);
    p.facing = door.x > this.pixelW / 2 ? 'left' : 'right';
    this.spawn = { x: p.x, y: p.y, facing: p.facing };
    this.emit({ type: 'snap' });
  }

  respawn() {
    const p = this.player;
    p.reset(this.spawn.x, this.spawn.y);
    p.facing = this.spawn.facing;
    p.invuln = 1.5;
    sfx('respawn');
    this.emit({ type: 'snap' });
  }

  playerAttack(box) {
    let hit = false;
    for (const e of this.enemies) if (!e.dying && overlap(box, e.box)) { e.hurt(this); hit = true; }
    for (const b of this.breakables) if (!b.broken && overlap(box, b.box)) { b.hit(this); hit = true; }
    if (hit) this.emit({ type: 'hit' });
  }

  burst(box, color, n) {
    const geo = burstGeo || (burstGeo = new THREE.BoxGeometry(3, 3, 3));
    const mat = new THREE.MeshBasicMaterial({ color });
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, mat);
      const x = box.x + Math.random() * box.w, y = box.y + Math.random() * box.h;
      m.position.set(x, -y, (Math.random() - 0.5) * 20);
      this.level.root.add(m);
      this.particles.push({ mesh: m, vx: (Math.random() - 0.5) * 160, vy: -Math.random() * 220 - 60, vz: (Math.random() - 0.5) * 120, life: 0.6 + Math.random() * 0.4 });
    }
  }

  update(dt, input) {
    if (!this.level || this.busy) return;
    const p = this.player;
    p.update(dt, input, this);

    if (p.dead) {
      if (p.deadTimer > 1.6) this.respawn();
    } else {
      const pb = p.box;
      // Enemies: stomp or get hurt
      for (const e of this.enemies) {
        if (e.dying || !overlap(pb, e.box)) continue;
        const eb = e.box;
        const falling = p.velocity.y > 0 && pb.y + pb.h - p.velocity.y * dt * 1.5 <= eb.y + eb.h * 0.5;
        if (falling && e.def.jumpkill) {
          e.hurt(this);
          p.velocity.y = -420; p.jumping = true;
          this.emit({ type: 'stomp' });
        } else if (e.def.damage > 0) {
          if (p.hurt(e.def.damage, eb.x + eb.w / 2)) this.emit({ type: 'hurt' });
        }
      }
      for (const k of this.killers) if (overlap(pb, k)) p.die();
      for (const it of this.pickups) if (!it.taken && overlap(pb, it.box)) {
        it.take(); this.inventory[it.kind] = (this.inventory[it.kind] || 0) + 1;
        this.emit({ type: 'pickup', kind: it.kind });
      }
      for (const s of this.signs) s.update(dt, overlap(pb, s.box));
      // Level exits
      for (const d of this.doors) {
        const pr = d.node.properties;
        if (pr.instant !== 'true' || !overlap(pb, d)) continue;
        if (LEVELS.includes(pr.level)) { this.emit({ type: 'goto', level: pr.level, door: pr.to || 'main' }); this.busy = true; }
        else {
          this.emit({ type: 'toast', text: `${pretty(pr.level)} isn't in this build yet` });
          p.x += d.x > this.pixelW / 2 ? -30 : 30; p.velocity.x = 0;
        }
        break;
      }
    }

    for (const e of this.enemies) e.update(dt, this);
    this.enemies = this.enemies.filter(e => { if (e.dead) { e.sprite.dispose(); return false; } return true; });
    for (const b of this.breakables) b.update(dt);
    for (const it of this.pickups) it.update(dt);
    for (const l of this.liquids) l.update(dt);
    for (const q of this.particles) {
      q.life -= dt; q.vy += 900 * dt;
      q.mesh.position.x += q.vx * dt; q.mesh.position.y -= q.vy * dt; q.mesh.position.z += q.vz * dt;
      q.mesh.rotation.x += dt * 8; q.mesh.rotation.y += dt * 6;
      if (q.life <= 0) q.mesh.removeFromParent();
    }
    this.particles = this.particles.filter(q => q.life > 0);
    p.render();
  }
}

let burstGeo = null;
const pretty = s => (s || 'somewhere').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

function disposeTree(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
  });
}
