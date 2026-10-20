'use strict';

// In-car radio: three stations of music generated on the fly with Web Audio.
// A step sequencer schedules sixteenth notes a little ahead of time.
const Radio = (() => {
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const STATIONS = [
    {
      name: 'Sundale FM · Synthwave', bpm: 100,
      chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
      play(s, step, t, bar, ch) {
        const b = step % 16;
        if (b % 8 === 0) s.kick(t);
        if (b === 4 || b === 12) s.snare(t, 0.35);
        if (b % 2 === 0) s.hat(t, 0.05);
        if (b % 2 === 0) s.bass(t, midi(ch[0] - 24), 0.2, 'sawtooth');
        if (b === 0) s.pad(t, ch.map((n) => midi(n)), 2.3, 'sawtooth', 0.035);
        s.lead(t, midi(ch[b % 3] + 12 + (b % 6 === 5 ? 12 : 0)), 0.12, 'square', 0.025);
      },
    },
    {
      name: 'Lo-Fi Lane', bpm: 78,
      chords: [[50, 53, 57, 60], [55, 59, 62, 65], [48, 52, 55, 59], [57, 60, 64, 67]],
      play(s, step, t, bar, ch) {
        const b = step % 16;
        if (b === 0 || b === 7 || b === 10) s.kick(t, 0.7);
        if (b === 4 || b === 12) s.snare(t, 0.2);
        if (b % 2 === 0) s.hat(t + (b % 4 === 2 ? 0.04 : 0), 0.03);
        if (b === 0) s.pad(t, ch.map((n) => midi(n)), 3, 'triangle', 0.05);
        if (b === 0 || b === 10) s.bass(t, midi(ch[0] - 12), 0.5, 'triangle', 0.12);
        if (Math.random() < 0.18) s.lead(t, midi([62, 64, 67, 69, 72, 74][Math.floor(Math.random() * 6)]), 0.3, 'sine', 0.05);
      },
    },
    {
      name: 'Dockside House', bpm: 122,
      chords: [[53, 56, 60], [51, 55, 58], [49, 53, 56], [51, 55, 58]],
      play(s, step, t, bar, ch) {
        const b = step % 16;
        if (b % 4 === 0) s.kick(t, 1);
        if (b % 4 === 2) s.hat(t, 0.08, true);
        if (b === 4 || b === 12) s.snare(t, 0.3);
        if (b % 4 === 2) s.bass(t, midi(ch[0] - 24 + (b === 14 ? 12 : 0)), 0.16, 'square', 0.1);
        if (b === 3 || b === 6 || b === 11) s.pad(t, ch.map((n) => midi(n + 12)), 0.14, 'sawtooth', 0.04);
      },
    },
  ];

  let station = -1, timer = null, nextTime = 0, step = 0, out = null;

  const synth = {
    osc(t, freq, dur, type, vol, attack = 0.005, cutoff = 4000) {
      const ctx = Sound.ctx;
      const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = type; o.frequency.value = freq;
      f.type = 'lowpass'; f.frequency.value = cutoff;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      o.connect(f); f.connect(g); g.connect(out);
      o.start(t); o.stop(t + dur + 0.05);
    },
    kick(t, vol = 0.9) {
      const ctx = Sound.ctx, o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      g.gain.setValueAtTime(vol * 0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.32);
    },
    noise(t, dur, vol, type, freq) {
      const ctx = Sound.ctx, len = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let k = 0; k < len; k++) d[k] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = buf; f.type = type; f.frequency.value = freq;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f); f.connect(g); g.connect(out);
      src.start(t);
    },
    snare(t, vol) { this.noise(t, 0.18, vol, 'bandpass', 1800); },
    hat(t, vol, open = false) { this.noise(t, open ? 0.16 : 0.05, vol, 'highpass', 7000); },
    bass(t, f, dur, type, vol = 0.14) { this.osc(t, f, dur, type, vol, 0.005, 700); },
    pad(t, freqs, dur, type, vol) { for (const f of freqs) { this.osc(t, f, dur, type, vol, 0.08, 1600); this.osc(t, f * 1.004, dur, type, vol * 0.7, 0.08, 1600); } },
    lead(t, f, dur, type, vol) { this.osc(t, f, dur, type, vol, 0.005, 3000); },
  };

  function tick() {
    const ctx = Sound.ctx;
    if (!ctx || station < 0) return;
    const st = STATIONS[station], sixteenth = 60 / st.bpm / 4;
    while (nextTime < ctx.currentTime + 0.15) {
      const bar = Math.floor(step / 16), ch = st.chords[bar % st.chords.length];
      st.play(synth, step, nextTime, bar, ch);
      nextTime += sixteenth;
      step++;
    }
  }

  function tune(i) {
    Sound.init();
    const ctx = Sound.ctx;
    if (!ctx) return null;
    if (!out) {
      out = ctx.createGain();
      out.gain.value = 0.9;
      out.connect(Sound.musicOut);
    }
    station = i;
    step = 0;
    nextTime = ctx.currentTime + 0.05;
    if (!timer && i >= 0) timer = setInterval(tick, 40);
    if (i < 0 && timer) { clearInterval(timer); timer = null; }
    return i >= 0 ? STATIONS[i].name : null;
  }

  return {
    get on() { return station >= 0; },
    get name() { return station >= 0 ? STATIONS[station].name : 'Radio off'; },
    // Cycles through the stations, then off.
    next() { return tune(station + 1 >= STATIONS.length ? -1 : station + 1) || 'Radio off'; },
    off() { if (station >= 0) tune(-1); },
    resume(i) { if (i >= 0) tune(i); },
    get station() { return station; },
  };
})();
