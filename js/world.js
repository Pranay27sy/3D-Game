'use strict';

// City layout: an N x N grid of blocks separated by two-way roads, one lane
// each way. Traffic drives on the right. One world unit is one metre.
const CITY = (() => {
  const N = 7, BLOCK = 60, ROAD = 12;
  return { N, BLOCK, ROAD, HALF: ROAD / 2, LANE: 3, PITCH: BLOCK + ROAD, SIZE: N * (BLOCK + ROAD), CURB: 0.3 };
})();
const CITY_NAME = 'Port Sundale';

// Directions: 0 = +x (east), 1 = +z (south), 2 = -x (west), 3 = -z (north).
const DIRS = [{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 }];
const axisOf = (d) => d % 2;
const reverseDir = (d) => (d + 2) % 4;
const rightOf = (d) => ({ x: -DIRS[d].z, z: DIRS[d].x });
const headingOf = (d) => Math.atan2(DIRS[d].x, DIRS[d].z);

// Distance from a junction centre to the stop line on each approach.
const STOP_LINE = CITY.HALF + 4;
// People walk this far inside the curb.
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

// Each junction alternates green between its two axes:
// 8 s green, 2.5 s yellow, 0.5 s all-red, then the other axis.
const LIGHT_CYCLE = 22;
function lightState(node, axis, t) {
  const p = (((t + node.offset) % LIGHT_CYCLE) + LIGHT_CYCLE) % LIGHT_CYCLE;
  const half = LIGHT_CYCLE / 2;
  const active = p < half ? 0 : 1;
  if (active !== axis) return 'red';
  const local = p - active * half;
  if (local < 8) return 'green';
  if (local < 10.5) return 'yellow';
  return 'red';
}

// Districts. Special blocks first, then rings around the centre.
const SPECIAL_BLOCKS = { '1,2': 'park', '5,4': 'park', '3,3': 'plaza', '5,0': 'stunts', '1,5': 'parking' };
const OPEN_DISTRICTS = new Set(['stunts', 'parking']);
const DISTRICT_NAMES = {
  downtown: 'Downtown', commercial: 'Midtown', residential: 'Harbor Heights', industrial: 'Dockside',
  park: 'Park', plaza: 'Sundale Square', stunts: 'Stunt Yard', parking: 'Parking Lot',
};
function districtOf(bi, bj) {
  const s = SPECIAL_BLOCKS[`${bi},${bj}`];
  if (s) return s;
  if (bj === 0) return 'industrial';
  const ring = Math.max(Math.abs(bi - 3), Math.abs(bj - 3));
  if (ring <= 1) return 'downtown';
  if (ring === 2) return 'commercial';
  return 'residential';
}

// Landmarks sit on one side of a block; their door is in the lane next to it.
const LANDMARKS = [
  { type: 'police', name: 'Police Station', block: [4, 2], side: 0, color: 0x2a4f8f, sign: 'POLICE', signBg: '#1d3f7a' },
  { type: 'hospital', name: 'Hospital', block: [2, 4], side: 2, color: 0xeef0ee, sign: '✚ HOSPITAL', signBg: '#c8262c' },
  { type: 'spray', name: 'Spray & Repair', block: [1, 3], side: 3, color: 0x3a3f46, sign: 'SPRAY & REPAIR', signBg: '#e0901c' },
  { type: 'spray', name: 'Spray & Repair', block: [5, 2], side: 1, color: 0x3a3f46, sign: 'SPRAY & REPAIR', signBg: '#e0901c' },
];

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
  g.font = `900 ${Math.round(h * 0.55)}px Overpass, Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4, w - 24);
  return new THREE.CanvasTexture(c);
}

// Collects flat-shaded triangles with vertex colours and UVs into one mesh, so
// the whole skyline costs a single draw call. Each face is turned to point away
// from a reference point inside its solid, so winding never has to be hand-checked.
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

  // Flat horizontal rectangle (lawns, plazas, sand).
  flat(x0, z0, x1, z1, y, color) {
    const c = new THREE.Color(color), uv = [[0, 0], [0, 0], [0, 0], [0, 0]];
    this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], c, uv, [(x0 + x1) / 2, y - 1, (z0 + z1) / 2]);
  }

  mesh(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    return new THREE.Mesh(g, material);
  }
}

class World {
  constructor(scene) {
    this.scene = scene;
    const rng = (this.rng = mulberry32(20261020));
    const { N, PITCH } = CITY;
    this.nodes = [];
    for (let j = 0; j <= N; j++)
      for (let i = 0; i <= N; i++)
        this.nodes.push({ i, j, x: i * PITCH, z: j * PITCH, offset: rng() * LIGHT_CYCLE });

    const H = CITY.HALF, S = CITY.SIZE, FAR = 1e4;
    this.bounds = [
      { x0: -FAR, x1: -H, z0: -FAR, z1: FAR },
      { x0: S + H, x1: FAR, z0: -FAR, z1: FAR },
      { x0: -FAR, x1: FAR, z0: -FAR, z1: -H },
      { x0: -FAR, x1: FAR, z0: S + H, z1: FAR },
    ];
    this.blocks = [];        // curb rectangle cars can't cross; null for open blocks
    this.info = [];          // { bi, bj, x0, z0, x1, z1, district }
    this.buildingRects = []; // per block: footprints people on foot can't walk through
    this.extraRects = [];    // per block: solid props in open blocks
    this.ramps = [];
    this.parkingSpots = [];
    this.landmarks = [];
    this.jobSpots = [];
    this.packages = [];
    this.poles = [];
    this.lampHeads = null;
    this.nightMats = [];
    // Missions treat curbs as walls; the open world lets cars mount the sidewalk.
    this.curbsSolid = true;

    this.buildGround();
    this.buildBlocks();
    this.buildMarkings();
    this.buildLights();
    this.buildStreetLamps();
    this.buildBarriers();
    this.buildBeach();
    this.placeJobsAndPackages();
  }

  node(i, j) { return this.nodes[i + j * (CITY.N + 1)]; }

  hasRoad(i, j, d) {
    const ni = i + DIRS[d].x, nj = j + DIRS[d].z;
    return ni >= 0 && nj >= 0 && ni <= CITY.N && nj <= CITY.N;
  }

  lanePoint(i, j, d, s) {
    const n = this.node(i, j), D = DIRS[d], r = rightOf(d);
    return { i, j, d, s, x: n.x + D.x * s + r.x * CITY.LANE, z: n.z + D.z * s + r.z * CITY.LANE, h: headingOf(d) };
  }

  randomLanePoint(rand = Math.random) {
    for (;;) {
      const i = Math.floor(rand() * (CITY.N + 1)), j = Math.floor(rand() * (CITY.N + 1)), d = Math.floor(rand() * 4);
      if (!this.hasRoad(i, j, d)) continue;
      return this.lanePoint(i, j, d, CITY.HALF + 12 + rand() * (CITY.BLOCK - 26));
    }
  }

  // The lane point nearest to (x, z): useful for respawning and for placing markers.
  nearestLanePoint(x, z) {
    const { PITCH, HALF, BLOCK, N } = CITY;
    const ri = clamp(Math.round(x / PITCH), 0, N), rj = clamp(Math.round(z / PITCH), 0, N);
    const dx = Math.abs(x - ri * PITCH), dz = Math.abs(z - rj * PITCH);
    let i, j, d, s;
    if (dz <= dx) { // on (or nearer to) an east-west road at z = rj * PITCH
      j = rj; i = clamp(Math.floor(x / PITCH), 0, N - 1); s = clamp(x - i * PITCH, HALF + 2, PITCH - HALF - 2);
      d = z >= rj * PITCH ? 0 : 2;
      if (d === 2) { i += 1; s = PITCH - s; }
    } else {
      i = ri; j = clamp(Math.floor(z / PITCH), 0, N - 1); s = clamp(z - j * PITCH, HALF + 2, PITCH - HALF - 2);
      d = x <= ri * PITCH ? 1 : 3;
      if (d === 3) { j += 1; s = PITCH - s; }
    }
    if (!this.hasRoad(i, j, d)) return this.randomLanePoint();
    return this.lanePoint(i, j, d, clamp(s, HALF + 2, HALF + BLOCK - 2));
  }

  blockIndexAt(x, z) {
    const { N, PITCH } = CITY;
    const bi = Math.floor(x / PITCH), bj = Math.floor(z / PITCH);
    if (bi < 0 || bj < 0 || bi >= N || bj >= N) return -1;
    const b = this.info[bi + bj * N];
    return x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 ? bi + bj * N : -1;
  }

  nearBlocks(x, z, r, fn) {
    const { N, PITCH } = CITY;
    const i0 = clamp(Math.floor((x - r) / PITCH), 0, N - 1), i1 = clamp(Math.floor((x + r) / PITCH), 0, N - 1);
    const j0 = clamp(Math.floor((z - r) / PITCH), 0, N - 1), j1 = clamp(Math.floor((z + r) / PITCH), 0, N - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(i + j * N);
  }

  // Solid rectangles for cars near (x, z): curbs, props, the city edge.
  rectsNear(x, z) {
    const out = this.bounds.slice();
    this.nearBlocks(x, z, 4, (k) => {
      if (this.curbsSolid) { if (this.blocks[k]) out.push(this.blocks[k]); }
      else for (const r of this.buildingRects[k]) out.push(r);
      for (const r of this.extraRects[k]) out.push(r);
    });
    return out;
  }

  // Solid rectangles for people on foot: buildings and props, not curbs.
  footRectsNear(x, z) {
    const out = this.bounds.slice();
    this.nearBlocks(x, z, 3, (k) => {
      for (const r of this.buildingRects[k]) out.push(r);
      for (const r of this.extraRects[k]) out.push(r);
    });
    return out;
  }

  // Height of the drivable surface: ramps, and sidewalks when cars may mount them.
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

  // Height under someone on foot: sidewalks are a curb step up.
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
    if (i < 0 || j < 0 || i > CITY.N || j > CITY.N) return null;
    const n = this.node(i, j);
    return Math.abs(x - n.x) < CITY.HALF && Math.abs(z - n.z) < CITY.HALF ? n : null;
  }

  districtAt(x, z) {
    const { N, PITCH } = CITY;
    const bi = clamp(Math.floor(x / PITCH), 0, N - 1), bj = clamp(Math.floor(z / PITCH), 0, N - 1);
    return this.info[bi + bj * N].district;
  }

  // ---------- Sidewalk loops for pedestrians ----------
  hasSidewalk(k) { return !!this.blocks[k]; }

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
  buildGround() {
    const { SIZE, HALF } = CITY;
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x7fa35a, roughness: 1 })
    );
    grass.position.set(SIZE / 2, -0.4, SIZE / 2);
    grass.receiveShadow = true;
    this.scene.add(grass);

    const asphaltTex = canvasTexture(128, (g, s) => {
      g.fillStyle = '#4a4f55';
      g.fillRect(0, 0, s, s);
      for (let k = 0; k < 1800; k++) {
        const v = 60 + Math.floor(Math.random() * 40);
        g.fillStyle = `rgb(${v},${v + 3},${v + 6})`;
        g.fillRect(Math.random() * s, Math.random() * s, 1.5, 1.5);
      }
    });
    const span = SIZE + HALF * 2;
    asphaltTex.repeat.set(span / 8, span / 8);
    this.roadMat = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.95, metalness: 0 });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(span, span).rotateX(-Math.PI / 2), this.roadMat);
    road.position.set(SIZE / 2, 0, SIZE / 2);
    road.receiveShadow = true;
    this.scene.add(road);
  }

  buildBlocks() {
    const { N, PITCH, HALF, BLOCK, CURB } = CITY;
    const rng = this.rng;
    // Window atlas: 4 x 4 windows. The lit copy decides which windows glow at night.
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
    this.nightMats.push(this.buildingMat);
    const plainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });

    const bld = new GeoBatch(), ground = new GeoBatch();
    const trees = [], containers = [];
    const pal = {
      downtown: [0x9fb3c8, 0x7f93a8, 0xc3ccd6, 0x8aa0a8, 0xb7c4cf, 0x6f8193],
      commercial: [0xd8cfc0, 0xc9a98e, 0xe6dcc8, 0xb08b74, 0xd1b48c, 0xa7b59d],
      residential: [0xf2e6cf, 0xe8d3c0, 0xdde6ea, 0xf0dcd0, 0xe3e8d2, 0xf5efe0],
      roofs: [0x8a4b3c, 0x5d6168, 0x7a5a3f, 0x4f5a66],
      industrial: [0x9aa1a6, 0x8a8f7c, 0xa69a88, 0x7d8a92],
    };
    const pick = (a) => a[Math.floor(rng() * a.length)];
    const landmarkAt = {};
    for (const lm of LANDMARKS) landmarkAt[lm.block.join(',')] = lm;

    for (let bj = 0; bj < N; bj++)
      for (let bi = 0; bi < N; bi++) {
        const k = bi + bj * N;
        const x0 = bi * PITCH + HALF, z0 = bj * PITCH + HALF, x1 = x0 + BLOCK, z1 = z0 + BLOCK;
        const district = districtOf(bi, bj);
        this.info.push({ bi, bj, x0, z0, x1, z1, district });
        this.buildingRects.push([]);
        this.extraRects.push([]);
        const rects = this.buildingRects[k], extra = this.extraRects[k];
        const addBuilding = (bx0, bz0, bx1, bz1, h, color, opts) => {
          bld.box(bx0, CURB, bz0, bx1, CURB + h, bz1, color, opts);
          rects.push({ x0: bx0, z0: bz0, x1: bx1, z1: bz1 });
        };

        if (OPEN_DISTRICTS.has(district)) {
          this.blocks.push(null);
          ground.flat(x0, z0, x1, z1, 0.012, district === 'stunts' ? 0x5c5f63 : 0x3f4449);
          if (district === 'stunts') this.buildStuntYard(k, x0, z0, extra);
          else this.buildParkingLot(x0, z0);
          continue;
        }

        this.blocks.push({ x0, x1, z0, z1 });
        ground.box(x0, 0, z0, x1, CURB, z1, 0xb8b3a8, { plain: true });

        // Street trees along the sidewalk, clear of the corners.
        if (district !== 'plaza') {
          for (const t of [14, 46]) {
            trees.push([x0 + t, z0 + 1.2, 0.7], [x0 + t, z1 - 1.2, 0.7], [x0 + 1.2, z0 + t, 0.7], [x1 - 1.2, z0 + t, 0.7]);
          }
        }

        const lm = landmarkAt[`${bi},${bj}`];

        if (district === 'park') {
          ground.flat(x0 + 4, z0 + 4, x1 - 4, z1 - 4, CURB + 0.01, 0x6f9b4c);
          ground.flat(x0 + 22, z0 + 22, x1 - 22, z1 - 22, CURB + 0.02, 0x4f8fc0);
          for (let t = 0; t < 18; t++) {
            const tx = x0 + 7 + rng() * (BLOCK - 14), tz = z0 + 7 + rng() * (BLOCK - 14);
            if (Math.abs(tx - (x0 + x1) / 2) < 10 && Math.abs(tz - (z0 + z1) / 2) < 10) continue;
            trees.push([tx, tz, 0.8 + rng() * 0.6]);
          }
          continue;
        }

        if (district === 'plaza') {
          ground.flat(x0 + 3, z0 + 3, x1 - 3, z1 - 3, CURB + 0.01, 0xd9d2c4);
          const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
          bld.box(cx - 5, CURB, cz - 5, cx + 5, CURB + 0.8, cz + 5, 0xc7c0b2, { plain: true });
          ground.flat(cx - 4.4, cz - 4.4, cx + 4.4, cz + 4.4, CURB + 0.7, 0x5aa6d6);
          bld.box(cx - 0.6, CURB, cz - 0.6, cx + 0.6, CURB + 5, cz + 0.6, 0xe9e4d8, { plain: true });
          rects.push({ x0: cx - 5, z0: cz - 5, x1: cx + 5, z1: cz + 5 });
          // City hall on the north side.
          addBuilding(x0 + 12, z0 + 6, x1 - 12, z0 + 20, 16, 0xe8e2d4, { tile: [5, 4] });
          bld.box(x0 + 26, CURB + 16, z0 + 9, x1 - 26, CURB + 24, z0 + 17, 0xd8d0be, { tile: [4, 4] });
          for (const [tx, tz] of [[x0 + 8, z1 - 8], [x1 - 8, z1 - 8], [x0 + 8, z0 + 26], [x1 - 8, z0 + 26]]) trees.push([tx, tz, 1]);
          continue;
        }

        if (district === 'residential') {
          // Three by three houses with pitched roofs and front lawns.
          ground.flat(x0 + 3.6, z0 + 3.6, x1 - 3.6, z1 - 3.6, CURB + 0.01, 0x7faa5a);
          for (let hj = 0; hj < 3; hj++)
            for (let hi = 0; hi < 3; hi++) {
              if (hi === 1 && hj === 1) { trees.push([x0 + 30, z0 + 30, 1.1]); continue; }
              const cx = x0 + 5 + hi * 17 + 8.5, cz = z0 + 5 + hj * 17 + 8.5;
              const w = 9 + rng() * 3, d = 8 + rng() * 3, h = 4 + rng() * 3.5;
              const hx0 = cx - w / 2, hz0 = cz - d / 2;
              const wall = pick(pal.residential);
              addBuilding(hx0, hz0, hx0 + w, hz0 + d, h, wall, { tile: [3.2, 3] });
              bld.gable(hx0 - 0.4, CURB + h, hz0 - 0.4, hx0 + w + 0.4, hz0 + d + 0.4, 2.6 + rng(), pick(pal.roofs), wall, rng() < 0.5);
            }
          continue;
        }

        if (district === 'industrial') {
          for (let lj = 0; lj < 2; lj++) {
            const wz0 = z0 + 5 + lj * 27, h = 8 + rng() * 5;
            const color = pick(pal.industrial);
            addBuilding(x0 + 5, wz0, x1 - 14, wz0 + 21, h, color, { tile: [8, 5], roof: 0x6b7076 });
            for (let c = 0; c < 3; c++) containers.push([x1 - 9, wz0 + 3 + c * 6.5, c === 2 && rng() < 0.5 ? 2 : 1]);
          }
          for (const c of containers.slice(-6)) rects.push({ x0: c[0] - 3.2, z0: c[1] - 1.4, x1: c[0] + 3.2, z1: c[1] + 1.4 });
          continue;
        }

        // Downtown towers and midtown blocks: four lots.
        const downtown = district === 'downtown';
        const centre = Math.hypot(bi - 3, bj - 3) / 4;
        for (let lj = 0; lj < 2; lj++)
          for (let li = 0; li < 2; li++) {
            const w = 18 + rng() * 6, d = 18 + rng() * 6;
            const lx = x0 + 4 + li * 26 + 13 + (rng() - 0.5) * (25 - w), lz = z0 + 4 + lj * 26 + 13 + (rng() - 0.5) * (25 - d);
            const isLandmark = lm && ((lm.side === 0 && lj === 0 && li === 0) || (lm.side === 1 && li === 1 && lj === 0) || (lm.side === 2 && lj === 1 && li === 1) || (lm.side === 3 && li === 0 && lj === 1));
            if (isLandmark) {
              const bx0 = lx - w / 2, bz0 = lz - d / 2;
              addBuilding(bx0, bz0, bx0 + w, bz0 + d, 11, lm.color, { tile: [4, 3.6], roof: 0x55595f });
              this.addSign(lm, bx0, bz0, bx0 + w, bz0 + d, 11);
              continue;
            }
            const h = downtown ? 34 + (1 - centre) * 40 * rng() + rng() * 20 : 12 + rng() * 18;
            const color = pick(downtown ? pal.downtown : pal.commercial);
            const bx0 = lx - w / 2, bz0 = lz - d / 2;
            addBuilding(bx0, bz0, bx0 + w, bz0 + d, h, color, { roof: 0x6e7177 });
            if (downtown && rng() < 0.6) {
              const s = 3 + rng() * 3;
              bld.box(bx0 + s, CURB + h, bz0 + s, bx0 + w - s, CURB + h + 6 + rng() * 14, bz0 + d - s, color, { roof: 0x5e6167 });
            }
            if (rng() < 0.7) bld.box(lx - 2, CURB + h, lz - 1.5, lx + 1, CURB + h + 1.6, lz + 1.5, 0x9a9ea3, { plain: true });
          }
      }

    const city = bld.mesh(this.buildingMat);
    city.castShadow = city.receiveShadow = true;
    const base = ground.mesh(plainMat);
    base.receiveShadow = true;
    this.scene.add(city, base);

    // Trees and containers are instanced.
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.24, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0x6b4b32, roughness: 1 }), trees.length);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.6, 0), new THREE.MeshStandardMaterial({ color: 0x3f7d3a, roughness: 1, flatShading: true }), trees.length);
    trees.forEach(([x, z, k], n) => {
      trunk.setMatrixAt(n, m.compose(p.set(x, CURB + 1.1 * k, z), q, s.set(k, k, k)));
      crown.setMatrixAt(n, m.compose(p.set(x, CURB + 3 * k, z), q, s.set(k, k * 1.2, k)));
    });
    crown.castShadow = trunk.castShadow = true;
    this.scene.add(trunk, crown);

    if (containers.length) {
      const colors = [0xb5452f, 0x2f6fa8, 0x3f8a52, 0xd19a2a];
      const box = new THREE.InstancedMesh(new THREE.BoxGeometry(6.1, 2.6, 2.5), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), containers.length + 8);
      let n = 0;
      for (const [x, z, stack] of containers)
        for (let l = 0; l < stack; l++) {
          box.setMatrixAt(n, m.compose(p.set(x, CURB + 1.3 + l * 2.6, z), q, s.set(1, 1, 1)));
          box.setColorAt(n, new THREE.Color(colors[(n * 7 + l) % colors.length]));
          n++;
        }
      box.count = n;
      box.castShadow = box.receiveShadow = true;
      this.scene.add(box);
    }
  }

  addSign(lm, bx0, bz0, bx1, bz1, h) {
    const tex = textTexture(lm.sign, lm.signBg);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.2), new THREE.MeshBasicMaterial({ map: tex }));
    const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
    const out = [[0, -1], [1, 0], [0, 1], [-1, 0]][lm.side];
    const half = [(bz1 - bz0) / 2, (bx1 - bx0) / 2][lm.side % 2];
    sign.position.set(cx + out[0] * (half + 0.06), CITY.CURB + h - 2.4, cz + out[1] * (half + 0.06));
    sign.rotation.y = Math.atan2(out[0], out[1]);
    this.scene.add(sign);

    // Door marker in the lane beside this side of the block.
    const [bi, bj] = lm.block, { PITCH, LANE } = CITY;
    // x, z: the door marker in the lane next to the building; walk: the sidewalk in front.
    const near = CITY.HALF + 2;
    let x, z, h2, walk;
    if (lm.side === 0) { x = cx; z = bj * PITCH + LANE; h2 = headingOf(0); walk = { x, z: bj * PITCH + near }; }
    else if (lm.side === 1) { x = (bi + 1) * PITCH - LANE; z = cz; h2 = headingOf(1); walk = { x: (bi + 1) * PITCH - near, z }; }
    else if (lm.side === 2) { x = cx; z = (bj + 1) * PITCH - LANE; h2 = headingOf(2); walk = { x, z: (bj + 1) * PITCH - near }; }
    else { x = bi * PITCH + LANE; z = cz; h2 = headingOf(3); walk = { x: bi * PITCH + near, z }; }
    this.landmarks.push({ type: lm.type, name: lm.name, x, z, h: h2, walk });
  }

  buildStuntYard(k, x0, z0, extra) {
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
      // (x, z) is the low end of the ramp.
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
      this.scene.add(g);
    };
    add(x0 + 6, z0 + 14, 0, 11, 5, 2.4);
    add(x0 + 54, z0 + 46, 2, 11, 5, 2.4);
    add(x0 + 30, z0 + 50, 3, 14, 6, 3.4);
    add(x0 + 16, z0 + 54, 3, 8, 4, 1.6);
    // Concrete blocks to weave between.
    const blockMat = new THREE.MeshStandardMaterial({ color: 0xc9c4b8, roughness: 0.95 });
    for (const [bx, bz] of [[x0 + 34, z0 + 16], [x0 + 42, z0 + 24], [x0 + 18, z0 + 32]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2), blockMat);
      b.position.set(bx, 0.5, bz);
      b.castShadow = b.receiveShadow = true;
      this.scene.add(b);
      extra.push({ x0: bx - 1, z0: bz - 1, x1: bx + 1, z1: bz + 1 });
    }
    void k;
  }

  buildParkingLot(x0, z0) {
    this.lotLines = [];
    for (let row = 0; row < 2; row++) {
      const rz = z0 + 12 + row * 30;
      for (let c = 0; c < 9; c++) {
        const bx = x0 + 6 + c * 6;
        this.lotLines.push([bx, rz, 0.15, 6]);
        this.parkingSpots.push({ x: bx + 3, z: rz, h: row === 0 ? headingOf(1) : headingOf(3) });
      }
      this.lotLines.push([x0 + 6 + 9 * 6, rz, 0.15, 6]);
    }
  }

  buildMarkings() {
    const { N, PITCH, HALF, BLOCK } = CITY;
    const white = this.lotLines ? this.lotLines.slice() : [], yellow = [];
    const rect = (list, cx, cz, ex, ez) => list.push([cx, cz, ex, ez]);

    for (let j = 0; j <= N; j++)
      for (let i = 0; i < N; i++) {
        const cx = (i + 0.5) * PITCH, len = BLOCK - 9;
        rect(yellow, cx, j * PITCH - 0.18, len, 0.14);
        rect(yellow, cx, j * PITCH + 0.18, len, 0.14);
        rect(yellow, j * PITCH - 0.18, cx, 0.14, len);
        rect(yellow, j * PITCH + 0.18, cx, 0.14, len);
      }

    for (const n of this.nodes)
      for (let d = 0; d < 4; d++) {
        if (!this.hasRoad(n.i, n.j, d)) continue;
        const D = DIRS[d], alongX = D.x !== 0;
        const cx = n.x + D.x * (HALF + 2), cz = n.z + D.z * (HALF + 2);
        for (let k = -HALF + 0.9; k < HALF - 0.5; k += 1.3) {
          if (alongX) rect(white, cx, cz + k, 3, 0.65);
          else rect(white, cx + k, cz, 0.65, 3);
        }
        const rr = rightOf(reverseDir(d));
        const sx = n.x + D.x * STOP_LINE + rr.x * (HALF / 2), sz = n.z + D.z * STOP_LINE + rr.z * (HALF / 2);
        if (alongX) rect(white, sx, sz, 0.5, HALF - 0.4);
        else rect(white, sx, sz, HALF - 0.4, 0.5);
      }

    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const make = (list, color, y) => {
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
      list.forEach(([x, z, ex, ez], k) => mesh.setMatrixAt(k, m.compose(p.set(x, y, z), q, s.set(ex, 1, ez))));
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    };
    make(white, 0xeeeeea, 0.02);
    make(yellow, 0xf2c230, 0.02);
  }

  buildLights() {
    const { HALF } = CITY;
    const off = HALF + 1.2;
    for (const n of this.nodes)
      for (let d = 0; d < 4; d++) {
        if (!this.hasRoad(n.i, n.j, reverseDir(d))) continue;
        const D = DIRS[d], r = rightOf(d);
        this.poles.push({ node: n, axis: axisOf(d), d, x: n.x - D.x * off + r.x * off, z: n.z - D.z * off + r.z * off, state: '' });
      }

    const count = this.poles.length;
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.11, 4.6, 6), new THREE.MeshStandardMaterial({ color: 0x3b3f45 }), count);
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 1.35, 0.5), new THREE.MeshStandardMaterial({ color: 0x23262a }), count);
    const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }), count * 3);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const offColor = new THREE.Color(0x2a2d31);
    this.poles.forEach((pl, k) => {
      pole.setMatrixAt(k, m.compose(p.set(pl.x, 2.6, pl.z), q, one));
      head.setMatrixAt(k, m.compose(p.set(pl.x, 4.6, pl.z), q, one));
      const D = DIRS[pl.d];
      for (let l = 0; l < 3; l++) {
        lamps.setMatrixAt(k * 3 + l, m.compose(p.set(pl.x - D.x * 0.24, 5.02 - l * 0.42, pl.z - D.z * 0.24), q, one));
        lamps.setColorAt(k * 3 + l, offColor);
      }
    });
    pole.castShadow = head.castShadow = true;
    this.scene.add(pole, head, lamps);
    this.lampMesh = lamps;
    this.lampColors = {
      off: offColor,
      red: new THREE.Color(0xff3b30),
      yellow: new THREE.Color(0xffc21a),
      green: new THREE.Color(0x2ee66b),
    };
  }

  buildStreetLamps() {
    const spots = [];
    this.info.forEach((b, k) => {
      if (!this.blocks[k]) return;
      for (const t of [22, 38]) {
        spots.push([b.x0 + t, b.z0 + 0.7, 0, -1], [b.x0 + t, b.z1 - 0.7, 0, 1], [b.x0 + 0.7, b.z0 + t, -1, 0], [b.x1 - 0.7, b.z0 + t, 1, 0]);
      }
    });
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.12, 6.2, 6), new THREE.MeshStandardMaterial({ color: 0x4a4f55 }), spots.length);
    this.lampHeadMat = new THREE.MeshBasicMaterial({ color: 0x8a8f96 });
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.18, 0.9), this.lampHeadMat, spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    spots.forEach(([x, z, ox, oz], k) => {
      pole.setMatrixAt(k, m.compose(p.set(x, CITY.CURB + 3.1, z), q, one));
      heads.setMatrixAt(k, m.compose(p.set(x - ox * 0.6, CITY.CURB + 6.2, z - oz * 0.6), q, one));
    });
    pole.castShadow = true;
    this.scene.add(pole, heads);
  }

  buildBarriers() {
    const { SIZE, HALF } = CITY;
    const mat = new THREE.MeshStandardMaterial({ color: 0xd2d0c8, roughness: 0.9 });
    const len = SIZE + HALF * 2 + 1.2;
    const parts = [
      [SIZE / 2, -HALF - 0.3, len, 0.6],
      [SIZE / 2, SIZE + HALF + 0.3, len, 0.6],
      [-HALF - 0.3, SIZE / 2, 0.6, len],
      [SIZE + HALF + 0.3, SIZE / 2, 0.6, len],
    ];
    for (const [x, z, w, d] of parts) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, d), mat);
      b.position.set(x, 0.45, z);
      b.castShadow = b.receiveShadow = true;
      this.scene.add(b);
    }
  }

  // A beach along the south edge of the city, with palms and the sea.
  buildBeach() {
    const { SIZE, HALF } = CITY;
    const z0 = SIZE + HALF + 0.6;
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(SIZE + 400, 46).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe8d9a8, roughness: 1 }));
    sand.position.set(SIZE / 2, -0.02, z0 + 23);
    sand.receiveShadow = true;
    this.waterMat = new THREE.MeshStandardMaterial({ color: 0x2f86b8, roughness: 0.25, metalness: 0.1 });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(3000, 1200).rotateX(-Math.PI / 2), this.waterMat);
    sea.position.set(SIZE / 2, -0.01, z0 + 46 + 600);
    this.scene.add(sand, sea);
    const palms = [];
    for (let x = -60; x < SIZE + 60; x += 22 + this.rng() * 14) palms.push([x, z0 + 8 + this.rng() * 22]);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.26, 7, 6), new THREE.MeshStandardMaterial({ color: 0x8a6a45 }), palms.length);
    const leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(2.6, 1.2, 7), new THREE.MeshStandardMaterial({ color: 0x3f8f4a, flatShading: true }), palms.length);
    palms.forEach(([x, z], k) => {
      trunk.setMatrixAt(k, m.compose(p.set(x, 3.5, z), q, s));
      leaves.setMatrixAt(k, m.compose(p.set(x, 7.2, z), q, s));
    });
    trunk.castShadow = leaves.castShadow = true;
    this.scene.add(trunk, leaves);
  }

  placeJobsAndPackages() {
    const rng = mulberry32(7741);
    const { N, PITCH, HALF } = CITY;
    const spot = (i, j, d, type, name) => {
      const p = this.lanePoint(i, j, d, PITCH / 2);
      this.jobSpots.push({ type, name, x: p.x, z: p.z, h: p.h });
    };
    spot(2, 3, 0, 'taxi', 'Taxi rank');
    spot(5, 5, 1, 'taxi', 'Taxi rank');
    spot(1, 0, 0, 'delivery', 'Dockside depot');
    spot(6, 1, 1, 'delivery', 'Freight yard');
    spot(0, 6, 3, 'race', 'Street race');
    spot(4, 7, 0, 'race', 'Beach sprint');

    // Hidden packages tucked between buildings and in parks.
    let tries = 0;
    while (this.packages.length < 20 && tries++ < 2000) {
      const k = Math.floor(rng() * N * N), b = this.info[k];
      if (OPEN_DISTRICTS.has(b.district) && rng() < 0.7) continue;
      const x = b.x0 + 3 + rng() * (CITY.BLOCK - 6), z = b.z0 + 3 + rng() * (CITY.BLOCK - 6);
      const inside = this.buildingRects[k].concat(this.extraRects[k]).some((r) => x > r.x0 - 1.5 && x < r.x1 + 1.5 && z > r.z0 - 1.5 && z < r.z1 + 1.5);
      if (inside || this.packages.some((p) => Math.hypot(p.x - x, p.z - z) < 40)) continue;
      this.packages.push({ x, z, y: this.blocks[k] ? CITY.CURB : 0 });
    }
    void HALF;
  }

  setNight(f) {
    this.buildingMat.emissiveIntensity = f * 0.95;
    this.lampHeadMat.color.setRGB(0.54 + f * 0.46, 0.56 + f * 0.36, 0.59 + f * 0.1);
  }

  updateLights(t) {
    const { lampMesh, lampColors } = this;
    let dirty = false;
    this.poles.forEach((pl, k) => {
      const st = lightState(pl.node, pl.axis, t);
      if (st === pl.state) return;
      pl.state = st;
      lampMesh.setColorAt(k * 3, st === 'red' ? lampColors.red : lampColors.off);
      lampMesh.setColorAt(k * 3 + 1, st === 'yellow' ? lampColors.yellow : lampColors.off);
      lampMesh.setColorAt(k * 3 + 2, st === 'green' ? lampColors.green : lampColors.off);
      dirty = true;
    });
    if (dirty) lampMesh.instanceColor.needsUpdate = true;
  }
}
