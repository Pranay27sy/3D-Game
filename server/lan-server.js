// Run a Wi-Fi game from a computer instead of a phone:
//   npm run lan
// Serves the game at http://<this computer's IP>:8080 and runs the same
// message relay the Android app uses (port 8787). Friends on the same Wi-Fi
// can open the page in a browser or join from the app by typing the address.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');

const GAME_PORT = 8787;
const WEB_PORT = Number(process.env.PORT) || 8080;
const MAX_PLAYERS = 10;
const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const PUBLIC = new Set(['index.html', 'css', 'js', 'vendor']);

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const rel = path.normalize(url === '/' ? 'index.html' : url.slice(1));
  if (!PUBLIC.has(rel.split(path.sep)[0])) { res.writeHead(404); res.end('Not found'); return; }
  fs.readFile(path.join(ROOT, rel), (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(rel)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(WEB_PORT);

// Relay: stamps each message with the sender's id and forwards it to everyone
// else, or only to the player named in `to`. Same protocol as RelayServer.java.
const wss = new WebSocketServer({ port: GAME_PORT });
const sockets = new Map();
let nextId = 1;
wss.on('connection', (ws) => {
  if (sockets.size >= MAX_PLAYERS) { ws.close(4001, 'Game is full'); return; }
  const id = nextId++;
  sockets.set(id, ws);
  ws.send(JSON.stringify({ t: 'welcome', id }));
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    msg.from = id;
    const out = JSON.stringify(msg);
    if (msg.to !== undefined) {
      const target = sockets.get(msg.to);
      if (target && target.readyState === 1) target.send(out);
      return;
    }
    for (const [other, s] of sockets) if (other !== id && s.readyState === 1) s.send(out);
  });
  ws.on('close', () => {
    sockets.delete(id);
    const out = JSON.stringify({ t: 'leave', id });
    for (const s of sockets.values()) if (s.readyState === 1) s.send(out);
  });
});

const ips = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
console.log(`Downtown Driver LAN server`);
console.log(`  Game page: ${ips.map((ip) => `http://${ip}:${WEB_PORT}`).join('  ') || `http://localhost:${WEB_PORT}`}`);
console.log(`  Players join with address: ${ips.join(' or ') || 'localhost'}`);
