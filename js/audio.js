// Minimal Web Audio wrapper. Music and sound effects; fails silently where formats aren't supported.
let ctx = null, master = null, musicGain = null, sfxGain = null;
const buffers = new Map();
let musicNode = null, musicName = null, wanted = null;
export const settings = { music: 0.45, sfx: 0.8 };

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.connect(ctx.destination);
    musicGain = ctx.createGain(); musicGain.gain.value = settings.music; musicGain.connect(master);
    sfxGain = ctx.createGain(); sfxGain.gain.value = settings.sfx; sfxGain.connect(master);
  }
  if (ctx.state === 'suspended') ctx.resume();
  if (wanted && musicName !== wanted) music(wanted);
}

async function load(url) {
  if (!ctx) return null;
  if (!buffers.has(url)) {
    buffers.set(url, fetch(url).then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b)).catch(() => null));
  }
  return buffers.get(url);
}

export function preload(names) { names.forEach(n => load(`assets/audio/sfx/${n}.ogg`)); }

// Positional audio: main sets toWorld (game px -> metres in the room) and updates the listener from the head.
export const spatial = { toWorld: null, enabled: false };
export function setListener(p, f, u) {
  if (!ctx) return;
  const L = ctx.listener;
  if (L.positionX) {
    const t = ctx.currentTime;
    L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
    L.forwardX.setTargetAtTime(f.x, t, 0.02); L.forwardY.setTargetAtTime(f.y, t, 0.02); L.forwardZ.setTargetAtTime(f.z, t, 0.02);
    L.upX.setTargetAtTime(u.x, t, 0.02); L.upY.setTargetAtTime(u.y, t, 0.02); L.upZ.setTargetAtTime(u.z, t, 0.02);
  } else if (L.setPosition) { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
}

const lastPlayed = new Map();
export async function sfx(name, volume = 1, rate = 1, at = null) {
  if (!ctx) return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) || 0) < 40) return; // avoid stacking the same sound
  lastPlayed.set(name, now);
  const buf = await load(`assets/audio/sfx/${name}.ogg`);
  if (!buf) return;
  const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
  const g = ctx.createGain(); g.gain.value = volume;
  src.connect(g);
  if (at && spatial.enabled && spatial.toWorld) {
    const w = spatial.toWorld(at.x, at.y);
    const pan = ctx.createPanner();
    pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 0.8; pan.rolloffFactor = 0.6;
    if (pan.positionX) { pan.positionX.value = w.x; pan.positionY.value = w.y; pan.positionZ.value = w.z; } else pan.setPosition(w.x, w.y, w.z);
    g.connect(pan); pan.connect(sfxGain);
  } else g.connect(sfxGain);
  src.start();
}

export async function music(name) {
  wanted = name;
  if (!ctx || musicName === name) return;
  musicName = name;
  if (musicNode) { try { musicNode.stop(); } catch (e) {} musicNode = null; }
  const buf = await load(`assets/audio/music/${name}.ogg`);
  if (!buf || musicName !== name) return;
  musicNode = ctx.createBufferSource(); musicNode.buffer = buf; musicNode.loop = true;
  musicNode.connect(musicGain); musicNode.start();
}

export function setVolumes(m, s) {
  settings.music = m; settings.sfx = s;
  if (musicGain) musicGain.gain.value = m;
  if (sfxGain) sfxGain.gain.value = s;
}
