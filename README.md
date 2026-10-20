# Downtown Driver

A 3D city driving game for the browser, inspired by Dr. Driving. Drive through a
city with live traffic and traffic lights and finish missions to earn coins for
new paint colours.

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

## Play together over Wi-Fi (2–10 players)

No internet is needed, only a shared local network.

1. Put every phone on the same Wi-Fi, or turn on one phone's hotspot and
   connect the others to it.
2. One player taps **Multiplayer → Host a game**. Their phone becomes the
   game server and shows its address, for example `192.168.43.1`.
3. Everyone else taps **Multiplayer**. The host's game appears under
   *Games on this Wi-Fi*; tap it. If it doesn't appear, type the host's
   address and tap **Join**.
4. The host picks **Race** or **Free roam** and taps **Start**.

In a race everyone starts side by side and drives to the same green marker
through shared traffic and traffic lights. Each red light adds 5 seconds; a
wrecked car is out. Finishing order appears for everyone, and the host brings
the group back to the room for the next race.

The host's phone runs the traffic for everyone, so it should stay on the game
screen; if the host leaves, the game ends for everyone.

### Hosting from a computer

`npm run lan` starts the same relay on a computer and serves the game at
`http://<computer's IP>:8080`. Friends can join from the Android app by typing
the computer's address, or play in a phone or desktop browser at that URL.

## Play in a browser (single player)

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Missions

| Mission | Goal |
| --- | --- |
| Free Drive | Explore with no clock and no fuel limit |
| Rush Hour | Reach the destination before time runs out. Each red light costs 5 s |
| Eco Run | Reach the destination on a small tank of fuel |
| Parallel Park | Park straight in the bay between two parked cars |
| Safe Driver | Reach the destination with no crashes and no red lights |

Each mission gets harder as you level up: longer routes, tighter limits, more
traffic and shorter parking bays. Crashes damage the car; at 0% condition the
mission fails.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Gas | W / ↑ | Gas pedal |
| Brake | S / ↓ / Space | Brake pedal |
| Steer | A / D / ← / → | Drag the steering wheel |
| Gear (Drive / Reverse) | Q | D/R button (stop the car first) |
| Camera (chase, driver, high) | C | View |
| Horn | H | Horn |
| Pause | P / Esc | Pause |
| Sound | M | Sound on/off |

## Code layout

| File | Contents |
| --- | --- |
| `js/world.js` | City grid, buildings, road markings, traffic lights, collision shapes |
| `js/car.js` | Car models and the player's driving physics and collisions |
| `js/traffic.js` | AI traffic: lane following, turns, stopping at lights and behind cars |
| `js/missions.js` | Mission types, goals, scoring |
| `js/input.js` | Keyboard, steering wheel and pedal input |
| `js/audio.js` | Synthesised engine, horn and crash sounds |
| `js/main.js` | Rendering, camera, HUD, menus, save data and the game loop |
| `js/net.js` | WebSocket connection and the Android hosting/discovery plugin bridge |
| `js/multiplayer.js` | Lobby, race rounds, standings, syncing cars and traffic |
| `android/…/LanServerPlugin.java` | Starts the relay on the host phone and announces it on Wi-Fi |
| `android/…/RelayServer.java` | WebSocket relay that forwards messages between players |
| `server/lan-server.js` | The same relay for a computer, plus a web server for the game |
