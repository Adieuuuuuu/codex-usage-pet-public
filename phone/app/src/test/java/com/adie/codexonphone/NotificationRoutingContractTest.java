package com.adie.codexonphone;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

public final class NotificationRoutingContractTest {
    @Test
    public void statusAndAttentionUseDifferentNotificationIds() {
        assertNotEquals(
                NotificationPublisher.NOTIFICATION_ID,
                NotificationPublisher.ALERT_NOTIFICATION_ID
        );
        assertTrue(NotificationPublisher.ALERT_TIMEOUT_MS > 0);
    }

    @Test
    public void statusIsAlwaysPostedSilentlyBeforeOptionalAlert()
            throws Exception {
        String source = source(
                "src/main/java/com/adie/codexonphone/NotificationPublisher.java"
        );

        assertTrue(source.contains(
                "manager.notify(NOTIFICATION_ID, buildStatus(context, snapshot));"
        ));
        assertTrue(source.contains(
                "manager.notify(\n"
                        + "                    ALERT_NOTIFICATION_ID,\n"
                        + "                    buildAlert(context, snapshot)"
        ));

        String statusBuilder = between(
                source,
                "public static Notification buildStatus(",
                "private static Notification buildAlert("
        );
        assertTrue(statusBuilder.contains(
                ".setGroupAlertBehavior(Notification.GROUP_ALERT_SUMMARY)"
        ));
        assertTrue(statusBuilder.contains(
                ".setPriority(Notification.PRIORITY_LOW)"
        ));
        assertFalse(statusBuilder.contains(".setCustomHeadsUpContentView("));

        String alertBuilder = between(
                source,
                "private static Notification buildAlert(",
                "public static void clear("
        );
        assertTrue(alertBuilder.contains(
                ".setPriority(Notification.PRIORITY_HIGH)"
        ));
        assertTrue(alertBuilder.contains(
                ".setTimeoutAfter(ALERT_TIMEOUT_MS)"
        ));
        assertTrue(alertBuilder.contains(".setCustomHeadsUpContentView("));
    }

    @Test
    public void repeatedStartCommandDoesNotRepromoteRunningService()
            throws Exception {
        String source = source(
                "src/main/java/com/adie/codexonphone/SyncForegroundService.java"
        );

        assertTrue(source.contains("if (!foregroundStarted) {"));
        assertTrue(source.contains("foregroundStarted = true;"));
    }

    private static String between(
            String source,
            String startMarker,
            String endMarker
    ) {
        int start = source.indexOf(startMarker);
        int end = source.indexOf(endMarker, start + startMarker.length());
        assertTrue("Missing source start marker: " + startMarker, start >= 0);
        assertTrue("Missing source end marker: " + endMarker, end > start);
        return source.substring(start, end);
    }

    private static String source(String relativePath) throws Exception {
        Path workingDirectory = Path.of(System.getProperty("user.dir"));
        Path direct = workingDirectory.resolve(relativePath);
        Path insideApp = workingDirectory.resolve("app").resolve(relativePath);
        Path source = Files.exists(direct) ? direct : insideApp;
        assertTrue("Missing source file: " + source, Files.exists(source));
        return new String(
                Files.readAllBytes(source),
                StandardCharsets.UTF_8
        ).replace("\r\n", "\n");
    }
}
