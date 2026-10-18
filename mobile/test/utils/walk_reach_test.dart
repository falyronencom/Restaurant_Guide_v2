// Расчёт прогулки (этап 4 «Избранного»): минуты, радиус, кто в круге,
// порядок, «Открыто сейчас», N и M.
//
// Ожидания — литералами из решения Координатора Р3 (17.10.2026): минуты =
// прямая × 1,3 / 4,8 км/ч, радиус = минуты × 4,8 км/ч / 1,3, «15 минут ≈
// 923 м». Точки на заданном расстоянии строятся вдоль меридиана — там
// расстояние по формуле гаверсинусов равно дуге: широта + метры / R.

import 'dart:math' as math;

import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/utils/geo.dart';
import 'package:restaurant_guide_mobile/utils/walk_reach.dart';

const GeoPoint _me = (latitude: 53.9000, longitude: 27.5600);

/// Точка в [meters] к северу от [_me]: по меридиану дуга = R × Δφ.
({double lat, double lng}) _north(double meters) => (
      lat: _me.latitude + meters / 6378137.0 * 180 / math.pi,
      lng: _me.longitude,
    );

const _days = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

/// Часы «всегда открыто» / «всегда закрыто» — открытость не зависит от
/// часов машины.
final _alwaysOpen = {for (final d in _days) d: '00:00-00:00'};
final _alwaysClosed = {
  for (final d in _days) d: {'is_open': false},
};

Establishment _place(
  String id, {
  double? meters,
  bool open = true,
}) {
  final at = meters == null ? null : _north(meters);
  return Establishment(
    id: id,
    name: 'Место $id',
    category: 'Кафе',
    address: 'ул. Ленина, 1',
    city: 'Минск',
    status: 'active',
    latitude: at?.lat,
    longitude: at?.lng,
    workingHours: open ? _alwaysOpen : _alwaysClosed,
    createdAt: DateTime(2026, 10, 17),
    updatedAt: DateTime(2026, 10, 17),
  );
}

void main() {
  group('радиус: минуты × 4,8 км/ч / 1,3', () {
    // 5 мин → 400 м / 1,3; 15 мин ≈ 923 м — число из решения Р3.
    const table = <int, double>{
      5: 307.6923,
      10: 615.3846,
      15: 923.0769,
      30: 1846.1538,
    };
    for (final entry in table.entries) {
      test('${entry.key} минут — ${entry.value} м', () {
        expect(walkRadiusMeters(entry.key), closeTo(entry.value, 0.001));
      });
    }
  });

  group('минуты: прямая × 1,3 / 4,8 км/ч, вверх до целой', () {
    // (метров, подпись). 80 м в минуту без запаса; с запасом 1 минута —
    // 61,54 м.
    final table = <(double, String)>[
      (0, '≈ 1 мин'), // ноль минут не пишем
      (61.5, '≈ 1 мин'), // 0,999 мин
      (62, '≈ 2 мин'), // 1,0075 мин
      (550, '≈ 9 мин'), // 8,94 мин; без запаса было бы 7
      (1000, '≈ 17 мин'), // 16,25 мин; без запаса — 13
      (walkRadiusMeters(15), '≈ 15 мин'), // ровно граница 15 минут — не «16»
      (924.0769, '≈ 16 мин'), // метром дальше
    ];
    for (final (meters, label) in table) {
      test('$meters м — «$label»', () {
        expect(walkMinutesLabel(meters), label);
      });
    }

    test('без округления: 800 м — ровно 13 минут (без запаса было бы 10)', () {
      expect(walkMinutesExact(800), closeTo(13.0, 1e-9));
    });
  });

  group('расстояние в подписи', () {
    final table = <(double, String)>[
      (4, '10 м'),
      (547, '550 м'),
      (994, '990 м'),
      (995, '1,0 км'),
      (1234, '1,2 км'),
      (1846, '1,8 км'),
    ];
    for (final (meters, label) in table) {
      test('$meters м — «$label»', () {
        expect(walkDistanceLabel(meters), label);
      });
    }
  });

  group('расстояние по прямой — как «км от вас» в списке', () {
    test('совпадает с Geolocator.distanceBetween', () {
      const points = <(GeoPoint, GeoPoint)>[
        (
          (latitude: 53.9045, longitude: 27.5615),
          (latitude: 53.9100, longitude: 27.5700)
        ),
        (
          (latitude: 53.9, longitude: 27.56),
          (latitude: 53.8800, longitude: 27.5300)
        ),
        (
          (latitude: 52.0976, longitude: 23.7341),
          (latitude: 52.0990, longitude: 23.7600)
        ),
      ];
      for (final (a, b) in points) {
        expect(
          metersBetween(a, b),
          closeTo(
              Geolocator.distanceBetween(
                  a.latitude, a.longitude, b.latitude, b.longitude),
              1e-6),
        );
      }
    });

    test('точка на расстоянии — на этом расстоянии по любому направлению', () {
      for (final bearing in [0.0, 45.0, 90.0, 180.0, 270.0, 333.0]) {
        final p = pointAtDistance(_me, 923.0769, bearing);
        expect(metersBetween(_me, p), closeTo(923.0769, 1e-6),
            reason: 'направление $bearing°');
      }
    });
  });

  group('кто в круге', () {
    final radius15 = walkRadiusMeters(15);

    test('внутри, на границе ±1 м, снаружи, без координат', () {
      final reach = walkReach(
        [
          _place('внутри', meters: 300),
          _place('на метр ближе границы', meters: radius15 - 1),
          _place('на метр дальше границы', meters: radius15 + 1),
          _place('снаружи', meters: 2000),
          _place('без координат'),
        ],
        from: _me,
        minutes: 15,
      );
      expect(reach.places.map((p) => p.establishment.id),
          ['внутри', 'на метр ближе границы']);
      expect(reach.shown, 2, reason: 'N');
      expect(reach.inCircle, 2);
      expect(reach.total, 5, reason: 'M — все места, и без координат');
    });

    test(
        'место на самом кольце — в круге и «≈ 15 мин», не 16: то же, что '
        'нарисовано', () {
      // Точки кольца стоят на радиусе с ошибкой вычисления в миллиардные
      // доли метра, в том числе наружу. Места в таких точках.
      final outward = [
        for (var bearing = 0; bearing < 360; bearing++)
          if (metersBetween(
                  _me, pointAtDistance(_me, radius15, bearing.toDouble())) >
              radius15)
            pointAtDistance(_me, radius15, bearing.toDouble()),
      ];
      expect(outward, isNotEmpty,
          reason: 'предпосылка: есть точки кольца чуть дальше радиуса');
      final places = [
        for (var i = 0; i < outward.length; i++)
          _place('кольцо $i').copyWith(
            latitude: outward[i].latitude,
            longitude: outward[i].longitude,
          ),
      ];
      final reach = walkReach(places, from: _me, minutes: 15);
      expect(reach.shown, outward.length);
      expect({for (final p in reach.places) p.minutes}, {15});
    });

    test('минуты шире — круг шире: 2 км только в 30 минутах нет', () {
      final places = [
        _place('400', meters: 400),
        _place('800', meters: 800),
        _place('1500', meters: 1500),
        _place('2000', meters: 2000),
      ];
      int n(int minutes) =>
          walkReach(places, from: _me, minutes: minutes).shown;
      expect([n(5), n(10), n(15), n(30)], [0, 1, 2, 3]);
    });

    test('порядок — по возрастанию минут, равные — как были', () {
      final reach = walkReach(
        [
          _place('дальнее', meters: 800),
          _place('ближнее', meters: 100),
          _place('среднее', meters: 400),
          _place('среднее-2', meters: 400),
        ],
        from: _me,
        minutes: 15,
      );
      expect(reach.places.map((p) => p.establishment.id),
          ['ближнее', 'среднее', 'среднее-2', 'дальнее']);
      expect(reach.places.map((p) => p.minutes), [2, 7, 7, 13]);
    });

    test('равные — как были и в длинном списке, больше 32 мест', () {
      // До 32 элементов List.sort в Dart — сортировка вставками, она и так не
      // переставляет равные, и список из четырёх мест не отличит «как были»
      // от случайного порядка. Начиная с 33 — быстрая сортировка, которая
      // равные переставляет (проверено на Dart SDK машины 18.10.2026: 40 мест
      // с ничьими выходят вразнобой). Каждое седьмое место ближе остальных.
      bool near(int i) => i % 7 == 3;
      final places = [
        for (var i = 0; i < 40; i++)
          _place('место $i', meters: near(i) ? 100 : 500),
      ];

      final reach = walkReach(places, from: _me, minutes: 15);

      expect(reach.places.map((p) => p.establishment.id), [
        for (var i = 0; i < 40; i++)
          if (near(i)) 'место $i',
        for (var i = 0; i < 40; i++)
          if (!near(i)) 'место $i',
      ]);
    });

    test('«Открыто сейчас» убирает закрытые из шторки и из N', () {
      final places = [
        _place('открытое', meters: 200),
        _place('закрытое', meters: 100, open: false),
        _place('открытое далеко', meters: 3000),
        _place('без координат'),
      ];
      final moment = DateTime(2026, 10, 17, 15, 0);
      final all = walkReach(places, from: _me, minutes: 15, at: moment);
      final open = walkReach(places,
          from: _me, minutes: 15, openNowOnly: true, at: moment);

      expect(
          all.places.map((p) => p.establishment.id), ['закрытое', 'открытое']);
      expect(open.places.map((p) => p.establishment.id), ['открытое']);
      expect((open.shown, open.inCircle, open.total), (1, 2, 4));
    });

    test('ничего в круге — пустая шторка, M прежнее', () {
      final reach = walkReach(
        [_place('далеко', meters: 5000), _place('без координат')],
        from: _me,
        minutes: 30,
      );
      expect(reach.places, isEmpty);
      expect((reach.shown, reach.inCircle, reach.total), (0, 0, 2));
    });

    test('в круге только закрытые, «Открыто сейчас» — пусто, но круг не пуст',
        () {
      final reach = walkReach(
        [_place('закрытое', meters: 100, open: false)],
        from: _me,
        minutes: 5,
        openNowOnly: true,
        at: DateTime(2026, 10, 17, 15, 0),
      );
      expect((reach.shown, reach.inCircle, reach.total), (0, 1, 1));
    });
  });

  group('подписи', () {
    test('чип и выбор минут', () {
      expect(kWalkMinuteOptions.map(walkMinutesChoiceLabel),
          ['5 минут', '10 минут', '15 минут', '30 минут']);
    });

    test('заголовок шторки — число мест склоняется', () {
      expect(walkReachTitle(1, 15), '1 место в 15 минутах');
      expect(walkReachTitle(3, 15), '3 места в 15 минутах');
      expect(walkReachTitle(5, 30), '5 мест в 30 минутах');
      expect(walkReachTitle(12, 10), '12 мест в 10 минутах');
      expect(walkReachTitle(21, 5), '21 место в 5 минутах');
    });
  });
}
