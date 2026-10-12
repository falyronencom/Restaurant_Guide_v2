import 'dart:math' as math;

import 'package:restaurant_guide_mobile/models/establishment.dart';

/// Время, которое форма брони предлагает гостю на выбранную дату.
///
/// [isClosed] — заведение в этот день не работает: дня нет в расписании или
/// он помечен `is_open: false`. Сервер на такой день отвечает `CLOSED_DAY`.
/// Пустые [slots] при `isClosed == false` — день рабочий, но предложить
/// нечего (например, часы записаны без времени открытия).
class BookingDaySlots {
  const BookingDaySlots(this.slots) : isClosed = false;

  const BookingDaySlots.closed()
      : slots = const [],
        isClosed = true;

  final List<String> slots;
  final bool isClosed;
}

const _dayKeys = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const _minutesPerDay = 24 * 60;
const _step = 30;

/// Последний слот — 23:30: время после полуночи принадлежит следующей дате.
const _latestSlot = 23 * 60 + 30;

/// Слоты на дату [date] по часам работы [workingHours].
///
/// Правило то же, что у сервера (`bookingService.isTimeWithinRange`):
/// закрытие в момент открытия или раньше означает работу через полночь —
/// 12:00–00:00 и 18:00–02:00 открыты до конца суток, а 12:00–12:00 — те же
/// сутки от часа открытия (так их уже читает отметка «Открыто»,
/// [Establishment.isOpenAt]). Прежняя форма считала `close` числом минут
/// с полуночи того же дня: 00:00 давало 0, и слотов не было вовсе.
///
/// Форма предлагает подмножество окна, которое примет сервер: от открытия
/// через каждые 30 минут, последний — за полчаса до закрытия и не позже 23:30.
/// Ночные часы до открытия на этой дате не предлагаются: они — хвост
/// вчерашней смены, и сервер отклонит их как `TIME_OUTSIDE_HOURS`.
BookingDaySlots bookingSlotsFor(
  Map<String, dynamic>? workingHours,
  DateTime date,
) {
  if (workingHours == null) return const BookingDaySlots.closed();
  final day = Establishment.parseDayHours(
    workingHours[_dayKeys[date.weekday - 1]],
  );
  if (day == null || day['is_open'] == false) {
    return const BookingDaySlots.closed();
  }

  final opens = _minutes(day['open']);
  final closes = _minutes(day['close']);
  if (opens == null || closes == null) return const BookingDaySlots([]);

  final closesOnClock = closes <= opens ? closes + _minutesPerDay : closes;
  final last = math.min(closesOnClock - _step, _latestSlot);

  return BookingDaySlots([
    for (var m = opens; m <= last; m += _step) _label(m),
  ]);
}

int? _minutes(Object? value) {
  if (value is! String) return null;
  final match =
      RegExp(r'^(\d{1,2}):(\d{2})(?::\d{2})?$').firstMatch(value.trim());
  if (match == null) return null;
  return int.parse(match[1]!) * 60 + int.parse(match[2]!);
}

String _label(int minutes) => '${(minutes ~/ 60).toString().padLeft(2, '0')}:'
    '${(minutes % 60).toString().padLeft(2, '0')}';
