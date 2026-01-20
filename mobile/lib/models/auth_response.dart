import 'package:restaurant_guide_mobile/models/user.dart';

/// Registration response containing verification token or direct auth tokens
class RegisterResponse {
  final String? verificationToken;
  final bool? emailSent;
  final DateTime? expiresAt;

  // Direct auth tokens (when backend returns auto-login)
  final String? accessToken;
  final String? refreshToken;
  final Map<String, dynamic>? user;

  const RegisterResponse({
    this.verificationToken,
    this.emailSent,
    this.expiresAt,
    this.accessToken,
    this.refreshToken,
    this.user,
  });

  /// Whether backend returned direct auth tokens (no verification needed)
  bool get hasDirectAuth => accessToken != null && accessToken!.isNotEmpty;

  factory RegisterResponse.fromJson(Map<String, dynamic> json) {
    return RegisterResponse(
      verificationToken: json['verification_token'] as String?,
      emailSent: json['email_sent'] as bool?,
      expiresAt: json['expires_at'] != null
          ? DateTime.tryParse(json['expires_at'] as String)
          : null,
      // Support direct auth tokens from backend
      accessToken: json['access_token'] as String? ?? json['accessToken'] as String?,
      refreshToken: json['refresh_token'] as String? ?? json['refreshToken'] as String?,
      user: json['user'] as Map<String, dynamic>?,
    );
  }
}

/// Authentication response containing tokens and user
class AuthResponse {
  final String accessToken;
  final String refreshToken;
  final User user;

  const AuthResponse({
    required this.accessToken,
    required this.refreshToken,
    required this.user,
  });

  factory AuthResponse.fromJson(Map<String, dynamic> json) {
    return AuthResponse(
      accessToken: json['access_token'] as String? ?? json['accessToken'] as String? ?? '',
      refreshToken: json['refresh_token'] as String? ?? json['refreshToken'] as String? ?? '',
      user: User.fromJson(json['user'] as Map<String, dynamic>? ?? json),
    );
  }
}
