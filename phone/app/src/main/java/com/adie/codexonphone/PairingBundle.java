package com.adie.codexonphone;

import java.net.URI;
import java.net.URLDecoder;
import java.io.UnsupportedEncodingException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public final class PairingBundle {
    private static final String AUTH_INFO = "codex-phone-auth-v1";
    private static final String ENCRYPTION_INFO = "codex-phone-encryption-v1";

    private final URI endpoint;
    private final String roomId;
    private final byte[] roomIdBytes;
    private final byte[] masterSecret;

    private PairingBundle(
            URI endpoint,
            String roomId,
            byte[] roomIdBytes,
            byte[] masterSecret
    ) {
        this.endpoint = endpoint;
        this.roomId = roomId;
        this.roomIdBytes = roomIdBytes.clone();
        this.masterSecret = masterSecret.clone();
    }

    public static PairingBundle parse(String pairingUri) {
        Objects.requireNonNull(pairingUri);
        URI uri = URI.create(pairingUri.trim());
        if (!"codexphone".equals(uri.getScheme())
                || !"pair".equals(uri.getHost())) {
            throw new IllegalArgumentException("Unsupported pairing URI.");
        }

        Map<String, String> query = parseQuery(uri.getRawQuery());
        if (!"1".equals(query.get("v"))) {
            throw new IllegalArgumentException("Unsupported pairing version.");
        }

        URI endpoint = URI.create(required(query, "endpoint"));
        validateEndpoint(endpoint);

        String roomId = required(query, "room");
        byte[] roomBytes = decodeBase64Url(roomId, "room");
        if (roomBytes.length != 16) {
            throw new IllegalArgumentException("Room ID must be 16 bytes.");
        }

        byte[] secret = decodeBase64Url(required(query, "secret"), "secret");
        if (secret.length != 32) {
            throw new IllegalArgumentException("Master secret must be 32 bytes.");
        }

        return new PairingBundle(endpoint, roomId, roomBytes, secret);
    }

    public URI endpoint() {
        return endpoint;
    }

    public String roomId() {
        return roomId;
    }

    public byte[] encryptionKey() {
        return derive(ENCRYPTION_INFO);
    }

    public String authToken() {
        return Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(derive(AUTH_INFO));
    }

    public URI eventsUri() {
        String scheme = "https".equals(endpoint.getScheme()) ? "wss" : "ws";
        return URI.create(
                scheme
                        + "://"
                        + endpoint.getRawAuthority()
                        + "/v1/rooms/"
                        + roomId
                        + "/events"
        );
    }

    private byte[] derive(String info) {
        try {
            byte[] pseudoRandomKey = hmac(roomIdBytes, masterSecret);
            byte[] input = new byte[info.getBytes(StandardCharsets.UTF_8).length + 1];
            byte[] infoBytes = info.getBytes(StandardCharsets.UTF_8);
            System.arraycopy(infoBytes, 0, input, 0, infoBytes.length);
            input[input.length - 1] = 1;
            return hmac(pseudoRandomKey, input);
        } catch (GeneralSecurityException error) {
            throw new IllegalStateException("HKDF is unavailable.", error);
        }
    }

    private static byte[] hmac(byte[] key, byte[] input)
            throws GeneralSecurityException {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        return mac.doFinal(input);
    }

    private static void validateEndpoint(URI endpoint) {
        String scheme = endpoint.getScheme();
        boolean localHttp = "http".equals(scheme)
                && ("127.0.0.1".equals(endpoint.getHost())
                || "localhost".equals(endpoint.getHost())
                || "10.0.2.2".equals(endpoint.getHost()));
        if (!"https".equals(scheme) && !localHttp) {
            throw new IllegalArgumentException("Relay endpoint must use HTTPS.");
        }
        if (endpoint.getHost() == null
                || endpoint.getUserInfo() != null
                || endpoint.getQuery() != null
                || endpoint.getFragment() != null
                || (endpoint.getPath() != null
                && !endpoint.getPath().isEmpty()
                && !"/".equals(endpoint.getPath()))) {
            throw new IllegalArgumentException("Relay endpoint must be an origin.");
        }
    }

    private static Map<String, String> parseQuery(String rawQuery) {
        Map<String, String> result = new HashMap<>();
        if (rawQuery == null || rawQuery.isEmpty()) {
            return result;
        }
        for (String part : rawQuery.split("&")) {
            int separator = part.indexOf('=');
            if (separator <= 0) {
                throw new IllegalArgumentException("Malformed pairing query.");
            }
            String key = decodeQuery(part.substring(0, separator));
            String value = decodeQuery(part.substring(separator + 1));
            if (result.put(key, value) != null) {
                throw new IllegalArgumentException("Duplicate pairing field.");
            }
        }
        return result;
    }

    private static String required(Map<String, String> query, String name) {
        String value = query.get(name);
        if (value == null || value.isEmpty()) {
            throw new IllegalArgumentException("Missing pairing field: " + name);
        }
        return value;
    }

    private static String decodeQuery(String value) {
        try {
            return URLDecoder.decode(value, StandardCharsets.UTF_8.name());
        } catch (UnsupportedEncodingException error) {
            throw new IllegalStateException("UTF-8 is unavailable.", error);
        }
    }

    private static byte[] decodeBase64Url(String value, String field) {
        try {
            return Base64.getUrlDecoder().decode(value);
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException(
                    "Invalid base64url in " + field + ".",
                    error
            );
        }
    }
}
