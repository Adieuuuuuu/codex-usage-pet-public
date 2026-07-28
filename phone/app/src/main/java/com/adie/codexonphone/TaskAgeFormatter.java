package com.adie.codexonphone;

final class TaskAgeFormatter {
    private static final long MINUTE_IN_MILLIS = 60_000L;
    private static final long HOUR_IN_MINUTES = 60L;
    private static final long DAY_IN_HOURS = 24L;

    private TaskAgeFormatter() {
    }

    static String format(long updatedAt, long now) {
        if (updatedAt <= 0) {
            return "刚刚";
        }

        long elapsed = Math.max(0L, now - updatedAt);
        long minutes = elapsed / MINUTE_IN_MILLIS;
        if (minutes < 1) {
            return "刚刚";
        }
        if (minutes < HOUR_IN_MINUTES) {
            return minutes + " 分钟前";
        }

        long hours = minutes / HOUR_IN_MINUTES;
        if (hours < DAY_IN_HOURS) {
            return hours + " 小时前";
        }
        return (hours / DAY_IN_HOURS) + " 天前";
    }
}
