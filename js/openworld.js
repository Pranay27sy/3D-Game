'use strict';

// Open world Mumbai, Colaba to Boisar. Get in and out of cars, take any car,
// ride the local train, earn cash from jobs, collect hidden packages, hit the
// stunt ramps, and stay ahead of the police. Busted or wasted costs cash and
// puts you back on foot.
const JOB_TYPES = {
  taxi: { name: 'Taxi fares', color: 0xf2c230, icon: 'T' },
  delivery: { name: 'Express delivery', color: 0xf08a24, icon: 'D' },
  race: { name: 'Street race', color: 0xd04fd0, icon: 'R' },
};
const BLIP_COLORS = { police: '#4f8dff', hospital: '#ff5a5a', spray: '#ff9a2a', taxi: '#f2c230', delivery: '#f08a24', race: '#d04fd0', goal: '#3ce07a', waypoint: '#ffffff', friend: '#ffffff', station: '#b0303c' };
const BLIP_ICONS = { police: 'P', hospital: 'H', spray: 'S', taxi: 'T', delivery: 'D', race: 'R', station: 'L' };
const SPRAY_COST = 150;

function money(n) { return `₹${Math.round(n).toLocaleString('en-IN')}`; }

class OpenWorld {
  constructor(game, { net = false, police = true, start = null, keepPlayer = false } = {}) {
    this.game = game;
    this.type = 'open';
    this.net = net;
    this.meta = { name: 'Mumbai', tag: 'Open world' };
    this.level = 0;
    this.elapsed = 0;
    this.crashes = 0;
    this.redLights = 0;
    this.statics = [];
    this.markers = [];
    this.job = null;
    this.cooldown = new Map();
    this.sprayCooldown = 0;
    this.respawn = 0;
    this.crimeCooldown = 0;
    this.goal = null;
    this.rail = null;        // { stage: 'wait' | 'ride', station, dir, k, getOff }
    this.chatTimer = 2;
    this.shoutTimer = 0;

    const P = (this.police = new Police(game));
    P.enabled = police;
    P.onChange = (lvl) => { game.toast(`Wanted: ${'★'.repeat(lvl)}`, 'bad'); Feel.buzz(60); };
    P.onLost = () => game.toast('You lost the police', 'good');

    game.world.curbsSolid = false;
    this.spawnParked();
    this.buildMarkers();
    if (!keepPlayer) {
      const s = start || game.world.home;
      this.spawnInOwnCar(s.x, s.z, s.h);
    }
  }

  // ---------- Setup ----------
  spawnParked() {
    const { world, scene } = this.game;
    const spots = world.parkingSpots.slice().sort(() => Math.random() - 0.5).slice(0, 11);
    const kinds = ['sports', 'sedan', 'van', 'sedan', 'taxi', 'sports', 'sedan', 'van', 'sedan', 'sedan', 'sports'];
    spots.forEach((s, k) => {
      const type = kinds[k % kinds.length];
      this.statics.push(new ParkedCar(scene, type, PAINTS[k % PAINTS.length].hex, s.x, s.z, s.h));
    });
    const yard = world.info.find((b) => b.district === 'stunts');
    if (yard) {
      this.statics.push(new ParkedCar(scene, 'sports', 0xf2c230, yard.x0 + 8, yard.z0 + 40, headingOf(0)));
      this.statics.push(new ParkedCar(scene, 'sports', 0x1f5fbf, yard.x0 + 8, yard.z0 + 46, headingOf(0)));
    }
  }

  buildMarkers() {
    const { world, scene } = this.game;
    this.jobMarkers = world.jobSpots.map((s) => {
      const m = makeBeam(JOB_TYPES[s.type].color);
      m.scale.set(0.8, 0.5, 0.8);
      m.position.set(s.x, 0, s.z);
      scene.add(m);
      this.markers.push(m);
      return m;
    });
    for (const lm of world.landmarks.filter((l) => l.type === 'spray')) {
      const m = makeBeam(0xff9a2a);
      m.scale.set(0.9, 0.4, 0.9);
      m.position.set(lm.x, 0, lm.z);
      scene.add(m);
      this.markers.push(m);
    }
    // Railway station entrances.
    for (const st of Rail.stations) {
      const m = makeBeam(0xb0303c);
      m.scale.set(0.45, 0.25, 0.45);
      m.position.set(st.entrance.x, CITY.CURB, st.entrance.z);
      scene.add(m);
      this.markers.push(m);
    }
    // Hidden packages: small glowing crates.
    const found = new Set(Save.data.packages || []);
    const geo = new THREE.BoxGeometry(0.6, 0.6, 0.6), mat = new THREE.MeshStandardMaterial({ color: 0x3ce07a, emissive: 0x1f8a46, emissiveIntensity: 0.8 });
    this.packageMeshes = world.packages.map((p, k) => {
      if (found.has(k)) return null;
      const m = new THREE.Mesh(geo, mat);
      m.position.set(p.x, p.y + 0.6, p.z);
      scene.add(m);
      this.markers.push(m);
      return m;
    });
  }

  spawnInOwnCar(x, z, h) {
    const g = this.game;
    g.player.look(Save.data.car || 'sedan', currentPaint().hex);
    g.player.reset(x, z, h);
    g.player.unlimitedFuel = true;
    g.walker.reset(x, z, h);
    setAvatar('car');
  }

  dispose() {
    for (const m of this.markers) this.game.scene.remove(m);
    for (const c of this.statics) c.remove();
    this.statics = [];
    this.police.removeAll();
    this.clearJob();
    this.closeTrainPanel();
    this.game.world.curbsSolid = true;
    Sound.setSiren(0);
  }

  // ---------- Getting in and out ----------
  exitCar() {
    const { player, walker, scene } = this.game;
    if (Math.abs(player.v) > 6) { this.game.toast('Slow down to get out'); return; }
    const pc = new ParkedCar(scene, player.type, player.color, player.x, player.z, player.h, player.damage);
    pc.wrecked = player.wrecked;
    this.statics.push(pc);
    this.trimParked();
    // Step out on the driver's side: the right, in India.
    const f = player.forward, health = walker.health, out = player.W / 2 + 0.7;
    walker.reset(player.x - f.z * out, player.z + f.x * out, player.h);
    walker.health = health;
    if (this.job && this.job.type !== 'race') this.endJob(false, 'You left the car.');
    setAvatar('foot');
  }

  // Cars you could climb into right now, nearest first.
  enterable() {
    const { walker, traffic } = this.game;
    const near = [];
    const consider = (c, kind) => {
      const d = Math.hypot(c.x - walker.x, c.z - walker.z);
      if (d < 3.8) near.push({ c, kind, d });
    };
    for (const c of this.statics) if (!c.wrecked) consider(c, 'parked');
    for (const c of traffic.cars) if (Math.abs(c.v) < 9 && !c.taken) consider(c, 'traffic');
    for (const c of this.police.cars) if (Math.abs(c.v) < 4 && !c.wrecked) consider(c, 'police');
    return near.sort((a, b) => a.d - b.d);
  }

  enterNearest() {
    const pick = this.enterable()[0];
    if (!pick) { this.game.toast('No car close enough'); return; }
    const { player, traffic, peds } = this.game;
    const c = pick.c;
    let type = c.type, color = c.color, damage = 0;
    if (pick.kind === 'parked') {
      damage = c.damage;
      c.remove();
      this.statics.splice(this.statics.indexOf(c), 1);
    } else if (pick.kind === 'traffic') {
      if (this.net && !MP.isHost) {
        traffic.hidePuppet(c);
        Net.send({ t: 'takeCar', i: traffic.cars.indexOf(c), to: MP.hostId });
      } else {
        traffic.take(c, this.game.walker);
      }
      const driver = peds.spawnDriver(c.x, c.z, c.h);
      Speech.say('thief', driver, this.game.walker);
      this.police.crime(type === 'police' ? 2 : 1, c.x, c.z, type !== 'police');
      this.game.toast(type === 'police' ? 'You stole a police car!' : `You took a ${VEHICLES[type].name.toLowerCase()}`);
    } else {
      c.remove();
      this.police.cars.splice(this.police.cars.indexOf(c), 1);
      this.police.crime(2, c.x, c.z);
      this.game.toast('You stole a police car!', 'bad');
    }
    const x = c.x, z = c.z, h = c.h;
    player.look(type, color);
    player.reset(x, z, h);
    player.damage = damage;
    player.unlimitedFuel = true;
    setAvatar('car');
  }

  trimParked() {
    const me = actor();
    while (this.statics.length > 22) {
      let far = 0, fd = -1;
      this.statics.forEach((c, k) => { const d = Math.hypot(c.x - me.x, c.z - me.z); if (d > fd) { fd = d; far = k; } });
      this.statics[far].remove();
      this.statics.splice(far, 1);
    }
  }

  // ---------- Crimes ----------
  onCrash(e) {
    const p = this.game.player;
    this.crashes++;
    if (this.crimeCooldown > 0) return;
    if (e.what === 'police' && (e.closing || 0) > 3) { this.police.crime(1, p.x, p.z); this.crimeCooldown = 3; }
    else if (e.what === 'car' && (e.closing || 0) > 9) { this.police.crime(1, p.x, p.z, true); this.crimeCooldown = 3; }
  }

  onRedLight() {
    this.redLights++;
    const p = this.game.player;
    this.police.crime(1, p.x, p.z, true);
  }

  onPedHit(ped, vehicle) {
    if (vehicle !== this.game.player) return;
    Speech.say('hit', ped, actor(), { priority: true });
    const witness = this.game.peds.list.find((q) => q !== ped && q.state !== 'down' && Math.hypot(q.x - ped.x, q.z - ped.z) < 20);
    if (witness) setTimeout(() => Speech.say('witness', witness, actor()), 1200);
    this.police.crime(1, ped.x, ped.z);
    this.game.peds.scare(ped.x, ped.z, 25);
    Feel.buzz(50);
  }

  onLand(air) {
    if (air < 0.9) return;
    const cash = Math.round(air * 70);
    addCash(cash, `Stunt jump! ${air.toFixed(1)} s in the air`);
  }

  onExplode() {
    if (this.game.avatar === 'car') this.down('WASTED', 'hospital', 'Your car blew up.');
    this.game.peds.scare(this.game.player.x, this.game.player.z, 40);
  }

  // ---------- Busted / wasted ----------
  down(title, where, reason) {
    if (this.respawn > 0) return;
    const lost = title === 'BUSTED' ? Math.min(Save.data.coins, Math.max(50, Math.round(Save.data.coins * 0.1))) : Math.min(Save.data.coins, 100);
    Save.data.coins -= lost;
    Save.store();
    showBanner(title, `${reason} ${lost ? `You lost ${money(lost)}.` : ''}`.trim());
    Sound.chime(false);
    Feel.buzz(200);
    this.respawn = 3;
    this.respawnAt = where;
    this.clearJob();
  }

  doRespawn() {
    const g = this.game, me = actor();
    const spots = g.world.landmarks.filter((l) => l.type === this.respawnAt);
    let best = spots[0];
    for (const s of spots) if (Math.hypot(s.walk.x - me.x, s.walk.z - me.z) < Math.hypot(best.walk.x - me.x, best.walk.z - me.z)) best = s;
    this.police.removeAll();
    if (g.avatar === 'car' && this.respawnAt === 'police') { /* the car is impounded */ }
    g.walker.reset(best.walk.x, best.walk.z, best.h + Math.PI);
    setAvatar('foot');
    hideBanner();
  }

  // ---------- Jobs ----------
  startJob(spot) {
    const g = this.game, w = g.world, me = g.player;
    const far = (minD, maxD) => w.lanePointAround(me.x, me.z, minD, maxD);
    const job = { type: spot.type, spot, elapsed: 0, startDamage: me.damage, chain: 0 };
    if (spot.type === 'race') {
      job.points = [];
      let from = { x: me.x, z: me.z };
      for (let k = 0; k < 5; k++) {
        const p = w.lanePointAround(from.x, from.z, 110, 190);
        job.points.push(p);
        from = p;
      }
      job.cp = 0;
      job.timeLimit = job.points.reduce((s, p, k) => s + Math.abs(p.x - (k ? job.points[k - 1].x : me.x)) + Math.abs(p.z - (k ? job.points[k - 1].z : me.z)), 0) / 13 + 12;
    } else {
      const d = spot.type === 'taxi' ? far(160, 340) : far(220, 420);
      job.dest = d;
      const dist = Math.abs(d.x - me.x) + Math.abs(d.z - me.z);
      job.dist = dist;
      job.timeLimit = spot.type === 'taxi' ? dist / 9 + 25 : dist / 11 + 18;
    }
    this.job = job;
    this.showJobMarker();
    Sound.chime(true);
    const intro = { taxi: 'Passenger picked up. Drive them to the green marker.', delivery: 'Package loaded. It is fragile: crash too hard and it breaks.', race: 'Race! Drive through all 5 checkpoints before time runs out.' };
    g.toast(intro[spot.type], 'good');
    if (spot.type === 'taxi') Speech.say('fareStart', g.player, g.player, { height: 3 });
  }

  showJobMarker() {
    if (this.jobBeam) this.game.scene.remove(this.jobBeam);
    const j = this.job;
    const p = j.type === 'race' ? j.points[j.cp] : j.dest;
    const m = makeBeam(j.type === 'race' ? 0xf2c230 : 0x3ce07a);
    m.position.set(p.x, 0, p.z);
    this.game.scene.add(m);
    this.jobBeam = m;
    this.goal = { x: p.x, z: p.z };
  }

  clearJob() {
    if (this.jobBeam) this.game.scene.remove(this.jobBeam);
    this.jobBeam = null;
    this.job = null;
    this.goal = null;
  }

  endJob(ok, reason, pay = 0) {
    const j = this.job;
    if (!j) return;
    this.cooldown.set(j.spot, 20);
    this.clearJob();
    if (ok) addCash(pay, reason);
    else { this.game.toast(reason, 'bad'); Sound.chime(false); }
  }

  updateJob(dt) {
    const j = this.job, p = this.game.player;
    j.elapsed += dt;
    const left = j.timeLimit - j.elapsed;
    if (left <= 0) { this.endJob(false, j.type === 'taxi' && j.chain ? `Out of time. Fares completed: ${j.chain}.` : 'Out of time.'); return; }
    if (p.wrecked) { this.endJob(false, 'Your car is wrecked.'); return; }
    if (j.type === 'delivery' && p.damage - j.startDamage > 22) { this.endJob(false, 'The package broke. Drive more carefully.'); return; }
    const target = j.type === 'race' ? j.points[j.cp] : j.dest;
    const d = Math.hypot(p.x - target.x, p.z - target.z);
    if (j.type === 'race') {
      if (d < 8) {
        j.cp++;
        Sound.coin();
        if (j.cp >= j.points.length) { this.endJob(true, `Race won with ${left.toFixed(1)} s to spare!`, 150 + Math.round(left * 8)); return; }
        this.showJobMarker();
      }
    } else if (d < 6 && Math.abs(p.v) < 3) {
      const tip = Math.max(0, Math.round(left * 2 - (p.damage - j.startDamage)));
      if (j.type === 'taxi') {
        const fare = Math.round(30 + j.dist * 0.16 + tip + j.chain * 15);
        addCash(fare, `Fare paid${tip ? ` with a ${money(tip)} tip` : ''}`);
        Speech.say('fareEnd', p, p, { height: 3 });
        // Next passenger straight away.
        j.chain++;
        j.dest = this.game.world.lanePointAround(p.x, p.z, 160, 340);
        j.dist = Math.abs(j.dest.x - p.x) + Math.abs(j.dest.z - p.z);
        j.timeLimit = j.dist / 9 + 25;
        j.elapsed = 0;
        j.startDamage = p.damage;
        this.showJobMarker();
        this.game.toast(`Next fare (${j.chain + 1}). Drive to the green marker.`);
      } else {
        this.endJob(true, 'Delivered on time!', Math.round(80 + j.dist * 0.25 + tip));
      }
    }
  }

  // ---------- The local train ----------
  nearStation() {
    const w = this.game.walker;
    return Rail.stations.find((st) => Math.hypot(st.entrance.x - w.x, st.entrance.z - w.z) < 5);
  }

  openTrainPanel(st) {
    this.panelStation = st;
    setText($('train-station'), `${st.name} · ${st.marathi}`);
    show('train-panel', true);
    this.game.menuOpen = true;
    this.renderTrainPanel();
  }

  renderTrainPanel() {
    const st = this.panelStation;
    if (!st) return;
    for (const dir of ['up', 'down']) {
      const btn = $(`btn-train-${dir}`);
      const ok = dir === 'up' ? st.i > 0 : st.i < Rail.stations.length - 1;
      btn.hidden = !ok;
      if (ok) {
        const a = Rail.nextArrival(st.i, dir, this.game.t);
        setText(btn.querySelector('.eta'), a.eta < 1 ? 'At the platform now' : `Next train in ${fmtTime(a.eta)}`);
      }
    }
  }

  closeTrainPanel() {
    if (!$('train-panel').hidden) { show('train-panel', false); this.game.menuOpen = false; }
    this.panelStation = null;
  }

  // Go up to the platform for trains towards Churchgate ('up') or Dahanu Road ('down').
  waitFor(dir) {
    const st = this.panelStation, w = this.game.walker;
    this.closeTrainPanel();
    const p = st.platform[dir];
    w.x = p.x; w.z = p.z; w.y = Rail.FLOOR;
    w.h = dir === 'down' ? Math.PI / 2 : -Math.PI / 2;
    w.speed = 0;
    w.pose();
    this.rail = { stage: 'wait', station: st.i, dir, getOff: -1 };
    this.game.toast(`Platform for trains to ${dir === 'down' ? 'Dahanu Road' : 'Churchgate'}`);
  }

  leavePlatform() {
    this.alight(Rail.stations[this.rail.station], true);
  }

  alight(st, quiet = false) {
    const w = this.game.walker, health = w.health;
    this.rail = null;
    w.reset(st.entrance.x, st.entrance.z, Math.PI / 2);
    w.health = health;
    if (!quiet) this.game.toast(`You got off at ${st.name} · ${st.marathi}`, 'good');
  }

  updateRail() {
    const r = this.rail, w = this.game.walker, t = this.game.t;
    if (r.stage === 'wait') {
      for (let k = 0; k < Rail.trains(); k++) {
        const s = Rail.state(k, t);
        if (s.dwell === r.station && s.dir === r.dir && s.left > 1.5) {
          Object.assign(r, { stage: 'ride', k, dwelling: true });
          this.game.toast('All aboard! Hold on at the door.', 'good');
          Feel.buzz(30);
          break;
        }
      }
      w.pose();
      return;
    }
    const spot = Rail.riderSpot(r.k, t), s = spot.state;
    w.x = spot.x; w.z = spot.z; w.y = spot.y; w.h = spot.h; w.speed = 0; w.v = s.v;
    w.pose();
    if (cam.manual <= 0) cam.yaw = (s.dir === 'down' ? Math.PI : 0) + (s.dir === 'down' ? 0.55 : -0.55);
    if (s.dwell >= 0) {
      if (!r.dwelling) {
        r.dwelling = true;
        const st = Rail.stations[s.dwell];
        this.game.toast(`${st.name} · ${st.marathi}`);
      }
      // Off at the chosen stop, or at the end of the line where the train turns round.
      if (r.getOff === s.dwell || s.dir !== r.dir) this.alight(Rail.stations[s.dwell]);
    } else if (r.dwelling) {
      r.dwelling = false;
      const nx = Rail.stations[s.next];
      Speech.announce(`पुढील स्थानक ${nx.marathi}`);
      this.game.toast(`Next station: ${nx.name} · पुढील स्थानक: ${nx.marathi}`);
    }
  }

  // What the context button does right now: get in or out, take the train, get off.
  context() {
    const g = this.game;
    if (this.respawn > 0) return null;
    if (this.rail) {
      if (this.rail.stage === 'wait') return { label: 'Leave the platform', run: () => this.leavePlatform() };
      const s = Rail.state(this.rail.k, g.t);
      if (s.dwell >= 0) return { label: 'Get off here', run: () => this.alight(Rail.stations[s.dwell]) };
      if (this.rail.getOff === s.next) return { label: `Getting off at ${Rail.stations[s.next].name} ✓`, run: () => { this.rail.getOff = -1; } };
      return { label: `Get off at ${Rail.stations[s.next].name}`, run: () => { this.rail.getOff = s.next; } };
    }
    if (g.avatar === 'car') return Math.abs(g.player.v) <= 6 ? { label: 'Get out', run: () => this.exitCar() } : null;
    const st = this.nearStation();
    if (st) return { label: 'Take the local', run: () => this.openTrainPanel(st) };
    const near = this.enterable()[0];
    if (!near) return null;
    return { label: near.kind === 'parked' ? 'Get in' : near.kind === 'police' || near.c.isPolice ? 'Steal police car' : 'Take car', run: () => this.enterNearest() };
  }

  // On a platform or a train, the train moves you, not the controls.
  controlsPlayer() { return !!this.rail; }

  // ---------- Every frame ----------
  frozen() { return this.respawn > 0; }

  update(dt) {
    const g = this.game, me = actor(), inCar = g.avatar === 'car';
    this.elapsed += dt;
    this.crimeCooldown = Math.max(0, this.crimeCooldown - dt);
    this.sprayCooldown = Math.max(0, this.sprayCooldown - dt);
    for (const [s, t] of this.cooldown) this.cooldown.set(s, t - dt);

    if (this.respawn > 0) {
      this.respawn -= dt;
      if (this.respawn <= 0) this.doRespawn();
      return null;
    }

    if (this.rail) this.updateRail();
    if (this.panelStation && Math.floor(this.elapsed * 2) !== Math.floor((this.elapsed - dt) * 2)) this.renderTrainPanel();
    // Up on the railway the police can't reach you, and they lose sight of you.
    const target = { x: me.x, z: me.z, h: me.h, v: me.v, inCar, hidden: !!this.rail };
    const others = g.traffic.cars.concat(this.statics, [inCar ? g.player : g.walker], MP.obstacles());
    if (this.police.update(dt, target, others) === 'busted') this.down('BUSTED', 'police', 'The police caught you.');
    Sound.setSiren(clamp(1 - this.police.nearestDistance(me.x, me.z) / 130, 0, 1));

    if (!inCar && g.walker.health <= 0) this.down('WASTED', 'hospital', 'You were run over.');

    // Mumbaikars chat as you walk past; police shout when they're close.
    this.chatTimer -= dt;
    if (!inCar && !this.rail && this.chatTimer <= 0) {
      this.chatTimer = 5 + Math.random() * 6;
      let best = null, bd = 8;
      for (const p of g.peds.list) {
        if (p.state !== 'walk') continue;
        const d = Math.hypot(p.x - me.x, p.z - me.z);
        if (d < bd) { bd = d; best = p; }
      }
      if (best) Speech.say('chat', best, me);
    }
    this.shoutTimer -= dt;
    if (this.police.level > 0 && this.shoutTimer <= 0) {
      const cop = this.police.cars.find((c) => !c.wrecked && Math.hypot(c.x - me.x, c.z - me.z) < 30);
      if (cop) { Speech.say('police', cop, me, { height: 2.6 }); this.shoutTimer = 7; }
    }

    // Job markers start jobs when you drive into them.
    if (this.job) this.updateJob(dt);
    else if (inCar) {
      for (const s of g.world.jobSpots) {
        if ((this.cooldown.get(s) || 0) > 0) continue;
        if (Math.hypot(s.x - me.x, s.z - me.z) < 6 && Math.abs(me.v) < 6) { this.startJob(s); break; }
      }
    }
    this.jobMarkers.forEach((m, k) => { m.visible = !this.job && (this.cooldown.get(g.world.jobSpots[k]) || 0) <= 0; });
    if (this.jobBeam) this.jobBeam.userData.ring.scale.setScalar(1 + Math.sin(this.elapsed * 4) * 0.06);

    // Spray & Repair: new paint, no damage, and the police lose track of you.
    if (inCar && this.sprayCooldown <= 0) {
      for (const lm of g.world.landmarks) {
        if (lm.type !== 'spray' || Math.hypot(lm.x - me.x, lm.z - me.z) > 7 || Math.abs(me.v) > 4) continue;
        this.sprayCooldown = 6;
        if (this.police.seen) { g.toast('Not while the police can see you!', 'bad'); break; }
        if (Save.data.coins < SPRAY_COST) { g.toast(`A respray costs ${money(SPRAY_COST)}`, 'bad'); break; }
        const colors = PAINTS.map((p) => p.hex).filter((c) => c !== g.player.color);
        const keep = { x: g.player.x, z: g.player.z, h: g.player.h };
        g.player.look(g.player.type === 'police' ? 'sedan' : g.player.type, colors[Math.floor(Math.random() * colors.length)]);
        g.player.reset(keep.x, keep.z, keep.h);
        g.player.unlimitedFuel = true;
        const was = this.police.level;
        this.police.clear();
        addCash(-SPRAY_COST, was ? 'Fresh paint. The police lost track of you.' : 'Repaired and resprayed');
        break;
      }
    }

    // Hidden packages.
    this.packageMeshes.forEach((m, k) => {
      if (!m) return;
      m.rotation.y += dt * 1.5;
      m.position.y = g.world.packages[k].y + 0.6 + Math.sin(this.elapsed * 2 + k) * 0.15;
      if (Math.hypot(m.position.x - me.x, m.position.z - me.z) < 2.3) {
        g.scene.remove(m);
        this.packageMeshes[k] = null;
        Save.data.packages = (Save.data.packages || []).concat(k);
        const n = Save.data.packages.length, total = g.world.packages.length;
        addCash(n === total ? 5000 : 100, n === total ? 'All hidden packages found!' : `Hidden package ${n} of ${total}`);
        Feel.buzz(40);
      }
    });

    if (g.waypoint && Math.hypot(g.waypoint.x - me.x, g.waypoint.z - me.z) < 15) { g.waypoint = null; g.toast('You reached your waypoint'); }
    return null;
  }

  // ---------- HUD ----------
  hud() { return { label: 'Cash', value: money(Save.data.coins), warn: false }; }

  objective() {
    const j = this.job;
    if (j) {
      const left = fmtTime(j.timeLimit - j.elapsed);
      if (j.type === 'race') return `Checkpoint ${j.cp + 1} of ${j.points.length} · ${left}`;
      return `${j.type === 'taxi' ? `Fare ${j.chain + 1}` : 'Delivery'}: green marker · ${left}`;
    }
    if (this.rail) {
      const s = Rail.state(this.rail.k || 0, this.game.t);
      if (this.rail.stage === 'wait') {
        const a = Rail.nextArrival(this.rail.station, this.rail.dir, this.game.t);
        return `Waiting for the local · ${a.eta < 1 ? 'arriving' : fmtTime(a.eta)}`;
      }
      const nx = Rail.stations[s.dwell >= 0 ? s.dwell : s.next];
      return `Local to ${s.dir === 'down' ? 'Dahanu Road' : 'Churchgate'} · ${s.dwell >= 0 ? 'at' : 'next'} ${nx.name}`;
    }
    if (this.police.level) return this.police.searching ? 'Stay out of sight to lose the police' : 'Escape the police!';
    if (this.game.avatar === 'foot') return this.nearStation() ? 'Tap Take the local to ride the train' : 'Walk up to any car, or a station (L)';
    return 'Drive into a T, D or R marker for work';
  }

  navTarget() { return this.goal || this.game.waypoint; }

  blips() {
    const out = [];
    if (!this.job) this.game.world.jobSpots.forEach((s) => out.push({ x: s.x, z: s.z, kind: s.type }));
    for (const lm of this.game.world.landmarks) out.push({ x: lm.x, z: lm.z, kind: lm.type });
    for (const st of Rail.stations) out.push({ x: st.entrance.x, z: st.entrance.z, kind: 'station', label: st.name });
    if (this.goal) out.push({ x: this.goal.x, z: this.goal.z, kind: 'goal' });
    for (const c of this.police.cars) out.push({ x: c.x, z: c.z, kind: 'cop' });
    return out;
  }
}
