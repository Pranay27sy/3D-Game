'use strict';

// Synthesised sound: engine drone, horn, siren, crash and chimes. Nothing plays
// until Sound.init() runs from a user gesture. The radio (radio.js) plays
// through the same audio context on its own volume control.
const Sound = (() => {
  let ctx = null, master = null, music = null, engine = null, siren = null;
  let muted = false, volume = 0.8, musicVolume = 0.6;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);
    music = ctx.createGain();
    music.gain.value = muted ? 0 : musicVolume;
    music.connect(ctx.destination);

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

    // Siren: a square wave swept by a slow LFO.
    const so = ctx.createOscillator(), lfo = ctx.createOscillator(), depth = ctx.createGain(), sg = ctx.createGain(), sf = ctx.createBiquadFilter();
    so.type = 'square'; so.frequency.value = 760;
    lfo.type = 'triangle'; lfo.frequency.value = 0.55;
    depth.gain.value = 190;
    lfo.connect(depth); depth.connect(so.frequency);
    sf.type = 'lowpass'; sf.frequency.value = 2200;
    sg.gain.value = 0;
    so.connect(sf); sf.connect(sg); sg.connect(master);
    so.start(); lfo.start();
    siren = { gain: sg };
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

  // level 0..1 by distance to the nearest police car.
  function setSiren(level) {
    if (!siren) return;
    siren.gain.gain.setTargetAtTime(level * 0.05, ctx.currentTime, 0.15);
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

  function horn(dur = 0.35, base = 410, vol = 1) {
    if (vol < 0.03) return;
    tone(base, dur, 'square', 0.07 * vol);
    tone(base * 1.26, dur, 'square', 0.06 * vol);
  }

  function noise(len, vol, cutoff) {
    if (!ctx) return;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate), data = buf.getChannelData(0);
    for (let k = 0; k < data.length; k++) data[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / data.length, 2);
    const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = cutoff;
    g.gain.value = vol;
    src.buffer = buf;
    src.connect(f); f.connect(g); g.connect(master);
    src.start();
  }

  function crash(strength) { noise(0.35, Math.min(0.9, 0.2 + strength * 0.04), 900); }
  function boom() { noise(1.4, 1, 420); }

  function chime(ok) {
    const notes = ok ? [523, 659, 784, 1047] : [392, 330, 262];
    notes.forEach((n, k) => tone(n, 0.18, 'triangle', 0.14, k * 0.12));
  }

  function coin() { tone(988, 0.08, 'square', 0.08); tone(1319, 0.16, 'square', 0.08, 0.07); }

  function apply() {
    if (master) master.gain.value = muted ? 0 : volume;
    if (music) music.gain.value = muted ? 0 : musicVolume;
  }

  return {
    init, setEngine, setSiren, horn, crash, boom, chime, coin, tone,
    setMuted(m) { muted = m; apply(); },
    setVolume(v) { volume = v; apply(); },
    setMusicVolume(v) { musicVolume = v; apply(); },
    get muted() { return muted; },
    get ctx() { return ctx; },
    get musicOut() { return music; },
  };
})();
