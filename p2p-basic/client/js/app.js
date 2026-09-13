import { generateIdentity, getMyId, getLocalDisplayName, setLocalDisplayName, formatPeerDisplayName } from "./core/identity.js";
import { getActivePeerId, setActivePeerId, getPeer } from "./core/state.js";
import { initSignaling, sendSignaling } from "./signaling/signaling.js";
import { transportManager } from "./transport/transportManager.js";
import { sendChatMessage } from "./chat/sendMessage.js";
import { initiateSendFile, cancelActiveTransfer } from "./transfer/sendFile.js";
import { acceptIncomingFile, rejectIncomingFile } from "./transfer/receiveFile.js";
import { renderPeerList } from "./ui/peerListUI.js";
import { refreshTransferView, updateStatus } from "./ui/transferUI.js";
import { getChatMessageInput, renderConversation, updateComposerState } from "./ui/chatUI.js";
import { runCryptoTests } from "./tests/cryptoTests.js";

let statsIntervalTimer = null;

// ─── Peer List ────────────────────────────────────────────────────────────────

function refreshPeerList() {
    renderPeerList(handlePeerClick);
}

function handlePeerClick(peerId) {
    const prevActive = getActivePeerId();
    setActivePeerId(peerId);

    // Reset unread count for selected peer
    const peer = getPeer(peerId);
    if (peer && peer.chat) {
        peer.chat.unreadCount = 0;
    }

    // Initiate connection via TransportManager if not yet established
    if (!peer || !peer.connection || peer.connection.connectionState === "closed" || peer.connection.connectionState === "failed") {
        transportManager.connect(peerId, {
            sendSignaling,
            onPeerListUpdate: () => {
                refreshPeerList();
                updateActivePeerHeader(peerId);
                updateComposerState(peerId);
            }
        });
    }

    // Update active peer header
    updateActivePeerHeader(peerId);
    // Re-render chat conversation for newly selected peer
    renderConversation(peerId);
    // Update composer enabled/disabled state
    updateComposerState(peerId);
    // Refresh transfer tray for new peer
    refreshTransferView(peerId);

    refreshPeerList();

    // Close mobile sidebar drawer if open
    closeMobileDrawer();
}

// ─── Active Peer Header ────────────────────────────────────────────────────────

async function updateActivePeerHeader(peerId) {
    const titleEl = document.getElementById("activePeerTitle");
    const dotEl = document.getElementById("activePeerDot");
    const avatarSpan = document.getElementById("activePeerInitial");
    const transportBadge = document.getElementById("activeTransportBadge");
    const transportName = document.getElementById("activeTransportName");
    const connStatsPill = document.getElementById("activeConnStats");
    const securityDetailsBox = document.getElementById("peerSecurityDetails");
    const fullIdSpan = document.getElementById("activePeerFullId");
    const verifiedBadge = document.getElementById("activePeerVerifiedBadge");

    if (!peerId) {
        if (titleEl) titleEl.innerText = "No peer selected";
        if (dotEl) dotEl.className = "status-dot dot-offline";
        if (avatarSpan) avatarSpan.innerText = "?";
        if (transportBadge) transportBadge.style.display = "none";
        if (connStatsPill) connStatsPill.style.display = "none";
        if (securityDetailsBox) securityDetailsBox.style.display = "none";
        updateStatus("Not connected");
        return;
    }

    const peer = getPeer(peerId);
    const displayName = formatPeerDisplayName(peerId, peer?.displayName);

    if (titleEl) titleEl.innerText = displayName;
    if (avatarSpan) avatarSpan.innerText = displayName.slice(0, 2).toUpperCase();

    // Active Transport Badge
    const activeTransport = peer?.activeTransport || "webrtc";
    if (transportBadge && transportName) {
        transportBadge.style.display = "inline-flex";
        transportName.innerText = activeTransport.toUpperCase();
    }

    // Peer Security & Identity Verification Details
    if (securityDetailsBox) {
        securityDetailsBox.style.display = "block";
        if (fullIdSpan) fullIdSpan.innerText = `Peer ID: ${peerId}`;
        const isVerified = Boolean(peer?.crypto?.handshakeComplete && peer?.crypto?.sessionKey);
        if (verifiedBadge) {
            verifiedBadge.innerText = isVerified ? "Verified: Yes" : "Verified: No";
            verifiedBadge.className = `security-verified-badge ${isVerified ? "verified-yes" : "verified-no"}`;
        }
    }

    // Network State & Status
    if (peer && peer.dataChannel && peer.dataChannel.readyState === "open") {
        if (dotEl) dotEl.className = "status-dot dot-online";
        updateStatus("Connected");
    } else if (peer?.networkState === "failed") {
        if (dotEl) dotEl.className = "status-dot dot-offline";
        updateStatus("Connection failed — select peer to retry");
    } else if (peer?.networkState === "disconnected") {
        if (dotEl) dotEl.className = "status-dot dot-offline";
        updateStatus("Peer disconnected");
    } else if (peer && peer.connection &&
        (peer.connection.connectionState === "connecting" ||
            peer.connection.iceConnectionState === "checking")) {
        if (dotEl) dotEl.className = "status-dot dot-connecting";
        updateStatus("Connecting...");
    } else {
        if (dotEl) dotEl.className = "status-dot dot-offline";
        updateStatus("Discovered — click to connect");
    }

    // Connection Statistics (Latency / Throughput)
    if (connStatsPill) {
        const stats = await transportManager.getStats(peerId);
        if (stats && stats.state === "connected") {
            const parts = [];
            if (stats.latencyMs !== null) parts.push(`${stats.latencyMs} ms`);
            if (stats.throughputMbps !== null) parts.push(`${stats.throughputMbps} Mbps`);
            if (parts.length > 0) {
                connStatsPill.style.display = "inline-block";
                connStatsPill.innerText = parts.join(" · ");
            } else {
                connStatsPill.style.display = "inline-block";
                connStatsPill.innerText = "Connected";
            }
        } else {
            connStatsPill.style.display = "none";
        }
    }
}

// ─── Signaling Status ─────────────────────────────────────────────────────────

function setSignalingStatus(status) {
    const dot = document.getElementById("signalingDot");
    const text = document.getElementById("signalingStatusText");

    if (dot) {
        dot.className = "status-dot";
        if (status === "connected") {
            dot.classList.add("dot-online");
        } else if (status === "connecting") {
            dot.classList.add("dot-connecting");
        } else {
            dot.classList.add("dot-offline");
        }
    }

    if (text) {
        const labels = {
            connected: "Signaling: Connected",
            discovering: "Signaling: Discovering peers...",
            reconnecting: "Signaling: Reconnecting...",
            connecting: "Signaling: Connecting...",
            disconnected: "Signaling: Disconnected"
        };
        text.innerText = labels[status] || "Signaling: Unknown";
    }
}

// ─── Local Identity Display ───────────────────────────────────────────────────

function displayLocalPeerId(peerId) {
    const displayEl = document.getElementById("localPeerIdDisplay");
    if (displayEl) {
        const short = `${peerId.slice(0, 6)}…${peerId.slice(-4)}`;
        displayEl.innerText = short;
        displayEl.setAttribute("title", peerId);
    }
}

// ─── Copy Peer ID ─────────────────────────────────────────────────────────────

function setupCopyButton(fullPeerId) {
    const btn = document.getElementById("copyIdBtn");
    const tooltip = document.getElementById("copyTooltip");
    if (!btn) return;

    btn.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(fullPeerId);
            if (tooltip) {
                tooltip.innerText = "Copied!";
                setTimeout(() => { tooltip.innerText = "Copy"; }, 1800);
            }
        } catch {
            // Fallback for older browsers
            const temp = document.createElement("textarea");
            temp.value = fullPeerId;
            document.body.appendChild(temp);
            temp.select();
            document.execCommand("copy");
            document.body.removeChild(temp);
            if (tooltip) {
                tooltip.innerText = "Copied!";
                setTimeout(() => { tooltip.innerText = "Copy"; }, 1800);
            }
        }
    });
}

// ─── Mobile Drawer ────────────────────────────────────────────────────────────

function closeMobileDrawer() {
    const sidebar = document.getElementById("peersSidebar");
    const backdrop = document.getElementById("drawerBackdrop");
    if (sidebar) sidebar.classList.remove("drawer-open");
    if (backdrop) backdrop.classList.remove("active");
}

function setupMobileDrawer() {
    const menuBtn = document.getElementById("mobileMenuBtn");
    const backdrop = document.getElementById("drawerBackdrop");
    const sidebar = document.getElementById("peersSidebar");

    if (menuBtn && sidebar && backdrop) {
        menuBtn.addEventListener("click", () => {
            const isOpen = sidebar.classList.contains("drawer-open");
            if (isOpen) {
                closeMobileDrawer();
            } else {
                sidebar.classList.add("drawer-open");
                backdrop.classList.add("active");
            }
        });

        backdrop.addEventListener("click", closeMobileDrawer);
    }
}

// ─── File Attach Button ───────────────────────────────────────────────────────

function setupAttachButton() {
    const attachBtn = document.getElementById("attachFileBtn");
    const fileInput = document.getElementById("fileInput");

    if (attachBtn && fileInput) {
        attachBtn.addEventListener("click", () => {
            fileInput.click();
        });

        fileInput.addEventListener("change", () => {
            const file = fileInput.files[0];
            if (file) {
                initiateSendFile(getActivePeerId(), file);
                // Reset input so same file can be selected again
                fileInput.value = "";
            }
        });
    }
}

// ─── Drag & Drop ──────────────────────────────────────────────────────────────

function setupDragAndDrop() {
    const panel = document.getElementById("conversationPanel");
    const overlay = document.getElementById("dragDropOverlay");

    if (!panel || !overlay) return;

    let dragCounter = 0;

    panel.addEventListener("dragenter", (e) => {
        e.preventDefault();
        dragCounter++;
        if (dragCounter === 1) {
            overlay.classList.add("active");
        }
    });

    panel.addEventListener("dragleave", () => {
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            overlay.classList.remove("active");
        }
    });

    panel.addEventListener("dragover", (e) => {
        e.preventDefault();
    });

    panel.addEventListener("drop", (e) => {
        e.preventDefault();
        dragCounter = 0;
        overlay.classList.remove("active");

        const activePeerId = getActivePeerId();
        if (!activePeerId) {
            alert("Select a peer first to send a file.");
            return;
        }

        const file = e.dataTransfer.files[0];
        if (file) {
            initiateSendFile(activePeerId, file);
        }
    });
}

// ─── Accept / Reject file buttons ────────────────────────────────────────────

function setupTransferButtons() {
    const acceptBtn = document.getElementById("acceptFileBtn");
    const rejectBtn = document.getElementById("rejectFileBtn");
    const cancelBtn = document.getElementById("cancelBtn");

    if (acceptBtn) acceptBtn.addEventListener("click", () => acceptIncomingFile(getActivePeerId()));
    if (rejectBtn) rejectBtn.addEventListener("click", () => rejectIncomingFile(getActivePeerId()));
    if (cancelBtn) cancelBtn.addEventListener("click", () => cancelActiveTransfer(getActivePeerId()));
}

// ─── Message Composer ────────────────────────────────────────────────────────

function setupComposer() {
    const msgInput = document.getElementById("message");
    const sendBtn = document.getElementById("sendMessageBtn");

    if (msgInput) {
        msgInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // Auto-resize textarea
        msgInput.addEventListener("input", () => {
            msgInput.style.height = "42px";
            const scrollHeight = msgInput.scrollHeight;
            if (scrollHeight > 42) {
                msgInput.style.height = Math.min(scrollHeight, 120) + "px";
            }
        });
    }

    if (sendBtn) {
        sendBtn.addEventListener("click", () => sendMessage());
    }
}

// ─── User action: send message ────────────────────────────────────────────────

export async function sendMessage() {
    const text = getChatMessageInput();
    if (!text) return;
    await sendChatMessage(getActivePeerId(), text);
}

export function sendFile() {
    const fileInput = document.getElementById("fileInput");
    const file = fileInput ? fileInput.files[0] : null;
    initiateSendFile(getActivePeerId(), file);
}

export function cancelTransfer() {
    cancelActiveTransfer(getActivePeerId());
}

export function acceptFile() {
    acceptIncomingFile(getActivePeerId());
}

export function rejectFile() {
    rejectIncomingFile(getActivePeerId());
}

// Expose for any remaining HTML onclick attributes
if (typeof window !== "undefined") {
    window.sendMessage = sendMessage;
    window.sendFile = sendFile;
    window.cancelTransfer = cancelTransfer;
    window.acceptFile = acceptFile;
    window.rejectFile = rejectFile;
    window.runCryptoTests = runCryptoTests;
}

function setupDisplayNameEditor() {
    const input = document.getElementById("localDisplayNameInput");
    if (!input) return;
    input.value = getLocalDisplayName();
    const handleNameChange = () => {
        const newName = setLocalDisplayName(input.value);
        refreshPeerList();
        const myId = getMyId();
        if (myId) {
            const presenceInfo = JSON.stringify({ t: "webrtc", name: newName });
            sendSignaling({ type: "register", peerId: myId, info: presenceInfo });
        }
    };
    input.addEventListener("input", handleNameChange);
    input.addEventListener("change", handleNameChange);
}

function startPeriodicStats() {
    if (statsIntervalTimer) clearInterval(statsIntervalTimer);
    statsIntervalTimer = setInterval(() => {
        const activePeerId = getActivePeerId();
        if (activePeerId) {
            updateActivePeerHeader(activePeerId);
        }
    }, 2000);
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function bootstrap() {
    // Generate ECDSA identity
    await generateIdentity();

    const myId = getMyId();
    if (myId) {
        displayLocalPeerId(myId);
        setupCopyButton(myId);
    }

    // Initial UI state
    setupDisplayNameEditor();
    updateComposerState(null);
    renderConversation(null);
    updateActivePeerHeader(null);
    setSignalingStatus("connecting");

    // Setup all interactive UI
    setupMobileDrawer();
    setupAttachButton();
    setupDragAndDrop();
    setupComposer();
    setupTransferButtons();
    startPeriodicStats();

    // Start signaling
    initSignaling({
        onConnected: () => {
            setSignalingStatus("connected");
            refreshPeerList();
        },
        onConnecting: () => setSignalingStatus("connecting"),
        onDiscovering: () => setSignalingStatus("discovering"),
        onDiscoveryComplete: () => setSignalingStatus("connected"),
        onReconnecting: () => setSignalingStatus("reconnecting"),
        onDisconnected: () => {
            setSignalingStatus("disconnected");
        },
        onPeerListUpdate: () => {
            refreshPeerList();
            // A data-channel open may have selected an incoming peer. Refresh
            // every active-peer view from state, without stealing focus from
            // an already selected conversation.
            const activePeerId = getActivePeerId();
            if (activePeerId) {
                updateActivePeerHeader(activePeerId);
                renderConversation(activePeerId);
                updateComposerState(activePeerId);
                refreshTransferView(activePeerId);
            }
        }
    });

    refreshPeerList();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
} else {
    bootstrap();
}
