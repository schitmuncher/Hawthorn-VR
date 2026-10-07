# Hawkthorne VR

The first two forest levels of *Journey to the Center of Hawkthorne* rebuilt as a 3D WebXR diorama.
The level floats in front of you like a model set: solid ground is extruded into real blocks, the
parallax backgrounds sit at real depths behind it, and characters, enemies and pickups are chunky
pixel cut-outs. Works on Meta Quest (browser or installed app), desktop and phones.

## Put it online (GitHub Pages)

1. Create a new repo (e.g. `hawkthorne-vr`) and upload **everything in this folder** (keep the folder structure).
2. Repo → Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. Open `https://<your-user>.github.io/hawkthorne-vr/` in the Quest browser and press **ENTER VR**.

It must be served over HTTPS (Pages does this) — WebXR won't start from a `file://` page.
Everything is self-contained (three.js is in `vendor/`), so no CDN is needed.

## Install it as an app on Quest

In the Quest browser, open the site and use the browser's **Install** option (install icon in the address bar or the ⋯ menu). It appears in your library,
runs offline (a service worker caches the whole game) and jumps straight into VR when launched.

### Building an APK (optional)

Meta's Bubblewrap fork packages a PWA into an APK you can sideload:

```
npm install --global @meta-quest/bubblewrap-cli
bubblewrap init --manifest=https://<your-user>.github.io/hawkthorne-vr/manifest.webmanifest --metaquest
bubblewrap build
adb install app-release-signed.apk
```

Pick **immersive** as the app mode during `init`.

## Mixed reality (Quest 3 passthrough)

Press **MIXED REALITY** on the title screen. The game follows your pointer (stick up/down sets the distance) until
you pull the trigger to place it. **B** switches between a **window** and a **tabletop diorama**; **A** turns on
snapping to detected walls/tables (off by default). Use **Move game** in the menu (Y) to put it somewhere else. Walls and tables are found
from your Quest's room setup; if none are detected it floats in front of you instead.

## Controls

| | Quest (Classic) | Keyboard | Gamepad |
|---|---|---|---|
| Move / climb / crouch | Left stick | ← → ↑ ↓ / WASD | Stick or d-pad |
| Jump (hold = higher) | A or X | Space | A |
| Drop through a platform | Down + A | Down + Space | Down + A |
| Punch | Either trigger or B | X | X / B / triggers |
| Menu | Y (point & pull trigger) | Esc | Start |
| Move the diorama | Grip and drag (both grips: pull apart to resize) | | |
| Resize | Right stick up/down | + / − | Right stick |
| Recenter | Left stick click (or hold the Meta button) | | |

The menu also has **Left-handed** (mirrored) and **One controller** layouts, follow tightness,
a comfort vignette while the world scrolls, size/distance/height, volume and haptics.

## What's in it

- `index.html`, `js/` — the game (three.js, ES modules, no build step)
  - `collision.js` is a direct port of the original `hawk/collision.lua` (slopes, one-way platforms)
  - `level.js` turns Tiled maps into the 3D diorama
  - `entities.js` player physics (from `player.lua`), acorns, cats, bats, monkeys, fish, boulders, pickups, water
- `assets/` — level data converted from the original `.tmx` maps, plus the original art and sound
- `tools/convert.py` — converts more levels: `python3 tools/convert.py <hawkthorne-journey/src> . forest forest-2 <level> …`
  (add the level name to `LEVELS` in `js/world.js`; new enemy types need a behaviour in `entities.js`)
- `tools/build_sw.py` — run `python3 tools/build_sw.py .` after changing files so the offline cache updates

Debug URL options: `?level=forest-2`, `?char=troy`, `?vrpreview` (VR-style view on a monitor), `?mrpreview=window|table`, `?nosw`.

## Credits & licences

Fan-made, non-commercial. Based on [Journey to the Center of Hawkthorne](https://github.com/hawkthorne/hawkthorne-journey)
by Project Hawkthorne — code MIT, original art and audio CC BY-NC 4.0 (see `HAWKTHORNE-LICENSING.md`).
Characters belong to their respective owners; not affiliated with NBC or Sony.
three.js © three.js authors, MIT (`vendor/three/LICENSE`).
