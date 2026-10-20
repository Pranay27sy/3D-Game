'use strict';

// City layout: an N x N grid of blocks separated by two-way roads, one lane
// each way. Traffic drives on the right. One world unit is one metre.
const CITY = (() => {
  const N = 5, BLOCK = 60, ROAD = 12;
  return { N, BLOCK, ROAD, HALF: ROAD / 2, LANE: 3, PITCH: BLOCK + ROAD, SIZE: N * (BLOCK + ROAD) };
})();

// Directions: 0 = +x (east), 1 = +z (south), 2 = -x (west), 3 = -z (north).
const DIRS = [{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 }];
const axisOf = (d) => d % 2;
const reverseDir = (d) => (d + 2) % 4;
const rightOf = (d) => ({ x: -DIRS[d].z, z: DIRS[d].x });
const headingOf = (d) => Math.atan2(DIRS[d].x, DIRS[d].z);

// Distance from a junction centre to the stop line on each approach.
const STOP_LINE = CITY.HALF + 4;

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

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
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
    this.blocks = [];
    this.poles = [];

    this.buildGround();
    this.buildMarkings();
    this.buildBlocks();
    this.buildLights();
    this.buildBarriers();
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

  // Curb rectangles a circle at (x, z) might touch, plus the city edge.
  rectsNear(x, z) {
    const { N, PITCH } = CITY;
    const out = this.bounds.slice();
    const i0 = clamp(Math.floor((x - 3) / PITCH), 0, N - 1), i1 = clamp(Math.floor((x + 3) / PITCH), 0, N - 1);
    const j0 = clamp(Math.floor((z - 3) / PITCH), 0, N - 1), j1 = clamp(Math.floor((z + 3) / PITCH), 0, N - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) out.push(this.blocks[i + j * N]);
    return out;
  }

  junctionAt(x, z) {
    const i = Math.round(x / CITY.PITCH), j = Math.round(z / CITY.PITCH);
    if (i < 0 || j < 0 || i > CITY.N || j > CITY.N) return null;
    const n = this.node(i, j);
    return Math.abs(x - n.x) < CITY.HALF && Math.abs(z - n.z) < CITY.HALF ? n : null;
  }

  buildGround() {
    const { SIZE, HALF } = CITY;
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x7fa35a, roughness: 1 })
    );
    grass.position.set(SIZE / 2, -0.05, SIZE / 2);
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
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(span, span).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.95 })
    );
    road.position.set(SIZE / 2, 0, SIZE / 2);
    road.receiveShadow = true;
    this.scene.add(road);
  }

  buildMarkings() {
    const { N, PITCH, HALF, BLOCK } = CITY;
    const white = [], yellow = [];
    const rect = (list, cx, cz, ex, ez) => list.push([cx, cz, ex, ez]);

    // Double yellow centre line on every road segment.
    for (let j = 0; j <= N; j++)
      for (let i = 0; i < N; i++) {
        const cx = (i + 0.5) * PITCH, len = BLOCK - 9;
        rect(yellow, cx, j * PITCH - 0.18, len, 0.14);
        rect(yellow, cx, j * PITCH + 0.18, len, 0.14);
        rect(yellow, j * PITCH - 0.18, cx, 0.14, len);
        rect(yellow, j * PITCH + 0.18, cx, 0.14, len);
      }

    // Crosswalk and stop line on every road end at every junction.
    for (const n of this.nodes)
      for (let d = 0; d < 4; d++) {
        if (!this.hasRoad(n.i, n.j, d)) continue;
        const D = DIRS[d], alongX = D.x !== 0;
        const cx = n.x + D.x * (HALF + 2), cz = n.z + D.z * (HALF + 2);
        for (let k = -HALF + 0.9; k < HALF - 0.5; k += 1.3) {
          if (alongX) rect(white, cx, cz + k, 3, 0.65);
          else rect(white, cx + k, cz, 0.65, 3);
        }
        // Traffic heading back into this junction drives in direction reverse(d).
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
      list.forEach(([x, z, ex, ez], k) => {
        mesh.setMatrixAt(k, m.compose(p.set(x, y, z), q, s.set(ex, 1, ez)));
      });
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    };
    make(white, 0xeeeeea, 0.02);
    make(yellow, 0xf2c230, 0.02);
  }

  buildBlocks() {
    const { N, PITCH, HALF, BLOCK, SIZE } = CITY;
    const rng = this.rng;
    const windowTex = canvasTexture(64, (g) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#4f5d6c'; g.fillRect(9, 12, 46, 34);
      g.fillStyle = '#7c8ea0'; g.fillRect(9, 12, 46, 7);
      g.fillStyle = '#d9d9d9'; g.fillRect(0, 56, 64, 8);
    });
    const palette = [0xd8cfc0, 0xbfc7cf, 0xe6dcc8, 0x9fb1bf, 0xc9a98e, 0xa7b59d, 0xe0e2dc, 0x8f9aa6];
    const wallMats = palette.map((c) => new THREE.MeshStandardMaterial({ color: c, map: windowTex, roughness: 0.85 }));
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x6e7177, roughness: 0.9 });
    const slabMat = new THREE.MeshStandardMaterial({ color: 0xb8b3a8, roughness: 0.95 });
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x6f9b4c, roughness: 1 });
    const slabGeo = new THREE.BoxGeometry(BLOCK, 0.3, BLOCK);
    const trees = [];

    const parks = new Set([`2,2`, `${Math.floor(rng() * N)},${Math.floor(rng() * N)}`]);

    for (let bj = 0; bj < N; bj++)
      for (let bi = 0; bi < N; bi++) {
        const x0 = bi * PITCH + HALF, z0 = bj * PITCH + HALF;
        this.blocks.push({ x0, x1: x0 + BLOCK, z0, z1: z0 + BLOCK });
        const slab = new THREE.Mesh(slabGeo, slabMat);
        slab.position.set(x0 + BLOCK / 2, 0.15, z0 + BLOCK / 2);
        slab.receiveShadow = true;
        this.scene.add(slab);

        if (parks.has(`${bi},${bj}`)) {
          const lawn = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK - 6, BLOCK - 6).rotateX(-Math.PI / 2), grassMat);
          lawn.position.set(x0 + BLOCK / 2, 0.31, z0 + BLOCK / 2);
          lawn.receiveShadow = true;
          this.scene.add(lawn);
          for (let k = 0; k < 14; k++) trees.push([x0 + 6 + rng() * (BLOCK - 12), z0 + 6 + rng() * (BLOCK - 12), 0.8 + rng() * 0.6]);
          continue;
        }

        // Street trees along the sidewalk, clear of the corners.
        for (const t of [14, 30, 46]) {
          trees.push([x0 + t, z0 + 1.6, 0.7], [x0 + t, z0 + BLOCK - 1.6, 0.7]);
          trees.push([x0 + 1.6, z0 + t, 0.7], [x0 + BLOCK - 1.6, z0 + t, 0.7]);
        }

        // Four lots per block; taller towers towards the middle of town.
        const centre = Math.hypot(x0 + BLOCK / 2 - SIZE / 2, z0 + BLOCK / 2 - SIZE / 2) / (SIZE * 0.7);
        for (let lj = 0; lj < 2; lj++)
          for (let li = 0; li < 2; li++) {
            const w = 18 + rng() * 7, d = 18 + rng() * 7;
            const h = 9 + (1 - centre) * 30 * rng() + rng() * 12;
            const cx = x0 + 4 + li * 26 + 13 + (rng() - 0.5) * (25 - w);
            const cz = z0 + 4 + lj * 26 + 13 + (rng() - 0.5) * (25 - d);
            const geo = new THREE.BoxGeometry(w, h, d);
            const uv = geo.attributes.uv;
            for (let f = 0; f < 6; f++)
              for (let v = 0; v < 4; v++) {
                const k = f * 4 + v;
                if (f === 2 || f === 3) { uv.setXY(k, 0, 0); continue; }
                const across = f < 2 ? d : w;
                uv.setXY(k, uv.getX(k) * Math.round(across / 4), uv.getY(k) * Math.max(1, Math.round(h / 3.6)));
              }
            const wall = wallMats[Math.floor(rng() * wallMats.length)];
            const b = new THREE.Mesh(geo, [wall, wall, roofMat, roofMat, wall, wall]);
            b.position.set(cx, 0.3 + h / 2, cz);
            b.castShadow = b.receiveShadow = true;
            this.scene.add(b);
          }
      }

    const trunk = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.18, 0.24, 2.2, 6),
      new THREE.MeshStandardMaterial({ color: 0x6b4b32, roughness: 1 }),
      trees.length
    );
    const crown = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1.6, 0),
      new THREE.MeshStandardMaterial({ color: 0x3f7d3a, roughness: 1, flatShading: true }),
      trees.length
    );
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    trees.forEach(([x, z, k], n) => {
      trunk.setMatrixAt(n, m.compose(p.set(x, 0.3 + 1.1 * k, z), q, s.set(k, k, k)));
      crown.setMatrixAt(n, m.compose(p.set(x, 0.3 + 3 * k, z), q, s.set(k, k * 1.2, k)));
    });
    crown.castShadow = trunk.castShadow = true;
    this.scene.add(trunk, crown);
  }

  buildLights() {
    const { HALF } = CITY;
    const off = HALF + 1.2;
    for (const n of this.nodes)
      for (let d = 0; d < 4; d++) {
        // A pole for traffic arriving in direction d, on its near-right corner.
        if (!this.hasRoad(n.i, n.j, reverseDir(d))) continue;
        const D = DIRS[d], r = rightOf(d);
        this.poles.push({ node: n, axis: axisOf(d), d, x: n.x - D.x * off + r.x * off, z: n.z - D.z * off + r.z * off, state: '' });
      }

    const count = this.poles.length;
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.11, 4.6, 6), new THREE.MeshStandardMaterial({ color: 0x3b3f45 }), count);
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 1.35, 0.5), new THREE.MeshStandardMaterial({ color: 0x23262a }), count);
    const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), count * 3);
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
