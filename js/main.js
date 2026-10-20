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
  data: { coins: 0, levels: { speed: 1, fuel: 1, parking: 1, safe: 1 }, paints: ['red'], paint: 'red' },
  load() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (d) this.data = { ...this.data, ...d, levels: { ...this.data.levels, ...d.levels } };
    } catch (e) { /* storage unavailable: play without saving */ }
  },
  store() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
  },
};
Save.load();

// ---------- Scene ----------
const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd0ee);
scene.fog = new THREE.Fog(0x9fd0ee, 160, 520);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1200);

scene.add(new THREE.HemisphereLight(0xdcefff, 0x5d6b4f, 0.75));
const sun = new THREE.DirectionalLight(0xfff3df, 0.85);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 260 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

const world = new World(scene);
const currentPaint = () => PAINTS.find((p) => p.id === Save.data.paint) || PAINTS[0];
const player = new PlayerCar(scene, currentPaint().hex);
const traffic = new Traffic(world, scene);

const game = {
  scene, world, player, traffic,
  mission: null,
  state: 'menu',      // menu | brief | playing | paused | result
  t: 0,
  camMode: 'chase',
  toast: showToast,
};

traffic.reset(32);
player.parts.group.visible = false;

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------- Camera ----------
const cam = { pos: new THREE.Vector3(CITY.SIZE / 2, 120, CITY.SIZE + 140), look: new THREE.Vector3(CITY.SIZE / 2, 0, CITY.SIZE / 2) };
const CAM_MODES = ['chase', 'hood', 'high'];
const CAM_LABELS = { chase: 'Chase view', hood: 'Driver view', high: 'High view' };

function updateCamera(dt, snap) {
  const tmpPos = new THREE.Vector3(), tmpLook = new THREE.Vector3();
  let k = snap ? 1 : 1 - Math.exp(-dt * 6);
  if (game.state === 'menu') {
    const a = game.t * 0.05;
    tmpPos.set(CITY.SIZE / 2 + Math.sin(a) * 230, 110, CITY.SIZE / 2 + Math.cos(a) * 230);
    tmpLook.set(CITY.SIZE / 2, 0, CITY.SIZE / 2);
    k = snap ? 1 : 1 - Math.exp(-dt * 2);
  } else {
    const p = player, f = p.forward;
    if (game.camMode === 'chase') {
      tmpPos.set(p.x - f.x * 8.5, 4, p.z - f.z * 8.5);
      tmpLook.set(p.x + f.x * 4, 1.2, p.z + f.z * 4);
    } else if (game.camMode === 'hood') {
      // Driver's seat is on the left for right-hand traffic.
      tmpPos.set(p.x + f.x * 0.75 + f.z * 0.36, 1.32, p.z + f.z * 0.75 - f.x * 0.36);
      tmpLook.set(tmpPos.x + f.x * 12, 1.12, tmpPos.z + f.z * 12);
      k = 1;
    } else {
      tmpPos.set(p.x - f.x * 15, 15, p.z - f.z * 15);
      tmpLook.set(p.x + f.x * 6, 0, p.z + f.z * 6);
    }
  }
  cam.pos.lerp(tmpPos, k);
  cam.look.lerp(tmpLook, k);
  camera.position.copy(cam.pos);
  camera.lookAt(cam.look);

  const c = game.state === 'menu' ? cam.look : new THREE.Vector3(player.x, 0, player.z);
  sun.position.set(c.x + 40, 80, c.z + 25);
  sun.target.position.copy(c);
  if (game.state === 'menu') Object.assign(sun.shadow.camera, { left: -200, right: 200, top: 200, bottom: -200 });
  else Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70 });
  sun.shadow.camera.updateProjectionMatrix();
}

// ---------- HUD ----------
const hud = {
  root: $('hud'), controls: $('controls'),
  tag: $('hud-tag'), level: $('hud-level'), name: $('hud-name'), objective: $('hud-objective'),
  statLabel: $('hud-stat-label'), stat: $('hud-stat'),
  nav: $('nav'), navArrow: $('nav-arrow'), navDist: $('nav-dist'),
  speed: $('hud-speed'), health: $('bar-health'), fuel: $('bar-fuel'), fuelGauge: $('gauge-fuel'),
  gear: $('btn-gear'), camera: $('btn-camera'), mute: $('btn-mute'),
  minimap: $('minimap'),
};
const setText = (el, s) => { if (el.textContent !== s) el.textContent = s; };

let toastTimer = 0;
function showToast(msg, kind = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast is-shown ${kind ? 'is-' + kind : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2000);
}

function updateHud() {
  const m = game.mission, p = player;
  const info = m.hud();
  setText(hud.statLabel, info.label);
  setText(hud.stat, info.value);
  hud.stat.classList.toggle('is-warn', info.warn);
  setText(hud.objective, m.objective());
  setText(hud.speed, String(Math.round(Math.abs(p.v) * 3.6)));
  setText(hud.gear, p.gear);
  hud.gear.classList.toggle('is-reverse', p.gear === 'R');
  hud.health.style.width = `${100 - p.damage}%`;
  hud.health.classList.toggle('is-low', p.damage > 65);
  hud.fuel.style.width = `${p.fuel}%`;
  hud.fuel.classList.toggle('is-low', p.fuel < 20);

  if (m.goal) {
    const f = p.forward, dx = m.goal.x - p.x, dz = m.goal.z - p.z;
    const rel = Math.atan2(dx * -f.z + dz * f.x, dx * f.x + dz * f.z);
    hud.navArrow.style.transform = `rotate(${rel.toFixed(3)}rad)`;
    setText(hud.navDist, `${Math.round(Math.hypot(dx, dz))} m`);
  }
  drawMinimap();
}

function drawMinimap() {
  const c = hud.minimap, g = c.getContext('2d'), size = c.width;
  const { SIZE, PITCH, N, ROAD } = CITY;
  const pad = 14, s = (size - pad * 2) / SIZE;
  const X = (x) => pad + x * s;
  g.clearRect(0, 0, size, size);
  g.fillStyle = 'rgba(10, 32, 66, 0.82)';
  g.fillRect(0, 0, size, size);
  g.strokeStyle = 'rgba(232, 238, 246, 0.55)';
  g.lineWidth = ROAD * s;
  g.beginPath();
  for (let k = 0; k <= N; k++) {
    g.moveTo(X(k * PITCH), X(-CITY.HALF)); g.lineTo(X(k * PITCH), X(SIZE + CITY.HALF));
    g.moveTo(X(-CITY.HALF), X(k * PITCH)); g.lineTo(X(SIZE + CITY.HALF), X(k * PITCH));
  }
  g.stroke();
  g.fillStyle = 'rgba(255, 255, 255, 0.5)';
  for (const t of traffic.cars) g.fillRect(X(t.x) - 2, X(t.z) - 2, 4, 4);
  const m = game.mission;
  if (m && m.goal) {
    g.fillStyle = m.type === 'parking' ? '#4f93ff' : '#3ce07a';
    g.beginPath(); g.arc(X(m.goal.x), X(m.goal.z), 7, 0, Math.PI * 2); g.fill();
  }
  const f = player.forward;
  g.save();
  g.translate(X(player.x), X(player.z));
  g.rotate(Math.atan2(f.x, -f.z));
  g.fillStyle = '#f2c230';
  g.strokeStyle = '#0a2042';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, -10); g.lineTo(7, 7); g.lineTo(0, 3); g.lineTo(-7, 7); g.closePath();
  g.fill(); g.stroke();
  g.restore();
}

// ---------- Game flow ----------
function show(id, on) { $(id).hidden = !on; }

function renderMenu() {
  $('menu-coins').textContent = Save.data.coins.toLocaleString();
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
      <span class="paint-name">${p.name}</span><span class="paint-price">${sel ? 'Selected' : owned ? 'Owned' : p.price + ' coins'}</span>`;
    b.addEventListener('click', () => choosePaint(p));
    paints.appendChild(b);
  }
}

function choosePaint(p) {
  const d = Save.data;
  if (!d.paints.includes(p.id)) {
    if (d.coins < p.price) { showToast(`You need ${p.price - d.coins} more coins for ${p.name}`, 'bad'); return; }
    d.coins -= p.price;
    d.paints.push(p.id);
    showToast(`Bought ${p.name}`, 'good');
  }
  d.paint = p.id;
  Save.store();
  player.setColor(p.hex);
  player.parts.group.visible = game.state !== 'menu';
  renderMenu();
}

function goMenu() {
  if (game.mission) { game.mission.dispose(); game.mission = null; }
  traffic.blocked = new Set();
  game.state = 'menu';
  player.parts.group.visible = false;
  for (const id of ['hud', 'controls', 'brief', 'pause', 'result']) show(id, false);
  show('menu', true);
  renderMenu();
  traffic.reset(32);
}

function startMission(type) {
  if (game.mission) game.mission.dispose();
  const level = Save.data.levels[type] || 0;
  player.setColor(currentPaint().hex);
  player.parts.group.visible = true;
  game.mission = new Mission(type, level, game);
  game.state = 'brief';
  lastJunction = null;
  Input.reset();
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
  if (type === 'parking') rows.push(['Bay length', `${m.bay.len.toFixed(1)} m for a 4.3 m car`]);
  rows.push(['Traffic', `${traffic.cars.length} cars`]);
  $('brief-rules').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

  hud.root.classList.toggle('no-goal', !m.goal);
  hud.fuelGauge.hidden = type === 'free';
  setText(hud.tag, m.meta.tag);
  setText(hud.level, level ? `Level ${level}` : 'Free');
  setText(hud.name, m.meta.name);
  updateHud();
  for (const id of ['menu', 'pause', 'result']) show(id, false);
  show('hud', true);
  show('controls', false);
  show('brief', true);
  $('btn-start').focus();
}

function beginPlay() {
  show('brief', false);
  show('controls', true);
  game.state = 'playing';
  Sound.init();
}

function pause() {
  if (game.state !== 'playing') return;
  game.state = 'paused';
  show('pause', true);
  $('btn-resume').focus();
}
function resume() {
  if (game.state !== 'paused') return;
  show('pause', false);
  game.state = 'playing';
  Input.reset();
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
  if (result.ok) rows.push(['Coins earned', `+${coins}`]);
  $('result-stats').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  const primary = $('btn-again');
  primary.textContent = result.ok ? (m.level ? `Play level ${m.level + 1}` : 'Drive again') : 'Try again';
  show('result', true);
  primary.focus();
}

// ---------- Input actions ----------
Input.bind({
  wheel: $('wheel'),
  gas: $('pedal-gas'),
  brake: $('pedal-brake'),
  buttons: [[$('btn-gear'), 'gear'], [$('btn-camera'), 'camera'], [$('btn-horn'), 'horn'], [$('btn-pause'), 'pause'], [$('btn-mute'), 'mute']],
});
Input.on('gear', () => {
  if (game.state !== 'playing') return;
  if (!player.shift()) showToast('Stop the car before changing gear');
});
Input.on('camera', () => {
  game.camMode = CAM_MODES[(CAM_MODES.indexOf(game.camMode) + 1) % CAM_MODES.length];
  updateCamera(0, true);
  showToast(CAM_LABELS[game.camMode]);
});
Input.on('horn', () => { Sound.init(); Sound.horn(); });
Input.on('pause', () => (game.state === 'paused' ? resume() : pause()));
Input.on('mute', () => {
  Sound.setMuted(!Sound.muted);
  hud.mute.textContent = Sound.muted ? 'Sound off' : 'Sound on';
  hud.mute.setAttribute('aria-pressed', String(!Sound.muted));
});

$('btn-start').addEventListener('click', beginPlay);
$('btn-brief-back').addEventListener('click', goMenu);
$('btn-resume').addEventListener('click', resume);
$('btn-restart').addEventListener('click', () => startMission(game.mission.type));
$('btn-quit').addEventListener('click', goMenu);
$('btn-again').addEventListener('click', () => startMission(game.mission.type));
$('btn-result-menu').addEventListener('click', goMenu);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
addEventListener('blur', pause);

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

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const st = game.state;
  if (st !== 'paused') {
    game.t += dt;
    world.updateLights(game.t);
  }
  if (st === 'menu') {
    traffic.update(dt, game.t, null, []);
  } else if (st === 'brief' || st === 'result') {
    traffic.update(dt, game.t, player, game.mission.statics);
  } else if (st === 'playing') {
    const m = game.mission;
    Input.update(dt);
    player.update(dt, Input.state, world, traffic.cars.concat(m.statics));
    for (const e of player.events.splice(0)) {
      Sound.crash(e.closing);
      if (e.dmg > 4) showToast(`Crash: −${Math.round(e.dmg)}% condition`, 'bad');
      m.onCrash(e);
    }
    traffic.update(dt, game.t, player, m.statics);
    checkRedLight();
    const result = m.update(dt);
    updateHud();
    if (result) finish(result);
  }
  Sound.setEngine(player.v, Input.state.throttle, game.state === 'playing');
  updateCamera(dt, false);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

renderMenu();
updateCamera(0, true);
requestAnimationFrame(frame);
