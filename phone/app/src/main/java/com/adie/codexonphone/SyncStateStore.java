package com.adie.codexonphone;

import android.content.Context;
import android.content.SharedPreferences;

public final class SyncStateStore {
    private static final String PAIRING = "pairing";
    private static final String SNAPSHOT = "snapshot";
    private static final String PREFS = "codex_phone_state_v1";
    private static final String TASKS_HIDDEN = "tasks_hidden";
    private static final String SYNC_ENABLED = "sync_enabled";
    private static final String CONNECTION_STATE = "connection_state";

    private SyncStateStore() {
    }

    public static void savePairing(Context context, String pairingUri) {
        PairingBundle.parse(pairingUri);
        new SecureStore(context).put(PAIRING, pairingUri.trim());
        preferences(context).edit().putBoolean(SYNC_ENABLED, true).apply();
    }

    public static PairingBundle loadPairing(Context context) {
        String value = new SecureStore(context).get(PAIRING);
        if (value == null) {
            return null;
        }
        try {
            return PairingBundle.parse(value);
        } catch (IllegalArgumentException error) {
            clearPairing(context);
            return null;
        }
    }

    public static void clearPairing(Context context) {
        SecureStore store = new SecureStore(context);
        store.remove(PAIRING);
        store.remove(SNAPSHOT);
        preferences(context).edit()
                .putBoolean(SYNC_ENABLED, false)
                .putString(CONNECTION_STATE, "unpaired")
                .apply();
    }

    public static boolean isSyncEnabled(Context context) {
        return preferences(context).getBoolean(SYNC_ENABLED, false)
                && loadPairing(context) != null;
    }

    public static void saveSnapshot(Context context, CodexSnapshot snapshot) {
        new SecureStore(context).put(SNAPSHOT, SnapshotCodec.encode(snapshot));
    }

    public static CodexSnapshot loadSnapshot(Context context) {
        boolean hidden = tasksHidden(context);
        String value = new SecureStore(context).get(SNAPSHOT);
        if (value == null) {
            return CodexSnapshot.waitingForDesktop(hidden);
        }
        try {
            return SnapshotCodec.decode(value, hidden);
        } catch (IllegalArgumentException error) {
            new SecureStore(context).remove(SNAPSHOT);
            return CodexSnapshot.waitingForDesktop(hidden);
        }
    }

    public static boolean tasksHidden(Context context) {
        return preferences(context).getBoolean(TASKS_HIDDEN, false);
    }

    public static void toggleTasksHidden(Context context) {
        SharedPreferences preferences = preferences(context);
        preferences.edit()
                .putBoolean(
                        TASKS_HIDDEN,
                        !preferences.getBoolean(TASKS_HIDDEN, false)
                )
                .apply();
    }

    public static void setConnectionState(Context context, String state) {
        preferences(context).edit().putString(CONNECTION_STATE, state).apply();
    }

    public static String connectionState(Context context) {
        return preferences(context).getString(CONNECTION_STATE, "unpaired");
    }

    public static void registerListener(
            Context context,
            SharedPreferences.OnSharedPreferenceChangeListener listener
    ) {
        preferences(context).registerOnSharedPreferenceChangeListener(listener);
    }

    public static void unregisterListener(
            Context context,
            SharedPreferences.OnSharedPreferenceChangeListener listener
    ) {
        preferences(context).unregisterOnSharedPreferenceChangeListener(listener);
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
