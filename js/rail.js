'use strict';

// The Mumbai local: Western Railway from Churchgate to Dahanu Road.
//
// The line runs on a viaduct above road column 3. Six trains shuttle up and
// down all day, stopping at every station. Where each train is depends only
// on the game clock, so every phone in a multiplayer game sees the same trains
// without sending a single message. Down trains (towards Dahanu) keep to the
// left, which is the west track; up trains (towards Churchgate) use the east.
const Rail = (() => {
  const X = MUMBAI.railColumn * CITY.PITCH;
  const DECK = 7.4;                  // top of the viaduct
  const TRACK = 2.3;                 // each track's distance from the centre line
  const FLOOR = DECK + 1.15;         // coach floor and platform height
  const COACHES = 6, COACH_L = 15, GAP = 0.6;
  const VMAX = 28, ACC = 1.1, DWELL = 12, LAYOVER = 25, TRAINS = 6;
  const Z0 = MUMBAI.zOfKm(0);        // Churchgate
  const stations = MUMBAI.stations.map((s, i) => ({ ...s, i, s: Z0 - s.z }));
  const N = stations.length;

  // ---------- Timetable ----------
  const dAcc = (VMAX * VMAX) / (2 * ACC);
  const legTime = (d) => (d < 2 * dAcc ? 2 * Math.sqrt(d / ACC) : (2 * VMAX) / ACC + (d - 2 * dAcc) / VMAX);
  function legPos(d, tau) {
    if (d < 2 * dAcc) {
      const th = Math.sqrt(d / ACC);
      if (tau < th) return { x: 0.5 * ACC * tau * tau, v: ACC * tau };
      const r = Math.max(0, 2 * th - tau);
      return { x: d - 0.5 * ACC * r * r, v: ACC * r };
    }
    const tA = VMAX / ACC, tC = (d - 2 * dAcc) / VMAX;
    if (tau < tA) return { x: 0.5 * ACC * tau * tau, v: ACC * tau };
    if (tau < tA + tC) return { x: dAcc + VMAX * (tau - tA), v: VMAX };
    const r = Math.max(0, 2 * tA + tC - tau);
    return { x: d - 0.5 * ACC * r * r, v: ACC * r };
  }
  const events = [];
  let cycle = 0;
  {
    let t = 0;
    const push = (e) => { e.t0 = t; t += e.dur; e.t1 = t; events.push(e); };
    const down = stations.map((s) => s.i), up = down.slice().reverse();
    for (const [order, dir] of [[down, 'down'], [up, 'up']]) {
      push({ type: 'dwell', st: order[0], dir, dur: LAYOVER });
      for (let n = 1; n < order.length; n++) {
        const a = stations[order[n - 1]].s, b = stations[order[n]].s;
        push({ type: 'run', from: order[n - 1], to: order[n], dir, dur: legTime(Math.abs(b - a)), a, b });
        if (n < order.length - 1) push({ type: 'dwell', st: order[n], dir, dur: DWELL });
      }
    }
    cycle = t;
  }

  // Where train k is at game time t.
  function state(k, t) {
    const tau = (((t + (k * cycle) / TRAINS) % cycle) + cycle) % cycle;
    let lo = 0, hi = events.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (events[mid].t1 <= tau) lo = mid + 1; else hi = mid; }
    const e = events[lo], local = tau - e.t0;
    if (e.type === 'dwell') {
      const st = stations[e.st];
      const next = e.dir === 'down' ? Math.min(N - 1, e.st + 1) : Math.max(0, e.st - 1);
      return { s: st.s, v: 0, dir: e.dir, dwell: e.st, next, left: e.dur - local };
    }
    const p = legPos(Math.abs(e.b - e.a), local);
    return { s: e.a + Math.sign(e.b - e.a) * p.x, v: p.v, dir: e.dir, dwell: -1, next: e.to, left: 0 };
  }

  const trackX = (dir) => X + (dir === 'down' ? -TRACK : TRACK);
  const headingFor = (dir) => (dir === 'down' ? Math.PI : 0);

  // Seconds until the next train in direction dir stops at station i, and which train.
  function nextArrival(i, dir, t) {
    let best = { k: -1, eta: Infinity };
    for (const e of events) {
      if (e.type !== 'dwell' || e.st !== i || e.dir !== dir) continue;
      for (let k = 0; k < TRAINS; k++) {
        const start = e.t0 - (k * cycle) / TRAINS;
        let eta = (((start - t) % cycle) + cycle) % cycle;
        // Already standing at the platform counts as now.
        if (eta > cycle - e.dur) eta = 0;
        if (eta < best.eta) best = { k, eta };
      }
    }
    return best;
  }

  // ---------- Building ----------
  let scene = null;
  const trains = [];
  const coachMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 });

  function coachGeometry(cab) {
    const b = new GeoBatch(), W = 3.6, L = COACH_L, y0 = 0.6, y1 = 4.3, hl = L / 2;
    b.box(-W / 2, y0, -hl, W / 2, y1, hl, 0xe9e2cf, { plain: true, roof: 0x8f949a });
    b.box(-W / 2 - 0.03, y0, -hl + 0.2, W / 2 + 0.03, y0 + 0.9, hl - 0.2, 0x7a1f2b, { plain: true, roof: 0x7a1f2b });
    b.box(-W / 2 - 0.04, 2.3, -hl + 0.6, W / 2 + 0.04, 3.25, hl - 0.6, 0x283039, { plain: true, roof: 0x283039 });
    // Open doors (they always are on a Mumbai local).
    for (const dz of [-hl + 2.2, 0, hl - 2.2]) b.box(-W / 2 - 0.06, 0.9, dz - 0.7, W / 2 + 0.06, 3.9, dz + 0.7, 0x121418, { plain: true, roof: 0x121418 });
    b.box(-W / 2, 0, -hl + 1.5, W / 2, y0, -hl + 3.5, 0x2a2d31, { plain: true });
    b.box(-W / 2, 0, hl - 3.5, W / 2, y0, hl - 1.5, 0x2a2d31, { plain: true });
    if (cab) {
      b.box(-W / 2, y0, hl - 0.02, W / 2, y1, hl + 0.06, 0xf2c230, { plain: true });
      b.box(-1.2, 2.5, hl + 0.06, 1.2, 3.4, hl + 0.1, 0x1a1d22, { plain: true });
      b.box(-0.25, 3.9, hl - 3, 0.25, 4.9, hl - 2.6, 0x3a3d42, { plain: true }); // pantograph
    }
    const m = b.mesh(coachMat);
    return m.geometry;
  }

  function boardTexture(text) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 48;
    const g = c.getContext('2d');
    g.fillStyle = '#0b0b0b'; g.fillRect(0, 0, 256, 48);
    g.fillStyle = '#ff8a1c';
    g.font = '900 30px Overpass, Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 26, 240);
    return new THREE.CanvasTexture(c);
  }

  function stationBoard(st) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 200;
    const g = c.getContext('2d');
    g.fillStyle = '#f5c400'; g.fillRect(0, 0, 512, 200);
    g.strokeStyle = '#111'; g.lineWidth = 8; g.strokeRect(6, 6, 500, 188);
    g.fillStyle = '#111';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '800 74px "Noto Sans Devanagari", "Mukta", Overpass, Arial, sans-serif';
    g.fillText(st.marathi, 256, 78, 480);
    g.font = '900 46px Overpass, Arial, sans-serif';
    g.fillText(st.name.toUpperCase(), 256, 158, 480);
    return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide });
  }

  function build(sc, world) {
    scene = sc;
    const zN = stations[N - 1].z - 70, zS = stations[0].z + 70, len = zS - zN, zc = (zN + zS) / 2;
    const concrete = new THREE.MeshStandardMaterial({ color: 0xb9b5ab, roughness: 0.9 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(10, 1.2, len), concrete);
    deck.position.set(X, DECK - 0.6, zc);
    deck.castShadow = deck.receiveShadow = true;
    const walls = new GeoBatch();
    walls.box(X - 5, DECK, zN, X - 4.6, DECK + 1, zS, 0xc9c5bb, { plain: true });
    walls.box(X + 4.6, DECK, zN, X + 5, DECK + 1, zS, 0xc9c5bb, { plain: true });
    for (const tx of [X - TRACK, X + TRACK]) {
      walls.box(tx - 1.6, DECK, zN, tx + 1.6, DECK + 0.12, zS, 0x5b544c, { plain: true });
      walls.box(tx - 0.85, DECK + 0.12, zN, tx - 0.75, DECK + 0.3, zS, 0x9aa0a6, { plain: true });
      walls.box(tx + 0.75, DECK + 0.12, zN, tx + 0.85, DECK + 0.3, zS, 0x9aa0a6, { plain: true });
    }
    const wallMesh = walls.mesh(world.plainMat);
    wallMesh.receiveShadow = true;
    scene.add(deck, wallMesh);

    // Piers down the middle of the road (between the lanes), and overhead wire masts.
    const piers = new InstanceList(), masts = new InstanceList(), arms = new InstanceList();
    for (let z = zN + 6; z < zS; z += 30) {
      const j = Math.round(z / CITY.PITCH);
      if (Math.abs(z - j * CITY.PITCH) < CITY.HALF + 3) continue;
      piers.add(X, (DECK - 1.2) / 2, z, 1, 1, 1);
      world.addSolid({ x0: X - 0.7, x1: X + 0.7, z0: z - 0.7, z1: z + 0.7 });
    }
    for (let z = zN + 20; z < zS; z += 60) { masts.add(X - 4.8, DECK + 3.5, z); masts.add(X + 4.8, DECK + 3.5, z); arms.add(X, DECK + 6.6, z); }
    const pierMesh = piers.mesh(new THREE.BoxGeometry(1.4, DECK - 1.2, 1.4), concrete);
    const mastMesh = masts.mesh(new THREE.BoxGeometry(0.25, 7, 0.25), new THREE.MeshStandardMaterial({ color: 0x6b7076 }));
    const armMesh = arms.mesh(new THREE.BoxGeometry(9.8, 0.2, 0.2), new THREE.MeshStandardMaterial({ color: 0x6b7076 }));
    pierMesh.castShadow = true;
    scene.add(pierMesh, mastMesh, armMesh);

    // Stations: side platforms, canopies, name boards and stairs to the street.
    const plat = new GeoBatch();
    for (const st of stations) {
      const z = st.z;
      for (const side of [-1, 1]) {
        const xi = X + side * 4.7, xo = X + side * 8.6;
        plat.box(Math.min(xi, xo), DECK - 1.2, z - 50, Math.max(xi, xo), FLOOR, z + 50, 0xa8a49a, { plain: true, roof: 0x9b978e });
        plat.box(Math.min(xi, xi + side * 0.5), FLOOR, z - 50, Math.max(xi, xi + side * 0.5), FLOOR + 0.02, z + 50, 0xf2c230, { plain: true });
        plat.box(Math.min(xi + side * 0.6, xo), FLOOR + 4.6, z - 40, Math.max(xi + side * 0.6, xo), FLOOR + 4.9, z + 40, 0x6f757c, { plain: true });
        for (const pz of [-36, -12, 12, 36]) plat.box(xo - side * 0.6 - 0.15, FLOOR, z + pz - 0.15, xo - side * 0.6 + 0.15, FLOOR + 4.6, z + pz + 0.15, 0x55595f, { plain: true });
        const board = stationBoard(st);
        for (const bz of [-24, 24]) {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.64), board);
          m.position.set(xi + side * 1.6, FLOOR + 3.2, z + bz);
          m.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
          scene.add(m);
        }
      }
      // Stairs from the east platform down to the street.
      const sx0 = X + CITY.HALF + 0.2, sx1 = sx0 + 1.8;
      for (let k = 0; k < 10; k++) plat.box(sx0, 0, z + 50 + k * 1.6, sx1, FLOOR - (k + 1) * ((FLOOR - CITY.CURB) / 10), z + 50 + (k + 1) * 1.6, 0x9b978e, { plain: true });
      st.entrance = { x: X + CITY.HALF + 3.4, z };
      st.platform = { down: { x: X - 6.6, z }, up: { x: X + 6.6, z } };
    }
    const platMesh = plat.mesh(world.plainMat);
    platMesh.castShadow = platMesh.receiveShadow = true;
    scene.add(platMesh);

    // Trains.
    const middle = coachGeometry(false), cab = coachGeometry(true);
    for (let k = 0; k < TRAINS; k++) {
      const group = new THREE.Group(), coaches = [];
      for (let c = 0; c < COACHES; c++) {
        const m = new THREE.Mesh(c === 0 || c === COACHES - 1 ? cab : middle, coachMat);
        m.castShadow = true;
        if (c === 0) m.rotation.y = Math.PI; // cabs face outwards at both ends
        m.position.z = (c - (COACHES - 1) / 2) * (COACH_L + GAP);
        group.add(m);
        coaches.push(m);
      }
      const boards = [];
      for (const end of [1, -1]) {
        const b = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.42), new THREE.MeshBasicMaterial({ map: boardTexture('') }));
        b.position.set(0, 3.75, end * ((COACHES * (COACH_L + GAP)) / 2 - 0.2));
        if (end < 0) b.rotation.y = Math.PI;
        group.add(b);
        boards.push(b);
      }
      scene.add(group);
      trains.push({ group, coaches, boards, dest: '' });
    }
  }

  // Move every train to where the timetable says it is.
  function update(t, near) {
    trains.forEach((tr, k) => {
      const st = state(k, t);
      const z = Z0 - st.s;
      tr.group.visible = !near || Math.abs(z - near.z) < 700;
      if (!tr.group.visible) return;
      // The coaches face along the direction of travel.
      tr.group.position.set(trackX(st.dir), DECK + 0.3, z);
      tr.group.rotation.y = headingFor(st.dir);
      const dest = st.dir === 'down' ? 'DAHANU ROAD' : 'CHURCHGATE';
      if (tr.dest !== dest) {
        tr.dest = dest;
        for (const b of tr.boards) { b.material.map.dispose(); b.material.map = boardTexture(dest); b.material.needsUpdate = true; }
      }
    });
  }

  // Standing in the doorway of coach 2 on the platform side.
  function riderSpot(k, t) {
    const st = state(k, t), z = Z0 - st.s, f = st.dir === 'down' ? -1 : 1;
    // The platforms are outside the tracks, so the door faces west on the down track and east on the up.
    const side = st.dir === 'down' ? -1 : 1;
    return { x: trackX(st.dir) + side * 1.7, y: FLOOR - 0.45, z: z + f * (COACH_L + GAP) * 0.5, h: side * Math.PI / 2, v: st.v, state: st };
  }

  return {
    X, DECK, FLOOR, stations, build, update, state, nextArrival, riderSpot, cycle: () => cycle,
    trains: () => trains.length,
    position(k, t) { const st = state(k, t); return { x: trackX(st.dir), z: Z0 - st.s, st }; },
  };
})();
