import 'dart:convert';
import 'dart:math';

class Packet {
  static const int currentVersion = 1;

  final int version;
  final String type;
  final String id;
  final int timestamp;
  final Map<String, dynamic> payload;

  Packet({
    this.version = currentVersion,
    required this.type,
    String? id,
    int? timestamp,
    Map<String, dynamic>? payload,
  })  : id = (id != null && id.trim().isNotEmpty) ? id.trim() : generateId(),
        timestamp = (timestamp != null && timestamp > 0)
            ? timestamp
            : DateTime.now().millisecondsSinceEpoch,
        payload = payload ?? {};

  static String generateId([String prefix = 'pkt']) {
    final ts = DateTime.now().millisecondsSinceEpoch;
    final rand = Random().nextInt(0xFFFFFF).toRadixString(36);
    return '${prefix}_${ts}_$rand';
  }

  Map<String, dynamic> toMap() {
    return {
      'version': version,
      'type': type,
      'id': id,
      'timestamp': timestamp,
      'payload': payload,
    };
  }

  String toJson() => jsonEncode(toMap());

  factory Packet.ping([String? id]) {
    return Packet(
      type: 'ping',
      id: id ?? generateId('ping'),
      payload: {},
    );
  }

  factory Packet.pong({String? replyToId, String? id}) {
    return Packet(
      type: 'pong',
      id: id ?? generateId('pong'),
      payload: replyToId != null ? {'replyTo': replyToId} : {},
    );
  }

  factory Packet.testMessage({
    String message = 'Hello from mobile',
    String? id,
  }) {
    return Packet(
      type: 'test-message',
      id: id ?? generateId('test'),
      payload: {'message': message},
    );
  }
}

class PacketValidationResult {
  final bool isValid;
  final Packet? packet;
  final String? error;

  PacketValidationResult.valid(this.packet)
      : isValid = true,
        error = null;

  PacketValidationResult.invalid(this.error)
      : isValid = false,
        packet = null;
}

class PacketProtocol {
  static PacketValidationResult parseAndValidate(String rawString) {
    if (rawString.trim().isEmpty) {
      return PacketValidationResult.invalid('Raw packet string is empty');
    }

    dynamic parsed;
    try {
      parsed = jsonDecode(rawString);
    } catch (e) {
      return PacketValidationResult.invalid('JSON parse error: $e');
    }

    return validateMap(parsed);
  }

  static PacketValidationResult validateMap(dynamic data) {
    if (data is! Map<String, dynamic>) {
      return PacketValidationResult.invalid('Packet root must be a JSON object');
    }

    final version = data['version'];
    if (version == null || version is! int || version != Packet.currentVersion) {
      return PacketValidationResult.invalid(
        'Unsupported packet version: $version (expected ${Packet.currentVersion})',
      );
    }

    final type = data['type'];
    if (type == null || type is! String || type.trim().isEmpty) {
      return PacketValidationResult.invalid('Packet type must be a non-empty string');
    }

    final id = data['id'];
    if (id == null || id is! String || id.trim().isEmpty) {
      return PacketValidationResult.invalid('Packet id must be a non-empty string');
    }

    final timestamp = data['timestamp'];
    if (timestamp == null || (timestamp is! int && timestamp is! num) || (timestamp as num) <= 0) {
      return PacketValidationResult.invalid('Packet timestamp must be a positive number');
    }

    final payload = data['payload'];
    if (payload == null || payload is! Map<String, dynamic>) {
      return PacketValidationResult.invalid('Packet payload must be a JSON object');
    }

    final packet = Packet(
      version: version,
      type: type.trim(),
      id: id.trim(),
      timestamp: timestamp.toInt(),
      payload: payload,
    );

    return PacketValidationResult.valid(packet);
  }
}
