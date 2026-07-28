package com.adie.codexonphone;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class NotificationActionReceiver extends BroadcastReceiver {
    public static final String ACTION_TOGGLE_TASKS =
            "com.adie.codexonphone.action.TOGGLE_TASKS";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ACTION_TOGGLE_TASKS.equals(intent.getAction())) {
            return;
        }
        if (!SyncStateStore.isSyncEnabled(context)) {
            return;
        }
        SyncStateStore.toggleTasksHidden(context);
        CodexSnapshot snapshot = SyncStateStore.loadSnapshot(context);
        NotificationPublisher.publish(context, snapshot, false);
    }
}
