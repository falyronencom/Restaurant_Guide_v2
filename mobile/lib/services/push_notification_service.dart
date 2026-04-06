import 'dart:io' show Platform;
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

/// Service for managing FCM push notifications lifecycle.
///
/// Responsibilities: permission request, token registration/deregistration,
/// foreground/background/terminated message handling, token refresh.
///
/// Non-blocking: the app works fully without push permission (polling continues).
class PushNotificationService {
  static final PushNotificationService _instance =
      PushNotificationService._internal();
  factory PushNotificationService() => _instance;
  PushNotificationService._internal();

  final FirebaseMessaging _messaging = FirebaseMessaging.instance;
  final ApiClient _apiClient = ApiClient();

  String? _currentToken;

  /// Callback for foreground messages — set by the UI layer
  void Function(RemoteMessage)? onForegroundMessage;

  /// Callback for notification tap (background/terminated) — set by the UI layer
  void Function(RemoteMessage)? onMessageTap;

  /// Initialize push notification service.
  /// Call after Firebase.initializeApp() and after user is authenticated.
  Future<void> initialize() async {
    try {
      // Request permission (non-blocking — app works without it)
      await _requestPermission();

      // Get and register FCM token
      await _registerToken();

      // Listen for token refresh
      _messaging.onTokenRefresh.listen((newToken) {
        _currentToken = newToken;
        _registerTokenWithBackend(newToken);
      });

      // Handle foreground messages
      FirebaseMessaging.onMessage.listen((RemoteMessage message) {
        debugPrint('Push received in foreground: ${message.notification?.title}');
        onForegroundMessage?.call(message);
      });

      // Handle background message tap (app was in background)
      FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
        debugPrint('Push tapped (background): ${message.data}');
        onMessageTap?.call(message);
      });

      // Handle terminated message tap (app was closed)
      final initialMessage = await _messaging.getInitialMessage();
      if (initialMessage != null) {
        debugPrint('Push tapped (terminated): ${initialMessage.data}');
        // Delay slightly to ensure navigation context is ready
        Future.delayed(const Duration(milliseconds: 500), () {
          onMessageTap?.call(initialMessage);
        });
      }
    } catch (e) {
      debugPrint('PushNotificationService init error: $e');
    }
  }

  /// Request notification permission from the user.
  Future<bool> _requestPermission() async {
    try {
      final settings = await _messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
        provisional: false,
      );

      final granted = settings.authorizationStatus ==
              AuthorizationStatus.authorized ||
          settings.authorizationStatus == AuthorizationStatus.provisional;

      debugPrint('Push permission: ${settings.authorizationStatus}');
      return granted;
    } catch (e) {
      debugPrint('Push permission request error: $e');
      return false;
    }
  }

  /// Get FCM token and register with backend.
  Future<void> _registerToken() async {
    try {
      _currentToken = await _messaging.getToken();
      if (_currentToken != null) {
        await _registerTokenWithBackend(_currentToken!);
      }
    } catch (e) {
      debugPrint('Token registration error: $e');
    }
  }

  /// Send FCM token to backend (idempotent UPSERT).
  Future<void> _registerTokenWithBackend(String token) async {
    try {
      await _apiClient.put(
        '/api/v1/notifications/device-token',
        data: {
          'fcm_token': token,
          'platform': Platform.isIOS ? 'ios' : 'android',
        },
      );
      debugPrint('FCM token registered with backend');
    } catch (e) {
      debugPrint('Backend token registration error: $e');
    }
  }

  /// Deregister FCM token on logout.
  /// Call BEFORE clearing auth state.
  Future<void> deregisterToken() async {
    if (_currentToken == null) return;
    try {
      await _apiClient.delete(
        '/api/v1/notifications/device-token',
        data: {'fcm_token': _currentToken},
      );
      debugPrint('FCM token deregistered');
    } catch (e) {
      debugPrint('Token deregistration error: $e');
    }
    _currentToken = null;
  }

  /// Get current FCM token (for debugging).
  String? get currentToken => _currentToken;
}
