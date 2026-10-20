'use strict';

// Pooled sprite particles: smoke from damaged cars, fire, dust, sparks,
// splashes and explosions. One shared soft-dot texture, no per-frame allocation.
const Effects = (() => {
  const MAX = 160;
  let scene = null;
  const free = [], live = [];
  let flash = null, flashLife = 0;

  const dot = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.6)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();

  function init(s) {
    scene = s;
    for (let k = 0; k < MAX; k++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, transparent: true, depthWrite: false }));
      sp.visible = false;
      scene.add(sp);
      free.push({ sp });
    }
    flash = new THREE.PointLight(0xffa040, 0, 40);
    scene.add(flash);
  }

  function spawn(x, y, z, o) {
    const p = free.pop() || live.shift();
    if (!p) return;
    const m = p.sp.material;
    const additive = !!o.additive;
    if (m.blending !== (additive ? THREE.AdditiveBlending : THREE.NormalBlending)) {
      m.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      m.needsUpdate = true;
    }
    m.color.setHex(o.color);
    Object.assign(p, {
      age: 0, life: o.life || 1, size: o.size || 1, grow: o.grow || 0, alpha: o.alpha === undefined ? 0.7 : o.alpha,
      vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, gravity: o.gravity || 0,
    });
    p.sp.position.set(x, y, z);
    p.sp.visible = true;
    live.push(p);
  }

  const rnd = (a) => (Math.random() - 0.5) * a;

  return {
    init,
    smoke(x, y, z, dark = 0.5) {
      const c = Math.round(200 - dark * 150);
      spawn(x + rnd(0.4), y, z + rnd(0.4), { color: (c << 16) | (c << 8) | c, size: 0.7, grow: 2.2, life: 1.6, vy: 1.4, vx: rnd(0.6), vz: rnd(0.6), alpha: 0.55 });
    },
    fire(x, y, z) {
      spawn(x + rnd(0.6), y, z + rnd(0.6), { color: Math.random() < 0.5 ? 0xff7a1a : 0xffc23a, size: 0.8, grow: 0.6, life: 0.55, vy: 2.4, additive: true, alpha: 0.9 });
    },
    dust(x, z) {
      spawn(x + rnd(0.6), 0.25, z + rnd(0.6), { color: 0xb8ad98, size: 0.5, grow: 1.6, life: 0.8, vy: 0.5, alpha: 0.35 });
    },
    sparks(x, y, z, n = 8) {
      for (let k = 0; k < n; k++) {
        spawn(x, y, z, { color: 0xffd36a, size: 0.18, grow: -0.1, life: 0.45, vx: rnd(10), vy: 2 + Math.random() * 4, vz: rnd(10), gravity: 14, additive: true, alpha: 1 });
      }
    },
    splash(x, z) {
      for (let k = 0; k < 10; k++) spawn(x, 0.3, z, { color: 0xd7ecff, size: 0.4, grow: 0.8, life: 0.7, vx: rnd(5), vy: 3 + Math.random() * 3, vz: rnd(5), gravity: 12, alpha: 0.8 });
    },
    explosion(x, y, z) {
      for (let k = 0; k < 26; k++) {
        spawn(x, y + 0.5, z, { color: k % 3 ? 0xff8a1f : 0xffd34a, size: 1.2, grow: 3, life: 0.7 + Math.random() * 0.4, vx: rnd(12), vy: 2 + Math.random() * 7, vz: rnd(12), gravity: 4, additive: true, alpha: 1 });
      }
      for (let k = 0; k < 14; k++) {
        spawn(x, y + 1, z, { color: 0x3a3a3a, size: 1.5, grow: 4, life: 2.2, vx: rnd(4), vy: 2 + Math.random() * 2, vz: rnd(4), alpha: 0.7 });
      }
      this.sparks(x, y + 1, z, 20);
      flash.position.set(x, y + 2, z);
      flash.intensity = 6;
      flashLife = 0.6;
    },
    update(dt) {
      for (let k = live.length - 1; k >= 0; k--) {
        const p = live[k];
        p.age += dt;
        if (p.age >= p.life) {
          p.sp.visible = false;
          live.splice(k, 1);
          free.push(p);
          continue;
        }
        p.vy -= p.gravity * dt;
        p.sp.position.x += p.vx * dt;
        p.sp.position.y = Math.max(0.05, p.sp.position.y + p.vy * dt);
        p.sp.position.z += p.vz * dt;
        const t = p.age / p.life;
        const s = Math.max(0.02, p.size + p.grow * t);
        p.sp.scale.set(s, s, s);
        p.sp.material.opacity = p.alpha * (1 - t);
      }
      if (flashLife > 0) {
        flashLife -= dt;
        flash.intensity = Math.max(0, flashLife * 10);
      }
    },
  };
})();
