import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';

// Даты в админке форматируются РУКАМИ, а не через `DateFormat(..., 'ru')`.
// Две причины, и обе проверяемы: данные локали `intl` подгружает
// `GlobalMaterialLocalizations` при старте приложения, поэтому в виджет-тесте
// тот же вызов бросает `LocaleDataException`; и `MMMM` даёт месяц вне
// контекста даты — «14 июль» вместо «14 июля».
//
// Раз формат наш, то и правила склонения наши — и проверять их некому, кроме
// этих тестов.

void main() {
  group('День и месяц', () {
    test('месяц в родительном падеже', () {
      expect(
        formatDayMonthLocal(DateTime(2026, 7, 14), now: DateTime(2026, 8, 25)),
        '14 июля',
      );
      expect(
        formatDayMonthLocal(DateTime(2026, 3, 1), now: DateTime(2026, 8, 25)),
        '1 марта',
      );
      expect(
        formatDayMonthLocal(DateTime(2026, 5, 9), now: DateTime(2026, 8, 25)),
        '9 мая',
      );
    });

    test('все двенадцать месяцев названы', () {
      final names = <String>[
        for (var month = 1; month <= 12; month++)
          formatDayMonthLocal(
            DateTime(2026, month, 1),
            now: DateTime(2026, 8, 25),
          ),
      ];

      expect(names, <String>[
        '1 января',
        '1 февраля',
        '1 марта',
        '1 апреля',
        '1 мая',
        '1 июня',
        '1 июля',
        '1 августа',
        '1 сентября',
        '1 октября',
        '1 ноября',
        '1 декабря',
      ]);
    });

    test('год добавляется только когда он не текущий', () {
      // В журнале за последние 30 дней год — шум...
      expect(
        formatDayMonthLocal(DateTime(2026, 8, 20), now: DateTime(2026, 8, 25)),
        '20 августа',
      );
      // ...а у записи прошлого года его отсутствие — дезинформация.
      expect(
        formatDayMonthLocal(DateTime(2025, 8, 20), now: DateTime(2026, 8, 25)),
        '20 августа 2025',
      );
    });
  });

  group('Время', () {
    test('часы и минуты с ведущим нулём', () {
      expect(formatTimeLocal(DateTime(2026, 7, 14, 9, 41)), '09:41');
      expect(formatTimeLocal(DateTime(2026, 7, 14, 18, 3)), '18:03');
      expect(formatTimeLocal(DateTime(2026, 7, 14, 0, 0)), '00:00');
    });
  });

  group('Сколько прошло', () {
    final now = DateTime(2026, 8, 25, 12, 0);

    test('меньше минуты — «только что»', () {
      expect(
        formatRelativePast(now.subtract(const Duration(seconds: 40)), now: now),
        'только что',
      );
    });

    test('минуты склоняются', () {
      expect(
        formatRelativePast(now.subtract(const Duration(minutes: 1)), now: now),
        '1 минуту назад',
      );
      expect(
        formatRelativePast(now.subtract(const Duration(minutes: 4)), now: now),
        '4 минуты назад',
      );
      expect(
        formatRelativePast(now.subtract(const Duration(minutes: 11)), now: now),
        '11 минут назад',
      );
      expect(
        formatRelativePast(now.subtract(const Duration(minutes: 21)), now: now),
        '21 минуту назад',
      );
    });

    test('часы склоняются', () {
      expect(
        formatRelativePast(now.subtract(const Duration(hours: 1)), now: now),
        '1 час назад',
      );
      expect(
        formatRelativePast(now.subtract(const Duration(hours: 2)), now: now),
        '2 часа назад',
      );
      expect(
        formatRelativePast(now.subtract(const Duration(hours: 5)), now: now),
        '5 часов назад',
      );
    });

    test('дни склоняются', () {
      expect(
        formatRelativePast(now.subtract(const Duration(days: 1)), now: now),
        '1 день назад',
      );
      expect(
        formatRelativePast(now.subtract(const Duration(days: 3)), now: now),
        '3 дня назад',
      );
      expect(
        formatRelativePast(now.subtract(const Duration(days: 12)), now: now),
        '12 дней назад',
      );
    });

    test('часы клиента, убежавшие вперёд, не дают отрицательного счёта', () {
      // «−2 минуты назад» сообщало бы о неисправности часов, а не о журнале.
      expect(
        formatRelativePast(now.add(const Duration(minutes: 2)), now: now),
        'только что',
      );
    });
  });
}
