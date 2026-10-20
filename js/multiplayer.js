'use strict';

// Multiplayer over Wi-Fi for up to 10 players.
//
// The host's game is the referee: it keeps the player list, simulates the
// traffic and sends it to everyone 10 times a second (with the clock, time of
// day and weather), picks start positions, and ranks finishers. Every phone
// runs its own car or character, its own wanted level and police chase, and
// sends all of that 15 times a second.
//
// Messages (JSON, `t` is the type; the relay adds `from`):
//   hello     player -> host    name and paint when joining
//   lobby     host -> all       player list, mode, host address, phase
//   start     host -> all       mode, destination, start positions, roles, start time
//   car       player -> all     position, car or on foot, vehicle type, police chasing them
//   traffic   host -> all       game clock, time of day, weather and every traffic car
//   hitCar    player -> host    "I hit traffic car i" so it stops and honks
//   takeCar   player -> host    "I took traffic car i" so it leaves traffic
//   horn      player -> all     honk
//   finish    player -> host    race time, or wrecked
//   standings host -> all       race finishing order
//   caught    player -> host    a robber was caught (Cops & Robbers)
//   roles     host -> all       who is a cop and who is a robber
//   crEnd     host -> all       Cops & Robbers result
//   toRoom    host -> all       back to the room after a round
const MAX_PLAYERS = 10;
const CR_DURATION = 240;
const MP_MODES = {
  race: { name: 'Race', blurb: 'Everyone starts together. First to stop at the green marker wins. Each red light adds 5 seconds.', start: 'Start race' },
  roam: { name: 'Open City', blurb: 'The whole open world together: take cars, do jobs, hit the stunt ramps and escape the police.', start: 'Start' },
  cops: { name: 'Cops & Robbers', blurb: 'A third of you drive police cars. Robbers must stay free for 4 minutes. Caught robbers join the police.', start: 'Start chase' },
};

function nameLabel(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10, 43, 87, 0.9)';
  g.beginPath();
  if (g.roundRect) g.roundRect(4, 8, 248, 48, 12); else g.rect(4, 8, 248, 48);
  g.fill();
  g.fillStyle = color;
  g.fillRect(16, 24, 16, 16);
  g.fillStyle = '#f4f6f2';
  g.font = '800 28px Overpass, Arial, sans-serif';
  g.textBaseline = 'middle';
  g.fillText(text.slice(0, 14), 42, 34);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false }));
  sprite.scale.set(4, 1, 1);
  return sprite;
}

// Players who picked the same paint get the next free colour from this list.
const PLAYER_COLORS = [0xd23a3a, 0x1f5fbf, 0xf2c230, 0x2fa35a, 0x8e44c9, 0xff6fae, 0x19b5c9, 0xf08a24, 0x8a5a2b, 0xc9ced4];
const fmtRace = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const cssColor = (hex) => `#${(hex >>> 0).toString(16).padStart(6, '0')}`;
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// A friend: their car or their character, a name tag, and any police chasing them.
class RemotePlayer {
  constructor(scene, info) {
    this.scene = scene;
    this.id = info.id;
    Object.assign(this, { x: 0, z: 0, h: 0, v: 0, y: 0, snap: null, visible: false, mode: 'car', type: 'sedan', siren: false });
    this.cops = [];
    this.label = null;
    this.setInfo(info);
  }

  get L() { return this.mode === 'foot' ? 0.6 : VEHICLES[this.type].L; }
  get W() { return this.mode === 'foot' ? 0.6 : VEHICLES[this.type].W; }

  setInfo(info) {
    const changed = !this.info || this.info.name !== info.name || this.info.paint !== info.paint;
    this.info = info;
    if (!changed) return;
    if (this.label) this.scene.remove(this.label);
    this.label = nameLabel(info.name, cssColor(info.paint));
    this.label.visible = this.visible;
    this.scene.add(this.label);
    if (this.person) this.scene.remove(this.person.group);
    this.person = buildPerson({ skin: SKINS[info.id % SKINS.length], shirt: info.paint, pants: 0x2a3442, hair: HAIRS[info.id % HAIRS.length] });
    this.person.group.visible = false;
    this.scene.add(this.person.group);
    this.buildCar();
  }

  buildCar() {
    if (this.car) this.scene.remove(this.car.group);
    this.car = buildCarMesh(this.type, this.info.paint);
    this.car.group.visible = this.visible && this.mode === 'car';
    this.scene.add(this.car.group);
  }

  update(m) {
    const mode = m.m === 'f' ? 'foot' : 'car', type = VEHICLE_IDS[m.ty] || 'sedan';
    if (type !== this.type) { this.type = type; this.buildCar(); }
    if (mode !== this.mode) { this.mode = mode; this.snap = null; }
    setSnap(this, m.x, m.z, m.h, m.v, m.y || 0);
    this.car.tailMat.emissiveIntensity = m.b ? 1.4 : 0.25;
    this.siren = !!m.s;
    this.visible = true;
    this.car.group.visible = mode === 'car';
    this.person.group.visible = mode === 'foot';
    this.label.visible = true;
    // Police chasing this friend, mirrored here.
    const cops = m.cops || [];
    const n = Math.floor(cops.length / 4);
    while (this.cops.length > n) this.scene.remove(this.cops.pop().parts.group);
    while (this.cops.length < n) {
      const c = { x: 0, z: 0, h: 0, v: 0, L: VEHICLES.police.L, W: VEHICLES.police.W, isPolice: true, parts: buildCarMesh('police', 0xffffff) };
      this.scene.add(c.parts.group);
      this.cops.push(c);
    }
    this.cops.forEach((c, k) => setSnap(c, cops[k * 4], cops[k * 4 + 1], cops[k * 4 + 2], cops[k * 4 + 3]));
  }

  frame(dt, t) {
    if (!this.visible || !this.snap) return;
    this.parts = this.mode === 'car' ? this.car : { group: this.person.group, spinners: [] };
    followSnap(this, dt);
    if (this.mode === 'foot') {
      this.phase = (this.phase || 0) + Math.abs(this.v) * dt * 3.3;
      posePerson(this.person, this.phase, Math.min(0.95, Math.abs(this.v) * 0.22), 'walk');
    }
    flashBar(this.car, t, this.siren);
    this.label.position.set(this.x, this.y + (this.mode === 'car' ? 2.9 : 2.4), this.z);
    for (const c of this.cops) { followSnap(c, dt); flashBar(c.parts, t, true); }
  }

  hide() {
    this.visible = false;
    this.snap = null;
    this.car.group.visible = this.person.group.visible = this.label.visible = false;
    for (const c of this.cops) this.scene.remove(c.parts.group);
    this.cops = [];
  }

  remove() {
    this.hide();
    this.scene.remove(this.car.group, this.person.group, this.label);
  }
}

// The mission object for a multiplayer round; main.js drives it like any other.
// Open City and Cops & Robbers run the open world inside it.
class NetRound {
  constructor(game, msg) {
    this.game = game;
    this.type = msg.mode;
    this.meta = { name: MP_MODES[msg.mode].name, tag: 'Multiplayer' };
    this.level = 0;
    this.raceId = msg.raceId;
    this.startAt = msg.startAt;
    this.duration = msg.duration || 0;
    this.elapsed = 0;
    this.crashes = 0;
    this.redLights = 0;
    this.ownStatics = [];
    this.markers = [];
    this.done = null;
    this.catchTimer = 0;
    this.goEl = $('countdown');
    this.carType = msg.mode === 'cops' && MP.roles[MP.myId] === 'cop' ? 'police' : null;
    if (msg.mode === 'race') {
      this.goal = msg.goal;
      const m = makeBeam(0x3ce07a);
      m.position.set(msg.goal.x, 0, msg.goal.z);
      game.scene.add(m);
      this.markers.push(m);
      this.beam = m;
    }
  }

  // Called once the player is in place.
  setup() {
    if (this.type !== 'race') this.world = new OpenWorld(this.game, { net: true, police: this.type === 'roam', keepPlayer: true });
  }

  get statics() { return this.world ? this.world.statics : this.ownStatics; }
  get police() { return this.world ? this.world.police : null; }
  get role() { return MP.roles[MP.myId]; }
  get penalty() { return this.redLights * 5; }
  frozen() { return this.game.t < this.startAt || (this.world ? this.world.frozen() : false); }

  update(dt) {
    const p = this.game.player, wait = this.startAt - this.game.t;
    if (wait > 0) {
      this.goEl.hidden = false;
      setText(this.goEl, String(Math.ceil(wait)));
      return null;
    }
    if (wait > -0.8) { this.goEl.hidden = false; setText(this.goEl, 'GO!'); } else this.goEl.hidden = true;
    this.elapsed += dt;
    if (this.world) this.world.update(dt);

    if (this.type === 'race') {
      if (this.beam) this.beam.userData.ring.scale.setScalar(1 + Math.sin(this.elapsed * 4) * 0.06);
      if (p.damage >= 100) this.done = { ok: false, reason: 'Your car is wrecked.' };
      if (this.goal && !this.done && Math.hypot(p.x - this.goal.x, p.z - this.goal.z) < 5.5) {
        if (Math.abs(p.v) < 3) this.done = { ok: true };
        else if (!this.slowWarned) { this.slowWarned = true; this.game.toast('Slow down and stop at the marker'); }
      }
      this.position = this.racePosition();
      return this.done;
    }

    if (this.type === 'cops' && this.role === 'robber') {
      // Caught when a cop stays right next to you.
      const me = actor();
      const close = MP.remoteList().some((r) => MP.roles[r.id] === 'cop' && Math.hypot(r.x - me.x, r.z - me.z) < (r.mode === 'car' && this.game.avatar === 'car' ? 6.5 : 3.5));
      this.catchTimer = close ? this.catchTimer + dt : Math.max(0, this.catchTimer - dt);
      if (this.catchTimer > 1.5) {
        this.catchTimer = 0;
        MP.caught(MP.myId, this.elapsed);
      }
    }
    return null;
  }

  racePosition() {
    const me = actor(), mine = Math.hypot(me.x - this.goal.x, me.z - this.goal.z);
    let ahead = MP.results.filter((r) => !r.dnf).length;
    for (const r of MP.remoteList()) {
      if (MP.results.some((x) => x.id === r.id) || !MP.roundPlayers.includes(r.id)) continue;
      if (Math.hypot(r.x - this.goal.x, r.z - this.goal.z) < mine) ahead++;
    }
    return { place: ahead + 1, of: MP.roundPlayers.length };
  }

  onCrash(e) { this.crashes++; if (this.world) this.world.onCrash(e); }
  onRedLight() {
    if (this.world) { this.world.onRedLight(); return; }
    this.redLights++;
    this.game.toast('Red light: +5 seconds', 'bad');
  }
  onPedHit(ped, v, s) { if (this.world) this.world.onPedHit(ped, v, s); }
  onLand(air) { if (this.world) this.world.onLand(air); }
  onExplode() {
    if (this.world) this.world.onExplode();
    else this.done = { ok: false, reason: 'Your car blew up.' };
  }

  hud() {
    if (this.type === 'roam') return this.world.hud();
    if (this.type === 'cops') {
      const left = this.duration - Math.max(0, this.elapsed);
      return { label: this.role === 'cop' ? 'Police · time left' : 'Robber · stay free', value: fmtTime(left), warn: left < 20 };
    }
    return { label: 'Race time', value: fmtRace(Math.max(0, this.elapsed) + this.penalty), warn: false };
  }

  objective() {
    if (this.game.t < this.startAt) return this.type === 'cops' ? (this.role === 'cop' ? 'You are the police. Get ready…' : 'You are a robber. Get ready…') : 'Get ready…';
    if (this.type === 'roam') return this.world.objective();
    if (this.type === 'cops') {
      const robbers = Object.values(MP.roles).filter((r) => r === 'robber').length;
      return this.role === 'cop' ? `Catch the robbers: stay right next to them · ${robbers} left` : `Stay away from the police cars · ${robbers} robbers free`;
    }
    const pos = this.position;
    return pos ? `${ordinal(pos.place)} of ${pos.of} · first to stop at the green marker wins` : 'First to stop at the green marker wins';
  }

  navTarget() {
    if (this.world) return this.world.navTarget();
    return this.goal;
  }

  blips() { return this.world ? this.world.blips() : this.goal ? [{ x: this.goal.x, z: this.goal.z, kind: 'goal' }] : []; }

  // In Cops & Robbers, police only see robbers on the map when they're close.
  showsOnMap(r) {
    if (this.type !== 'cops' || this.role !== 'cop' || MP.roles[r.id] !== 'robber') return true;
    return Math.hypot(r.x - actor().x, r.z - actor().z) < 90;
  }

  dispose() {
    for (const m of this.markers) this.game.scene.remove(m);
    if (this.world) this.world.dispose();
    this.goEl.hidden = true;
  }
}

const MP = {
  active: false,
  isHost: false,
  myId: 0,
  hostId: 0,
  url: '',
  players: new Map(),   // id -> { id, name, paint }
  remotes: new Map(),   // id -> RemotePlayer
  roles: {},            // Cops & Robbers: id -> 'cop' | 'robber'
  mode: 'roam',
  phase: 'lobby',       // lobby | running
  addresses: [],
  raceId: 0,
  results: [],
  roundPlayers: [],
  sendTimer: 0,
  snapTimer: 0,
  lastTraffic: 0,
  leaving: false,

  me() { return { id: this.myId, name: this.name(), paint: currentPaint().hex }; },
  myPaint() { const p = this.players.get(this.myId); return p ? p.paint : currentPaint().hex; },
  name() { return (Save.data.name || '').trim() || 'Driver'; },
  remoteList() { return this.active ? [...this.remotes.values()].filter((r) => r.visible) : []; },
  // Friends plus the police chasing them: things your car can hit.
  obstacles() {
    if (!this.active) return [];
    const out = [];
    for (const r of this.remotes.values()) if (r.visible) { out.push(r); for (const c of r.cops) out.push(c); }
    return out;
  },
  mapPlayers() {
    const m = game.mission;
    return this.remoteList().filter((r) => !(m && m.showsOnMap) || m.showsOnMap(r));
  },

  // ---------- Setup screen ----------
  open() {
    Sound.init();
    if (!Save.data.name) Save.data.name = `Driver ${10 + Math.floor(Math.random() * 90)}`;
    $('mp-name').value = Save.data.name;
    $('mp-address').value = Save.data.lastHost || '';
    this.error('');
    show('menu', false);
    show('lobby', true);
    show('lobby-setup', true);
    show('lobby-room', false);
    this.scan();
  },

  error(msg) { $('mp-error').textContent = msg; },

  saveName() {
    const n = $('mp-name').value.trim().slice(0, 14);
    Save.data.name = n || 'Driver';
    Save.store();
  },

  async scan() {
    const list = $('mp-found');
    if (!Lan.native) { list.innerHTML = '<p class="found-empty">Automatic search works in the Android app. Type the host address below.</p>'; return; }
    list.innerHTML = '<p class="found-empty">Searching this Wi-Fi for games…</p>';
    const hosts = await Lan.discover();
    if (!hosts.length) { list.innerHTML = '<p class="found-empty">No games found yet. Ask a friend to tap Host a game, then search again.</p>'; return; }
    list.innerHTML = '';
    for (const h of hosts) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'found-game';
      b.innerHTML = `<span class="found-name"></span><span class="found-meta">${h.address} · ${h.players}/${MAX_PLAYERS} players</span>`;
      b.querySelector('.found-name').textContent = `${h.name}'s game`;
      b.addEventListener('click', () => this.joinAddress(h.address));
      list.appendChild(b);
    }
  },

  async host() {
    this.saveName();
    if (!Lan.canHost) { this.error('Hosting needs the Android app, or a computer running npm run lan.'); return; }
    this.error('');
    try {
      const h = await Lan.host(this.name());
      this.addresses = h.addresses;
      await this.connect(h.url, true);
    } catch (e) {
      Lan.stop();
      this.error(`Couldn't start a game on this phone. ${e.message || ''}`.trim());
    }
  },

  async joinAddress(address) {
    this.saveName();
    address = (address || '').trim().replace(/^wss?:\/\//, '').replace(/\/.*$/, '');
    if (!address) { this.error('Type the address shown on the host phone, for example 192.168.43.1'); return; }
    Save.data.lastHost = address;
    Save.store();
    this.error('');
    const url = `ws://${address.includes(':') ? address : `${address}:${GAME_PORT}`}`;
    try {
      await this.connect(url, false);
    } catch (e) {
      this.error(`Couldn't reach a game at ${address}. Check that the host has tapped Host a game and that you're on the same Wi-Fi.`);
    }
  },

  async connect(url, asHost) {
    this.myId = await Net.connect(url);
    this.url = url;
    this.active = true;
    this.leaving = false;
    this.isHost = asHost;
    this.hostId = asHost ? this.myId : 0;
    this.players.clear();
    this.roles = {};
    this.phase = 'lobby';
    this.lastTraffic = performance.now();
    if (asHost) {
      this.players.set(this.myId, this.me());
      this.broadcastLobby();
    } else {
      traffic.clear();
      traffic.onPuppetHit = (i) => Net.send({ t: 'hitCar', i, to: this.hostId });
      Net.send({ t: 'hello', name: this.name(), paint: currentPaint().hex });
    }
    show('lobby-setup', false);
    show('lobby-room', true);
    this.renderRoom();
  },

  // A phone that drops (screen lock, Wi-Fi blip) tries to get back in.
  async reconnect() {
    showToast('Connection lost. Reconnecting…', 'bad');
    for (let k = 0; k < 6 && this.active; k++) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        this.myId = await Net.connect(this.url);
        this.lastTraffic = performance.now();
        Net.send({ t: 'hello', name: this.name(), paint: currentPaint().hex });
        showToast('Reconnected', 'good');
        return;
      } catch (e) { /* try again */ }
    }
    this.end('Lost connection to the game.');
  },

  // ---------- Room ----------
  broadcastLobby() {
    const msg = { t: 'lobby', players: [...this.players.values()], mode: this.mode, addresses: this.addresses, phase: this.phase };
    Net.send(msg);
    this.syncRemotes();
    this.renderRoom();
  },

  syncRemotes() {
    for (const [id, r] of this.remotes) if (!this.players.has(id)) { r.remove(); this.remotes.delete(id); }
    for (const p of this.players.values()) {
      if (p.id === this.myId) continue;
      if (this.remotes.has(p.id)) this.remotes.get(p.id).setInfo(p);
      else this.remotes.set(p.id, new RemotePlayer(scene, p));
    }
  },

  setMode(mode) {
    if (!this.isHost || this.phase !== 'lobby') return;
    this.mode = mode;
    this.broadcastLobby();
  },

  renderRoom() {
    if (!this.active) return;
    const hostName = (this.players.get(this.hostId) || {}).name || 'the host';
    setText($('room-title'), this.isHost ? 'Your game room' : `${hostName}'s game room`);
    const addr = this.addresses.filter((a) => a && a !== 'localhost');
    $('room-address').textContent = this.isHost
      ? (addr.length ? `Friends join at ${addr.join(' or ')}. On the same Wi-Fi or your hotspot, they can also find this game in the search list.` : 'Friends on the same Wi-Fi can find this game in the search list.')
      : 'Waiting for the host to start.';
    for (const b of document.querySelectorAll('#room-modes .mode')) {
      const on = b.dataset.mode === this.mode;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('is-on', on);
      b.disabled = !this.isHost || this.phase !== 'lobby';
    }
    $('room-mode-blurb').textContent = MP_MODES[this.mode].blurb;
    const list = $('room-players');
    list.innerHTML = '';
    for (const p of this.players.values()) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="swatch"></span><span class="pl-name"></span><span class="pl-tag"></span>';
      li.querySelector('.swatch').style.background = cssColor(p.paint);
      li.querySelector('.pl-name').textContent = p.name;
      li.querySelector('.pl-tag').textContent = [p.id === this.hostId ? 'Host' : '', p.id === this.myId ? 'You' : ''].filter(Boolean).join(' · ');
      list.appendChild(li);
    }
    setText($('room-count'), `${this.players.size} of ${MAX_PLAYERS} players`);
    const start = $('btn-room-start');
    start.hidden = !this.isHost;
    start.textContent = MP_MODES[this.mode].start;
    $('room-status').textContent = this.phase === 'running' && !this.isHost
      ? 'A round is in progress. You will join the next one.'
      : this.isHost && this.players.size < 2 ? 'You can start alone, or wait for friends to join.' : '';
  },

  // ---------- Rounds ----------
  // Two cars side by side in the eastbound lane, rows 7 m apart.
  grid(ids, i, j, slots) {
    const { PITCH, HALF } = CITY;
    const n = world.node(i, j), h = headingOf(0);
    ids.forEach((id, k) => {
      const s = PITCH - HALF - 8 - Math.floor(k / 2) * 7;
      slots[id] = [n.x + s, n.z + (k % 2 ? 4.4 : 1.6), h];
    });
    return { x: n.x + PITCH / 2, z: n.z + 3 };
  },

  startRound() {
    if (!this.isHost) return;
    const { N } = CITY;
    const ids = [...this.players.keys()];
    const slots = {}, roles = {};
    const i = Math.floor(Math.random() * N), j = Math.floor(Math.random() * (N + 1));
    let startPos;
    if (this.mode === 'cops') {
      const order = ids.slice().sort(() => Math.random() - 0.5);
      const cops = order.length > 1 ? Math.max(1, Math.round(order.length / 3)) : 0;
      order.forEach((id, k) => { roles[id] = k < cops ? 'cop' : 'robber'; });
      startPos = this.grid(order.filter((id) => roles[id] === 'robber'), i, j, slots);
      // The police start a few blocks away.
      this.grid(order.filter((id) => roles[id] === 'cop'), (i + 3) % N, (j + 3) % (N + 1), slots);
    } else {
      startPos = this.grid(ids, i, j, slots);
    }
    let goal = null;
    if (this.mode === 'race') {
      let best = null, bestD = 0;
      for (let k = 0; k < 300; k++) {
        const g = world.randomLanePoint();
        const d = Math.abs(g.x - startPos.x) + Math.abs(g.z - startPos.z);
        if (d > bestD) { best = g; bestD = d; }
        if (d >= 360 && d <= 620) { best = g; break; }
      }
      goal = { x: best.x, z: best.z };
    }
    traffic.reset(Math.min(44, quality.traffic + ids.length), startPos);
    const msg = { t: 'start', mode: this.mode, goal, slots, roles, startAt: game.t + 4, raceId: ++this.raceId, duration: CR_DURATION };
    Net.send(msg);
    this.beginRound(msg);
  },

  beginRound(m) {
    this.phase = 'running';
    this.raceId = m.raceId;
    if (m.roles && Object.keys(m.roles).length) this.roles = { ...this.roles, ...m.roles };
    const slot = m.slots[this.myId];
    if (!slot) { this.renderRoom(); return; }
    if (!m.to) { this.results = []; this.roundPlayers = Object.keys(m.slots).map(Number); }
    show('lobby', false);
    show('standings', false);
    startNetRound(new NetRound(game, m), slot);
  },

  // Called by main.js when this player's race ends (finished or wrecked).
  localFinish(result) {
    const r = game.mission;
    game.state = 'result';
    $('countdown').hidden = true;
    show('controls', false);
    Sound.chime(result.ok);
    const entry = { id: this.myId, time: Math.round((r.elapsed + r.penalty) * 100) / 100, dnf: !result.ok, raceId: r.raceId };
    if (this.isHost) this.recordFinish(entry);
    else Net.send({ t: 'finish', ...entry, to: this.hostId });
    this.renderStandings();
    show('standings', true);
  },

  recordFinish(e) {
    if (e.raceId !== this.raceId || this.results.some((r) => r.id === e.id)) return;
    const p = this.players.get(e.id);
    if (!p) return;
    this.results.push({ id: e.id, name: p.name, paint: p.paint, time: e.time, dnf: e.dnf });
    this.results.sort((a, b) => (a.dnf - b.dnf) || (a.time - b.time));
    Net.send({ t: 'standings', raceId: this.raceId, list: this.results, players: this.roundPlayers });
    this.onStandings(this.results, e.id);
  },

  onStandings(list, newest) {
    this.results = list;
    const fresh = list.find((r) => r.id === newest);
    if (fresh && newest !== this.myId && !fresh.dnf && game.state === 'playing') {
      const place = list.filter((r) => !r.dnf).indexOf(fresh) + 1;
      showToast(`${fresh.name} finished ${ordinal(place)}`);
    }
    this.renderStandings();
  },

  renderStandings() {
    const ol = $('standings-list');
    ol.innerHTML = '';
    let place = 0;
    const rows = this.results.map((r) => ({ ...r, place: r.dnf ? '–' : String(++place), detail: r.dnf ? 'Wrecked' : fmtRace(r.time) }));
    for (const id of this.roundPlayers) {
      if (this.results.some((r) => r.id === id)) continue;
      const p = this.players.get(id);
      if (p) rows.push({ ...p, place: '', detail: 'Still driving' });
    }
    this.fillStandings(rows);
    const mine = this.results.find((r) => r.id === this.myId);
    const myPlace = mine && !mine.dnf ? this.results.filter((r) => !r.dnf).indexOf(mine) + 1 : 0;
    setText($('standings-eyebrow'), 'Race results');
    setText($('standings-title'), mine ? (mine.dnf ? 'Wrecked' : `You finished ${ordinal(myPlace)}`) : 'Race standings');
    $('btn-standings-room').hidden = !this.isHost;
    setText($('standings-note'), this.isHost ? '' : 'The host will bring everyone back to the room.');
  },

  fillStandings(rows) {
    const ol = $('standings-list');
    ol.innerHTML = '';
    for (const r of rows) {
      const li = document.createElement('li');
      if (r.id === this.myId) li.className = 'is-me';
      li.innerHTML = '<span class="place"></span><span class="swatch"></span><span class="pl-name"></span><span class="pl-time"></span>';
      li.querySelector('.place').textContent = r.place;
      li.querySelector('.swatch').style.background = cssColor(r.paint);
      li.querySelector('.pl-name').textContent = r.name + (r.id === this.myId ? ' (you)' : '');
      li.querySelector('.pl-time').textContent = r.detail;
      ol.appendChild(li);
    }
  },

  // ---------- Cops & Robbers ----------
  caught(id, at) {
    if (id === this.myId) {
      showToast('Caught! You join the police now.', 'bad');
      Feel.buzz(200);
      // Swap into a police car where you stand.
      const keep = { x: player.x, z: player.z, h: player.h };
      if (game.avatar === 'car') { player.look('police', this.myPaint()); player.reset(keep.x, keep.z, keep.h); player.unlimitedFuel = true; }
    }
    if (!this.isHost) { Net.send({ t: 'caught', id, at, raceId: this.raceId, to: this.hostId }); this.roles[id] = 'cop'; return; }
    if (this.roles[id] !== 'robber') return;
    this.roles[id] = 'cop';
    (this.caughtAt || (this.caughtAt = {}))[id] = at;
    Net.send({ t: 'roles', roles: this.roles, raceId: this.raceId, who: id });
    const name = (this.players.get(id) || {}).name || 'A robber';
    if (id !== this.myId) showToast(`${name} was caught`);
    if (!Object.values(this.roles).some((r) => r === 'robber')) this.endCops('cops');
  },

  endCops(winner) {
    if (!this.isHost) return;
    const list = [...this.players.values()].map((p) => ({ id: p.id, name: p.name, paint: p.paint, role: this.roles[p.id], at: (this.caughtAt || {})[p.id] }));
    Net.send({ t: 'crEnd', winner, list, raceId: this.raceId });
    this.showCopsResult(winner, list);
  },

  showCopsResult(winner, list) {
    if (!(game.mission instanceof NetRound)) return;
    game.state = 'result';
    show('controls', false);
    const mine = list.find((r) => r.id === this.myId);
    const won = mine && ((winner === 'cops' && (mine.role === 'cop')) || (winner === 'robbers' && mine.role === 'robber'));
    Sound.chime(!!won);
    setText($('standings-eyebrow'), 'Cops & Robbers');
    setText($('standings-title'), winner === 'cops' ? 'The police win!' : 'The robbers got away!');
    this.fillStandings(list.map((r) => ({
      ...r, place: '',
      detail: r.at !== undefined ? `Caught at ${fmtTime(r.at)}` : r.role === 'cop' ? 'Police' : 'Stayed free',
    })));
    $('btn-standings-room').hidden = !this.isHost;
    setText($('standings-note'), this.isHost ? '' : 'The host will bring everyone back to the room.');
    show('standings', true);
    this.caughtAt = {};
  },

  backToRoom() {
    if (!this.isHost) return;
    Net.send({ t: 'toRoom' });
    this.enterRoom();
  },

  enterRoom() {
    this.phase = 'lobby';
    endCurrent();
    game.state = 'menu';
    player.show(false);
    walker.show(false);
    for (const r of this.remotes.values()) r.hide();
    for (const id of ['hud', 'controls', 'standings', 'pause', 'menu']) show(id, false);
    show('lobby', true);
    show('lobby-setup', false);
    show('lobby-room', true);
    if (this.isHost) this.broadcastLobby(); else this.renderRoom();
  },

  // ---------- Leaving ----------
  leave() { this.end(''); },

  end(reason) {
    if (!this.active) return;
    this.active = false;
    this.leaving = true;
    Net.close();
    if (this.isHost) Lan.stop();
    for (const r of this.remotes.values()) r.remove();
    this.remotes.clear();
    this.players.clear();
    this.roles = {};
    traffic.onPuppetHit = null;
    hud.waiting.hidden = true;
    show('lobby', false);
    show('standings', false);
    goMenu();
    if (reason) showToast(reason, 'bad');
  },

  // ---------- Every frame ----------
  frame(dt) {
    const inRound = !!game.mission && (game.state === 'playing' || game.state === 'result');
    for (const r of this.remotes.values()) r.frame(dt, game.t);
    if (this.isHost) {
      traffic.update(dt, game.t, streetObstacles());
      traffic.recycle(dt, inRound ? [actor()].concat(this.remoteList()) : [{ x: CITY.SIZE / 2, z: CITY.SIZE / 2 }]);
      this.snapTimer += dt;
      if (this.snapTimer >= 0.1) {
        this.snapTimer = 0;
        Net.send({ t: 'traffic', time: Math.round(game.t * 1000) / 1000, tod: Math.round(Sky.time * 100) / 100, wx: Sky.weather, c: traffic.snapshot() });
      }
      // Cops & Robbers ends on the host's clock.
      const m = game.mission;
      if (m instanceof NetRound && m.type === 'cops' && game.state === 'playing' && game.t > m.startAt + m.duration) this.endCops('robbers');
    } else {
      traffic.updatePuppets(dt);
      hud.waiting.hidden = !(inRound && performance.now() - this.lastTraffic > 3000);
    }
    if (inRound) {
      this.sendTimer += dt;
      if (this.sendTimer >= 1 / 15) {
        this.sendTimer = 0;
        const r = (v) => Math.round(v * 100) / 100, me = actor();
        const cops = [];
        for (const c of policeCars().slice(0, 6)) cops.push(r(c.x), r(c.z), Math.round(c.h * 1000) / 1000, r(c.v));
        Net.send({
          t: 'car', x: r(me.x), z: r(me.z), y: r(me.y || 0), h: Math.round(me.h * 1000) / 1000, v: r(game.avatar === 'car' ? player.v : walker.speed),
          b: player.brakeLight, m: game.avatar === 'car' ? 'c' : 'f', ty: VEHICLE_IDS.indexOf(player.type),
          s: player.type === 'police' && game.avatar === 'car' ? 1 : 0, cops,
        });
      }
    }
  },
};

// ---------- Messages ----------
Net.on('hello', (m) => {
  if (!MP.isHost) return;
  if (MP.players.size >= MAX_PLAYERS && !MP.players.has(m.from)) { Net.send({ t: 'full', to: m.from }); return; }
  const taken = new Set([...MP.players.values()].filter((p) => p.id !== m.from).map((p) => p.paint));
  let paint = Number(m.paint) || PLAYER_COLORS[0];
  if (taken.has(paint)) paint = PLAYER_COLORS.find((c) => !taken.has(c)) || paint;
  MP.players.set(m.from, { id: m.from, name: String(m.name || 'Driver').slice(0, 14), paint });
  MP.broadcastLobby();
  showToast(`${MP.players.get(m.from).name} joined`, 'good');
  // Late arrivals drop straight into Open City or Cops & Robbers (as police); races wait for the next round.
  if (MP.phase === 'running' && MP.mode !== 'race') {
    const p = world.randomLanePoint();
    if (MP.mode === 'cops') { MP.roles[m.from] = 'cop'; Net.send({ t: 'roles', roles: MP.roles, raceId: MP.raceId }); }
    const g = game.mission;
    Net.send({ t: 'start', to: m.from, mode: MP.mode, goal: null, slots: { [m.from]: [p.x, p.z, p.h] }, roles: MP.roles, startAt: game.t + 1, raceId: MP.raceId, duration: g && g.duration ? Math.max(10, g.startAt + g.duration - game.t - 1) : CR_DURATION });
  }
});

Net.on('lobby', (m) => {
  if (MP.isHost) return;
  MP.hostId = m.from;
  MP.players = new Map(m.players.map((p) => [p.id, p]));
  MP.mode = m.mode;
  MP.addresses = m.addresses || [];
  if (game.state === 'menu') MP.phase = m.phase;
  MP.syncRemotes();
  MP.renderRoom();
});

Net.on('leave', (m) => {
  if (m.id === MP.hostId) { MP.end('The host left the game.'); return; }
  const p = MP.players.get(m.id);
  if (p) showToast(`${p.name} left`);
  if (MP.isHost) {
    MP.players.delete(m.id);
    delete MP.roles[m.id];
    MP.broadcastLobby();
    const g = game.mission;
    if (g instanceof NetRound && g.type === 'cops' && game.state === 'playing' && !Object.values(MP.roles).some((r) => r === 'robber')) MP.endCops('cops');
  }
});

Net.on('car', (m) => { const r = MP.remotes.get(m.from); if (r) r.update(m); });

Net.on('traffic', (m) => {
  if (MP.isHost) return;
  MP.lastTraffic = performance.now();
  const diff = m.time - game.t;
  game.t = Math.abs(diff) > 0.5 ? m.time : game.t + diff * 0.2;
  if (m.tod !== undefined && (Math.abs(m.tod - Sky.time) > 0.25 || m.wx !== Sky.weather)) Sky.set(m.tod, m.wx);
  traffic.applySnapshot(m.c);
});

Net.on('hitCar', (m) => { if (MP.isHost && traffic.cars[m.i]) traffic.cars[m.i].onHit(); });
Net.on('takeCar', (m) => {
  if (!MP.isHost || !traffic.cars[m.i]) return;
  const r = MP.remotes.get(m.from);
  traffic.take(traffic.cars[m.i], r || actor());
});
Net.on('horn', (m) => {
  const r = MP.remotes.get(m.from), me = actor();
  if (r) Sound.horn(0.35, 410, clamp(1 - Math.hypot(r.x - me.x, r.z - me.z) / 140, 0, 1));
});
Net.on('start', (m) => { if (m.from === MP.hostId) MP.beginRound(m); });
Net.on('finish', (m) => { if (MP.isHost) MP.recordFinish({ ...m, id: m.from }); });
Net.on('standings', (m) => {
  if (MP.isHost || m.raceId !== MP.raceId) return;
  MP.roundPlayers = m.players || MP.roundPlayers;
  const newest = m.list.find((r) => !MP.results.some((o) => o.id === r.id));
  MP.onStandings(m.list, newest && newest.id);
});
Net.on('caught', (m) => { if (MP.isHost && m.raceId === MP.raceId) MP.caught(m.id, m.at); });
Net.on('roles', (m) => {
  if (MP.isHost || m.raceId !== MP.raceId) return;
  MP.roles = m.roles;
  if (m.who && m.who !== MP.myId) showToast(`${(MP.players.get(m.who) || {}).name || 'A robber'} was caught`);
});
Net.on('crEnd', (m) => { if (!MP.isHost && m.raceId === MP.raceId) MP.showCopsResult(m.winner, m.list); });
Net.on('toRoom', (m) => { if (m.from === MP.hostId) MP.enterRoom(); });
Net.on('full', () => MP.end('That game is full (10 players).'));
Net.onDrop(() => {
  if (MP.leaving || !MP.active) return;
  if (MP.isHost) MP.end('The game server stopped.');
  else MP.reconnect();
});

// ---------- Buttons ----------
$('btn-multiplayer').addEventListener('click', () => MP.open());
$('btn-host').addEventListener('click', () => MP.host());
$('btn-join').addEventListener('click', () => MP.joinAddress($('mp-address').value));
$('mp-address').addEventListener('keydown', (e) => { if (e.key === 'Enter') MP.joinAddress($('mp-address').value); });
$('mp-name').addEventListener('change', () => MP.saveName());
$('btn-scan').addEventListener('click', () => MP.scan());
$('btn-lobby-back').addEventListener('click', () => { show('lobby', false); goMenu(); });
$('btn-room-start').addEventListener('click', () => MP.startRound());
$('btn-room-leave').addEventListener('click', () => MP.leave());
$('btn-standings-room').addEventListener('click', () => MP.backToRoom());
$('btn-standings-leave').addEventListener('click', () => MP.leave());
for (const b of document.querySelectorAll('#room-modes .mode')) b.addEventListener('click', () => MP.setMode(b.dataset.mode));
