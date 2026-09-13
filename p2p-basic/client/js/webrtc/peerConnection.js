import { CONFIG } from "../core/config.js";
import { getOrCreatePeer } from "../core/state.js";
import { getMyId } from "../core/identity.js";
import { setupDataChannel } from "./dataChannel.js";

export async function logSelectedCandidatePair(pc, targetId) {
    try {
        const stats = await pc.getStats();
        let selectedPairId = null;
        stats.forEach((report) => {
            if (report.type === "transport" && report.selectedCandidatePairId) {
                selectedPairId = report.selectedCandidatePairId;
            }
        });

        stats.forEach((report) => {
            if (report.type === "candidate-pair" && (report.nominated || report.selected || report.id === selectedPairId)) {
                if (report.state === "succeeded" || report.selected || report.nominated) {
                    const localCandidate = stats.get(report.localCandidateId);
                    const remoteCandidate = stats.get(report.remoteCandidateId);
                    console.log(
                        `[WebRTC] Active candidate pair for ${targetId}: ` +
                        `Local (${localCandidate?.candidateType || "unknown"}, ${localCandidate?.protocol || "unknown"}) <-> ` +
                        `Remote (${remoteCandidate?.candidateType || "unknown"}, ${remoteCandidate?.protocol || "unknown"})`
                    );
                }
            }
        });
    } catch (e) {
        console.warn("[WebRTC] Could not inspect stats for candidate pairs:", e);
    }
}

/**
 * Creates or resets an RTCPeerConnection for a remote peer.
 * Ensures exactly one active RTCPeerConnection exists per remote peer at a time.
 */
export function createPeerConnection(targetId, sendSignaling, onPeerListUpdate, forceRecreate = false) {
    const peer = getOrCreatePeer(targetId);

    if (!peer.processedCandidates) {
        peer.processedCandidates = new Set();
    }

    if (!forceRecreate && peer.connection && peer.connection.signalingState !== "closed" && peer.connection.connectionState !== "failed") {
        console.log(`[CONNECTION_EXISTS] Reusing existing RTCPeerConnection for peer ${targetId} [state: ${peer.connection.connectionState}, signaling: ${peer.connection.signalingState}]`);
        return peer.connection;
    }

    if (peer.connection) {
        console.log(`[CONNECTION_CLOSED] Explicitly closing previous RTCPeerConnection for peer ${targetId}`);
        try { peer.connection.close(); } catch (e) {}
        peer.connection = null;
    }

    const pc = new RTCPeerConnection({ iceServers: CONFIG.iceServers });
    peer.connection = pc;
    peer.networkState = "connecting";
    peer.pendingIceCandidates = [];
    peer.processedCandidates.clear();

    console.log(`[CONNECTION_CREATED] Created new RTCPeerConnection for peer ${targetId} [total connections for peer: 1]`);

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            const type = event.candidate.type || "unknown";
            console.log(`[ICE_SENT] Local candidate gathered for peer ${targetId} [type: ${type}]`);
            if (typeof sendSignaling === "function") {
                sendSignaling({
                    type: "candidate",
                    from: getMyId(),
                    target: targetId,
                    candidate: event.candidate
                });
            }
        } else {
            console.log(`[ICE] Local candidate gathering complete for peer ${targetId}`);
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log(`[ICE_STATE] Connection state with peer ${targetId}: ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === "failed") peer.networkState = "failed";
        if (pc.iceConnectionState === "disconnected") peer.networkState = "disconnected";
        if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") peer.networkState = "connected";
        onPeerListUpdate?.();
        if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
            logSelectedCandidatePair(pc, targetId);
        }
    };

    pc.onconnectionstatechange = () => {
        console.log(`[CONNECTION_STATE] Peer connection state with peer ${targetId}: ${pc.connectionState}`);
        peer.networkState = pc.connectionState;
        onPeerListUpdate?.();
    };

    pc.ondatachannel = (event) => {
        console.log(`[DATA_CHANNEL_RECEIVED] Remote DataChannel received from peer ${targetId} [label: ${event.channel?.label}]`);
        setupDataChannel(targetId, event.channel, onPeerListUpdate);
    };

    return pc;
}

/**
 * Safely adds an ICE candidate or queues it if remoteDescription is not yet set.
 * Deduplicates candidates to prevent duplicate ICE processing.
 */
export async function addOrQueueIceCandidate(targetId, candidate) {
    if (!candidate || !candidate.candidate) return;

    const peer = getOrCreatePeer(targetId);
    if (!peer.processedCandidates) peer.processedCandidates = new Set();

    const candStr = typeof candidate.candidate === "string" ? candidate.candidate : JSON.stringify(candidate);
    if (peer.processedCandidates.has(candStr)) {
        console.log(`[ICE_SKIPPED_DUPLICATE] Skipping duplicate ICE candidate for peer ${targetId}`);
        return;
    }
    peer.processedCandidates.add(candStr);

    if (!peer.connection || !peer.connection.remoteDescription) {
        console.log(`[ICE_QUEUED] Queuing remote ICE candidate for peer ${targetId} (remoteDescription not ready)`);
        peer.pendingIceCandidates.push(candidate);
        return;
    }

    try {
        console.log(`[ICE_RECEIVED] Adding remote ICE candidate for peer ${targetId}`);
        const iceCandidate = typeof RTCIceCandidate !== "undefined" ? new RTCIceCandidate(candidate) : candidate;
        await peer.connection.addIceCandidate(iceCandidate);
    } catch (err) {
        console.warn(`[ICE_ADD_FAILED] Failed to add ICE candidate for peer ${targetId}: ${err.message}`);
    }
}

/**
 * Flushes all pending ICE candidates once remoteDescription has been applied.
 */
export async function flushQueuedIceCandidates(targetId) {
    const peer = getOrCreatePeer(targetId);
    if (!peer.connection?.remoteDescription) return;

    const pending = peer.pendingIceCandidates.splice(0);
    if (pending.length > 0) {
        console.log(`[ICE_FLUSHING] Flushing ${pending.length} queued ICE candidate(s) for peer ${targetId}`);
    }

    for (const candidate of pending) {
        try {
            const iceCandidate = typeof RTCIceCandidate !== "undefined" ? new RTCIceCandidate(candidate) : candidate;
            await peer.connection.addIceCandidate(iceCandidate);
            console.log(`[ICE_FLUSHED] Successfully applied queued ICE candidate for peer ${targetId}`);
        } catch (err) {
            console.warn(`[ICE_ADD_FAILED] Failed to apply queued ICE candidate for peer ${targetId}: ${err.message}`);
        }
    }
}

/**
 * Initiates an outgoing WebRTC connection to a target peer.
 */
export async function connectToPeer(targetId, sendSignaling, onPeerListUpdate) {
    const peer = getOrCreatePeer(targetId);

    // Prevent duplicate outgoing offer if connection or DataChannel is already active
    if (peer.connection && peer.dataChannel && peer.dataChannel.readyState === "open") {
        console.log(`[OFFER_SKIPPED] DataChannel already open with peer ${targetId}`);
        return;
    }

    if (peer.connection && peer.connection.signalingState === "have-local-offer") {
        console.log(`[OFFER_SKIPPED] Local offer already in flight for peer ${targetId}`);
        return;
    }

    const pc = createPeerConnection(targetId, sendSignaling, onPeerListUpdate, true);
    const dc = pc.createDataChannel("chat");
    setupDataChannel(targetId, dc, onPeerListUpdate);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    console.log(`[OFFER_SENT] Sent WebRTC offer to peer ${targetId}`);

    if (typeof sendSignaling === "function") {
        sendSignaling({
            type: "offer",
            from: getMyId(),
            target: targetId,
            offer: pc.localDescription
        });
    }
}
