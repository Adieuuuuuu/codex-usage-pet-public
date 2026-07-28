package com.adie.codexonphone;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.security.GeneralSecurityException;
import java.util.Arrays;

public final class SyncProtocolTest {
    private static final String PAIRING_URI =
            "codexphone://pair?v=1"
                    + "&endpoint=https%3A%2F%2Frelay.example.workers.dev"
                    + "&room=AAECAwQFBgcICQoLDA0ODw"
                    + "&secret=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

    @Test
    public void pairingDerivesStableIndependentKeys() {
        PairingBundle first = PairingBundle.parse(PAIRING_URI);
        PairingBundle second = PairingBundle.parse(PAIRING_URI);

        assertEquals(
                "wss://relay.example.workers.dev/v1/rooms/"
                        + "AAECAwQFBgcICQoLDA0ODw/events",
                first.eventsUri().toString()
        );
        assertEquals(first.authToken(), second.authToken());
        assertArrayEquals(first.encryptionKey(), second.encryptionKey());
        assertNotEquals(
                first.authToken(),
                java.util.Base64.getUrlEncoder()
                        .withoutPadding()
                        .encodeToString(first.encryptionKey())
        );
    }

    @Test
    public void pairingRejectsInsecureRemoteEndpoint() {
        String insecure = PAIRING_URI.replace(
                "https%3A%2F%2F",
                "http%3A%2F%2F"
        );

        assertThrows(
                IllegalArgumentException.class,
                () -> PairingBundle.parse(insecure)
        );
    }

    @Test
    public void encryptionRoundTripsAndRejectsReplay() throws Exception {
        PairingBundle pairing = PairingBundle.parse(PAIRING_URI);
        String plaintext = validSnapshotJson(7);
        String envelope = SyncCrypto.encrypt(pairing, 7, plaintext);

        assertEquals(plaintext, SyncCrypto.decrypt(pairing, envelope, 6));
        assertThrows(
                SyncCrypto.ReplayException.class,
                () -> SyncCrypto.decrypt(pairing, envelope, 7)
        );
    }

    @Test
    public void encryptionRejectsTamperingAndWrongKey() throws Exception {
        PairingBundle pairing = PairingBundle.parse(PAIRING_URI);
        String envelope = SyncCrypto.encrypt(pairing, 8, validSnapshotJson(8));
        JSONObject tampered = new JSONObject(envelope);
        String ciphertext = tampered.getString("ciphertext");
        char replacement = ciphertext.charAt(ciphertext.length() - 1) == 'A'
                ? 'B'
                : 'A';
        tampered.put(
                "ciphertext",
                ciphertext.substring(0, ciphertext.length() - 1) + replacement
        );

        assertThrows(
                GeneralSecurityException.class,
                () -> SyncCrypto.decrypt(pairing, tampered.toString(), 0)
        );

        String otherPairing = PAIRING_URI.replace(
                "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
                "Hh0cGxoZGBcWFRQTEhEQDw4NDAsKCQgHBgUEAwIBAAA"
        );
        assertThrows(
                GeneralSecurityException.class,
                () -> SyncCrypto.decrypt(
                        PairingBundle.parse(otherPairing),
                        envelope,
                        0
                )
        );
    }

    @Test
    public void decryptsEnvelopeProducedByDesktopTypeScriptClient()
            throws Exception {
        PairingBundle pairing = PairingBundle.parse(PAIRING_URI);
        String desktopEnvelope =
                "{\"version\":1,"
                        + "\"roomId\":\"AAECAwQFBgcICQoLDA0ODw\","
                        + "\"sequence\":42,"
                        + "\"nonce\":\"giX0sgkgkxZP6oEN\","
                        + "\"ciphertext\":\"8yb_lz40BvRNdbhMrpKs9X_UjoooXGRz"
                        + "wAGHX6LDGq9BvJ4htln6Qmkptu7NGhU2R57o7RpbW4VgOopg"
                        + "vCqO6_aERbmIJkyqaCu3U1qGlAdiQLyfj0Ulf23cUIfO8Qrz"
                        + "iUoujz9Blc73t5CrWjI7B7toai6y72ymvZJQw1OKlQVaErN"
                        + "3qJaCUt9rsfyb9pSIxShFXu8xUHH--1Drw-zVPJ836MsMgKJ"
                        + "y5H3kCDgyUOsynswXztF-KKTL_CVmSQbdLU6ywNumMv80dQ9"
                        + "FA5xZRltOPF-RKSEyxRFsRsKNVctzcJmm67LnDVa1S99r0BZ"
                        + "BzyYKZBGds9SmPwLIxaxlRsQE3z9DvHfk096aB4r2eXuca8"
                        + "gjXPCU1KP7qvDZn7x5q47tlB8RMWbUzL1L6Q\"}";

        String plaintext = SyncCrypto.decrypt(
                pairing,
                desktopEnvelope,
                41
        );
        CodexSnapshot snapshot = SnapshotCodec.decode(plaintext, false);

        assertEquals(42, snapshot.sequence());
        assertEquals(
                "Review public demo checklist",
                snapshot.tasks().get(0).title()
        );
        assertEquals(CodexSnapshot.TaskStatus.RUNNING,
                snapshot.tasks().get(0).status());
    }

    @Test
    public void snapshotCodecPreservesAllowedFields() throws Exception {
        CodexSnapshot snapshot = SnapshotCodec.decode(
                validSnapshotJson(9),
                false
        );
        CodexSnapshot decoded = SnapshotCodec.decode(
                SnapshotCodec.encode(snapshot),
                true
        );

        assertEquals(9, decoded.sequence());
        assertEquals(22, decoded.remainingPercent().intValue());
        assertEquals(1_785_628_800L, decoded.resetsAt().longValue());
        assertEquals(2, decoded.tasks().size());
        assertEquals(CodexSnapshot.TaskStatus.RUNNING,
                decoded.tasks().get(0).status());
        assertEquals(CodexSnapshot.TaskStatus.REVIEW,
                decoded.tasks().get(1).status());
        assertTrue(decoded.tasksHidden());
    }

    @Test
    public void snapshotCodecRejectsMoreThanTenTasks() throws Exception {
        JSONObject root = new JSONObject(validSnapshotJson(10));
        JSONArray tasks = root.getJSONArray("tasks");
        JSONObject task = tasks.getJSONObject(0);
        while (tasks.length() <= 10) {
            tasks.put(new JSONObject(task.toString())
                    .put("id", "task-" + tasks.length()));
        }

        assertThrows(
                IllegalArgumentException.class,
                () -> SnapshotCodec.decode(root.toString(), false)
        );
    }

    @Test
    public void attentionTransitionAlertsOnlyOnNewAttentionState()
            throws Exception {
        CodexSnapshot running = SnapshotCodec.decode(
                validSnapshotJson(11),
                false
        );
        JSONObject review = new JSONObject(validSnapshotJson(12));
        review.getJSONArray("tasks")
                .getJSONObject(0)
                .put("status", "waiting");
        CodexSnapshot waiting = SnapshotCodec.decode(review.toString(), false);

        assertTrue(waiting.hasAttentionTransitionComparedWith(running));
        assertTrue(!waiting.hasAttentionTransitionComparedWith(waiting));
    }

    private static String validSnapshotJson(long sequence) throws Exception {
        return new JSONObject()
                .put("version", 1)
                .put("sequence", sequence)
                .put("capturedAt", 1_785_200_000_000L)
                .put("usage", new JSONObject()
                        .put("status", "available")
                        .put("remainingPercent", 22)
                        .put("resetsAt", 1_785_628_800L))
                .put("tasks", new JSONArray(Arrays.asList(
                        new JSONObject()
                                .put("id", "task-running")
                                .put("title", "Running task")
                                .put("workspaceName", "Workspace")
                                .put("status", "running")
                                .put("updatedAt", 1_785_200_000_000L),
                        new JSONObject()
                                .put("id", "task-review")
                                .put("title", "Review task")
                                .put("workspaceName", JSONObject.NULL)
                                .put("status", "review")
                                .put("updatedAt", 1_785_200_001_000L)
                )))
                .toString();
    }
}
