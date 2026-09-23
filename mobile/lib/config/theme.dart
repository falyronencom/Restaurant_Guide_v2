import 'package:flutter/material.dart';

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

  /// Splash «кокарда» palette (NIRIVIO splash, SDL CAT-C-1.4, lab «Заставка
  /// NIRIVIO» v7, light stage). The three bands of the launcher cockade on a
  /// warm beige stage; the light ring is deliberately lighter than the stage
  /// centre (guard: `test/screens/splash/splash_palette_guard_test.dart`).
  static const Color cockadeCornflower = Color(0xFF3F63B8); // василёк — outer disc; flight ring
  static const Color cockadeCornLite = Color(0xFF7390D6);   // светлый василёк — middle ring in flight
  static const Color cockadeAccent = Color(0xFFE8742B);     // orange — core, accent rule
  static const Color cockadeRing = Color(0xFFFBF7EE);       // light middle ring — lighter than splashBgInner
  static const Color cockadeWave = Color(0xFFC0AE8C);       // landing wave + waiting-loop waves
  static const Color cockadeFlash = Color(0xFFFFFFFF);      // landing flash ring
  static const Color cockadeShadow = Color(0xFF283A6B);     // sign drop shadow (alpha applied by painter)
  static const Color splashWordmark = Color(0xFF283A6B);    // NIRIVIO wordmark (deep navy)
  static const Color splashTagline = Color(0xFF7A6B52);     // «Вкусное рядом» tagline (warm taupe)
  static const Color splashBgInner = Color(0xFFF7F1E2);      // radial gradient — center (lightest)
  static const Color splashBgMid = Color(0xFFF0E7D2);        // radial gradient — mid
  static const Color splashBgOuter = Color(0xFFE9DEC5);      // radial gradient — edge

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
  //
  // Семейства объявлены в pubspec (`flutter: fonts:`, SDL CAT-C-1.3), и
  // объявленное семейство держит все свои начертания: файл под запрошенный вес
  // выбирает Flutter. Поэтому вес можно ставить где угодно — он дойдёт до своего
  // .ttf. Обратная сторона: опечатка в имени компилятором не ловится и уводит
  // текст на системный шрифт молча, а вес, которого у семейства нет, движок
  // дорисует синтетикой. Обе стороны шва стережёт
  // test/config/fonts_bundled_test.dart.
  //
  // Имя пишется ровно как `family:` в pubspec и объявляется `static const
  // String` — эту форму ищет сторож.

  /// Дисплейный: заголовки экранов, шторок и секций (Figma: Unbounded).
  /// Вшит только w400.
  static const String fontDisplayFamily = 'Unbounded';

  /// Body: весь остальной текст — тема раздаёт его всем слотам textTheme.
  /// Четыре начертания 400/500/600/700, поэтому вес поверх темы попадает в
  /// свой файл.
  static const String fontBodyFamily = 'NunitoSans';

  /// Вордмарк NIRIVIO (латиница). Для кириллицы не применять — её у Josefin
  /// Sans нет вовсе: буквы молча уйдут в системный шрифт.
  static const String fontWordmarkFamily = 'JosefinSans';

  /// Заголовок карточки-витрины (список результатов). Вшит только w600.
  static const String fontCardTitleFamily = 'Onest';

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
  // Canonical Applied Styles — «канон B» (применённый Figma-фундамент)
  // ============================================================================
  // Аудит консистентности 2026-07-06 (mobile/session_reports/
  // ui_consistency_audit_2026_07_06_report.md): реальный канон приложения живёт
  // в эталонных экранах (search_home / detail / filter / auth), а не в textTheme
  // ниже. Новые экраны используют стили этого блока.
  // Статусный зелёный канона — statusGreen (#34C759), НЕ successGreen.

  /// Заголовок AppBar: Unbounded 25/w400 тёмно-оранжевый.
  /// Применять через CanonAppBar (widgets/canon_app_bar.dart).
  /// Образцы: login_screen, edit_establishment_screen.
  static const TextStyle canonAppBarTitle = TextStyle(
    fontFamily: fontDisplayFamily,
    fontSize: 25,
    fontWeight: FontWeight.w400,
    color: primaryOrangeDark,
  );

  /// Заголовок страницы/шага внутри тела экрана: Unbounded 25/w400 чёрный.
  static const TextStyle canonPageTitle = TextStyle(
    fontFamily: fontDisplayFamily,
    fontSize: 25,
    fontWeight: FontWeight.w400,
    color: textPrimary,
  );

  /// Заголовок крупной секции: Unbounded 30/w400 («Наше меню» в detail_screen).
  static const TextStyle canonSectionHeader = TextStyle(
    fontFamily: fontDisplayFamily,
    fontSize: 30,
    fontWeight: FontWeight.w400,
    color: textPrimary,
  );

  /// Заголовок модальной шторки: Unbounded 20/w400.
  static const TextStyle canonSheetTitle = TextStyle(
    fontFamily: fontDisplayFamily,
    fontSize: 20,
    fontWeight: FontWeight.w400,
    color: textPrimary,
  );

  /// Подсекция / заголовок карточки / секция списка: Nunito 18/w600.
  /// Вес Nunito Sans в каноне — 400–700 (SDL CAT-C-1.3, Amendment
  /// 2026-09-22): у каждого веса свой вшитый файл.
  static const TextStyle canonSubsectionHeader = TextStyle(
    fontSize: 18,
    fontWeight: FontWeight.w600,
    color: textPrimary,
  );

  /// Заголовок карточки-витрины (список результатов поиска): Onest 20/w600 —
  /// стильный дисплейный шрифт у́же Unbounded, с поддержкой кириллицы. Выбран
  /// сравнением на устройстве среди Comfortaa · Rubik · Onest (Quicksand отклонён —
  /// нет кириллического покрытия: latin/latin-ext/vietnamese).
  static const TextStyle canonCardTitle = TextStyle(
    fontFamily: fontCardTitleFamily,
    fontSize: 20,
    fontWeight: FontWeight.w600,
    color: textPrimary,
  );

  /// Каноническая карточка: белая, рамка strokeGrey, тёплая тень
  /// primaryOrangeShadow 4% (образец: карточка меню detail_screen).
  static BoxDecoration canonCardDecoration({
    double radius = radiusMedium,
    Color? borderColor,
  }) =>
      BoxDecoration(
        color: backgroundPrimary,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: borderColor ?? strokeGrey),
        boxShadow: [
          BoxShadow(
            color: primaryOrangeShadow.withValues(alpha: 0.04),
            blurRadius: 12,
            spreadRadius: 1,
            offset: const Offset(2, 2),
          ),
        ],
      );

  /// CTA-кнопка L (крупное действие экрана, «Хочу забронировать»):
  /// вертикальный паддинг 16, r12, label 17/w600. Образец: detail_screen CTA.
  static ButtonStyle canonCtaL({Color? backgroundColor}) =>
      ElevatedButton.styleFrom(
        backgroundColor: backgroundColor ?? primaryOrange,
        foregroundColor: textOnPrimary,
        disabledBackgroundColor: strokeGrey,
        elevation: 0,
        padding: const EdgeInsets.symmetric(vertical: 16),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusMedium),
        ),
        textStyle: const TextStyle(
          fontFamily: fontBodyFamily,
          fontSize: 17,
          fontWeight: FontWeight.w600,
        ),
      );

  /// CTA-кнопка M (списочные действия): высота 47, r8, label 15/w500.
  /// Образец: CTA главной поиска.
  static ButtonStyle canonCtaM({Color? backgroundColor}) =>
      ElevatedButton.styleFrom(
        backgroundColor: backgroundColor ?? primaryOrange,
        foregroundColor: textOnPrimary,
        disabledBackgroundColor: strokeGrey,
        elevation: 0,
        minimumSize: const Size(0, 47),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusSmall),
        ),
        textStyle: const TextStyle(
          fontFamily: fontBodyFamily,
          fontSize: 15,
          fontWeight: FontWeight.w500,
        ),
      );

  // ============================================================================
  // Theme Data
  // ============================================================================

  /// Light theme for the application
  static ThemeData get lightTheme {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,

      // Семейство тела — всем пятнадцати слотам textTheme. Слотов title* в
      // textTheme ниже нет: их берёт типографика Material по умолчанию, и
      // Nunito Sans им отдаёт только это поле. `.apply(fontFamily:)` на
      // TextTheme ниже их бы не коснулся, и подписи кнопок входа
      // (textTheme.titleMedium) ушли бы на системный шрифт.
      //
      // Дальше textTheme это поле не доходит. Кнопки, заголовок AppBar и чипы
      // читают textTheme только в стиле по умолчанию: стиль подписи, заданный
      // в их темах ниже (и в canonCta*), ЗАМЕНЯЕТ его целиком, а не сливается
      // с ним, — поэтому в этих стилях семейство названо явно. Сторож —
      // test/config/theme_text_families_test.dart.
      fontFamily: fontBodyFamily,

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
          fontFamily: fontBodyFamily,
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
            fontFamily: fontBodyFamily,
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
            fontFamily: fontBodyFamily,
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
            fontFamily: fontBodyFamily,
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
        labelStyle: const TextStyle(fontFamily: fontBodyFamily, fontSize: 14),
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

      // Typography theme — Nunito Sans as default body font (replaces Avenir
      // Next). Семейство слотам отдаёт `fontFamily:` в начале темы.
      textTheme: const TextTheme(
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
      ),
    );
  }
}
