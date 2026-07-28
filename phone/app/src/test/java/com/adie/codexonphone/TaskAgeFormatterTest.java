package com.adie.codexonphone;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public final class TaskAgeFormatterTest {
    private static final long NOW = 1_785_200_000_000L;
    private static final long MINUTE = 60_000L;
    private static final long HOUR = 60 * MINUTE;
    private static final long DAY = 24 * HOUR;

    @Test
    public void subMinuteAndFutureUpdatesRenderAsNow() {
        assertEquals("刚刚", TaskAgeFormatter.format(NOW, NOW));
        assertEquals("刚刚", TaskAgeFormatter.format(NOW - MINUTE + 1, NOW));
        assertEquals("刚刚", TaskAgeFormatter.format(NOW + MINUTE, NOW));
    }

    @Test
    public void minuteHourAndDayBoundariesMatchUsagePet() {
        assertEquals("1 分钟前", TaskAgeFormatter.format(NOW - MINUTE, NOW));
        assertEquals(
                "59 分钟前",
                TaskAgeFormatter.format(NOW - (59 * MINUTE), NOW)
        );
        assertEquals("1 小时前", TaskAgeFormatter.format(NOW - HOUR, NOW));
        assertEquals(
                "23 小时前",
                TaskAgeFormatter.format(NOW - DAY + 1, NOW)
        );
        assertEquals("1 天前", TaskAgeFormatter.format(NOW - DAY, NOW));
    }

    @Test
    public void phaseZeroSentinelStillRendersAsNow() {
        assertEquals("刚刚", TaskAgeFormatter.format(0, NOW));
    }
}
