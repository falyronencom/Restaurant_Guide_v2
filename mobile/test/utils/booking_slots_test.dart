import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/utils/booking_slots.dart';

/// Время в форме брони гостя. Найдено 09.10.2026: закрытие в 00:00 давало
/// ноль слотов (минуты закрытия считались от полуночи того же дня), и форма
/// писала «Заведение не работает в этот день».
///
/// Ожидания — литералы из часов работы, не вычисления той же формулой.
void main() {
  // Понедельник; день недели важен только для проверки выбора ключа дня.
  final monday = DateTime(2026, 10, 12);
  final tuesday = DateTime(2026, 10, 13);

  Map<String, dynamic> everyDay(Object hours) => {
        for (final day in [
          'monday',
          'tuesday',
          'wednesday',
          'thursday',
          'friday',
          'saturday',
          'sunday',
        ])
          day: hours,
      };

  group('закрытие в полночь и после неё', () {
    test('12:00–00:00: слоты до 23:30 включительно', () {
      final day = bookingSlotsFor(everyDay('12:00-00:00'), monday);

      expect(day.isClosed, isFalse);
      expect(day.slots.first, '12:00');
      expect(day.slots.last, '23:30');
      expect(day.slots, hasLength(24)); // 12:00 … 23:30 через полчаса
    });

    test('18:00–02:00 (объектом): с 18:00 до 23:30, ночных слотов нет', () {
      final day = bookingSlotsFor(
        everyDay({'is_open': true, 'open': '18:00', 'close': '02:00'}),
        monday,
      );

      expect(day.slots, [
        '18:00',
        '18:30',
        '19:00',
        '19:30',
        '20:00',
        '20:30',
        '21:00',
        '21:30',
        '22:00',
        '22:30',
        '23:00',
        '23:30',
      ]);
    });

    test('12:00–01:00: последний слот 23:30, а не 00:30', () {
      final day = bookingSlotsFor(everyDay('12:00-01:00'), monday);

      expect(day.slots.last, '23:30');
      expect(day.slots, isNot(contains('00:30')));
    });

    test('23:00–00:00: два слота — 23:00 и 23:30', () {
      expect(bookingSlotsFor(everyDay('23:00-00:00'), monday).slots,
          ['23:00', '23:30']);
    });
  });

  group('открытие равно закрытию', () {
    test('12:00–12:00 — сутки от часа открытия: с 12:00 до 23:30', () {
      final day = bookingSlotsFor(everyDay('12:00-12:00'), monday);

      expect(day.isClosed, isFalse,
          reason: 'отметка «Открыто» читает такие часы как открытые');
      expect(day.slots.first, '12:00');
      expect(day.slots.last, '23:30');
    });
  });

  group('обычный день', () {
    test('10:00–22:00: с 10:00, последний за полчаса до закрытия — 21:30', () {
      final day = bookingSlotsFor(everyDay('10:00-22:00'), monday);

      expect(day.slots.first, '10:00');
      expect(day.slots.last, '21:30');
      expect(day.slots, isNot(contains('22:00')));
    });

    test('часы с секундами «12:00:00» читаются, а не дают пустой день', () {
      final day = bookingSlotsFor(
        everyDay({'is_open': true, 'open': '12:00:00', 'close': '00:00:00'}),
        monday,
      );

      expect(day.slots.first, '12:00');
      expect(day.slots.last, '23:30');
    });

    test('однозначный час «9:00» читается', () {
      expect(bookingSlotsFor(everyDay('9:00-10:30'), monday).slots,
          ['09:00', '09:30', '10:00']);
    });
  });

  group('«не работает» — только по расписанию', () {
    test('is_open: false — день закрыт', () {
      final hours = everyDay('10:00-22:00')..['monday'] = {'is_open': false};

      expect(bookingSlotsFor(hours, monday).isClosed, isTrue);
      expect(bookingSlotsFor(hours, tuesday).isClosed, isFalse,
          reason: 'ключ дня берётся по дате: вторник открыт');
    });

    test('ключ дня берётся по дате — все семь дней, выходные не перепутаны',
        () {
      // 12–18.10.2026 — с понедельника по воскресенье, слова дней — те, что
      // в расписании на сервере (bookingService, DAY_KEYS). Тест выше
      // смотрит только понедельник и вторник: перепутанные суббота и
      // воскресенье показали бы гостю часы чужого дня, а бронь на них
      // сервер отклонил бы по своему расписанию.
      const keys = <String>[
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
      ];
      for (var closed = 0; closed < keys.length; closed++) {
        final hours = everyDay('10:00-22:00')
          ..[keys[closed]] = {'is_open': false};
        for (var day = 0; day < keys.length; day++) {
          expect(
            bookingSlotsFor(hours, DateTime(2026, 10, 12 + day)).isClosed,
            day == closed,
            reason: 'закрыт только ${keys[closed]}; '
                '${12 + day}.10.2026 — ${keys[day]}',
          );
        }
      }
    });

    test('дня нет в расписании — закрыт (сервер ответит CLOSED_DAY)', () {
      final hours = everyDay('10:00-22:00')..remove('monday');

      expect(bookingSlotsFor(hours, monday).isClosed, isTrue);
    });

    test('день открыт, но часов нет — не «закрыт», просто без слотов', () {
      final day = bookingSlotsFor(everyDay({'is_open': true}), monday);

      expect(day.isClosed, isFalse);
      expect(day.slots, isEmpty);
    });
  });
}
