import test from "node:test";
import assert from "node:assert/strict";

import { TRANSPORT_TYPES, ALL_TRANSPORT_TYPES } from "./transportTypes.js";
import { Transport, WebRTCTransport } from "./transport.js";
import { TransportManager, transportManager } from "./transportManager.js";
import { getConnectionStats } from "./connectionStats.js";
import { getOrCreatePeer, markPeerConnected, peers, discoveredPeers } from "../core/state.js";
import { getLocalDisplayName, setLocalDisplayName, formatPeerDisplayName } from "../core/identity.js";

// Mock localStorage for Node environment if missing or incomplete
if (typeof globalThis.localStorage === "undefined" || typeof globalThis.localStorage.clear !== "function") {
    const store = new Map();
    globalThis.localStorage = {
        getItem: (k) => store.get(k) || null,
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear()
    };
}

test("1. WebRTC is registered as the current available transport", () => {
    const registered = transportManager.getRegisteredTransports();
    assert.ok(registered.includes(TRANSPORT_TYPES.WEBRTC));

    const webRtcTransport = transportManager.getTransport(TRANSPORT_TYPES.WEBRTC);
    assert.ok(webRtcTransport instanceof WebRTCTransport);
    assert.equal(webRtcTransport.name, "webrtc");
});

test("2. Unknown or future transports are not falsely reported as available in web environment", () => {
    const manager = new TransportManager();
    const available = manager.getAvailableTransports();

    assert.ok(!available.includes(TRANSPORT_TYPES.BLUETOOTH));
    assert.ok(!available.includes(TRANSPORT_TYPES.WIFI_DIRECT));
    assert.ok(!available.includes(TRANSPORT_TYPES.WIFI_AWARE));
    assert.equal(manager.getTransport(TRANSPORT_TYPES.BLUETOOTH), null);
});

test("3. Peer state supports displayName, transports, and activeTransport", () => {
    const testPeerId = "test-peer-state-123456";
    const peer = getOrCreatePeer(testPeerId);

    assert.equal(peer.peerId, testPeerId);
    assert.equal(peer.displayName, null);
    assert.deepEqual(peer.transports, ["webrtc"]);
    assert.equal(peer.activeTransport, "webrtc");

    markPeerConnected(testPeerId);
    assert.deepEqual(peer.transports, ["webrtc"]);
    assert.equal(peer.activeTransport, "webrtc");

    peers.delete(testPeerId);
    discoveredPeers.delete(testPeerId);
});

test("4. displayName does not replace peerId", () => {
    const testPeerId = "cryptographic-peer-id-abc123def456";
    const peer = getOrCreatePeer(testPeerId);
    peer.displayName = "Kovid's Laptop";

    assert.equal(peer.peerId, "cryptographic-peer-id-abc123def456");
    assert.equal(peer.displayName, "Kovid's Laptop");
    assert.notEqual(peer.peerId, peer.displayName);

    const formatted = formatPeerDisplayName(peer.peerId, peer.displayName);
    assert.equal(formatted, "Kovid's Laptop");

    const fallbackFormatted = formatPeerDisplayName(peer.peerId, null);
    assert.equal(fallbackFormatted, "Peer crypto");

    peers.delete(testPeerId);
});

test("5. Local display name persists locally in localStorage", () => {
    localStorage.clear();
    setLocalDisplayName("My Custom Node");
    assert.equal(getLocalDisplayName(), "My Custom Node");

    setLocalDisplayName("");
    assert.equal(getLocalDisplayName(), "My Device");
});

test("6. TransportManager can expose active transport for a peer", () => {
    const testPeerId = "test-peer-active-transport";
    getOrCreatePeer(testPeerId);

    const activeTransport = transportManager.getActiveTransport(testPeerId);
    assert.ok(activeTransport !== null);
    assert.equal(activeTransport.name, "webrtc");

    peers.delete(testPeerId);
});

test("7. WebRTC transport adapter delegates to WebRTC contract methods", async () => {
    const webRtc = new WebRTCTransport();
    const capabilities = webRtc.getCapabilities();

    assert.ok(capabilities.maxMessageSize > 0);
    assert.equal(capabilities.supportsBinary, true);
    assert.equal(capabilities.requiresInternet, true);

    assert.equal(webRtc.getState("non-existent-peer"), "disconnected");
});

test("8. Connection stats safely return null/unknown when metrics are unavailable", async () => {
    const stats = await getConnectionStats("non-existent-peer");

    assert.equal(stats.transport, "webrtc");
    assert.equal(stats.latencyMs, null);
    assert.equal(stats.throughputMbps, null);
    assert.equal(stats.state, "disconnected");
    assert.equal(stats.pathType, null);
});
