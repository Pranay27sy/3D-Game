'use strict';

// ---------- Save data ----------
const SAVE_KEY = 'downtown-driver-v1';
const PAINTS = [
  { id: 'red', name: 'Signal Red', hex: 0xd23a3a, price: 0 },
  { id: 'yellow', name: 'Lane Yellow', hex: 0xf2c230, price: 250 },
  { id: 'blue', name: 'Sign Blue', hex: 0x1f5fbf, price: 400 },
  { id: 'silver', name: 'Sedan Silver', hex: 0xc9ced4, price: 600 },
  { id: 'green', name: 'Park Green', hex: 0x2f7a4a, price: 800 },
  { id: 'black', name: 'Midnight', hex: 0x22252b, price: 1000 },
];
const Save = {
  data: {
    coins: 0, levels: { speed: 1, fuel: 1, parking: 1, safe: 1 }, paints: ['red'], paint: 'red',
    cars: ['sedan'], car: 'sedan', packages: [], settings: { ...SETTINGS_DEFAULTS },
  },
  load() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (d) this.data = { ...this.data, ...d, levels: { ...this.data.levels, ...d.levels }, settings: { ...SETTINGS_DEFAULTS, ...d.settings } };
    } catch (e) { /* storage unavailable: play without saving */ }
  },
  store() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
  },
};
Save.load();
const settings = Save.data.settings;

// ---------- Scene ----------
const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd0ee);
scene.fog = new THREE.Fog(0x9fd0ee, 160, 520);
const camera = new THREE.PerspectiveCamera(62, 1, 0.25, 1200);

const hemi = new THREE.HemisphereLight(0xdcefff, 0x5d6b4f, 0.75);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3df, 0.85);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 300 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

Effects.init(scene);
const world = new World(scene);
Sky.init({ scene, hemi, sun, world });
const currentPaint = () => PAINTS.find((p) => p.id === Save.data.paint) || PAINTS[0];
const player = new PlayerCar(scene, Save.data.car || 'sedan', currentPaint().hex);
player.isPlayer = true;
const walker = new Walker(scene, { skin: 0xd9a47a, shirt: 0x1f5fbf, pants: 0x2a3442, hair: 0x2a1c12 });
walker.isPlayer = true;
walker.show(false);
const traffic = new Traffic(world, scene);
const peds = new Peds(world, scene);

const game = {
  scene, world, player, walker, traffic, peds,
  mission: null,
  state: 'menu',      // menu | brief | playing | paused | result
  avatar: 'car',      // car | foot
  t: 0,
  camMode: 'chase',
  waypoint: null,
  toast: showToast,
};

// The player as whatever they are right now: their car, or on foot.
function actor() { return game.avatar === 'car' ? player : walker; }

function setAvatar(mode) {
  game.avatar = mode;
  player.show(mode === 'car');
  walker.show(mode === 'foot');
  Input.mode = mode;
  $('controls').classList.toggle('is-foot', mode === 'foot');
  if (mode === 'foot') { Radio.off(); cam.yaw = walker.h; }
  else if (Save.data.radio >= 0 && !Radio.on && game.state !== 'menu') Radio.resume(Save.data.radio);
  updateCamera(0, true);
}

// ---------- Settings ----------
let quality = QUALITY[settings.quality] || QUALITY.medium;
function applySettings() {
  quality = QUALITY[settings.quality] || QUALITY.medium;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
  renderer.shadowMap.enabled = quality.shadows;
  sun.castShadow = quality.shadows;
  if (sun.shadow.map && sun.shadow.mapSize.x !== quality.shadowSize) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
  camera.far = quality.far + 600;
  camera.updateProjectionMatrix();
  Input.steering = settings.steering;
  Input.sensitivity = settings.sensitivity;
  Sound.setVolume(settings.volume);
  Sound.setMusicVolume(settings.music);
  Feel.enabled = settings.vibration;
  $('controls').classList.toggle('is-tilt', settings.steering === 'tilt');
  $('controls').classList.toggle('is-swapped', settings.swap);
  resize();
}

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ---------- Camera ----------
const cam = { pos: new THREE.Vector3(CITY.SIZE / 2, 120, CITY.SIZE + 140), look: new THREE.Vector3(CITY.SIZE / 2, 0, CITY.SIZE / 2), yaw: 0, offset: 0, manual: 0 };
const CAM_MODES = ['chase', 'hood', 'high'];
const CAM_LABELS = { chase: 'Chase view', hood: 'First person', high: 'High view' };
const tmpPos = new THREE.Vector3(), tmpLook = new THREE.Vector3();

// Pull the camera in front of any building between it and what it looks at.
function clearView(look, pos) {
  const rects = world.footRectsNear(pos.x, pos.z).concat(world.footRectsNear(look.x, look.z));
  for (let s = 0.15; s <= 1.0001; s += 0.12) {
    const x = look.x + (pos.x - look.x) * s, z = look.z + (pos.z - look.z) * s;
    if (rects.some((r) => r.x1 - r.x0 < 900 && x > r.x0 - 0.4 && x < r.x1 + 0.4 && z > r.z0 - 0.4 && z < r.z1 + 0.4)) {
      const k = Math.max(0.1, s - 0.12);
      pos.set(look.x + (pos.x - look.x) * k, pos.y, look.z + (pos.z - look.z) * k);
      return;
    }
  }
}

function updateCamera(dt, snap) {
  const drag = Input.takeCamDrag();
  let k = snap ? 1 : 1 - Math.exp(-dt * 6);
  if (game.state === 'menu') {
    const a = game.t * 0.04;
    tmpPos.set(CITY.SIZE / 2 + Math.sin(a) * 300, 140, CITY.SIZE / 2 + Math.cos(a) * 300);
    tmpLook.set(CITY.SIZE / 2, 0, CITY.SIZE / 2);
    k = snap ? 1 : 1 - Math.exp(-dt * 2);
  } else {
    if (drag) { cam.offset -= drag; cam.manual = 1.5; }
    else if (cam.manual > 0) cam.manual -= dt;
    if (game.avatar === 'car') {
      if (cam.manual <= 0) cam.offset *= 1 - Math.min(1, dt * 2.5);
      const p = player, yaw = p.h + cam.offset, fx = Math.sin(yaw), fz = Math.cos(yaw), y = p.y || 0;
      if (game.camMode === 'chase') {
        tmpPos.set(p.x - fx * 8.5, y + 4, p.z - fz * 8.5);
        tmpLook.set(p.x + fx * 4, y + 1.2, p.z + fz * 4);
      } else if (game.camMode === 'hood') {
        const f = p.forward;
        // Driver's seat is on the left for right-hand traffic.
        tmpPos.set(p.x + f.x * 0.75 + f.z * 0.36, y + (p.type === 'van' ? 1.9 : p.type === 'sports' ? 1.05 : 1.32), p.z + f.z * 0.75 - f.x * 0.36);
        tmpLook.set(tmpPos.x + fx * 12, tmpPos.y - 0.2, tmpPos.z + fz * 12);
        k = 1;
      } else {
        tmpPos.set(p.x - fx * 15, y + 15, p.z - fz * 15);
        tmpLook.set(p.x + fx * 6, y, p.z + fz * 6);
      }
    } else {
      const w = walker;
      if (cam.manual <= 0 && w.speed > 0.6) cam.yaw += wrapAngle(w.h - cam.yaw) * Math.min(1, dt * 1.6);
      cam.yaw += cam.offset; cam.offset = 0;
      const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
      if (game.camMode === 'hood') {
        tmpPos.set(w.x + Math.sin(w.h) * 0.25, w.y + 1.62, w.z + Math.cos(w.h) * 0.25);
        tmpLook.set(tmpPos.x + Math.sin(w.h) * 10, tmpPos.y - 0.3, tmpPos.z + Math.cos(w.h) * 10);
        k = 1;
      } else {
        const far = game.camMode === 'high' ? 11 : 5.2;
        tmpPos.set(w.x - fx * far, w.y + (game.camMode === 'high' ? 8 : 2.6), w.z - fz * far);
        tmpLook.set(w.x + fx * 2, w.y + 1.4, w.z + fz * 2);
      }
    }
    if (game.camMode !== 'hood') clearView(tmpLook, tmpPos);
  }
  cam.pos.lerp(tmpPos, k);
  cam.look.lerp(tmpLook, k);
  camera.position.copy(cam.pos);
  camera.lookAt(cam.look);

  const me = actor();
  const c = game.state === 'menu' ? cam.look : tmpLook.set(me.x, 0, me.z);
  const o = Sky.sunOffset;
  sun.position.set(c.x + o.x, o.y, c.z + o.z);
  sun.target.position.set(c.x, 0, c.z);
  const span = game.state === 'menu' ? 260 : 75;
  if (sun.shadow.camera.right !== span) {
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span });
    sun.shadow.camera.updateProjectionMatrix();
  }
}

// ---------- HUD ----------
const hud = {
  root: $('hud'), controls: $('controls'),
  tag: $('hud-tag'), level: $('hud-level'), name: $('hud-name'), objective: $('hud-objective'),
  statLabel: $('hud-stat-label'), stat: $('hud-stat'), stars: $('hud-stars'),
  nav: $('nav'), navArrow: $('nav-arrow'), navDist: $('nav-dist'),
  speed: $('hud-speed'), health: $('bar-health'), healthLabel: $('gauge-health-label'),
  fuel: $('bar-fuel'), fuelGauge: $('gauge-fuel'),
  gear: $('btn-gear'), camera: $('btn-camera'), enter: $('btn-enter'), radio: $('btn-radio'), map: $('btn-map'),
  minimap: $('minimap'), waiting: $('hud-waiting'),
};
const setText = (el, s) => { if (el.textContent !== s) el.textContent = s; };

let toastTimer = 0;
function showToast(msg, kind = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast is-shown ${kind ? 'is-' + kind : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2400);
}

function showBanner(title, sub) {
  setText($('banner-title'), title);
  setText($('banner-sub'), sub || '');
  $('banner').hidden = false;
}
function hideBanner() { $('banner').hidden = true; }

function addCash(n, reason) {
  Save.data.coins = Math.max(0, Save.data.coins + n);
  Save.store();
  if (n > 0) Sound.coin();
  showToast(`${reason} ${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`, n >= 0 ? 'good' : '');
}

function updateHud() {
  const m = game.mission, open = m.type === 'open' || !!m.world;
  const info = m.hud();
  setText(hud.statLabel, info.label);
  setText(hud.stat, info.value);
  hud.stat.classList.toggle('is-warn', info.warn);
  setText(hud.objective, m.objective());
  if (open) setText(hud.level, `${DISTRICT_NAMES[world.districtAt(actor().x, actor().z)]} · ${Sky.clock()}${Sky.weather === 'rain' ? ' · Rain' : ''}`);

  const inCar = game.avatar === 'car', me = actor();
  setText(hud.speed, String(Math.round(Math.abs(inCar ? player.v : walker.speed) * 3.6)));
  setText(hud.gear, player.gear);
  hud.gear.classList.toggle('is-reverse', player.gear === 'R');
  setText(hud.healthLabel, inCar ? 'Condition' : 'Health');
  const hp = inCar ? 100 - player.damage : walker.health;
  hud.health.style.width = `${hp}%`;
  hud.health.classList.toggle('is-low', hp < 35);
  hud.fuel.style.width = `${player.fuel}%`;
  hud.fuel.classList.toggle('is-low', player.fuel < 20);

  // Wanted stars.
  const police = m.police || (m.world && m.world.police);
  const level = police ? police.level : 0;
  hud.stars.hidden = !police || !police.enabled;
  if (!hud.stars.hidden) {
    const flash = police.searching && Math.floor(game.t * 3) % 2 === 0;
    [...hud.stars.children].forEach((s, k) => s.classList.toggle('is-on', k < level && !flash));
  }

  // Context button: get out, or get into the nearest car.
  const ow = m.type === 'open' ? m : m.world;
  if (ow && game.state === 'playing') {
    if (inCar) {
      hud.enter.hidden = Math.abs(player.v) > 6;
      setText(hud.enter, 'Get out');
    } else {
      const near = ow.enterable()[0];
      hud.enter.hidden = !near;
      if (near) setText(hud.enter, near.kind === 'parked' ? 'Get in' : near.kind === 'police' || near.c.isPolice ? 'Steal police car' : 'Take car');
    }
  } else hud.enter.hidden = true;
  hud.radio.hidden = !inCar;
  setText(hud.radio, Radio.on ? 'Radio' : 'Radio off');
  hud.map.hidden = !ow;

  const target = m.navTarget ? m.navTarget() : m.goal;
  hud.nav.hidden = !target;
  if (target) {
    const yaw = inCar ? player.h : cam.yaw, fx = Math.sin(yaw), fz = Math.cos(yaw), dx = target.x - me.x, dz = target.z - me.z;
    const rel = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);
    hud.navArrow.style.transform = `rotate(${rel.toFixed(3)}rad)`;
    setText(hud.navDist, `${Math.round(Math.hypot(dx, dz))} m`);
  }
  drawMinimap();
}

// GPS route along the street grid: to the nearest junction, along one axis, then the other.
function routeTo(from, to) {
  const { PITCH, N } = CITY;
  const ni = (v) => clamp(Math.round(v / PITCH), 0, N);
  const si = ni(from.x), sj = ni(from.z), ti = ni(to.x), tj = ni(to.z);
  return [from, { x: si * PITCH, z: sj * PITCH }, { x: ti * PITCH, z: sj * PITCH }, { x: ti * PITCH, z: tj * PITCH }, to];
}

function blipsFor(m) {
  const out = m.blips ? m.blips() : m.world ? m.world.blips() : [];
  if (m.goal && !m.blips && !m.world) out.push({ x: m.goal.x, z: m.goal.z, kind: 'goal' });
  if (game.waypoint) out.push({ x: game.waypoint.x, z: game.waypoint.z, kind: 'waypoint' });
  for (const r of MP.mapPlayers()) out.push({ x: r.x, z: r.z, kind: 'friend', color: cssColor(r.info.paint) });
  return out;
}

function drawBlip(g, x, y, b, size) {
  if (b.kind === 'cop') {
    g.fillStyle = Math.floor(game.t * 4) % 2 ? '#ff3b3b' : '#3b7bff';
    g.beginPath(); g.arc(x, y, size * 0.45, 0, Math.PI * 2); g.fill();
    return;
  }
  g.fillStyle = b.color || BLIP_COLORS[b.kind] || '#ffffff';
  g.strokeStyle = '#0a2042';
  g.lineWidth = 2;
  g.beginPath(); g.arc(x, y, size * (b.kind === 'friend' ? 0.55 : 0.75), 0, Math.PI * 2); g.fill(); g.stroke();
  const icon = BLIP_ICONS[b.kind];
  if (icon) {
    g.fillStyle = '#0a2042';
    g.font = `900 ${Math.round(size)}px Overpass, Arial, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(icon, x, y + 1);
  }
}

function drawCityBase(g, X, Y, s) {
  const { SIZE, PITCH, N, HALF } = CITY;
  const tint = { downtown: '#33507a', commercial: '#3a4f6a', residential: '#3e5a4c', industrial: '#4a4d52', park: '#3f6a3a', plaza: '#5a5546', stunts: '#5a4a30', parking: '#40444a' };
  for (const b of world.info) {
    g.fillStyle = tint[b.district];
    g.fillRect(X(b.x0), Y(b.z0), (b.x1 - b.x0) * s, (b.z1 - b.z0) * s);
  }
  g.strokeStyle = 'rgba(232, 238, 246, 0.6)';
  g.lineWidth = Math.max(2, CITY.ROAD * s);
  g.beginPath();
  for (let k = 0; k <= N; k++) {
    g.moveTo(X(k * PITCH), Y(-HALF)); g.lineTo(X(k * PITCH), Y(SIZE + HALF));
    g.moveTo(X(-HALF), Y(k * PITCH)); g.lineTo(X(SIZE + HALF), Y(k * PITCH));
  }
  g.stroke();
  g.fillStyle = '#2f86b8';
  g.fillRect(X(-200), Y(SIZE + HALF + 46), (SIZE + 400) * s, 400 * s);
  g.fillStyle = '#e8d9a8';
  g.fillRect(X(-200), Y(SIZE + HALF + 0.6), (SIZE + 400) * s, 46 * s);
}

function drawRoute(g, X, Y, target) {
  const pts = routeTo(actor(), target);
  g.strokeStyle = '#b678ff';
  g.lineWidth = 4;
  g.lineJoin = 'round';
  g.beginPath();
  pts.forEach((p, k) => (k ? g.lineTo(X(p.x), Y(p.z)) : g.moveTo(X(p.x), Y(p.z))));
  g.stroke();
}

function drawPlayerArrow(g, x, y, heading, size) {
  g.save();
  g.translate(x, y);
  g.rotate(Math.atan2(Math.sin(heading), -Math.cos(heading)));
  g.fillStyle = '#f2c230';
  g.strokeStyle = '#0a2042';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, -size); g.lineTo(size * 0.7, size * 0.7); g.lineTo(0, size * 0.3); g.lineTo(-size * 0.7, size * 0.7); g.closePath();
  g.fill(); g.stroke();
  g.restore();
}

// Minimap: a 240 m window around you, north up.
function drawMinimap() {
  const c = hud.minimap, g = c.getContext('2d'), size = c.width, me = actor();
  const span = 240, s = size / span;
  const X = (x) => size / 2 + (x - me.x) * s, Y = (z) => size / 2 + (z - me.z) * s;
  g.save();
  g.clearRect(0, 0, size, size);
  g.beginPath(); g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); g.clip();
  g.fillStyle = '#5b7a4a';
  g.fillRect(0, 0, size, size);
  drawCityBase(g, X, Y, s);
  const m = game.mission;
  const target = m.navTarget ? m.navTarget() : m.goal;
  if (target) drawRoute(g, X, Y, target);
  g.fillStyle = 'rgba(255, 255, 255, 0.55)';
  for (const t of traffic.cars) g.fillRect(X(t.x) - 2, Y(t.z) - 2, 4, 4);
  for (const b of blipsFor(m)) {
    let x = X(b.x), y = Y(b.z);
    const dx = x - size / 2, dy = y - size / 2, d = Math.hypot(dx, dy), max = size / 2 - 14;
    if (d > max) { if (b.kind === 'cop' || b.kind === 'friend') continue; x = size / 2 + (dx / d) * max; y = size / 2 + (dy / d) * max; }
    drawBlip(g, x, y, b, 16);
  }
  drawPlayerArrow(g, size / 2, size / 2, game.avatar === 'car' ? player.h : walker.h, 12);
  g.restore();
}

// Full-screen city map; tap to set a waypoint.
function drawFullMap() {
  const c = $('map-canvas'), g = c.getContext('2d');
  const w = c.clientWidth, h = c.clientHeight, ratio = Math.min(2, window.devicePixelRatio || 1);
  if (c.width !== Math.round(w * ratio)) { c.width = Math.round(w * ratio); c.height = Math.round(h * ratio); }
  // Leave room at the bottom for the legend bar.
  const W = c.width, H = c.height, pad = 16 * ratio, bar = $('map').querySelector('.map-bar').offsetHeight * ratio + 24 * ratio;
  const s = Math.min((W - pad * 2) / (CITY.SIZE + 40), (H - pad - bar) / (CITY.SIZE + 50));
  const ox = (W - CITY.SIZE * s) / 2, oz = pad + 10 * ratio;
  const X = (x) => ox + x * s, Y = (z) => oz + z * s;
  c._map = { ox, oz, s, ratio };
  g.fillStyle = '#5b7a4a';
  g.fillRect(0, 0, W, H);
  drawCityBase(g, X, Y, s);
  g.fillStyle = 'rgba(244, 246, 242, 0.85)';
  g.font = `800 ${Math.round(11 * ratio)}px Overpass, Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const labels = { downtown: [3, 3.6], commercial: [1.5, 1.1], residential: [6.3, 6.6], industrial: [2.5, 0.25] };
  for (const [d, [bi, bj]] of Object.entries(labels)) g.fillText(DISTRICT_NAMES[d].toUpperCase(), X(bi * CITY.PITCH), Y(bj * CITY.PITCH));
  g.fillText('BEACH', X(CITY.SIZE / 2), Y(CITY.SIZE + 30));
  const m = game.mission;
  const target = m.navTarget ? m.navTarget() : m.goal;
  if (target) drawRoute(g, X, Y, target);
  for (const b of blipsFor(m)) drawBlip(g, X(b.x), Y(b.z), b, 14 * ratio);
  const me = actor();
  drawPlayerArrow(g, X(me.x), Y(me.z), game.avatar === 'car' ? player.h : walker.h, 12 * ratio);
}

function openMap() {
  if (!game.mission || game.state !== 'playing') return;
  const ow = game.mission.type === 'open' || game.mission.world;
  if (!ow) return;
  $('map').hidden = false;
  game.menuOpen = true;
  drawFullMap();
}
function closeMap() { $('map').hidden = true; game.menuOpen = false; }

// ---------- Game flow ----------
function show(id, on) { $(id).hidden = !on; }

function renderMenu() {
  $('menu-coins').textContent = money(Save.data.coins);
  const list = $('mission-list');
  list.innerHTML = '';
  for (const type of MISSION_ORDER) {
    const meta = MISSIONS[type], lvl = Save.data.levels[type];
    const b = document.createElement('button');
    b.className = 'mission-card';
    b.type = 'button';
    b.id = `mission-${type}`;
    b.innerHTML = `<span class="card-top"><span class="tag">${meta.tag}</span><span class="lvl">${lvl ? 'Level ' + lvl : 'No limits'}</span></span>
      <span class="card-name">${meta.name}</span><span class="card-blurb">${meta.blurb}</span>`;
    b.addEventListener('click', () => { Sound.init(); startMission(type); });
    list.appendChild(b);
  }
  const cars = $('car-list');
  cars.innerHTML = '';
  for (const id of VEHICLE_IDS) {
    const v = VEHICLES[id];
    if (v.hidden) continue;
    const owned = Save.data.cars.includes(id), sel = Save.data.car === id;
    const b = document.createElement('button');
    b.type = 'button';
    b.id = `car-${id}`;
    b.className = `paint car-pick${sel ? ' is-selected' : ''}`;
    b.setAttribute('aria-pressed', String(sel));
    b.innerHTML = `<span class="car-stats">${Math.round(v.vmax * 3.6)}<small>km/h</small></span><span class="paint-name">${v.name}</span><span class="paint-price">${sel ? 'Driving' : owned ? 'Owned' : money(v.price)}</span>`;
    b.addEventListener('click', () => chooseCar(id));
    cars.appendChild(b);
  }
  const paints = $('paint-list');
  paints.innerHTML = '';
  for (const p of PAINTS) {
    const owned = Save.data.paints.includes(p.id), sel = Save.data.paint === p.id;
    const b = document.createElement('button');
    b.type = 'button';
    b.id = `paint-${p.id}`;
    b.className = `paint${sel ? ' is-selected' : ''}`;
    b.setAttribute('aria-pressed', String(sel));
    b.innerHTML = `<span class="swatch" style="background:#${p.hex.toString(16).padStart(6, '0')}"></span>
      <span class="paint-name">${p.name}</span><span class="paint-price">${sel ? 'Selected' : owned ? 'Owned' : money(p.price)}</span>`;
    b.addEventListener('click', () => choosePaint(p));
    paints.appendChild(b);
  }
  const found = (Save.data.packages || []).length;
  setText($('menu-packages'), `${found} of ${world.packages.length} hidden packages found`);
}

function buy(price, what) {
  if (Save.data.coins < price) { showToast(`You need ${money(price - Save.data.coins)} more for the ${what}`, 'bad'); return false; }
  Save.data.coins -= price;
  showToast(`Bought the ${what}`, 'good');
  return true;
}

function choosePaint(p) {
  const d = Save.data;
  if (!d.paints.includes(p.id)) { if (!buy(p.price, p.name)) return; d.paints.push(p.id); }
  d.paint = p.id;
  Save.store();
  renderMenu();
}

function chooseCar(id) {
  const d = Save.data;
  if (!d.cars.includes(id)) { if (!buy(VEHICLES[id].price, VEHICLES[id].name)) return; d.cars.push(id); }
  d.car = id;
  Save.store();
  renderMenu();
}

function endCurrent() {
  if (game.mission) { game.mission.dispose(); game.mission = null; }
  traffic.blocked = new Set();
  world.curbsSolid = true;
  Radio.off();
  Sound.setSiren(0);
  hideBanner();
  closeMap();
}

function goMenu() {
  endCurrent();
  game.state = 'menu';
  game.menuOpen = false;
  game.waypoint = null;
  player.show(false);
  walker.show(false);
  for (const id of ['hud', 'controls', 'brief', 'pause', 'result', 'lobby', 'standings', 'settings']) show(id, false);
  show('menu', true);
  renderMenu();
  Sky.setCycle(true);
  traffic.reset(quality.traffic);
  peds.reset(quality.peds, null);
}

function startMission(type) {
  endCurrent();
  Sky.setCycle(false);
  Sky.set(10, 'clear');
  const level = Save.data.levels[type] || 0;
  player.look(Save.data.car || 'sedan', currentPaint().hex);
  game.mission = new Mission(type, level, game);
  setAvatar('car');
  game.state = 'brief';
  lastJunction = null;
  Input.reset();
  peds.reset(quality.peds, player);
  updateCamera(0, true);

  const m = game.mission;
  $('brief-tag').textContent = m.meta.tag;
  $('brief-level').textContent = level ? `Level ${level}` : 'No limits';
  $('brief-name').textContent = m.meta.name;
  $('brief-blurb').textContent = m.meta.blurb;
  const rows = [];
  if (m.goal) rows.push(['Distance', `${(m.routeDist() / 1000).toFixed(2)} km by road`]);
  if (m.timeLimit) rows.push(['Time limit', fmtTime(m.timeLimit)]);
  if (type === 'fuel') rows.push(['Fuel in tank', `${m.fuelBudget}%`]);
  if (type === 'parking') rows.push(['Bay length', `${m.bay.len.toFixed(1)} m for a ${player.L.toFixed(1)} m car`]);
  rows.push(['Traffic', `${traffic.cars.length} cars`]);
  $('brief-rules').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

  prepareHud(m, level ? `Level ${level}` : 'Free');
  hud.fuelGauge.hidden = type === 'free';
  for (const id of ['menu', 'pause', 'result']) show(id, false);
  show('hud', true);
  show('controls', false);
  show('brief', true);
  $('btn-start').focus();
}

function prepareHud(m, levelText) {
  hud.root.classList.toggle('no-goal', !m.goal);
  setText(hud.tag, m.meta.tag);
  setText(hud.level, levelText);
  setText(hud.name, m.meta.name);
  updateHud();
}

// Open City: free roam with jobs, police and stunts.
function startOpenWorld() {
  endCurrent();
  Sound.init();
  Sky.setCycle(settings.dayCycle);
  game.mission = new OpenWorld(game);
  game.state = 'playing';
  game.menuOpen = false;
  lastJunction = null;
  Input.reset();
  traffic.reset(quality.traffic, player);
  peds.reset(quality.peds, player);
  hud.fuelGauge.hidden = true;
  prepareHud(game.mission, '');
  for (const id of ['menu', 'pause', 'result', 'brief']) show(id, false);
  show('hud', true);
  show('controls', true);
  updateCamera(0, true);
  if (!Save.data.seenOpenHelp) {
    Save.data.seenOpenHelp = true;
    Save.store();
    setTimeout(() => showToast('Tip: tap Map to set a waypoint. Drive into T, D and R markers for work.'), 1500);
  }
}

// A multiplayer round: no briefing, the countdown starts straight away.
function startNetRound(round, slot) {
  endCurrent();
  player.look(round.carType || Save.data.car || 'sedan', MP.myPaint());
  player.reset(slot[0], slot[1], slot[2]);
  player.unlimitedFuel = true;
  game.mission = round;
  if (round.setup) round.setup();
  setAvatar('car');
  game.state = 'playing';
  game.menuOpen = false;
  lastJunction = null;
  Input.reset();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  hud.fuelGauge.hidden = true;
  peds.reset(quality.peds, player);
  prepareHud(round, `${MP.players.size} players`);
  updateCamera(0, true);
  for (const id of ['menu', 'pause', 'result', 'brief']) show(id, false);
  show('hud', true);
  show('controls', true);
}

function beginPlay() {
  show('brief', false);
  show('controls', true);
  game.state = 'playing';
  Sound.init();
}

function pause() {
  if (game.state !== 'playing' || !$('settings').hidden) return;
  const shared = MP.active;
  $('btn-restart').hidden = shared || game.mission.type === 'open';
  $('btn-quit').textContent = shared ? 'Leave game' : 'Main menu';
  if (shared) game.menuOpen = true;
  else game.state = 'paused';
  show('pause', true);
  $('btn-resume').focus();
}
function resume() {
  show('pause', false);
  Input.reset();
  if (MP.active) { game.menuOpen = false; return; }
  if (game.state === 'paused') game.state = 'playing';
}

function finish(result) {
  const m = game.mission, p = player;
  game.state = 'result';
  show('controls', false);
  Sound.chime(result.ok);
  let coins = 0;
  if (result.ok) {
    coins = m.reward();
    Save.data.coins += coins;
    if (m.level) Save.data.levels[m.type] = m.level + 1;
    Save.store();
  }
  $('result-title').textContent = result.ok ? 'Mission complete' : 'Mission failed';
  $('result').classList.toggle('is-fail', !result.ok);
  $('result-reason').textContent = result.ok
    ? (m.type === 'parking' ? 'Parked cleanly in the bay.' : 'You stopped at the destination.')
    : result.reason;
  const rows = [
    ['Time', fmtTime(m.elapsed)],
    ['Distance', `${(p.odometer / 1000).toFixed(2)} km`],
    ['Car condition', `${Math.round(100 - p.damage)}%`],
    ['Crashes', String(m.crashes)],
    ['Red lights run', String(m.redLights)],
  ];
  if (m.type === 'fuel') rows.splice(2, 0, ['Fuel left', `${p.fuel.toFixed(1)}%`]);
  if (result.ok) rows.push(['Cash earned', `+${money(coins)}`]);
  $('result-stats').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  const primary = $('btn-again');
  primary.textContent = result.ok ? (m.level ? `Play level ${m.level + 1}` : 'Drive again') : 'Try again';
  show('result', true);
  primary.focus();
}

// ---------- Settings screen ----------
function openSettings() {
  for (const el of document.querySelectorAll('#settings [data-setting]')) {
    const key = el.dataset.setting;
    if (el.type === 'checkbox') el.checked = !!settings[key];
    else if (el.type === 'range') el.value = settings[key];
  }
  for (const b of document.querySelectorAll('#settings .seg button')) {
    const on = String(settings[b.parentElement.dataset.setting]) === b.dataset.value;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
  }
  show('settings', true);
}
function closeSettings() { show('settings', false); }
for (const el of document.querySelectorAll('#settings input[data-setting]')) {
  el.addEventListener('input', () => {
    settings[el.dataset.setting] = el.type === 'checkbox' ? el.checked : Number(el.value);
    Save.store();
    applySettings();
    if (el.dataset.setting === 'dayCycle' && game.mission && game.mission.type === 'open') Sky.setCycle(settings.dayCycle);
  });
}
for (const b of document.querySelectorAll('#settings .seg button')) {
  b.addEventListener('click', () => {
    settings[b.parentElement.dataset.setting] = b.dataset.value;
    Save.store();
    applySettings();
    openSettings();
  });
}

// ---------- Input actions ----------
Input.bind({
  wheel: $('wheel'), stick: $('stick'), knob: $('stick-knob'),
  gas: $('pedal-gas'), brake: $('pedal-brake'), run: $('btn-run'), jump: $('btn-jump'), scene: canvas,
  buttons: [[$('btn-gear'), 'gear'], [$('btn-camera'), 'camera'], [$('btn-horn'), 'horn'], [$('btn-pause'), 'pause'],
    [$('btn-enter'), 'enter'], [$('btn-radio'), 'radio'], [$('btn-map'), 'map']],
});
Input.on('gear', () => {
  if (game.state !== 'playing' || game.avatar !== 'car') return;
  if (!player.shift()) showToast('Stop the car before changing gear');
});
Input.on('camera', () => {
  game.camMode = CAM_MODES[(CAM_MODES.indexOf(game.camMode) + 1) % CAM_MODES.length];
  updateCamera(0, true);
  showToast(CAM_LABELS[game.camMode]);
});
Input.on('horn', () => {
  Sound.init();
  Sound.horn();
  if (MP.active && game.state === 'playing') Net.send({ t: 'horn' });
});
Input.on('pause', () => {
  if (!$('map').hidden) { closeMap(); return; }
  if (!$('settings').hidden) { closeSettings(); return; }
  if (game.state === 'paused' || game.menuOpen) resume(); else pause();
});
Input.on('mute', () => {
  Sound.setMuted(!Sound.muted);
  $('set-mute').checked = Sound.muted;
  showToast(Sound.muted ? 'Sound off' : 'Sound on');
});
$('set-mute').addEventListener('input', () => Sound.setMuted($('set-mute').checked));
Input.on('enter', () => {
  if (game.state !== 'playing' || game.menuOpen) return;
  const m = game.mission, ow = m.type === 'open' ? m : m.world;
  if (!ow || ow.frozen()) return;
  if (game.avatar === 'car') ow.exitCar(); else ow.enterNearest();
});
Input.on('map', () => { if ($('map').hidden) openMap(); else closeMap(); });
Input.on('radio', () => {
  if (game.avatar !== 'car' || game.state !== 'playing') return;
  const name = Radio.next();
  Save.data.radio = Radio.station;
  Save.store();
  showToast(name);
});

$('btn-start').addEventListener('click', beginPlay);
$('btn-brief-back').addEventListener('click', goMenu);
$('btn-resume').addEventListener('click', resume);
$('btn-restart').addEventListener('click', () => { show('pause', false); startMission(game.mission.type); });
$('btn-quit').addEventListener('click', () => (MP.active ? MP.leave() : goMenu()));
$('btn-pause-settings').addEventListener('click', openSettings);
$('btn-again').addEventListener('click', () => startMission(game.mission.type));
$('btn-result-menu').addEventListener('click', goMenu);
$('btn-open-city').addEventListener('click', startOpenWorld);
$('btn-settings').addEventListener('click', openSettings);
$('btn-settings-close').addEventListener('click', closeSettings);
$('btn-map-close').addEventListener('click', closeMap);
$('map-canvas').addEventListener('click', (e) => {
  const c = $('map-canvas'), mp = c._map;
  if (!mp) return;
  const r = c.getBoundingClientRect();
  const x = ((e.clientX - r.left) * mp.ratio - mp.ox) / mp.s, z = ((e.clientY - r.top) * mp.ratio - mp.oz) / mp.s;
  if (x < -20 || z < -20 || x > CITY.SIZE + 20 || z > CITY.SIZE + 20) return;
  game.waypoint = game.waypoint && Math.hypot(game.waypoint.x - x, game.waypoint.z - z) < 25 ? null : { x, z };
  drawFullMap();
});
document.addEventListener('visibilitychange', () => { if (document.hidden && !MP.active) pause(); });
addEventListener('blur', () => { if (!MP.active) pause(); });

// ---------- Main loop ----------
let lastJunction = null;
function checkRedLight() {
  const j = world.junctionAt(player.x, player.z);
  if (j && j !== lastJunction && Math.abs(player.v) > 1.5) {
    const f = player.forward;
    const axis = Math.abs(f.x) > Math.abs(f.z) ? 0 : 1;
    if (lightState(j, axis, game.t) === 'red') game.mission.onRedLight();
  }
  lastJunction = j;
}

peds.onHit = (ped, vehicle, speed) => {
  if (vehicle !== player || game.state !== 'playing') return;
  Sound.crash(speed * 0.5);
  if (game.mission && game.mission.onPedHit) game.mission.onPedHit(ped, vehicle, speed);
};

function policeCars() {
  const m = game.mission;
  const p = m && (m.police || (m.world && m.world.police));
  return p ? p.cars : [];
}

// Everything that's in the street besides traffic itself.
function streetObstacles() {
  const m = game.mission;
  if (!m || game.state === 'menu') return peds.inRoad();
  return [actor()].concat(m.statics, peds.inRoad(), MP.obstacles(), policeCars());
}

function stepPlaying(dt) {
  const m = game.mission;
  Input.update(dt);
  const hold = game.menuOpen || (m.frozen && m.frozen());
  if (game.avatar === 'car') {
    const input = hold ? { steer: Input.state.steer, throttle: 0, brake: 1 } : Input.state;
    player.update(dt, input, world, traffic.cars.concat(m.statics, MP.obstacles(), policeCars()));
    for (const e of player.events.splice(0)) {
      if (e.type === 'crash') {
        Sound.crash(e.closing || 6);
        if (e.dmg > 4) { showToast(`Crash: −${Math.round(e.dmg)}% condition`, 'bad'); Feel.buzz(Math.min(120, 20 + e.dmg * 3)); }
        m.onCrash(e);
      } else if (e.type === 'land') {
        if (m.onLand) m.onLand(e.air);
        else if (m.world) m.world.onLand(e.air);
      } else if (e.type === 'wrecked') {
        showToast('Your car is on fire. Get out!', 'bad');
        Feel.buzz(150);
      } else if (e.type === 'explode') {
        Sound.boom();
        Feel.buzz(300);
        if (m.onExplode) m.onExplode(); else if (m.world) m.world.onExplode();
      }
    }
    checkRedLight();
  } else {
    const input = hold ? { mx: 0, my: 0, run: false, jump: false } : Input.state;
    walker.update(dt, input, world, traffic.cars.concat(m.statics, policeCars(), MP.obstacles().filter((o) => o.mode !== 'foot')), cam.yaw);
    for (const e of walker.events.splice(0)) {
      if (e.type === 'knocked') { Sound.crash(6); Feel.buzz(80); showToast(`You got hit: −${Math.round(e.dmg)} health`, 'bad'); }
    }
  }
  const result = m.update(dt);
  updateHud();
  if (result) (MP.active ? MP.localFinish(result) : finish(result));
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const st = game.state;
  const running = st !== 'paused';
  if (running) {
    game.t += dt;
    world.updateLights(game.t);
  }
  if (st === 'playing') stepPlaying(dt);
  if (running) {
    const me = actor();
    const focus = st === 'menu' ? [{ x: CITY.SIZE / 2, z: CITY.SIZE / 2 }] : [me].concat(MP.remoteList());
    if (MP.active) MP.frame(dt);
    else {
      traffic.update(dt, game.t, streetObstacles());
      if (st !== 'menu') traffic.recycle(dt, focus);
    }
    const threats = st === 'playing' ? (game.avatar === 'car' ? [player] : []).concat(policeCars(), MP.remoteList().filter((r) => r.mode !== 'foot')) : [];
    peds.update(dt, game.t, threats, st === 'menu' ? null : me);
    Effects.update(dt);
    Sky.update(dt, camera, st !== 'menu' && game.avatar === 'car' ? player : null);
    if (!$('map').hidden && Math.floor(game.t * 4) !== Math.floor((game.t - dt) * 4)) drawFullMap();
  }
  Sound.setEngine(player.v, Input.state.throttle, st === 'playing' && game.avatar === 'car' && !player.wrecked);
  updateCamera(dt, false);
  renderer.render(scene, camera);
}

applySettings();
traffic.reset(quality.traffic);
peds.reset(quality.peds, null);
player.show(false);
renderMenu();
updateCamera(0, true);
// Start once every script (multiplayer.js loads after this file) is in.
addEventListener('DOMContentLoaded', () => requestAnimationFrame(frame));
