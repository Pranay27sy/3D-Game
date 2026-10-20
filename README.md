# Downtown Driver

A 3D open-world driving game for Android and the browser, set in Mumbai, from
Colaba up the Western line to Boisar, with the Mumbai local running all the
way to Dahanu Road. It started as a Dr. Driving-style game and now has a
GTA-style open world, police chases, jobs, Marathi-speaking people, and Wi-Fi
multiplayer for up to 10 phones.

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

### Mumbai (free roam)

- **The map follows the real coast**, a long north-south strip about 0.6 km
  wide and 5 km long (1:25 scale: 1 km of railway is 40 m in the game):
  Colaba and the Gateway of India, Fort and the maidans, Marine Drive,
  Malabar Hill, Mumbai Central, Worli, the Bandra-Worli Sea Link over the bay, Dadar and
  Shivaji Park, Dharavi, Bandra, Juhu beach, the airport, Andheri, Powai,
  Goregaon, Aarey, Malad, Borivali and the National Park, Mira Road,
  Bhayandar, the Vasai creek bridge, Vasai, Nalasopara, Virar, then the
  farmland and villages of Saphale, Kelve, Palghar and Boisar's industrial
  area. North of Boisar the line carries on through the Vangaon countryside
  to Dahanu Road.
- **Mumbai local trains (Western line):** six trains run on an elevated track
  between Churchgate and Dahanu Road, stopping at 18 stations (Churchgate,
  Mumbai Central, Dadar, Bandra, Andheri, Goregaon, Malad, Borivali, Mira Road,
  Bhayandar, Vasai Road, Nalasopara, Virar, Saphale, Kelve Road, Palghar,
  Boisar, Dahanu Road). Walk into a station's **L** marker, pick *towards
  Churchgate* or *towards Dahanu Road*, wait on the platform, board, and
  choose your stop. Station boards and announcements are in Marathi and
  English; the police can't follow you onto a train.
- **People speak Marathi:** small talk as you walk past, shouts when you honk
  or drive too close, cries when you hit someone, "चोर, चोर!" when you take a
  car, and "थांब! पोलीस!" from the police. Lines show in speech bubbles and
  are read aloud by the phone's text-to-speech voice (Marathi, or Hindi if
  the phone has no Marathi voice). Turn voices off in Settings.
- **Left-hand traffic** as in India, with right-hand-drive cars. Traffic is a
  Mumbai mix of auto-rickshaws, black-and-yellow kaali-peeli taxis, red BEST
  buses, cars, vans and police.
- **On foot or in any vehicle:** get out and walk, run and jump. Get into
  parked cars, take cars out of traffic (the driver runs off), or steal a
  police car. **Seven vehicles** with their own handling: sedan, taxi, van,
  sports car, auto-rickshaw, BEST bus and police cruiser.
- **People** walk the footpaths, cross at crosswalks on red, dodge fast cars
  and get knocked over (then get up and run).
- **Wanted level (1 to 5 stars):** hitting people, ramming police, running red
  lights or stealing cars in front of the police brings chases. Police route
  along the roads and bridges, ram you, and give up if you stay out of sight.
  Stop next to them and you're **BUSTED**. If your car burns out with you in
  it, you're **WASTED**.
- **Jobs for cash (₹):** taxi fares (one passenger after another), fragile
  express deliveries, and checkpoint street races. Drive into the T, D and R
  markers.
- **Spray & Repair:** repairs and repaints your car, and the police lose track
  of you (if they can't see you).
- **Stunt jumps** pay by airtime. **24 hidden packages** are tucked around
  the map.
- **Day and night** (one in-game hour every 40 seconds) with lit windows,
  street lamps and headlights, and **weather** with rain that makes roads
  slippery.
- **Radio:** three stations of music generated live (synthwave, lo-fi, house).
- **Map** of the whole line with a GPS route: drag to move, zoom with + and −,
  tap to set a waypoint.

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
volume, vibration, pedals on the left, the day/night cycle, and Marathi
voices.

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
   - **Mumbai:** everyone in the same open world, on foot or in cars, with
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
| `js/mumbai.js` | The Mumbai map: areas, coast, creeks, bridges, stations, landmarks and job spots |
| `js/world.js` | Builds the map: roads, bridges, buildings (merged per chunk), lights, ramps, landmarks, road routing |
| `js/rail.js` | The Western line: viaduct, stations, timetable and the local trains |
| `js/speech.js` | Marathi speech bubbles and text-to-speech |
| `js/car.js` | Vehicle types, car models, driving physics, ramps and airtime, damage, fire |
| `js/person.js` | Blocky people and the player on foot |
| `js/peds.js` | Pedestrians: sidewalks, crosswalks, dodging, getting knocked down |
| `js/traffic.js` | AI traffic: lanes, turns, traffic lights, following, stealing |
| `js/police.js` | Wanted level and police chase AI |
| `js/openworld.js` | Mumbai free roam: getting in and out, trains, jobs, spray shops, packages, busted and wasted |
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
