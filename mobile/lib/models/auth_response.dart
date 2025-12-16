import 'package:restaurant_guide_mobile/models/user.dart';

/// Registration response containing verification token
class RegisterResponse {
  final String? verificationToken;
  final bool? emailSent;
  final DateTime? expiresAt;

  const RegisterResponse({
    this.verificationToken,
    this.emailSent,
    this.expiresAt,
  });

  factory RegisterResponse.fromJson(Map<String, dynamic> json) {
    return RegisterResponse(
      verificationToken: json['verification_token'] as String?,
      emailSent: json['email_sent'] as bool?,
      expiresAt: json['expires_at'] != null
          ? DateTime.tryParse(json['expires_at'] as String)
          : null,
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
