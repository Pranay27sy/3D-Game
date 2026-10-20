'use strict';

// Keyboard plus on-screen steering wheel and pedals, merged into one state.
const Input = (() => {
  const WHEEL_MAX = 140; // degrees of wheel rotation for full lock
  const keys = new Set();
  const state = { steer: 0, throttle: 0, brake: 0 };
  const touch = { wheelHeld: false, wheelAngle: 0, lastAngle: 0, gas: false, brake: false };
  const handlers = {};
  let wheelEl = null;

  const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
  const ACTIONS = { KeyQ: 'gear', KeyG: 'gear', KeyC: 'camera', KeyH: 'horn', KeyP: 'pause', Escape: 'pause', KeyM: 'mute' };

  addEventListener('keydown', (e) => {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (!e.repeat && ACTIONS[e.code]) emit(ACTIONS[e.code]);
    keys.add(e.code);
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  function emit(name) { if (handlers[name]) handlers[name](); }
  function on(name, fn) { handlers[name] = fn; }

  function hold(el, key) {
    const down = (e) => { e.preventDefault(); el.setPointerCapture?.(e.pointerId); touch[key] = true; el.classList.add('is-down'); };
    const up = () => { touch[key] = false; el.classList.remove('is-down'); };
    el.addEventListener('pointerdown', down);
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, up);
  }

  function bind({ wheel, gas, brake, buttons }) {
    wheelEl = wheel;
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
    hold(gas, 'gas');
    hold(brake, 'brake');
    for (const [el, action] of buttons) el.addEventListener('click', () => emit(action));
  }

  const approach = (v, t, step) => (v < t ? Math.min(t, v + step) : Math.max(t, v - step));

  function update(dt) {
    const left = keys.has('ArrowLeft') || keys.has('KeyA');
    const right = keys.has('ArrowRight') || keys.has('KeyD');
    if (touch.wheelHeld) {
      state.steer = touch.wheelAngle / WHEEL_MAX;
    } else if (left !== right) {
      state.steer = approach(state.steer, right ? 1 : -1, dt * 2.6);
    } else {
      state.steer = approach(state.steer, 0, dt * 3.5);
    }
    if (!touch.wheelHeld) touch.wheelAngle = state.steer * WHEEL_MAX;

    const gas = touch.gas || keys.has('ArrowUp') || keys.has('KeyW');
    const brake = touch.brake || keys.has('ArrowDown') || keys.has('KeyS') || keys.has('Space');
    state.throttle = approach(state.throttle, gas ? 1 : 0, dt * (gas ? 3 : 8));
    state.brake = approach(state.brake, brake ? 1 : 0, dt * 8);

    if (wheelEl) wheelEl.style.transform = `rotate(${touch.wheelAngle.toFixed(1)}deg)`;
  }

  function reset() {
    state.steer = state.throttle = state.brake = 0;
    touch.wheelAngle = 0;
    touch.wheelHeld = touch.gas = touch.brake = false;
    keys.clear();
  }

  return { state, bind, update, on, reset };
})();
