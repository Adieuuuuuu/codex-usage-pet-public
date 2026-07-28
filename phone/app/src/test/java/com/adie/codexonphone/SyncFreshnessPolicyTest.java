package com.adie.codexonphone;

import org.junit.Test;

import java.util.Collections;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public final class SyncFreshnessPolicyTest {
    private static final long STALE_AFTER_MS = 10 * 60_000L;
    private static final long STALE_RETRY_MS = 5 * 60_000L;
    private static final long CAPTURED_AT = 1_785_200_000_000L;

    @Test
    public void freshSnapshotKeepsOnlyItsRemainingFreshnessWindow() {
        CodexSnapshot snapshot = snapshot(7, CAPTURED_AT);

        assertEquals(
                4 * 60_000L,
                SyncFreshnessPolicy.remainingUntilStale(
                        snapshot,
                        CAPTURED_AT + 6 * 60_000L,
                        STALE_AFTER_MS
                )
        );
        assertFalse(SyncFreshnessPolicy.isStale(
                snapshot,
                CAPTURED_AT + 6 * 60_000L,
                STALE_AFTER_MS
        ));
    }

    @Test
    public void deadlineAndMissingDesktopSnapshotAreStale() {
        assertTrue(SyncFreshnessPolicy.isStale(
                snapshot(7, CAPTURED_AT),
                CAPTURED_AT + STALE_AFTER_MS,
                STALE_AFTER_MS
        ));
        assertTrue(SyncFreshnessPolicy.isStale(
                snapshot(0, CAPTURED_AT),
                CAPTURED_AT,
                STALE_AFTER_MS
        ));
    }

    @Test
    public void futureDesktopClockGetsAFullFreshnessWindow() {
        assertEquals(
                STALE_AFTER_MS,
                SyncFreshnessPolicy.remainingUntilStale(
                        snapshot(7, CAPTURED_AT + 30_000L),
                        CAPTURED_AT,
                        STALE_AFTER_MS
                )
        );
    }

    @Test
    public void staleSnapshotKeepsABoundedRecoveryWatchdog() {
        assertEquals(
                STALE_RETRY_MS,
                SyncFreshnessPolicy.nextCheckDelay(
                        snapshot(7, CAPTURED_AT),
                        CAPTURED_AT + STALE_AFTER_MS,
                        STALE_AFTER_MS,
                        STALE_RETRY_MS
                )
        );
        assertEquals(
                STALE_RETRY_MS,
                SyncFreshnessPolicy.nextCheckDelay(
                        snapshot(0, CAPTURED_AT),
                        CAPTURED_AT,
                        STALE_AFTER_MS,
                        STALE_RETRY_MS
                )
        );
    }

    @Test
    public void freshSnapshotSchedulesOnlyItsRemainingWindow() {
        assertEquals(
                4 * 60_000L,
                SyncFreshnessPolicy.nextCheckDelay(
                        snapshot(7, CAPTURED_AT),
                        CAPTURED_AT + 6 * 60_000L,
                        STALE_AFTER_MS,
                        STALE_RETRY_MS
                )
        );
    }

    private static CodexSnapshot snapshot(long sequence, long capturedAt) {
        return new CodexSnapshot(
                1,
                sequence,
                capturedAt,
                CodexSnapshot.UsageStatus.UNAVAILABLE,
                null,
                null,
                Collections.emptyList(),
                false
        );
    }
}
