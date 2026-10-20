'use strict';

// Pedestrians: they walk around blocks on the sidewalk, cross at crosswalks
// when the cars on that road have a red light, jump out of the way of fast
// cars, and get knocked over (then get up and run) when they don't make it.
const PED_WALK = 1.35;

class Ped {
  constructor(scene) {
    this.parts = buildPerson(randomLook());
    scene.add(this.parts.group);
    Object.assign(this, { x: 0, z: 0, h: 0, y: CITY.CURB, v: 0, L: 0.6, W: 0.6, phase: Math.random() * 6, state: 'walk', timer: 0, sx: 0, sz: 0 });
    this.speed = PED_WALK * (0.8 + Math.random() * 0.4);
    // About two in three people notice a car coming in time to jump clear.
    this.alert = Math.random() < 0.65;
  }
  remove(scene) { scene.remove(this.parts.group); }
}

class Peds {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.list = [];
    this.onHit = null;   // (ped, vehicle, speed) when a car hits someone
    this.recycleTimer = 0;
  }

  clear() {
    for (const p of this.list) p.remove(this.scene);
    this.list = [];
  }

  reset(count, focus) {
    this.clear();
    for (let n = 0; n < count; n++) {
      const p = new Ped(this.scene);
      this.place(p, focus, 0, 160);
      this.list.push(p);
    }
  }

  // Put someone on a random sidewalk between minD and maxD metres from focus.
  place(p, focus, minD, maxD) {
    const w = this.world, L = CITY.BLOCK - SIDEWALK_INSET * 2;
    // Only blocks roughly in range: the map is far too long to pick at random.
    const near = focus ? w.sidewalkBlocks.filter((k) => { const b = w.info[k]; const d = Math.hypot(b.x0 + 30 - focus.x, b.z0 + 30 - focus.z); return d > minD - 45 && d < maxD + 45; }) : w.sidewalkBlocks;
    if (!near.length) return;
    for (let t = 0; t < 40; t++) {
      const k = near[Math.floor(Math.random() * near.length)];
      const pos = Math.random() * L * 4;
      const pt = w.sidewalkPoint(k, pos);
      const d = focus ? Math.hypot(pt.x - focus.x, pt.z - focus.z) : 0;
      if (focus && (d < minD || d > maxD) && t < 39) continue;
      Object.assign(p, { k, p: pos, dir: Math.random() < 0.5 ? 1 : -1, state: 'walk', x: pt.x, z: pt.z, y: CITY.CURB });
      return;
    }
  }

  // The driver of a car you take: they climb out and run for the sidewalk.
  spawnDriver(x, z, h) {
    let p = this.list.find((q) => q.state === 'walk' && q.far);
    if (!p) { p = new Ped(this.scene); this.list.push(p); }
    const k = this.world.nearestSidewalkBlock(x, z);
    // In India the driver sits on the right, so they climb out on the right.
    const r = { x: -Math.cos(h), z: Math.sin(h) };
    Object.assign(p, { x: x + r.x * 1.4, z: z + r.z * 1.4, y: 0, state: 'go', timer: 6, speed: 4.5 });
    if (k >= 0) { p.k = k; p.p = this.world.sidewalkParam(k, p.x, p.z); const t = this.world.sidewalkPoint(k, p.p); p.tx = t.x; p.tz = t.z; }
    else { p.tx = p.x + r.x * 8; p.tz = p.z + r.z * 8; }
    return p;
  }

  // Something scary happened at (x, z): everyone nearby runs.
  scare(x, z, radius) {
    for (const p of this.list) {
      if (p.state !== 'walk' && p.state !== 'cross') continue;
      if (Math.hypot(p.x - x, p.z - z) < radius) { p.state = 'flee'; p.timer = 5; p.dir = Math.random() < 0.5 ? 1 : -1; }
    }
  }

  update(dt, t, vehicles, focus) {
    const w = this.world, L = CITY.BLOCK - SIDEWALK_INSET * 2;

    // Keep the crowd around the player: anyone far away reappears nearby.
    this.recycleTimer -= dt;
    if (focus && this.recycleTimer <= 0) {
      this.recycleTimer = 1;
      for (const p of this.list) {
        p.far = Math.hypot(p.x - focus.x, p.z - focus.z) > 150;
        if (p.far && p.state === 'walk') this.place(p, focus, 70, 140);
      }
    }

    for (const p of this.list) {
      if (p.state === 'down') {
        p.timer -= dt;
        p.x += p.sx * dt; p.z += p.sz * dt;
        p.sx *= 1 - Math.min(1, dt * 2.5); p.sz *= 1 - Math.min(1, dt * 2.5);
        if (p.timer <= 0) this.rejoin(p, 'flee');
      } else if (p.state === 'dodge') {
        p.timer -= dt;
        p.x += p.sx * dt; p.z += p.sz * dt;
        if (p.timer <= 0) this.rejoin(p, 'walk');
      } else if (p.state === 'go' || p.state === 'cross') {
        const dx = p.tx - p.x, dz = p.tz - p.z, d = Math.hypot(dx, dz);
        const sp = p.state === 'go' ? p.speed : p.speed * 1.2;
        if (d < 0.3) {
          if (p.state === 'cross') { p.k = p.nk; p.p = w.sidewalkParam(p.k, p.x, p.z); p.state = 'walk'; }
          else this.rejoin(p, 'walk');
        } else {
          p.h = Math.atan2(dx, dz);
          p.x += (dx / d) * sp * dt; p.z += (dz / d) * sp * dt;
        }
      } else {
        // Walking or fleeing along the sidewalk loop.
        const run = p.state === 'flee';
        if (run) { p.timer -= dt; if (p.timer <= 0) p.state = 'walk'; }
        const before = p.p;
        p.p += p.dir * (run ? 4.2 : p.speed) * dt;
        const side0 = Math.floor((((before % (L * 4)) + L * 4) % (L * 4)) / L), side1 = Math.floor((((p.p % (L * 4)) + L * 4) % (L * 4)) / L);
        if (side0 !== side1 && !run && Math.random() < 0.45) this.tryCross(p, before, t);
        if (p.state === 'walk' || p.state === 'flee') {
          const pt = w.sidewalkPoint(p.k, p.p);
          p.x = pt.x; p.z = pt.z;
          p.h = pt.h + (p.dir < 0 ? Math.PI : 0);
        }
      }
      p.y = p.state === 'down' ? w.footGroundAt(p.x, p.z) : w.footGroundAt(p.x, p.z);
      p.v = p.state === 'walk' ? p.speed : p.state === 'down' ? 0 : 4;

      // Fast cars: dodge if there's time, otherwise get knocked down.
      if (p.state !== 'down') {
        for (const c of vehicles) {
          const sp = Math.abs(c.v || 0);
          if (sp < 1.5) continue;
          const dx = p.x - c.x, dz = p.z - c.z;
          if (dx * dx + dz * dz > 120) continue;
          const fx = Math.sin(c.h) * Math.sign(c.v), fz = Math.cos(c.h) * Math.sign(c.v);
          const ahead = dx * fx + dz * fz, lat = dx * -fz + dz * fx;
          const hl = (c.L || 4.3) / 2 + 0.25, hw = (c.W || 1.86) / 2 + 0.3;
          if (Math.abs(ahead) < hl && Math.abs(lat) < hw && Math.abs(p.y - (c.y || 0)) < 1.8) {
            if (sp > 3.5) {
              p.state = 'down'; p.timer = 4;
              p.sx = fx * sp * 0.55 + (Math.sign(lat) || 1) * -fz * 2; p.sz = fz * sp * 0.55 + (Math.sign(lat) || 1) * fx * 2;
              Effects.dust(p.x, p.z);
              if (this.onHit) this.onHit(p, c, sp);
            } else {
              p.x += (Math.sign(lat) || 1) * -fz * 0.3; p.z += (Math.sign(lat) || 1) * fx * 0.3;
            }
            break;
          }
          if (sp > 6 && p.alert && ahead > 0 && ahead < 10 && Math.abs(lat) < 1.8 && p.state !== 'dodge') {
            const s = Math.sign(lat) || (Math.random() < 0.5 ? 1 : -1);
            p.state = 'dodge'; p.timer = 0.5;
            p.sx = -fz * s * 6; p.sz = fx * s * 6;
            if (this.onDodge) this.onDodge(p, c);
            break;
          }
        }
      }

      const g = p.parts.group;
      g.position.set(p.x, p.y, p.z);
      g.rotation.y = p.h;
      const moving = p.state !== 'down' && p.state !== 'dodge';
      p.phase += (moving ? (p.state === 'walk' ? p.speed : 4.2) : 0) * dt * 3.3;
      posePerson(p.parts, p.phase, p.state === 'walk' ? 0.45 : p.state === 'dodge' ? 0 : 0.9, p.state === 'down' ? 'down' : p.state === 'dodge' ? 'air' : 'walk');
    }
  }

  // At a corner, keep going straight over the crosswalk if those cars have a red light.
  tryCross(p, before, t) {
    const w = this.world, info = w.info[p.k], { NX, NZ, PITCH } = CITY;
    const corner = w.sidewalkPoint(p.k, p.dir > 0 ? Math.ceil(before / (CITY.BLOCK - SIDEWALK_INSET * 2)) * (CITY.BLOCK - SIDEWALK_INSET * 2) : Math.floor(before / (CITY.BLOCK - SIDEWALK_INSET * 2)) * (CITY.BLOCK - SIDEWALK_INSET * 2));
    const prev = w.sidewalkPoint(p.k, before);
    const heading = prev.h + (p.dir < 0 ? Math.PI : 0);
    const hx = Math.round(Math.sin(heading)), hz = Math.round(Math.cos(heading));
    const ni = info.bi + hx, nj = info.bj + hz;
    if (ni < 0 || nj < 0 || ni >= NX || nj >= NZ) return;
    const nk = ni + nj * NX;
    if (!w.hasSidewalk(nk)) return;
    // The road being crossed carries traffic on the other axis.
    const node = w.node(Math.round(corner.x / PITCH), Math.round(corner.z / PITCH));
    const roadAxis = hx !== 0 ? 1 : 0;
    if (lightState(node, roadAxis, t) !== 'red') return;
    const span = CITY.ROAD + SIDEWALK_INSET * 2;
    Object.assign(p, { state: 'cross', nk, x: corner.x, z: corner.z, tx: corner.x + hx * span, tz: corner.z + hz * span });
  }

  rejoin(p, state) {
    const k = this.world.nearestSidewalkBlock(p.x, p.z);
    if (k < 0) { p.state = state; return; }
    p.k = k;
    p.p = this.world.sidewalkParam(k, p.x, p.z);
    const pt = this.world.sidewalkPoint(k, p.p);
    if (Math.hypot(pt.x - p.x, pt.z - p.z) > 0.8) {
      Object.assign(p, { state: 'go', tx: pt.x, tz: pt.z, speed: state === 'flee' ? 4.2 : p.speed });
      return;
    }
    p.state = state;
    if (state === 'flee') p.timer = 5;
    p.speed = PED_WALK * (0.8 + Math.random() * 0.4);
  }

  // People in the road, for traffic to stop for.
  inRoad() { return this.list.filter((p) => p.state === 'cross' || p.state === 'go' || p.state === 'down'); }
}
