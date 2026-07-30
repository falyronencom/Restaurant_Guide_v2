/// Environment configuration for different build environments
/// Manages API endpoints and environment-specific settings
class Environment {
  /// Current environment mode
  static const String _environment = String.fromEnvironment(
    'ENV',
    defaultValue: 'production',
  );

  /// Backend API base URL based on environment
  static String get apiBaseUrl {
    switch (_environment) {
      case 'production':
        return 'https://restaurantguidev2-production.up.railway.app';
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

  /// Google OAuth Web client ID («Nirivio Backend» in Google Cloud console).
  /// Audience of the id_token sent to our backend — must match the backend's
  /// GOOGLE_CLIENT_ID env var. Client IDs are public by OAuth design.
  static const String googleServerClientId = String.fromEnvironment(
    'GOOGLE_SERVER_CLIENT_ID',
    defaultValue:
        '486251629564-3aef99s1bv779lqkafnsc28f0j9g5ltk.apps.googleusercontent.com',
  );

  /// Google OAuth iOS client ID («Nirivio iOS» in Google Cloud console).
  /// Identifies the app itself to the Google Sign-In SDK on iOS; Android is
  /// recognized by package name + SHA-1 registered in the console instead.
  static const String googleIosClientId = String.fromEnvironment(
    'GOOGLE_IOS_CLIENT_ID',
    defaultValue:
        '486251629564-14a4nbpnke2e9imj0glgm3snb26oj6ab.apps.googleusercontent.com',
  );

  /// Yandex OAuth Client ID
  /// Configure at https://oauth.yandex.ru/
  static const String yandexClientId = String.fromEnvironment(
    'YANDEX_CLIENT_ID',
    defaultValue: '',
  );

  /// Yandex OAuth redirect URI scheme (must match app's URL scheme)
  static const String yandexRedirectScheme = 'restaurantguide';

  /// Yandex OAuth redirect URI
  static String get yandexRedirectUri =>
      '$yandexRedirectScheme://auth/yandex';

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
