package com.adie.codexonphone;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.Assert.assertTrue;

public final class ManualRefreshContractTest {
    @Test
    public void mobileRefreshRequiresRelayForwardingAndANewerSnapshot()
            throws Exception {
        String service = source(
                "src/main/java/com/adie/codexonphone/SyncForegroundService.java"
        );

        assertTrue(service.contains("ACTION_REFRESH"));
        assertTrue(service.contains("UUID.randomUUID().toString()"));
        assertTrue(service.contains(".put(\"type\", \"refresh_request\")"));
        assertTrue(service.contains("REFRESH_TIMEOUT_MS = 15_000L"));
        assertTrue(service.contains("\"forwarded\".equals(result)"));
        assertTrue(service.contains(
                "sequence > pendingRefreshBaselineSequence"
        ));
        assertTrue(service.contains(
                "if (refreshForwarded && refreshSnapshotObserved)"
        ));
    }

    @Test
    public void pairedScreenExposesOneRefreshAction() throws Exception {
        String activity = source(
                "src/main/java/com/adie/codexonphone/MainActivity.java"
        );
        String layout = source("src/main/res/layout/activity_main.xml");

        assertTrue(layout.contains("android:id=\"@+id/refresh\""));
        assertTrue(activity.contains(
                "SyncForegroundService.requestRefresh(this)"
        ));
        assertTrue(activity.contains("R.string.refresh_status_success"));
        assertTrue(activity.contains(
                "R.string.refresh_status_desktop_unavailable"
        ));
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
        );
    }
}
