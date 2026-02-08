/// Environment configuration for admin-web
/// Manages API endpoints and environment-specific settings
class Environment {
  /// Current environment mode
  static const String _environment = String.fromEnvironment(
    'ENV',
    defaultValue: 'development',
  );

  /// Backend API base URL based on environment
  static String get apiBaseUrl {
    switch (_environment) {
      case 'production':
        return 'https://api.restaurant-guide.by';
      case 'staging':
        return 'https://staging-api.restaurant-guide.by';
      case 'development':
      default:
        // Flutter Web runs in browser — localhost works directly
        return 'http://localhost:3000';
    }
  }

  /// Whether we're running in production
  static bool get isProduction => _environment == 'production';

  /// Whether we're running in development
  static bool get isDevelopment => _environment == 'development';

  /// Whether we're running in staging
  static bool get isStaging => _environment == 'staging';

  /// Current environment name
  static String get environmentName => _environment;

  /// API request timeout in seconds
  static const int apiTimeout = 30;

  /// API connect timeout in seconds
  static const int apiConnectTimeout = 30;

  /// Maximum retry attempts for failed requests
  static const int maxRetryAttempts = 3;

  /// Enable detailed API logging (only in development)
  static bool get enableApiLogging => isDevelopment;
}
