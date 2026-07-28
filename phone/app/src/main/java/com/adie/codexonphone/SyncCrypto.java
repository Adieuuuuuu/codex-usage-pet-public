package com.adie.codexonphone;

import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;

import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

public final class SyncCrypto {
    private static final int NONCE_BYTES = 12;
    private static final int GCM_TAG_BITS = 128;
    private static final int MAX_CIPHERTEXT_BYTES = 16 * 1024;
    private static final SecureRandom RANDOM = new SecureRandom();

    private SyncCrypto() {
    }

    public static String encrypt(
            PairingBundle pairing,
            long sequence,
            String plaintext
    ) {
        if (sequence <= 0) {
            throw new IllegalArgumentException("Sequence must be positive.");
        }
        try {
            byte[] nonce = new byte[NONCE_BYTES];
            RANDOM.nextBytes(nonce);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(
                    Cipher.ENCRYPT_MODE,
                    new SecretKeySpec(pairing.encryptionKey(), "AES"),
                    new GCMParameterSpec(GCM_TAG_BITS, nonce)
            );
            cipher.updateAAD(aad(pairing.roomId(), sequence));
            byte[] ciphertext =
                    cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            if (ciphertext.length > MAX_CIPHERTEXT_BYTES) {
                throw new IllegalArgumentException("Encrypted snapshot is too large.");
            }
            return new JSONObject()
                    .put("version", 1)
                    .put("roomId", pairing.roomId())
                    .put("sequence", sequence)
                    .put("nonce", encode(nonce))
                    .put("ciphertext", encode(ciphertext))
                    .toString();
        } catch (GeneralSecurityException | JSONException error) {
            throw new IllegalStateException("Snapshot encryption failed.", error);
        }
    }

    public static String decrypt(
            PairingBundle pairing,
            String envelopeJson,
            long lastAcceptedSequence
    ) throws GeneralSecurityException {
        try {
            JSONObject envelope = new JSONObject(envelopeJson);
            if (envelope.getInt("version") != 1
                    || !pairing.roomId().equals(envelope.getString("roomId"))) {
                throw new GeneralSecurityException("Envelope identity mismatch.");
            }
            long sequence = envelope.getLong("sequence");
            if (sequence <= lastAcceptedSequence) {
                throw new ReplayException(sequence);
            }
            byte[] nonce = decode(envelope.getString("nonce"));
            byte[] ciphertext = decode(envelope.getString("ciphertext"));
            if (nonce.length != NONCE_BYTES
                    || ciphertext.length < 16
                    || ciphertext.length > MAX_CIPHERTEXT_BYTES) {
                throw new GeneralSecurityException("Envelope bounds are invalid.");
            }

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(
                    Cipher.DECRYPT_MODE,
                    new SecretKeySpec(pairing.encryptionKey(), "AES"),
                    new GCMParameterSpec(GCM_TAG_BITS, nonce)
            );
            cipher.updateAAD(aad(pairing.roomId(), sequence));
            return new String(
                    cipher.doFinal(ciphertext),
                    StandardCharsets.UTF_8
            );
        } catch (ReplayException | AEADBadTagException error) {
            throw error;
        } catch (JSONException | IllegalArgumentException error) {
            throw new GeneralSecurityException("Malformed encrypted envelope.", error);
        }
    }

    public static long sequenceOf(String envelopeJson)
            throws GeneralSecurityException {
        try {
            long sequence = new JSONObject(envelopeJson).getLong("sequence");
            if (sequence <= 0) {
                throw new GeneralSecurityException("Sequence must be positive.");
            }
            return sequence;
        } catch (JSONException error) {
            throw new GeneralSecurityException("Envelope has no sequence.", error);
        }
    }

    private static byte[] aad(String roomId, long sequence) {
        return ("codex-phone-v1|" + roomId + "|" + sequence)
                .getBytes(StandardCharsets.UTF_8);
    }

    private static String encode(byte[] value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }

    private static byte[] decode(String value) {
        return Base64.getUrlDecoder().decode(value);
    }

    public static final class ReplayException extends GeneralSecurityException {
        private final long sequence;

        ReplayException(long sequence) {
            super("Envelope sequence was already accepted.");
            this.sequence = sequence;
        }

        public long sequence() {
            return sequence;
        }
    }
}
