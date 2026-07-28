package com.adie.codexonphone;

final class SyncFreshnessPolicy {
    private SyncFreshnessPolicy() {
    }

    static boolean isStale(
            CodexSnapshot snapshot,
            long now,
            long staleAfterMs
    ) {
        return remainingUntilStale(snapshot, now, staleAfterMs) == 0;
    }

    static long remainingUntilStale(
            CodexSnapshot snapshot,
            long now,
            long staleAfterMs
    ) {
        if (snapshot.sequence() == 0) {
            return 0;
        }
        long capturedAt = snapshot.capturedAt();
        if (capturedAt >= now) {
            return staleAfterMs;
        }
        long age = now - capturedAt;
        if (age < 0 || age >= staleAfterMs) {
            return 0;
        }
        return staleAfterMs - age;
    }

    static long nextCheckDelay(
            CodexSnapshot snapshot,
            long now,
            long staleAfterMs,
            long staleRetryMs
    ) {
        long remaining = remainingUntilStale(snapshot, now, staleAfterMs);
        return remaining > 0 ? remaining : staleRetryMs;
    }
}
