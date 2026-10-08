  class AppConfig {
    static const String defaultSignalingUrl =
        'wss://w6usgik3zi.execute-api.ap-south-1.amazonaws.com/\$default';

    static String _signalingUrl = defaultSignalingUrl;

    static String get signalingUrl => _signalingUrl;

    static set signalingUrl(String url) {
      final trimmed = url.trim();
      if (trimmed.isNotEmpty) {
        _signalingUrl = trimmed;
      }
    }

    static void resetToDefault() {
      _signalingUrl = defaultSignalingUrl;
    }
  }
