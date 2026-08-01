package com.adie.codexonphone;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.media.AudioAttributes;
import android.os.Build;
import android.provider.Settings;
import android.view.View;
import android.widget.RemoteViews;

import java.util.Calendar;
import java.util.List;
import java.util.Locale;

public final class NotificationPublisher {
    public static final int NOTIFICATION_ID = 2208;
    static final int ALERT_NOTIFICATION_ID = 2211;
    static final long ALERT_TIMEOUT_MS = 10_000L;
    private static final String QUIET_CHANNEL_ID = "codex_task_status_v2";
    private static final String ALERT_CHANNEL_ID = "codex_task_alerts_v2";
    static final String LEGACY_QUIET_CHANNEL_ID = "codex_task_status_v1";
    static final String LEGACY_ALERT_CHANNEL_ID = "codex_task_alerts_v1";
    private static final String SILENT_STATUS_GROUP = "codex_status_silent";
    private static final int TOGGLE_REQUEST_CODE = 2209;
    private static final int CONTENT_REQUEST_CODE = 2210;

    private NotificationPublisher() {
    }

    public static void initializeChannels(Context context) {
        NotificationManager manager =
                (NotificationManager) context.getSystemService(
                        Context.NOTIFICATION_SERVICE
                );
        createChannels(context, manager);
    }

    public static boolean publish(
            Context context,
            CodexSnapshot snapshot,
            boolean alert
    ) {
        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        createChannels(context, manager);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            return false;
        }

        manager.notify(NOTIFICATION_ID, buildStatus(context, snapshot));
        if (alert) {
            manager.notify(
                    ALERT_NOTIFICATION_ID,
                    buildAlert(context, snapshot)
            );
        }
        return true;
    }

    public static Notification buildStatus(
            Context context,
            CodexSnapshot snapshot
    ) {
        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        createChannels(context, manager);
        Notification.Builder builder = new Notification.Builder(
                context,
                QUIET_CHANNEL_ID
        )
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(context.getColor(R.color.usage_text_primary))
                .setCategory(Notification.CATEGORY_PROGRESS)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setShowWhen(false)
                .setOnlyAlertOnce(true)
                .setPriority(Notification.PRIORITY_LOW)
                .setDefaults(0)
                .setSound(null)
                .setVibrate(null)
                .setGroup(SILENT_STATUS_GROUP)
                .setGroupAlertBehavior(Notification.GROUP_ALERT_SUMMARY)
                .setContentTitle(context.getString(R.string.notification_tasks_heading))
                .setContentText(context.getString(
                        R.string.notification_content_count,
                        snapshot.tasks().size()
                ))
                .setContentIntent(openAppIntent(context))
                .setStyle(new Notification.DecoratedCustomViewStyle())
                .setCustomContentView(buildCompactRemoteViews(context, snapshot))
                .setCustomBigContentView(buildRemoteViews(context, snapshot));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setForegroundServiceBehavior(
                    Notification.FOREGROUND_SERVICE_DEFERRED
            );
        }
        return builder.build();
    }

    private static Notification buildAlert(
            Context context,
            CodexSnapshot snapshot
    ) {
        return new Notification.Builder(context, ALERT_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(context.getColor(R.color.usage_text_primary))
                .setCategory(Notification.CATEGORY_EVENT)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOngoing(false)
                .setAutoCancel(true)
                .setShowWhen(false)
                .setOnlyAlertOnce(false)
                .setPriority(Notification.PRIORITY_HIGH)
                .setTimeoutAfter(ALERT_TIMEOUT_MS)
                .setContentTitle(
                        context.getString(R.string.notification_tasks_heading)
                )
                .setContentText(context.getString(
                        R.string.notification_content_count,
                        snapshot.tasks().size()
                ))
                .setContentIntent(openAppIntent(context))
                .setStyle(new Notification.DecoratedCustomViewStyle())
                .setCustomContentView(
                        buildCompactRemoteViews(context, snapshot)
                )
                .setCustomHeadsUpContentView(
                        buildCompactRemoteViews(context, snapshot)
                )
                .build();
    }

    public static void clear(Context context) {
        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        manager.cancel(NOTIFICATION_ID);
        manager.cancel(ALERT_NOTIFICATION_ID);
    }

    private static RemoteViews buildRemoteViews(Context context, CodexSnapshot snapshot) {
        RemoteViews views =
                new RemoteViews(context.getPackageName(), R.layout.notification_usage_pet);
        bindUsage(
                context,
                views,
                snapshot,
                R.id.usage_ring,
                R.id.usage_number,
                R.id.reset_month,
                R.id.reset_day,
                R.id.reset_weekday,
                54f,
                3f
        );
        views.setTextViewText(R.id.running_count, Integer.toString(snapshot.runningCount()));
        views.setTextViewText(R.id.completed_count, Integer.toString(snapshot.completedCount()));
        boolean hasMoreTasks = snapshot.tasks().size() > 3;
        views.setTextViewText(
                R.id.task_count,
                context.getString(
                        hasMoreTasks
                                ? R.string.notification_task_count_all
                                : R.string.notification_task_count,
                        snapshot.tasks().size()
                )
        );
        if (hasMoreTasks) {
            views.setOnClickPendingIntent(
                    R.id.task_count,
                    openAppIntent(context)
            );
        }
        views.setViewVisibility(
                R.id.task_list,
                snapshot.tasksHidden() ? View.GONE : View.VISIBLE
        );
        views.setOnClickPendingIntent(
                R.id.task_panel_heading,
                toggleTasksIntent(context)
        );

        List<CodexSnapshot.Task> tasks = snapshot.tasks();
        bindTask(context, views, tasks, 0,
                R.id.task_row_1,
                R.id.task_icon_1,
                R.id.task_spinner_1,
                R.id.task_title_1,
                R.id.task_meta_1,
                R.id.task_state_1);
        bindTask(context, views, tasks, 1,
                R.id.task_row_2,
                R.id.task_icon_2,
                R.id.task_spinner_2,
                R.id.task_title_2,
                R.id.task_meta_2,
                R.id.task_state_2);
        bindTask(context, views, tasks, 2,
                R.id.task_row_3,
                R.id.task_icon_3,
                R.id.task_spinner_3,
                R.id.task_title_3,
                R.id.task_meta_3,
                R.id.task_state_3);
        return views;
    }

    private static RemoteViews buildCompactRemoteViews(
            Context context,
            CodexSnapshot snapshot
    ) {
        RemoteViews views =
                new RemoteViews(context.getPackageName(), R.layout.notification_usage_compact);
        bindUsage(
                context,
                views,
                snapshot,
                R.id.compact_usage_ring,
                R.id.compact_usage_number,
                R.id.compact_reset_month,
                R.id.compact_reset_day,
                R.id.compact_reset_weekday,
                36f,
                2f
        );
        views.setTextViewText(
                R.id.compact_running_count,
                Integer.toString(snapshot.runningCount())
        );
        views.setTextViewText(
                R.id.compact_completed_count,
                Integer.toString(snapshot.completedCount())
        );
        return views;
    }

    private static void bindTask(
            Context context,
            RemoteViews views,
            List<CodexSnapshot.Task> tasks,
            int index,
            int rowId,
            int iconId,
            int spinnerId,
            int titleId,
            int metaId,
            int stateId
    ) {
        if (index >= tasks.size()) {
            views.setViewVisibility(rowId, View.GONE);
            return;
        }

        CodexSnapshot.Task task = tasks.get(index);
        views.setViewVisibility(rowId, View.VISIBLE);
        views.setTextViewText(titleId, task.title());
        views.setTextViewText(metaId, formatTaskMeta(task));
        boolean running = task.status() == CodexSnapshot.TaskStatus.RUNNING;
        views.setViewVisibility(iconId, running ? View.GONE : View.VISIBLE);
        views.setViewVisibility(spinnerId, running ? View.VISIBLE : View.GONE);
        if (running) {
            views.setProgressBar(spinnerId, 100, 0, true);
        }

        switch (task.status()) {
            case REVIEW:
                views.setImageViewResource(iconId, R.drawable.ic_task_review);
                views.setTextViewText(
                        stateId,
                        context.getString(R.string.task_state_review)
                );
                break;
            case WAITING:
                views.setImageViewResource(iconId, R.drawable.ic_task_review);
                views.setTextViewText(
                        stateId,
                        context.getString(R.string.task_state_waiting)
                );
                break;
            case FAILED:
                views.setImageViewResource(iconId, R.drawable.ic_task_review);
                views.setTextViewText(
                        stateId,
                        context.getString(R.string.task_state_failed)
                );
                break;
            case RUNNING:
            default:
                views.setTextViewText(
                        stateId,
                        context.getString(R.string.task_state_running)
                );
                break;
        }
    }

    private static void bindUsage(
            Context context,
            RemoteViews views,
            CodexSnapshot snapshot,
            int ringId,
            int numberId,
            int monthId,
            int dayId,
            int weekdayId,
            float ringSizeDp,
            float ringStrokeDp
    ) {
        Integer percent = snapshot.remainingPercent();
        int boundedPercent = percent == null
                ? 0
                : Math.max(0, Math.min(100, percent));
        views.setImageViewBitmap(
                ringId,
                drawUsageRing(context, boundedPercent, ringSizeDp, ringStrokeDp)
        );
        views.setTextViewText(
                numberId,
                percent == null ? "—" : Integer.toString(boundedPercent)
        );

        Long resetsAt = snapshot.resetsAt();
        if (resetsAt == null) {
            views.setTextViewText(monthId, "—");
            views.setTextViewText(dayId, "—");
            views.setTextViewText(
                    weekdayId,
                    context.getString(R.string.usage_waiting_for_sync)
            );
            return;
        }
        Calendar reset = Calendar.getInstance();
        reset.setTimeInMillis(resetsAt * 1_000L);
        views.setTextViewText(
                monthId,
                Integer.toString(reset.get(Calendar.MONTH) + 1)
        );
        views.setTextViewText(
                dayId,
                Integer.toString(reset.get(Calendar.DAY_OF_MONTH))
        );
        views.setTextViewText(
                weekdayId,
                new java.text.SimpleDateFormat("EEEE", Locale.getDefault())
                        .format(reset.getTime())
        );
    }

    private static CharSequence formatTaskMeta(CodexSnapshot.Task task) {
        String age = TaskAgeFormatter.format(
                task.updatedAt(),
                System.currentTimeMillis()
        );
        if (task.workspaceName() == null || task.workspaceName().isEmpty()) {
            return age;
        }
        return task.workspaceName() + " · " + age;
    }

    private static PendingIntent toggleTasksIntent(Context context) {
        Intent intent = new Intent(context, NotificationActionReceiver.class)
                .setAction(NotificationActionReceiver.ACTION_TOGGLE_TASKS);
        return PendingIntent.getBroadcast(
                context,
                TOGGLE_REQUEST_CODE,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static PendingIntent openAppIntent(Context context) {
        Intent intent = new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(
                context,
                CONTENT_REQUEST_CODE,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static void createChannels(Context context, NotificationManager manager) {
        manager.deleteNotificationChannel(LEGACY_QUIET_CHANNEL_ID);
        manager.deleteNotificationChannel(LEGACY_ALERT_CHANNEL_ID);

        NotificationChannel quietChannel = new NotificationChannel(
                QUIET_CHANNEL_ID,
                context.getString(R.string.notification_quiet_channel_name),
                NotificationManager.IMPORTANCE_LOW
        );
        quietChannel.setDescription(
                context.getString(R.string.notification_quiet_channel_description)
        );
        quietChannel.setSound(null, null);
        quietChannel.enableVibration(false);
        manager.createNotificationChannel(quietChannel);

        NotificationChannel alertChannel = new NotificationChannel(
                ALERT_CHANNEL_ID,
                context.getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_HIGH
        );
        alertChannel.setDescription(
                context.getString(R.string.notification_channel_description)
        );
        alertChannel.enableVibration(true);
        alertChannel.setVibrationPattern(new long[]{0, 180, 90, 180});
        AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        alertChannel.setSound(Settings.System.DEFAULT_NOTIFICATION_URI, audioAttributes);
        manager.createNotificationChannel(alertChannel);
    }

    private static Bitmap drawUsageRing(
            Context context,
            int percent,
            float sizeDp,
            float strokeDp
    ) {
        float density = context.getResources().getDisplayMetrics().density;
        int size = Math.round(sizeDp * density);
        float stroke = strokeDp * density;
        float inset = stroke / 2f;
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(stroke);
        paint.setStrokeCap(Paint.Cap.ROUND);

        RectF bounds = new RectF(inset, inset, size - inset, size - inset);
        paint.setColor(context.getColor(R.color.usage_progress_track));
        canvas.drawOval(bounds, paint);
        paint.setColor(context.getColor(R.color.usage_progress_fill));
        canvas.drawArc(bounds, -90f, 360f * percent / 100f, false, paint);
        return bitmap;
    }
}
