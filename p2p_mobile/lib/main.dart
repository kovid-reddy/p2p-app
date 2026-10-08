import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'app_config.dart';
import 'settings_screen.dart';
import 'signaling_service.dart';
import 'webrtc_service.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'P2P',
      debugShowCheckedModeBanner: false,
      themeMode: ThemeMode.dark,
      darkTheme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: Colors.deepPurple,
          brightness: Brightness.dark,
        ),
      ),
      home: const HomeScreen(),
    );
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late final TextEditingController _displayNameController;
  final SignalingService _signalingService = SignalingService();
  final WebRTCService _webrtcService = WebRTCService();

  @override
  void initState() {
    super.initState();
    _displayNameController = TextEditingController(text: 'Mobile Device');
    _signalingService.addListener(_onStateChanged);
    _webrtcService.addListener(_onStateChanged);
  }

  void _onStateChanged() {
    if (mounted) {
      setState(() {});
    }
  }

  @override
  void dispose() {
    _signalingService.removeListener(_onStateChanged);
    _webrtcService.removeListener(_onStateChanged);
    _displayNameController.dispose();
    super.dispose();
  }

  Future<void> _toggleSignalingConnection() async {
    if (_signalingService.state == SignalingState.connected ||
        _signalingService.state == SignalingState.connecting) {
      await _signalingService.disconnect();
    } else {
      final name = _displayNameController.text.trim();
      final url = AppConfig.signalingUrl;
      await _signalingService.connect(url: url, displayName: name);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final sigState = _signalingService.state;
    final isSigConnected = sigState == SignalingState.connected;
    final isSigConnecting = sigState == SignalingState.connecting;
    final myPeerId = _signalingService.myPeerId;
    final peers = _signalingService.discoveredPeers;

    final activePeerId = _webrtcService.activePeerId;
    final activePeerState = activePeerId != null
        ? _webrtcService.getPeerState(activePeerId)
        : PeerConnectionState.disconnected;
    final isP2pConnected = activePeerState == PeerConnectionState.connected;

    return Scaffold(
      appBar: AppBar(
        title: const Text('P2P'),
        centerTitle: true,
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            tooltip: 'Advanced Settings',
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (context) => const SettingsScreen(),
                ),
              );
            },
          ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Connection Status Card
              Card(
                elevation: 0,
                color: isP2pConnected
                    ? colorScheme.primaryContainer.withValues(alpha: 0.4)
                    : colorScheme.surfaceContainerHighest,
                child: Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Signaling Server Status
                      Row(
                        children: [
                          Container(
                            width: 10,
                            height: 10,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: isSigConnected
                                  ? Colors.greenAccent
                                  : isSigConnecting
                                      ? Colors.amberAccent
                                      : colorScheme.outline,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            'Signaling Server: ',
                            style: theme.textTheme.labelMedium?.copyWith(
                              color: colorScheme.onSurfaceVariant,
                            ),
                          ),
                          Text(
                            isSigConnected
                                ? 'Registered'
                                : isSigConnecting
                                    ? 'Connecting...'
                                    : 'Disconnected',
                            style: theme.textTheme.labelMedium?.copyWith(
                              fontWeight: FontWeight.bold,
                              color: isSigConnected
                                  ? Colors.greenAccent
                                  : colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),

                      // WebRTC P2P Status
                      Row(
                        children: [
                          Container(
                            width: 12,
                            height: 12,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: isP2pConnected
                                  ? Colors.lightBlueAccent
                                  : activePeerState == PeerConnectionState.connecting
                                      ? Colors.amberAccent
                                      : colorScheme.outline,
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'P2P Peer Connection',
                                  style: theme.textTheme.labelSmall?.copyWith(
                                    color: colorScheme.onSurfaceVariant,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  isP2pConnected
                                      ? 'P2P Connected (${activePeerId!.substring(0, 6)}...)'
                                      : activePeerState == PeerConnectionState.connecting
                                          ? 'Connecting to Peer...'
                                          : 'No Active P2P Peer',
                                  style: theme.textTheme.titleMedium?.copyWith(
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          Icon(
                            isP2pConnected ? Icons.sensors : Icons.sensors_off,
                            color: isP2pConnected
                                ? Colors.lightBlueAccent
                                : colorScheme.onSurfaceVariant,
                          ),
                        ],
                      ),

                      if (myPeerId != null && isSigConnected) ...[
                        const Divider(height: 24),
                        Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    'Your Peer ID',
                                    style: theme.textTheme.labelSmall?.copyWith(
                                      color: colorScheme.onSurfaceVariant,
                                    ),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    myPeerId,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: theme.textTheme.bodySmall?.copyWith(
                                      fontFamily: 'monospace',
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            IconButton(
                              icon: const Icon(Icons.copy, size: 18),
                              onPressed: () {
                                Clipboard.setData(ClipboardData(text: myPeerId));
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                    content: Text('Peer ID copied to clipboard'),
                                  ),
                                );
                              },
                            ),
                          ],
                        ),
                      ],
                      if (_signalingService.errorMessage != null) ...[
                        const SizedBox(height: 8),
                        Text(
                          _signalingService.errorMessage!,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: colorScheme.error,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 24),

              // Display Name Field
              TextField(
                controller: _displayNameController,
                enabled: !isSigConnected && !isSigConnecting,
                decoration: const InputDecoration(
                  labelText: 'Display Name',
                  hintText: 'Enter your name',
                  prefixIcon: Icon(Icons.person_outline),
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 16),

              // Connect / Disconnect Signaling Button
              FilledButton.icon(
                onPressed: _toggleSignalingConnection,
                icon: isSigConnecting
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : Icon(isSigConnected
                        ? Icons.power_off
                        : Icons.power_settings_new),
                label: Text(
                  isSigConnected
                      ? 'Disconnect Signaling'
                      : isSigConnecting
                          ? 'Connecting...'
                          : 'Connect to Signaling Server',
                ),
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16.0),
                  backgroundColor: isSigConnected ? colorScheme.error : null,
                ),
              ),
              const SizedBox(height: 32),

              // Nearby Peers Section
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Nearby Peers',
                    style: theme.textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  if (isSigConnected)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: colorScheme.primaryContainer,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        '${peers.length} Online',
                        style: theme.textTheme.labelMedium?.copyWith(
                          color: colorScheme.onPrimaryContainer,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 12),

              if (peers.isEmpty)
                Card(
                  elevation: 0,
                  color: colorScheme.surfaceContainerLow,
                  shape: RoundedRectangleBorder(
                    side: BorderSide(
                      color: colorScheme.outlineVariant,
                      width: 1,
                    ),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      vertical: 32.0,
                      horizontal: 16.0,
                    ),
                    child: Column(
                      children: [
                        Icon(
                          Icons.devices_other,
                          size: 48,
                          color: colorScheme.onSurfaceVariant.withValues(alpha: 0.6),
                        ),
                        const SizedBox(height: 12),
                        Text(
                          'No nearby peers found',
                          style: theme.textTheme.titleMedium?.copyWith(
                            color: colorScheme.onSurfaceVariant,
                          ),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          isSigConnected
                              ? 'Waiting for other peers to connect...'
                              : 'Tap Connect to start discovering peers on your network.',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: colorScheme.onSurfaceVariant.withValues(alpha: 0.7),
                          ),
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  ),
                )
              else
                ListView.separated(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  itemCount: peers.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 8),
                  itemBuilder: (context, index) {
                    final peer = peers[index];
                    final peerState = _webrtcService.getPeerState(peer.peerId);
                    final isThisPeerConnected = peerState == PeerConnectionState.connected;
                    final isThisPeerConnecting = peerState == PeerConnectionState.connecting;

                    return Card(
                      elevation: 0,
                      color: isThisPeerConnected
                          ? colorScheme.primaryContainer.withValues(alpha: 0.3)
                          : colorScheme.surfaceContainerLow,
                      child: ListTile(
                        leading: CircleAvatar(
                          backgroundColor: isThisPeerConnected
                              ? Colors.greenAccent.withValues(alpha: 0.2)
                              : colorScheme.primaryContainer,
                          child: Icon(
                            Icons.phonelink,
                            color: isThisPeerConnected
                                ? Colors.greenAccent
                                : colorScheme.onPrimaryContainer,
                          ),
                        ),
                        title: Text(
                          peer.formattedName,
                          style: const TextStyle(fontWeight: FontWeight.bold),
                        ),
                        subtitle: Text(
                          'ID: ${peer.peerId.length > 12 ? peer.peerId.substring(0, 12) : peer.peerId}...',
                          style: const TextStyle(fontFamily: 'monospace'),
                        ),
                        trailing: OutlinedButton(
                          onPressed: () {
                            if (isThisPeerConnected || isThisPeerConnecting) {
                              _webrtcService.disconnectPeer(peer.peerId);
                            } else {
                              _webrtcService.connectToPeer(peer.peerId);
                            }
                          },
                          style: OutlinedButton.styleFrom(
                            side: BorderSide(
                              color: isThisPeerConnected
                                  ? Colors.redAccent
                                  : colorScheme.primary,
                            ),
                          ),
                          child: isThisPeerConnecting
                              ? const SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : Text(
                                  isThisPeerConnected
                                      ? 'Disconnect'
                                      : 'Connect P2P',
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: isThisPeerConnected
                                        ? Colors.redAccent
                                        : colorScheme.primary,
                                  ),
                                ),
                        ),
                      ),
                    );
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }
}
