'use strict';

// The world: Mumbai and the Western line corridor (map data in mumbai.js),
// on a grid of 60 m blocks and 12 m roads. One world unit is one metre.
// India drives on the left, and so does everything here.
const CITY = (() => {
  const BLOCK = 60, ROAD = 12, PITCH = BLOCK + ROAD;
  return {
    NX: MUMBAI.NX, NZ: MUMBAI.NZ, BLOCK, ROAD, HALF: ROAD / 2, LANE: 3, PITCH, CURB: 0.3,
    SIZE_X: MUMBAI.NX * PITCH, SIZE_Z: MUMBAI.NZ * PITCH,
  };
})();
const CITY_NAME = 'Mumbai';
const DRIVE_LEFT = true;
const CHUNK_ROWS = 8;

// Directions: 0 = +x (east), 1 = +z (south), 2 = -x (west), 3 = -z (north).
const DIRS = [{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 }];
const axisOf = (d) => d % 2;
const reverseDir = (d) => (d + 2) % 4;
const rightOf = (d) => ({ x: -DIRS[d].z, z: DIRS[d].x });
// The side of the road traffic keeps to, seen from a car heading in direction d.
const laneSide = (d) => { const r = rightOf(d); return DRIVE_LEFT ? { x: -r.x, z: -r.z } : r; };
// The turn that crosses oncoming traffic (right in India, left in right-hand countries).
const crossingTurn = (d) => (DRIVE_LEFT ? (d + 1) % 4 : (d + 3) % 4);
const headingOf = (d) => Math.atan2(DIRS[d].x, DIRS[d].z);

const STOP_LINE = CITY.HALF + 4;
const SIDEWALK_INSET = 2.8;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function wrapAngle(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Junctions with signals alternate green between their two axes:
// 8 s green, 2.5 s yellow, 0.5 s all-red. Junctions without signals are always green.
const LIGHT_CYCLE = 22;
function lightState(node, axis, t) {
  if (!node.signal) return 'green';
  const p = (((t + node.offset) % LIGHT_CYCLE) + LIGHT_CYCLE) % LIGHT_CYCLE;
  const half = LIGHT_CYCLE / 2;
  const active = p < half ? 0 : 1;
  if (active !== axis) return 'red';
  const local = p - active * half;
  if (local < 8) return 'green';
  if (local < 10.5) return 'yellow';
  return 'red';
}

// Blocks with streets and sidewalks around them.
const STREET_KINDS = new Set(['city', 'mid', 'res', 'dense', 'industrial', 'town', 'park', 'gateway']);
// Open ground you can drive across.
const OPEN_KINDS = new Set(['airport', 'beach', 'farm', 'stunts', 'parking']);
// No cars: sea, forest and hills.
const SOLID_KINDS = new Set(['water', 'forest', 'wild']);
const GROUND_COLORS = { airport: 0x6b6f74, beach: 0xe6d3a0, farm: 0x7fa04e, stunts: 0xd9d4c8, parking: 0x3f4449, forest: 0x3f6f35, wild: 0x6f8048 };

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function textTexture(text, bg, fg = '#ffffff', w = 512, h = 128) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.font = `900 ${Math.round(h * 0.55)}px Overpass, "Noto Sans Devanagari", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4, w - 24);
  return new THREE.CanvasTexture(c);
}

// Collects flat-shaded triangles with vertex colours and UVs into one mesh.
// Each face is turned to point away from a reference point inside its solid,
// so winding never has to be hand-checked.
class GeoBatch {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; }

  tri(a, b, c, color, uvs, ref) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (a[0] + b[0] + c[0]) / 3 - ref[0], my = (a[1] + b[1] + c[1]) / 3 - ref[1], mz = (a[2] + b[2] + c[2]) / 3 - ref[2];
    let ta = uvs[0], tb = uvs[1], tc = uvs[2];
    if (nx * mx + ny * my + nz * mz < 0) { [b, c] = [c, b]; [tb, tc] = [tc, tb]; nx = -nx; ny = -ny; nz = -nz; }
    const len = Math.hypot(nx, ny, nz) || 1;
    for (const [v, t] of [[a, ta], [b, tb], [c, tc]]) {
      this.p.push(v[0], v[1], v[2]);
      this.n.push(nx / len, ny / len, nz / len);
      this.uv.push(t[0], t[1]);
      this.c.push(color.r, color.g, color.b);
    }
  }

  quad(a, b, c, d, color, uvs, ref) {
    this.tri(a, b, c, color, [uvs[0], uvs[1], uvs[2]], ref);
    this.tri(a, c, d, color, [uvs[0], uvs[2], uvs[3]], ref);
  }

  // A box standing on y0. `tile` sets window spacing [width, height] in metres;
  // the roof uses the texture's plain corner so it takes the vertex colour.
  box(x0, y0, z0, x1, y1, z1, color, { tile = [4, 3.6], roof = null, bottom = false, plain = false } = {}) {
    const col = new THREE.Color(color), rc = new THREE.Color(roof === null ? color : roof);
    const ref = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const V = Math.max(1, Math.round((y1 - y0) / tile[1])) * 0.25;
    const Ux = Math.max(1, Math.round((x1 - x0) / tile[0])) * 0.25, Uz = Math.max(1, Math.round((z1 - z0) / tile[0])) * 0.25;
    const side = (U) => (plain ? [[0, 0], [0, 0], [0, 0], [0, 0]] : [[0, 0], [U, 0], [U, V], [0, V]]);
    this.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], col, side(Uz), ref);
    this.quad([x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], col, side(Uz), ref);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col, side(Ux), ref);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col, side(Ux), ref);
    const flat = [[0, 0], [0, 0], [0, 0], [0, 0]];
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], rc, flat, ref);
    if (bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], rc, flat, ref);
  }

  // Pitched roof on top of a box, ridge running along x (or z).
  gable(x0, y0, z0, x1, z1, rise, color, wallColor, alongX) {
    const rc = new THREE.Color(color), wc = new THREE.Color(wallColor), flat = [[0, 0], [0, 0], [0, 0], [0, 0]];
    const y1 = y0 + rise, ref = [(x0 + x1) / 2, y0 + rise * 0.3, (z0 + z1) / 2];
    if (alongX) {
      const zm = (z0 + z1) / 2;
      this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, zm], [x0, y1, zm], rc, flat, ref);
      this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, zm], [x0, y1, zm], rc, flat, ref);
      this.tri([x0, y0, z0], [x0, y0, z1], [x0, y1, zm], wc, flat, ref);
      this.tri([x1, y0, z0], [x1, y0, z1], [x1, y1, zm], wc, flat, ref);
    } else {
      const xm = (x0 + x1) / 2;
      this.quad([x0, y0, z0], [x0, y0, z1], [xm, y1, z1], [xm, y1, z0], rc, flat, ref);
      this.quad([x1, y0, z0], [x1, y0, z1], [xm, y1, z1], [xm, y1, z0], rc, flat, ref);
      this.tri([x0, y0, z0], [x1, y0, z0], [xm, y1, z0], wc, flat, ref);
      this.tri([x0, y0, z1], [x1, y0, z1], [xm, y1, z1], wc, flat, ref);
    }
  }

  // Flat horizontal rectangle; uvScale > 0 maps a tiling texture in world space.
  flat(x0, z0, x1, z1, y, color, uvScale = 0) {
    const c = new THREE.Color(color);
    const uv = uvScale ? [[x0 * uvScale, z0 * uvScale], [x0 * uvScale, z1 * uvScale], [x1 * uvScale, z1 * uvScale], [x1 * uvScale, z0 * uvScale]] : [[0, 0], [0, 0], [0, 0], [0, 0]];
    this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], c, uv, [(x0 + x1) / 2, y - 1, (z0 + z1) / 2]);
  }

  get empty() { return this.p.length === 0; }

  mesh(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    return new THREE.Mesh(g, material);
  }
}

// Instance lists that become one InstancedMesh per chunk.
class InstanceList {
  constructor() { this.items = []; }
  add(x, y, z, sx = 1, sy = 1, sz = 1, color = null, rotY = 0) { this.items.push([x, y, z, sx, sy, sz, color, rotY]); }
  mesh(geo, mat) {
    if (!this.items.length) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, this.items.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    this.items.forEach(([x, y, z, sx, sy, sz, color, rotY], k) => {
      q.setFromAxisAngle(up, rotY);
      mesh.setMatrixAt(k, m.compose(p.set(x, y, z), q, s.set(sx, sy, sz)));
      if (color !== null) mesh.setColorAt(k, new THREE.Color(color));
    });
    return mesh;
  }
}

// Solid rectangles bucketed by grid cell, for quick lookups near a point.
class SolidGrid {
  constructor() { this.cells = new Map(); }
  add(r) {
    const P = CITY.PITCH;
    const i0 = Math.floor(r.x0 / P), i1 = Math.floor(r.x1 / P), j0 = Math.floor(r.z0 / P), j1 = Math.floor(r.z1 / P);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const key = i * 1000 + j;
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key).push(r);
      }
  }
  near(x, z, out) {
    const P = CITY.PITCH, ci = Math.floor(x / P), cj = Math.floor(z / P);
    for (let j = cj - 1; j <= cj + 1; j++)
      for (let i = ci - 1; i <= ci + 1; i++) {
        const list = this.cells.get(i * 1000 + j);
        if (list) for (const r of list) out.push(r);
      }
    return out;
  }
}

class World {
  constructor(scene) {
    this.scene = scene;
    const rng = (this.rng = mulberry32(20261020));
    const { NX, NZ, PITCH, HALF } = CITY;
    this.kind = (bi, bj) => (bi < 0 || bj < 0 || bi >= NX || bj >= NZ ? 'water' : MUMBAI.T[bj][bi]);

    this.nodes = [];
    for (let j = 0; j <= NZ; j++)
      for (let i = 0; i <= NX; i++)
        this.nodes.push({ i, j, x: i * PITCH, z: j * PITCH, offset: rng() * LIGHT_CYCLE, roads: 0, signal: false });

    // Which road segments exist: any segment beside a street block, plus the bridges and highway.
    this.roadSet = new Set();
    this.bridges = new Set();
    for (let j = 0; j <= NZ; j++)
      for (let i = 0; i < NX; i++)
        if (STREET_KINDS.has(this.kind(i, j - 1)) || STREET_KINDS.has(this.kind(i, j))) this.roadSet.add(`h${i},${j}`);
    for (let j = 0; j < NZ; j++)
      for (let i = 0; i <= NX; i++)
        if (STREET_KINDS.has(this.kind(i - 1, j)) || STREET_KINDS.has(this.kind(i, j))) this.roadSet.add(`v${i},${j}`);
    for (const [i, j0, j1] of MUMBAI.extraRoads) for (let j = j0; j <= j1; j++) this.roadSet.add(`v${i},${j}`);
    for (const key of this.roadSet) {
      const [i, j] = key.slice(1).split(',').map(Number);
      const water = key[0] === 'h' ? this.kind(i, j - 1) === 'water' && this.kind(i, j) === 'water' : this.kind(i - 1, j) === 'water' && this.kind(i, j) === 'water';
      if (water) this.bridges.add(key);
    }
    // Directed lane segments, for picking places to put cars.
    this.segments = [];
    for (const n of this.nodes)
      for (let d = 0; d < 4; d++) if (this.hasRoad(n.i, n.j, d)) { n.roads++; this.segments.push({ i: n.i, j: n.j, d, mx: n.x + DIRS[d].x * PITCH / 2, mz: n.z + DIRS[d].z * PITCH / 2 }); }
    for (const n of this.nodes) n.signal = n.roads >= 3;

    this.bounds = [
      { x0: -1e4, x1: -HALF, z0: -1e4, z1: 1e4 }, { x0: CITY.SIZE_X + HALF, x1: 1e4, z0: -1e4, z1: 1e4 },
      { x0: -1e4, x1: 1e4, z0: -1e4, z1: -HALF }, { x0: -1e4, x1: 1e4, z0: CITY.SIZE_Z + HALF, z1: 1e4 },
    ];
    this.carSolid = new SolidGrid();
    this.footSolid = new SolidGrid();
    this.buildingSolid = new SolidGrid();
    this.curbSolid = new SolidGrid();
    this.blocks = [];        // curb rectangle per street block (null otherwise)
    this.info = [];          // { bi, bj, x0, z0, x1, z1, kind, district }
    this.buildingRects = []; // per block, for people on foot
    this.ramps = [];
    this.parkingSpots = [];
    this.landmarks = [];
    this.jobSpots = [];
    this.packages = [];
    this.poles = [];
    this.chunks = [];
    this.curbsSolid = true;
    for (let j = 0; j < NZ; j++)
      for (let i = 0; i < NX; i++) {
        const x0 = i * PITCH + HALF, z0 = j * PITCH + HALF, kind = this.kind(i, j);
        this.info.push({ bi: i, bj: j, x0, z0, x1: x0 + CITY.BLOCK, z1: z0 + CITY.BLOCK, kind, district: kind });
        this.buildingRects.push([]);
        const curb = STREET_KINDS.has(kind) ? { x0, x1: x0 + CITY.BLOCK, z0, z1: z0 + CITY.BLOCK } : null;
        this.blocks.push(curb);
        if (curb) this.curbSolid.add(curb);
      }
    this.sidewalkBlocks = this.info.map((b, k) => k).filter((k) => this.blocks[k]);

    this.buildMaterials();
    this.buildSolids();
    for (let c = 0; c * CHUNK_ROWS < NZ; c++) this.buildChunk(c);
    this.buildSea();
    this.placeJobsAndPackages();
    const h = MUMBAI.home;
    this.home = this.lanePoint(h.i, h.j, 1, PITCH / 2);
  }

  // ---------- Queries ----------
  node(i, j) { return this.nodes[i + j * (CITY.NX + 1)]; }

  hasRoad(i, j, d) {
    if (d === 0) return this.roadSet.has(`h${i},${j}`);
    if (d === 2) return this.roadSet.has(`h${i - 1},${j}`);
    if (d === 1) return this.roadSet.has(`v${i},${j}`);
    return this.roadSet.has(`v${i},${j - 1}`);
  }

  lanePoint(i, j, d, s) {
    const n = this.node(i, j), D = DIRS[d], r = laneSide(d);
    return { i, j, d, s, x: n.x + D.x * s + r.x * CITY.LANE, z: n.z + D.z * s + r.z * CITY.LANE, h: headingOf(d) };
  }

  randomLanePoint(rand = Math.random) {
    const sg = this.segments[Math.floor(rand() * this.segments.length)];
    return this.lanePoint(sg.i, sg.j, sg.d, CITY.HALF + 12 + rand() * (CITY.BLOCK - 26));
  }

  // A random lane point between minD and maxD metres from (x, z).
  lanePointAround(x, z, minD = 0, maxD = 200) {
    const pick = [];
    let best = null, bestErr = Infinity;
    for (const sg of this.segments) {
      const d = Math.hypot(sg.mx - x, sg.mz - z);
      if (d >= minD && d <= maxD) pick.push(sg);
      else { const err = d < minD ? minD - d : d - maxD; if (err < bestErr) { bestErr = err; best = sg; } }
    }
    const sg = pick.length ? pick[Math.floor(Math.random() * pick.length)] : best;
    return this.lanePoint(sg.i, sg.j, sg.d, CITY.HALF + 12 + Math.random() * (CITY.BLOCK - 26));
  }

  nearestLanePoint(x, z) {
    let best = null, bd = Infinity;
    for (const sg of this.segments) {
      const d = Math.hypot(sg.mx - x, sg.mz - z);
      if (d < bd) { bd = d; best = sg; }
    }
    const n = this.node(best.i, best.j), D = DIRS[best.d];
    const s = clamp((x - n.x) * D.x + (z - n.z) * D.z, CITY.HALF + 2, CITY.PITCH - CITY.HALF - 2);
    return this.lanePoint(best.i, best.j, best.d, s);
  }

  // The next junction on the shortest road route from (si, sj) to (ti, tj).
  nextNodeTowards(si, sj, ti, tj) {
    const W = CITY.NX + 1, start = si + sj * W, goal = ti + tj * W;
    if (start === goal) return null;
    const prev = new Map([[goal, -1]]), queue = [goal];
    // Search back from the goal so the first step from the start falls out directly.
    while (queue.length) {
      const k = queue.shift(), i = k % W, j = Math.floor(k / W);
      for (let d = 0; d < 4; d++) {
        if (!this.hasRoad(i, j, d)) continue;
        const n = i + DIRS[d].x + (j + DIRS[d].z) * W;
        if (prev.has(n)) continue;
        prev.set(n, k);
        if (n === start) return { i: k % W, j: Math.floor(k / W) };
        queue.push(n);
      }
    }
    return null;
  }

  // The junctions along the shortest road route from one junction to another.
  route(si, sj, ti, tj, max = 400) {
    const W = CITY.NX + 1, start = si + sj * W, goal = ti + tj * W;
    const prev = new Map([[goal, -1]]), queue = [goal];
    while (queue.length && !prev.has(start)) {
      const k = queue.shift(), i = k % W, j = Math.floor(k / W);
      for (let d = 0; d < 4; d++) {
        if (!this.hasRoad(i, j, d)) continue;
        const n = i + DIRS[d].x + (j + DIRS[d].z) * W;
        if (!prev.has(n)) { prev.set(n, k); queue.push(n); }
      }
    }
    if (!prev.has(start)) return [];
    const out = [];
    for (let k = start; k !== -1 && out.length < max; k = prev.get(k)) out.push(this.nodes[k]);
    return out;
  }

  nearestNode(x, z) {
    const { PITCH, NX, NZ } = CITY;
    let best = null, bd = Infinity;
    const ci = Math.round(x / PITCH), cj = Math.round(z / PITCH);
    for (let j = cj - 2; j <= cj + 2; j++)
      for (let i = ci - 2; i <= ci + 2; i++) {
        if (i < 0 || j < 0 || i > NX || j > NZ) continue;
        const n = this.node(i, j);
        if (!n.roads) continue;
        const d = Math.hypot(n.x - x, n.z - z);
        if (d < bd) { bd = d; best = n; }
      }
    return best;
  }

  blockIndexAt(x, z) {
    const { NX, NZ, PITCH } = CITY;
    const bi = Math.floor(x / PITCH), bj = Math.floor(z / PITCH);
    if (bi < 0 || bj < 0 || bi >= NX || bj >= NZ) return -1;
    const b = this.info[bi + bj * NX];
    return x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 ? bi + bj * NX : -1;
  }

  nearBlocks(x, z, r, fn) {
    const { NX, NZ, PITCH } = CITY;
    const i0 = clamp(Math.floor((x - r) / PITCH), 0, NX - 1), i1 = clamp(Math.floor((x + r) / PITCH), 0, NX - 1);
    const j0 = clamp(Math.floor((z - r) / PITCH), 0, NZ - 1), j1 = clamp(Math.floor((z + r) / PITCH), 0, NZ - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(i + j * NX);
  }

  // Solid rectangles for cars near (x, z).
  rectsNear(x, z) {
    const out = this.bounds.slice();
    this.carSolid.near(x, z, out);
    this.buildingSolid.near(x, z, out);
    if (this.curbsSolid) this.curbSolid.near(x, z, out);
    return out;
  }

  // Solid rectangles for people on foot.
  footRectsNear(x, z) {
    const out = this.bounds.slice();
    this.footSolid.near(x, z, out);
    this.buildingSolid.near(x, z, out);
    return out;
  }

  // Buildings only (for keeping the camera out of walls).
  buildingRectsNear(x, z) { return this.buildingSolid.near(x, z, []); }

  addSolid(r, { cars = true, feet = true } = {}) {
    if (cars) this.carSolid.add(r);
    if (feet) this.footSolid.add(r);
  }

  heightAt(x, z) {
    let h = 0;
    if (!this.curbsSolid) { const k = this.blockIndexAt(x, z); if (k >= 0 && this.blocks[k]) h = CITY.CURB; }
    for (const r of this.ramps) {
      const dx = x - r.x, dz = z - r.z;
      const along = dx * r.fx + dz * r.fz, lat = -dx * r.fz + dz * r.fx;
      if (along >= 0 && along <= r.len && Math.abs(lat) <= r.width / 2) h = Math.max(h, (r.h * along) / r.len);
    }
    return h;
  }

  footGroundAt(x, z) {
    const k = this.blockIndexAt(x, z);
    if (k >= 0 && this.blocks[k]) return CITY.CURB;
    let h = 0;
    for (const r of this.ramps) {
      const dx = x - r.x, dz = z - r.z;
      const along = dx * r.fx + dz * r.fz, lat = -dx * r.fz + dz * r.fx;
      if (along >= 0 && along <= r.len && Math.abs(lat) <= r.width / 2) h = Math.max(h, (r.h * along) / r.len);
    }
    return h;
  }

  junctionAt(x, z) {
    const i = Math.round(x / CITY.PITCH), j = Math.round(z / CITY.PITCH);
    if (i < 0 || j < 0 || i > CITY.NX || j > CITY.NZ) return null;
    const n = this.node(i, j);
    return n.roads && Math.abs(x - n.x) < CITY.HALF && Math.abs(z - n.z) < CITY.HALF ? n : null;
  }

  districtAt(x, z) {
    const { NX, NZ, PITCH } = CITY;
    return this.kind(clamp(Math.floor(x / PITCH), 0, NX - 1), clamp(Math.floor(z / PITCH), 0, NZ - 1));
  }

  areaAt(x, z) {
    const bi = Math.floor(x / CITY.PITCH), bj = Math.floor(z / CITY.PITCH);
    for (const [name, j0, j1, i0, i1] of MUMBAI.areas) if (bj >= j0 && bj <= j1 && bi >= i0 && bi <= i1) return name;
    return bj < 0 ? 'Dahanu' : 'Mumbai';
  }

  // ---------- Sidewalk loops for pedestrians ----------
  hasSidewalk(k) { return k >= 0 && !!this.blocks[k]; }

  sidewalkPoint(k, p) {
    const b = this.info[k], L = CITY.BLOCK - SIDEWALK_INSET * 2, P = L * 4;
    p = ((p % P) + P) % P;
    const side = Math.floor(p / L), t = p - side * L;
    const x0 = b.x0 + SIDEWALK_INSET, z0 = b.z0 + SIDEWALK_INSET, x1 = b.x1 - SIDEWALK_INSET, z1 = b.z1 - SIDEWALK_INSET;
    if (side === 0) return { x: x0 + t, z: z0, h: headingOf(0) };
    if (side === 1) return { x: x1, z: z0 + t, h: headingOf(1) };
    if (side === 2) return { x: x1 - t, z: z1, h: headingOf(2) };
    return { x: x0, z: z1 - t, h: headingOf(3) };
  }

  sidewalkParam(k, x, z) {
    const b = this.info[k], L = CITY.BLOCK - SIDEWALK_INSET * 2;
    const x0 = b.x0 + SIDEWALK_INSET, z0 = b.z0 + SIDEWALK_INSET, x1 = b.x1 - SIDEWALK_INSET, z1 = b.z1 - SIDEWALK_INSET;
    const cx = clamp(x, x0, x1), cz = clamp(z, z0, z1);
    const opts = [
      [Math.abs(cz - z0), cx - x0],
      [Math.abs(cx - x1), L + (cz - z0)],
      [Math.abs(cz - z1), L * 2 + (x1 - cx)],
      [Math.abs(cx - x0), L * 3 + (z1 - cz)],
    ].sort((a, b2) => a[0] - b2[0]);
    return opts[0][1];
  }

  nearestSidewalkBlock(x, z) {
    let best = -1, bd = Infinity;
    this.nearBlocks(x, z, CITY.PITCH, (k) => {
      if (!this.hasSidewalk(k)) return;
      const b = this.info[k];
      const d = Math.hypot(x - clamp(x, b.x0, b.x1), z - clamp(z, b.z0, b.z1));
      if (d < bd) { bd = d; best = k; }
    });
    return best;
  }

  // ---------- Building ----------
  buildMaterials() {
    const atlas = canvasTexture(256, (g) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
      for (let r = 0; r < 4; r++)
        for (let c = 0; c < 4; c++) {
          g.fillStyle = '#4f5d6c'; g.fillRect(c * 64 + 10, r * 64 + 12, 44, 34);
          g.fillStyle = '#7c8ea0'; g.fillRect(c * 64 + 10, r * 64 + 12, 44, 7);
        }
    });
    const lit = canvasTexture(256, (g) => {
      g.fillStyle = '#000000'; g.fillRect(0, 0, 256, 256);
      for (let r = 0; r < 4; r++)
        for (let c = 0; c < 4; c++) {
          const on = (r * 7 + c * 3) % 5 !== 0;
          g.fillStyle = on ? ['#ffd890', '#ffe7b0', '#fff2d0', '#ffcf7a'][(r + c) % 4] : '#000000';
          g.fillRect(c * 64 + 10, r * 64 + 12, 44, 34);
        }
    });
    this.buildingMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: atlas, emissiveMap: lit, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.82, metalness: 0.05 });
    this.plainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    const asphaltTex = canvasTexture(128, (g, s) => {
      g.fillStyle = '#4a4f55';
      g.fillRect(0, 0, s, s);
      for (let k = 0; k < 1800; k++) {
        const v = 60 + Math.floor(Math.random() * 40);
        g.fillStyle = `rgb(${v},${v + 3},${v + 6})`;
        g.fillRect(Math.random() * s, Math.random() * s, 1.5, 1.5);
      }
    });
    this.roadMat = new THREE.MeshStandardMaterial({ map: asphaltTex, vertexColors: true, roughness: 0.95, metalness: 0 });
    this.markMat = { white: new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }), yellow: new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }) };
    this.markGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.trunkGeo = new THREE.CylinderGeometry(0.18, 0.24, 2.2, 6);
    this.crownGeo = new THREE.IcosahedronGeometry(1.6, 0);
    this.trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4b32, roughness: 1 });
    this.crownMat = new THREE.MeshStandardMaterial({ color: 0x3f7d3a, roughness: 1, flatShading: true });
    this.palmLeafGeo = new THREE.ConeGeometry(2.6, 1.2, 7);
    this.palmTrunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 7, 6);
    this.palmMat = new THREE.MeshStandardMaterial({ color: 0x3f8f4a, flatShading: true });
    this.palmTrunkMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45 });
    this.hillGeo = new THREE.ConeGeometry(1, 1, 7);
    this.hillMat = new THREE.MeshStandardMaterial({ color: 0x55703c, roughness: 1, flatShading: true });
    this.poleGeo = new THREE.CylinderGeometry(0.09, 0.11, 4.6, 6);
    this.poleMat = new THREE.MeshStandardMaterial({ color: 0x3b3f45 });
    this.headGeo = new THREE.BoxGeometry(0.5, 1.35, 0.5);
    this.headMat = new THREE.MeshStandardMaterial({ color: 0x23262a });
    this.lampGeo = new THREE.SphereGeometry(0.17, 6, 4);
    this.streetPoleGeo = new THREE.CylinderGeometry(0.08, 0.12, 6.2, 6);
    this.streetPoleMat = new THREE.MeshStandardMaterial({ color: 0x4a4f55 });
    this.lampHeadGeo = new THREE.BoxGeometry(0.5, 0.18, 0.9);
    this.lampHeadMat = new THREE.MeshBasicMaterial({ color: 0x8a8f96 });
    this.containerGeo = new THREE.BoxGeometry(6.1, 2.6, 2.5);
    this.containerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    this.lampColors = { off: new THREE.Color(0x2a2d31), red: new THREE.Color(0xff3b30), yellow: new THREE.Color(0xffc21a), green: new THREE.Color(0x2ee66b) };
  }

  // Sea, forest and hills stop cars; the sea also stops people. So do the gaps
  // between such cells where no road runs.
  buildSolids() {
    const { NX, NZ, PITCH, HALF, BLOCK } = CITY;
    const solidFor = (kind) => ({ cars: SOLID_KINDS.has(kind), feet: kind === 'water' });
    for (const b of this.info) {
      const s = solidFor(b.kind);
      if (s.cars || s.feet) this.addSolid({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1 }, s);
    }
    const gap = (k1, k2, rect) => {
      const a = this.kind(...k1), b = this.kind(...k2);
      const cars = !(OPEN_KINDS.has(a) && OPEN_KINDS.has(b)) && !(STREET_KINDS.has(a) && STREET_KINDS.has(b));
      const feet = a === 'water' || b === 'water';
      if (cars || feet) this.addSolid(rect, { cars, feet });
    };
    for (let j = 0; j <= NZ; j++)
      for (let i = 0; i < NX; i++)
        if (!this.roadSet.has(`h${i},${j}`)) gap([i, j - 1], [i, j], { x0: i * PITCH + HALF, x1: i * PITCH + HALF + BLOCK, z0: j * PITCH - HALF, z1: j * PITCH + HALF });
    for (let j = 0; j < NZ; j++)
      for (let i = 0; i <= NX; i++)
        if (!this.roadSet.has(`v${i},${j}`)) gap([i - 1, j], [i, j], { x0: i * PITCH - HALF, x1: i * PITCH + HALF, z0: j * PITCH + HALF, z1: j * PITCH + HALF + BLOCK });
    for (const n of this.nodes) {
      if (n.roads) continue;
      const around = [this.kind(n.i - 1, n.j - 1), this.kind(n.i, n.j - 1), this.kind(n.i - 1, n.j), this.kind(n.i, n.j)];
      const cars = !around.every((k) => OPEN_KINDS.has(k));
      const feet = around.some((k) => k === 'water');
      if (cars || feet) this.addSolid({ x0: n.x - HALF, x1: n.x + HALF, z0: n.z - HALF, z1: n.z + HALF }, { cars, feet });
    }
  }

  buildSea() {
    const { SIZE_X, SIZE_Z } = CITY;
    this.waterMat = new THREE.MeshStandardMaterial({ color: 0x2f7fae, roughness: 0.25, metalness: 0.1 });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(SIZE_X + 4000, SIZE_Z + 4000).rotateX(-Math.PI / 2), this.waterMat);
    sea.position.set(SIZE_X / 2, -0.6, SIZE_Z / 2);
    sea.receiveShadow = true;
    this.scene.add(sea);
  }

  buildChunk(c) {
    const { NX, NZ, PITCH, HALF, BLOCK, CURB } = CITY;
    const rng = mulberry32(1000 + c);
    const j0 = c * CHUNK_ROWS, j1 = Math.min(NZ, j0 + CHUNK_ROWS) - 1;
    const group = new THREE.Group();
    const chunk = { group, z0: j0 * PITCH - HALF, z1: (j1 + 1) * PITCH + HALF, poles: [], lampMesh: null };
    this.chunks.push(chunk);
    this.scene.add(group);

    const bld = new GeoBatch(), ground = new GeoBatch(), roads = new GeoBatch();
    const trees = new InstanceList(), palms = new InstanceList(), hills = new InstanceList(), containers = new InstanceList();
    const white = new InstanceList(), yellow = new InstanceList(), lamps = new InstanceList(), lampHeads = new InstanceList();
    const ctx = { bld, ground, trees, palms, hills, containers, white, rng, group, chunk };
    const pal = {
      city: [0x9fb3c8, 0x7f93a8, 0xc3ccd6, 0x8aa0a8, 0xb7c4cf, 0x6f8193, 0xa8b8c0],
      mid: [0xd8cfc0, 0xc9a98e, 0xe6dcc8, 0xb08b74, 0xd1b48c, 0xe0c9a0, 0xcbbca4],
      res: [0xf0c8c8, 0xf2e2a8, 0xc8dcf0, 0xf2e6cf, 0xd8ecd0, 0xf0d0b0, 0xe8d8f0],
      town: [0xf2b8a0, 0xa8d8e8, 0xf2dc8c, 0xc8e6a8, 0xf0f0e8, 0xe8a8c0],
      roofs: [0x8a4b3c, 0x5d6168, 0x7a5a3f, 0xa04a32],
      industrial: [0x9aa1a6, 0x8a8f7c, 0xa69a88, 0x7d8a92],
    };
    const pick = (a) => a[Math.floor(rng() * a.length)];
    const landmarkAt = {};
    for (const [type, name, bi, bj, side] of MUMBAI.landmarks) landmarkAt[`${bi},${bj}`] = { type, name, side };

    for (let bj = j0; bj <= j1; bj++)
      for (let bi = 0; bi < NX; bi++) {
        const k = bi + bj * NX, b = this.info[k], kind = b.kind;
        const { x0, z0, x1, z1 } = b;
        const rects = this.buildingRects[k];
        const addBuilding = (bx0, bz0, bx1, bz1, h, color, opts) => {
          bld.box(bx0, CURB, bz0, bx1, CURB + h, bz1, color, opts);
          const r = { x0: bx0, z0: bz0, x1: bx1, z1: bz1 };
          rects.push(r);
          this.buildingSolid.add(r);
        };
        ctx.addBuilding = addBuilding;

        if (kind === 'water') continue;
        if (OPEN_KINDS.has(kind)) {
          ground.flat(x0, z0, x1, z1, 0.012, GROUND_COLORS[kind]);
          this.buildOpen(kind, b, ctx);
          continue;
        }
        if (kind === 'forest' || kind === 'wild') {
          ground.box(x0, 0, z0, x1, 0.35, z1, GROUND_COLORS[kind], { plain: true });
          const n = kind === 'forest' ? 26 : 9;
          for (let t = 0; t < n; t++) trees.add(x0 + 3 + rng() * (BLOCK - 6), 0.35, z0 + 3 + rng() * (BLOCK - 6), 1.1);
          const hn = kind === 'wild' ? 2 : 1;
          for (let t = 0; t < hn; t++) {
            const hh = 8 + rng() * (kind === 'wild' ? 22 : 10);
            hills.add(x0 + 12 + rng() * 36, hh / 2 + 0.3, z0 + 12 + rng() * 36, 14 + rng() * 14, hh, 14 + rng() * 14);
          }
          continue;
        }

        // Street blocks: sidewalk slab, street trees and lamps, then buildings.
        ground.box(x0, 0, z0, x1, CURB, z1, kind === 'gateway' ? 0xd2c3a3 : 0xb8b3a8, { plain: true });
        if (kind !== 'dense' && kind !== 'gateway') {
          for (const t of [14, 46]) {
            for (const [tx, tz] of [[x0 + t, z0 + 1.2], [x0 + t, z1 - 1.2], [x0 + 1.2, z0 + t], [x1 - 1.2, z0 + t]]) trees.add(tx, CURB, tz, 0.7);
          }
        }
        for (const t of [22, 38]) {
          for (const [lx, lz, ox, oz] of [[x0 + t, z0 + 0.7, 0, -1], [x0 + t, z1 - 0.7, 0, 1], [x0 + 0.7, z0 + t, -1, 0], [x1 - 0.7, z0 + t, 1, 0]]) {
            lamps.add(lx, CURB + 3.1, lz);
            lampHeads.add(lx + ox * 0.6, CURB + 6.2, lz + oz * 0.6);
          }
        }
        const lm = landmarkAt[`${bi},${bj}`];
        this.buildStreetBlock(kind, b, ctx, pal, pick, lm);
      }

    // Roads: asphalt on every segment and junction, decks on bridges, markings.
    const asphalt = new THREE.Color(0xffffff), uvs = 1 / 8;
    for (let j = j0; j <= j1 + (j1 === NZ - 1 ? 1 : 0); j++)
      for (let i = 0; i <= NX; i++) {
        const n = this.node(i, j);
        if (n.roads) roads.flat(n.x - HALF, n.z - HALF, n.x + HALF, n.z + HALF, 0, asphalt, uvs);
        if (i < NX && this.roadSet.has(`h${i},${j}`)) this.buildSegment(roads, bld, white, yellow, i, j, 0);
        if (j < NZ && this.roadSet.has(`v${i},${j}`) && j <= j1) this.buildSegment(roads, bld, white, yellow, i, j, 1);
        if (!n.roads) {
          // Fill the corner between open cells so no sea shows through.
          const around = [this.kind(i - 1, j - 1), this.kind(i, j - 1), this.kind(i - 1, j), this.kind(i, j)].filter((k2) => k2 !== 'water');
          if (around.length === 4) ground.flat(n.x - HALF, n.z - HALF, n.x + HALF, n.z + HALF, 0.012, GROUND_COLORS[around[0]] || 0x7fa04e);
        }
        if (n.signal) this.buildSignal(n, chunk, white);
      }
    // Gaps between cells without a road get ground so they don't look like holes.
    for (let j = j0; j <= j1; j++)
      for (let i = 0; i <= NX; i++) {
        if (j <= NZ && i < NX && !this.roadSet.has(`h${i},${j}`)) this.fillGap(ground, [i, j - 1], [i, j], i * PITCH + HALF, j * PITCH - HALF, i * PITCH + HALF + BLOCK, j * PITCH + HALF);
        if (!this.roadSet.has(`v${i},${j}`)) this.fillGap(ground, [i - 1, j], [i, j], i * PITCH - HALF, j * PITCH + HALF, i * PITCH + HALF, j * PITCH + HALF + BLOCK);
      }

    const add = (mesh, shadow = true, receive = true) => { if (!mesh) return; mesh.castShadow = shadow; mesh.receiveShadow = receive; group.add(mesh); return mesh; };
    if (!bld.empty) add(bld.mesh(this.buildingMat));
    if (!ground.empty) add(ground.mesh(this.plainMat), false);
    if (!roads.empty) add(roads.mesh(this.roadMat), false);
    add(white.mesh(this.markGeo, this.markMat.white), false);
    add(yellow.mesh(this.markGeo, this.markMat.yellow), false);
    // Trees: items are (x, ground height, z, scale).
    const crowns = new InstanceList(), trunks = new InstanceList();
    for (const [x, y, z, s] of trees.items) { crowns.add(x, y + 3 * s, z, s, s * 1.2, s); trunks.add(x, y + 1.1 * s, z, s, s, s); }
    add(crowns.mesh(this.crownGeo, this.crownMat));
    add(trunks.mesh(this.trunkGeo, this.trunkMat));
    add(palms.mesh(this.palmLeafGeo, this.palmMat));
    const palmTrunks = new InstanceList();
    for (const [x, , z] of palms.items) palmTrunks.add(x, 3.5, z);
    add(palmTrunks.mesh(this.palmTrunkGeo, this.palmTrunkMat));
    add(hills.mesh(this.hillGeo, this.hillMat), false);
    add(containers.mesh(this.containerGeo, this.containerMat));
    add(lamps.mesh(this.streetPoleGeo, this.streetPoleMat));
    add(lampHeads.mesh(this.lampHeadGeo, this.lampHeadMat), false);

    // Signal poles, heads and bulbs for this chunk.
    if (chunk.poles.length) {
      const pole = new InstanceList(), head = new InstanceList(), bulbs = new InstanceList();
      for (const pl of chunk.poles) {
        pole.add(pl.x, 2.6, pl.z);
        head.add(pl.x, 4.6, pl.z);
        const D = DIRS[pl.d];
        for (let l = 0; l < 3; l++) bulbs.add(pl.x - D.x * 0.24, 5.02 - l * 0.42, pl.z - D.z * 0.24, 1, 1, 1, 0x2a2d31);
      }
      add(pole.mesh(this.poleGeo, this.poleMat));
      add(head.mesh(this.headGeo, this.headMat));
      chunk.lampMesh = add(bulbs.mesh(this.lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff })), false);
    }
  }

  fillGap(ground, k1, k2, x0, z0, x1, z1) {
    const a = this.kind(...k1), b = this.kind(...k2);
    if (a === 'water' && b === 'water') return;
    const land = a === 'water' ? b : a;
    const color = a === 'water' || b === 'water' ? 0xe6d3a0 : GROUND_COLORS[land] || (STREET_KINDS.has(land) ? 0xb8b3a8 : 0x7fa04e);
    ground.flat(x0, z0, x1, z1, STREET_KINDS.has(land) && a !== 'water' && b !== 'water' ? CITY.CURB : 0.01, color);
  }

  // One road segment: asphalt, centre line, and a bridge deck over water.
  buildSegment(roads, bld, white, yellow, i, j, vertical) {
    const { PITCH, HALF, BLOCK } = CITY;
    const asphalt = new THREE.Color(0xffffff), uvs = 1 / 8;
    const key = `${vertical ? 'v' : 'h'}${i},${j}`;
    let x0, z0, x1, z1;
    if (vertical) { x0 = i * PITCH - HALF; x1 = i * PITCH + HALF; z0 = j * PITCH + HALF; z1 = z0 + BLOCK; }
    else { x0 = i * PITCH + HALF; x1 = x0 + BLOCK; z0 = j * PITCH - HALF; z1 = j * PITCH + HALF; }
    roads.flat(x0, z0, x1, z1, 0, asphalt, uvs);
    const len = BLOCK - 9, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (vertical) { yellow.add(cx - 0.18, 0.02, cz, 0.14, 1, len); yellow.add(cx + 0.18, 0.02, cz, 0.14, 1, len); }
    else { yellow.add(cx, 0.02, cz - 0.18, len, 1, 0.14); yellow.add(cx, 0.02, cz + 0.18, len, 1, 0.14); }
    if (this.bridges.has(key)) {
      // Deck, railings and piers.
      bld.box(x0 - 0.6, -1.4, z0 - 0.3, x1 + 0.6, -0.02, z1 + 0.3, 0xb9b5ab, { plain: true });
      if (vertical) {
        bld.box(x0 - 0.6, -0.02, z0, x0, 1.0, z1, 0xd8d4c8, { plain: true });
        bld.box(x1, -0.02, z0, x1 + 0.6, 1.0, z1, 0xd8d4c8, { plain: true });
        for (const pz of [z0 + 12, z0 + 36]) bld.box(cx - 2, -8, pz - 1.5, cx + 2, -1.4, pz + 1.5, 0x9a968c, { plain: true });
      } else {
        bld.box(x0, -0.02, z0 - 0.6, x1, 1.0, z0, 0xd8d4c8, { plain: true });
        bld.box(x0, -0.02, z1, x1, 1.0, z1 + 0.6, 0xd8d4c8, { plain: true });
      }
      // The Sea Link gets its tall cable-stay towers, one each side of the deck.
      if (vertical && i === 1) {
        bld.box(x0 - 1.6, 0, cz - 1, x0 - 0.6, 46, cz + 1, 0xe8e4da, { plain: true });
        bld.box(x1 + 0.6, 0, cz - 1, x1 + 1.6, 46, cz + 1, 0xe8e4da, { plain: true });
        bld.box(x0 - 1.6, 40, cz - 1, x1 + 1.6, 42, cz + 1, 0xe8e4da, { plain: true });
      }
    }
  }

  buildSignal(n, chunk, white) {
    const { HALF } = CITY;
    const off = HALF + 1.2;
    for (let d = 0; d < 4; d++) {
      if (!this.hasRoad(n.i, n.j, reverseDir(d))) continue;
      // A pole for traffic arriving in direction d, on its near kerb side.
      const D = DIRS[d], r = laneSide(d);
      const pl = { node: n, axis: axisOf(d), d, x: n.x - D.x * off + r.x * off, z: n.z - D.z * off + r.z * off, state: '', chunk };
      chunk.poles.push(pl);
      this.poles.push(pl);
    }
    for (let d = 0; d < 4; d++) {
      if (!this.hasRoad(n.i, n.j, d)) continue;
      const D = DIRS[d], alongX = D.x !== 0;
      const cx = n.x + D.x * (HALF + 2), cz = n.z + D.z * (HALF + 2);
      for (let k = -HALF + 0.9; k < HALF - 0.5; k += 1.3) {
        if (alongX) white.add(cx, 0.02, cz + k, 3, 1, 0.65);
        else white.add(cx + k, 0.02, cz, 0.65, 1, 3);
      }
      // Stop line across the lane coming back into this junction.
      const rr = laneSide(reverseDir(d));
      const sx = n.x + D.x * STOP_LINE + rr.x * (HALF / 2), sz = n.z + D.z * STOP_LINE + rr.z * (HALF / 2);
      if (alongX) white.add(sx, 0.02, sz, 0.5, 1, HALF - 0.4);
      else white.add(sx, 0.02, sz, HALF - 0.4, 1, 0.5);
    }
  }

  buildOpen(kind, b, ctx) {
    const { x0, z0, x1, z1 } = b, rng = ctx.rng;
    if (kind === 'beach') {
      for (let t = 0; t < 6; t++) ctx.palms.add(x0 + 6 + rng() * 48, 7.2, z0 + 6 + rng() * 48);
    } else if (kind === 'farm') {
      // Patchwork fields and the odd farmhouse.
      const cols = [0x86a84f, 0x9db35a, 0x6f8f3f, 0xb8a868, 0x7d9a4a];
      for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) ctx.ground.flat(x0 + a * 20 + 0.5, z0 + c * 20 + 0.5, x0 + a * 20 + 19.5, z0 + c * 20 + 19.5, 0.02, cols[Math.floor(rng() * cols.length)]);
      if (rng() < 0.6) {
        const hx = x0 + 10 + rng() * 34, hz = z0 + 10 + rng() * 34;
        ctx.bld.box(hx, 0, hz, hx + 7, 3.4, hz + 6, 0xe8d8b8, { tile: [3.5, 3.4] });
        ctx.bld.gable(hx - 0.4, 3.4, hz - 0.4, hx + 7.4, hz + 6.4, 2, 0xa04a32, 0xe8d8b8, true);
        const r = { x0: hx, z0: hz, x1: hx + 7, z1: hz + 6 };
        this.buildingSolid.add(r);
        this.buildingRects[b.bi + b.bj * CITY.NX].push(r);
      }
      for (let t = 0; t < 3; t++) ctx.trees.add(x0 + rng() * 60, 0.02, z0 + rng() * 60, 0.9);
    } else if (kind === 'airport') {
      this.buildAirportPart(b, ctx);
    } else if (kind === 'stunts') {
      this.buildStuntYard(b, ctx);
    } else if (kind === 'parking') {
      for (let row = 0; row < 2; row++) {
        const rz = z0 + 12 + row * 30;
        for (let c = 0; c <= 9; c++) ctx.white.add(x0 + 6 + c * 6, 0.03, rz, 0.15, 1, 6);
        for (let c = 0; c < 9; c++) this.parkingSpots.push({ x: x0 + 9 + c * 6, z: rz, h: row === 0 ? headingOf(1) : headingOf(3) });
      }
    }
  }

  // The airport: runway across the blocks, a terminal and a parked plane.
  buildAirportPart(b, ctx) {
    const { x0, z0, x1, z1 } = b;
    if (!this.airportBuilt) {
      this.airportBuilt = true;
      const rz = (b.bj + 1) * CITY.PITCH;          // runway centre line along the row boundary
      const rx0 = b.x0, rx1 = b.x0 + CITY.PITCH * 2 - CITY.ROAD;
      ctx.ground.flat(rx0, rz - 10, rx1, rz + 10, 0.03, 0x34383d);
      for (let x = rx0 + 6; x < rx1 - 6; x += 12) ctx.white.add(x, 0.05, rz, 6, 1, 0.5);
      ctx.white.add(rx0 + 3, 0.05, rz, 2, 1, 16);
      ctx.white.add(rx1 - 3, 0.05, rz, 2, 1, 16);
      // Terminal on the north side.
      ctx.addBuilding(x0 + 64, z0 + 2, x0 + 120, z0 + 18, 12, 0x9fb8cc, { tile: [6, 4] });
      // Control tower.
      ctx.bld.box(x0 + 56, CITY.CURB, z0 + 26, x0 + 60, 26, z0 + 30, 0xd8d4c8, { plain: true });
      ctx.bld.box(x0 + 54.5, 26, z0 + 24.5, x0 + 61.5, 30, z0 + 31.5, 0x6f93a8, { tile: [3, 4] });
      this.buildingSolid.add({ x0: x0 + 56, z0: z0 + 26, x1: x0 + 60, z1: z0 + 30 });
      // A jet parked on the apron.
      const px = x0 + 40, pz = z0 + 34, white = 0xf2f2ee;
      ctx.bld.box(px - 16, 2.2, pz - 2, px + 16, 6.2, pz + 2, white, { tile: [2, 4] });
      ctx.bld.box(px - 4, 3.2, pz - 17, px + 3, 3.8, pz + 17, 0xdcdcd6, { plain: true });
      ctx.bld.box(px - 16, 6.2, pz - 0.4, px - 11, 12, pz + 0.4, 0xe0701c, { plain: true });
      ctx.bld.box(px - 16, 5.8, pz - 6, px - 12, 6.3, pz + 6, 0xdcdcd6, { plain: true });
      for (const t of [-9, 9]) ctx.bld.box(px - 2, 1.6, pz + t - 1.2, px + 2, 3.3, pz + t + 1.2, 0x8a8f96, { plain: true });
      ctx.bld.box(px - 1, 0, pz - 1, px + 1, 2.2, pz + 1, 0x2a2d31, { plain: true });
      this.buildingSolid.add({ x0: px - 16, z0: pz - 2.5, x1: px + 16, z1: pz + 2.5 });
    }
    void x1; void z1;
  }

  buildStuntYard(b, ctx) {
    const { x0, z0 } = b;
    const stripes = canvasTexture(64, (g) => {
      g.fillStyle = '#f2c230'; g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#1b1d20';
      for (let i = -64; i < 128; i += 24) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 12, 0); g.lineTo(i + 76, 64); g.lineTo(i + 64, 64); g.fill(); }
    });
    stripes.repeat.set(2, 3);
    const mat = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.7 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x55595e, roughness: 0.9 });
    const add = (x, z, dir, len, width, h) => {
      const D = DIRS[dir];
      this.ramps.push({ x, z, fx: D.x, fz: D.z, len, width, h, id: this.ramps.length });
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = headingOf(dir);
      const angle = Math.atan2(h, len), hyp = Math.hypot(h, len);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(width, 0.24, hyp), mat);
      deck.rotation.x = -angle;
      deck.position.set(0, h / 2 - 0.1, len / 2);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(width, h, 0.5), legMat);
      leg.position.set(0, h / 2 - 0.12, len - 0.25);
      deck.castShadow = leg.castShadow = deck.receiveShadow = true;
      g.add(deck, leg);
      ctx.group.add(g);
    };
    add(x0 + 6, z0 + 14, 0, 11, 5, 2.4);
    add(x0 + 54, z0 + 46, 2, 11, 5, 2.4);
    add(x0 + 30, z0 + 50, 3, 14, 6, 3.4);
    add(x0 + 16, z0 + 54, 3, 8, 4, 1.6);
  }

  buildStreetBlock(kind, b, ctx, pal, pick, lm) {
    const { x0, z0, x1, z1 } = b, { CURB, BLOCK } = CITY, rng = ctx.rng, bld = ctx.bld;
    const k = b.bi + b.bj * CITY.NX;
    if (kind === 'park') {
      const maidan = b.bj >= 63;
      ctx.ground.flat(x0 + 4, z0 + 4, x1 - 4, z1 - 4, CURB + 0.01, maidan ? 0xa8a070 : 0x6f9b4c);
      if (maidan) ctx.ground.flat(x0 + 28, z0 + 22, x1 - 28, z1 - 22, CURB + 0.02, 0xd8c890); // the cricket pitch
      else ctx.ground.flat(x0 + 22, z0 + 22, x1 - 22, z1 - 22, CURB + 0.02, 0x4f8fc0);
      for (let t = 0; t < 16; t++) {
        const a = (t / 16) * Math.PI * 2;
        ctx.trees.add(x0 + 30 + Math.cos(a) * 24, CURB, z0 + 30 + Math.sin(a) * 24, 1);
      }
      return;
    }
    if (kind === 'gateway') {
      // Gateway of India on the harbour side, and a grand old hotel beside it.
      const gx = x1 - 10, gz = (z0 + z1) / 2, stone = 0xc9a46a;
      bld.box(gx - 3, CURB, gz - 9, gx + 3, CURB + 16, gz - 4, stone, { plain: true });
      bld.box(gx - 3, CURB, gz + 4, gx + 3, CURB + 16, gz + 9, stone, { plain: true });
      bld.box(gx - 3, CURB + 16, gz - 9, gx + 3, CURB + 21, gz + 9, stone, { plain: true });
      for (const t of [-8, -3, 3, 8]) bld.box(gx - 1, CURB + 21, gz + t - 1, gx + 1, CURB + 25, gz + t + 1, stone, { plain: true });
      this.buildingSolid.add({ x0: gx - 3, z0: gz - 9, x1: gx + 3, z1: gz - 4 });
      this.buildingSolid.add({ x0: gx - 3, z0: gz + 4, x1: gx + 3, z1: gz + 9 });
      ctx.addBuilding(x0 + 6, z0 + 6, x0 + 34, z0 + 30, 22, 0xe2cfa8, { tile: [4, 3.6], roof: 0xb8452a });
      for (const [dx, dz] of [[6, 6], [28, 6], [17, 18]]) bld.box(x0 + dx - 3, CURB + 22, z0 + dz - 3 + 3, x0 + dx + 3, CURB + 27, z0 + dz + 3 + 3, 0xb8452a, { plain: true });
      return;
    }
    if (kind === 'dense') {
      // Rows of huts with blue tarps and rusty tin roofs.
      for (let row = 0; row < 7; row++) {
        const rz = z0 + 4 + row * 7.6;
        let x = x0 + 4;
        while (x < x1 - 6) {
          const w = 3 + rng() * 3, h = 3 + rng() * 4;
          bld.box(x, CURB, rz, x + w, CURB + h, rz + 5, pick([0xc8b8a0, 0xa8c8d8, 0xd8a890, 0xe0d0b0, 0x98b8a0]), { tile: [2.5, 2.4], roof: pick([0x2f6fbf, 0x8a5a3a, 0x7a7f86, 0x2f6fbf]) });
          x += w + 0.3;
        }
        const r = { x0: x0 + 4, z0: rz, x1: x - 0.3, z1: rz + 5 };
        this.buildingRects[k].push(r);
        this.buildingSolid.add(r);
      }
      return;
    }
    // Four lots per block.
    for (let lj = 0; lj < 2; lj++)
      for (let li = 0; li < 2; li++) {
        const w = 18 + rng() * 6, d = 18 + rng() * 6;
        const lx = x0 + 4 + li * 26 + 13 + (rng() - 0.5) * (25 - w), lz = z0 + 4 + lj * 26 + 13 + (rng() - 0.5) * (25 - d);
        const bx0 = lx - w / 2, bz0 = lz - d / 2;
        const isLandmark = lm && ((lm.side === 0 && lj === 0 && li === 0) || (lm.side === 1 && li === 1 && lj === 0) || (lm.side === 2 && lj === 1 && li === 1) || (lm.side === 3 && li === 0 && lj === 1));
        if (isLandmark) {
          const look = { police: [0x2a4f8f, 'POLICE', '#1d3f7a'], hospital: [0xeef0ee, '✚ HOSPITAL', '#c8262c'], spray: [0x3a3f46, 'SPRAY & REPAIR', '#e0901c'] }[lm.type];
          ctx.addBuilding(bx0, bz0, bx0 + w, bz0 + d, 11, look[0], { roof: 0x55595f });
          this.addLandmark(lm, b, bx0, bz0, bx0 + w, bz0 + d, look, ctx.group);
          continue;
        }
        if (kind === 'industrial') {
          ctx.addBuilding(bx0, bz0, bx0 + w, bz0 + d, 7 + rng() * 5, pick(pal.industrial), { tile: [8, 5], roof: 0x6b7076 });
          if (rng() < 0.6) ctx.containers.add(lx, CURB + 1.3, lz + d / 2 + 2.2 > z0 + 56 ? lz - d / 2 - 2 : lz + d / 2 + 2.2, 1, 1, 1, pick([0xb5452f, 0x2f6fa8, 0x3f8a52, 0xd19a2a]));
          continue;
        }
        if (kind === 'town') {
          const h = 5 + rng() * 6, color = pick(pal.town);
          ctx.addBuilding(bx0 + 2, bz0 + 2, bx0 + w - 2, bz0 + d - 2, h, color, { tile: [3.5, 3.2] });
          if (rng() < 0.4) bld.gable(bx0 + 1.6, CURB + h, bz0 + 1.6, bx0 + w - 1.6, bz0 + d - 1.6, 2.4, pick(pal.roofs), color, rng() < 0.5);
          continue;
        }
        if (kind === 'res') {
          // Housing society towers with black water tanks on the roof.
          const h = 15 + rng() * 18, color = pick(pal.res);
          ctx.addBuilding(bx0 + 1, bz0 + 1, bx0 + w - 1, bz0 + d - 1, h, color, { tile: [3.5, 3], roof: 0x9a9690 });
          for (const t of [-1, 1]) bld.box(lx + t * 3 - 0.8, CURB + h, lz - 0.8, lx + t * 3 + 0.8, CURB + h + 1.6, lz + 0.8, 0x1d1f22, { plain: true });
          continue;
        }
        const tall = kind === 'city';
        const h = tall ? 30 + rng() * 55 : 12 + rng() * 18;
        const color = pick(tall ? pal.city : pal.mid);
        ctx.addBuilding(bx0, bz0, bx0 + w, bz0 + d, h, color, { roof: 0x6e7177 });
        if (tall && rng() < 0.6) {
          const s = 3 + rng() * 3;
          bld.box(bx0 + s, CURB + h, bz0 + s, bx0 + w - s, CURB + h + 6 + rng() * 16, bz0 + d - s, color, { roof: 0x5e6167 });
        }
        if (rng() < 0.6) bld.box(lx - 2, CURB + h, lz - 1.5, lx + 1, CURB + h + 1.6, lz + 1.5, 0x9a9ea3, { plain: true });
      }
    void BLOCK;
  }

  addLandmark(lm, b, bx0, bz0, bx1, bz1, look, group) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.2), new THREE.MeshBasicMaterial({ map: textTexture(look[1], look[2]) }));
    const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
    const out = [[0, -1], [1, 0], [0, 1], [-1, 0]][lm.side];
    const half = [(bz1 - bz0) / 2, (bx1 - bx0) / 2][lm.side % 2];
    sign.position.set(cx + out[0] * (half + 0.06), CITY.CURB + 11 - 2.4, cz + out[1] * (half + 0.06));
    sign.rotation.y = Math.atan2(out[0], out[1]);
    group.add(sign);
    // Door marker in the lane beside this side of the block; walk: the sidewalk in front.
    const { PITCH, LANE, HALF } = CITY, bi = b.bi, bj = b.bj, near = HALF + 2;
    let x, z, h, walk;
    if (lm.side === 0) { x = cx; z = bj * PITCH + LANE; h = headingOf(2); walk = { x, z: bj * PITCH + near }; }
    else if (lm.side === 1) { x = (bi + 1) * PITCH - LANE; z = cz; h = headingOf(3); walk = { x: (bi + 1) * PITCH - near, z }; }
    else if (lm.side === 2) { x = cx; z = (bj + 1) * PITCH - LANE; h = headingOf(0); walk = { x, z: (bj + 1) * PITCH - near }; }
    else { x = bi * PITCH + LANE; z = cz; h = headingOf(1); walk = { x: bi * PITCH + near, z }; }
    this.landmarks.push({ type: lm.type, name: lm.name, x, z, h, walk });
  }

  placeJobsAndPackages() {
    const rng = mulberry32(7741);
    for (const [type, name, i, j, d] of MUMBAI.jobs) {
      if (!this.hasRoad(i, j, d)) continue;
      const p = this.lanePoint(i, j, d, CITY.PITCH / 2);
      this.jobSpots.push({ type, name, x: p.x, z: p.z, h: p.h });
    }
    // Hidden packages, spread from Colaba to Boisar.
    let tries = 0;
    while (this.packages.length < 24 && tries++ < 4000) {
      const k = Math.floor(rng() * this.info.length), b = this.info[k];
      if (b.bj < 11 || !(STREET_KINDS.has(b.kind) || OPEN_KINDS.has(b.kind))) continue;
      const x = b.x0 + 3 + rng() * (CITY.BLOCK - 6), z = b.z0 + 3 + rng() * (CITY.BLOCK - 6);
      const inside = this.buildingRects[k].some((r) => x > r.x0 - 1.5 && x < r.x1 + 1.5 && z > r.z0 - 1.5 && z < r.z1 + 1.5);
      if (inside || this.packages.some((p) => Math.hypot(p.x - x, p.z - z) < 120)) continue;
      this.packages.push({ x, z, y: this.blocks[k] ? CITY.CURB : 0 });
    }
  }

  // Show only the chunks near the camera.
  updateVisibility(cx, cz, far) {
    for (const c of this.chunks) {
      const dz = cz < c.z0 ? c.z0 - cz : cz > c.z1 ? cz - c.z1 : 0;
      c.group.visible = dz < far;
    }
  }

  setNight(f) {
    this.buildingMat.emissiveIntensity = f * 0.95;
    this.lampHeadMat.color.setRGB(0.54 + f * 0.46, 0.56 + f * 0.36, 0.59 + f * 0.1);
  }

  updateLights(t) {
    const { lampColors } = this;
    for (const c of this.chunks) {
      if (!c.group.visible || !c.lampMesh) continue;
      let dirty = false;
      c.poles.forEach((pl, k) => {
        const st = lightState(pl.node, pl.axis, t);
        if (st === pl.state) return;
        pl.state = st;
        c.lampMesh.setColorAt(k * 3, st === 'red' ? lampColors.red : lampColors.off);
        c.lampMesh.setColorAt(k * 3 + 1, st === 'yellow' ? lampColors.yellow : lampColors.off);
        c.lampMesh.setColorAt(k * 3 + 2, st === 'green' ? lampColors.green : lampColors.off);
        dirty = true;
      });
      if (dirty) c.lampMesh.instanceColor.needsUpdate = true;
    }
  }
}
