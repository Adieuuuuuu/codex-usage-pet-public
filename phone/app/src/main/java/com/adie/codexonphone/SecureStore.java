package com.adie.codexonphone;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.Base64;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SecureStore {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "codex_phone_local_store_v1";
    private static final String PREFS = "codex_phone_secure_store_v1";
    private static final int GCM_TAG_BITS = 128;

    private final SharedPreferences preferences;

    SecureStore(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    void put(String name, String value) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] ciphertext =
                    cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            preferences.edit()
                    .putString(name + "_iv", encode(cipher.getIV()))
                    .putString(name + "_ciphertext", encode(ciphertext))
                    .apply();
        } catch (GeneralSecurityException error) {
            throw new IllegalStateException("Protected storage is unavailable.", error);
        }
    }

    String get(String name) {
        String ivValue = preferences.getString(name + "_iv", null);
        String ciphertextValue =
                preferences.getString(name + "_ciphertext", null);
        if (ivValue == null || ciphertextValue == null) {
            return null;
        }
        try {
            byte[] iv = decode(ivValue);
            byte[] ciphertext = decode(ciphertextValue);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(
                    Cipher.DECRYPT_MODE,
                    key(),
                    new GCMParameterSpec(GCM_TAG_BITS, iv)
            );
            return new String(
                    cipher.doFinal(ciphertext),
                    StandardCharsets.UTF_8
            );
        } catch (GeneralSecurityException | IllegalArgumentException error) {
            remove(name);
            return null;
        }
    }

    void remove(String name) {
        preferences.edit()
                .remove(name + "_iv")
                .remove(name + "_ciphertext")
                .apply();
    }

    private SecretKey key() throws GeneralSecurityException {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        try {
            keyStore.load(null);
        } catch (IOException error) {
            throw new GeneralSecurityException(
                    "Android Keystore could not be loaded.",
                    error
            );
        }
        java.security.Key existing = keyStore.getKey(KEY_ALIAS, null);
        if (existing instanceof SecretKey) {
            return (SecretKey) existing;
        }

        KeyGenerator generator =
                KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return generator.generateKey();
    }

    private static String encode(byte[] value) {
        return Base64.getEncoder().encodeToString(value);
    }

    private static byte[] decode(String value) {
        return Base64.getDecoder().decode(value);
    }
}
