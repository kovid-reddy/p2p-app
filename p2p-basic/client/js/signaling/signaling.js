import { CONFIG } from "../core/config.js";
import { getMyId, getLocalDisplayName } from "../core/identity.js";
import { discoveredPeers, peers, getOrCreatePeer } from "../core/state.js";
import { cleanupPeer } from "../transfer/transferCleanup.js";
import { createPeerConnection, addOrQueueIceCandidate, flushQueuedIceCandidates } from "../webrtc/peerConnection.js";

function parsePeerMetadata(info) {
    if (!info) return { transport: "webrtc", displayName: null };
    if (typeof info === "object") {
        return {
            transport: info.transport || info.t || "webrtc",
            displayName: info.displayName || info.name || null
        };
    }
    if (typeof info === "string") {
        if (info.startsWith("{")) {
            try {
                const parsed = JSON.parse(info);
                return {
                    transport: parsed.transport || parsed.t || "webrtc",
                    displayName: parsed.displayName || parsed.name || null
                };
            } catch {}
        }
        return { transport: "webrtc", displayName: info !== "webrtc" ? info : null };
    }
    return { transport: "webrtc", displayName: null };
}

function buildLocalPresenceInfo() {
    return JSON.stringify({ t: "webrtc", name: getLocalDisplayName() });
}

let socket = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let intentionallyClosed = false;
let callbacks = {};
let heartbeatTimer = null;
const HEARTBEAT_INTERVAL_MS = 60_000;

function scheduleReconnect() {
    if (intentionallyClosed || reconnectTimer) return;
    const delay = Math.min(1_000 * (2 ** reconnectAttempt), 15_000);
    reconnectAttempt += 1;
    callbacks.onReconnecting?.(delay);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
    }, delay);
}

function connect() {
    callbacks.onConnecting?.();
    try {
        socket = new WebSocket(CONFIG.SIGNALING_URL);
    } catch (error) {
        console.error("Signaling configuration error:", error.message);
        callbacks.onDisconnected?.(error);
        scheduleReconnect();
        return;
    }

    socket.onopen = () => {
        reconnectAttempt = 0;
        const myId = getMyId();
        if (myId) {
            const presenceInfo = buildLocalPresenceInfo();
            sendSignaling({ type: "register", peerId: myId, info: presenceInfo });
            callbacks.onDiscovering?.();
            sendSignaling({ type: "discover" });
        }
        callbacks.onConnected?.();
        if (CONFIG.SIGNALING_BACKEND === "aws-apigateway") {
            clearInterval(heartbeatTimer);
            heartbeatTimer = setInterval(() => sendSignaling({ type: "heartbeat" }), HEARTBEAT_INTERVAL_MS);
        }
    };

    socket.onmessage = async (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch {
            console.warn("Ignoring malformed signaling response");
            return;
        }
        const myId = getMyId();
        if (data.type === "peer-list") {
            if (!Array.isArray(data.peers)) return;
            const snapshotPeerIds = new Set();
            data.peers.slice(0, CONFIG.MAX_PEERS).forEach((peer) => {
                if (peer?.peerId && peer.peerId !== myId) {
                    const meta = parsePeerMetadata(peer.info);
                    const statePeer = getOrCreatePeer(peer.peerId);
                    if (meta.displayName) statePeer.displayName = meta.displayName;
                    discoveredPeers.set(peer.peerId, { ...peer, displayName: meta.displayName });
                    snapshotPeerIds.add(peer.peerId);
                }
            });
            // A delayed snapshot must not hide an already-open DataChannel.
            discoveredPeers.forEach((_, peerId) => {
                const isConnected = peers.get(peerId)?.dataChannel?.readyState === "open";
                if (!snapshotPeerIds.has(peerId) && !isConnected) discoveredPeers.delete(peerId);
            });
            callbacks.onPeerListUpdate?.();
            callbacks.onDiscoveryComplete?.();
            return;
        }
        if (data.type === "peer-joined" && data.peerId !== myId) {
            const meta = parsePeerMetadata(data.info);
            const statePeer = getOrCreatePeer(data.peerId);
            if (meta.displayName) statePeer.displayName = meta.displayName;
            discoveredPeers.set(data.peerId, { peerId: data.peerId, info: data.info, displayName: meta.displayName });
            callbacks.onPeerListUpdate?.();
            return;
        }
        if (data.type === "peer-left") return cleanupPeer(data.peerId, "Peer disconnected", callbacks.onPeerListUpdate);
        if (data.type === "error") return console.warn("Signaling server notice:", data.message);

        try {
            if (data.type === "offer") {
                console.log(`[OFFER_RECEIVED] Received WebRTC offer from peer ${data.from}`);
                const peer = getOrCreatePeer(data.from);

                // Deterministic Glare / Simultaneous Offer Handling
                if (peer.connection && peer.connection.signalingState !== "stable") {
                    const isPolite = myId ? myId > data.from : true;
                    if (!isPolite) {
                        console.log(`[GLARE_TIE_BREAKER] Local offer has precedence over incoming offer from peer ${data.from}. Ignoring incoming offer.`);
                        return;
                    }
                    console.log(`[GLARE_TIE_BREAKER] Polite peer accepting incoming offer from peer ${data.from}. Replacing local offer connection.`);
                }

                const pc = createPeerConnection(data.from, sendSignaling, callbacks.onPeerListUpdate, true);
                const sdp = typeof RTCSessionDescription !== "undefined" ? new RTCSessionDescription(data.offer) : data.offer;
                await pc.setRemoteDescription(sdp);
                await flushQueuedIceCandidates(data.from);
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                console.log(`[ANSWER_SENT] Sent WebRTC answer to peer ${data.from}`);
                sendSignaling({ type: "answer", target: data.from, answer: pc.localDescription });
            } else if (data.type === "answer") {
                console.log(`[ANSWER_RECEIVED] Received WebRTC answer from peer ${data.from}`);
                const peer = peers.get(data.from);
                if (peer?.connection && peer.connection.signalingState === "have-local-offer") {
                    const sdp = typeof RTCSessionDescription !== "undefined" ? new RTCSessionDescription(data.answer) : data.answer;
                    await peer.connection.setRemoteDescription(sdp);
                    await flushQueuedIceCandidates(data.from);
                } else {
                    console.log(`[ANSWER_SKIPPED] Unexpected answer from peer ${data.from} [signalingState: ${peer?.connection?.signalingState}]`);
                }
            } else if (data.type === "candidate" && data.candidate) {
                console.log(`[ICE_RECEIVED] Received ICE candidate from peer ${data.from}`);
                await addOrQueueIceCandidate(data.from, data.candidate);
            }
        } catch (error) {
            console.error(`Failed to process ${data.type} signaling message from ${data.from}:`, error);
        }
    };
    socket.onerror = () => console.warn("Signaling socket error; waiting to reconnect.");
    socket.onclose = () => {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        socket = null;
        callbacks.onDisconnected?.();
        scheduleReconnect();
    };
}

export function initSignaling(nextCallbacks = {}) {
    callbacks = nextCallbacks;
    intentionallyClosed = false;
    connect();
    return socket;
}

export function sendSignaling(message) {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    // API Gateway uses `type` for route selection. Keep the browser-facing
    // offer/answer/candidate format intact while enclosing it in its one
    // serverless `signal` route.
    const outgoing = CONFIG.SIGNALING_BACKEND === "aws-apigateway" && ["offer", "answer", "candidate", "heartbeat"].includes(message.type)
        ? { type: "signal", target: message.target, signal: message.type === "heartbeat" ? { type: "heartbeat" } : message }
        : message;
    socket.send(JSON.stringify(outgoing));
    return true;
}

export function disconnectSignaling() {
    intentionallyClosed = true;
    clearTimeout(reconnectTimer);
    clearInterval(heartbeatTimer);
    reconnectTimer = null;
    socket?.close();
    socket = null;
}
