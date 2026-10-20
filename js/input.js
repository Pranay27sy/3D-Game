'use strict';

// Keyboard, on-screen controls and tilt steering, merged into one state.
// In a car: steering wheel and pedals. On foot: joystick, run and jump.
const Input = (() => {
  const WHEEL_MAX = 140; // degrees of wheel rotation for full lock
  const keys = new Set();
  const state = { steer: 0, throttle: 0, brake: 0, mx: 0, my: 0, run: false, jump: false };
  const touch = { wheelHeld: false, wheelAngle: 0, lastAngle: 0, gas: false, brake: false, run: false, stick: null, sx: 0, sy: 0 };
  const handlers = {};
  let wheelEl = null, knobEl = null, mode = 'car', steering = 'wheel', sensitivity = 1;
  let gravity = null, camDrag = 0, jumpQueued = false;

  const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
  const ACTIONS = { KeyQ: 'gear', KeyG: 'gear', KeyC: 'camera', KeyH: 'horn', KeyP: 'pause', Escape: 'pause', KeyN: 'mute', KeyF: 'enter', KeyE: 'enter', KeyM: 'map', KeyR: 'radio' };

  addEventListener('keydown', (e) => {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (!e.repeat && ACTIONS[e.code]) emit(ACTIONS[e.code]);
    if (!e.repeat && e.code === 'Space' && mode === 'foot') jumpQueued = true;
    keys.add(e.code);
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  // Tilt: gravity as the phone sees it, turned into a steering angle in update().
  addEventListener('devicemotion', (e) => {
    const g = e.accelerationIncludingGravity;
    if (g && g.x !== null) gravity = { x: g.x, y: g.y };
  });

  function emit(name) { if (handlers[name]) handlers[name](); }
  function on(name, fn) { handlers[name] = fn; }

  function hold(el, key) {
    const down = (e) => { e.preventDefault(); el.setPointerCapture?.(e.pointerId); touch[key] = true; el.classList.add('is-down'); };
    const up = () => { touch[key] = false; el.classList.remove('is-down'); };
    el.addEventListener('pointerdown', down);
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, up);
  }

  function bind({ wheel, stick, knob, gas, brake, run, jump, scene, buttons }) {
    wheelEl = wheel;
    knobEl = knob;
    const angleAt = (e) => {
      const r = wheel.getBoundingClientRect();
      return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
    };
    wheel.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      wheel.setPointerCapture?.(e.pointerId);
      touch.wheelHeld = true;
      touch.lastAngle = angleAt(e);
    });
    wheel.addEventListener('pointermove', (e) => {
      if (!touch.wheelHeld) return;
      const a = angleAt(e);
      const da = wrapAngle(a - touch.lastAngle);
      touch.lastAngle = a;
      touch.wheelAngle = clamp(touch.wheelAngle + (da * 180) / Math.PI, -WHEEL_MAX, WHEEL_MAX);
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) wheel.addEventListener(ev, () => { touch.wheelHeld = false; });

    // Joystick: the knob follows your thumb inside the ring.
    const stickAt = (e) => {
      const r = stick.getBoundingClientRect(), rad = r.width / 2;
      let dx = (e.clientX - (r.left + rad)) / rad, dy = (e.clientY - (r.top + rad)) / rad;
      const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      touch.sx = dx; touch.sy = dy;
    };
    stick.addEventListener('pointerdown', (e) => { e.preventDefault(); stick.setPointerCapture?.(e.pointerId); touch.stick = e.pointerId; stickAt(e); });
    stick.addEventListener('pointermove', (e) => { if (touch.stick === e.pointerId) stickAt(e); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) stick.addEventListener(ev, () => { touch.stick = null; touch.sx = touch.sy = 0; });

    hold(gas, 'gas');
    hold(brake, 'brake');
    hold(run, 'run');
    jump.addEventListener('pointerdown', (e) => { e.preventDefault(); jumpQueued = true; });

    // Dragging across the 3D view turns the camera.
    let drag = null;
    scene.addEventListener('pointerdown', (e) => { drag = { id: e.pointerId, x: e.clientX }; });
    scene.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      camDrag += (e.clientX - drag.x) * 0.008;
      drag.x = e.clientX;
    });
    for (const ev of ['pointerup', 'pointercancel']) scene.addEventListener(ev, () => { drag = null; });

    for (const [el, action] of buttons) el.addEventListener('click', () => emit(action));
  }

  const approach = (v, t, step) => (v < t ? Math.min(t, v + step) : Math.max(t, v - step));

  function tiltSteer() {
    if (!gravity) return 0;
    const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    let a;
    if (angle === 90) a = Math.atan2(gravity.y, gravity.x);
    else if (angle === 270 || angle === -90) a = Math.atan2(-gravity.y, -gravity.x);
    else a = Math.atan2(gravity.x, gravity.y) * -1;
    return clamp((a / 0.45) * sensitivity, -1, 1);
  }

  function update(dt) {
    const left = keys.has('ArrowLeft') || keys.has('KeyA');
    const right = keys.has('ArrowRight') || keys.has('KeyD');
    const up = keys.has('ArrowUp') || keys.has('KeyW');
    const down = keys.has('ArrowDown') || keys.has('KeyS');

    if (touch.wheelHeld) {
      state.steer = clamp((touch.wheelAngle / WHEEL_MAX) * sensitivity, -1, 1);
    } else if (left !== right) {
      state.steer = approach(state.steer, right ? 1 : -1, dt * 2.6 * sensitivity);
    } else if (steering === 'tilt' && mode === 'car') {
      state.steer = tiltSteer();
    } else {
      state.steer = approach(state.steer, 0, dt * 3.5);
    }
    if (!touch.wheelHeld) touch.wheelAngle = state.steer * WHEEL_MAX;

    const gas = touch.gas || up;
    const brake = touch.brake || down || keys.has('Space');
    state.throttle = approach(state.throttle, gas ? 1 : 0, dt * (gas ? 3 : 8));
    state.brake = approach(state.brake, brake ? 1 : 0, dt * 8);

    // On foot: joystick or WASD, relative to the camera.
    state.mx = touch.stick !== null ? touch.sx : (right ? 1 : 0) - (left ? 1 : 0);
    state.my = touch.stick !== null ? -touch.sy : (up ? 1 : 0) - (down ? 1 : 0);
    state.run = touch.run || keys.has('ShiftLeft') || keys.has('ShiftRight');
    state.jump = jumpQueued;
    jumpQueued = false;

    if (wheelEl) wheelEl.style.transform = `rotate(${touch.wheelAngle.toFixed(1)}deg)`;
    if (knobEl) knobEl.style.transform = `translate(${(touch.sx * 50).toFixed(1)}%, ${(touch.sy * 50).toFixed(1)}%)`;
  }

  function reset() {
    state.steer = state.throttle = state.brake = state.mx = state.my = 0;
    state.run = state.jump = false;
    touch.wheelAngle = 0;
    touch.wheelHeld = touch.gas = touch.brake = touch.run = false;
    touch.stick = null;
    touch.sx = touch.sy = 0;
    jumpQueued = false;
    keys.clear();
  }

  return {
    state, bind, update, on, reset, emit,
    set mode(m) { mode = m; },
    get mode() { return mode; },
    set steering(s) { steering = s; },
    set sensitivity(s) { sensitivity = s; },
    takeCamDrag() { const d = camDrag; camDrag = 0; return d; },
  };
})();
