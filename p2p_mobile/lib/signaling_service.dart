import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'identity_service.dart';
import 'webrtc_service.dart';

enum SignalingState {
  disconnected,
  connecting,
  connected,
  error,
}

class DiscoveredPeer {
  final String peerId;
  final String? displayName;
  final String transport;
  final String? rawInfo;

  DiscoveredPeer({
    required this.peerId,
    this.displayName,
    this.transport = 'webrtc',
    this.rawInfo,
  });

  factory DiscoveredPeer.fromMap(Map<String, dynamic> map) {
    final peerId = map['peerId'] as String? ?? '';
    final info = map['info'];
    String? name;
    String transport = 'webrtc';

    if (info is String) {
      if (info.startsWith('{')) {
        try {
          final parsed = jsonDecode(info) as Map<String, dynamic>;
          name = parsed['displayName'] as String? ?? parsed['name'] as String?;
          transport = parsed['transport'] as String? ?? parsed['t'] as String? ?? 'webrtc';
        } catch (_) {}
      } else if (info != 'webrtc') {
        name = info;
      }
    } else if (info is Map<String, dynamic>) {
      name = info['displayName'] as String? ?? info['name'] as String?;
      transport = info['transport'] as String? ?? info['t'] as String? ?? 'webrtc';
    }

    return DiscoveredPeer(
      peerId: peerId,
      displayName: name,
      transport: transport,
      rawInfo: info is String ? info : jsonEncode(info),
    );
  }

  String get formattedName {
    if (displayName != null && displayName!.trim().isNotEmpty) {
      return displayName!.trim();
    }
    if (peerId.length >= 8) {
      return 'Peer ${peerId.substring(0, 6)}';
    }
    return 'Anonymous Peer';
  }
}

class SignalingService extends ChangeNotifier {
  static final SignalingService _instance = SignalingService._internal();
  factory SignalingService() => _instance;

  SignalingService._internal() {
    WebRTCService().onSendSignal = sendSignal;
  }

  WebSocketChannel? _channel;
  StreamSubscription? _subscription;
  Timer? _heartbeatTimer;
  Timer? _reconnectTimer;

  SignalingState _state = SignalingState.disconnected;
  String? _errorMessage;
  String _serverUrl = '';
  String _displayName = 'Mobile Device';
  bool _intentionallyClosed = false;
  int _reconnectAttempt = 0;

  final Map<String, DiscoveredPeer> _discoveredPeers = {};

  SignalingState get state => _state;
  String? get errorMessage => _errorMessage;
  String get serverUrl => _serverUrl;
  String get displayName => _displayName;
  List<DiscoveredPeer> get discoveredPeers => _discoveredPeers.values.toList();
  String? get myPeerId => IdentityService().peerId;

  Uri parseWebSocketUri(String inputUrl) {
    final trimmed = inputUrl.trim();
    if (trimmed.isEmpty) {
      throw const FormatException('Signaling URL cannot be empty.');
    }

    final uri = Uri.parse(trimmed);
    if (uri.scheme != 'ws' && uri.scheme != 'wss') {
      throw const FormatException('Signaling URL must use ws:// or wss:// scheme.');
    }

    if (uri.host.isEmpty) {
      throw const FormatException('Signaling URL host cannot be empty.');
    }

    return uri;
  }

  Future<void> connect({required String url, required String displayName}) async {
    _intentionallyClosed = false;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;

    if (_state == SignalingState.connecting || _state == SignalingState.connected) {
      await disconnect(intentional: false);
    }

    _serverUrl = url.trim();
    _displayName = displayName.trim().isEmpty ? 'Mobile Device' : displayName.trim();
    _state = SignalingState.connecting;
    _errorMessage = null;
    notifyListeners();

    String stage = 'initializing';
    try {
      stage = 'parsing_url';
      final uri = parseWebSocketUri(_serverUrl);

      if (kDebugMode) {
        debugPrint('[Signaling Lifecycle] Connecting to WebSocket: $uri');
      }

      stage = 'generating_identity';
      final identity = await IdentityService().generateIdentity();
      final myId = identity['peerId']!;

      stage = 'handshake';
      _channel = WebSocketChannel.connect(uri);

      _subscription = _channel!.stream.listen(
        (message) {
          _handleMessage(message);
        },
        onError: (error) {
          debugPrint('[Signaling Error] WebSocket stream error: $error');
          _state = SignalingState.error;
          _errorMessage = _formatError(error, stage: 'socket_stream');
          _stopHeartbeat();
          notifyListeners();
          _scheduleReconnect();
        },
        onDone: () {
          debugPrint('[Signaling Lifecycle] WebSocket connection closed.');
          _state = SignalingState.disconnected;
          _stopHeartbeat();
          _discoveredPeers.clear();
          notifyListeners();
          if (!_intentionallyClosed) {
            _scheduleReconnect();
          }
        },
      );

      // Await WebSocket connection readiness
      await _channel!.ready;

      _reconnectAttempt = 0;
      stage = 'registering';
      _state = SignalingState.connected;

      final presenceInfo = jsonEncode({
        't': 'webrtc',
        'name': _displayName,
      });

      debugPrint('[Signaling Sent] Sending register for peerId: $myId');
      _sendRaw({
        'type': 'register',
        'peerId': myId,
        'info': presenceInfo,
      });

      debugPrint('[Signaling Sent] Sending discover request');
      _sendRaw({
        'type': 'discover',
      });

      _startHeartbeat();
      notifyListeners();
    } catch (e) {
      debugPrint('[Signaling Error] Connection failed at stage [$stage]: $e');
      _state = SignalingState.error;
      _errorMessage = _formatError(e, stage: stage);
      _stopHeartbeat();
      notifyListeners();
      if (!_intentionallyClosed) {
        _scheduleReconnect();
      }
    }
  }

  void _scheduleReconnect() {
    if (_intentionallyClosed || _reconnectTimer != null) return;

    final delaySeconds = min(pow(2, _reconnectAttempt).toInt(), 15);
    _reconnectAttempt++;
    debugPrint('[Signaling Reconnect] Scheduling auto-reconnect in ${delaySeconds}s (attempt $_reconnectAttempt)');

    _reconnectTimer = Timer(Duration(seconds: delaySeconds), () {
      _reconnectTimer = null;
      if (!_intentionallyClosed && _serverUrl.isNotEmpty) {
        connect(url: _serverUrl, displayName: _displayName);
      }
    });
  }

  Future<void> disconnect({bool intentional = true}) async {
    if (intentional) {
      _intentionallyClosed = true;
      _reconnectTimer?.cancel();
      _reconnectTimer = null;
    }
    _stopHeartbeat();
    await _subscription?.cancel();
    _subscription = null;
    await _channel?.sink.close();
    _channel = null;

    _discoveredPeers.clear();
    if (intentional) {
      WebRTCService().closeAll();
    }
    _state = SignalingState.disconnected;
    _errorMessage = null;
    notifyListeners();
  }

  void sendSignal(String targetId, Map<String, dynamic> signalPayload) {
    if (_state != SignalingState.connected) {
      debugPrint('[Signaling Skipped] Cannot send signal to $targetId: Signaling not connected');
      return;
    }
    debugPrint('[Signaling Sent] Relaying ${signalPayload['type']} to target: $targetId');
    _sendRaw({
      'type': 'signal',
      'target': targetId,
      'signal': signalPayload,
    });
  }

  void _sendRaw(Map<String, dynamic> data) {
    if (_channel != null && _state == SignalingState.connected) {
      _channel!.sink.add(jsonEncode(data));
    }
  }

  void _startHeartbeat() {
    _stopHeartbeat();
    _heartbeatTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_state == SignalingState.connected) {
        _sendRaw({
          'type': 'signal',
          'target': null,
          'signal': {'type': 'heartbeat'},
        });
      }
    });
  }

  void _stopHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
  }

  void _handleMessage(dynamic rawMessage) {
    try {
      final data = jsonDecode(rawMessage.toString()) as Map<String, dynamic>;
      final type = data['type'] as String?;
      final myId = IdentityService().peerId;

      if (type == 'peer-list') {
        final peersRaw = data['peers'] as List<dynamic>? ?? [];
        debugPrint('[Signaling Received] peer-list with ${peersRaw.length} peer(s)');
        _discoveredPeers.clear();
        for (final item in peersRaw) {
          if (item is Map<String, dynamic>) {
            final peer = DiscoveredPeer.fromMap(item);
            if (peer.peerId.isNotEmpty && peer.peerId != myId) {
              _discoveredPeers[peer.peerId] = peer;
            }
          }
        }
        notifyListeners();
      } else if (type == 'peer-joined') {
        final peer = DiscoveredPeer.fromMap(data);
        debugPrint('[Signaling Received] peer-joined: ${peer.peerId}');
        if (peer.peerId.isNotEmpty && peer.peerId != myId) {
          _discoveredPeers[peer.peerId] = peer;
          notifyListeners();
        }
      } else if (type == 'peer-left') {
        final peerId = data['peerId'] as String?;
        debugPrint('[Signaling Received] peer-left: $peerId');
        if (peerId != null) {
          _discoveredPeers.remove(peerId);
          WebRTCService().disconnectPeer(peerId);
          notifyListeners();
        }
      } else if (type == 'offer') {
        final fromId = data['from'] as String?;
        final offerMap = data['offer'] as Map<String, dynamic>?;
        final targetPeer = data['target'] as String?;
        debugPrint('[WEBRTC][SIGNAL] received offer from $fromId (target: $targetPeer, sdpType: ${offerMap?['type']})');
        if (fromId != null && offerMap != null) {
          WebRTCService().handleOffer(fromId, offerMap);
        }
      } else if (type == 'answer') {
        final fromId = data['from'] as String?;
        final answerMap = data['answer'] as Map<String, dynamic>?;
        final targetPeer = data['target'] as String?;
        debugPrint('[WEBRTC][SIGNAL] received answer from $fromId (target: $targetPeer, sdpType: ${answerMap?['type']})');
        if (fromId != null && answerMap != null) {
          WebRTCService().handleAnswer(fromId, answerMap);
        }
      } else if (type == 'candidate') {
        final fromId = data['from'] as String?;
        final candidateMap = data['candidate'] as Map<String, dynamic>?;
        final targetPeer = data['target'] as String?;
        debugPrint('[WEBRTC][SIGNAL] received candidate from $fromId (target: $targetPeer)');
        if (fromId != null && candidateMap != null) {
          WebRTCService().handleIceCandidate(fromId, candidateMap);
        }
      } else if (type == 'registered') {
        debugPrint('[Signaling Received] registered confirmation for peerId: ${data['peerId']}');
      } else if (type == 'error') {
        _errorMessage = data['message'] as String? ?? 'Signaling error';
        debugPrint('[Signaling Server Error] $_errorMessage');
        notifyListeners();
      }
    } catch (e) {
      debugPrint('[Signaling Error] Failed to parse message: $e');
    }
  }

  String _formatError(dynamic error, {String stage = ''}) {
    if (kDebugMode) {
      debugPrint('[Signaling Error] Stage: $stage, Error: $error');
    }
    if (error is FormatException) {
      return error.message;
    }
    final message = error.toString();
    if (message.startsWith('WebSocketChannelException: ')) {
      final inner = message.replaceFirst('WebSocketChannelException: ', '').trim();
      return inner.isNotEmpty ? '[$stage] $inner' : '[$stage] $message';
    }
    return stage.isNotEmpty && kDebugMode ? '[$stage] $message' : message;
  }

  @override
  void dispose() {
    _reconnectTimer?.cancel();
    _stopHeartbeat();
    _subscription?.cancel();
    _channel?.sink.close();
    super.dispose();
  }
}
