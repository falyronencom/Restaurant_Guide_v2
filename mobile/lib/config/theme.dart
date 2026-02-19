import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Application theme configuration
/// Implements design specifications from Figma mockups
/// Primary color: Orange (#F06B32) for CTAs and branding
/// Success color: Green for positive indicators
/// Secondary: Gray palette for supporting content
class AppTheme {
  // Prevent instantiation
  AppTheme._();

  // ============================================================================
  // Border Radius
  // ============================================================================

  static const double radiusXSmall = 4;
  static const double radiusSmall = 8;
  static const double radiusMedium = 12;
  static const double radiusLarge = 16;

  // ============================================================================
  // Color Palette
  // ============================================================================

  /// Primary orange color for branding and CTAs (Figma design tokens)
  static const Color primaryOrange = Color(0xFFF06B32);
  static const Color primaryOrangeDark = Color(0xFFDB4F13);
  static const Color primaryOrangeLight = Color(0xFFEC723D);

  /// Success green for positive indicators (open status, high ratings)
  static const Color successGreen = Color(0xFF4CAF50);
  static const Color successGreenDark = Color(0xFF388E3C);
  static const Color successGreenLight = Color(0xFF66BB6A);

  /// Error red for warnings and errors
  static const Color errorRed = Color(0xFFF44336);
  static const Color errorRedDark = Color(0xFFD32F2F);
  static const Color errorRedLight = Color(0xFFE57373);

  /// Gray palette for secondary content and backgrounds
  static const Color gray900 = Color(0xFF212121);
  static const Color gray800 = Color(0xFF424242);
  static const Color gray700 = Color(0xFF616161);
  static const Color gray600 = Color(0xFF757575);
  static const Color gray500 = Color(0xFF9E9E9E);
  static const Color gray400 = Color(0xFFBDBDBD);
  static const Color gray300 = Color(0xFFE0E0E0);
  static const Color gray200 = Color(0xFFEEEEEE);
  static const Color gray100 = Color(0xFFF5F5F5);
  static const Color gray50 = Color(0xFFFAFAFA);

  /// Figma-specific colors (design tokens from mockups)
  static const Color backgroundWarm = Color(0xFFF4F1EC);    // Beige background
  static const Color strokeGrey = Color(0xFFD2D2D2);        // Dividers/borders
  static const Color primaryOrangeShadow = Color(0xFFD35620); // Button shadows (dark rust)
  static const Color textGrey = Color(0xFFABABAB);           // Secondary grey text
  static const Color statusGreen = Color(0xFF34C759);        // "Open" / success status
  static const Color textDark = Color(0xFF3E3E3E);           // Dark text (near-black)
  static const Color accentNavy = Color(0xFF3631C0);         // Navy blue accent

  /// Background colors
  static const Color backgroundPrimary = Colors.white;
  static const Color backgroundSecondary = gray50;
  static const Color backgroundTertiary = gray100;

  /// Text colors
  static const Color textPrimary = Color(0xFF000000); // Pure black (matches Figma)
  static const Color textSecondary = gray600;
  static const Color textTertiary = gray500;
  static const Color textOnPrimary = Colors.white;

  // ============================================================================
  // Font Families
  // ============================================================================

  /// Display/accent font for headings and titles (Figma: Unbounded)
  static final String fontDisplayFamily = GoogleFonts.unbounded().fontFamily!;

  /// Helper to create Unbounded (display) TextStyle via GoogleFonts
  static TextStyle unbounded({
    double? fontSize,
    FontWeight? fontWeight,
    Color? color,
    double? letterSpacing,
    double? height,
    TextDecoration? decoration,
  }) =>
      GoogleFonts.unbounded(
        fontSize: fontSize,
        fontWeight: fontWeight,
        color: color,
        letterSpacing: letterSpacing,
        height: height,
        decoration: decoration,
      );

  // ============================================================================
  // Typography
  // ============================================================================

  /// Display style for large headers
  static const TextStyle displayLarge = TextStyle(
    fontSize: 32,
    fontWeight: FontWeight.bold,
    letterSpacing: -0.5,
    color: textPrimary,
  );

  static const TextStyle displayMedium = TextStyle(
    fontSize: 28,
    fontWeight: FontWeight.bold,
    letterSpacing: -0.5,
    color: textPrimary,
  );

  static const TextStyle displaySmall = TextStyle(
    fontSize: 24,
    fontWeight: FontWeight.bold,
    letterSpacing: -0.3,
    color: textPrimary,
  );

  /// Headline style for prominent text (establishment names, section titles)
  static const TextStyle headlineLarge = TextStyle(
    fontSize: 22,
    fontWeight: FontWeight.bold,
    letterSpacing: -0.2,
    color: textPrimary,
  );

  static const TextStyle headlineMedium = TextStyle(
    fontSize: 18,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.1,
    color: textPrimary,
  );

  static const TextStyle headlineSmall = TextStyle(
    fontSize: 16,
    fontWeight: FontWeight.w600,
    color: textPrimary,
  );

  /// Body style for regular content
  static const TextStyle bodyLarge = TextStyle(
    fontSize: 16,
    fontWeight: FontWeight.normal,
    letterSpacing: 0.1,
    color: textPrimary,
  );

  static const TextStyle bodyMedium = TextStyle(
    fontSize: 14,
    fontWeight: FontWeight.normal,
    letterSpacing: 0.1,
    color: textPrimary,
  );

  static const TextStyle bodySmall = TextStyle(
    fontSize: 12,
    fontWeight: FontWeight.normal,
    letterSpacing: 0.2,
    color: textPrimary,
  );

  /// Label style for buttons and form labels
  static const TextStyle labelLarge = TextStyle(
    fontSize: 16,
    fontWeight: FontWeight.w500,
    letterSpacing: 0.1,
  );

  static const TextStyle labelMedium = TextStyle(
    fontSize: 14,
    fontWeight: FontWeight.w500,
    letterSpacing: 0.1,
  );

  static const TextStyle labelSmall = TextStyle(
    fontSize: 12,
    fontWeight: FontWeight.w500,
    letterSpacing: 0.2,
  );

  /// Caption style for small secondary text
  static const TextStyle captionLarge = TextStyle(
    fontSize: 14,
    fontWeight: FontWeight.normal,
    letterSpacing: 0.2,
    color: textSecondary,
  );

  static const TextStyle captionMedium = TextStyle(
    fontSize: 12,
    fontWeight: FontWeight.normal,
    letterSpacing: 0.2,
    color: textSecondary,
  );

  static const TextStyle captionSmall = TextStyle(
    fontSize: 10,
    fontWeight: FontWeight.normal,
    letterSpacing: 0.3,
    color: textSecondary,
  );

  // ============================================================================
  // Theme Data
  // ============================================================================

  /// Light theme for the application
  static ThemeData get lightTheme {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,

      // Color scheme
      colorScheme: const ColorScheme.light(
        primary: primaryOrange,
        onPrimary: textOnPrimary,
        primaryContainer: primaryOrangeLight,
        onPrimaryContainer: textPrimary,
        secondary: gray600,
        onSecondary: textOnPrimary,
        secondaryContainer: gray200,
        onSecondaryContainer: textPrimary,
        tertiary: successGreen,
        onTertiary: textOnPrimary,
        error: errorRed,
        onError: textOnPrimary,
        surface: backgroundPrimary,
        onSurface: textPrimary,
        surfaceContainerHighest: backgroundSecondary,
        outline: gray300,
      ),

      // Scaffold background
      scaffoldBackgroundColor: backgroundPrimary,

      // App bar theme
      appBarTheme: const AppBarTheme(
        elevation: 0,
        backgroundColor: primaryOrange,
        foregroundColor: textOnPrimary,
        centerTitle: false,
        titleTextStyle: TextStyle(
          fontSize: 20,
          fontWeight: FontWeight.w600,
          color: textOnPrimary,
        ),
      ),

      // Card theme
      cardTheme: CardThemeData(
        elevation: 2,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
        ),
        clipBehavior: Clip.antiAlias,
        color: backgroundPrimary,
      ),

      // Elevated button theme
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: primaryOrange,
          foregroundColor: textOnPrimary,
          elevation: 2,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
          textStyle: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.1,
          ),
        ),
      ),

      // Outlined button theme
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: primaryOrange,
          side: const BorderSide(color: primaryOrange, width: 1.5),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
          textStyle: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.1,
          ),
        ),
      ),

      // Text button theme
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: primaryOrange,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
          textStyle: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.1,
          ),
        ),
      ),

      // Icon button theme
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(
          foregroundColor: gray700,
          highlightColor: primaryOrangeLight.withValues(alpha: 0.1),
        ),
      ),

      // Floating action button theme
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: primaryOrange,
        foregroundColor: textOnPrimary,
        elevation: 4,
      ),

      // Input decoration theme
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: gray50,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: gray300),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: gray300),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: primaryOrange, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: errorRed),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: errorRed, width: 2),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        hintStyle: const TextStyle(color: gray500),
        labelStyle: const TextStyle(color: gray700),
      ),

      // Chip theme
      chipTheme: ChipThemeData(
        backgroundColor: gray100,
        selectedColor: primaryOrangeLight,
        secondarySelectedColor: successGreenLight,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        labelStyle: const TextStyle(fontSize: 14),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
      ),

      // Divider theme
      dividerTheme: const DividerThemeData(
        color: gray300,
        thickness: 1,
        space: 1,
      ),

      // Bottom navigation bar theme
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: backgroundPrimary,
        selectedItemColor: primaryOrange,
        unselectedItemColor: gray500,
        selectedLabelStyle: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
        unselectedLabelStyle: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.normal,
        ),
        type: BottomNavigationBarType.fixed,
        elevation: 8,
      ),

      // Typography theme — Nunito Sans as default body font (replaces Avenir Next)
      textTheme: GoogleFonts.nunitoSansTextTheme(const TextTheme(
        displayLarge: displayLarge,
        displayMedium: displayMedium,
        displaySmall: displaySmall,
        headlineLarge: headlineLarge,
        headlineMedium: headlineMedium,
        headlineSmall: headlineSmall,
        bodyLarge: bodyLarge,
        bodyMedium: bodyMedium,
        bodySmall: bodySmall,
        labelLarge: labelLarge,
        labelMedium: labelMedium,
        labelSmall: labelSmall,
      )),
    );
  }
}
