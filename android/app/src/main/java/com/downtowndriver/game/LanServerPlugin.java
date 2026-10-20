package com.downtowndriver.game;

import android.content.Context;
import android.net.wifi.WifiManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Lets one phone host a Wi-Fi game: starts the WebSocket relay, announces the
 * game with a UDP broadcast every second, and lets other phones find it.
 */
@CapacitorPlugin(name = "LanServer")
public class LanServerPlugin extends Plugin {
    private static final int GAME_PORT = 8787;
    private static final int BEACON_PORT = 8788;
    private static final String GAME_ID = "downtown-driver";

    private RelayServer server;
    private Thread beacon;
    private volatile boolean beaconRunning;
    private volatile String hostName = "Driver";

    @PluginMethod
    public void start(PluginCall call) {
        hostName = call.getString("name", "Driver");
        try {
            stopServer();
            server = new RelayServer(GAME_PORT);
            server.start();
            startBeacon();
            JSObject ret = new JSObject();
            ret.put("port", GAME_PORT);
            ret.put("addresses", addresses());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not start the game server: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopServer();
        call.resolve();
    }

    @PluginMethod
    public void getAddresses(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("addresses", addresses());
        call.resolve(ret);
    }

    /** Listens for host announcements for `timeout` ms and returns the games found. */
    @PluginMethod
    public void discover(PluginCall call) {
        final int timeout = call.getInt("timeout", 2500);
        new Thread(() -> {
            WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            WifiManager.MulticastLock lock = wifi != null ? wifi.createMulticastLock("downtown-driver") : null;
            Map<String, JSObject> found = new LinkedHashMap<>();
            DatagramSocket socket = null;
            try {
                if (lock != null) {
                    lock.setReferenceCounted(false);
                    lock.acquire();
                }
                socket = new DatagramSocket(null);
                socket.setReuseAddress(true);
                socket.setBroadcast(true);
                socket.bind(new InetSocketAddress(BEACON_PORT));
                long end = System.currentTimeMillis() + timeout;
                byte[] buf = new byte[1024];
                while (System.currentTimeMillis() < end) {
                    socket.setSoTimeout((int) Math.max(1, end - System.currentTimeMillis()));
                    DatagramPacket packet = new DatagramPacket(buf, buf.length);
                    try {
                        socket.receive(packet);
                    } catch (SocketTimeoutException e) {
                        break;
                    }
                    String text = new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8);
                    try {
                        JSONObject msg = new JSONObject(text);
                        if (!GAME_ID.equals(msg.optString("game"))) continue;
                        String address = packet.getAddress().getHostAddress();
                        JSObject host = new JSObject();
                        host.put("address", address);
                        host.put("port", msg.optInt("port", GAME_PORT));
                        host.put("name", msg.optString("name", "Driver"));
                        host.put("players", msg.optInt("players", 0));
                        found.put(address, host);
                    } catch (Exception ignored) {
                        // Some other app's broadcast.
                    }
                }
            } catch (Exception e) {
                // Fall through and report whatever was found.
            } finally {
                if (socket != null) socket.close();
                if (lock != null && lock.isHeld()) lock.release();
            }
            JSArray hosts = new JSArray();
            for (JSObject h : found.values()) hosts.put(h);
            JSObject ret = new JSObject();
            ret.put("hosts", hosts);
            call.resolve(ret);
        }).start();
    }

    @Override
    protected void handleOnDestroy() {
        stopServer();
    }

    private void startBeacon() {
        beaconRunning = true;
        beacon = new Thread(() -> {
            try (DatagramSocket socket = new DatagramSocket()) {
                socket.setBroadcast(true);
                while (beaconRunning) {
                    JSONObject msg = new JSONObject();
                    msg.put("game", GAME_ID);
                    msg.put("name", hostName);
                    msg.put("port", GAME_PORT);
                    msg.put("players", server != null ? server.playerCount() : 0);
                    byte[] data = msg.toString().getBytes(StandardCharsets.UTF_8);
                    for (InetAddress target : broadcastTargets()) {
                        try {
                            socket.send(new DatagramPacket(data, data.length, target, BEACON_PORT));
                        } catch (Exception ignored) {
                            // Interface may have gone away.
                        }
                    }
                    Thread.sleep(1000);
                }
            } catch (Exception ignored) {
                // Beacon stops; players can still join by address.
            }
        });
        beacon.setDaemon(true);
        beacon.start();
    }

    private void stopServer() {
        beaconRunning = false;
        if (beacon != null) beacon.interrupt();
        beacon = null;
        if (server != null) {
            try {
                server.stop(500);
            } catch (Exception ignored) {
            }
            server = null;
        }
    }

    /** Broadcast address of every active IPv4 interface (Wi-Fi and hotspot). */
    private static List<InetAddress> broadcastTargets() {
        List<InetAddress> out = new ArrayList<>();
        try {
            out.add(InetAddress.getByName("255.255.255.255"));
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    if (ia.getBroadcast() != null) out.add(ia.getBroadcast());
                }
            }
        } catch (Exception ignored) {
        }
        return out;
    }

    private static JSArray addresses() {
        JSArray out = new JSArray();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && !a.isLoopbackAddress()) out.put(a.getHostAddress());
                }
            }
        } catch (Exception ignored) {
        }
        return out;
    }
}
