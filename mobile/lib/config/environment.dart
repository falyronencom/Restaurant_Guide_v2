/// Environment configuration for different build environments
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
        // Production backend URL - to be configured when backend is deployed
        return 'https://api.restaurant-guide.by';
      case 'staging':
        // Staging environment for testing
        return 'https://staging-api.restaurant-guide.by';
      case 'development':
      default:
        // Local development server
        // Update this to match your local backend IP address
        // For Android emulator: use 10.0.2.2
        // For iOS simulator: use localhost or 127.0.0.1
        // For real device: use your computer's IP address
        return 'http://10.0.2.2:3000';
    }
  }

  /// Google Maps API key
  static const String googleMapsApiKey = String.fromEnvironment(
    'GOOGLE_MAPS_API_KEY',
    defaultValue: '',
  );

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

  /// Token refresh threshold in minutes
  /// Refresh token when it's about to expire in this many minutes
  static const int tokenRefreshThreshold = 5;
}
