import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:p2p_mobile/packet_protocol.dart';

void main() {
  group('PacketProtocol', () {
    test('create and serialize valid packet', () {
      final pkt = Packet(
        type: 'test-message',
        id: 'id-456',
        timestamp: 1000,
        payload: {'message': 'hello from flutter'},
      );

      expect(pkt.version, 1);
      expect(pkt.type, 'test-message');
      expect(pkt.id, 'id-456');
      expect(pkt.timestamp, 1000);
      expect(pkt.payload, {'message': 'hello from flutter'});

      final jsonStr = pkt.toJson();
      final result = PacketProtocol.parseAndValidate(jsonStr);

      expect(result.isValid, isTrue);
      expect(result.packet!.type, 'test-message');
      expect(result.packet!.id, 'id-456');
      expect(result.packet!.payload['message'], 'hello from flutter');
    });

    test('validate missing or invalid fields', () {
      expect(PacketProtocol.parseAndValidate('').isValid, isFalse);
      expect(PacketProtocol.parseAndValidate('invalid json').isValid, isFalse);
      expect(
        PacketProtocol.parseAndValidate(jsonEncode({
          'version': 2,
          'type': 'test',
          'id': 'id',
          'timestamp': 100,
          'payload': {},
        })).isValid,
        isFalse,
      );
      expect(
        PacketProtocol.parseAndValidate(jsonEncode({
          'version': 1,
          'type': '',
          'id': 'id',
          'timestamp': 100,
          'payload': {},
        })).isValid,
        isFalse,
      );
      expect(
        PacketProtocol.parseAndValidate(jsonEncode({
          'version': 1,
          'type': 'test',
          'id': '',
          'timestamp': 100,
          'payload': {},
        })).isValid,
        isFalse,
      );
      expect(
        PacketProtocol.parseAndValidate(jsonEncode({
          'version': 1,
          'type': 'test',
          'id': 'id',
          'timestamp': -5,
          'payload': {},
        })).isValid,
        isFalse,
      );
      expect(
        PacketProtocol.parseAndValidate(jsonEncode({
          'version': 1,
          'type': 'test',
          'id': 'id',
          'timestamp': 100,
          'payload': null,
        })).isValid,
        isFalse,
      );
    });

    test('factory constructors for ping and pong', () {
      final ping = Packet.ping('ping-1');
      expect(ping.type, 'ping');
      expect(ping.id, 'ping-1');

      final pong = Packet.pong(replyToId: ping.id, id: 'pong-1');
      expect(pong.type, 'pong');
      expect(pong.id, 'pong-1');
      expect(pong.payload['replyTo'], 'ping-1');
    });
  });
}
