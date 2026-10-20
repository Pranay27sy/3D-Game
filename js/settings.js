'use strict';

// Player settings, saved with the rest of the save data (see main.js).
const SETTINGS_DEFAULTS = {
  quality: 'medium',     // low | medium | high
  steering: 'wheel',     // wheel | tilt
  sensitivity: 1,        // 0.5 .. 1.5
  volume: 0.8,
  music: 0.6,
  vibration: true,
  swap: false,           // pedals on the left, wheel on the right
  dayCycle: true,
  voices: true,          // Marathi speech
};

// What each graphics level changes.
const QUALITY = {
  low:    { pixelRatio: 1,   shadows: false, shadowSize: 1024, peds: 16, traffic: 26, far: 340 },
  medium: { pixelRatio: 1.5, shadows: true,  shadowSize: 1024, peds: 28, traffic: 34, far: 480 },
  high:   { pixelRatio: 2,   shadows: true,  shadowSize: 2048, peds: 40, traffic: 42, far: 620 },
};

// Vibration: the Capacitor Haptics plugin inside the Android app, the
// Vibration API in browsers that have it.
const Feel = (() => {
  const cap = window.Capacitor;
  const haptics = cap && cap.isNativePlatform && cap.isNativePlatform() && cap.registerPlugin ? cap.registerPlugin('Haptics') : null;
  let enabled = true;
  return {
    set enabled(on) { enabled = on; },
    buzz(ms = 40) {
      if (!enabled) return;
      try {
        if (haptics) haptics.vibrate({ duration: ms });
        else if (navigator.vibrate) navigator.vibrate(ms);
      } catch (e) { /* no vibration on this device */ }
    },
  };
})();
