/// Application dimension constants
/// Defines consistent spacing, sizing, and layout values
/// Used throughout the app for visual consistency
class AppDimensions {
  // Prevent instantiation
  AppDimensions._();

  // ============================================================================
  // Spacing Constants
  // ============================================================================

  /// Extra small spacing (4px)
  static const double spacingXs = 4.0;

  /// Small spacing (8px)
  static const double spacingS = 8.0;

  /// Medium spacing (16px) - Most common spacing value
  static const double spacingM = 16.0;

  /// Large spacing (24px)
  static const double spacingL = 24.0;

  /// Extra large spacing (32px)
  static const double spacingXl = 32.0;

  /// Extra extra large spacing (48px)
  static const double spacingXxl = 48.0;

  // ============================================================================
  // Padding Constants
  // ============================================================================

  /// Extra small padding (4px)
  static const double paddingXs = 4.0;

  /// Small padding (8px)
  static const double paddingS = 8.0;

  /// Medium padding (16px)
  static const double paddingM = 16.0;

  /// Large padding (24px)
  static const double paddingL = 24.0;

  /// Extra large padding (32px)
  static const double paddingXl = 32.0;

  /// Screen edge padding (20px)
  /// Used for consistent screen margins
  static const double screenPadding = 20.0;

  /// Card content padding (16px)
  static const double cardPadding = 16.0;

  /// Card small content padding (12px)
  static const double cardPaddingSmall = 12.0;

  // ============================================================================
  // Border Radius Constants
  // ============================================================================

  /// Extra small border radius (4px)
  static const double radiusXs = 4.0;

  /// Small border radius (8px)
  static const double radiusS = 8.0;

  /// Medium border radius (12px)
  static const double radiusM = 12.0;

  /// Large border radius (16px)
  static const double radiusL = 16.0;

  /// Extra large border radius (24px)
  static const double radiusXl = 24.0;

  /// Circular border radius (9999px)
  static const double radiusCircular = 9999.0;

  // ============================================================================
  // Icon Sizes
  // ============================================================================

  /// Extra small icon size (12px)
  static const double iconXs = 12.0;

  /// Small icon size (16px)
  static const double iconS = 16.0;

  /// Medium icon size (24px) - Most common icon size
  static const double iconM = 24.0;

  /// Large icon size (32px)
  static const double iconL = 32.0;

  /// Extra large icon size (48px)
  static const double iconXl = 48.0;

  /// Extra extra large icon size (64px)
  static const double iconXxl = 64.0;

  // ============================================================================
  // Component Sizes
  // ============================================================================

  /// Button minimum height (48px) - For touch targets
  static const double buttonHeight = 48.0;

  /// Button small height (36px)
  static const double buttonHeightSmall = 36.0;

  /// Input field height (48px)
  static const double inputHeight = 48.0;

  /// App bar height (56px)
  static const double appBarHeight = 56.0;

  /// Bottom navigation bar height (60px)
  static const double bottomNavHeight = 60.0;

  /// Card thumbnail width for establishment cards (120px)
  static const double cardThumbnailWidth = 120.0;

  /// Card thumbnail height for establishment cards (120px)
  static const double cardThumbnailHeight = 120.0;

  /// Establishment card height (140px)
  static const double establishmentCardHeight = 140.0;

  /// Avatar size small (32px)
  static const double avatarSizeSmall = 32.0;

  /// Avatar size medium (48px)
  static const double avatarSizeMedium = 48.0;

  /// Avatar size large (64px)
  static const double avatarSizeLarge = 64.0;

  // ============================================================================
  // Elevation Constants
  // ============================================================================

  /// No elevation
  static const double elevationNone = 0.0;

  /// Low elevation (2px)
  static const double elevationLow = 2.0;

  /// Medium elevation (4px)
  static const double elevationMedium = 4.0;

  /// High elevation (8px)
  static const double elevationHigh = 8.0;

  /// Extra high elevation (16px)
  static const double elevationXHigh = 16.0;

  // ============================================================================
  // Layout Constraints
  // ============================================================================

  /// Maximum content width for tablets/desktop (600px)
  static const double maxContentWidth = 600.0;

  /// Maximum image aspect ratio for establishment photos (16:9)
  static const double imageAspectRatio = 16 / 9;

  /// Card aspect ratio for establishment cards (3:2)
  static const double cardAspectRatio = 3 / 2;

  // ============================================================================
  // Divider Thickness
  // ============================================================================

  /// Thin divider (1px)
  static const double dividerThin = 1.0;

  /// Medium divider (2px)
  static const double dividerMedium = 2.0;

  /// Thick divider (4px)
  static const double dividerThick = 4.0;

  // ============================================================================
  // Animation Durations (in milliseconds)
  // ============================================================================

  /// Fast animation duration (150ms)
  static const int animationFast = 150;

  /// Normal animation duration (300ms)
  static const int animationNormal = 300;

  /// Slow animation duration (500ms)
  static const int animationSlow = 500;
}
