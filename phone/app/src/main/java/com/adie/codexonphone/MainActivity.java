package com.adie.codexonphone;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.view.DisplayCutout;
import android.view.View;
import android.view.WindowInsets;
import android.widget.EditText;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 2208;
    private TextView status;
    private EditText pairingCode;
    private TextView taskCount;
    private TextView taskEmpty;
    private LinearLayout taskList;
    private Button refresh;
    private final SharedPreferences.OnSharedPreferenceChangeListener
            stateListener = (preferences, key) -> renderState();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        applySafeAreaInsets(findViewById(R.id.root_scroll));
        status = findViewById(R.id.status);
        pairingCode = findViewById(R.id.pairing_code);
        taskCount = findViewById(R.id.activity_task_count);
        taskEmpty = findViewById(R.id.activity_task_empty);
        taskList = findViewById(R.id.activity_task_list);
        refresh = findViewById(R.id.refresh);

        findViewById(R.id.connect).setOnClickListener(view ->
                connect(pairingCode.getText().toString()));
        findViewById(R.id.disconnect).setOnClickListener(view -> {
            SyncStateStore.clearPairing(this);
            SyncForegroundService.stop(this);
            NotificationPublisher.clear(this);
            pairingCode.setText("");
            status.setText(R.string.pairing_disconnected);
            renderTasks();
        });
        refresh.setOnClickListener(view ->
                SyncForegroundService.requestRefresh(this));

        NotificationPublisher.initializeChannels(this);
        requestNotificationPermissionIfNeeded();
        handlePairingIntent(getIntent());
        if (SyncStateStore.isSyncEnabled(this)) {
            SyncForegroundService.start(this);
        }
        renderState();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handlePairingIntent(intent);
    }

    @Override
    protected void onStart() {
        super.onStart();
        SyncStateStore.registerListener(this, stateListener);
        renderState();
    }

    @Override
    protected void onStop() {
        SyncStateStore.unregisterListener(this, stateListener);
        super.onStop();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (status != null) {
            renderState();
        }
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode,
            String[] permissions,
            int[] grantResults
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != NOTIFICATION_PERMISSION_REQUEST) {
            return;
        }
        if (grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            status.setText(R.string.status_permission_granted);
        } else {
            status.setText(R.string.status_permission_denied);
        }
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(
                    new String[]{Manifest.permission.POST_NOTIFICATIONS},
                    NOTIFICATION_PERMISSION_REQUEST
            );
        }
    }

    private void updateStateStatus() {
        if (SyncStateStore.isSyncEnabled(this)) {
            String refreshState = SyncStateStore.refreshState(this);
            refresh.setEnabled(
                    !"requesting".equals(refreshState)
                            && !"refreshing".equals(refreshState)
            );
            refresh.setText(
                    "requesting".equals(refreshState)
                            || "refreshing".equals(refreshState)
                            ? R.string.refreshing
                            : R.string.refresh
            );
            int refreshStatus = refreshStatus(refreshState);
            if (refreshStatus != 0) {
                status.setText(refreshStatus);
                return;
            }
            status.setText(getString(
                    R.string.sync_status,
                    localizedConnectionState(
                            SyncStateStore.connectionState(this)
                    )
            ));
            return;
        }
        refresh.setEnabled(false);
        refresh.setText(R.string.refresh);
        status.setText(R.string.sync_unpaired);
    }

    private int refreshStatus(String state) {
        switch (state) {
            case "requesting":
            case "refreshing":
                return R.string.refresh_status_refreshing;
            case "success":
                return R.string.refresh_status_success;
            case "desktop_unavailable":
                return R.string.refresh_status_desktop_unavailable;
            case "throttled":
                return R.string.refresh_status_throttled;
            case "timeout":
                return R.string.refresh_status_timeout;
            default:
                return 0;
        }
    }

    private void renderState() {
        updateStateStatus();
        renderTasks();
    }

    private void renderTasks() {
        CodexSnapshot snapshot = SyncStateStore.loadSnapshot(this);
        taskCount.setText(getString(
                R.string.activity_task_count,
                snapshot.tasks().size()
        ));
        taskList.removeAllViews();
        boolean empty = snapshot.tasks().isEmpty();
        taskEmpty.setVisibility(empty ? View.VISIBLE : View.GONE);
        taskList.setVisibility(empty ? View.GONE : View.VISIBLE);

        int index = 0;
        for (CodexSnapshot.Task task : snapshot.tasks()) {
            View row = getLayoutInflater().inflate(
                    R.layout.activity_task_row,
                    taskList,
                    false
            );
            if (index > 0) {
                LinearLayout.LayoutParams layoutParams =
                        (LinearLayout.LayoutParams) row.getLayoutParams();
                layoutParams.topMargin = Math.round(
                        7 * getResources().getDisplayMetrics().density
                );
                row.setLayoutParams(layoutParams);
            }
            bindTaskRow(row, task);
            taskList.addView(row);
            index++;
        }
    }

    private void bindTaskRow(View row, CodexSnapshot.Task task) {
        TextView title = row.findViewById(R.id.activity_task_title);
        TextView meta = row.findViewById(R.id.activity_task_meta);
        TextView state = row.findViewById(R.id.activity_task_state);
        ImageView icon = row.findViewById(R.id.activity_task_icon);
        ProgressBar spinner = row.findViewById(R.id.activity_task_spinner);

        title.setText(task.title());
        meta.setText(formatTaskMeta(task));
        boolean running = task.status() == CodexSnapshot.TaskStatus.RUNNING;
        icon.setVisibility(running ? View.GONE : View.VISIBLE);
        spinner.setVisibility(running ? View.VISIBLE : View.GONE);

        switch (task.status()) {
            case REVIEW:
                icon.setImageResource(R.drawable.ic_task_review);
                state.setText(R.string.task_state_review);
                break;
            case WAITING:
                icon.setImageResource(R.drawable.ic_task_review);
                state.setText(R.string.task_state_waiting);
                break;
            case FAILED:
                icon.setImageResource(R.drawable.ic_task_review);
                state.setText(R.string.task_state_failed);
                break;
            case RUNNING:
            default:
                state.setText(R.string.task_state_running);
                break;
        }
    }

    private CharSequence formatTaskMeta(CodexSnapshot.Task task) {
        String age = TaskAgeFormatter.format(
                task.updatedAt(),
                System.currentTimeMillis()
        );
        if (task.workspaceName() == null || task.workspaceName().isEmpty()) {
            return age;
        }
        return task.workspaceName() + " · " + age;
    }

    private void handlePairingIntent(Intent intent) {
        if (intent == null
                || intent.getData() == null
                || !"codexphone".equals(intent.getData().getScheme())) {
            return;
        }
        String code = intent.getData().toString();
        intent.setData(null);
        try {
            PairingBundle.parse(code);
        } catch (IllegalArgumentException error) {
            status.setText(R.string.pairing_invalid);
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle(R.string.pairing_confirm_title)
                .setMessage(R.string.pairing_confirm_message)
                .setPositiveButton(
                        R.string.pairing_connect,
                        (dialog, which) -> connect(code)
                )
                .setNegativeButton(android.R.string.cancel, null)
                .show();
    }

    private void connect(String code) {
        try {
            SyncStateStore.savePairing(this, code);
            pairingCode.setText("");
            status.setText(R.string.pairing_saved);
            requestNotificationPermissionIfNeeded();
            SyncForegroundService.start(this);
        } catch (IllegalArgumentException | IllegalStateException error) {
            status.setText(R.string.pairing_invalid);
        }
    }

    private String localizedConnectionState(String state) {
        switch (state) {
            case "connected":
                return getString(R.string.sync_connected);
            case "connecting":
                return getString(R.string.sync_connecting);
            case "offline":
            case "invalid_message":
                return getString(R.string.sync_offline);
            case "desktop_stale":
                return getString(R.string.sync_desktop_stale);
            case "auth_failed":
                return getString(R.string.sync_auth_failed);
            case "unpaired":
            default:
                return getString(R.string.sync_unpaired);
        }
    }

    private static void applySafeAreaInsets(View root) {
        int initialLeft = root.getPaddingLeft();
        int initialTop = root.getPaddingTop();
        int initialRight = root.getPaddingRight();
        int initialBottom = root.getPaddingBottom();

        root.setOnApplyWindowInsetsListener((view, windowInsets) -> {
            int insetLeft;
            int insetTop;
            int insetRight;
            int insetBottom;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Insets systemBars = windowInsets.getInsets(
                        WindowInsets.Type.systemBars()
                );
                Insets displayCutout = windowInsets.getInsets(
                        WindowInsets.Type.displayCutout()
                );
                insetLeft = Math.max(systemBars.left, displayCutout.left);
                insetTop = Math.max(systemBars.top, displayCutout.top);
                insetRight = Math.max(systemBars.right, displayCutout.right);
                insetBottom = Math.max(systemBars.bottom, displayCutout.bottom);
            } else {
                insetLeft = windowInsets.getSystemWindowInsetLeft();
                insetTop = windowInsets.getSystemWindowInsetTop();
                insetRight = windowInsets.getSystemWindowInsetRight();
                insetBottom = windowInsets.getSystemWindowInsetBottom();

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    DisplayCutout displayCutout =
                            windowInsets.getDisplayCutout();
                    if (displayCutout != null) {
                        insetLeft = Math.max(
                                insetLeft,
                                displayCutout.getSafeInsetLeft()
                        );
                        insetTop = Math.max(
                                insetTop,
                                displayCutout.getSafeInsetTop()
                        );
                        insetRight = Math.max(
                                insetRight,
                                displayCutout.getSafeInsetRight()
                        );
                        insetBottom = Math.max(
                                insetBottom,
                                displayCutout.getSafeInsetBottom()
                        );
                    }
                }
            }

            view.setPadding(
                    initialLeft + insetLeft,
                    initialTop + insetTop,
                    initialRight + insetRight,
                    initialBottom + insetBottom
            );
            return windowInsets;
        });
        root.requestApplyInsets();
    }
}
