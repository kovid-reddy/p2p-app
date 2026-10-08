import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:pointycastle/export.dart';

class IdentityService {
  static final IdentityService _instance = IdentityService._internal();
  factory IdentityService() => _instance;
  IdentityService._internal();

  AsymmetricKeyPair<PublicKey, PrivateKey>? _keyPair;
  String? _publicKeyString;
  String? _peerId;

  String? get peerId => _peerId;
  String? get publicKeyString => _publicKeyString;
  AsymmetricKeyPair<PublicKey, PrivateKey>? get keyPair => _keyPair;

  Future<Map<String, String>> generateIdentity() async {
    if (_peerId != null && _publicKeyString != null && _keyPair != null) {
      return {
        'publicKeyString': _publicKeyString!,
        'peerId': _peerId!,
      };
    }

    final domainParams = ECCurve_prime256v1();
    final secureRandom = _getSecureRandom();
    final keyParams = ECKeyGeneratorParameters(domainParams);
    final generator = ECKeyGenerator()
      ..init(ParametersWithRandom(keyParams, secureRandom));

    final pair = generator.generateKeyPair();
    _keyPair = pair;

    final pubKey = pair.publicKey as ECPublicKey;
    final q = pubKey.Q!;

    final xBytes = _bigIntToBytes(q.x!.toBigInteger()!, 32);
    final yBytes = _bigIntToBytes(q.y!.toBigInteger()!, 32);

    // Standard ASN.1 SPKI header for ECDSA P-256 (prime256v1)
    final spkiHeader = Uint8List.fromList([
      0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce,
      0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d,
      0x03, 0x01, 0x07, 0x03, 0x42, 0x00, 0x04
    ]);

    final spkiBytes = Uint8List(spkiHeader.length + 64);
    spkiBytes.setRange(0, spkiHeader.length, spkiHeader);
    spkiBytes.setRange(spkiHeader.length, spkiHeader.length + 32, xBytes);
    spkiBytes.setRange(spkiHeader.length + 32, spkiHeader.length + 64, yBytes);

    _publicKeyString = base64Encode(spkiBytes);

    final bytesToHash = utf8.encode(_publicKeyString!);
    final digest = sha256.convert(bytesToHash);
    _peerId = digest.toString();

    return {
      'publicKeyString': _publicKeyString!,
      'peerId': _peerId!,
    };
  }

  SecureRandom _getSecureRandom() {
    final secureRandom = FortunaRandom();
    final random = Random.secure();
    final seeds = Uint8List(32);
    for (var i = 0; i < 32; i++) {
      seeds[i] = random.nextInt(256);
    }
    secureRandom.seed(KeyParameter(seeds));
    return secureRandom;
  }

  Uint8List _bigIntToBytes(BigInt number, int length) {
    var rawBytes = number.toUnsigned(length * 8).toRadixString(16).padLeft(length * 2, '0');
    final bytes = Uint8List(length);
    for (var i = 0; i < length; i++) {
      bytes[i] = int.parse(rawBytes.substring(i * 2, i * 2 + 2), radix: 16);
    }
    return bytes;
  }
}
