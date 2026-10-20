'use strict';

// Synthesised sound: engine drone, horn, crash and chimes. Nothing plays until
// Sound.init() runs from a user gesture.
const Sound = (() => {
  let ctx = null, master = null, engine = null, muted = false;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(ctx.destination);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const a = ctx.createOscillator(), b = ctx.createOscillator();
    a.type = 'sawtooth'; b.type = 'square';
    a.connect(filter); b.connect(filter);
    filter.connect(gain); gain.connect(master);
    a.start(); b.start();
    engine = { a, b, filter, gain };
  }

  function setEngine(speed, throttle, on) {
    if (!engine) return;
    const s = Math.abs(speed);
    const gear = Math.min(4, Math.floor(s / 8));
    const within = (s - gear * 8) / 8;
    const f = 42 + within * 62 + gear * 6 + throttle * 14;
    const now = ctx.currentTime;
    engine.a.frequency.setTargetAtTime(f, now, 0.05);
    engine.b.frequency.setTargetAtTime(f / 2, now, 0.05);
    engine.filter.frequency.setTargetAtTime(380 + throttle * 700 + s * 12, now, 0.08);
    engine.gain.gain.setTargetAtTime(on ? 0.07 + throttle * 0.06 : 0, now, 0.1);
  }

  function tone(freq, dur, type = 'square', vol = 0.12, when = 0) {
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.02);
    g.gain.setValueAtTime(vol, t0 + dur - 0.05);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function horn(dur = 0.35, base = 410) {
    tone(base, dur, 'square', 0.07);
    tone(base * 1.26, dur, 'square', 0.06);
  }

  function crash(strength) {
    if (!ctx) return;
    const len = 0.35, buf = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate), data = buf.getChannelData(0);
    for (let k = 0; k < data.length; k++) data[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / data.length, 2);
    const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900;
    g.gain.value = Math.min(0.9, 0.2 + strength * 0.04);
    src.buffer = buf;
    src.connect(f); f.connect(g); g.connect(master);
    src.start();
  }

  function chime(ok) {
    const notes = ok ? [523, 659, 784, 1047] : [392, 330, 262];
    notes.forEach((n, k) => tone(n, 0.18, 'triangle', 0.14, k * 0.12));
  }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.value = m ? 0 : 0.55;
  }

  return { init, setEngine, horn, crash, chime, tone, setMuted, get muted() { return muted; } };
})();
