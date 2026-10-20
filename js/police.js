'use strict';

// Wanted level and police chases.
//
// Crimes add stars. Police cars appear out of sight and chase: they route
// through the street grid towards you, then drive straight at you once close.
// Stay out of their sight long enough and they give up. Stop (or stand)
// next to a police car for a few seconds and you're busted.
const COPS_PER_LEVEL = [0, 1, 2, 3, 5, 6];

class PoliceCar extends Vehicle {
  constructor(scene) {
    super(scene, 'police', 0xffffff);
    this.isPolice = true;
    this.unlimitedFuel = true;
    this.wp = null;
    this.stuck = 0;
    this.reverse = 0;
    this.giveUp = 0;
  }

  // Next junction towards the target, one block at a time.
  nextWaypoint(world, tx, tz) {
    const { PITCH, N } = CITY;
    let ci, cj;
    if (this.wp) { ci = this.wp.i; cj = this.wp.j; }
    else {
      // Start with the junction ahead on the road we're on.
      const f = this.forward;
      ci = clamp(Math.round((this.x + f.x * PITCH * 0.5) / PITCH), 0, N);
      cj = clamp(Math.round((this.z + f.z * PITCH * 0.5) / PITCH), 0, N);
      this.wp = { i: ci, j: cj };
      return;
    }
    const ti = clamp(Math.round(tx / PITCH), 0, N), tj = clamp(Math.round(tz / PITCH), 0, N);
    const di = ti - ci, dj = tj - cj;
    if (di === 0 && dj === 0) return;
    if (Math.abs(di) >= Math.abs(dj)) this.wp = { i: ci + Math.sign(di), j: cj };
    else this.wp = { i: ci, j: cj + Math.sign(dj) };
  }

  drive(dt, world, target, others, aggressive) {
    const input = { steer: 0, throttle: 0, brake: 0 };
    const dist = Math.hypot(target.x - this.x, target.z - this.z);
    let gx, gz, speed;
    if (this.giveUp > 0) {
      // Pull over and wait to be cleared away.
      input.brake = 1;
    } else {
      if (dist < 42 || (Math.abs(target.x - this.x) < 5 || Math.abs(target.z - this.z) < 5) && dist < 90) {
        // Close: drive at where the target will be.
        const lead = Math.min(1, dist / 30);
        gx = target.x + Math.sin(target.h) * (target.v || 0) * lead;
        gz = target.z + Math.cos(target.h) * (target.v || 0) * lead;
        speed = clamp(6 + dist * 0.8, 6, this.spec.vmax * (aggressive ? 1 : 0.85));
        this.wp = null;
      } else {
        if (!this.wp) this.nextWaypoint(world, target.x, target.z);
        let n = world.node(this.wp.i, this.wp.j);
        if (Math.hypot(n.x - this.x, n.z - this.z) < 9) {
          this.nextWaypoint(world, target.x, target.z);
          n = world.node(this.wp.i, this.wp.j);
        }
        gx = n.x; gz = n.z;
        const dn = Math.hypot(n.x - this.x, n.z - this.z);
        speed = dn < 22 ? 12 : this.spec.vmax * (aggressive ? 0.9 : 0.75);
      }
      const want = Math.atan2(gx - this.x, gz - this.z);
      const diff = wrapAngle(want - this.h);
      input.steer = clamp(-diff * 2.4, -1, 1);
      speed *= 1 - Math.min(1, Math.abs(diff) / 1.4) * 0.6;
      if (this.v < speed) input.throttle = 1;
      else if (this.v > speed + 2) input.brake = 0.7;

      // Backing out after getting stuck against something.
      if (this.reverse > 0) {
        this.reverse -= dt;
        this.gear = 'R';
        input.throttle = 1;
        input.brake = 0;
        input.steer = -input.steer;
        if (this.reverse <= 0) this.gear = 'D';
      } else {
        this.gear = 'D';
        if (input.throttle > 0 && Math.abs(this.v) < 1) this.stuck += dt; else this.stuck = 0;
        if (this.stuck > 1.2) { this.reverse = 1.1; this.stuck = 0; this.v = 0; }
      }
    }
    this.siren = this.giveUp <= 0;
    this.update(dt, input, world, others);
    this.events.length = 0;
  }
}

class Police {
  constructor(game) {
    this.game = game;
    this.cars = [];
    this.level = 0;
    this.unseen = 0;
    this.seen = false;
    this.bust = 0;
    this.spawnTimer = 0;
    this.enabled = true;
  }

  get searching() { return this.level > 0 && !this.seen; }

  // A crime adds stars. Some only count when a police car is close enough to see it.
  crime(stars, x, z, needsWitness = false) {
    if (!this.enabled) return;
    if (needsWitness && !this.witness(x, z, 60)) return;
    const before = this.level;
    this.level = Math.min(5, Math.max(this.level + stars, stars));
    this.unseen = 0;
    if (this.level > before && this.onChange) this.onChange(this.level, before);
  }

  witness(x, z, r) {
    const all = this.cars.concat(this.game.traffic.cars.filter((c) => c.isPolice));
    return all.some((c) => Math.hypot(c.x - x, c.z - z) < r);
  }

  clear() {
    this.level = 0;
    this.unseen = 0;
    this.bust = 0;
    for (const c of this.cars) c.giveUp = 8;
  }

  removeAll() {
    for (const c of this.cars) c.remove();
    this.cars = [];
    this.level = 0;
    this.bust = 0;
  }

  spawn(target) {
    const world = this.game.world;
    // Turn a nearby patrol car into a chaser if there is one, otherwise appear out of sight.
    const patrol = this.game.traffic.cars.find((c) => c.isPolice && Math.hypot(c.x - target.x, c.z - target.z) < 110);
    const car = new PoliceCar(this.game.scene);
    if (patrol) {
      car.reset(patrol.x, patrol.z, patrol.h);
      car.v = patrol.v;
      this.game.traffic.take(patrol, target);
    } else {
      let best = null;
      for (let k = 0; k < 30; k++) {
        const p = world.randomLanePoint();
        const d = Math.hypot(p.x - target.x, p.z - target.z);
        if (d > 80 && d < 150) { best = p; break; }
        if (!best || Math.abs(d - 110) < Math.abs(Math.hypot(best.x - target.x, best.z - target.z) - 110)) best = p;
      }
      car.reset(best.x, best.z, best.h);
      car.v = 10;
    }
    car.unlimitedFuel = true;
    this.cars.push(car);
  }

  // target: { x, z, h, v, inCar }. Returns 'busted' when caught.
  update(dt, target, others) {
    const t = this.game.t;
    // Sight: any police car within range sees you.
    this.seen = this.level > 0 && this.cars.some((c) => !c.wrecked && c.giveUp <= 0 && Math.hypot(c.x - target.x, c.z - target.z) < 75);
    if (this.level > 0) {
      if (this.seen) this.unseen = 0;
      else {
        this.unseen += dt;
        if (this.unseen > 7 + this.level * 3) {
          const was = this.level;
          this.clear();
          if (this.onLost) this.onLost(was);
        }
      }
    }

    // Keep the right number of chasers.
    const want = this.enabled ? COPS_PER_LEVEL[this.level] : 0;
    const active = this.cars.filter((c) => c.giveUp <= 0 && !c.wrecked);
    this.spawnTimer -= dt;
    if (active.length < want && this.spawnTimer <= 0) { this.spawn(target); this.spawnTimer = 2.5; }

    for (let k = this.cars.length - 1; k >= 0; k--) {
      const c = this.cars[k];
      const d = Math.hypot(c.x - target.x, c.z - target.z);
      if (c.giveUp > 0) c.giveUp -= dt;
      if (d > 260 || (c.giveUp > 0 && d > 70) || (c.wrecked && c.burn <= 0 && d > 40) || (c.giveUp <= 0 && this.level === 0 && c.burn <= 0 && d > 50)) {
        c.remove();
        this.cars.splice(k, 1);
        continue;
      }
      c.drive(dt, this.game.world, target, others.concat(this.cars), this.level >= 3);
      flashBar(c.parts, t, c.siren && !c.wrecked);
    }

    // Busted: stopped (or on foot) right next to a police car.
    if (this.level > 0) {
      const close = this.cars.some((c) => !c.wrecked && c.giveUp <= 0 && Math.hypot(c.x - target.x, c.z - target.z) < (target.inCar ? 7 : 6) && Math.abs(c.v) < 6);
      const still = target.inCar ? Math.abs(target.v) < 1.5 : true;
      this.bust = close && still ? this.bust + dt : Math.max(0, this.bust - dt * 2);
      if (this.bust > (target.inCar ? 2.5 : 1.6)) { this.bust = 0; return 'busted'; }
    }
    return null;
  }

  nearestDistance(x, z) {
    let d = Infinity;
    for (const c of this.cars) if (c.siren && !c.wrecked) d = Math.min(d, Math.hypot(c.x - x, c.z - z));
    return d;
  }
}
