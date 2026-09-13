import { getPeer } from "../core/state.js";
import { TRANSPORT_TYPES } from "./transportTypes.js";

const peerStatsHistory = new Map();

/**
 * Diagnostic helper to measure actual connection statistics for a peer.
 * Safely returns null for any metric that cannot be measured or is unavailable.
 *
 * @param {string} targetId
 * @returns {Promise<{transport: string, latencyMs: number|null, throughputMbps: number|null, state: string, pathType: string|null}>}
 */
export async function getConnectionStats(targetId) {
    const peer = getPeer(targetId);
    if (!peer) {
        return {
            transport: TRANSPORT_TYPES.WEBRTC,
            latencyMs: null,
            throughputMbps: null,
            state: "disconnected",
            pathType: null
        };
    }

    const state = peer.dataChannel?.readyState === "open"
        ? "connected"
        : (peer.networkState || "disconnected");

    const pc = peer.connection;
    if (!pc || typeof pc.getStats !== "function" || state !== "connected") {
        return {
            transport: peer.activeTransport || TRANSPORT_TYPES.WEBRTC,
            latencyMs: null,
            throughputMbps: null,
            state: state,
            pathType: null
        };
    }

    try {
        const stats = await pc.getStats();
        let selectedPair = null;
        let selectedPairId = null;

        stats.forEach((report) => {
            if (report.type === "transport" && report.selectedCandidatePairId) {
                selectedPairId = report.selectedCandidatePairId;
            }
        });

        stats.forEach((report) => {
            if (report.type === "candidate-pair") {
                if (report.nominated || report.selected || report.id === selectedPairId) {
                    if (report.state === "succeeded" || report.selected || report.nominated) {
                        selectedPair = report;
                    }
                }
            }
        });

        let latencyMs = null;
        if (selectedPair && typeof selectedPair.currentRoundTripTime === "number" && !isNaN(selectedPair.currentRoundTripTime)) {
            latencyMs = Math.round(selectedPair.currentRoundTripTime * 1000);
        }

        let pathType = null;
        if (selectedPair) {
            const localCandidate = stats.get(selectedPair.localCandidateId);
            const remoteCandidate = stats.get(selectedPair.remoteCandidateId);
            const localType = localCandidate?.candidateType || "unknown";
            const remoteType = remoteCandidate?.candidateType || "unknown";
            pathType = `${localType} ↔ ${remoteType}`;
        }

        // Compute throughput from total bytes transferred over time interval
        let currentBytes = 0;
        stats.forEach((report) => {
            if (report.type === "data-channel" || report.type === "transport" || report.type === "candidate-pair") {
                if (typeof report.bytesReceived === "number") currentBytes += report.bytesReceived;
                if (typeof report.bytesSent === "number") currentBytes += report.bytesSent;
            }
        });

        const now = Date.now();
        const prev = peerStatsHistory.get(targetId);
        let throughputMbps = null;

        if (prev && prev.time < now && currentBytes >= prev.bytes) {
            const timeDiffSec = (now - prev.time) / 1000;
            if (timeDiffSec >= 0.5) {
                const bytesDiff = currentBytes - prev.bytes;
                const bitsPerSec = (bytesDiff * 8) / timeDiffSec;
                throughputMbps = parseFloat((bitsPerSec / (1000 * 1000)).toFixed(2));
            } else {
                throughputMbps = prev.lastThroughputMbps ?? null;
            }
        }

        peerStatsHistory.set(targetId, {
            time: now,
            bytes: currentBytes,
            lastThroughputMbps: throughputMbps
        });

        return {
            transport: peer.activeTransport || TRANSPORT_TYPES.WEBRTC,
            latencyMs: latencyMs,
            throughputMbps: throughputMbps,
            state: state,
            pathType: pathType
        };
    } catch (e) {
        console.warn(`[ConnectionStats] Could not measure stats for ${targetId}:`, e);
        return {
            transport: peer.activeTransport || TRANSPORT_TYPES.WEBRTC,
            latencyMs: null,
            throughputMbps: null,
            state: state,
            pathType: null
        };
    }
}
