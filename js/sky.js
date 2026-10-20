'use strict';

// Time of day and weather. One in-game hour passes every 40 seconds.
// Night lights up windows and street lamps and switches on your headlights;
// rain darkens the sky, wets the road and costs grip.
const Sky = (() => {
  const DAY = new THREE.Color(0x9fd0ee), DUSK = new THREE.Color(0xf0a070), NIGHT = new THREE.Color(0x0b1626), STORM = new THREE.Color(0x6f7b86);
  const sky = new THREE.Color();
  let scene, hemi, sun, world;
  let time = 9, cycle = true, weather = 'clear', wet = 0, rainAmount = 0, weatherTimer = 0;
  let rain, stars, clouds, spot;
  const HOURS_PER_SECOND = 1 / 40;
  const WEATHERS = ['clear', 'clear', 'clear', 'cloudy', 'cloudy', 'rain'];

  function init(o) {
    ({ scene, hemi, sun, world } = o);

    // Rain: short streaks that fall around the camera.
    const n = 1400, pos = new Float32Array(n * 6);
    for (let k = 0; k < n; k++) {
      const x = (Math.random() - 0.5) * 70, y = Math.random() * 40, z = (Math.random() - 0.5) * 70;
      pos.set([x, y, z, x, y - 0.7, z], k * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xbcd4ea, transparent: true, opacity: 0.5 }));
    rain.frustumCulled = false;
    rain.visible = false;
    scene.add(rain);

    const sp = new Float32Array(900 * 3);
    for (let k = 0; k < 900; k++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 0.5 + 0.12;
      sp.set([Math.cos(a) * Math.cos(e) * 900, Math.sin(e) * 900, Math.sin(a) * Math.cos(e) * 900], k * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false }));
    stars.frustumCulled = false;
    scene.add(stars);

    const ctex = (() => {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 64;
      const x = c.getContext('2d');
      for (let k = 0; k < 9; k++) {
        const gx = 20 + Math.random() * 88, gy = 26 + Math.random() * 14, r = 14 + Math.random() * 14;
        const grd = x.createRadialGradient(gx, gy, 0, gx, gy, r);
        grd.addColorStop(0, 'rgba(255,255,255,0.95)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = grd;
        x.fillRect(0, 0, 128, 64);
      }
      return new THREE.CanvasTexture(c);
    })();
    clouds = [];
    for (let k = 0; k < 14; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctex, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
      s.scale.set(160 + Math.random() * 120, 60 + Math.random() * 30, 1);
      s.position.set(Math.random() * 1400 - 450, 150 + Math.random() * 60, Math.random() * 1400 - 450);
      scene.add(s);
      clouds.push(s);
    }

    spot = new THREE.SpotLight(0xfff0d0, 0, 70, 0.55, 0.55, 1.2);
    scene.add(spot, spot.target);
  }

  const night = () => {
    const e = Math.sin(((time - 6) / 12) * Math.PI);
    return clamp((0.12 - e) / 0.3, 0, 1);
  };

  function update(dt, camera, car) {
    if (cycle) time = (time + dt * HOURS_PER_SECOND) % 24;
    weatherTimer -= dt;
    if (cycle && weatherTimer <= 0) {
      weatherTimer = 120 + Math.random() * 180;
      weather = WEATHERS[Math.floor(Math.random() * WEATHERS.length)];
    }
    const raining = weather === 'rain';
    rainAmount += clamp((raining ? 1 : 0) - rainAmount, -dt * 0.2, dt * 0.2);
    wet += clamp((raining ? 1 : 0) - wet, -dt * 0.03, dt * 0.08);
    const cloudy = Math.max(rainAmount, weather === 'cloudy' ? 0.45 : 0);

    // Sun arcs east to west; colour runs day -> dusk -> night.
    const a = ((time - 6) / 12) * Math.PI, elev = Math.sin(a);
    const n = night();
    const dusk = clamp(1 - Math.abs(elev) / 0.3, 0, 1) * (1 - n * 0.6);
    sky.copy(DAY).lerp(DUSK, dusk * 0.8).lerp(NIGHT, n).lerp(STORM, cloudy * (1 - n) * 0.6);
    scene.background.copy(sky);
    scene.fog.color.copy(sky);
    scene.fog.near = 120 - rainAmount * 70;
    scene.fog.far = 520 - rainAmount * 280;

    const daylight = (1 - n) * (1 - cloudy * 0.45);
    sun.intensity = 0.12 + daylight * 0.75;
    sun.color.setHex(n > 0.5 ? 0x9fb4ff : dusk > 0.3 ? 0xffc59a : 0xfff3df);
    hemi.intensity = 0.22 + daylight * 0.55;
    // Sun (or moon) direction for the shadow light, relative to its target.
    const dir = elev > -0.1 ? { x: Math.cos(a), y: Math.max(0.25, elev) } : { x: -Math.cos(a), y: 0.6 };
    Sky.sunOffset = { x: dir.x * 70, y: dir.y * 90 + 10, z: 30 };

    world.setNight(n);
    stars.material.opacity = n * (1 - cloudy);
    for (const c of clouds) {
      c.position.x += dt * 2;
      if (c.position.x > 950) c.position.x = -450;
      c.material.opacity = 0.25 + cloudy * 0.7;
      c.material.color.setRGB(1 - n * 0.75 - rainAmount * 0.3, 1 - n * 0.72 - rainAmount * 0.3, 1 - n * 0.6 - rainAmount * 0.25);
    }

    rain.visible = rainAmount > 0.02;
    if (rain.visible) {
      rain.material.opacity = 0.5 * rainAmount;
      rain.position.set(camera.position.x, camera.position.y - 15, camera.position.z);
      const p = rain.geometry.attributes.position.array, fall = dt * 32;
      for (let k = 0; k < p.length; k += 6) {
        p[k + 1] -= fall; p[k + 4] -= fall;
        if (p[k + 1] < 0) { p[k + 1] += 40; p[k + 4] += 40; }
      }
      rain.geometry.attributes.position.needsUpdate = true;
    }
    world.roadMat.roughness = 0.95 - wet * 0.55;
    world.roadMat.color.setScalar(1 - wet * 0.25);
    Vehicle.grip = 1 - wet * 0.2;

    // Headlights on your car after dark.
    if (car) {
      const f = car.forward;
      spot.position.set(car.x + f.x * 2.2, (car.y || 0) + 1, car.z + f.z * 2.2);
      spot.target.position.set(car.x + f.x * 22, 0, car.z + f.z * 22);
      spot.intensity = clamp(n * 1.6 + rainAmount * 0.6, 0, 2);
    } else spot.intensity = 0;
  }

  return {
    init, update,
    get time() { return time; },
    get weather() { return weather; },
    get night() { return night(); },
    set(t, w) { if (t !== undefined) time = t; if (w) { weather = w; weatherTimer = 200; } },
    setCycle(on) { cycle = on; },
    clock() { const h = Math.floor(time), m = Math.floor((time - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; },
    sunOffset: { x: 40, y: 80, z: 25 },
  };
})();
