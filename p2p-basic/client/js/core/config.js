/* Deployment configuration is loaded from /runtime-config.js before this
 * module. That file is separate from application code so a deploy can replace
 * it without rebuilding the client. window.ENV remains supported for existing
 * deployments. */
const runtimeConfig = (typeof window !== "undefined" && (window.P2P_CONFIG || window.ENV)) || {};

const DEFAULT_STUN_SERVER = Object.freeze({ urls: "stun:stun.l.google.com:19302" });

export function validateAndFilterIceServers(rawServers) {
    if (!Array.isArray(rawServers) || rawServers.length === 0) {
        return [DEFAULT_STUN_SERVER];
    }

    const validServers = [];

    for (const server of rawServers) {
        if (!server || typeof server !== "object") continue;

        const urls = Array.isArray(server.urls)
            ? server.urls.filter((u) => typeof u === "string" && u.trim().length > 0)
            : (typeof server.urls === "string" && server.urls.trim().length > 0 ? [server.urls.trim()] : []);

        if (urls.length === 0) continue;

        const hasTurnUrl = urls.some((u) => u.startsWith("turn:") || u.startsWith("turns:"));

        if (hasTurnUrl) {
            const username = typeof server.username === "string" ? server.username.trim() : "";
            const credential = typeof server.credential === "string" ? server.credential.trim() : "";

            if (!username || !credential) {
                console.warn("[ICE_CONFIG] Ignoring incomplete TURN server configuration (missing username or credential)");
                continue;
            }

            validServers.push({
                urls: urls.length === 1 ? urls[0] : urls,
                username: username,
                credential: credential
            });
        } else {
            validServers.push({
                urls: urls.length === 1 ? urls[0] : urls
            });
        }
    }

    if (validServers.length === 0) {
        return [DEFAULT_STUN_SERVER];
    }

    return validServers;
}

export function configuredIceServers() {
    return validateAndFilterIceServers(runtimeConfig.ICE_SERVERS);
}

function resolveSignalingUrl() {
    if (runtimeConfig.SIGNALING_URL) {
        const url = new URL(runtimeConfig.SIGNALING_URL, window.location.href);
        if (window.location.protocol === "https:" && url.protocol !== "wss:") {
            throw new Error("An HTTPS page requires a wss:// signaling URL.");
        }
        if (!["ws:", "wss:"].includes(url.protocol)) {
            throw new Error("SIGNALING_URL must use ws:// or wss://.");
        }
        return url.toString();
    }

    if (typeof window !== "undefined" && window.location?.hostname) {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const port = runtimeConfig.SIGNALING_PORT || "3000";
        return `${protocol}//${window.location.hostname}:${port}`;
    }

    throw new Error("No browser location or SIGNALING_URL is available.");
}

export const CONFIG = Object.freeze({
    get SIGNALING_URL() {
        return resolveSignalingUrl();
    },
    MAX_PEERS: 4,
    SIGNALING_BACKEND: runtimeConfig.SIGNALING_BACKEND || "node",
    CHUNK_SIZE: 256 * 1024,
    BUFFERED_AMOUNT_LOW_THRESHOLD: 4 * 1024 * 1024,
    get iceServers() {
        return configuredIceServers();
    }
});
