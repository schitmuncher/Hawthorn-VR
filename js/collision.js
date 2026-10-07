// Port of Project Hawkthorne's hawk/collision.lua (MIT).
// Tile indices are 1-based like the Lua original: index = row * width + col (col starts at 1).
// map.coll is a flat array where map.coll[index - 1] is the local collision tile id, or -1.

export function tileAt(map, i) {
  if (i < 1 || i > map.coll.length) return null;
  const id = map.coll[i - 1];
  return id >= 0 ? id : null;
}

export function platformType(id) {
  if (id >= 78 && id <= 103) return 'ice-block';
  if (id >= 52 && id <= 77) return 'no-drop';
  if (id >= 26 && id <= 51) return 'oneway';
  if ((id >= 0 && id <= 25) || (id >= 104 && id <= 129)) return 'block';
  return 'block';
}

export function isSloped(id) {
  return (id > 0 && id < 21) || (id > 26 && id < 47) || (id > 52 && id < 73) ||
         (id > 78 && id < 99) || (id > 104 && id < 125);
}

export function isSpecial(id) {
  return (id > 20 && id < 26) || (id > 46 && id < 52) || (id > 72 && id < 78) ||
         (id > 98 && id < 104) || (id > 126 && id < 130);
}

const SLOPES = [null, [23, 0], [0, 23], [23, 12], [11, 0], [0, 11], [12, 23], [23, 16], [15, 8], [7, 0],
  [0, 7], [8, 15], [16, 23], [23, 18], [17, 12], [11, 7], [6, 0], [0, 6], [7, 11], [12, 17], [18, 23]];
const SPECIAL = [[0, 12, 24, 24], [0, 12, 12, 24], [12, 12, 24, 24], [0, 0, 12, 24], [12, 0, 24, 24]];

export function slopeEdges(id) {
  const s = SLOPES[id % 26];
  return s ? s : [0, 0];
}

function specialInterpY(id, tileX, x, width, dir) {
  const t = SPECIAL[(id % 26) - 21];
  if (!t) return null;
  if (x + width - tileX <= t[0] || x - tileX >= t[2]) return null;
  return dir === 'down' ? t[1] : t[3];
}

function specialInterpX(id, tileY, y, dir) {
  const t = SPECIAL[(id % 26) - 21];
  if (!t) return null;
  if (y - tileY <= t[1] || y - tileY > t[3] + 1) return null;
  return dir === 'right' ? t[0] : t[2];
}

function isAdjacent(curIndex, curId, tileIndex, tileId, dir) {
  if (tileId !== 0 && tileId !== 104 && !isSpecial(tileId)) return false;
  if (dir === 'right' && tileIndex - curIndex !== 1) return false;
  if (dir === 'left' && curIndex - tileIndex !== 1) return false;
  if (!isSloped(curId)) return false;
  return true;
}

export function currentTile(map, x, y, width, height) {
  const x1 = Math.floor(x + width / 2);
  const y1 = y + height;
  const col = Math.floor(x1 / map.tilewidth) + 1;
  const row = Math.floor(y1 / map.tileheight);
  return row * map.width + col;
}

export function setTile(map, px, py, id) {
  const col = Math.floor(px / map.tilewidth), row = Math.floor(py / map.tileheight);
  if (col < 0 || row < 0 || col >= map.width || row >= map.height) return;
  map.coll[row * map.width + col] = id;
}

function interpolate(tileX, centerX, l, r, size) {
  const t = (centerX - tileX) / size;
  const y = Math.floor((1 - t) * l + t * r);
  return Math.min(Math.max(y, 0), size);
}

function scanRows(map, x, y, width, height, dir) {
  const rows = [];
  let stop = 1, change = -1;
  if (dir === 'right') { stop = map.width; change = 1; }
  const col0 = Math.floor(x / map.tilewidth) + 1;
  const top = Math.floor(y / map.tileheight);
  const bottom = Math.floor((y + height - 1) / map.tileheight);
  // Only scan a few columns ahead: movement per frame is small, the Lua version scans to the edge.
  const limit = 3;
  let n = 0;
  for (let i = col0; change > 0 ? i <= stop : i >= stop; i += change) {
    for (let j = top; j <= bottom; j++) rows.push(i + j * map.width);
    if (++n > limit) break;
  }
  return rows;
}

function scanCols(map, x, y, width, height, dir) {
  const cols = [];
  let stop = 0, change = -1;
  if (dir === 'down') { stop = map.height - 1; change = 1; }
  const row0 = Math.floor(y / map.tileheight);
  const left = Math.floor(x / map.tilewidth) + 1;
  const right = Math.floor((x + width - 1) / map.tilewidth) + 1;
  const limit = Math.ceil(height / map.tileheight) + 3;
  let n = 0;
  for (let i = row0; change > 0 ? i <= stop : i >= stop; i += change) {
    for (let j = left; j <= right; j++) cols.push(i * map.width + j);
    if (++n > limit) break;
  }
  return cols;
}

export function moveX(map, body, x, y, width, height, dx) {
  if (dx === 0) return x;
  const maxX = map.width * map.tilewidth - width;
  if (x + dx <= 0) { body.wallPushback && body.wallPushback(); return 0; }
  if (x + dx >= maxX) { body.wallPushback && body.wallPushback(); return maxX; }

  const dir = dx < 0 ? 'left' : 'right';
  const newX = x + dx;
  const curIndex = currentTile(map, x, y, width, height);
  const curTile = tileAt(map, curIndex);

  for (const i of scanRows(map, x, y, width, height, dir)) {
    const id = tileAt(map, i);
    if (id === null) continue;
    const ptype = platformType(id);
    if (ptype !== 'block' && ptype !== 'ice-block') continue;
    const sloped = isSloped(id), special = isSpecial(id);
    let adjacent = false;
    if (curTile !== null) adjacent = isAdjacent(curIndex, curTile, i, id, dir);
    if (sloped || adjacent) continue;

    if (dir === 'left') {
      let tileX = Math.floor(i % map.width) * map.tilewidth;
      const tileY = Math.floor((i - 1) / map.width) * map.tileheight;
      if (special) {
        const t = specialInterpX(id, tileY, y + height, dir);
        tileX = t !== null ? tileX - map.tilewidth + t : newX - width;
      }
      if (newX <= tileX && tileX <= x) { body.wallPushback && body.wallPushback(); return tileX; }
    } else {
      let tileX = Math.floor((i - 1) % map.width) * map.tilewidth;
      const tileY = Math.floor((i - 1) / map.width) * map.tileheight;
      if (special) {
        const t = specialInterpX(id, tileY, y + height, dir);
        tileX = t !== null ? tileX + t : x - width;
      }
      if (x <= tileX && tileX <= newX + width) { body.wallPushback && body.wallPushback(); return tileX - width; }
    }
  }
  return newX;
}

export function moveY(map, body, x, y, width, height, dx, dy) {
  if (dy === 0) return y;
  const dir = dy <= 0 ? 'up' : 'down';
  const newY = y + dy;
  body.onIce = false;

  for (const i of scanCols(map, x, y, width, height, dir)) {
    const id = tileAt(map, i);
    if (id === null) continue;
    const ptype = platformType(id);
    const sloped = isSloped(id), special = isSpecial(id);
    const centerX = x + width / 2;
    const tileX = Math.floor((i - 1) % map.width) * map.tilewidth;

    if (dir === 'down' && (!sloped || (centerX >= tileX - 5 && centerX <= tileX + map.tilewidth + 5))) {
      const tileY = Math.floor((i - 1) / map.width) * map.tileheight;
      let slopeY = tileY, tileSlope = 0;
      if (sloped) {
        const [l, r] = slopeEdges(id);
        slopeY = tileY + interpolate(tileX, centerX, l, r, map.tilewidth);
        tileSlope = (l - r) / map.tilewidth;
      } else if (special) {
        const h = specialInterpY(id, tileX, x, width, dir);
        slopeY = h !== null ? tileY + h : newY + height * 2;
      }

      if (ptype === 'block' || ptype === 'ice-block') {
        body.platformDropping = false;
        if (slopeY >= newY && slopeY <= newY + height - tileSlope * dx + 2 && (slopeY >= y + height || !special)) {
          body.onIce = ptype === 'ice-block';
          body.floorPushback && body.floorPushback();
          return slopeY - height;
        }
      }

      if (ptype === 'oneway' || ptype === 'no-drop') {
        const foot = y + height - tileSlope * dx - 2;
        const above = foot <= slopeY;
        const inTile = sloped && foot > tileY && foot <= tileY + map.tileheight;
        if ((above || inTile) && slopeY <= newY + height - tileSlope * dx + 2 && (slopeY >= y + height || !special)) {
          if (ptype === 'oneway') {
            if (body.platformDropping === true) {
              body.platformDropping = y + height;
            } else if (body.platformDropping) {
              return newY;
            }
          } else {
            body.platformDropping = false;
          }
          body.floorPushback && body.floorPushback();
          return slopeY - height;
        }
      }
    }

    if (dir === 'up' && (ptype === 'block' || ptype === 'ice-block')) {
      let tileY = Math.floor(i / map.width + 1) * map.tileheight;
      if (special) {
        const h = specialInterpY(id, tileX, x, width, dir);
        tileY = h !== null ? tileY - map.tilewidth + h : newY + height * 2;
      }
      if (y > tileY && tileY >= newY) {
        if (body.velocity) body.velocity.y = 0;
        body.ceilingPushback && body.ceilingPushback();
        return tileY;
      }
    }
  }
  return newY;
}

export function move(map, body, x, y, width, height, dx, dy) {
  const nx = moveX(map, body, x, y, width, height, dx);
  const ny = moveY(map, body, nx, y, width, height, dx, dy);
  return [nx, ny];
}

// True when a box of new_height (bottom-aligned) fits at x, y.
export function canStand(map, body, x, y, width, height, newHeight) {
  const change = height - newHeight;
  const probe = { velocity: { x: 0, y: 0 } };
  const ny = moveY(map, probe, x, y, width, height, 0, change);
  return ny === y + change;
}
