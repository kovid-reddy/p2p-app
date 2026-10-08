import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'identity_service.dart';
import 'packet_protocol.dart';

enum PeerConnectionState {
  disconnected,
  connecting,
  connected,
  failed,
}

class PeerSession {
  final String peerId;
  RTCPeerConnection? connection;
  RTCDataChannel? dataChannel;
  PeerConnectionState state = PeerConnectionState.disconnected;
  final List<RTCIceCandidate> pendingCandidates = [];
  final Set<String> processedCandidates = {};

  PeerSession({required this.peerId});

  void close() {
    try {
      dataChannel?.close();
    } catch (_) {}
    try {
      connection?.close();
    } catch (_) {}
    dataChannel = null;
    connection = null;
    pendingCandidates.clear();
    processedCandidates.clear();
    state = PeerConnectionState.disconnected;
  }
}

typedef SendSignalCallback = void Function(
  String targetId,
  Map<String, dynamic> signalPayload,
);

class WebRTCService extends ChangeNotifier {
  static final WebRTCService _instance = WebRTCService._internal();
  factory WebRTCService() => _instance;
  WebRTCService._internal();

  SendSignalCallback? onSendSignal;
  final Map<String, PeerSession> _sessions = {};
  String? _activePeerId;
  String? _lastReceivedDataMessage;

  Map<String, PeerSession> get sessions => _sessions;
  String? get activePeerId => _activePeerId;
  String? get lastReceivedDataMessage => _lastReceivedDataMessage;

  PeerSession _getOrCreateSession(String peerId) {
    return _sessions.putIfAbsent(peerId, () => PeerSession(peerId: peerId));
  }

  PeerConnectionState getPeerState(String peerId) {
    return _sessions[peerId]?.state ?? PeerConnectionState.disconnected;
  }

  Future<void> connectToPeer(String targetId) async {
    final session = _getOrCreateSession(targetId);

    if (session.state == PeerConnectionState.connected &&
        session.dataChannel?.state == RTCDataChannelState.RTCDataChannelOpen) {
      debugPrint('[WebRTC] DataChannel already open with peer $targetId');
      return;
    }

    final pc = await _createPeerConnectionFor(targetId, forceRecreate: true);

    final dcInit = RTCDataChannelInit()..binaryType = 'arraybuffer';
    final dc = await pc.createDataChannel('chat', dcInit);
    _setupDataChannel(targetId, dc);

    debugPrint('[WEBRTC] creating offer for peer $targetId');
    final offer = await pc.createOffer();
    debugPrint('[WEBRTC] setting local offer for peer $targetId');
    await pc.setLocalDescription(offer);

    debugPrint('[WEBRTC] sending offer to peer $targetId');
    onSendSignal?.call(targetId, {
      'type': 'offer',
      'offer': {
        'type': offer.type,
        'sdp': offer.sdp,
      },
    });
  }

  Future<void> handleOffer(String fromId, Map<String, dynamic> offerMap) async {
    final session = _getOrCreateSession(fromId);
    final myId = IdentityService().peerId ?? '';

    // Glare / Simultaneous offer tie-breaking
    if (session.connection != null) {
      final state = await session.connection!.getSignalingState();
      if (state != RTCSignalingState.RTCSignalingStateStable) {
        final isPolite = myId.compareTo(fromId) > 0;
        if (!isPolite) {
          debugPrint('[WebRTC Glare] Impolite peer ignoring incoming offer from $fromId');
          return;
        }
        debugPrint('[WebRTC Glare] Polite peer accepting incoming offer from $fromId');
      }
    }

    debugPrint('[WEBRTC] creating peer connection');
    final pc = await _createPeerConnectionFor(fromId, forceRecreate: true);

    final sdp = offerMap['sdp'] as String?;
    final type = offerMap['type'] as String? ?? 'offer';
    if (sdp == null) return;

    final remoteDesc = RTCSessionDescription(sdp, type);
    debugPrint('[WEBRTC] setting remote offer from peer $fromId');
    await pc.setRemoteDescription(remoteDesc);
    await _flushQueuedIceCandidates(fromId);

    debugPrint('[WEBRTC] creating answer for peer $fromId');
    final answer = await pc.createAnswer();
    debugPrint('[WEBRTC] setting local answer for peer $fromId');
    await pc.setLocalDescription(answer);

    debugPrint('[WEBRTC] sending answer to peer $fromId');
    onSendSignal?.call(fromId, {
      'type': 'answer',
      'answer': {
        'type': answer.type,
        'sdp': answer.sdp,
      },
    });
  }

  Future<void> handleAnswer(String fromId, Map<String, dynamic> answerMap) async {
    final session = _sessions[fromId];
    if (session?.connection == null) return;

    final sdp = answerMap['sdp'] as String?;
    final type = answerMap['type'] as String? ?? 'answer';
    if (sdp == null) return;

    final signalingState = await session!.connection!.getSignalingState();
    if (signalingState == RTCSignalingState.RTCSignalingStateHaveLocalOffer) {
      final remoteDesc = RTCSessionDescription(sdp, type);
      debugPrint('[WEBRTC] setting remote answer from peer $fromId');
      await session.connection!.setRemoteDescription(remoteDesc);
      await _flushQueuedIceCandidates(fromId);
      debugPrint('[WEBRTC] remote description set for peer $fromId');
    }
  }

  Future<void> handleIceCandidate(String fromId, Map<String, dynamic> candidateMap) async {
    final candidateStr = candidateMap['candidate'] as String?;
    final sdpMid = candidateMap['sdpMid'] as String?;
    final sdpMLineIndex = (candidateMap['sdpMLineIndex'] as num?)?.toInt() ?? 0;

    if (candidateStr == null || candidateStr.isEmpty) return;

    final candidate = RTCIceCandidate(candidateStr, sdpMid, sdpMLineIndex);
    await _addOrQueueIceCandidate(fromId, candidate);
  }

  Future<RTCPeerConnection> _createPeerConnectionFor(
    String targetId, {
    bool forceRecreate = false,
  }) async {
    final session = _getOrCreateSession(targetId);

    if (!forceRecreate && session.connection != null) {
      return session.connection!;
    }

    session.close();
    session.state = PeerConnectionState.connecting;
    notifyListeners();

    final configuration = <String, dynamic>{
      'iceServers': [
        {'urls': 'stun:stun.l.google.com:19302'},
      ],
      'sdpSemantics': 'unified-plan',
    };

    debugPrint('[WEBRTC] creating peer connection for target $targetId');
    final pc = await createPeerConnection(configuration);
    session.connection = pc;

    pc.onIceCandidate = (candidate) {
      if (candidate.candidate != null && candidate.candidate!.isNotEmpty) {
        debugPrint('[WEBRTC][ICE] Local candidate gathered for peer $targetId');
        onSendSignal?.call(targetId, {
          'type': 'candidate',
          'candidate': {
            'candidate': candidate.candidate,
            'sdpMid': candidate.sdpMid,
            'sdpMLineIndex': candidate.sdpMLineIndex,
          },
        });
      }
    };

    pc.onIceConnectionState = (iceState) {
      debugPrint('[WEBRTC][STATE] iceConnectionState for peer $targetId: ${iceState.name}');
      if (iceState == RTCIceConnectionState.RTCIceConnectionStateConnected ||
          iceState == RTCIceConnectionState.RTCIceConnectionStateCompleted) {
        session.state = PeerConnectionState.connected;
        _activePeerId = targetId;
      } else if (iceState == RTCIceConnectionState.RTCIceConnectionStateFailed) {
        session.state = PeerConnectionState.failed;
      } else if (iceState == RTCIceConnectionState.RTCIceConnectionStateDisconnected) {
        session.state = PeerConnectionState.disconnected;
      }
      notifyListeners();
    };

    pc.onIceGatheringState = (gatheringState) {
      debugPrint('[WEBRTC][STATE] iceGatheringState for peer $targetId: ${gatheringState.name}');
    };

    pc.onSignalingState = (signalingState) {
      debugPrint('[WEBRTC][STATE] signalingState for peer $targetId: ${signalingState.name}');
    };

    pc.onConnectionState = (connState) {
      debugPrint('[WEBRTC][STATE] connectionState for peer $targetId: ${connState.name}');
      if (connState == RTCPeerConnectionState.RTCPeerConnectionStateConnected) {
        session.state = PeerConnectionState.connected;
        _activePeerId = targetId;
        notifyListeners();
      }
    };

    pc.onDataChannel = (dc) {
      debugPrint('[WebRTC DataChannel Received] Remote channel from $targetId');
      _setupDataChannel(targetId, dc);
    };

    return pc;
  }

  void _setupDataChannel(String targetId, RTCDataChannel dc) {
    final session = _getOrCreateSession(targetId);
    session.dataChannel = dc;

    dc.onDataChannelState = (state) {
      debugPrint('[DataChannel State] Peer $targetId: $state');
      if (state == RTCDataChannelState.RTCDataChannelOpen) {
        session.state = PeerConnectionState.connected;
        _activePeerId = targetId;
        notifyListeners();

        // Stage 6 Packet Protocol test
        final testPkt = Packet.testMessage(message: 'Hello from mobile');
        debugPrint('[PACKET] Sending packet (type="${testPkt.type}", id="${testPkt.id}") to peer $targetId');
        sendPacket(targetId, testPkt);

        final pingPkt = Packet.ping();
        debugPrint('[PACKET] Sending packet (type="${pingPkt.type}", id="${pingPkt.id}") to peer $targetId');
        sendPacket(targetId, pingPkt);
      } else if (state == RTCDataChannelState.RTCDataChannelClosed) {
        session.state = PeerConnectionState.disconnected;
        if (_activePeerId == targetId) _activePeerId = null;
        notifyListeners();
      }
    };

    dc.onMessage = (data) {
      if (data.isBinary) {
        debugPrint('[DataChannel Binary Received] from $targetId: ${data.binary.length} bytes');
      } else {
        _lastReceivedDataMessage = data.text;
        debugPrint('[DataChannel Text Received] from $targetId: ${data.text}');

        // Stage 6 Packet Protocol handler
        final result = PacketProtocol.parseAndValidate(data.text);
        if (result.isValid) {
          final pkt = result.packet!;
          debugPrint('[PACKET] Received packet (type="${pkt.type}", id="${pkt.id}") from peer $targetId');
          debugPrint('[PACKET] Packet validation successful');

          if (pkt.type == 'test-message') {
            debugPrint('[PACKET] Received test-message payload: ${pkt.payload}');
          } else if (pkt.type == 'ping') {
            debugPrint('[PACKET] Received PING packet from $targetId. Sending PONG packet.');
            final pongPkt = Packet.pong(replyToId: pkt.id);
            debugPrint('[PACKET] Sending packet (type="${pongPkt.type}", id="${pongPkt.id}") to peer $targetId');
            sendPacket(targetId, pongPkt);
          } else if (pkt.type == 'pong') {
            debugPrint('[PACKET] PONG received');
            debugPrint('[PACKET] Round trip SUCCESS');
          }
        } else {
          debugPrint('[PACKET] Raw text received (non-packet or legacy): ${data.text}');
          if (data.text == 'PING') {
            debugPrint('[DataChannel] Received raw PING from $targetId, replying with raw PONG');
            sendDataMessage(targetId, 'PONG');
          } else if (data.text == 'PONG') {
            debugPrint('[DataChannel] Received raw PONG from $targetId');
          }
        }
        notifyListeners();
      }
    };
  }

  Future<void> sendPacket(String targetId, Packet packet) async {
    await sendDataMessage(targetId, packet.toJson());
  }

  Future<void> sendDataMessage(String targetId, String text) async {
    final session = _sessions[targetId];
    if (session?.dataChannel?.state == RTCDataChannelState.RTCDataChannelOpen) {
      await session!.dataChannel!.send(RTCDataChannelMessage(text));
    }
  }

  Future<void> _addOrQueueIceCandidate(String targetId, RTCIceCandidate candidate) async {
    final session = _getOrCreateSession(targetId);
    final candStr = candidate.candidate ?? '';

    if (session.processedCandidates.contains(candStr)) return;
    session.processedCandidates.add(candStr);

    if (session.connection == null) {
      session.pendingCandidates.add(candidate);
      return;
    }

    final remoteDesc = await session.connection!.getRemoteDescription();
    if (remoteDesc == null) {
      debugPrint('[WebRTC ICE Queued] Queuing candidate for peer $targetId');
      session.pendingCandidates.add(candidate);
      return;
    }

    try {
      await session.connection!.addCandidate(candidate);
      debugPrint('[WebRTC ICE Added] Added candidate for peer $targetId');
    } catch (e) {
      debugPrint('[WebRTC ICE Error] Failed to add candidate for peer $targetId: $e');
    }
  }

  Future<void> _flushQueuedIceCandidates(String targetId) async {
    final session = _sessions[targetId];
    if (session?.connection == null) return;

    final pending = List<RTCIceCandidate>.from(session!.pendingCandidates);
    session.pendingCandidates.clear();

    if (pending.isNotEmpty) {
      debugPrint('[WebRTC ICE Flushing] Flushing ${pending.length} candidate(s) for peer $targetId');
    }

    for (final candidate in pending) {
      try {
        await session.connection!.addCandidate(candidate);
        debugPrint('[WebRTC ICE Flushed] Applied candidate for peer $targetId');
      } catch (e) {
        debugPrint('[WebRTC ICE Error] Failed to apply candidate for peer $targetId: $e');
      }
    }
  }

  void disconnectPeer(String targetId) {
    _sessions[targetId]?.close();
    if (_activePeerId == targetId) {
      _activePeerId = null;
    }
    notifyListeners();
  }

  void closeAll() {
    for (final session in _sessions.values) {
      session.close();
    }
    _sessions.clear();
    _activePeerId = null;
    notifyListeners();
  }
}
