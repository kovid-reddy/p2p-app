import { TRANSPORT_TYPES } from "./transportTypes.js";
import { WebRTCTransport } from "./transport.js";
import { getPeer } from "../core/state.js";

/**
 * TransportManager
 * Manages registered network transports, resolves active transport per peer,
 * and exposes unified network transport control.
 */
export class TransportManager {
    constructor() {
        this.transports = new Map();
        // Register default web transport: WebRTC
        this.registerTransport(new WebRTCTransport());
    }

    /**
     * Register a transport implementation.
     * @param {Transport} transport
     */
    registerTransport(transport) {
        if (!transport || !transport.name) {
            throw new Error("Invalid transport instance");
        }
        this.transports.set(transport.name, transport);
    }

    /**
     * Get list of registered transport names.
     * @returns {string[]}
     */
    getRegisteredTransports() {
        return Array.from(this.transports.keys());
    }

    /**
     * Get list of currently available transport names (where isAvailable() === true).
     * @returns {string[]}
     */
    getAvailableTransports() {
        const available = [];
        this.transports.forEach((transport, name) => {
            if (transport.isAvailable()) {
                available.push(name);
            }
        });
        return available;
    }

    /**
     * Get a specific transport instance by name.
     * @param {string} name
     * @returns {Transport|null}
     */
    getTransport(name) {
        return this.transports.get(name) || null;
    }

    /**
     * Resolve the active transport for a specific peer.
     * @param {string} targetId
     * @returns {Transport|null}
     */
    getActiveTransport(targetId) {
        const peer = getPeer(targetId);
        const transportType = peer?.activeTransport || TRANSPORT_TYPES.WEBRTC;
        return this.getTransport(transportType);
    }

    /**
     * Connect to peer via active or specified transport.
     */
    async connect(targetId, options = {}) {
        const transport = this.getActiveTransport(targetId) || this.getTransport(TRANSPORT_TYPES.WEBRTC);
        if (!transport) {
            throw new Error("No transport available to connect");
        }
        return transport.connect(targetId, options);
    }

    /**
     * Disconnect from peer via active transport.
     */
    async disconnect(targetId) {
        const transport = this.getActiveTransport(targetId);
        if (transport) {
            return transport.disconnect(targetId);
        }
    }

    /**
     * Send payload to peer via active transport.
     */
    send(targetId, data) {
        const transport = this.getActiveTransport(targetId);
        if (!transport) {
            throw new Error(`No active transport for peer ${targetId}`);
        }
        return transport.send(targetId, data);
    }

    /**
     * Get connection state for peer.
     */
    getState(targetId) {
        const transport = this.getActiveTransport(targetId);
        return transport ? transport.getState(targetId) : "disconnected";
    }

    /**
     * Get diagnostic stats for peer connection.
     */
    async getStats(targetId) {
        const transport = this.getActiveTransport(targetId);
        if (transport) {
            return transport.getStats(targetId);
        }
        return {
            transport: TRANSPORT_TYPES.WEBRTC,
            latencyMs: null,
            throughputMbps: null,
            state: "disconnected",
            pathType: null
        };
    }
}

// Singleton instance export
export const transportManager = new TransportManager();
