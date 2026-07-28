package com.adie.codexonphone;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.Assert.assertTrue;

public final class SyncRecoveryContractTest {
    @Test
    public void staleDeadlineReplacesTheCurrentSocket() throws Exception {
        String source = source(
                "src/main/java/com/adie/codexonphone/SyncForegroundService.java"
        );
        String staleCallback = between(
                source,
                "private void handleDesktopStaleDeadline()",
                "public static void start("
        );

        assertTrue(staleCallback.contains(
                "SyncFreshnessPolicy.remainingUntilStale("
        ));
        assertTrue(staleCallback.contains("restartConnection();"));
        assertTrue(staleCallback.contains(
                "scheduleDesktopFreshnessCheck(snapshot);"
        ));
        assertTrue(source.contains(
                "SyncFreshnessPolicy.nextCheckDelay("
        ));
        assertTrue(source.contains("handler.removeCallbacks(reconnect);"));
        assertTrue(source.contains("handler.postDelayed(reconnect, delay);"));
    }

    @Test
    public void defaultNetworkChangesAreObservedAndCleanedUp()
            throws Exception {
        String service = source(
                "src/main/java/com/adie/codexonphone/SyncForegroundService.java"
        );
        String manifest = source("src/main/AndroidManifest.xml");

        assertTrue(manifest.contains(
                "android.permission.ACCESS_NETWORK_STATE"
        ));
        assertTrue(service.contains(
                "registerDefaultNetworkCallback("
        ));
        assertTrue(service.contains(
                "unregisterNetworkCallback(networkCallback)"
        ));
        assertTrue(service.contains("public void onAvailable(Network network)"));
        assertTrue(service.contains("public void onLost(Network network)"));
    }

    @Test
    public void reconnectBaselineDoesNotCreateAnAttentionAlert()
            throws Exception {
        String source = source(
                "src/main/java/com/adie/codexonphone/SyncForegroundService.java"
        );

        assertTrue(source.contains(
                "acceptEnvelope(JSONObject envelope, boolean allowAlert)"
        ));
        assertTrue(source.contains(
                "boolean alert = allowAlert\n"
                        + "                && next.hasAttentionTransitionComparedWith(previous);"
        ));
        assertTrue(source.contains(
                "acceptEnvelope(envelope, !initial);"
        ));
        assertTrue(source.contains(
                "awaitingInitialEnvelope = false;"
        ));
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
        );
    }
}
