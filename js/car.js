'use strict';

// Vehicle types: size, handling, and price in the garage (police cars can't be bought).
const VEHICLES = {
  sedan:  { name: 'Sedan',          L: 4.3, W: 1.86, accel: 6.5, vmax: 33, steer: 0.6,  brake: 13, toughness: 1,   price: 0 },
  taxi:   { name: 'Taxi',           L: 4.4, W: 1.86, accel: 6.3, vmax: 32, steer: 0.6,  brake: 13, toughness: 1,   price: 900 },
  van:    { name: 'Van',            L: 5.2, W: 2.0,  accel: 4.8, vmax: 27, steer: 0.52, brake: 11, toughness: 1.6, price: 700 },
  sports: { name: 'Sports car',     L: 4.4, W: 1.95, accel: 10,  vmax: 47, steer: 0.64, brake: 16, toughness: 0.8, price: 3000 },
  police: { name: 'Police cruiser', L: 4.6, W: 1.9,  accel: 8.5, vmax: 42, steer: 0.62, brake: 15, toughness: 1.3, price: 0, hidden: true },
};
const VEHICLE_IDS = Object.keys(VEHICLES);
const TAXI_YELLOW = 0xf2b51d;

const CAR = (() => {
  const geos = new Map();
  const box = (w, h, d) => {
    const key = `${w.toFixed(3)},${h.toFixed(3)},${d.toFixed(3)}`;
    if (!geos.has(key)) geos.set(key, new THREE.BoxGeometry(w, h, d));
    return geos.get(key);
  };
  const wheel = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 14);
  wheel.rotateZ(Math.PI / 2);
  return {
    LENGTH: 4.3,
    box,
    wheel,
    glass: new THREE.MeshStandardMaterial({ color: 0x1f2a35, roughness: 0.15, metalness: 0.6 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.8 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.95 }),
    headlight: new THREE.MeshBasicMaterial({ color: 0xfff4d6 }),
    signMat: new THREE.MeshBasicMaterial({ color: 0xfff1b0 }),
    black: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5 }),
    paints: new Map(),
  };
})();

function paintMaterial(color) {
  if (!CAR.paints.has(color)) CAR.paints.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.25 }));
  return CAR.paints.get(color);
}

function buildCarMesh(type, color) {
  if (typeof type === 'number') { color = type; type = 'sedan'; }
  const spec = VEHICLES[type] || VEHICLES.sedan, L = spec.L, W = spec.W, box = CAR.box;
  const group = new THREE.Group();
  const paint = paintMaterial(type === 'police' ? 0xf4f5f2 : color);
  const add = (geo, mat, x, y, z, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    group.add(m);
    return m;
  };
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x5a0a0a, emissive: 0xff2a2a, emissiveIntensity: 0.25 });
  let lampY = 0.74, wheelZ = L / 2 - 0.78, bar = null;

  if (type === 'van') {
    add(box(W, 0.9, L), paint, 0, 0.8, 0);
    add(box(W - 0.04, 1.05, L * 0.74), paint, 0, 1.77, -L * 0.13);
    add(box(W - 0.12, 0.72, 0.95), CAR.glass, 0, 1.62, L * 0.24 + 0.47);
    add(box(W - 0.1, 0.06, 0.95), paint, 0, 2.01, L * 0.24 + 0.47);
    add(box(W + 0.04, 0.22, L + 0.12), CAR.trim, 0, 0.42, 0, false);
    lampY = 0.95;
    wheelZ = L / 2 - 0.95;
  } else if (type === 'sports') {
    add(box(W, 0.48, L), paint, 0, 0.52, 0);
    add(box(W - 0.34, 0.4, L * 0.36), CAR.glass, 0, 0.96, -0.35);
    add(box(W - 0.36, 0.05, L * 0.3), paint, 0, 1.18, -0.4);
    add(box(W - 0.1, 0.06, 0.42), CAR.black, 0, 1.04, -L / 2 + 0.26);
    add(box(0.08, 0.26, 0.08), CAR.black, 0.6, 0.88, -L / 2 + 0.28, false);
    add(box(0.08, 0.26, 0.08), CAR.black, -0.6, 0.88, -L / 2 + 0.28, false);
    add(box(W + 0.04, 0.2, L + 0.1), CAR.trim, 0, 0.34, 0, false);
    lampY = 0.6;
  } else {
    add(box(W, 0.62, L), paint, 0, 0.66, 0);
    add(box(W + 0.04, 0.22, L + 0.12), CAR.trim, 0, 0.42, 0, false);
    add(box(W - 0.24, 0.58, L * 0.5), CAR.glass, 0, 1.26, -0.25);
    add(box(W - 0.22, 0.07, L * 0.45), paint, 0, 1.58, -0.25);
    if (type === 'taxi') add(box(0.62, 0.24, 0.26), CAR.signMat, 0, 1.74, -0.25, false);
    if (type === 'police') {
      add(box(W + 0.02, 0.22, L * 0.42), CAR.black, 0, 0.72, 0.05, false);
      add(box(1.1, 0.1, 0.36), CAR.black, 0, 1.66, -0.2, false);
      const red = new THREE.MeshBasicMaterial({ color: 0x551111 }), blue = new THREE.MeshBasicMaterial({ color: 0x112255 });
      add(box(0.46, 0.14, 0.3), red, -0.27, 1.75, -0.2, false);
      add(box(0.46, 0.14, 0.3), blue, 0.27, 1.75, -0.2, false);
      bar = { red, blue };
    }
  }
  add(box(0.42, 0.16, 0.06), CAR.headlight, W / 2 - 0.35, lampY, L / 2 + 0.01, false);
  add(box(0.42, 0.16, 0.06), CAR.headlight, -W / 2 + 0.35, lampY, L / 2 + 0.01, false);
  add(box(0.42, 0.16, 0.06), tailMat, W / 2 - 0.31, lampY + 0.04, -L / 2 - 0.01, false);
  add(box(0.42, 0.16, 0.06), tailMat, -W / 2 + 0.31, lampY + 0.04, -L / 2 - 0.01, false);

  const front = [], spinners = [];
  const wscale = type === 'van' ? 1.12 : 1;
  for (const [x, z] of [[W / 2 - 0.07, wheelZ], [-W / 2 + 0.07, wheelZ], [W / 2 - 0.07, -wheelZ], [-W / 2 + 0.07, -wheelZ]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.36 * wscale, z);
    const spin = new THREE.Group();
    const tyre = new THREE.Mesh(CAR.wheel, CAR.tyre);
    tyre.scale.setScalar(wscale);
    tyre.castShadow = true;
    spin.add(tyre);
    pivot.add(spin);
    group.add(pivot);
    spinners.push(spin);
    if (z > 0) front.push(pivot);
  }
  return { group, front, spinners, tailMat, bar };
}

// Flash a police light bar.
function flashBar(parts, t, on) {
  if (!parts.bar) return;
  const a = on && Math.floor(t * 6) % 2 === 0, b = on && !a;
  parts.bar.red.color.setHex(a ? 0xff2a2a : 0x551111);
  parts.bar.blue.color.setHex(b ? 0x2a6bff : 0x112255);
}

// A car the physics moves: the player's, or an AI police car.
class Vehicle {
  constructor(scene, type = 'sedan', color = 0xd23a3a) {
    this.scene = scene;
    this.x = this.z = this.h = 0;
    this.look(type, color);
    this.reset(0, 0, 0);
  }

  look(type, color) {
    const shown = this.parts ? this.parts.group.visible : true;
    if (this.parts) this.scene.remove(this.parts.group);
    this.type = VEHICLES[type] ? type : 'sedan';
    this.spec = VEHICLES[this.type];
    this.color = color;
    this.L = this.spec.L;
    this.W = this.spec.W;
    this.parts = buildCarMesh(this.type, color);
    this.parts.group.visible = shown;
    this.scene.add(this.parts.group);
    if (this.events) this.syncMesh(0);
  }

  setColor(color) { this.look(this.type, color); }
  show(on) { this.parts.group.visible = on; }
  remove() { this.scene.remove(this.parts.group); }

  reset(x, z, h) {
    Object.assign(this, {
      x, z, h, y: 0, vy: 0, v: 0, steer: 0, gear: 'D', damage: 0, fuel: 100, fuelUsed: 0, odometer: 0,
      hitCooldown: 0, brakeLight: 0, throttle: 0, air: false, airTime: 0, climb: 0, wrecked: false, burn: 0, fx: 0, siren: false,
    });
    this.unlimitedFuel = false;
    this.events = [];
    this.syncMesh(0);
  }

  get forward() { return { x: Math.sin(this.h), z: Math.cos(this.h) }; }

  circles() {
    const o = this.L / 2 - this.W / 2;
    return [-o, 0, o];
  }

  shift() {
    if (Math.abs(this.v) > 1.5) return false;
    this.gear = this.gear === 'D' ? 'R' : 'D';
    return true;
  }

  update(dt, input, world, others) {
    const S = this.spec;
    this.steer = input.steer;
    const grip = Vehicle.grip;
    const delta = (this.steer * S.steer * grip) / (1 + Math.abs(this.v) / 22);
    const canDrive = !this.wrecked && this.fuel > 0 && !this.air;
    const throttle = canDrive ? input.throttle : 0;
    this.throttle = throttle;
    const dir = this.gear === 'D' ? 1 : -1;
    const accel = this.gear === 'D' ? S.accel : 3.5;
    const vmax = this.gear === 'D' ? S.vmax : 7;

    if (!this.air) {
      if (throttle > 0) this.v += dir * throttle * accel * Math.max(0, 1 - (this.v * dir) / vmax) * dt;
      const resist = input.brake * S.brake * grip + 0.35 + 0.004 * this.v * this.v + (throttle > 0 ? 0 : 0.5) + (this.wrecked ? 3 : 0);
      const dv = resist * dt;
      this.v = Math.abs(this.v) <= dv ? 0 : this.v - Math.sign(this.v) * dv;
      this.h -= (this.v / 2.6) * Math.tan(delta) * dt;
    } else {
      this.airTime += dt;
    }
    const f = this.forward;
    this.x += f.x * this.v * dt;
    this.z += f.z * this.v * dt;
    this.odometer += Math.abs(this.v) * dt;

    if (!this.unlimitedFuel) {
      const burn = (0.04 + throttle * (0.35 + 0.0011 * this.v * this.v)) * dt;
      this.fuel = Math.max(0, this.fuel - burn);
      this.fuelUsed += burn;
    }

    this.vertical(dt, world);
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    this.collideWorld(world);
    if (this.y < 1.2) this.collideCars(others);

    if (this.damage >= 100 && !this.wrecked) {
      this.wrecked = true;
      this.burn = 7;
      this.events.push({ type: 'wrecked' });
    }
    if (this.wrecked && this.burn > 0) {
      this.burn -= dt;
      if (this.burn <= 0) {
        Effects.explosion(this.x, this.y, this.z);
        this.events.push({ type: 'explode' });
      }
    }

    this.brakeLight = input.brake > 0.05 || this.gear === 'R' ? 1 : 0;
    this.syncMesh(dt, delta);
  }

  // Ramps lift the car; leaving one throws it into the air.
  vertical(dt, world) {
    const g = world.heightAt(this.x, this.z);
    if (this.air) {
      this.vy -= 15 * dt;
      this.y += this.vy * dt;
      if (this.y <= g) {
        const hit = -this.vy;
        this.y = g;
        this.air = false;
        this.vy = 0;
        if (hit > 9) this.applyDamage(Math.min(30, (hit - 9) * 4), 'landing');
        Effects.dust(this.x, this.z);
        this.events.push({ type: 'land', air: this.airTime });
      }
    } else if (g < this.y - 0.35) {
      this.air = true;
      this.vy = Math.max(0, this.climb);
      this.airTime = 0;
    } else {
      this.climb = dt > 0 ? (g - this.y) / dt : 0;
      this.y = g;
      if (g < 0.01) this.climb = Math.max(0, this.climb);
    }
  }

  applyDamage(dmg, what, extra) {
    if (this.wrecked) return;
    this.damage = Math.min(100, this.damage + dmg / this.spec.toughness);
    this.events.push({ type: 'crash', what, dmg, ...extra });
  }

  // Shared response for any impact: lose speed, maybe take damage.
  impact(nx, nz, closing, what, other) {
    const f = this.forward;
    const facing = Math.abs(f.x * nx + f.z * nz);
    this.v = facing > 0.7 ? -this.v * 0.15 : this.v * (1 - 0.75 * facing);
    if (closing > 2 && this.hitCooldown <= 0) {
      this.hitCooldown = 0.6;
      if (closing > 6) Effects.sparks(this.x + f.x * this.L * 0.4, 0.8, this.z + f.z * this.L * 0.4, Math.min(16, Math.round(closing)));
      this.applyDamage(Math.min(60, closing * 2.4), what, { closing, other });
    }
  }

  // Another vehicle rammed this one (police AI uses this on the player).
  takeHit(closing, from) {
    if (closing < 2 || this.hitCooldown > 0) return;
    this.hitCooldown = 0.6;
    this.v *= 0.6;
    this.applyDamage(Math.min(40, closing * 2), 'rammed', { closing, other: from });
  }

  collideWorld(world) {
    let hit = null;
    const r = this.W / 2 + 0.02;
    for (const off of this.circles()) {
      for (const R of world.rectsNear(this.x, this.z)) {
        const f = this.forward;
        const cx = this.x + f.x * off, cz = this.z + f.z * off;
        const px = clamp(cx, R.x0, R.x1), pz = clamp(cz, R.z0, R.z1);
        const dx = cx - px, dz = cz - pz, d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        let nx, nz, pen;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          nx = dx / d; nz = dz / d; pen = r - d;
        } else {
          const opts = [[cx - R.x0, -1, 0], [R.x1 - cx, 1, 0], [cz - R.z0, 0, -1], [R.z1 - cz, 0, 1]].sort((a, b) => a[0] - b[0]);
          [pen, nx, nz] = opts[0];
          pen += r;
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
    const mine = this.circles(), r1 = this.W / 2 + 0.02;
    for (const o of others) {
      if (o === this || o.noCollide) continue;
      const ddx = this.x - o.x, ddz = this.z - o.z;
      if (ddx * ddx + ddz * ddz > 64 || (o.y || 0) > 1.2) continue;
      const oL = o.L || 4.3, oW = o.W || 1.86, oo = oL / 2 - oW / 2, r2 = oW / 2 + 0.06;
      const of = { x: Math.sin(o.h), z: Math.cos(o.h) };
      let hit = null;
      for (const a of mine)
        for (const b of [-oo, oo]) {
          const f = this.forward;
          const ax = this.x + f.x * a, az = this.z + f.z * a;
          const bx = o.x + of.x * b, bz = o.z + of.z * b;
          const dx = ax - bx, dz = az - bz, d = Math.hypot(dx, dz), min = r1 + r2;
          if (d >= min || d < 1e-6) continue;
          const nx = dx / d, nz = dz / d, pen = min - d;
          if (o.pushable) {
            this.x += nx * pen * 0.5; this.z += nz * pen * 0.5;
            o.x -= nx * pen * 0.5; o.z -= nz * pen * 0.5;
            if (o.moved) o.moved();
          } else {
            this.x += nx * pen;
            this.z += nz * pen;
          }
          hit = { nx, nz };
        }
      if (!hit) continue;
      const f = this.forward;
      const rvx = f.x * this.v - of.x * (o.v || 0), rvz = f.z * this.v - of.z * (o.v || 0);
      const closing = -(rvx * hit.nx + rvz * hit.nz);
      this.impact(hit.nx, hit.nz, closing, o.isPolice ? 'police' : 'car', o);
      if (o.takeHit) o.takeHit(closing, this);
      if (o.onHit) o.onHit(this, closing);
    }
  }

  syncMesh(dt, delta = 0) {
    const p = this.parts, g = p.group;
    g.position.set(this.x, this.y, this.z);
    g.rotation.y = this.h;
    // Nose up on ramps (a curb step is too short to tilt for).
    g.rotation.x = this.air ? clamp(-this.vy * 0.04, -0.5, 0.5) : this.climb > 0.5 && this.climb < 8 && this.v > 1 ? -Math.atan2(this.climb, this.v) : 0;
    for (const w of p.front) w.rotation.y = -delta;
    for (const s of p.spinners) s.rotation.x += (this.v * dt) / 0.36;
    p.tailMat.emissiveIntensity = this.brakeLight ? 1.4 : 0.25;
    // Smoke when badly damaged, fire before it blows.
    if (dt > 0 && this.damage > 55) {
      this.fx += dt;
      const every = this.wrecked ? 0.05 : this.damage > 80 ? 0.12 : 0.25;
      if (this.fx > every) {
        this.fx = 0;
        const f = this.forward, hx = this.x + f.x * (this.L / 2 - 0.6), hz = this.z + f.z * (this.L / 2 - 0.6);
        if (this.wrecked && this.burn > 0) Effects.fire(hx, this.y + 1.1, hz);
        Effects.smoke(hx, this.y + 1.2, hz, this.damage > 80 ? 0.9 : 0.4);
      }
    }
  }
}
Vehicle.grip = 1;

// Kept for older call sites: the player's car is a Vehicle.
const PlayerCar = Vehicle;

// A parked car anyone can climb into. Bumping it shoves it along.
class ParkedCar {
  constructor(scene, type, color, x, z, h, damage = 0) {
    this.scene = scene;
    this.type = type;
    this.color = color;
    this.spec = VEHICLES[type];
    this.L = this.spec.L;
    this.W = this.spec.W;
    this.x = x; this.z = z; this.h = h; this.v = 0; this.y = 0;
    this.damage = damage;
    this.pushable = true;
    this.parts = buildCarMesh(type, color);
    scene.add(this.parts.group);
    this.moved();
  }
  moved() {
    this.parts.group.position.set(this.x, 0, this.z);
    this.parts.group.rotation.y = this.h;
  }
  remove() { this.scene.remove(this.parts.group); }
}
