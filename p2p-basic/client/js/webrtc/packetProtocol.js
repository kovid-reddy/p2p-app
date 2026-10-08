/**
 * Transport-Independent Packet Protocol (Stage 6)
 *
 * Common JSON Envelope:
 * {
 *   "version": 1,
 *   "type": string,
 *   "id": string,
 *   "timestamp": number,
 *   "payload": object
 * }
 */

export const PACKET_VERSION = 1;

export function generatePacketId(prefix = "pkt") {
    const ts = Date.now();
    const rand = Math.random().toString(36).substring(2, 9);
    return `${prefix}_${ts}_${rand}`;
}

export function createPacket(type, payload = {}, id = null, timestamp = null) {
    if (!type || typeof type !== "string" || type.trim() === "") {
        throw new Error("Packet type must be a non-empty string");
    }
    return {
        version: PACKET_VERSION,
        type: type.trim(),
        id: id && typeof id === "string" ? id : generatePacketId(),
        timestamp: typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now(),
        payload: payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}
    };
}

export function serializePacket(packet) {
    const validation = validatePacket(packet);
    if (!validation.valid) {
        throw new Error(`Cannot serialize invalid packet: ${validation.error}`);
    }
    return JSON.stringify(packet);
}

export function validatePacket(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        return { valid: false, error: "Packet must be a non-null object" };
    }

    if (data.version !== PACKET_VERSION) {
        return { valid: false, error: `Unsupported packet version: ${data.version} (expected ${PACKET_VERSION})` };
    }

    if (typeof data.type !== "string" || data.type.trim() === "") {
        return { valid: false, error: "Packet type must be a non-empty string" };
    }

    if (typeof data.id !== "string" || data.id.trim() === "") {
        return { valid: false, error: "Packet id must be a non-empty string" };
    }

    if (typeof data.timestamp !== "number" || !Number.isFinite(data.timestamp) || data.timestamp <= 0) {
        return { valid: false, error: "Packet timestamp must be a positive finite number" };
    }

    if (!data.payload || typeof data.payload !== "object" || Array.isArray(data.payload)) {
        return { valid: false, error: "Packet payload must be an object" };
    }

    return { valid: true, packet: data };
}

export function parseAndValidatePacket(rawString) {
    if (typeof rawString !== "string") {
        return { valid: false, error: "Raw packet input must be a string" };
    }

    let parsed;
    try {
        parsed = JSON.parse(rawString);
    } catch (err) {
        return { valid: false, error: `JSON parse error: ${err.message}` };
    }

    return validatePacket(parsed);
}

export function createPingPacket() {
    return createPacket("ping", {}, generatePacketId("ping"));
}

export function createPongPacket(pingId = null) {
    return createPacket("pong", pingId ? { replyTo: pingId } : {}, generatePacketId("pong"));
}

export function createTestMessagePacket(messageText = "Hello from browser") {
    return createPacket("test-message", { message: messageText }, generatePacketId("test"));
}
