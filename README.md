# Downtown Driver

A 3D city driving game for the browser, inspired by Dr. Driving. Drive through a
city with live traffic and traffic lights and finish missions to earn coins for
new paint colours.

Built with plain JavaScript and [Three.js](https://threejs.org/) (r128, loaded
from cdnjs). No build step.

## Play

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
