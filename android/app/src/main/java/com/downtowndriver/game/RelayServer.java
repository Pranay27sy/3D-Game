package com.downtowndriver.game;

import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;
import org.json.JSONException;
import org.json.JSONObject;

import java.net.InetSocketAddress;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Message relay for a LAN game. Each connection gets a numeric id. Every JSON
 * message a player sends is stamped with "from" and forwarded to everyone
 * else, or only to the player named in "to". The game logic lives in the
 * JavaScript of whichever player is hosting; this class only moves messages.
 * The protocol matches server/lan-server.js.
 */
public class RelayServer extends WebSocketServer {
    public static final int MAX_PLAYERS = 10;

    private final AtomicInteger nextId = new AtomicInteger(1);
    private final Map<WebSocket, Integer> ids = new ConcurrentHashMap<>();
    private final Map<Integer, WebSocket> sockets = new ConcurrentHashMap<>();

    public RelayServer(int port) {
        super(new InetSocketAddress(port));
        setReuseAddr(true);
        setTcpNoDelay(true);
        setConnectionLostTimeout(10);
    }

    public int playerCount() {
        return ids.size();
    }

    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake) {
        if (ids.size() >= MAX_PLAYERS) {
            conn.close(4001, "Game is full");
            return;
        }
        int id = nextId.getAndIncrement();
        ids.put(conn, id);
        sockets.put(id, conn);
        conn.send("{\"t\":\"welcome\",\"id\":" + id + "}");
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        Integer id = ids.remove(conn);
        if (id == null) return;
        sockets.remove(id);
        broadcastExcept(null, "{\"t\":\"leave\",\"id\":" + id + "}");
    }

    @Override
    public void onMessage(WebSocket conn, String message) {
        Integer id = ids.get(conn);
        if (id == null) return;
        try {
            JSONObject msg = new JSONObject(message);
            msg.put("from", id);
            String out = msg.toString();
            if (msg.has("to")) {
                WebSocket target = sockets.get(msg.optInt("to"));
                if (target != null && target.isOpen()) target.send(out);
            } else {
                broadcastExcept(conn, out);
            }
        } catch (JSONException ignored) {
            // Not a game message.
        }
    }

    private void broadcastExcept(WebSocket skip, String text) {
        for (WebSocket ws : ids.keySet()) {
            if (ws != skip && ws.isOpen()) ws.send(text);
        }
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        // Connection errors surface to players as disconnects.
    }

    @Override
    public void onStart() {
    }
}
