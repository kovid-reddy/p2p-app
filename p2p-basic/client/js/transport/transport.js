import { TRANSPORT_TYPES } from "./transportTypes.js";
import { getPeer } from "../core/state.js";
import { connectToPeer } from "../webrtc/peerConnection.js";
import { getConnectionStats } from "./connectionStats.js";

/**
 * Base Transport Interface
 * Defines the contract for all physical and virtual transport implementations.
 */
export class Transport {
    constructor(name) {
        this.name = name;
    }

    isAvailable() {
        return false;
    }

    async connect(targetId, options = {}) {
        throw new Error(`connect() not implemented for transport: ${this.name}`);
    }

    async disconnect(targetId) {
        throw new Error(`disconnect() not implemented for transport: ${this.name}`);
    }

    send(targetId, data) {
        throw new Error(`send() not implemented for transport: ${this.name}`);
    }

    getState(targetId) {
        return "disconnected";
    }

    async getStats(targetId) {
        return {
            transport: this.name,
            latencyMs: null,
            throughputMbps: null,
            state: this.getState(targetId),
            pathType: null
        };
    }

    getCapabilities() {
        return {
            maxMessageSize: 65535,
            supportsBinary: true,
            requiresInternet: true,
            isMeshCapable: false
        };
    }
}

/**
 * WebRTC Transport Adapter
 * Wraps existing WebRTC / DataChannel implementation cleanly without rewriting WebRTC code.
 */
export class WebRTCTransport extends Transport {
    constructor() {
        super(TRANSPORT_TYPES.WEBRTC);
    }

    isAvailable() {
        return typeof RTCPeerConnection !== "undefined";
    }

    async connect(targetId, options = {}) {
        const { sendSignaling, onPeerListUpdate } = options;
        return connectToPeer(targetId, sendSignaling, onPeerListUpdate);
    }

    async disconnect(targetId) {
        const peer = getPeer(targetId);
        if (peer?.dataChannel) {
            try { peer.dataChannel.close(); } catch {}
        }
        if (peer?.connection) {
            try { peer.connection.close(); } catch {}
        }
        if (peer) {
            peer.networkState = "disconnected";
        }
    }

    send(targetId, data) {
        const peer = getPeer(targetId);
        if (!peer || !peer.dataChannel || peer.dataChannel.readyState !== "open") {
            throw new Error(`DataChannel to ${targetId} is not open`);
        }
        peer.dataChannel.send(data);
    }

    getState(targetId) {
        const peer = getPeer(targetId);
        if (!peer) return "disconnected";
        if (peer.dataChannel?.readyState === "open") return "connected";
        return peer.networkState || "disconnected";
    }

    async getStats(targetId) {
        return getConnectionStats(targetId);
    }

    getCapabilities() {
        return {
            maxMessageSize: 262144, // 256 KiB recommended max DataChannel message
            supportsBinary: true,
            requiresInternet: true, // Requires signaling / NAT traversal (STUN/TURN)
            isMeshCapable: false
        };
    }
}
