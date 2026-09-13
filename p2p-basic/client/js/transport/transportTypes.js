/**
 * Supported Transport Types for P2P Beam architecture.
 *
 * In the web application context, only WEBRTC is active and available.
 * Future native mobile apps (Android/iOS) can register platform-specific
 * transports behind the same interface.
 */
export const TRANSPORT_TYPES = Object.freeze({
    WEBRTC: "webrtc",
    WIFI_DIRECT: "wifi_direct",
    BLUETOOTH: "bluetooth",
    WIFI_AWARE: "wifi_aware",
    NFC: "nfc",
    LORA: "lora"
});

export const ALL_TRANSPORT_TYPES = Object.freeze(Object.values(TRANSPORT_TYPES));
