'use strict';

const TRAFFIC_COLORS = [0xf2f2ef, 0x2f3338, 0x8a9199, 0x1f4e8c, 0x6d1f2a, 0x3c6e47, 0xd9d2c0, 0x15171a];
// Where a car's centre waits so its nose sits on the stop line.
const WAIT_DIST = STOP_LINE + 0.6 + CAR.LENGTH / 2;

const segKey = (i, j, d) => `${i},${j},${d}`;

function randomTrafficKind() {
  const r = Math.random();
  const type = r < 0.04 ? 'police' : r < 0.19 ? 'taxi' : r < 0.31 ? 'van' : r < 0.36 ? 'sports' : 'sedan';
  return { type, colorIdx: Math.floor(Math.random() * TRAFFIC_COLORS.length) };
}

function trafficColor(type, colorIdx) { return type === 'taxi' ? TAXI_YELLOW : TRAFFIC_COLORS[colorIdx]; }

class TrafficCar {
  constructor(scene, kind = randomTrafficKind()) {
    this.scene = scene;
    this.setKind(kind.type, kind.colorIdx);
    this.cruise = 9 + Math.random() * 4;
    this.v = 0;
    this.stun = 0;
    this.ghost = 0;
    this.blockedFor = 0;
    this.honked = false;
  }

  setKind(type, colorIdx) {
    const shown = this.parts ? this.parts.group.visible : true;
    if (this.parts) this.scene.remove(this.parts.group);
    this.type = type;
    this.colorIdx = colorIdx;
    this.color = trafficColor(type, colorIdx);
    this.spec = VEHICLES[type];
    this.L = this.spec.L;
    this.W = this.spec.W;
    this.isPolice = type === 'police';
    this.parts = buildCarMesh(type, this.color);
    this.parts.group.visible = shown;
    this.scene.add(this.parts.group);
  }

  remove(scene) { scene.remove(this.parts.group); }

  onHit() {
    this.stun = 2.2;
    this.v = 0;
    if (!this.honked) { this.honked = true; Sound.horn(0.25, 330); }
  }

  enterRoad(traffic, i, j, d, s) {
    Object.assign(this, { i, j, d, s, phase: 'road' });
    this.nextDir = traffic.chooseExit(i + DIRS[d].x, j + DIRS[d].z, d);
    this.pose(traffic.world);
  }

  pose(world) {
    if (this.phase === 'road') {
      const p = world.lanePoint(this.i, this.j, this.d, this.s);
      this.x = p.x; this.z = p.z; this.h = p.h;
    } else {
      const { E, C, X } = this.curve, t = this.t, u = 1 - t;
      this.x = u * u * E.x + 2 * u * t * C.x + t * t * X.x;
      this.z = u * u * E.z + 2 * u * t * C.z + t * t * X.z;
      const dx = 2 * u * (C.x - E.x) + 2 * t * (X.x - C.x), dz = 2 * u * (C.z - E.z) + 2 * t * (X.z - C.z);
      if (dx * dx + dz * dz > 1e-6) this.h = Math.atan2(dx, dz);
    }
  }

  // Quadratic curve through the junction from this lane into the exit lane.
  startTurn(world) {
    const { HALF, LANE } = CITY;
    const ni = this.i + DIRS[this.d].x, nj = this.j + DIRS[this.d].z;
    const n = world.node(ni, nj), d1 = DIRS[this.d], r1 = rightOf(this.d), d2 = DIRS[this.nextDir], r2 = rightOf(this.nextDir);
    const E = { x: this.x, z: this.z };
    const X = { x: n.x + d2.x * HALF + r2.x * LANE, z: n.z + d2.z * HALF + r2.z * LANE };
    let C;
    if (this.nextDir === this.d) C = { x: (E.x + X.x) / 2, z: (E.z + X.z) / 2 };
    else if (this.nextDir === reverseDir(this.d)) C = { x: n.x + d1.x * 4, z: n.z + d1.z * 4 };
    else {
      // Left turns sweep wider so opposing left-turners pass each other cleanly.
      const k = this.nextDir === (this.d + 3) % 4 ? 1.6 : 1;
      C = { x: n.x + (r1.x + r2.x) * LANE * k, z: n.z + (r1.z + r2.z) * LANE * k };
    }
    this.curve = { E, C, X, len: (Math.hypot(C.x - E.x, C.z - E.z) + Math.hypot(X.x - C.x, X.z - C.z) + Math.hypot(X.x - E.x, X.z - E.z)) / 2 };
    this.phase = 'turn';
    this.t = 0;
    this.ti = ni; this.tj = nj;
  }
}

class Traffic {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.cars = [];
    this.blocked = new Set();
    this.recycleTimer = 0;
  }

  chooseExit(i, j, from) {
    const opts = [];
    for (let d = 0; d < 4; d++) {
      if (d === reverseDir(from) || !this.world.hasRoad(i, j, d) || this.blocked.has(segKey(i, j, d))) continue;
      opts.push(d, d);
      if (d === from) opts.push(d); // slight preference for going straight
    }
    return opts.length ? opts[Math.floor(Math.random() * opts.length)] : reverseDir(from);
  }

  // Drop a car onto a free lane spot, optionally within a distance band of focus.
  place(car, focus, minD = 0, maxD = Infinity) {
    const { HALF, BLOCK } = CITY;
    for (let tries = 0; tries < 60; tries++) {
      const p = this.world.randomLanePoint();
      if (this.blocked.has(segKey(p.i, p.j, p.d))) continue;
      const s = HALF + 2 + Math.random() * (BLOCK - WAIT_DIST - 4);
      const q = this.world.lanePoint(p.i, p.j, p.d, s);
      if (focus) {
        const d = Math.hypot(q.x - focus.x, q.z - focus.z);
        if ((d < minD || d > maxD) && tries < 59) continue;
      }
      if (this.cars.some((c) => c !== car && Math.hypot(c.x - q.x, c.z - q.z) < 12) && tries < 59) continue;
      car.enterRoad(this, p.i, p.j, p.d, s);
      car.v = car.cruise * 0.7;
      car.stun = 0;
      return true;
    }
    return false;
  }

  reset(count, avoid) {
    this.clear();
    for (let k = 0; k < count; k++) {
      const car = new TrafficCar(this.scene);
      this.cars.push(car);
      if (!this.place(car, avoid, 30)) { car.remove(this.scene); this.cars.pop(); }
    }
  }

  // The player took this car: it vanishes from traffic and a new one appears far away.
  take(car, focus) {
    const info = { type: car.type, color: car.color, x: car.x, z: car.z, h: car.h, v: car.v };
    car.setKind(randomTrafficKind().type, Math.floor(Math.random() * TRAFFIC_COLORS.length));
    this.place(car, focus, 120, 260);
    return info;
  }

  // Keep traffic where the players are: cars far from everyone reappear nearby.
  recycle(dt, focus) {
    this.recycleTimer -= dt;
    if (this.recycleTimer > 0 || !focus.length) return;
    this.recycleTimer = 1;
    for (const c of this.cars) {
      const near = focus.some((f) => Math.hypot(c.x - f.x, c.z - f.z) < 230);
      if (!near) this.place(c, focus[Math.floor(Math.random() * focus.length)], 90, 200);
    }
  }

  // obstacles: everything else traffic should stop for (players, parked cars, people in the road).
  update(dt, t, obstacles = []) {
    const world = this.world;
    const others = this.cars.concat(obstacles);
    const { PITCH, HALF } = CITY;
    const stopS = PITCH - WAIT_DIST;

    for (const c of this.cars) {
      let target = c.cruise, reason = '';
      if (c.stun > 0) { c.stun -= dt; target = 0; }
      if (c.stun <= 0) c.honked = false;

      if (c.phase === 'road' && c.s < stopS + 0.6) {
        const n = world.node(c.i + DIRS[c.d].x, c.j + DIRS[c.d].z);
        const st = lightState(n, axisOf(c.d), t);
        const gap = stopS - c.s;
        if (st === 'red' || (st === 'yellow' && gap > (c.v * c.v) / 12 - 0.5)) {
          target = Math.min(target, Math.sqrt(2 * 4.5 * Math.max(0, gap)));
          if (target < 0.5) reason = 'light';
        }
      }
      if (c.phase === 'turn' && c.nextDir !== c.d) target = Math.min(target, 7);

      // Keep a gap to whatever is ahead in this lane.
      const fx = Math.sin(c.h), fz = Math.cos(c.h);
      let gapAhead = Infinity;
      for (const o of others) {
        if (o === c || (c.ghost > 0 && !o.isPlayer)) continue;
        const dx = o.x - c.x, dz = o.z - c.z;
        const ahead = dx * fx + dz * fz;
        if (ahead <= 0 || ahead > 18) continue;
        if (Math.abs(dx * -fz + dz * fx) > (ahead < 8 ? 2.8 : 2.3)) continue;
        gapAhead = Math.min(gapAhead, ahead - c.L / 2 - (o.L || 4.3) / 2 - 0.5);
      }
      if (gapAhead < Infinity) {
        const vf = Math.max(0, (gapAhead - 1.2) * 1.3);
        if (vf < target) { target = vf; if (vf < 0.5 && !reason) reason = 'car'; }
      }

      // Break rare gridlocks inside junctions by letting a stuck car squeeze
      // through. Queues on the road are normal and never trigger this.
      c.ghost = Math.max(0, c.ghost - dt);
      if (reason === 'car' && c.stun <= 0 && c.phase === 'turn') {
        c.blockedFor += dt;
        if (c.blockedFor > 6) { c.ghost = 2.5; c.blockedFor = 0; }
      } else c.blockedFor = 0;

      const prev = c.v;
      c.v += clamp(target - c.v, -9 * dt, 3 * dt);
      c.braking = c.v < prev - 0.01 || c.v < 0.3;
      c.parts.tailMat.emissiveIntensity = c.braking ? 1.3 : 0.25;

      if (c.phase === 'road') {
        c.s += c.v * dt;
        if (c.s >= PITCH - HALF) { c.pose(world); c.startTurn(world); }
      } else {
        c.t += (c.v * dt) / c.curve.len;
        if (c.t >= 1) c.enterRoad(this, c.ti, c.tj, c.nextDir, HALF);
      }
      c.pose(world);
      const g = c.parts.group;
      g.position.set(c.x, 0, c.z);
      g.rotation.y = c.h;
      for (const s of c.parts.spinners) s.rotation.x += (c.v * dt) / 0.36;
      if (c.isPolice) flashBar(c.parts, t, false);
    }
  }

  // ---------- Multiplayer: the host simulates, everyone else mirrors ----------
  // Six numbers per car: x, z, heading, speed, brake light, kind (type * 10 + colour).

  snapshot() {
    const out = [];
    const r = (v, k) => Math.round(v * k) / k;
    for (const c of this.cars) out.push(r(c.x, 100), r(c.z, 100), r(c.h, 1000), r(c.v, 100), c.braking ? 1 : 0, VEHICLE_IDS.indexOf(c.type) * 10 + c.colorIdx);
    return out;
  }

  applySnapshot(data) {
    const count = Math.floor(data.length / 6);
    while (this.cars.length > count) this.cars.pop().remove(this.scene);
    while (this.cars.length < count) {
      const k = this.cars.length, car = new TrafficCar(this.scene);
      car.onHit = () => { Sound.horn(0.25, 330); if (this.onPuppetHit) this.onPuppetHit(k); };
      this.cars.push(car);
    }
    this.cars.forEach((c, k) => {
      const o = k * 6, kind = data[o + 5];
      const type = VEHICLE_IDS[Math.floor(kind / 10)] || 'sedan', colorIdx = kind % 10;
      if (type !== c.type || colorIdx !== c.colorIdx) c.setKind(type, colorIdx);
      if (setSnap(c, data[o], data[o + 1], data[o + 2], data[o + 3]) && c.taken) {
        c.taken = false;
        c.noCollide = false;
        c.parts.group.visible = true;
      }
      c.braking = data[o + 4] === 1;
    });
  }

  // On a client, hide a car the moment you take it; the host moves it away.
  hidePuppet(c) {
    c.taken = true;
    c.noCollide = true;
    c.parts.group.visible = false;
  }

  updatePuppets(dt) {
    for (const c of this.cars) {
      followSnap(c, dt);
      c.parts.tailMat.emissiveIntensity = c.braking ? 1.3 : 0.25;
    }
  }

  clear() {
    for (const c of this.cars) c.remove(this.scene);
    this.cars = [];
  }
}

// Network-driven cars glide towards where their latest update says they are
// now (last position plus speed × time since), so 10 updates a second look smooth.
// Returns true when the update was a jump (first update, or a teleport).
function setSnap(o, x, z, h, v, y = 0) {
  const fresh = !o.snap || Math.hypot(x - o.x, z - o.z) > 15;
  o.snap = { x, z, h, v, y, at: performance.now() / 1000 };
  if (fresh) { o.x = x; o.z = z; o.h = h; o.y = y; }
  return fresh;
}

function followSnap(o, dt) {
  const s = o.snap;
  if (!s) return;
  const age = Math.min(0.5, performance.now() / 1000 - s.at);
  const px = s.x + Math.sin(s.h) * s.v * age, pz = s.z + Math.cos(s.h) * s.v * age;
  const k = 1 - Math.exp(-dt * 12);
  o.x += (px - o.x) * k;
  o.z += (pz - o.z) * k;
  o.y = (o.y || 0) + ((s.y || 0) - (o.y || 0)) * k;
  o.h += wrapAngle(s.h - o.h) * k;
  o.v = s.v;
  const g = o.parts.group;
  g.position.set(o.x, o.y, o.z);
  g.rotation.y = o.h;
  for (const w of o.parts.spinners) w.rotation.x += (o.v * dt) / 0.36;
}
