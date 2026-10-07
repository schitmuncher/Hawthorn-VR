// Unified input: keyboard, standard gamepads, WebXR controllers and on-screen touch controls.
// Each frame call poll(); read state.{x, up, down, jumpHeld, jumpPressed, attackPressed, ...}.

const keys = new Set();
const pressedKeys = new Set();
addEventListener('keydown', e => {
  if (e.repeat) return;
  keys.add(e.code); pressedKeys.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

export const touch = { x: 0, up: false, down: false, jump: false, attack: false, jumpTap: false, attackTap: false };

const KB = {
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
  jump: ['Space', 'KeyZ', 'KeyK'], attack: ['KeyX', 'KeyJ', 'KeyF'], pause: ['Escape', 'KeyP'], recenter: ['KeyR'],
};
const any = list => list.some(k => keys.has(k));
const anyPressed = list => list.some(k => pressedKeys.has(k));

export const state = {
  x: 0, up: false, down: false, jumpHeld: false, jumpPressed: false, attackPressed: false,
  pausePressed: false, recenterPressed: false, zoom: 0, source: 'keyboard',
  menuUp: false, menuDown: false, menuLeft: false, menuRight: false, confirm: false, back: false,
};

const prevButtons = new Map(); // id -> array of booleans
function edge(id, buttons) {
  const prev = prevButtons.get(id) || [];
  const now = buttons.map(b => !!(b && (b.pressed || b.value > 0.55)));
  prevButtons.set(id, now);
  return { now, pressed: i => now[i] && !prev[i] };
}

const DEAD = 0.22;
const dz = v => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

let prevMenu = {};

/** xrSources: array of XRInputSource (may be empty), scheme: control scheme name */
export function poll(xrSources = [], scheme = 'classic') {
  let x = 0, up = false, down = false, jumpHeld = false, jumpPressed = false, attackPressed = false;
  let pausePressed = false, recenterPressed = false, zoom = 0, source = state.source;

  // Keyboard
  if (any(KB.left)) x -= 1;
  if (any(KB.right)) x += 1;
  up ||= any(KB.up); down ||= any(KB.down);
  jumpHeld ||= any(KB.jump); jumpPressed ||= anyPressed(KB.jump);
  attackPressed ||= anyPressed(KB.attack);
  pausePressed ||= anyPressed(KB.pause);
  recenterPressed ||= anyPressed(KB.recenter);
  if (keys.size) source = 'keyboard';
  if (any(['Equal', 'NumpadAdd'])) zoom += 1;
  if (any(['Minus', 'NumpadSubtract'])) zoom -= 1;

  // Standard gamepads (also works in VR with a Bluetooth pad paired to the Quest)
  if (navigator.getGamepads) {
    for (const gp of navigator.getGamepads()) {
      if (!gp || !gp.connected || gp.mapping !== 'standard') continue;
      const { now, pressed } = edge('gp' + gp.index, [...gp.buttons]);
      const ax = dz(gp.axes[0] || 0), ay = dz(gp.axes[1] || 0);
      const dx = (now[15] ? 1 : 0) - (now[14] ? 1 : 0);
      if (Math.abs(ax) > 0 || dx || now.some(Boolean)) source = 'gamepad';
      x += dx || ax;
      up ||= ay < -0.5 || now[12]; down ||= ay > 0.5 || now[13];
      jumpHeld ||= now[0]; jumpPressed ||= pressed(0);
      attackPressed ||= pressed(2) || pressed(1) || pressed(7) || pressed(6);
      pausePressed ||= pressed(9);
      recenterPressed ||= pressed(8);
      zoom -= dz(gp.axes[3] || 0);
    }
  }

  // WebXR controllers (Quest Touch). xr-standard: 0 trigger, 1 grip, 3 stick click, 4 A/X, 5 B/Y; axes 2,3 stick
  //  classic : left stick move · A or X jump · either trigger or B punch · Y menu · left stick click recenter · right stick zoom
  //  lefty   : mirrored (right stick moves, left stick zooms, X/A jump, triggers or Y punch, B menu)
  //  onehand : any single controller does everything: stick move, A/X jump, trigger or B/Y punch, stick click menu
  const xr = { grips: {}, triggers: {}, triggerPressed: {} };
  for (const src of xrSources) {
    const gp = src.gamepad;
    if (!gp) continue;
    const hand = src.handedness;
    const { now, pressed } = edge('xr' + hand, [...gp.buttons]);
    const sx = dz(gp.axes[2] || 0), sy = dz(gp.axes[3] || 0);
    if (Math.abs(sx) > 0 || now.some(Boolean)) source = 'xr';
    xr.grips[hand] = now[1];
    xr.triggers[hand] = now[0];
    xr.triggerPressed[hand] = pressed(0);
    const moveHand = scheme === 'lefty' ? 'right' : 'left';
    if (scheme === 'onehand' || hand === moveHand) {
      x += sx;
      up ||= sy < -0.6; down ||= sy > 0.6;
    } else if (!now[1]) {
      zoom -= sy; // other stick up/down resizes the diorama (unless you're grabbing it)
    }
    jumpHeld ||= now[4]; jumpPressed ||= pressed(4);
    attackPressed ||= pressed(0);
    if (scheme === 'onehand') {
      attackPressed ||= pressed(5);
      pausePressed ||= pressed(3);
    } else if (hand === moveHand) {
      pausePressed ||= pressed(5);
      recenterPressed ||= pressed(3);
    } else {
      attackPressed ||= pressed(5);
    }
  }

  // Touch
  if (touch.x || touch.jump || touch.attack || touch.up || touch.down) source = state.source === 'xr' ? 'xr' : 'touch';
  x += touch.x; up ||= touch.up; down ||= touch.down;
  jumpHeld ||= touch.jump; jumpPressed ||= touch.jumpTap; attackPressed ||= touch.attackTap;
  touch.jumpTap = touch.attackTap = false;

  state.x = Math.max(-1, Math.min(1, x));
  state.up = up; state.down = down;
  state.jumpHeld = jumpHeld; state.jumpPressed = jumpPressed; state.attackPressed = attackPressed;
  state.pausePressed = pausePressed; state.recenterPressed = recenterPressed;
  state.zoom = Math.max(-1, Math.min(1, zoom));
  state.source = source;
  state.xr = xr;

  // Menu navigation edges (derived from the above)
  const m = { u: up, d: down, l: state.x < -0.6, r: state.x > 0.6 };
  state.menuUp = m.u && !prevMenu.u; state.menuDown = m.d && !prevMenu.d;
  state.menuLeft = m.l && !prevMenu.l; state.menuRight = m.r && !prevMenu.r;
  state.confirm = jumpPressed || anyPressed(['Enter']);
  state.back = anyPressed(['Backspace']);
  prevMenu = m;

  pressedKeys.clear();
  return state;
}

export function pulse(sources, hand, intensity = 0.5, ms = 40) {
  for (const s of sources) {
    if (hand && s.handedness !== hand) continue;
    const h = s.gamepad && s.gamepad.hapticActuators && s.gamepad.hapticActuators[0];
    if (h && h.pulse) h.pulse(intensity, ms);
    else if (s.gamepad && s.gamepad.vibrationActuator) s.gamepad.vibrationActuator.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: intensity });
  }
}
