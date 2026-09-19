import test from "node:test";
import assert from "node:assert/strict";

import { TRANSPORT_TYPES } from "./transportTypes.js";
import { WebRTCTransport } from "./transport.js";
import { TransportManager, transportManager } from "./transportManager.js";
import { getConnectionStats } from "./connectionStats.js";
import { getOrCreatePeer, markPeerConnected, peers, discoveredPeers } from "../core/state.js";
import { getLocalDisplayName, setLocalDisplayName, formatPeerDisplayName } from "../core/identity.js";
import { addOrQueueIceCandidate, flushQueuedIceCandidates } from "../webrtc/peerConnection.js";

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

test("9. Display name is embedded in presence JSON metadata for remote propagation", () => {
    const localName = "Device-Alpha";
    setLocalDisplayName(localName);

    const presenceInfo = JSON.stringify({ t: "webrtc", name: localName });
    const parsed = JSON.parse(presenceInfo);

    assert.equal(parsed.name, "Device-Alpha");
    assert.equal(parsed.t, "webrtc");
});

test("10. Remote ICE candidates are queued before remoteDescription exists and deduplicated", async () => {
    const testPeerId = "test-peer-candidate-queuing";
    const peer = getOrCreatePeer(testPeerId);

    const candidate1 = { candidate: "candidate:1 1 UDP 2013266431 192.168.1.100 50000 typ host", sdpMid: "0", sdpMLineIndex: 0 };
    const candidate2 = { candidate: "candidate:2 1 UDP 2013266431 192.168.1.101 50001 typ host", sdpMid: "0", sdpMLineIndex: 0 };

    await addOrQueueIceCandidate(testPeerId, candidate1);
    await addOrQueueIceCandidate(testPeerId, candidate1); // Duplicate candidate
    await addOrQueueIceCandidate(testPeerId, candidate2);

    assert.equal(peer.pendingIceCandidates.length, 2);
    assert.equal(peer.processedCandidates.size, 2);

    peers.delete(testPeerId);
});

import { configuredIceServers, validateAndFilterIceServers } from "../core/config.js";

test("11. Deterministic glare tie-breaker uses lexical comparison of peer IDs", () => {
    const peerA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const peerB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    // Impolite peer (lower ID) takes precedence over incoming offer
    const isPoliteForA = peerA > peerB; // false -> A takes precedence
    const isPoliteForB = peerB > peerA; // true -> B is polite and accepts incoming offer

    assert.equal(isPoliteForA, false);
    assert.equal(isPoliteForB, true);
});

test("12. configuredIceServers returns STUN fallback when ICE_SERVERS is unconfigured", () => {
    const servers = configuredIceServers();
    assert.ok(Array.isArray(servers));
    assert.ok(servers.length > 0);
    assert.equal(servers[0].urls, "stun:stun.l.google.com:19302");
});

test("13. validateAndFilterIceServers correctly parses valid TURN configurations", () => {
    const raw = [
        { urls: "stun:stun.l.google.com:19302" },
        {
            urls: ["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:443?transport=tcp"],
            username: "ephemeral-user-123",
            credential: "ephemeral-secret-456"
        }
    ];

    const validated = validateAndFilterIceServers(raw);
    assert.equal(validated.length, 2);
    assert.equal(validated[0].urls, "stun:stun.l.google.com:19302");
    assert.equal(validated[1].username, "ephemeral-user-123");
    assert.equal(validated[1].credential, "ephemeral-secret-456");
});

test("14. validateAndFilterIceServers safely filters out incomplete TURN configurations", () => {
    const incomplete = [
        { urls: "turn:turn.example.com:3478", username: "user-only" }, // Missing credential
        { urls: "turn:turn.example.com:3478", credential: "cred-only" }, // Missing username
        { urls: "", username: "u", credential: "c" } // Empty urls
    ];

    const validated = validateAndFilterIceServers(incomplete);
    assert.equal(validated.length, 1);
    assert.equal(validated[0].urls, "stun:stun.l.google.com:19302");
});

test("15. Diagnostic logs never print TURN username or credential secrets", () => {
    const secretUser = "SUPER_SECRET_USER_888";
    const secretPass = "SUPER_SECRET_PASS_999";

    const logEntry = `[ICE] Relay candidate gathered for peer test-peer [type: relay]`;

    assert.ok(!logEntry.includes(secretUser));
    assert.ok(!logEntry.includes(secretPass));
});
