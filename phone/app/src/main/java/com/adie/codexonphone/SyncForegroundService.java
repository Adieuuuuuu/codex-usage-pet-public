package com.adie.codexonphone;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import org.json.JSONException;
import org.json.JSONObject;

import java.security.GeneralSecurityException;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

public final class SyncForegroundService extends Service {
    public static final String ACTION_START =
            "com.adie.codexonphone.action.START_SYNC";
    public static final String ACTION_STOP =
            "com.adie.codexonphone.action.STOP_SYNC";

    private static final int POLICY_VIOLATION_CLOSE_CODE = 1008;
    private static final int MAX_RELAY_MESSAGE_CHARS = 64 * 1024;
    private static final long MAX_RECONNECT_DELAY_MS = 60_000L;
    private static final long DESKTOP_STALE_AFTER_MS = 10 * 60_000L;
    private static final long STALE_RECONNECT_INTERVAL_MS = 5 * 60_000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable reconnect = this::connect;
    private OkHttpClient client;
    private WebSocket webSocket;
    private PairingBundle pairing;
    private ConnectivityManager connectivityManager;
    private Network defaultNetwork;
    private int reconnectAttempt;
    private boolean foregroundStarted;
    private boolean networkCallbackRegistered;
    private boolean awaitingInitialEnvelope;
    private boolean stopping;
    private final ConnectivityManager.NetworkCallback networkCallback =
            new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    Network previous = defaultNetwork;
                    defaultNetwork = network;
                    if (previous == null || !previous.equals(network)) {
                        restartConnection();
                    }
                }

                @Override
                public void onLost(Network network) {
                    if (!network.equals(defaultNetwork)) {
                        return;
                    }
                    defaultNetwork = null;
                    if (stopping || pairing == null) {
                        return;
                    }
                    cancelCurrentConnection();
                    scheduleReconnect();
                }
            };
    private final Runnable markDesktopStale = this::handleDesktopStaleDeadline;

    private void handleDesktopStaleDeadline() {
        if (stopping || pairing == null) {
            return;
        }
        CodexSnapshot snapshot = SyncStateStore.loadSnapshot(this);
        long remaining = SyncFreshnessPolicy.remainingUntilStale(
                snapshot,
                System.currentTimeMillis(),
                DESKTOP_STALE_AFTER_MS
        );
        if (remaining > 0) {
            handler.postDelayed(markDesktopStale, remaining);
            return;
        }
        SyncStateStore.setConnectionState(this, "desktop_stale");
        NotificationPublisher.publish(this, snapshot, false);
        restartConnection();
        scheduleDesktopFreshnessCheck(snapshot);
    }

    public static void start(Context context) {
        Intent intent = new Intent(context, SyncForegroundService.class)
                .setAction(ACTION_START);
        context.startForegroundService(intent);
    }

    public static void stop(Context context) {
        Intent intent = new Intent(context, SyncForegroundService.class)
                .setAction(ACTION_STOP);
        context.startService(intent);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        client = new OkHttpClient.Builder()
                .pingInterval(30, TimeUnit.SECONDS)
                .retryOnConnectionFailure(true)
                .build();
        connectivityManager = getSystemService(ConnectivityManager.class);
        defaultNetwork = connectivityManager.getActiveNetwork();
        connectivityManager.registerDefaultNetworkCallback(
                networkCallback,
                handler
        );
        networkCallbackRegistered = true;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopping = true;
            stopConnection();
            stopForeground(STOP_FOREGROUND_REMOVE);
            foregroundStarted = false;
            stopSelf();
            return START_NOT_STICKY;
        }

        CodexSnapshot snapshot = SyncStateStore.loadSnapshot(this);
        if (!foregroundStarted) {
            startForeground(
                    NotificationPublisher.NOTIFICATION_ID,
                    NotificationPublisher.buildStatus(this, snapshot)
            );
            foregroundStarted = true;
        }

        pairing = SyncStateStore.loadPairing(this);
        if (pairing == null || !SyncStateStore.isSyncEnabled(this)) {
            SyncStateStore.setConnectionState(this, "unpaired");
            stopForeground(STOP_FOREGROUND_REMOVE);
            foregroundStarted = false;
            stopSelf();
            return START_NOT_STICKY;
        }

        stopping = false;
        if (webSocket == null) {
            connect();
        } else if (SyncFreshnessPolicy.isStale(
                snapshot,
                System.currentTimeMillis(),
                DESKTOP_STALE_AFTER_MS
        )) {
            restartConnection();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopping = true;
        foregroundStarted = false;
        handler.removeCallbacksAndMessages(null);
        stopConnection();
        if (networkCallbackRegistered) {
            connectivityManager.unregisterNetworkCallback(networkCallback);
            networkCallbackRegistered = false;
        }
        if (client != null) {
            client.dispatcher().executorService().shutdown();
            client.connectionPool().evictAll();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void connect() {
        if (stopping || pairing == null || webSocket != null) {
            return;
        }
        SyncStateStore.setConnectionState(this, "connecting");
        Request request = new Request.Builder()
                .url(pairing.eventsUri().toString())
                .build();
        awaitingInitialEnvelope = true;
        webSocket = client.newWebSocket(request, new Listener());
    }

    private void stopConnection() {
        handler.removeCallbacks(reconnect);
        handler.removeCallbacks(markDesktopStale);
        WebSocket socket = webSocket;
        webSocket = null;
        awaitingInitialEnvelope = true;
        if (socket != null) {
            socket.close(1000, "client stopping");
            socket.cancel();
        }
    }

    private void cancelCurrentConnection() {
        WebSocket socket = webSocket;
        webSocket = null;
        awaitingInitialEnvelope = true;
        if (socket != null) {
            socket.cancel();
        }
    }

    private void restartConnection() {
        if (stopping || pairing == null) {
            return;
        }
        handler.removeCallbacks(reconnect);
        handler.removeCallbacks(markDesktopStale);
        cancelCurrentConnection();
        reconnectAttempt = 0;
        connect();
    }

    private void scheduleReconnect() {
        if (stopping || pairing == null) {
            return;
        }
        handler.removeCallbacks(markDesktopStale);
        handler.removeCallbacks(reconnect);
        webSocket = null;
        SyncStateStore.setConnectionState(this, "offline");
        long multiplier = 1L << Math.min(reconnectAttempt, 6);
        long delay = Math.min(MAX_RECONNECT_DELAY_MS, 1_000L * multiplier);
        reconnectAttempt++;
        handler.postDelayed(reconnect, delay);
    }

    private void acceptEnvelope(JSONObject envelope, boolean allowAlert)
            throws GeneralSecurityException {
        CodexSnapshot previous = SyncStateStore.loadSnapshot(this);
        String envelopeJson = envelope.toString();
        String plaintext = SyncCrypto.decrypt(
                pairing,
                envelopeJson,
                previous.sequence()
        );
        CodexSnapshot next = SnapshotCodec.decode(
                plaintext,
                SyncStateStore.tasksHidden(this)
        );
        long envelopeSequence = SyncCrypto.sequenceOf(envelopeJson);
        if (next.sequence() != envelopeSequence) {
            throw new GeneralSecurityException("Snapshot sequence mismatch.");
        }
        boolean alert = allowAlert
                && next.hasAttentionTransitionComparedWith(previous);
        SyncStateStore.saveSnapshot(this, next);
        updateDesktopFreshness(next);
        NotificationPublisher.publish(this, next, alert);
    }

    private void updateDesktopFreshness(CodexSnapshot snapshot) {
        handler.removeCallbacks(markDesktopStale);
        long remaining = SyncFreshnessPolicy.remainingUntilStale(
                snapshot,
                System.currentTimeMillis(),
                DESKTOP_STALE_AFTER_MS
        );
        if (remaining == 0) {
            SyncStateStore.setConnectionState(this, "desktop_stale");
            scheduleDesktopFreshnessCheck(snapshot);
            return;
        }
        SyncStateStore.setConnectionState(this, "connected");
        handler.postDelayed(markDesktopStale, remaining);
    }

    private void scheduleDesktopFreshnessCheck(CodexSnapshot snapshot) {
        handler.removeCallbacks(markDesktopStale);
        long delay = SyncFreshnessPolicy.nextCheckDelay(
                snapshot,
                System.currentTimeMillis(),
                DESKTOP_STALE_AFTER_MS,
                STALE_RECONNECT_INTERVAL_MS
        );
        handler.postDelayed(markDesktopStale, delay);
    }

    private final class Listener extends WebSocketListener {
        @Override
        public void onOpen(WebSocket socket, Response response) {
            if (socket != webSocket || stopping) {
                socket.close(1000, "stale connection");
                return;
            }
            try {
                socket.send(new JSONObject()
                        .put("type", "auth")
                        .put("version", 1)
                        .put("token", pairing.authToken())
                        .toString());
            } catch (JSONException error) {
                socket.cancel();
            }
        }

        @Override
        public void onMessage(WebSocket socket, String text) {
            if (socket != webSocket || stopping) {
                return;
            }
            if (text.length() > MAX_RELAY_MESSAGE_CHARS) {
                socket.close(1009, "message too large");
                return;
            }
            try {
                JSONObject message = new JSONObject(text);
                String type = message.getString("type");
                if ("ready".equals(type)) {
                    reconnectAttempt = 0;
                    JSONObject latest = message.optJSONObject("latest");
                    if (latest != null) {
                        acceptInitialOrLiveEnvelope(latest);
                    } else {
                        awaitingInitialEnvelope = false;
                        updateDesktopFreshness(
                                SyncStateStore.loadSnapshot(
                                        SyncForegroundService.this
                                )
                        );
                    }
                    return;
                }
                if ("snapshot".equals(type)) {
                    reconnectAttempt = 0;
                    JSONObject envelope = message.getJSONObject("envelope");
                    acceptInitialOrLiveEnvelope(envelope);
                }
            } catch (JSONException | GeneralSecurityException
                     | IllegalArgumentException error) {
                SyncStateStore.setConnectionState(
                        SyncForegroundService.this,
                        "invalid_message"
                );
            }
        }

        private void acceptInitialOrLiveEnvelope(JSONObject envelope)
                throws GeneralSecurityException {
            boolean initial = awaitingInitialEnvelope;
            try {
                acceptEnvelope(envelope, !initial);
                awaitingInitialEnvelope = false;
            } catch (SyncCrypto.ReplayException ignored) {
                // Reconnects can legitimately replay the newest stored envelope.
                awaitingInitialEnvelope = false;
                updateDesktopFreshness(
                        SyncStateStore.loadSnapshot(
                                SyncForegroundService.this
                        )
                );
            }
        }

        @Override
        public void onClosed(WebSocket socket, int code, String reason) {
            if (socket != webSocket || stopping) {
                return;
            }
            if (code == POLICY_VIOLATION_CLOSE_CODE
                    && reason.toLowerCase(java.util.Locale.ROOT)
                    .contains("authentication")) {
                webSocket = null;
                SyncStateStore.setConnectionState(
                        SyncForegroundService.this,
                        "auth_failed"
                );
                return;
            }
            scheduleReconnect();
        }

        @Override
        public void onFailure(
                WebSocket socket,
                Throwable error,
                Response response
        ) {
            if (socket != webSocket || stopping) {
                return;
            }
            scheduleReconnect();
        }
    }
}
