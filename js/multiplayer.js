'use strict';

// Multiplayer over Wi-Fi for up to 10 players.
//
// The host's game is the referee: it keeps the player list, simulates the
// traffic and sends it to everyone 10 times a second, picks the start grid
// and destination, and ranks finishers. Every phone drives its own car and
// sends its position 15 times a second. Traffic lights need no messages: they
// run off the shared clock that rides along with each traffic update.
//
// Messages (JSON, `t` is the type; the relay adds `from`):
//   hello     player -> host    name and paint when joining
//   lobby     host -> all       player list, mode, host address, phase
//   start     host -> all       mode, destination, start grid, start time
//   car       player -> all     position, heading, speed, brake light
//   traffic   host -> all       game clock and every traffic car
//   hitCar    player -> host    "I hit traffic car i" so it stops and honks
//   finish    player -> host    race time, or wrecked
//   standings host -> all       finishing order
//   toRoom    host -> all       back to the room after a race
const MAX_PLAYERS = 10;
const MP_MODES = {
  race: { name: 'Race', blurb: 'Everyone starts together. First to stop at the green marker wins. Each red light adds 5 seconds.' },
  roam: { name: 'Free roam', blurb: 'Drive around the city together. No clock, no finish line.' },
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
  sprite.position.y = 2.8;
  return sprite;
}

// Players who picked the same paint get the next free colour from this list.
const PLAYER_COLORS = [0xd23a3a, 0x1f5fbf, 0xf2c230, 0x2fa35a, 0x8e44c9, 0xff6fae, 0x19b5c9, 0xf08a24, 0x8a5a2b, 0xc9ced4];
const fmtRace = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const cssColor = (hex) => `#${(hex >>> 0).toString(16).padStart(6, '0')}`;

class RemoteCar {
  constructor(scene, info) {
    this.scene = scene;
    this.id = info.id;
    this.x = this.z = this.h = this.v = 0;
    this.snap = null;
    this.visible = false;
    this.setInfo(info);
  }

  setInfo(info) {
    if (this.info && this.info.name === info.name && this.info.paint === info.paint) return;
    this.info = info;
    if (this.parts) this.scene.remove(this.parts.group);
    this.parts = buildCarMesh(info.paint);
    this.parts.group.add(nameLabel(info.name, cssColor(info.paint)));
    this.parts.group.visible = this.visible;
    this.scene.add(this.parts.group);
  }

  update(m) {
    setSnap(this, m.x, m.z, m.h, m.v);
    this.parts.tailMat.emissiveIntensity = m.b ? 1.4 : 0.25;
    this.visible = this.parts.group.visible = true;
  }

  hide() { this.visible = this.parts.group.visible = false; this.snap = null; }
  remove() { this.scene.remove(this.parts.group); }
}

// The mission object for a multiplayer round; main.js drives it like any other.
class NetRound {
  constructor(game, msg) {
    this.game = game;
    this.type = msg.mode;
    this.meta = { name: MP_MODES[msg.mode].name, tag: 'Multiplayer' };
    this.level = 0;
    this.raceId = msg.raceId;
    this.startAt = msg.startAt;
    this.elapsed = 0;
    this.crashes = 0;
    this.redLights = 0;
    this.statics = [];
    this.markers = [];
    this.done = null;
    this.goEl = $('countdown');
    if (msg.mode === 'race') {
      this.goal = msg.goal;
      const m = makeBeam(0x3ce07a);
      m.position.set(msg.goal.x, 0, msg.goal.z);
      game.scene.add(m);
      this.markers.push(m);
      this.beam = m;
    }
  }

  frozen() { return this.game.t < this.startAt; }
  get penalty() { return this.redLights * 5; }

  update(dt) {
    const p = this.game.player, wait = this.startAt - this.game.t;
    if (wait > 0) {
      this.goEl.hidden = false;
      setText(this.goEl, String(Math.ceil(wait)));
      return null;
    }
    if (wait > -0.8) { this.goEl.hidden = false; setText(this.goEl, 'GO!'); } else this.goEl.hidden = true;
    this.elapsed += dt;
    if (this.beam) this.beam.userData.ring.scale.setScalar(1 + Math.sin(this.elapsed * 4) * 0.06);
    if (p.damage >= 100) {
      if (this.type === 'race') this.done = { ok: false, reason: 'Your car is wrecked.' };
      else { p.damage = 0; this.game.toast('Car repaired', 'good'); }
    }
    if (this.goal && !this.done && Math.hypot(p.x - this.goal.x, p.z - this.goal.z) < 5.5) {
      if (Math.abs(p.v) < 3) this.done = { ok: true };
      else if (!this.slowWarned) { this.slowWarned = true; this.game.toast('Slow down and stop at the marker'); }
    }
    return this.done;
  }

  onCrash() { this.crashes++; }
  onRedLight() {
    this.redLights++;
    this.game.toast(this.type === 'race' ? 'Red light: +5 seconds' : 'You ran a red light', 'bad');
  }

  hud() {
    if (this.type === 'roam') return { label: 'Driven', value: `${(this.game.player.odometer / 1000).toFixed(2)} km`, warn: false };
    return { label: 'Race time', value: fmtRace(Math.max(0, this.elapsed) + this.penalty), warn: false };
  }

  objective() {
    if (this.frozen()) return 'Get ready…';
    return this.type === 'race' ? 'First to stop at the green marker wins' : 'Drive around with your friends';
  }

  dispose() {
    for (const m of this.markers) this.game.scene.remove(m);
    this.goEl.hidden = true;
  }
}

const MP = {
  active: false,
  isHost: false,
  myId: 0,
  hostId: 0,
  players: new Map(),   // id -> { id, name, paint }
  remotes: new Map(),   // id -> RemoteCar
  mode: 'race',
  phase: 'lobby',       // lobby | running
  addresses: [],
  raceId: 0,
  results: [],
  roundPlayers: [],
  sendTimer: 0,
  snapTimer: 0,
  leaving: false,

  me() { return { id: this.myId, name: this.name(), paint: currentPaint().hex }; },
  myPaint() { const p = this.players.get(this.myId); return p ? p.paint : currentPaint().hex; },
  name() { return (Save.data.name || '').trim() || 'Driver'; },
  remoteList() { return this.active ? [...this.remotes.values()].filter((r) => r.visible) : []; },

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
    this.active = true;
    this.leaving = false;
    this.isHost = asHost;
    this.hostId = asHost ? this.myId : 0;
    this.players.clear();
    this.phase = 'lobby';
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
      else this.remotes.set(p.id, new RemoteCar(scene, p));
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
    start.textContent = this.mode === 'race' ? 'Start race' : 'Start driving';
    $('room-status').textContent = this.phase === 'running' && !this.isHost
      ? 'A race is in progress. You will join the next one.'
      : this.isHost && this.players.size < 2 ? 'You can start alone, or wait for friends to join.' : '';
  },

  // ---------- Rounds ----------
  startRound() {
    if (!this.isHost) return;
    const { N, PITCH, HALF } = CITY;
    const i = Math.floor(Math.random() * N), j = Math.floor(Math.random() * (N + 1));
    const n = world.node(i, j), h = headingOf(0);
    const ids = [...this.players.keys()];
    const slots = {};
    // Two cars side by side in the eastbound lane, rows 7 m apart.
    ids.forEach((id, k) => {
      const s = PITCH - HALF - 8 - Math.floor(k / 2) * 7;
      slots[id] = [n.x + s, n.z + (k % 2 ? 4.4 : 1.6), h];
    });
    const startPos = { x: n.x + PITCH / 2, z: n.z + 3 };
    let goal = null;
    if (this.mode === 'race') {
      let best = null, bestD = 0;
      for (let k = 0; k < 300; k++) {
        const g = world.randomLanePoint();
        const d = Math.abs(g.x - startPos.x) + Math.abs(g.z - startPos.z);
        if (d > bestD) { best = g; bestD = d; }
        if (d >= 320 && d <= 520) { best = g; break; }
      }
      goal = { x: best.x, z: best.z };
    }
    traffic.reset(Math.min(40, 24 + ids.length * 2), startPos);
    const msg = { t: 'start', mode: this.mode, goal, slots, startAt: game.t + 4, raceId: ++this.raceId };
    Net.send(msg);
    this.beginRound(msg);
  },

  beginRound(m) {
    this.phase = 'running';
    this.raceId = m.raceId;
    const slot = m.slots[this.myId];
    if (!slot) { this.renderRoom(); return; }
    if (!m.to) { this.results = []; this.roundPlayers = Object.keys(m.slots).map(Number); }
    show('lobby', false);
    show('standings', false);
    startNetRound(new NetRound(game, m), slot);
  },

  // Called by main.js when this player's round ends (finished or wrecked).
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
    const mine = this.results.find((r) => r.id === this.myId);
    const myPlace = mine && !mine.dnf ? this.results.filter((r) => !r.dnf).indexOf(mine) + 1 : 0;
    setText($('standings-title'), mine ? (mine.dnf ? 'Wrecked' : `You finished ${ordinal(myPlace)}`) : 'Race standings');
    $('btn-standings-room').hidden = !this.isHost;
    setText($('standings-note'), this.isHost ? '' : 'The host will bring everyone back to the room.');
  },

  backToRoom() {
    if (!this.isHost) return;
    Net.send({ t: 'toRoom' });
    this.enterRoom();
  },

  enterRoom() {
    this.phase = 'lobby';
    if (game.mission) { game.mission.dispose(); game.mission = null; }
    game.state = 'menu';
    player.parts.group.visible = false;
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
    traffic.onPuppetHit = null;
    show('lobby', false);
    show('standings', false);
    goMenu();
    if (reason) showToast(reason, 'bad');
  },

  // ---------- Every frame ----------
  frame(dt) {
    const inRound = !!game.mission && (game.state === 'playing' || game.state === 'result');
    for (const r of this.remotes.values()) if (r.visible) followSnap(r, dt);
    if (this.isHost) {
      traffic.update(dt, game.t, inRound ? player : null, (inRound ? game.mission.statics : []).concat(this.remoteList()));
      this.snapTimer += dt;
      if (this.snapTimer >= 0.1) {
        this.snapTimer = 0;
        Net.send({ t: 'traffic', time: Math.round(game.t * 1000) / 1000, c: traffic.snapshot() });
      }
    } else {
      traffic.updatePuppets(dt);
    }
    if (inRound) {
      this.sendTimer += dt;
      if (this.sendTimer >= 1 / 15) {
        this.sendTimer = 0;
        const r = (v) => Math.round(v * 100) / 100;
        Net.send({ t: 'car', x: r(player.x), z: r(player.z), h: Math.round(player.h * 1000) / 1000, v: r(player.v), b: player.brakeLight });
      }
    }
  },
};

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

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
  // Late arrivals drop straight into free roam; races wait for the next round.
  if (MP.phase === 'running' && MP.mode === 'roam') {
    const p = world.randomLanePoint();
    Net.send({ t: 'start', to: m.from, mode: 'roam', goal: null, slots: { [m.from]: [p.x, p.z, p.h] }, startAt: game.t + 1, raceId: MP.raceId });
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
    MP.broadcastLobby();
  }
});

Net.on('car', (m) => { const r = MP.remotes.get(m.from); if (r) r.update(m); });

Net.on('traffic', (m) => {
  if (MP.isHost) return;
  const diff = m.time - game.t;
  game.t = Math.abs(diff) > 0.5 ? m.time : game.t + diff * 0.2;
  traffic.applySnapshot(m.c);
});

Net.on('hitCar', (m) => { if (MP.isHost && traffic.cars[m.i]) traffic.cars[m.i].onHit(); });
Net.on('start', (m) => { if (m.from === MP.hostId) MP.beginRound(m); });
Net.on('finish', (m) => { if (MP.isHost) MP.recordFinish({ ...m, id: m.from }); });
Net.on('standings', (m) => {
  if (MP.isHost || m.raceId !== MP.raceId) return;
  MP.roundPlayers = m.players || MP.roundPlayers;
  const newest = m.list.find((r) => !MP.results.some((o) => o.id === r.id));
  MP.onStandings(m.list, newest && newest.id);
});
Net.on('toRoom', (m) => { if (m.from === MP.hostId) MP.enterRoom(); });
Net.on('full', () => MP.end('That game is full (10 players).'));
Net.onDrop(() => { if (!MP.leaving) MP.end('Lost connection to the game.'); });

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
