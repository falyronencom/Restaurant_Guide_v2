import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Канон Nirivio для админ-панели (Flutter Web).
///
/// Источник истины по токенам: `mobile/lib/config/theme.dart` (канон) →
/// `web/src/lib/tokens.ts` → `web/src/app/globals.css`. Значения ниже сверены
/// с редизайном админки (проект Claude Design «Admin-web UI анализ Всеволода»,
/// файл `Admin-web редизайн.dc.html`, 18 кадров) и его HANDOFF.md от 10.08.2026.
///
/// Правило из разбора редизайна: **новых оттенков не изобретать**. Под бежевыми
/// плитами (`backgroundWarm`, `beigeDivider`) берётся ближайший канонический
/// серый — `textSecondary`, `textTertiary`, `textGrey`, `strokeGrey`.
///
/// Значения, помеченные `admin-local`, в mobile-каноне отсутствуют и введены
/// редизайном админки: радиус 10, `beigeDivider`, `borderLight`, витринный
/// радиус 20, моноширинное семейство.
class AppTheme {
  // Инстанцировать нечего — только статика.
  AppTheme._();

  // ============================================================================
  // Border Radius
  // ============================================================================

  static const double radiusXSmall = 4;
  static const double radiusSmall = 8;

  /// admin-local: пункты рейла, шапка таблицы, компактные поля и кнопки 34–40px.
  static const double radiusControl = 10;

  static const double radiusMedium = 12;
  static const double radiusLarge = 16;

  /// admin-local (web-витрина): крупные витринные панели — пустые состояния,
  /// карточка ошибки, цитата отзыва.
  static const double radiusShowcase = 20;

  /// Пилюля: бейджи очередей, чипы фильтров, сегмент-контрол.
  static const double radiusPill = 9999;

  // ============================================================================
  // Цвета — бренд
  // ============================================================================

  static const Color primaryOrange = Color(0xFFF06B32);
  static const Color primaryOrangeDark = Color(0xFFDB4F13);
  static const Color primaryOrangeLight = Color(0xFFEC723D);

  /// Тёплая тень. В каноне все тени строятся на нём, холодных чёрных теней нет.
  static const Color primaryOrangeShadow = Color(0xFFD35620);

  // ============================================================================
  // Цвета — поверхности
  // ============================================================================

  static const Color backgroundPrimary = Colors.white;

  /// Бежевая витринная поверхность.
  static const Color backgroundWarm = Color(0xFFF4F1EC);

  /// admin-local: разделитель внутри бежевого (рейл, строки пустых состояний).
  static const Color beigeDivider = Color(0xFFE4DFD6);

  /// admin-local: тонкая граница — низ хедера экрана, разделители строк и вкладок.
  static const Color borderLight = Color(0xFFECE8E1);

  /// Рамка: инструментальные карточки, поля ввода, outline-кнопки.
  static const Color strokeGrey = Color(0xFFD2D2D2);

  // --- Оттенки скелетона (admin-local) --------------------------------------
  // Три ступени «веса» блока-заглушки. Эталон — кадр 17 макета: оттенок
  // кодирует значимость будущего содержимого, а не его размер. Сильный —
  // фото и первая строка карточки; средний — вторичные строки и значения
  // полей; слабый — лейблы и всё, что читается последним.

  /// Сильный блок скелетона. Совпадает с [beigeDivider] — это одно значение
  /// канона в двух ролях, не два похожих.
  static const Color skeletonStrong = beigeDivider;
  static const Color skeletonMid = Color(0xFFE9E4DC);
  static const Color skeletonWeak = Color(0xFFEEEAE3);

  // ============================================================================
  // Цвета — статусы
  // ============================================================================

  /// Статусный зелёный канона — НЕ Material successGreen (#4CAF50).
  static const Color statusGreen = Color(0xFF34C759);
  static const Color errorRed = Color(0xFFF44336);

  /// Disclaimer-пара: «скрыт», «приостановлено», причина приостановки.
  static const Color disclaimerText = Color(0xFFA07A52);
  static const Color disclaimerBg = Color(0xFFF7EFE6);

  // ============================================================================
  // Цвета — текст
  // ============================================================================

  static const Color textPrimary = Color(0xFF000000);
  static const Color textDark = Color(0xFF3E3E3E);
  static const Color textSecondary = gray600;
  static const Color textTertiary = gray500;
  static const Color textGrey = Color(0xFFABABAB);
  static const Color textOnPrimary = Colors.white;

  // ============================================================================
  // Цвета — серая шкала
  // ============================================================================

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

  // ============================================================================
  // Полупрозрачные заливки
  // ============================================================================
  // Редизайн задаёт заливки процентом от базового цвета (бейдж — бренд @14%,
  // hover строки таблицы — бренд @4%, плитка иконки ошибки — error @10%).
  // Хелперы вместо именованных констант: набор процентов открытый.

  static Color brandTint(double opacity) =>
      primaryOrange.withValues(alpha: opacity);

  static Color errorTint(double opacity) => errorRed.withValues(alpha: opacity);

  static Color successTint(double opacity) =>
      statusGreen.withValues(alpha: opacity);

  // ============================================================================
  // Тени
  // ============================================================================
  // Все — на тёплом primaryOrangeShadow. Холодных теней в каноне нет.

  /// Инструментальная карточка: 2px 2px 12px spread 1, @4%.
  static final List<BoxShadow> cardShadow = <BoxShadow>[
    BoxShadow(
      color: primaryOrangeShadow.withValues(alpha: 0.04),
      blurRadius: 12,
      spreadRadius: 1,
      offset: const Offset(2, 2),
    ),
  ];

  /// Выбранная карточка списка: та же геометрия, @8%.
  static final List<BoxShadow> selectedCardShadow = <BoxShadow>[
    BoxShadow(
      color: primaryOrangeShadow.withValues(alpha: 0.08),
      blurRadius: 12,
      spreadRadius: 1,
      offset: const Offset(2, 2),
    ),
  ];

  /// Активный пункт рейла: 0 2px 8px, @10%.
  static final List<BoxShadow> railActiveShadow = <BoxShadow>[
    BoxShadow(
      color: primaryOrangeShadow.withValues(alpha: 0.10),
      blurRadius: 8,
      offset: const Offset(0, 2),
    ),
  ];

  /// Активная пилюля сегмент-контрола: 0 2px 6px, @12%.
  static final List<BoxShadow> segmentActiveShadow = <BoxShadow>[
    BoxShadow(
      color: primaryOrangeShadow.withValues(alpha: 0.12),
      blurRadius: 6,
      offset: const Offset(0, 2),
    ),
  ];

  // ============================================================================
  // Шрифты
  // ============================================================================
  // Вшиты в сборку (admin-web/google_fonts/), из сети не тянутся —
  // GoogleFonts.config.allowRuntimeFetching = false в main.dart.
  // Вшитые начертания: Unbounded 400 · Nunito Sans 400/500/600/700 ·
  // Onest 600 · Josefin Sans 600. Запрос невшитого начертания пакет
  // залогирует и откатит на системный шрифт — приложение не упадёт.

  /// Дисплейный: заголовки экранов и числа метрик. В каноне только w400.
  static final String fontDisplayFamily = GoogleFonts.unbounded().fontFamily!;

  /// Body: весь остальной текст.
  static final String fontBodyFamily = GoogleFonts.nunitoSans().fontFamily!;

  /// Вордмарк NIRIVIO (латиница). Для кириллицы не применять.
  static final String fontWordmarkFamily =
      GoogleFonts.josefinSans().fontFamily!;

  /// Заголовок карточки-витрины и текст цитаты отзыва.
  static final String fontCardTitleFamily = GoogleFonts.onest().fontFamily!;

  /// admin-local: моноширинный для табличных данных — id, время, «до/после».
  ///
  /// Вшит 25.08.2026, Regular + Medium, с разрешения владельца: кадры 11–13
  /// держат на нём даты, id и УНП, и до вшивания там срабатывал системный
  /// моноширинный — на бежевом каноне он читается чужеродно.
  ///
  /// Имя семейства берётся у пакета, а не пишется строкой. Прежняя строка
  /// `'JetBrains Mono'` не разрешилась бы: `google_fonts` регистрирует
  /// семейство под своим именем, и совпадение с написанием через пробел
  /// ничем не гарантировано. Так же разрешены все четыре других семейства
  /// канона — это принятый здесь способ, а не исключение для моно.
  ///
  /// Кириллица проверена по cmap самих файлов, включая белорусские «ў» и «і».
  /// Ни описанию семейства, ни CSS-API на этот счёт верить нельзя — они
  /// говорят о семействе, а вшивается конкретный файл.
  static final String fontMonoFamily = GoogleFonts.jetBrainsMono().fontFamily!;
  static const List<String> fontMonoFallback = <String>[
    'Consolas',
    'Menlo',
    'Courier New',
    'monospace',
  ];

  /// Unbounded (дисплейный) с каноническими дефолтами.
  static TextStyle unbounded({
    double? fontSize,
    FontWeight fontWeight = FontWeight.w400,
    Color? color,
    double? letterSpacing,
    double? height,
  }) =>
      GoogleFonts.unbounded(
        fontSize: fontSize,
        fontWeight: fontWeight,
        color: color,
        letterSpacing: letterSpacing,
        height: height,
      );

  /// Моноширинный текст таблиц.
  static TextStyle mono({
    double? fontSize,
    FontWeight? fontWeight,
    Color? color,
    double? letterSpacing,
    double? height,
  }) =>
      TextStyle(
        fontFamily: fontMonoFamily,
        fontFamilyFallback: fontMonoFallback,
        fontSize: fontSize,
        fontWeight: fontWeight,
        color: color,
        letterSpacing: letterSpacing,
        height: height,
      );

  // ============================================================================
  // Канонические применённые стили
  // ============================================================================
  // Значения — из спеки редизайна. letterSpacing в вёрстке задан в em, здесь
  // пересчитан в логические пиксели (em × кегль), как того требует Flutter.

  /// Заголовок экрана в хедере 72px: Unbounded 25/w400 чёрный, lh 1.15.
  static final TextStyle canonScreenTitle = TextStyle(
    fontFamily: fontDisplayFamily,
    fontSize: 25,
    fontWeight: FontWeight.w400,
    height: 1.15,
    color: textPrimary,
  );

  /// Подпись под заголовком экрана: 12 вторичный, отступ сверху 3.
  static const TextStyle canonScreenSubtitle = TextStyle(
    fontSize: 12,
    color: textSecondary,
  );

  /// Заголовок крупной секции: Unbounded 30/w400.
  static final TextStyle canonSectionHeader = TextStyle(
    fontFamily: fontDisplayFamily,
    fontSize: 30,
    fontWeight: FontWeight.w400,
    color: textPrimary,
  );

  /// Заголовок модального окна / шторки: Unbounded 20/w400.
  static final TextStyle canonSheetTitle = TextStyle(
    fontFamily: fontDisplayFamily,
    fontSize: 20,
    fontWeight: FontWeight.w400,
    color: textPrimary,
  );

  /// Подсекция / заголовок карточки: Nunito 18/w600.
  /// Жирнее w600 канон не использует.
  static const TextStyle canonSubsectionHeader = TextStyle(
    fontSize: 18,
    fontWeight: FontWeight.w600,
    color: textPrimary,
  );

  /// Число метрики: Unbounded 30/w400, lh 1 — чтобы дельта вставала по базовой
  /// линии числа, а не «плавала» относительно него.
  static final TextStyle canonMetricValue = TextStyle(
    fontFamily: fontDisplayFamily,
    fontSize: 30,
    fontWeight: FontWeight.w400,
    height: 1,
    color: textPrimary,
  );

  /// Подпись метрики: 12/w600 uppercase, ls .06em → 0.72.
  static const TextStyle canonMetricLabel = TextStyle(
    fontSize: 12,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.72,
    color: textSecondary,
  );

  /// Вордмарк NIRIVIO в рейле: Josefin Sans 24, тёмно-оранжевый.
  ///
  /// Спека редизайна называет w700, но вшито w600 (JosefinSans-SemiBold) —
  /// решение владельца от 11.08.2026: не тащить новый файл ради одного
  /// начертания. Захотим 700 — добавить JosefinSans-Bold.ttf и поднять вес.
  static final TextStyle canonWordmark = TextStyle(
    fontFamily: fontWordmarkFamily,
    fontSize: 24,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.5,
    height: 1,
    color: primaryOrangeDark,
  );

  /// Подпись под вордмарком: 10/w600 uppercase, ls .14em → 1.4.
  static const TextStyle canonWordmarkCaption = TextStyle(
    fontSize: 10,
    fontWeight: FontWeight.w600,
    letterSpacing: 1.4,
    color: textSecondary,
  );

  /// Заголовок секции рейла: 10/w600 uppercase, ls .12em → 1.2.
  static const TextStyle canonRailSectionHeader = TextStyle(
    fontSize: 10,
    fontWeight: FontWeight.w600,
    letterSpacing: 1.2,
    color: textSecondary,
  );

  /// Пометка «скоро» у тупикового пункта рейла: 10/w600 uppercase, ls .06em → 0.6.
  ///
  /// Не расхождение с макетом, хотя поначалу выглядело им: в кадрах 01–12
  /// пометки нет, а в 13–18 она есть — рейл там размечен иначе. Первый разбор
  /// видел только первые 11 кадров (обрезка `get_file` на 256 KiB) и потому
  /// счёл её отсутствующей.
  ///
  /// У помеченного пункта приглушается всё: иконка и подпись тоже `textGrey`.
  static const TextStyle canonRailSoonLabel = TextStyle(
    fontSize: 10,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.6,
    color: textGrey,
  );

  /// Подпись колонки таблицы: 11/w600 uppercase, ls .08em → 0.88.
  static const TextStyle canonTableHeader = TextStyle(
    fontSize: 11,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.88,
    color: textSecondary,
  );

  /// Лейбл значения-для-чтения: 12 вторичный. Значение — 15/w600 чёрным.
  static const TextStyle canonFieldLabel = TextStyle(
    fontSize: 12,
    color: textSecondary,
  );

  static const TextStyle canonFieldValue = TextStyle(
    fontSize: 15,
    fontWeight: FontWeight.w600,
    color: textPrimary,
  );

  /// Пустое значение поля: «не указан».
  static const TextStyle canonFieldValueEmpty = TextStyle(
    fontSize: 15,
    color: textGrey,
  );

  // ============================================================================
  // Декорации
  // ============================================================================

  /// Инструментальная карточка: белая, рамка strokeGrey, тёплая тень @4%.
  /// Применяется в рабочих зонах — метрики, панели, формы.
  static BoxDecoration canonCardDecoration({
    double radius = radiusMedium,
    Color? borderColor,
  }) =>
      BoxDecoration(
        color: backgroundPrimary,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: borderColor ?? strokeGrey),
        boxShadow: cardShadow,
      );

  /// Витринная панель: бежевая, без рамки и тени.
  /// r20 — крупные (пустые состояния, ошибка, цитата), r12 — списочные.
  static BoxDecoration canonPanelDecoration({
    double radius = radiusShowcase,
  }) =>
      BoxDecoration(
        color: backgroundWarm,
        borderRadius: BorderRadius.circular(radius),
      );

  /// Выбранная карточка списка: белая, рамка 1.5px светлым брендовым, тень @8%.
  static BoxDecoration canonSelectedCardDecoration({
    double radius = radiusMedium,
  }) =>
      BoxDecoration(
        color: backgroundPrimary,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: primaryOrangeLight, width: 1.5),
        boxShadow: selectedCardShadow,
      );

  // ============================================================================
  // Кнопки
  // ============================================================================

  /// CTA L: высота 48, r12, label 17/w600.
  /// Заблокированная — фон strokeGrey, подпись вторичным цветом; причину
  /// блокировки спека требует объяснять рядом с кнопкой, а не в самой кнопке.
  static ButtonStyle canonCtaL({Color? backgroundColor}) =>
      ElevatedButton.styleFrom(
        backgroundColor: backgroundColor ?? primaryOrange,
        foregroundColor: textOnPrimary,
        disabledBackgroundColor: strokeGrey,
        disabledForegroundColor: textSecondary,
        elevation: 0,
        minimumSize: const Size(0, 48),
        padding: const EdgeInsets.symmetric(horizontal: 24),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusMedium),
        ),
        textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
      );

  /// Вторичная CTA: та же геометрия, outline 1.5px тем же цветом.
  static ButtonStyle canonCtaOutlined({Color? color}) =>
      OutlinedButton.styleFrom(
        foregroundColor: color ?? primaryOrange,
        side: BorderSide(color: color ?? primaryOrange, width: 1.5),
        minimumSize: const Size(0, 48),
        padding: const EdgeInsets.symmetric(horizontal: 24),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusMedium),
        ),
        textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
      );

  /// Компактная кнопка слота действий в хедере: высота 40, r10, рамка strokeGrey.
  static ButtonStyle canonHeaderAction() => OutlinedButton.styleFrom(
        foregroundColor: textDark,
        side: const BorderSide(color: strokeGrey),
        minimumSize: const Size(0, 40),
        padding: const EdgeInsets.symmetric(horizontal: 16),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusControl),
        ),
        textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
      );

  // ============================================================================
  // Поля ввода
  // ============================================================================

  static OutlineInputBorder _inputBorder(
    Color color, {
    double width = 1,
    double radius = radiusMedium,
  }) =>
      OutlineInputBorder(
        borderRadius: BorderRadius.circular(radius),
        borderSide: BorderSide(color: color, width: width),
      );

  /// Все состояния рамки заданы явно и намеренно.
  ///
  /// Урок из mobile: поле с `border: InputBorder.none` всё равно наследует
  /// `focusedBorder` и заливку из глобальной темы, если те не перекрыты —
  /// точечное «убрать рамку» на месте не работает. Глушить состояния нужно
  /// в самом виджете, а тема обязана быть предсказуемой.
  static InputDecorationTheme get _inputDecorationTheme => InputDecorationTheme(
        filled: true,
        fillColor: backgroundPrimary,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: _inputBorder(strokeGrey),
        enabledBorder: _inputBorder(strokeGrey),
        disabledBorder: _inputBorder(strokeGrey),
        focusedBorder: _inputBorder(primaryOrange, width: 1.5),
        errorBorder: _inputBorder(errorRed),
        focusedErrorBorder: _inputBorder(errorRed, width: 1.5),
        hintStyle: const TextStyle(fontSize: 15, color: textGrey),
        labelStyle: const TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w600,
          color: textDark,
        ),
        floatingLabelStyle: const TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w600,
          color: primaryOrangeDark,
        ),
        errorStyle: const TextStyle(fontSize: 12, color: errorRed),
      );

  // ============================================================================
  // Theme Data
  // ============================================================================

  static ThemeData get lightTheme {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,

      // Семейство по умолчанию — для поверхностей, которые не читают textTheme
      // (тултипы, снекбары, системные диалоги).
      fontFamily: fontBodyFamily,

      colorScheme: const ColorScheme.light(
        primary: primaryOrange,
        onPrimary: textOnPrimary,
        primaryContainer: primaryOrangeLight,
        onPrimaryContainer: textPrimary,
        secondary: textSecondary,
        onSecondary: textOnPrimary,
        secondaryContainer: backgroundWarm,
        onSecondaryContainer: textPrimary,
        tertiary: statusGreen,
        onTertiary: textOnPrimary,
        error: errorRed,
        onError: textOnPrimary,
        surface: backgroundPrimary,
        onSurface: textPrimary,
        surfaceContainerHighest: backgroundWarm,
        outline: strokeGrey,
      ),

      scaffoldBackgroundColor: backgroundPrimary,

      // Заголовочные слоты Material остаются на Nunito Sans: канонические
      // заголовки рисуются Unbounded через canon*-стили выше, а не через
      // textTheme. Жирнее w600 канон не использует — здесь тоже.
      textTheme: GoogleFonts.nunitoSansTextTheme(
        const TextTheme(
          headlineLarge: TextStyle(
              fontSize: 22, fontWeight: FontWeight.w600, color: textPrimary),
          headlineMedium: TextStyle(
              fontSize: 18, fontWeight: FontWeight.w600, color: textPrimary),
          headlineSmall: TextStyle(
              fontSize: 16, fontWeight: FontWeight.w600, color: textPrimary),
          titleLarge: TextStyle(
              fontSize: 18, fontWeight: FontWeight.w600, color: textPrimary),
          titleMedium: TextStyle(
              fontSize: 15, fontWeight: FontWeight.w600, color: textPrimary),
          titleSmall: TextStyle(
              fontSize: 13, fontWeight: FontWeight.w600, color: textPrimary),
          bodyLarge: TextStyle(fontSize: 15, color: textPrimary),
          bodyMedium: TextStyle(fontSize: 14, color: textPrimary),
          bodySmall: TextStyle(fontSize: 12, color: textSecondary),
          labelLarge: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
          labelMedium: TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
          labelSmall: TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
        ),
      ),

      cardTheme: CardThemeData(
        elevation: 0,
        color: backgroundPrimary,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusMedium),
          side: const BorderSide(color: strokeGrey),
        ),
        clipBehavior: Clip.antiAlias,
      ),

      elevatedButtonTheme: ElevatedButtonThemeData(style: canonCtaL()),
      outlinedButtonTheme: OutlinedButtonThemeData(style: canonCtaOutlined()),

      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: primaryOrangeDark,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(radiusControl),
          ),
          textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
        ),
      ),

      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(
          foregroundColor: textSecondary,
          highlightColor: brandTint(0.08),
        ),
      ),

      inputDecorationTheme: _inputDecorationTheme,

      // Вкладки: активная — 15/w600 тёмно-оранжевым с подчёркиванием 2px
      // брендовым; неактивная — 15/w500 тёмным. Нижняя граница полосы вкладок
      // рисуется самим TabBar через dividerColor.
      tabBarTheme: TabBarThemeData(
        labelColor: primaryOrangeDark,
        unselectedLabelColor: textDark,
        labelStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
        unselectedLabelStyle:
            const TextStyle(fontSize: 15, fontWeight: FontWeight.w500),
        indicatorColor: primaryOrange,
        indicatorSize: TabBarIndicatorSize.tab,
        dividerColor: borderLight,
        dividerHeight: 1,
        overlayColor: WidgetStatePropertyAll<Color>(brandTint(0.04)),
      ),

      chipTheme: ChipThemeData(
        backgroundColor: backgroundPrimary,
        selectedColor: brandTint(0.08),
        side: const BorderSide(color: strokeGrey),
        labelStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusPill),
        ),
      ),

      dividerTheme: const DividerThemeData(
        color: borderLight,
        thickness: 1,
        space: 1,
      ),

      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: primaryOrange,
      ),

      dialogTheme: DialogThemeData(
        backgroundColor: backgroundPrimary,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusLarge),
        ),
        titleTextStyle: TextStyle(
          fontFamily: fontDisplayFamily,
          fontSize: 20,
          fontWeight: FontWeight.w400,
          color: textPrimary,
        ),
      ),
    );
  }
}
