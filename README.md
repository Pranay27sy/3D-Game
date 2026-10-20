# Downtown Driver

A 3D open-world driving game for Android and the browser, set in the city of
Port Sundale. It started as a Dr. Driving-style game and now has a GTA-style
open city, police chases, jobs, and Wi-Fi multiplayer for up to 10 phones.

Built with plain JavaScript and [Three.js](https://threejs.org/) r128 (bundled
in `vendor/`, so it runs offline). The Android app wraps the same game with
[Capacitor](https://capacitorjs.com/).

## Install on Android

Every push builds the app with GitHub Actions (`.github/workflows/android.yml`).

1. On the phone, open the repository's **Releases** page and download
   `DowntownDriver.apk` from the newest *Downtown Driver for Android* release.
   (The same file is also attached to each run on the **Actions** tab.)
2. Open the file and allow installing apps from this source when Android asks.
3. Repeat on every friend's phone.

To build it yourself you need Node 20, JDK 17 and the Android SDK:

```sh
npm install
npm run android          # copies the game into android/
cd android && ./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

## What's in the game

### Open City (free roam)

- **A city of seven districts:** Downtown towers, Midtown, the Harbor Heights
  houses, the Dockside warehouses, parks, Sundale Square, a beach, a parking
  lot and a stunt yard with ramps.
- **On foot or in any car:** get out and walk, run and jump. Get into parked
  cars, take cars out of traffic (the driver runs off), or steal a police car.
- **Five vehicles** with their own handling: sedan, taxi, van, sports car and
  police cruiser.
- **People** walk the sidewalks, cross at crosswalks on red, dodge fast cars
  and get knocked over (then get up and run).
- **Wanted level (1 to 5 stars):** hitting people, ramming police, running red
  lights or stealing cars in front of the police brings chases. Police route
  through the streets, ram you, and give up if you stay out of sight. Stop next
  to them and you're **BUSTED**. If your car burns out with you in it, you're
  **WASTED**.
- **Jobs for cash:** taxi fares (one passenger after another), fragile express
  deliveries, and checkpoint street races. Drive into the T, D and R markers.
- **Spray & Repair:** repairs and repaints your car, and the police lose track
  of you (if they can't see you).
- **Stunt jumps** pay by airtime. **20 hidden packages** are tucked around town.
- **Day and night** (one in-game hour every 40 seconds) with lit windows,
  street lamps and headlights, and **weather** with rain that makes roads
  slippery.
- **Radio:** three stations of music generated live (synthwave, lo-fi, house).
- **City map** with a GPS route; tap it to set a waypoint.

### Driving missions (Dr. Driving style)

| Mission | Goal |
| --- | --- |
| Free Drive | Explore with no clock and no fuel limit |
| Rush Hour | Reach the destination before time runs out. Each red light costs 5 s |
| Eco Run | Reach the destination on a small tank of fuel |
| Parallel Park | Park straight in the bay between two parked cars |
| Safe Driver | Reach the destination with no crashes, red lights or people hit |

### Garage and settings

Spend your cash on cars and paint. Settings cover graphics quality (low,
medium, high), wheel or tilt steering, steering sensitivity, sound and radio
volume, vibration, pedals on the left, and the day/night cycle.

## Play together over Wi-Fi (2–10 players)

No internet is needed, only a shared local network.

1. Put every phone on the same Wi-Fi, or turn on one phone's hotspot and
   connect the others to it.
2. One player taps **Multiplayer → Host a game**. Their phone becomes the
   game server and shows its address, for example `192.168.43.1`.
3. Everyone else taps **Multiplayer**. The host's game appears under
   *Games on this Wi-Fi*; tap it. If it doesn't appear, type the host's
   address and tap **Join**.
4. The host picks a mode and taps **Start**:
   - **Open City:** everyone in the same open world, on foot or in cars, with
     shared traffic, lights, time of day and weather. You see each other's
     police chases and hear each other's horns.
   - **Race:** side-by-side start, first to stop at the green marker wins,
     live race position on screen, red lights add 5 seconds.
   - **Cops & Robbers:** a third of the players drive police cars. Robbers must
     stay free for 4 minutes; a robber caught by a cop joins the police.

The host's phone runs the traffic for everyone, so it should stay on the game
screen; if the host leaves, the game ends for everyone. A phone that loses the
connection (screen lock, Wi-Fi blip) tries to reconnect by itself.

### Hosting from a computer

`npm run lan` starts the same relay on a computer and serves the game at
`http://<computer's IP>:8080`. Friends can join from the Android app by typing
the computer's address, or play in a phone or desktop browser at that URL.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Gas / walk | W / ↑ | Gas pedal / joystick |
| Brake / reverse | S / ↓ / Space | Brake pedal |
| Steer | A / D / ← / → | Steering wheel (or tilt the phone) |
| Get in / out | F | Get in / Get out button |
| Run / jump (on foot) | Shift / Space | Run / Jump buttons |
| Gear (Drive / Reverse) | Q | D/R button (stop the car first) |
| Camera | C | View (drag the screen to look around) |
| Horn | H | Horn |
| Radio | R | Radio |
| Map | M | Map |
| Pause | P / Esc | Pause |
| Sound on/off | N | Settings |

## Play in a browser (single player)

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Code layout

| File | Contents |
| --- | --- |
| `js/world.js` | City layout, districts, buildings (merged into one mesh), roads, lights, ramps, landmarks |
| `js/car.js` | Vehicle types, car models, driving physics, ramps and airtime, damage, fire |
| `js/person.js` | Blocky people and the player on foot |
| `js/peds.js` | Pedestrians: sidewalks, crosswalks, dodging, getting knocked down |
| `js/traffic.js` | AI traffic: lanes, turns, traffic lights, following, stealing |
| `js/police.js` | Wanted level and police chase AI |
| `js/openworld.js` | Open City: getting in and out, jobs, spray shops, packages, busted and wasted |
| `js/missions.js` | Driving missions |
| `js/sky.js` | Day/night cycle, weather and headlights |
| `js/radio.js` | Generated radio stations |
| `js/effects.js` | Smoke, fire, sparks, dust and explosions |
| `js/audio.js` | Engine, horn, siren and crash sounds |
| `js/input.js` | Keyboard, steering wheel, pedals, joystick and tilt |
| `js/settings.js` | Settings, graphics levels and vibration |
| `js/main.js` | Rendering, camera, HUD, map, menus, save data and the game loop |
| `js/net.js` | WebSocket connection and the Android hosting/discovery plugin bridge |
| `js/multiplayer.js` | Lobby, rounds, Cops & Robbers, syncing players, police and traffic |
| `android/…/LanServerPlugin.java` | Starts the relay on the host phone and announces it on Wi-Fi |
| `android/…/RelayServer.java` | WebSocket relay that forwards messages between players |
| `server/lan-server.js` | The same relay for a computer, plus a web server for the game |
