// Game objects: player, enemies, pickups, breakable blocks, liquids, signs.
// Physics constants and movement follow the original Lua game (game.lua / player.lua).
import * as THREE from 'three';
import * as C from './collision.js';
import { Sprite, Anim, spriteTexture, extrudedBox } from './sprite.js';
import { sfx } from './audio.js';

export const G = {
  friction: 0.146875 * 10000, accel: 0.046875 * 10000, deccel: 0.5 * 10000,
  gravity: 0.21875 * 10000, airaccel: 0.09375 * 10000, maxX: 300, maxY: 600,
  fallGrace: 0.075, jump: -670, halfJump: -450, climbSpeed: 110,
};

const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// ---------------------------------------------------------------- Player
export class Player {
  static async create(character, charMap) {
    const tex = await spriteTexture(character.sheet);
    return new Player(character, charMap, tex);
  }
  constructor(character, charMap, tex) {
    this.character = character;
    this.bbox = character.bbox;
    this.sprite = new Sprite(tex, 48, 48, { layers: 5, thickness: 8 });
    this.anims = {};
    for (const [state, def] of Object.entries(charMap)) {
      if (Array.isArray(def)) this.anims[state] = { left: new Anim(def), right: new Anim(def) };
      else this.anims[state] = { left: new Anim(def.left), right: new Anim(def.right) };
    }
    this.maxHealth = 100;
    this.reset(0, 0);
  }
  reset(x, y) {
    this.x = x; this.y = y;
    this.velocity = { x: 0, y: 0 };
    this.facing = 'right';
    this.jumping = false; this.sinceSolid = 0;
    this.platformDropping = false;
    this.health = this.maxHealth;
    this.invuln = 0; this.hurtTimer = 0;
    this.attackTimer = 0; this.attackCooldown = 0;
    this.crouching = false; this.climbing = null;
    this.dead = false; this.deadTimer = 0;
    this.state = 'idle'; this.animTime = 0;
  }
  get w() { return this.bbox.width; }
  get h() { return this.crouching && !this.jumping ? this.bbox.duck_height : this.bbox.height; }
  get box() { const h = this.h; return { x: this.x, y: this.y + this.bbox.height - h, w: this.w, h }; }
  get centerX() { return this.x + this.w / 2; }
  get centerY() { return this.y + this.bbox.height / 2; }

  wallPushback() { this.velocity.x = 0; }
  floorPushback() {
    if (this.velocity.y > 300) this.landed = this.velocity.y; // for dust puffs
    this.jumping = false; this.velocity.y = 0; this.sinceSolid = 0;
  }
  ceilingPushback() {}
  solidGround() { return this.sinceSolid < G.fallGrace; }

  hurt(damage, fromX) {
    if (this.invuln > 0 || this.dead || damage <= 0) return false;
    this.health = Math.max(0, this.health - damage);
    this.invuln = 1.5; this.hurtTimer = 0.35;
    this.velocity.x = fromX !== undefined ? (this.centerX < fromX ? -260 : 260) : 0;
    this.velocity.y = -260; this.jumping = true;
    sfx('damage', 1, 1, { x: this.centerX, y: this.centerY });
    if (this.health <= 0) this.die();
    return true;
  }
  die() {
    if (this.dead) return;
    this.dead = true; this.deadTimer = 0; this.health = 0;
    this.velocity.x = 0; this.velocity.y = -300;
    sfx('death', 1, 1, { x: this.centerX, y: this.centerY });
  }

  update(dt, input, world) {
    const map = world.map;
    this.animTime += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    if (this.dead) {
      this.deadTimer += dt;
      this.velocity.y = Math.min(this.velocity.y + G.gravity * dt, G.maxY);
      this.y += this.velocity.y * dt;
      this.setAnim('dead');
      return;
    }

    const left = input.x < -0.3, right = input.x > 0.3;
    const analog = Math.min(1, Math.abs(input.x) * 1.25); // partial stick = walk slower
    const grounded = this.solidGround() && !this.jumping;

    // --- Climbing (vines/ladders)
    const climb = world.climbables.find(c => overlap(this.box, c));
    if (!this.climbing && climb && (input.up || (input.down && !grounded))) {
      this.climbing = climb; this.jumping = false; this.velocity.x = 0; this.velocity.y = 0;
      this.crouching = false;
      // Slide onto the vine through the collision code so we can never be pushed into a wall
      this.x = C.moveX(map, { velocity: { x: 0, y: 0 } }, this.x, this.y, this.w, this.bbox.height, climb.x + climb.w / 2 - this.w / 2 - this.x);
    }
    if (this.climbing) {
      if (!overlap(this.box, this.climbing)) this.climbing = null;
      else if (input.jumpPressed) {
        this.climbing = null; this.jumping = true; this.velocity.y = G.jump * 0.8;
        this.velocity.x = left ? -G.maxX * 0.6 : right ? G.maxX * 0.6 : 0;
        sfx('jump', 0.7, 1, { x: this.centerX, y: this.centerY });
      } else {
        const vy = (input.up ? -1 : 0) + (input.down ? 1 : 0);
        const ny = C.moveY(map, this, this.x, this.y, this.w, this.bbox.height, 0, vy * G.climbSpeed * dt);
        if (vy > 0 && ny === this.y) this.climbing = null; // reached the ground
        // can't climb above the top of the vine
        this.y = Math.max(ny, this.climbing ? this.climbing.y - this.bbox.height * 0.5 : ny);
        this.sinceSolid = 0;
        this.setAnim(vy !== 0 ? 'climbing' : 'climbidle');
        return;
      }
    }

    // --- Crouch / drop through platforms
    const wantCrouch = input.down && grounded;
    if (wantCrouch) this.crouching = true;
    else if (this.crouching) {
      const dd = this.bbox.height - this.bbox.duck_height;
      if (C.canStand(map, this, this.x, this.y + dd, this.w, this.bbox.duck_height, this.bbox.height)) this.crouching = false;
    }
    // Auto-crawl: walking into a gap that's only crawl-high ducks you in automatically
    if (!this.crouching && grounded && (left || right) && !this.climbing) {
      const d = left ? -3 : 3, dd = this.bbox.height - this.bbox.duck_height, probe = { velocity: { x: 0, y: 0 } };
      const full = C.moveX(map, probe, this.x, this.y, this.w, this.bbox.height, d);
      const low = C.moveX(map, probe, this.x, this.y + dd, this.w, this.bbox.duck_height, d);
      if (Math.abs(low - this.x) > Math.abs(full - this.x) + 1) this.crouching = true;
    }
    if (input.down && input.jumpPressed && grounded) {
      const below = C.tileAt(map, C.currentTile(map, this.x, this.y, this.w, this.bbox.height + 2));
      if (below !== null && C.platformType(below) === 'oneway') { this.platformDropping = true; this.crouching = false; }
    }

    // --- Horizontal movement (sonic-style, as in player.lua)
    const accel = this.velocity.y < 0 ? G.airaccel : G.accel;
    const deccel = this.velocity.y < 0 ? G.airaccel : G.deccel;
    // Crouched = crawling: half speed, like the original's crawl state (fits through 1-tile gaps)
    const maxX = G.maxX * analog * (this.crouching ? 0.45 : 1);
    const stunned = this.hurtTimer > 0.15;
    if (left && !right && !stunned) {
      this.facing = 'left';
      if (this.velocity.x > 0 && !this.onIce) this.velocity.x -= deccel * dt;
      else if (this.velocity.x > -maxX) this.velocity.x = Math.max(this.velocity.x - accel * dt, -maxX);
    } else if (right && !left && !stunned) {
      this.facing = 'right';
      if (this.velocity.x < 0 && !this.onIce) this.velocity.x += deccel * dt;
      else if (this.velocity.x < maxX) this.velocity.x = Math.min(this.velocity.x + accel * dt, maxX);
    }
    if ((!left && !right) || Math.abs(this.velocity.x) > maxX) {
      const f = G.friction * (this.onIce ? 0.1 : 1) * dt;
      this.velocity.x = this.velocity.x < 0 ? Math.min(this.velocity.x + f, 0) : Math.max(this.velocity.x - f, 0);
    }

    // --- Jump
    const inWater = world.liquids.some(l => l.drag && overlap(this.box, l));
    // Jump buffering: a press shortly before landing still counts (feels much better with VR controllers)
    if (input.jumpPressed) this.jumpBuffer = 0.13;
    this.jumpBuffer = Math.max(0, (this.jumpBuffer || 0) - dt);
    if (this.jumpBuffer > 0 && !input.down && !this.jumping && this.solidGround() && !this.platformDropping) {
      this.jumpBuffer = 0;
      const dd = this.bbox.height - this.bbox.duck_height;
      if (!this.crouching || C.canStand(map, this, this.x, this.y + dd, this.w, this.bbox.duck_height, this.bbox.height)) {
        this.crouching = false;
        this.jumping = true;
        this.velocity.y = inWater ? -270 : G.jump;
        sfx('jump', 0.7, 1, { x: this.centerX, y: this.centerY });
      }
    }
    if (!input.jumpHeld && this.jumping && this.velocity.y < G.halfJump) this.velocity.y = G.halfJump;

    // --- Attack
    if (input.attackPressed) this.attackBuffer = 0.15;
    this.attackBuffer = Math.max(0, (this.attackBuffer || 0) - dt);
    if (this.attackBuffer > 0 && this.attackCooldown <= 0) {
      this.attackBuffer = 0;
      this.attackTimer = 0.22; this.attackCooldown = 0.3;
      // Holding down while punching digs into the block under your feet (or hits things below you mid-air)
      this.digging = input.down;
      sfx('punch', 0.7, 1, { x: this.centerX, y: this.centerY });
      world.playerAttack(this.digging ? this.digBox() : this.attackBox());
    }

    // --- Gravity + move (half step before and after, as in player.lua)
    this.velocity.y += G.gravity * dt / 2;
    if (this.velocity.y > G.maxY) this.velocity.y = G.maxY;
    this.sinceSolid += dt;
    const h = this.h, dd = this.bbox.height - h;
    let drag = inWater ? 0.55 : 1;
    const [nx, ny] = C.move(map, this, this.x, this.y + dd, this.w, h, this.velocity.x * dt * drag, this.velocity.y * dt * drag);
    this.x = nx; this.y = ny - dd;
    if (typeof this.platformDropping === 'number' && this.y + this.bbox.height > this.platformDropping + map.tileheight + 5) this.platformDropping = false;
    this.velocity.y += G.gravity * dt / 2;

    if (this.y > world.pixelH + 48) this.die();

    // --- Animation state
    const moving = Math.abs(this.velocity.x) > 10 && (left || right);
    let st;
    if (this.hurtTimer > 0) st = 'hurt';
    else if (this.attackTimer > 0 && this.digging) st = 'dig';
    else if (this.attackTimer > 0) st = this.jumping ? 'attackjump' : moving ? 'attackwalk' : 'attack';
    else if (this.jumping || !this.solidGround()) st = 'jump';
    else if (this.crouching) st = moving ? 'crawlwalk' : (input.down ? 'crouch' : 'crawlidle');
    else if (moving) st = 'walk';
    else if (input.up) st = 'gaze';
    else st = 'idle';
    this.setAnim(st);
  }

  digBox() {
    // Straight down, a little wider than you so you can dig a block you're half standing on
    return { x: this.x - 5, y: this.y + this.bbox.height - 4, w: this.w + 10, h: 18 };
  }

  attackBox() {
    const reach = 30; // fist reaches past the bounding box, like the sprite's punch frame
    return { x: this.facing === 'right' ? this.x + this.w - 4 : this.x - reach + 4, y: this.y + 2, w: reach, h: this.bbox.height - 4 };
  }

  setAnim(state) {
    let a = this.anims[state];
    if (state === 'climbing' || state === 'climbidle') a = this.anims.profileaway || this.anims.gaze || this.anims.jump;
    if (!a) a = this.anims.idle;
    if (state !== this.state) { this.state = state; this.animTime = 0; }
    const anim = a[this.facing];
    anim.t = state === 'climbidle' ? 0 : this.animTime;
    const [c, r] = anim.frame();
    this.sprite.setFrame(c, r);
  }

  render() {
    this.sprite.place(Math.floor(this.x - this.bbox.x), Math.floor(this.y - this.bbox.y), 1);
    this.sprite.visible = !(this.invuln > 0 && !this.dead && Math.floor(this.invuln * 12) % 2 === 0);
  }
}

// ---------------------------------------------------------------- Enemies
const ENEMIES = {
  acorn: { w: 20, h: 20, bbw: 14, bbh: 20, damage: 10, hp: 1, speed: 20, jumpkill: true, die: 'acorn_crush',
    anims: { default: { right: ['loop', ['4-5,1'], 0.25], left: ['loop', ['4-5,2'], 0.25] },
      attack: { right: ['loop', ['9-10,1'], 0.15], left: ['loop', ['9-10,2'], 0.15] },
      dying: { right: ['once', ['1,1'], 0.25], left: ['once', ['1,2'], 0.25] } } },
  cat: { w: 40, h: 20, bbw: 32, bbh: 20, damage: 0, hp: 1, speed: 20, jumpkill: true, die: 'meow',
    anims: { default: { right: ['loop', ['1,2-3'], 0.25], left: ['loop', ['2,2-3'], 0.25] },
      dying: { right: ['once', ['1,4'], 0.25], left: ['once', ['2,4'], 0.25] } } },
  bat: { w: 30, h: 22, bbw: 10, bbh: 18, damage: 10, hp: 1, speed: 75, jumpkill: true, fly: true, die: 'bat_die',
    anims: { default: { right: ['once', ['1,1'], 1], left: ['once', ['1,1'], 1] },
      dive: { right: ['once', ['2,1'], 1], left: ['once', ['2,1'], 1] },
      flying: { right: ['loop', ['3-5,1'], 0.12], left: ['loop', ['3-5,1'], 0.12] },
      dying: { right: ['once', ['2,1'], 1], left: ['once', ['2,1'], 1] } } },
  monkey: { w: 23, h: 29, bbw: 23, bbh: 29, damage: 0, hp: 1, speed: 10, jumpkill: true, fly: true, die: 'acorn_squeak',
    anims: { default: { right: ['loop', ['1,1', '1,3', '1,2', '1,3'], 0.25], left: ['loop', ['2,1', '2,3', '2,2', '2,3'], 0.25] },
      dying: { right: ['once', ['1,6'], 1], left: ['once', ['2,6'], 1] } } },
  fish: { w: 24, h: 24, bbw: 12, bbh: 20, damage: 10, hp: 1, speed: 0, jumpkill: false, fly: true, offset: { x: 13, y: 50 }, die: 'acorn_squeak',
    anims: { default: { right: ['loop', ['1-2,1'], 0.3], left: ['loop', ['1-2,1'], 0.3] },
      dying: { right: ['once', ['3,1'], 1], left: ['once', ['3,1'], 1] } } },
};

export class Enemy {
  static async create(node) {
    const type = node.properties.enemytype;
    const def = ENEMIES[type];
    if (!def) return null;
    const tex = await spriteTexture(`assets/images/enemies/${type}.png`);
    return new Enemy(type, def, node, tex);
  }
  constructor(type, def, node, tex) {
    this.type = type; this.def = def;
    const off = def.offset || { x: 0, y: 0 };
    const nh = node.height || def.h;
    this.x = node.x + off.x; this.y = node.y + nh - def.h + off.y;
    this.homeX = this.x; this.homeY = this.y;
    this.velocity = { x: 0, y: 0 };
    this.facing = node.properties.direction || (Math.random() < 0.5 ? 'left' : 'right');
    this.hp = def.hp; this.state = 'default'; this.t = 0; this.stateTime = 0;
    this.dead = false; this.dying = 0;
    this.sprite = new Sprite(tex, def.w, def.h, { layers: 3, thickness: 6 });
    this.anims = {};
    for (const [s, d] of Object.entries(def.anims)) this.anims[s] = { left: new Anim(d.left), right: new Anim(d.right) };
    this.delay = Math.random() * 2;
    this.minX = this.x - 24; this.maxX = this.x + 24;
  }
  get at() { return { x: this.x + this.def.w / 2, y: this.y + this.def.h / 2 }; }
  get box() {
    const d = this.def;
    return { x: this.x + d.w / 2 - d.bbw / 2, y: this.y + d.h / 2 - d.bbh / 2, w: d.bbw, h: d.bbh };
  }
  wallPushback() { this.velocity.x = 0; this.bumped = true; }
  floorPushback() { this.velocity.y = 0; this.grounded = true; }
  setState(s) { if (this.state !== s) { this.state = s; this.stateTime = 0; } }

  hurt(world) {
    if (this.dying) return;
    this.hp -= 1;
    if (this.hp <= 0) {
      this.dying = 0.75; this.setState('dying');
      sfx(this.def.die || 'hit', 1, 1, this.at);
      world.burst(this.box, 0xffffff, 6);
    }
  }

  update(dt, world) {
    this.t += dt; this.stateTime += dt;
    const p = world.player;
    if (this.dying) {
      this.dying -= dt;
      if (this.dying <= 0) this.dead = true;
      this.animate();
      return;
    }
    const d = this.def;
    const pdx = p.centerX - (this.x + d.w / 2), pdy = p.centerY - (this.y + d.h / 2);

    switch (this.type) {
      case 'acorn': {
        if (this.state === 'attack') {
          this.velocity.x = Math.sign(pdx) * d.speed * 4;
          if (this.stateTime > 4) { this.setState('default'); this.minX = this.x - 24; this.maxX = this.x + 24; }
        } else {
          if (Math.abs(pdx) < 80 && Math.abs(pdy) < 36 && !p.dead) { this.setState('attack'); sfx('acorn_growl', 0.6, 1, this.at); }
          if (this.x <= this.minX || this.bumped) this.facing = 'right';
          else if (this.x >= this.maxX) this.facing = 'left';
          this.velocity.x = (this.facing === 'right' ? 1 : -1) * d.speed;
        }
        if (this.velocity.x) this.facing = this.velocity.x > 0 ? 'right' : 'left';
        break;
      }
      case 'cat': {
        if (this.bumped || this.edgeAhead(world)) this.facing = this.facing === 'right' ? 'left' : 'right';
        this.velocity.x = (this.facing === 'right' ? 1 : -1) * d.speed;
        break;
      }
      case 'bat': {
        if (this.state === 'default') {
          if (Math.abs(pdx) < 75 && pdy > 0 && pdy < 220 && !p.dead) { this.setState('dive'); this.fly = Math.sign(pdx) || 1; sfx('bat_attack', 0.6, 1, this.at); }
        } else if (this.state === 'dive') {
          this.x += this.fly * 150 * 0.5 * dt; this.y += 150 * dt;
          if (this.stateTime > 0.9 || pdy < -10) this.setState('flying');
        } else if (this.state === 'flying') {
          this.x += this.fly * 100 * dt; this.y -= 75 * dt;
          if (this.y <= this.homeY) { this.y = this.homeY; this.homeX = this.x; this.setState('default'); }
          if (this.stateTime > 4) this.setState('default');
        }
        break;
      }
      case 'monkey': {
        if (this.y < this.homeY) this.down = true; else if (this.y > this.homeY + 40) this.down = false;
        this.y += (this.down ? 1 : -1) * d.speed * dt;
        this.facing = pdx > 0 ? 'right' : 'left';
        break;
      }
      case 'fish': {
        // Leaps out of the water in an arc, then drops back.
        if (this.delay > 0) { this.delay -= dt; break; }
        const T = 2, k = (this.stateTime % (T + 0.6)) / T;
        if (k <= 1) {
          const arc = k < 0.5 ? 1 - Math.pow(1 - k * 2, 2) : 1 - Math.pow((k - 0.5) * 2, 2);
          this.y = this.homeY - arc * 140;
        } else this.y = this.homeY;
        break;
      }
    }

    if (!d.fly) {
      this.bumped = false; this.grounded = false;
      this.velocity.y = Math.min(this.velocity.y + G.gravity * dt, G.maxY);
      const b = this.box;
      const [nx, ny] = C.move(world.map, this, b.x, b.y, b.w, b.h, this.velocity.x * dt, this.velocity.y * dt);
      this.x += nx - b.x; this.y += ny - b.y;
      if (this.y > world.pixelH + 100) this.dead = true;
    }
    this.animate();
  }

  edgeAhead(world) {
    if (!this.grounded) return false;
    const b = this.box;
    const ax = this.facing === 'right' ? b.x + b.w + 2 : b.x - 2;
    const col = Math.floor(ax / 24), row = Math.floor((b.y + b.h + 4) / 24);
    const id = world.map.coll[row * world.map.width + col];
    return id === undefined || id < 0;
  }

  animate() {
    const set = this.anims[this.state] || this.anims.default;
    const a = set[this.facing] || set.right;
    a.t = this.stateTime;
    const [c, r] = a.frame();
    this.sprite.setFrame(c, r);
    this.sprite.place(Math.round(this.x), Math.round(this.y), this.type === 'fish' ? -8 : 0);
    if (this.dying) this.sprite.tint(1, 0.6 + this.dying * 0.5, 0.6 + this.dying * 0.5);
  }
}

// ---------------------------------------------------------------- Breakable blocks
export class Breakable {
  static async create(node, map) {
    const name = node.properties.sprite || 'boulder';
    const tex = await spriteTexture(`assets/images/blocks/${name}.png`);
    const crumble = name === 'boulder' ? await spriteTexture('assets/images/blocks/boulder-crumble.png') : null;
    return new Breakable(node, map, tex, crumble);
  }
  constructor(node, map, tex, crumble) {
    this.x = node.x; this.y = node.y; this.w = node.width; this.h = node.height;
    this.hp = +(node.properties.hp || 1); this.maxHp = this.hp;
    this.map = map; this.broken = false;
    this.group = new THREE.Group();
    if (tex.image.width === this.w && tex.image.height === this.h && this.w === 24) {
      this.mesh = extrudedBox(tex, [0, 0], 24, 24, 10, 40);
      this.mesh.position.z = 0;
      this.group.add(this.mesh);
    } else {
      this.sprite = new Sprite(crumble || tex, this.w, this.h, { layers: 7, thickness: 30 });
      this.sprite.setRect(0, 0, this.w, this.h);
      this.group.add(this.sprite.group);
      this.sprite.group.position.z = -6;
    }
    this.group.position.set(this.x + this.w / 2, -(this.y + this.h / 2), 0);
    for (let yy = 0; yy < this.h; yy += 24) for (let xx = 0; xx < this.w; xx += 24) C.setTile(map, this.x + xx + 1, this.y + yy + 1, 104);
  }
  get box() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
  hit(world) {
    if (this.broken) return;
    this.hp -= 1;
    this.shake = 0.15;
    if (this.sprite && this.maxHp > 1) {
      const frames = 3, f = Math.min(frames - 1, Math.floor((1 - this.hp / this.maxHp) * frames));
      this.sprite.setRect(f * this.w, 0, this.w, this.h);
    }
    sfx(this.hp <= 0 ? 'boulder-crumble' : 'hit', 0.8, 1, { x: this.x + this.w / 2, y: this.y + this.h / 2 });
    if (this.hp <= 0) {
      this.broken = true;
      for (let yy = 0; yy < this.h; yy += 24) for (let xx = 0; xx < this.w; xx += 24) C.setTile(this.map, this.x + xx + 1, this.y + yy + 1, -1);
      world.burst(this.box, 0x9a7b55, 14);
      this.group.removeFromParent();
    }
  }
  update(dt) {
    if (this.shake > 0) {
      this.shake -= dt;
      this.group.position.x = this.x + this.w / 2 + (this.shake > 0 ? Math.sin(this.shake * 120) * 1.5 : 0);
    }
  }
}

// ---------------------------------------------------------------- Pickups (materials)
export class Pickup {
  static async create(node) {
    const kind = node.name;
    const tex = await spriteTexture(`assets/images/materials/${kind}.png`);
    return new Pickup(node, kind, tex);
  }
  constructor(node, kind, tex) {
    this.kind = kind; this.x = node.x; this.y = node.y; this.w = 24; this.h = 24;
    this.sprite = new Sprite(tex, 24, 24, { layers: 3, thickness: 5 });
    this.sprite.setRect(0, 0, 24, 24);
    this.t = Math.random() * 6; this.taken = false; this.fly = 0;
  }
  get box() { return { x: this.x + 4, y: this.y + 4, w: 16, h: 20 }; }
  update(dt) {
    this.t += dt;
    if (this.fly > 0) {
      this.fly -= dt;
      this.sprite.group.position.y += dt * 60;
      this.sprite.group.scale.setScalar(Math.max(0.01, this.fly / 0.4));
      if (this.fly <= 0) this.sprite.group.removeFromParent();
      return;
    }
    this.sprite.place(this.x, this.y + Math.sin(this.t * 2.5) * 2, 2);
    this.sprite.group.rotation.y = Math.sin(this.t * 1.2) * 0.6;
  }
  take() { this.taken = true; this.fly = 0.4; sfx('pickup', 0.7, 1, { x: this.x + 12, y: this.y + 12 }); }
}

// ---------------------------------------------------------------- Liquids (animated water/waterfalls)
export class Liquid {
  static async create(node) {
    const src = 'assets/' + node.properties.sprite;
    const tex = await spriteTexture(src);
    return new Liquid(node, tex);
  }
  constructor(node, tex) {
    const p = node.properties;
    this.x = node.x; this.y = node.y; this.w = node.width; this.h = node.height;
    this.drag = p.drag === 'true';
    this.speed = +(p.speed || 0.2);
    this.foreground = p.foreground !== 'false';
    this.opacity = p.opacity ? +p.opacity : 1;
    // Clone the texture twice so top and body rows animate independently.
    const frames = Math.floor(tex.image.width / 24);
    this.frames = frames;
    const mk = row => {
      const t = tex.clone(); t.needsUpdate = true;
      t.wrapS = THREE.RepeatWrapping;
      t.repeat.set(1 / frames, 0.5); t.offset.set(0, row === 1 ? 0.5 : 0);
      return t;
    };
    this.texTop = mk(1); this.texBody = mk(2);
    const mat = (t, o) => new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: o, depthWrite: false, alphaTest: 0.02 });
    this.group = new THREE.Group();
    const z = this.foreground ? 14 : -18;
    // One quad per 24px cell: keeps the pixel scale identical to the 2D game.
    const addCells = (row, h0, h1, material) => {
      const geo = new THREE.PlaneGeometry(24, 24);
      for (let yy = h0; yy < h1; yy += 24) for (let xx = 0; xx < this.w; xx += 24) {
        const m = new THREE.Mesh(geo, material);
        m.position.set(this.x + xx + 12, -(this.y + yy + 12), z);
        m.renderOrder = 20;
        this.group.add(m);
      }
    };
    addCells(1, 0, 24, mat(this.texTop, this.opacity));
    addCells(2, 24, this.h, mat(this.texBody, this.opacity));
    this.t = 0;
  }
  update(dt) {
    this.t += dt;
    const f = Math.floor(this.t / this.speed) % this.frames;
    this.texTop.offset.x = f / this.frames;
    this.texBody.offset.x = f / this.frames;
  }
}

// ---------------------------------------------------------------- Info signs
export class Sign {
  constructor(node) {
    this.x = node.x; this.y = node.y; this.w = node.width; this.h = node.height;
    this.text = (node.properties.info || '').split('|').map(s => s.trim()).join('\n');
    const lines = wrap(this.text, 30);
    const cv = document.createElement('canvas');
    const scale = 4, lh = 13;
    cv.width = 220 * scale; cv.height = (lines.length * lh + 14) * scale;
    const g = cv.getContext('2d');
    g.scale(scale, scale);
    g.fillStyle = 'rgba(20,16,30,0.88)'; roundRect(g, 1, 1, 218, cv.height / scale - 2, 6); g.fill();
    g.strokeStyle = '#f6d36b'; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold 10px "Press Start 2P", ui-monospace, monospace'; g.textBaseline = 'top';
    lines.forEach((l, i) => g.fillText(l, 8, 8 + i * lh));
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    this.panel = new THREE.Mesh(new THREE.PlaneGeometry(220 * 0.6, cv.height / scale * 0.6),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
    this.panel.renderOrder = 100;
    this.panel.position.set(this.x + this.w / 2, -(this.y - 40), 20);
    this.panel.visible = false;
    this.show = 0;
  }
  get box() { return { x: this.x - 24, y: this.y - 24, w: this.w + 48, h: this.h + 48 }; }
  update(dt, near) {
    this.show = Math.max(0, Math.min(1, this.show + (near ? dt : -dt) * 5));
    this.panel.visible = this.show > 0.01;
    this.panel.scale.setScalar(0.6 + 0.4 * this.show);
    this.panel.material.opacity = this.show;
  }
}

function wrap(text, n) {
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      if ((line + ' ' + w).trim().length > n) { out.push(line.trim()); line = w; } else line += ' ' + w;
    }
    if (line.trim()) out.push(line.trim());
  }
  return out;
}
export function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
export { overlap };
