'use strict';

// Shared car geometry and materials. A car's local +z is forward.
const CAR = (() => {
  const wheel = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 14);
  wheel.rotateZ(Math.PI / 2);
  return {
    LENGTH: 4.3,
    WIDTH: 1.86,
    body: new THREE.BoxGeometry(1.86, 0.62, 4.3),
    cabin: new THREE.BoxGeometry(1.62, 0.58, 2.15),
    roof: new THREE.BoxGeometry(1.64, 0.07, 1.95),
    bumper: new THREE.BoxGeometry(1.9, 0.22, 4.42),
    lamp: new THREE.BoxGeometry(0.42, 0.16, 0.06),
    sign: new THREE.BoxGeometry(0.62, 0.24, 0.26),
    wheel,
    glass: new THREE.MeshStandardMaterial({ color: 0x1f2a35, roughness: 0.15, metalness: 0.6 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.8 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.95 }),
    headlight: new THREE.MeshBasicMaterial({ color: 0xfff4d6 }),
    signMat: new THREE.MeshBasicMaterial({ color: 0xfff1b0 }),
    paints: new Map(),
  };
})();

function paintMaterial(color) {
  if (!CAR.paints.has(color)) CAR.paints.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.25 }));
  return CAR.paints.get(color);
}

function buildCarMesh(color, { taxi = false } = {}) {
  const group = new THREE.Group();
  const paint = paintMaterial(color);
  const add = (geo, mat, x, y, z, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    group.add(m);
    return m;
  };
  const body = add(CAR.body, paint, 0, 0.66, 0);
  add(CAR.bumper, CAR.trim, 0, 0.42, 0, false);
  add(CAR.cabin, CAR.glass, 0, 1.26, -0.25);
  add(CAR.roof, paint, 0, 1.58, -0.25);
  add(CAR.lamp, CAR.headlight, 0.58, 0.74, 2.16, false);
  add(CAR.lamp, CAR.headlight, -0.58, 0.74, 2.16, false);
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x5a0a0a, emissive: 0xff2a2a, emissiveIntensity: 0.25 });
  add(CAR.lamp, tailMat, 0.62, 0.78, -2.16, false);
  add(CAR.lamp, tailMat, -0.62, 0.78, -2.16, false);
  if (taxi) add(CAR.sign, CAR.signMat, 0, 1.74, -0.25, false);

  const front = [], spinners = [];
  for (const [x, z] of [[0.86, 1.38], [-0.86, 1.38], [0.86, -1.38], [-0.86, -1.38]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.36, z);
    const spin = new THREE.Group();
    const tyre = new THREE.Mesh(CAR.wheel, CAR.tyre);
    tyre.castShadow = true;
    spin.add(tyre);
    pivot.add(spin);
    group.add(pivot);
    spinners.push(spin);
    if (z > 0) front.push(pivot);
  }
  return { group, body, front, spinners, tailMat };
}

// Arcade bicycle-model physics for the player's car.
const PHYS = {
  WHEELBASE: 2.6,
  ACCEL_D: 6.5, VMAX_D: 33,      // 33 m/s ≈ 119 km/h
  ACCEL_R: 3.5, VMAX_R: 7,
  BRAKE: 13, ROLL: 0.35, DRAG: 0.004, ENGINE_BRAKE: 0.5,
  MAX_STEER: 0.6,
};
const PLAYER_CIRCLES = [-1.45, 0, 1.45];
const PLAYER_RADIUS = 0.95;
const NPC_CIRCLES = [-1.2, 1.2];
const NPC_RADIUS = 1.05;

class PlayerCar {
  constructor(scene, color) {
    this.scene = scene;
    this.setColor(color);
    this.reset(0, 0, 0);
  }

  setColor(color) {
    if (this.parts) this.scene.remove(this.parts.group);
    this.parts = buildCarMesh(color);
    this.scene.add(this.parts.group);
    if (this.x !== undefined) this.syncMesh(0);
  }

  reset(x, z, h) {
    Object.assign(this, { x, z, h, v: 0, steer: 0, gear: 'D', damage: 0, fuel: 100, fuelUsed: 0, odometer: 0, hitCooldown: 0, brakeLight: 0, throttle: 0 });
    this.unlimitedFuel = false;
    this.events = [];
    this.syncMesh(0);
  }

  get forward() { return { x: Math.sin(this.h), z: Math.cos(this.h) }; }

  shift() {
    if (Math.abs(this.v) > 1.5) return false;
    this.gear = this.gear === 'D' ? 'R' : 'D';
    return true;
  }

  update(dt, input, world, others) {
    this.steer = input.steer;
    const delta = this.steer * PHYS.MAX_STEER / (1 + Math.abs(this.v) / 22);
    const throttle = this.fuel > 0 ? input.throttle : 0;
    this.throttle = throttle;
    const dir = this.gear === 'D' ? 1 : -1;
    const accel = this.gear === 'D' ? PHYS.ACCEL_D : PHYS.ACCEL_R;
    const vmax = this.gear === 'D' ? PHYS.VMAX_D : PHYS.VMAX_R;

    // Engine pushes in the gear direction, fading out towards top speed.
    if (throttle > 0) this.v += dir * throttle * accel * Math.max(0, 1 - (this.v * dir) / vmax) * dt;
    const resist = input.brake * PHYS.BRAKE + PHYS.ROLL + PHYS.DRAG * this.v * this.v + (throttle > 0 ? 0 : PHYS.ENGINE_BRAKE);
    const dv = resist * dt;
    this.v = Math.abs(this.v) <= dv ? 0 : this.v - Math.sign(this.v) * dv;

    this.h -= (this.v / PHYS.WHEELBASE) * Math.tan(delta) * dt;
    const f = this.forward;
    this.x += f.x * this.v * dt;
    this.z += f.z * this.v * dt;
    this.odometer += Math.abs(this.v) * dt;

    if (!this.unlimitedFuel) {
      const burn = (0.04 + throttle * (0.35 + 0.0011 * this.v * this.v)) * dt;
      this.fuel = Math.max(0, this.fuel - burn);
      this.fuelUsed += burn;
    }

    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    this.collideWorld(world);
    this.collideCars(others);

    this.brakeLight = input.brake > 0.05 || this.gear === 'R' ? 1 : 0;
    this.syncMesh(dt, delta);
  }

  // Shared response for any impact: lose speed, maybe take damage.
  impact(nx, nz, closing, what, other) {
    const f = this.forward;
    const facing = Math.abs(f.x * nx + f.z * nz);
    this.v = facing > 0.7 ? -this.v * 0.15 : this.v * (1 - 0.75 * facing);
    if (closing > 2 && this.hitCooldown <= 0) {
      const dmg = Math.min(60, closing * 2.4);
      this.damage = Math.min(100, this.damage + dmg);
      this.hitCooldown = 0.6;
      this.events.push({ type: 'crash', what, closing, dmg, other });
    }
  }

  collideWorld(world) {
    let hit = null;
    for (const off of PLAYER_CIRCLES) {
      for (const R of world.rectsNear(this.x, this.z)) {
        const f = this.forward;
        const cx = this.x + f.x * off, cz = this.z + f.z * off;
        const px = clamp(cx, R.x0, R.x1), pz = clamp(cz, R.z0, R.z1);
        const dx = cx - px, dz = cz - pz, d2 = dx * dx + dz * dz;
        if (d2 >= PLAYER_RADIUS * PLAYER_RADIUS) continue;
        let nx, nz, pen;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          nx = dx / d; nz = dz / d; pen = PLAYER_RADIUS - d;
        } else {
          // Centre is inside the rectangle: leave by the nearest side.
          const opts = [[cx - R.x0, -1, 0], [R.x1 - cx, 1, 0], [cz - R.z0, 0, -1], [R.z1 - cz, 0, 1]].sort((a, b) => a[0] - b[0]);
          [pen, nx, nz] = opts[0];
          pen += PLAYER_RADIUS;
        }
        this.x += nx * pen;
        this.z += nz * pen;
        hit = { nx, nz };
      }
    }
    if (hit) {
      const f = this.forward;
      const closing = -(f.x * this.v * hit.nx + f.z * this.v * hit.nz);
      this.impact(hit.nx, hit.nz, closing, 'wall');
    }
  }

  collideCars(others) {
    for (const o of others) {
      const ddx = this.x - o.x, ddz = this.z - o.z;
      if (ddx * ddx + ddz * ddz > 64) continue;
      const of = { x: Math.sin(o.h), z: Math.cos(o.h) };
      let hit = null;
      for (const a of PLAYER_CIRCLES)
        for (const b of NPC_CIRCLES) {
          const f = this.forward;
          const ax = this.x + f.x * a, az = this.z + f.z * a;
          const bx = o.x + of.x * b, bz = o.z + of.z * b;
          const dx = ax - bx, dz = az - bz, d = Math.hypot(dx, dz), min = PLAYER_RADIUS + NPC_RADIUS;
          if (d >= min || d < 1e-6) continue;
          const nx = dx / d, nz = dz / d;
          this.x += nx * (min - d);
          this.z += nz * (min - d);
          hit = { nx, nz };
        }
      if (!hit) continue;
      const f = this.forward;
      const rvx = f.x * this.v - of.x * o.v, rvz = f.z * this.v - of.z * o.v;
      const closing = -(rvx * hit.nx + rvz * hit.nz);
      this.impact(hit.nx, hit.nz, closing, 'car', o);
      if (o.onHit) o.onHit();
    }
  }

  syncMesh(dt, delta = 0) {
    const p = this.parts;
    p.group.position.set(this.x, 0, this.z);
    p.group.rotation.y = this.h;
    for (const w of p.front) w.rotation.y = -delta;
    for (const s of p.spinners) s.rotation.x += (this.v * dt) / 0.36;
    p.tailMat.emissiveIntensity = this.brakeLight ? 1.4 : 0.25;
  }
}
