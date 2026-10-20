'use strict';

const MISSIONS = {
  free:    { name: 'Free Drive',    tag: 'Explore', blurb: 'Cruise the city at your own pace. No clock and no fuel limit.' },
  speed:   { name: 'Rush Hour',     tag: 'Time',    blurb: 'Reach the destination before the clock runs out. Each red light costs 5 seconds.' },
  fuel:    { name: 'Eco Run',       tag: 'Fuel',    blurb: 'Reach the destination on a small tank. Hard acceleration and high speed burn fuel fast.' },
  parking: { name: 'Parallel Park', tag: 'Parking', blurb: 'Drive to the bay and park between the two cars. Line up straight and come to a full stop.' },
  safe:    { name: 'Safe Driver',   tag: 'Rules',   blurb: 'Reach the destination with no crashes and no red lights. One mistake ends the run.' },
};
const MISSION_ORDER = ['free', 'speed', 'fuel', 'parking', 'safe'];

const fmtTime = (s) => {
  s = Math.max(0, s);
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};

function makeBeam(color) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.4, 4.2, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false })
  );
  ring.position.y = 0.05;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 2.6, 60, 24, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide })
  );
  beam.position.y = 30;
  g.add(ring, beam);
  g.userData.ring = ring;
  return g;
}

class Mission {
  constructor(type, level, game) {
    this.type = type;
    this.level = level;
    this.game = game;
    this.meta = MISSIONS[type];
    this.elapsed = 0;
    this.crashes = 0;
    this.redLights = 0;
    this.markers = [];
    this.statics = [];
    this.parkHold = 0;
    this.done = null;
    this.setup();
  }

  setup() {
    const { world, player, traffic } = this.game;
    const L = this.level;
    traffic.blocked = new Set();

    if (this.type === 'parking') {
      const bay = world.randomLanePoint();
      const len = Math.max(player.L + 1.9, player.L + 4.3 - (L - 1) * 0.3);
      this.bay = { ...world.lanePoint(bay.i, bay.j, bay.d, CITY.PITCH / 2), len };
      traffic.blocked.add(segKey(bay.i, bay.j, bay.d));
      for (const side of [-1, 1]) {
        const p = world.lanePoint(bay.i, bay.j, bay.d, CITY.PITCH / 2 + side * (len / 2 + CAR.LENGTH / 2 + 0.2));
        const parts = buildCarMesh(TRAFFIC_COLORS[(L + side + 8) % TRAFFIC_COLORS.length]);
        parts.group.position.set(p.x, 0, p.z);
        parts.group.rotation.y = p.h;
        this.game.scene.add(parts.group);
        this.markers.push(parts.group);
        this.statics.push({ x: p.x, z: p.z, h: p.h, v: 0 });
      }
      this.buildBay();
      this.goal = { x: this.bay.x, z: this.bay.z };
      this.start = this.pickStart(70, 170);
      this.timeLimit = 75 + this.routeDist() / 8;
    } else if (this.type !== 'free') {
      this.start = world.randomLanePoint();
      const minDist = Math.min(380, 150 + L * 25);
      let g, tries = 0;
      do { g = world.randomLanePoint(); tries++; } while (tries < 200 && Math.abs(g.x - this.start.x) + Math.abs(g.z - this.start.z) < minDist);
      this.goal = g;
      const m = makeBeam(0x3ce07a);
      m.position.set(g.x, 0, g.z);
      this.game.scene.add(m);
      this.markers.push(m);
      this.beam = m;
    } else {
      this.start = world.randomLanePoint();
    }

    const dist = this.goal ? this.routeDist() : 0;
    if (this.type === 'speed') this.timeLimit = dist / Math.min(13, 8.5 + L * 0.5) + 14;
    if (this.type === 'safe') this.timeLimit = dist / 5 + 60;

    player.reset(this.start.x, this.start.z, this.start.h);
    player.unlimitedFuel = this.type === 'free';
    if (this.type === 'fuel') player.fuel = this.fuelBudget = Math.round(dist * 0.022 * Math.max(1.15, 2.1 - (L - 1) * 0.1) + 3);

    const count = this.type === 'safe' ? 34 + L * 2 : 24 + L * 2;
    traffic.reset(Math.min(46, count), player);
  }

  pickStart(min, max) {
    for (let k = 0; k < 300; k++) {
      const p = this.game.world.randomLanePoint();
      const d = Math.abs(p.x - this.goal.x) + Math.abs(p.z - this.goal.z);
      if (d >= min && d <= max && segKey(p.i, p.j, p.d) !== segKey(this.bay.i, this.bay.j, this.bay.d)) return p;
    }
    return this.game.world.randomLanePoint();
  }

  routeDist() { return Math.abs(this.goal.x - this.start.x) + Math.abs(this.goal.z - this.start.z) + 20; }

  buildBay() {
    const b = this.bay, D = DIRS[b.d], alongX = D.x !== 0, W = 2.7;
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const line = (ox, oz, ex, ez) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(ex, ez).rotateX(-Math.PI / 2), mat);
      m.position.set(ox, 0.03, oz);
      g.add(m);
    };
    const [lx, lz] = alongX ? [b.len, W] : [W, b.len];
    line(0, -lz / 2, lx, 0.15); line(0, lz / 2, lx, 0.15);
    line(-lx / 2, 0, 0.15, lz); line(lx / 2, 0, 0.15, lz);
    this.bayFill = new THREE.MeshBasicMaterial({ color: 0x2f7bff, transparent: true, opacity: 0.28, depthWrite: false });
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(lx, lz).rotateX(-Math.PI / 2), this.bayFill);
    fill.position.y = 0.025;
    g.add(fill);
    g.position.set(b.x, 0, b.z);
    const beam = makeBeam(0x2f7bff);
    beam.userData.ring.visible = false;
    beam.position.set(b.x, 0, b.z);
    this.game.scene.add(g, beam);
    this.markers.push(g, beam);
    this.beam = beam;
  }

  dispose() { for (const m of this.markers) this.game.scene.remove(m); }

  onCrash(e) {
    this.crashes++;
    if (this.type === 'safe') this.fail('You hit something. Safe drivers keep their distance.');
  }

  onPedHit() {
    this.crashes++;
    if (this.type === 'safe') this.fail('You hit a pedestrian.');
    else if (this.type === 'speed') { this.timeLimit -= 10; this.game.toast('You hit a pedestrian: −10 seconds', 'bad'); }
    else this.game.toast('Watch out for pedestrians!', 'bad');
  }

  onRedLight() {
    this.redLights++;
    if (this.type === 'safe') this.fail('You ran a red light.');
    else if (this.type === 'speed') { this.timeLimit -= 5; this.game.toast('Red light: −5 seconds', 'bad'); }
    else this.game.toast('You ran a red light', 'bad');
  }

  fail(reason) { if (!this.done) this.done = { ok: false, reason }; }
  win() { if (!this.done) this.done = { ok: true }; }

  update(dt) {
    const p = this.game.player;
    this.elapsed += dt;
    if (this.beam) {
      const pulse = 1 + Math.sin(this.elapsed * 4) * 0.06;
      this.beam.userData.ring.scale.set(pulse, 1, pulse);
    }
    if (p.damage >= 100) this.fail('Your car is wrecked.');
    if (this.timeLimit && this.elapsed > this.timeLimit) this.fail('Out of time.');
    if (this.type === 'fuel' && p.fuel <= 0 && Math.abs(p.v) < 0.3) this.fail('You ran out of fuel.');

    if (this.type === 'parking') this.checkParking(dt);
    else if (this.goal) {
      const d = Math.hypot(p.x - this.goal.x, p.z - this.goal.z);
      if (d < 5.5) {
        if (Math.abs(p.v) < 3) this.win();
        else if (!this.slowWarned) { this.slowWarned = true; this.game.toast('Slow down and stop at the marker'); }
      } else this.slowWarned = false;
    }
    return this.done;
  }

  checkParking(dt) {
    const p = this.game.player, b = this.bay, D = DIRS[b.d], r = rightOf(b.d);
    const rx = p.x - b.x, rz = p.z - b.z;
    const along = rx * D.x + rz * D.z, lat = rx * r.x + rz * r.z;
    const angle = Math.abs(wrapAngle(p.h - b.h));
    const inside = Math.abs(along) < (b.len - p.L) / 2 + 0.3 && Math.abs(lat) < 0.9;
    const straight = angle < 0.21;
    this.bayFill.color.setHex(inside && straight ? 0x3ce07a : inside ? 0xf2c230 : 0x2f7bff);
    this.parkState = inside ? (straight ? 'Hold still…' : 'Straighten up') : '';
    if (inside && straight && Math.abs(p.v) < 0.3) {
      this.parkHold += dt;
      if (this.parkHold > 1) this.win();
    } else this.parkHold = 0;
  }

  // Values for the mission panel.
  hud() {
    const p = this.game.player;
    if (this.type === 'free') return { label: 'Driven', value: `${(p.odometer / 1000).toFixed(2)} km`, warn: false };
    if (this.type === 'fuel') return { label: 'Fuel left', value: `${p.fuel.toFixed(1)}%`, warn: p.fuel < this.fuelBudget * 0.25 };
    const left = this.timeLimit - this.elapsed;
    return { label: 'Time left', value: fmtTime(left), warn: left < 10 };
  }

  objective() {
    if (this.type === 'free') return 'Explore the city. Stop at red lights.';
    if (this.type === 'parking') return this.parkState || 'Park in the blue bay between the cars';
    return 'Stop at the green marker';
  }

  reward() {
    const base = { speed: 60, fuel: 70, parking: 80, safe: 90 }[this.type] || 0;
    let bonus = 0;
    if (this.timeLimit) bonus += Math.round(Math.max(0, this.timeLimit - this.elapsed) * 1.5);
    if (this.type === 'fuel') bonus += Math.round(this.game.player.fuel * 4);
    bonus += Math.round((100 - this.game.player.damage) / 4);
    return base + this.level * 15 + bonus;
  }
}
