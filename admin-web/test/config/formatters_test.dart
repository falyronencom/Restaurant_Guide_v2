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

  group('Доля от целого', () {
    test('один знак после запятой — доли статусов различимы', () {
      // Округление до целых слило бы «1,7%» и «2,2%» в одинаковые «2%».
      expect(formatShare(365, 412), '88,6%');
      expect(formatShare(7, 412), '1,7%');
      expect(formatShare(9, 412), '2,2%');
    });

    test('пустое целое даёт ноль в той же форме, а не NaN', () {
      expect(formatShare(0, 0), '0,0%');
      expect(formatShare(5, 0), '0,0%');
      // Та же форма, что у нулевой доли непустого: две записи нуля в одной
      // колонке читались бы как две разные величины.
      expect(formatShare(0, 412), '0,0%');
    });

    test('целое даёт сто процентов', () {
      expect(formatShare(412, 412), '100,0%');
    });
  });

  group('Окно периода словами', () {
    DateTime utc(int y, int m, int d) => DateTime.utc(y, m, d);

    test('разные месяцы — год один раз в конце', () {
      expect(
        formatPeriodRangeUtc(utc(2026, 7, 12), utc(2026, 8, 10)),
        '12 июля — 10 августа 2026',
      );
    });

    test('один месяц — месяц не повторяется', () {
      expect(
        formatPeriodRangeUtc(utc(2026, 8, 1), utc(2026, 8, 10)),
        '1 — 10 августа 2026',
      );
    });

    test('один день — одна дата', () {
      expect(
        formatPeriodRangeUtc(utc(2026, 8, 10), utc(2026, 8, 10)),
        '10 августа 2026',
      );
    });

    test('разные годы — год у обеих границ', () {
      expect(
        formatPeriodRangeUtc(utc(2025, 12, 28), utc(2026, 1, 10)),
        '28 декабря 2025 — 10 января 2026',
      );
    });

    test('границы читаются по UTC, а не по поясу браузера', () {
      // Окно задано в сутках UTC — по ним же группируются столбцы. Перевод в
      // местное время сдвинул бы подпись относительно посчитанного: на UTC+3
      // полночь 10 августа UTC — это 03:00 того же дня, а на UTC−5 — вечер
      // девятого, и подпись разошлась бы с данными на день.
      final instant = DateTime.utc(2026, 8, 10);
      expect(
        formatPeriodRangeUtc(instant, instant),
        formatPeriodRangeUtc(instant.toLocal(), instant.toLocal()),
      );
    });
  });

  group('Месяц для оси', () {
    test('сокращённая форма без данных локали', () {
      // Список написан руками именно затем, чтобы месячную агрегацию можно
      // было покрыть тестом: DateFormat('MMM','ru') здесь бросает.
      expect(formatMonthShort(DateTime(2026, 1, 15)), 'янв');
      expect(formatMonthShort(DateTime(2026, 8, 1)), 'авг');
      expect(formatMonthShort(DateTime(2026, 12, 31)), 'дек');
    });
  });
}
