'use strict';

// Blocky people: pedestrians, the player on foot and friends on foot.
const PERSON = (() => {
  // Limbs hang down from their pivot (hip or shoulder).
  const limb = (w, h, d) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, -h / 2, 0); return g; };
  return {
    leg: limb(0.2, 0.84, 0.22),
    arm: limb(0.14, 0.66, 0.16),
    torso: new THREE.BoxGeometry(0.5, 0.64, 0.28),
    head: new THREE.BoxGeometry(0.28, 0.3, 0.28),
    hair: new THREE.BoxGeometry(0.31, 0.1, 0.31),
    mats: new Map(),
  };
})();

const SKINS = [0xf1c9a5, 0xd9a47a, 0xa8714c, 0x7a4e32, 0xe8b88f, 0x8d5a3b];
const SHIRTS = [0xd94f4f, 0x3b7dd8, 0xf2c230, 0x3f9a5a, 0xe9e4da, 0x8e5ac9, 0xf08a24, 0x2a2f36, 0x1fa3a3, 0xff7fae];
const PANTS = [0x2a3442, 0x3b3f46, 0x6b5b45, 0x1f3f6b, 0x4a4f2a, 0x8a8f96];
const HAIRS = [0x2a1c12, 0x4a3020, 0x8a6a3a, 0x1a1a1a, 0xc9b27a, 0x6b6b6b];

function personMat(color) {
  if (!PERSON.mats.has(color)) PERSON.mats.set(color, new THREE.MeshLambertMaterial({ color }));
  return PERSON.mats.get(color);
}

function randomLook(rand = Math.random) {
  const pick = (a) => a[Math.floor(rand() * a.length)];
  return { skin: pick(SKINS), shirt: pick(SHIRTS), pants: pick(PANTS), hair: pick(HAIRS) };
}

function buildPerson(look) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const mesh = (geo, color, x, y, z, parent = body, shadow = false) => {
    const m = new THREE.Mesh(geo, personMat(color));
    m.position.set(x, y, z);
    m.castShadow = shadow;
    parent.add(m);
    return m;
  };
  const pivot = (x, y) => { const p = new THREE.Group(); p.position.set(x, y, 0); body.add(p); return p; };
  const legL = pivot(0.12, 0.86), legR = pivot(-0.12, 0.86), armL = pivot(0.33, 1.47), armR = pivot(-0.33, 1.47);
  mesh(PERSON.leg, look.pants, 0, 0, 0, legL);
  mesh(PERSON.leg, look.pants, 0, 0, 0, legR);
  mesh(PERSON.arm, look.shirt, 0, 0, 0, armL);
  mesh(PERSON.arm, look.shirt, 0, 0, 0, armR);
  mesh(PERSON.torso, look.shirt, 0, 1.18, 0, body, true);
  mesh(PERSON.head, look.skin, 0, 1.66, 0);
  mesh(PERSON.hair, look.hair, 0, 1.84, 0);
  return { group, body, legL, legR, armL, armR };
}

// Walk cycle, jump pose, or lying flat after being knocked down.
function posePerson(p, phase, amount, state) {
  if (state === 'down') {
    p.body.rotation.x = -Math.PI / 2;
    p.body.position.y = 0.16;
    p.legL.rotation.x = p.legR.rotation.x = 0;
    p.armL.rotation.x = -2.6; p.armR.rotation.x = -2.4;
    return;
  }
  p.body.rotation.x = 0;
  p.body.position.y = 0;
  if (state === 'air') {
    p.legL.rotation.x = 0.7; p.legR.rotation.x = -0.4;
    p.armL.rotation.x = p.armR.rotation.x = -2.2;
    return;
  }
  const s = Math.sin(phase) * amount;
  p.legL.rotation.x = s;
  p.legR.rotation.x = -s;
  p.armL.rotation.x = -s * 0.8;
  p.armR.rotation.x = s * 0.8;
}

// The player on foot.
class Walker {
  constructor(scene, look) {
    this.scene = scene;
    this.look = look;
    this.parts = buildPerson(look);
    scene.add(this.parts.group);
    this.reset(0, 0, 0);
  }

  reset(x, z, h) {
    Object.assign(this, { x, z, h, y: 0, vy: 0, v: 0, speed: 0, health: 100, phase: 0, down: 0, air: false, sx: 0, sz: 0, calm: 0 });
    this.L = 0.6; this.W = 0.6;
    this.events = [];
    this.pose();
  }

  show(on) { this.parts.group.visible = on; }
  get forward() { return { x: Math.sin(this.h), z: Math.cos(this.h) }; }

  // input: mx (right), my (forward), run, jump; camYaw: the camera's heading.
  update(dt, input, world, vehicles, camYaw) {
    const ground = world.footGroundAt(this.x, this.z);
    this.calm += dt;
    if (this.calm > 6 && this.health < 100) this.health = Math.min(100, this.health + dt * 2);

    if (this.down > 0) {
      this.down -= dt;
      this.x += this.sx * dt; this.z += this.sz * dt;
      this.sx *= 1 - Math.min(1, dt * 3); this.sz *= 1 - Math.min(1, dt * 3);
      this.collideWorld(world);
      this.y = ground;
      this.speed = 0;
      this.pose();
      return;
    }

    const mag = Math.min(1, Math.hypot(input.mx, input.my));
    let target = 0;
    if (mag > 0.12) {
      const fx = Math.sin(camYaw), fz = Math.cos(camYaw), rx = -fz, rz = fx;
      const dx = fx * input.my + rx * input.mx, dz = fz * input.my + rz * input.mx;
      const want = Math.atan2(dx, dz);
      this.h += clamp(wrapAngle(want - this.h), -12 * dt, 12 * dt);
      target = mag * (input.run ? 6.4 : 2.7);
    }
    this.speed += clamp(target - this.speed, -20 * dt, 14 * dt);
    this.v = this.speed;
    const f = this.forward;
    this.x += f.x * this.speed * dt;
    this.z += f.z * this.speed * dt;

    if (input.jump && !this.air) { this.air = true; this.vy = 5.4; }
    if (this.air) {
      this.vy -= 16 * dt;
      this.y += this.vy * dt;
      if (this.y <= ground) { this.y = ground; this.air = false; this.vy = 0; }
    } else {
      this.y = ground;
    }

    this.collideWorld(world);
    this.collideCars(vehicles);
    this.phase += this.speed * dt * 3.3;
    this.pose();
  }

  collideWorld(world) {
    const r = 0.35;
    for (const R of world.footRectsNear(this.x, this.z)) {
      const px = clamp(this.x, R.x0, R.x1), pz = clamp(this.z, R.z0, R.z1);
      const dx = this.x - px, dz = this.z - pz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        this.x += (dx / d) * (r - d); this.z += (dz / d) * (r - d);
      } else {
        const opts = [[this.x - R.x0, -1, 0], [R.x1 - this.x, 1, 0], [this.z - R.z0, 0, -1], [R.z1 - this.z, 0, 1]].sort((a, b) => a[0] - b[0]);
        this.x += opts[0][1] * (opts[0][0] + r); this.z += opts[0][2] * (opts[0][0] + r);
      }
    }
  }

  // Cars push you aside; fast ones knock you over.
  collideCars(vehicles) {
    for (const o of vehicles) {
      const dx = this.x - o.x, dz = this.z - o.z;
      if (dx * dx + dz * dz > 30 || Math.abs((o.y || 0) - this.y) > 1.6) continue;
      const of = { x: Math.sin(o.h), z: Math.cos(o.h) };
      const along = dx * of.x + dz * of.z, lat = dx * -of.z + dz * of.x;
      const hl = (o.L || 4.3) / 2 + 0.3, hw = (o.W || 1.86) / 2 + 0.3;
      if (Math.abs(along) > hl || Math.abs(lat) > hw) continue;
      // Push out through the nearest side of the car.
      const pa = hl - Math.abs(along), pl = hw - Math.abs(lat);
      if (pl < pa) { const s = Math.sign(lat) || 1; this.x += -of.z * s * pl; this.z += of.x * s * pl; }
      else { const s = Math.sign(along) || 1; this.x += of.x * s * pa; this.z += of.z * s * pa; }
      const speed = Math.abs(o.v || 0);
      if (speed > 4 && this.down <= 0) {
        const dmg = (speed - 3) * 5;
        this.health = Math.max(0, this.health - dmg);
        this.calm = 0;
        this.down = 2.2;
        this.sx = of.x * (o.v || 0) * 0.6; this.sz = of.z * (o.v || 0) * 0.6;
        this.events.push({ type: 'knocked', dmg, by: o });
      }
    }
  }

  pose() {
    const p = this.parts;
    p.group.position.set(this.x, this.y, this.z);
    p.group.rotation.y = this.h;
    posePerson(p, this.phase, Math.min(0.95, this.speed * 0.22), this.down > 0 ? 'down' : this.air ? 'air' : 'walk');
  }
}
