'use strict';

// Wi-Fi play. One player hosts: the Android app starts a small relay server
// on that phone (see LanServerPlugin.java), or a computer runs `npm run lan`.
// Every player, the host included, connects to the relay with a WebSocket.
const GAME_PORT = 8787;

const Lan = (() => {
  const cap = window.Capacitor;
  const plugin = cap && cap.isNativePlatform && cap.isNativePlatform() && cap.registerPlugin ? cap.registerPlugin('LanServer') : null;
  return {
    native: !!plugin,
    // Outside the app, hosting works only on a page served by `npm run lan`.
    canHost: !!plugin || location.protocol === 'http:',
    async host(name) {
      if (plugin) {
        const r = await plugin.start({ name });
        return { url: `ws://127.0.0.1:${GAME_PORT}`, addresses: r.addresses || [] };
      }
      return { url: `ws://${location.hostname}:${GAME_PORT}`, addresses: [location.hostname] };
    },
    async stop() {
      if (!plugin) return;
      try { await plugin.stop(); } catch (e) { /* already stopped */ }
    },
    async discover() {
      if (!plugin) return [];
      try { return (await plugin.discover({ timeout: 2500 })).hosts || []; } catch (e) { return []; }
    },
  };
})();

const Net = (() => {
  let ws = null, dropped = null;
  const handlers = {};

  // Resolves with this player's id once the relay says hello.
  function connect(url) {
    return new Promise((resolve, reject) => {
      let s;
      try { s = new WebSocket(url); } catch (e) { reject(e); return; }
      const timer = setTimeout(() => { s.close(); reject(new Error('timeout')); }, 5000);
      s.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'welcome') { clearTimeout(timer); ws = s; resolve(m.id); return; }
        if (handlers[m.t]) handlers[m.t](m);
      };
      s.onclose = (ev) => {
        clearTimeout(timer);
        if (ws === s) { ws = null; if (dropped) dropped(ev.reason); }
        else reject(new Error(ev.reason || 'closed'));
      };
    });
  }

  return {
    connect,
    on(type, fn) { handlers[type] = fn; },
    onDrop(fn) { dropped = fn; },
    send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); },
    close() { if (ws) { const s = ws; ws = null; s.close(); } },
  };
})();
