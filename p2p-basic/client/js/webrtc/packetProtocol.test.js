import test from "node:test";
import assert from "node:assert/strict";
import {
    PACKET_VERSION,
    generatePacketId,
    createPacket,
    serializePacket,
    validatePacket,
    parseAndValidatePacket,
    createPingPacket,
    createPongPacket,
    createTestMessagePacket
} from "./packetProtocol.js";

test("Packet Protocol: create and serialize valid packet", () => {
    const pkt = createPacket("test-message", { message: "hello" }, "id-123", 1000);
    assert.equal(pkt.version, 1);
    assert.equal(pkt.type, "test-message");
    assert.equal(pkt.id, "id-123");
    assert.equal(pkt.timestamp, 1000);
    assert.deepEqual(pkt.payload, { message: "hello" });

    const serialized = serializePacket(pkt);
    const parsedRes = parseAndValidatePacket(serialized);
    assert.equal(parsedRes.valid, true);
    assert.deepEqual(parsedRes.packet, pkt);
});

test("Packet Protocol: validate packet fields", () => {
    assert.equal(validatePacket(null).valid, false);
    assert.equal(validatePacket([]).valid, false);
    assert.equal(validatePacket({ version: 2, type: "t", id: "i", timestamp: 1, payload: {} }).valid, false);
    assert.equal(validatePacket({ version: 1, type: "", id: "i", timestamp: 1, payload: {} }).valid, false);
    assert.equal(validatePacket({ version: 1, type: "t", id: "", timestamp: 1, payload: {} }).valid, false);
    assert.equal(validatePacket({ version: 1, type: "t", id: "i", timestamp: 0, payload: {} }).valid, false);
    assert.equal(validatePacket({ version: 1, type: "t", id: "i", timestamp: 1, payload: null }).valid, false);
});

test("Packet Protocol: reject malformed JSON", () => {
    const res = parseAndValidatePacket("{ invalid json ");
    assert.equal(res.valid, false);
    assert.match(res.error, /JSON parse error/);
});

test("Packet Protocol: helper functions createPingPacket & createPongPacket", () => {
    const ping = createPingPacket();
    assert.equal(ping.type, "ping");
    assert.equal(ping.version, 1);

    const pong = createPongPacket(ping.id);
    assert.equal(pong.type, "pong");
    assert.equal(pong.payload.replyTo, ping.id);
});
