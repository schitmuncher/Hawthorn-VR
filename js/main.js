import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { World } from './world.js';
import * as Input from './input.js';
import * as Audio from './audio.js';
import { Hud, UI } from './hud.js';
import { Menu } from './menu.js';
import { loadImage } from './level.js';
import { Environment } from './env.js';
import { MixedReality } from './mr.js';

// ------------------------------------------------------------------ settings
const params = new URLSearchParams(location.search);
const saved = JSON.parse(localStorageGet('hawkvr-settings') || '{}');
export const settings = Object.assign({
  character: 'abed', scheme: 'classic', scale: 1, flatZoom: 1, distance: 1.35, height: -0.18,
  follow: 'smooth', vignette: true, music: 0.45, sfx: 0.8, haptics: true, quality: 'high', shadows: true,
}, saved);
if (params.get('char')) settings.character = params.get('char');
export function saveSettings() { localStorageSet('hawkvr-settings', JSON.stringify(settings)); }
function localStorageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

// ------------------------------------------------------------------ renderer & scene
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
// Sharper image on Quest: render a bit above the default eye-buffer size, light foveation only
renderer.xr.setFramebufferScaleFactor(settings.quality === 'high' ? 1.4 : 1.0);
renderer.xr.setFoveation(0.25);
UI.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 100);
scene.add(camera);

const skyColor = new THREE.Color(0x73def9);
scene.fog = new THREE.Fog(skyColor, 2.6, 7.5);
const sky = makeSky();
scene.add(sky);
const env = new Environment(scene);
env.group.visible = false;
const mainFog = scene.fog;

// The anchor is where the diorama lives in the room; the stage inside it scrolls to follow the player.
const anchor = new THREE.Group();
scene.add(anchor);
const stage = new THREE.Group();
anchor.add(stage);
const BASE_SCALE = 1.25 / 528; // metres per game pixel: 22 tiles ~ 1.25 m tall
const mr = new MixedReality(renderer, scene, anchor, stage);
const WINDOW = { w: 2.0, h: 1.25 };
let xrMode = null; // 'vr' | 'mr' while in a headset session

// HUD and menus float in the room next to the diorama (never head-locked)
const hud = new Hud();
anchor.add(hud.mesh, hud.toastMesh, hud.hintMesh);
const menu = new Menu(settings, onMenuAction);
anchor.add(menu.mesh);

// Vignette for comfort while the world scrolls (VR only)
const vignette = makeVignette();
camera.add(vignette);

// ------------------------------------------------------------------ XR controllers
const controllerFactory = new XRControllerModelFactory();
const hands = {}; // handedness -> { grip, ray, line }
[0, 1].forEach(i => {
  const grip = renderer.xr.getControllerGrip(i);
  grip.add(controllerFactory.createControllerModel(grip));
  scene.add(grip);
  const ray = renderer.xr.getController(i);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: 0xf6d36b, transparent: true, opacity: 0.85 }));
  line.visible = false;
  ray.add(line);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
  dot.renderOrder = 1001; dot.visible = false; scene.add(dot);
  scene.add(ray);
  const entry = { grip, ray, line, dot };
  ray.addEventListener('connected', e => { entry.hand = e.data.handedness; entry.hasPad = !!e.data.gamepad; hands[e.data.handedness] = entry; });
  ray.addEventListener('disconnected', () => { if (entry.hand && hands[entry.hand] === entry) delete hands[entry.hand]; });
});
const xrState = { session: null, sources: [], dragging: null };
renderer.xr.addEventListener('sessionstart', () => {
  xrState.session = renderer.xr.getSession();
  xrMode = xrMode || 'vr';
  document.body.classList.add('in-xr');
  document.body.classList.toggle('in-mr', xrMode === 'mr');
  if (xrMode === 'mr') {
    // Passthrough: no sky, no fog, transparent clear; the window/table placement takes over
    sky.visible = false; env.group.visible = false; scene.fog = null;
    renderer.setClearColor(0x000000, 0);
    mr.buildWindow(WINDOW.w * settings.scale, WINDOW.h * settings.scale, skyColor);
    mr.start(xrState.session);
    hud.toast('Point at a wall or table, pull the trigger', 6);
  } else {
    xrState.needsRecenter = true;
    env.group.visible = true;
  }
  menu.build();
  applyView();
  hud.showHints(settings.scheme, 14);
  // Holding the Meta button to re-centre the view also re-centres the diorama
  xrState.recenterTries = 0;
  // A controller press is a user gesture: use it to start audio if VR was auto-launched
  xrState.session.addEventListener('selectstart', () => Audio.unlock());
  xrState.session.addEventListener('squeezestart', () => Audio.unlock());
  // Pause when the Quest system menu / guardian takes over
  xrState.session.addEventListener('visibilitychange', e => { if (e.session.visibilityState !== 'visible' && !paused) setPaused(true); });
  const ref = renderer.xr.getReferenceSpace();
  if (ref && ref.addEventListener) ref.addEventListener('reset', () => { if (xrMode !== 'mr') xrState.needsRecenter = true; });
});
renderer.xr.addEventListener('sessionend', () => {
  xrState.session = null; xrState.sources = [];
  document.body.classList.remove('in-xr', 'in-mr');
  if (xrMode === 'mr') mr.stop();
  xrMode = null;
  sky.visible = true; env.group.visible = false; scene.fog = mainFog; anchor.visible = true;
  renderer.setClearColor(skyColor, 1); renderer.clippingPlanes = [];
  anchor.position.set(0, 0, 0); anchor.rotation.set(0, 0, 0);
  menu.build();
  setPaused(false);
  applyView();
});

// Laser pointers for the in-VR menu: point and pull the trigger.
const raycaster = new THREE.Raycaster();
const tmpMat = new THREE.Matrix4();
function updatePointers(input) {
  const active = paused && !!xrState.session;
  for (const h of Object.values(hands)) {
    h.line.visible = false; h.dot.visible = false;
    if (!active || !h.hasPad) continue;
    tmpMat.identity().extractRotation(h.ray.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(h.ray.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tmpMat);
    const hit = raycaster.intersectObject(menu.mesh, false)[0];
    h.line.visible = true;
    h.line.scale.z = hit ? hit.distance : 1.5;
    if (hit && hit.uv) {
      h.dot.visible = true; h.dot.position.copy(hit.point);
      const changed = menu.pointAt(hit.uv.x, 1 - hit.uv.y);
      if (changed && settings.haptics) Input.pulse(xrState.sources, h.hand, 0.15, 15);
      if (input.xr && input.xr.triggerPressed[h.hand]) menu.click(hit.uv.x);
    }
  }
}

// ------------------------------------------------------------------ game
let world = null;
let characters = [];
let paused = false;
let lastScheme = settings.scheme;
const follow = { x: 0, y: 0, vx: 0, ready: false };
let transition = null; // {t, phase, level, door}

async function boot() {
  const [chars, charMap] = await Promise.all([
    fetch('assets/characters.json').then(r => r.json()),
    fetch('assets/character_map.json').then(r => r.json()),
  ]);
  characters = chars;
  if (!characters.find(c => c.id === settings.character)) settings.character = 'abed';
  menu.setCharacters(characters);
  world = new World(stage, charMap);
  await world.setCharacter(characters.find(c => c.id === settings.character));
  await world.load(params.get('level') || 'forest', params.get('door') || 'main', viewDistancePx());
  onLevelLoaded();
  Audio.preload(['jump', 'punch', 'hit', 'pickup', 'damage', 'acorn_crush']);
  buildCharacterPicker();
  if (params.has('vrpreview')) hud.showHints(settings.scheme, 600);
  if (params.has('mrpreview')) {
    // Debug: fake passthrough room with the game hung on a wall (or stood on a table)
    xrMode = 'mr'; sky.visible = false; scene.fog = null; renderer.setClearColor(0x6b6f76, 1);
    const table = params.get('mrpreview') === 'table';
    mr.buildWindow(WINDOW.w * settings.scale, WINDOW.h * settings.scale, skyColor);
    mr.place(table ? { pos: new THREE.Vector3(0, 0.75, -1.0), normal: new THREE.Vector3(0, 1, 0), wall: false }
                   : { pos: new THREE.Vector3(0, 1.45, -1.9), normal: new THREE.Vector3(0, 0, 1), wall: true });
    hud.showHints(settings.scheme, 600);
  }
  document.body.classList.add('ready');
}

function onLevelLoaded() {
  skyColor.copy(world.level.sky);
  if (mainFog) mainFog.color.copy(skyColor);
  sky.material.uniforms.horizon.value.copy(skyColor);
  renderer.setClearColor(skyColor, xrMode === 'mr' ? 0 : 1);
  mr.setSky(skyColor);
  env.setLevel(world.level.data);
  follow.ready = false;
}

const vrLike = () => !!xrState.session || params.has('vrpreview') || params.has('mrpreview');
// How big the level is in each mode (metres per game pixel)
function modeFactor() {
  if (xrMode === 'mr') return mr.mode === 'table' ? 0.46 : (WINDOW.h * 1.12) / 1.25;
  return 1;
}
const stageScale = () => BASE_SCALE * (vrLike() ? settings.scale * modeFactor() : 1);
function viewDistancePx() {
  if (xrMode === 'mr') return (mr.mode === 'window' ? 1.8 : 1.0) / stageScale();
  return (vrLike() ? settings.distance : flatDistance()) / stageScale();
}
function flatDistance() {
  // Show roughly 15 tiles of height on screen (portrait phones see a bit more)
  const aspectBoost = camera.aspect < 1 ? 1.25 : 1;
  const visH = 360 * aspectBoost / settings.flatZoom * BASE_SCALE;
  return visH / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
}
// Where panels sit relative to the anchor, and how the stage is offset inside it
function layout() {
  const s = stageScale(), levelH = world && world.level ? Math.min(world.pixelH, 560) * s : 1.25;
  if (xrMode === 'mr' && mr.mode === 'window') return { top: WINDOW.h * settings.scale / 2 + 0.06, stageZ: -0.26, lift: 0 };
  if (xrMode === 'mr' && mr.mode === 'table') return { top: levelH + 0.05, stageZ: 0, lift: levelH / 2 + 24 * s };
  return { top: levelH * 0.5, stageZ: 0, lift: 0 };
}
function applyView() {
  const s = stageScale();
  stage.scale.setScalar(s);
  if (world && world.level) world.level.setViewDistance(viewDistancePx());
  const L = layout();
  const spread = xrMode === 'mr' && mr.mode === 'window' ? WINDOW.w * settings.scale / 2 - 0.2 : 0.44;
  hud.mesh.position.set(-spread, L.top + 0.1, 0.08);
  hud.toastMesh.position.set(0, L.top + 0.02, 0.14);
  hud.hintMesh.position.set(spread, L.top + 0.15, 0.08);
  menu.mesh.position.set(0, xrMode === 'mr' ? L.top - 0.3 : 0.02, 0.35);
  if (xrMode === 'mr') mr.buildWindow(WINDOW.w * settings.scale, WINDOW.h * settings.scale, skyColor);
  if (params.has('mrpreview') && !xrState.session) {
    camera.fov = 90; camera.updateProjectionMatrix();
    camera.position.set(0.25, 1.6, 0); camera.lookAt(0, mr.mode === 'table' ? 0.9 : 1.45, -1.5);
    hud.mesh.visible = true; hud.toastMesh.visible = true;
  } else if (params.has('vrpreview') && !xrState.session) {
    // Debug: approximate what a Quest user sees (wide FOV, diorama at arm's length)
    camera.fov = 90; camera.updateProjectionMatrix();
    camera.position.set(0, 1.6, 0); camera.lookAt(0, 1.6 + settings.height * 0.8, -1);
    anchor.position.set(0, 1.6 + settings.height, -settings.distance);
    hud.mesh.visible = true; hud.toastMesh.visible = true;
    env.group.visible = true;
  } else if (!xrState.session) {
    hud.mesh.visible = false; hud.toastMesh.visible = false;
    camera.position.set(0, 0.03, flatDistance());
    camera.lookAt(0, -0.015, 0);
  } else {
    hud.mesh.visible = true; hud.toastMesh.visible = true;
  }
}

function recenter() {
  // Put the diorama in front of the viewer, a little below eye height, facing them.
  const xrCam = renderer.xr.getCamera();
  const head = new THREE.Vector3(); xrCam.getWorldPosition(head);
  const dir = new THREE.Vector3(); xrCam.getWorldDirection(dir);
  dir.y = 0; if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1); dir.normalize();
  const yaw = Math.atan2(-dir.x, -dir.z);
  anchor.rotation.set(0, yaw, 0);
  anchor.position.copy(head).addScaledVector(dir, settings.distance);
  anchor.position.y = head.y + settings.height;
  applyView();
}

function onMenuAction(action, value) {
  switch (action) {
    case 'resume': setPaused(false); break;
    case 'recenter': recenter(); setPaused(false); break;
    case 'recenter-keep': if (xrState.session) recenter(); break;
    case 'character': setCharacter(value); break;
    case 'settings':
      saveSettings(); applyView(); Audio.setVolumes(settings.music, settings.sfx);
      if (settings.scheme !== lastScheme) { lastScheme = settings.scheme; hud.showHints(settings.scheme, 10); }
      break;
    case 'hints': hud.showHints(settings.scheme, 12); setPaused(false); break;
    case 'toast': hud.toast(value, 2.5); break;
    case 'place': setPaused(false); mr.beginPlacing(); hud.toast('Point at a wall or table, pull the trigger', 4); break;
    case 'restart': world.respawn(); setPaused(false); break;
    case 'exitvr': setPaused(false); xrState.session && xrState.session.end(); break;
  }
}

async function setCharacter(id) {
  const c = characters.find(c => c.id === id);
  if (!c || !world) return;
  settings.character = id; saveSettings();
  await world.setCharacter(c);
  hud.dirty = true;
}

function setPaused(p) {
  paused = p;
  menu.open = p;
  document.body.classList.toggle('paused', p && !xrState.session);
  if (p) menu.refresh();
}

// Positional sound: game positions -> room positions, listener follows your head
Audio.spatial.toWorld = (x, y) => stage.localToWorld(new THREE.Vector3(x, -y, 0));
const _lp = new THREE.Vector3(), _lf = new THREE.Vector3(), _lu = new THREE.Vector3(), _lq = new THREE.Quaternion();
function updateListener() {
  Audio.spatial.enabled = !!xrState.session;
  if (!xrState.session) return;
  const cam = renderer.xr.getCamera();
  cam.getWorldPosition(_lp); cam.getWorldQuaternion(_lq);
  _lf.set(0, 0, -1).applyQuaternion(_lq); _lu.set(0, 1, 0).applyQuaternion(_lq);
  Audio.setListener(_lp, _lf, _lu);
}

// ------------------------------------------------------------------ main loop
const clock = new THREE.Clock();
renderer.setAnimationLoop((t, frame) => {
  let dt = Math.min(clock.getDelta(), 1 / 30);
  if (frame && xrState.session) xrState.sources = [...xrState.session.inputSources];
  if (xrState.needsRecenter && frame) {
    // Wait until the headset pose is live (first frames can report the origin)
    const head = renderer.xr.getCamera().getWorldPosition(new THREE.Vector3());
    if (head.lengthSq() > 0.01 || ++xrState.recenterTries > 30) { recenter(); xrState.needsRecenter = false; xrState.recenterTries = 0; }
  }

  const input = Input.poll(xrState.sources, settings.scheme);
  if (!world || !world.level) { renderer.render(scene, camera); return; }

  if (input.pausePressed) setPaused(!paused);
  if (input.recenterPressed && xrState.session && xrMode !== 'mr') recenter();

  const actionHand = settings.scheme === 'lefty' ? 'left' : 'right';
  if (xrMode === 'mr' && mr.placing) {
    const before = mr.mode;
    const done = mr.update(frame, renderer.xr.getReferenceSpace(), xrState.sources,
      input.xr && (input.xr.triggerPressed[actionHand] || input.xr.triggerPressed[leftHand()]) || input.jumpPressed, actionHand,
      { w: WINDOW.w * settings.scale, h: WINDOW.h * settings.scale });
    if (mr.mode !== before || done) { applyView(); follow.ready = false; }
    if (done) { haptic(null, 0.5, 60); hud.showHints(settings.scheme, 12); hud.toast(mr.mode === 'window' ? 'Window placed' : 'Placed on the table', 1.5); }
  } else if (paused) {
    menu.update(dt, input);
  } else if (!transition) {
    // Zoom (right stick up/down in VR, +/- on keyboard)
    if (input.zoom) {
      const key = xrState.session ? 'scale' : 'flatZoom';
      settings[key] = THREE.MathUtils.clamp(settings[key] * (1 + input.zoom * dt * 0.9), 0.5, 2.5);
      applyView();
      zoomSaveTimer = 1;
    }
    // Substep physics so collisions stay stable at low frame rates
    const steps = Math.ceil(dt / (1 / 90));
    for (let i = 0; i < steps; i++) {
      world.update(dt / steps, i === 0 ? input : { ...input, jumpPressed: false, attackPressed: false });
    }
  }
  if (zoomSaveTimer > 0 && (zoomSaveTimer -= dt) <= 0) saveSettings();

  handleGrabDrag(input);
  updatePointers(input);
  handleEvents();
  updateTransition(dt);
  updateFollow(dt);
  hud.update(dt, world, settings);
  menu.mesh.visible = paused && !!xrState.session;
  updateVignette(dt);
  updateListener();
  world.shadowsOn = settings.shadows;
  if (env.group.visible) env.update(dt, anchor, world.pixelW ? Math.min(3, 2.2 * settings.scale) : 2);
  renderer.render(scene, camera);
});
let zoomSaveTimer = 0;

function handleEvents() {
  for (const e of world.events) {
    switch (e.type) {
      case 'title': hud.toast(e.text, 2.5, true); domToast(e.text, true); break;
      case 'toast': hud.toast(e.text, 2); domToast(e.text); break;
      case 'snap': follow.ready = false; break;
      case 'hit': haptic(rightHand(), 0.45, 35); break;
      case 'stomp': haptic(null, 0.35, 40); break;
      case 'hurt': haptic(null, 0.9, 120); break;
      case 'pickup': haptic(leftHand(), 0.2, 25); hud.dirty = true; break;
      case 'goto': transition = { t: 0, phase: 'out', level: e.level, door: e.door }; break;
    }
  }
  world.events.length = 0;
}
const rightHand = () => settings.scheme === 'lefty' ? 'left' : 'right';
const leftHand = () => settings.scheme === 'lefty' ? 'right' : 'left';
function haptic(hand, i, ms) { if (settings.haptics) Input.pulse(xrState.sources, hand, i, ms); }

// Diorama "swap": the level shrinks away, the next one grows in.
function updateTransition(dt) {
  if (!transition) return;
  transition.t += dt;
  const k = THREE.MathUtils.clamp(transition.t / 0.35, 0, 1);
  const ease = k * k * (3 - 2 * k);
  if (transition.phase === 'out') {
    stage.scale.setScalar(stageScale() * (1 - ease * 0.97));
    if (k >= 1 && !transition.loading) {
      transition.loading = true;
      world.load(transition.level, transition.door, viewDistancePx()).then(() => {
        onLevelLoaded(); transition.phase = 'in'; transition.t = 0;
      });
    }
  } else {
    stage.scale.setScalar(stageScale() * (0.03 + ease * 0.97));
    if (k >= 1) { transition = null; applyView(); }
  }
}

// Camera follow: in VR the stage slides under a fixed viewer; on screens the stage slides under the camera.
function updateFollow(dt) {
  const p = world.player, s = stage.scale.x;
  const look = p.facing === 'right' ? 36 : -36;
  let tx = p.centerX + (Math.abs(p.velocity.x) > 40 ? look : look * 0.5);
  const inVR = vrLike();
  const fitsVertically = world.pixelH * s < 1.9 && inVR;
  let ty = fitsVertically ? world.pixelH / 2 - 24 : p.centerY - 20;
  tx = THREE.MathUtils.clamp(tx, 0, world.pixelW);
  if (!fitsVertically) {
    const half = (inVR ? 0.55 : 0.2) / s;
    ty = THREE.MathUtils.clamp(ty, Math.min(half, world.pixelH / 2), Math.max(world.pixelH - half, world.pixelH / 2));
  }
  if (!follow.ready) { follow.x = tx; follow.y = ty; follow.ready = true; }
  // Dead zone keeps the world still during small moves (comfort), then catches up smoothly.
  const dz = settings.follow === 'tight' ? 8 : 40;
  const dxp = tx - follow.x;
  let target = follow.x;
  if (Math.abs(dxp) > dz) target = tx - Math.sign(dxp) * dz;
  const rate = settings.follow === 'tight' ? 10 : 4.5;
  const nx = THREE.MathUtils.damp(follow.x, target, rate, dt);
  follow.vx = (nx - follow.x) / Math.max(dt, 1e-4);
  follow.x = nx;
  follow.y = THREE.MathUtils.damp(follow.y, ty, 3, dt);
  const L = layout();
  stage.position.set(-follow.x * s, follow.y * s + L.lift, L.stageZ);
  updateTableClip();
}

// Table mode: trim the endless level strip to a tabletop-sized slice
const tablePlanes = [new THREE.Plane(), new THREE.Plane()];
let clipFrame = 0;
function updateTableClip() {
  const on = xrMode === 'mr' && mr.mode === 'table';
  renderer.localClippingEnabled = on;
  if (!on) { if (clipFrame) { stage.traverse(o => { if (o.material && o.material.clippingPlanes) o.material.clippingPlanes = null; }); clipFrame = 0; } return; }
  const hw = 0.75 * settings.scale;
  const xAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(anchor.quaternion);
  const a = anchor.position;
  tablePlanes[0].setFromNormalAndCoplanarPoint(xAxis, a.clone().addScaledVector(xAxis, -hw));
  tablePlanes[1].setFromNormalAndCoplanarPoint(xAxis.clone().negate(), a.clone().addScaledVector(xAxis, hw));
  if (clipFrame++ % 30 === 0) stage.traverse(o => {
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.clippingPlanes !== tablePlanes) { m.clippingPlanes = tablePlanes; m.needsUpdate = true; }
  });
}

function updateVignette(dt) {
  const on = !!xrState.session && settings.vignette && xrMode !== 'mr';
  const speed = Math.abs(follow.vx * stage.scale.x); // metres per second the world slides
  const target = on ? THREE.MathUtils.clamp((speed - 0.12) * 1.4, 0, 0.75) : 0;
  vignette.material.uniforms.strength.value = THREE.MathUtils.damp(vignette.material.uniforms.strength.value, target, 6, dt);
  vignette.visible = vignette.material.uniforms.strength.value > 0.01;
}

// Hold a grip to grab the diorama and move it; hold both grips and pull apart to scale.
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
function handleGrabDrag(input) {
  if (!xrState.session || !input.xr || paused || settings.scheme === 'onehand' || (xrMode === 'mr' && (mr.mode === 'window' || mr.placing))) { xrState.dragging = null; return; }
  const held = Object.values(hands).filter(h => input.xr.grips[h.hand]).map(h => h.grip);
  if (!held.length) { xrState.dragging = null; return; }
  const positions = held.map(g => g.getWorldPosition(new THREE.Vector3()));
  const mid = positions.length === 2 ? tmpA.copy(positions[0]).add(positions[1]).multiplyScalar(0.5) : tmpA.copy(positions[0]);
  const span = positions.length === 2 ? positions[0].distanceTo(positions[1]) : 0;
  const d = xrState.dragging;
  if (!d || d.count !== held.length) {
    xrState.dragging = { count: held.length, mid: mid.clone(), anchor: anchor.position.clone(), span, scale: settings.scale };
    if (settings.haptics) Input.pulse(xrState.sources, null, 0.25, 30);
    return;
  }
  anchor.position.copy(d.anchor).add(tmpB.copy(mid).sub(d.mid));
  if (held.length === 2 && d.span > 0.05) {
    settings.scale = THREE.MathUtils.clamp(d.scale * span / d.span, 0.5, 2.5);
    applyView(); zoomSaveTimer = 1;
  }
}

// ------------------------------------------------------------------ helpers
function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { horizon: { value: skyColor.clone() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 horizon; varying vec3 vDir;
      void main(){
        float h = vDir.y;
        vec3 top = horizon * vec3(0.55, 0.7, 0.95);
        vec3 ground = horizon * vec3(0.35, 0.45, 0.4);
        vec3 c = h > 0.0 ? mix(horizon, top, smoothstep(0.0, 0.7, h)) : mix(horizon, ground, smoothstep(0.0, 0.25, -h));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), mat);
  m.renderOrder = -10;
  return m;
}

function makeVignette() {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false,
    uniforms: { strength: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float strength; varying vec2 vUv;
      void main(){ float d = distance(vUv, vec2(0.5)); float a = smoothstep(0.5 - strength * 0.32, 0.62 - strength * 0.2, d) * strength; gl_FragColor = vec4(0.0,0.0,0.0,a); }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), mat);
  m.position.z = -0.3; m.renderOrder = 1000; m.visible = false;
  return m;
}

// ------------------------------------------------------------------ flat-screen UI (DOM)
const $ = s => document.querySelector(s);
let toastTimer = 0;
function domToast(text, big) {
  const el = $('#toast');
  el.textContent = text; el.className = big ? 'show big' : 'show';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.className = '', big ? 2200 : 1800);
}

async function buildCharacterPicker() {
  const list = $('#chars'); list.innerHTML = '';
  for (const c of characters) {
    const b = document.createElement('button');
    b.className = 'char' + (c.id === settings.character ? ' on' : '');
    b.title = c.name;
    const cv = document.createElement('canvas'); cv.width = 48; cv.height = 48;
    const img = await loadImage(c.sheet);
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(img, 0, 48, 48, 48, 0, 0, 48, 48);
    b.appendChild(cv);
    const label = document.createElement('span'); label.textContent = c.name.split(' ')[0]; b.appendChild(label);
    b.onclick = () => { setCharacter(c.id); list.querySelectorAll('.char').forEach(x => x.classList.toggle('on', x === b)); };
    list.appendChild(b);
  }
}

$('#play').onclick = () => { Audio.unlock(); Audio.setVolumes(settings.music, settings.sfx); document.body.classList.add('playing'); };
async function enterVR(quiet) {
  Audio.unlock(); Audio.setVolumes(settings.music, settings.sfx);
  try {
    xrMode = 'vr';
    renderer.xr.setFramebufferScaleFactor(settings.quality === 'high' ? 1.4 : 1.0);
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    await renderer.xr.setSession(session);
    document.body.classList.add('playing');
    return true;
  } catch (e) { if (!quiet) domToast('Could not start VR: ' + e.message); return false; }
}
$('#vr').onclick = () => enterVR(false);
$('#mr').onclick = async () => {
  Audio.unlock(); Audio.setVolumes(settings.music, settings.sfx);
  try {
    xrMode = 'mr';
    renderer.xr.setFramebufferScaleFactor(settings.quality === 'high' ? 1.4 : 1.0);
    const session = await navigator.xr.requestSession('immersive-ar', { optionalFeatures: ['local-floor', 'hit-test', 'plane-detection', 'anchors', 'hand-tracking'] });
    await renderer.xr.setSession(session);
    document.body.classList.add('playing');
  } catch (e) { xrMode = null; domToast('Could not start mixed reality: ' + e.message); }
};
if (navigator.xr) navigator.xr.isSessionSupported('immersive-ar').then(ok => { if (ok) document.body.classList.add('mr-ok'); }).catch(() => {});

// Installed as an app on Quest: go straight into VR (falls back to the title screen if the browser wants a tap first)
const launchedAsApp = params.has('app') || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
async function autoEnterVR() {
  if (!launchedAsApp || !navigator.xr) return;
  if (!(await navigator.xr.isSessionSupported('immersive-vr').catch(() => false))) return;
  await enterVR(true);
}

// Offline support / installability
if ('serviceWorker' in navigator && !params.has('nosw') && location.protocol !== 'file:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
$('#menuBtn').onclick = () => setPaused(!paused);
$('#resume').onclick = () => setPaused(false);
$('#home').onclick = () => { setPaused(false); document.body.classList.remove('playing'); };
if (navigator.xr) navigator.xr.isSessionSupported('immersive-vr').then(ok => { if (ok) document.body.classList.add('xr-ok'); }).catch(() => {});

// Touch controls
function bindHold(el, on, off) {
  const start = e => { e.preventDefault(); Audio.unlock(); on(); el.classList.add('down'); };
  const end = e => { e.preventDefault(); off(); el.classList.remove('down'); };
  el.addEventListener('pointerdown', start); el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end); el.addEventListener('pointerleave', end);
}
const pad = $('#pad');
const padMove = e => {
  const r = pad.getBoundingClientRect();
  const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
  Input.touch.x = Math.abs(dx) > 0.25 ? Math.sign(dx) * Math.min(1, Math.abs(dx) * 1.3) : 0;
  Input.touch.up = dy < -0.55; Input.touch.down = dy > 0.55;
  pad.style.setProperty('--kx', Math.max(-1, Math.min(1, dx)) * 30 + 'px');
  pad.style.setProperty('--ky', Math.max(-1, Math.min(1, dy)) * 30 + 'px');
};
pad.addEventListener('pointerdown', e => { e.preventDefault(); pad.setPointerCapture(e.pointerId); Audio.unlock(); padMove(e); });
pad.addEventListener('pointermove', e => { if (pad.hasPointerCapture(e.pointerId)) padMove(e); });
const padEnd = () => { Input.touch.x = 0; Input.touch.up = Input.touch.down = false; pad.style.setProperty('--kx', '0px'); pad.style.setProperty('--ky', '0px'); };
pad.addEventListener('pointerup', padEnd); pad.addEventListener('pointercancel', padEnd);
bindHold($('#btnJump'), () => { Input.touch.jump = true; Input.touch.jumpTap = true; }, () => { Input.touch.jump = false; });
bindHold($('#btnAttack'), () => { Input.touch.attackTap = true; }, () => {});

document.addEventListener('visibilitychange', () => { if (document.hidden && document.body.classList.contains('playing') && !paused) setPaused(true); });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  applyView();
});

boot().then(() => { applyView(); autoEnterVR(); }).catch(e => { console.error(e); $('#loading').textContent = 'Failed to load: ' + e.message; });

// Debug hooks for automated testing
window.__hawk = { get world() { return world; }, settings, applyView, setPaused, camera, scene, renderer };
