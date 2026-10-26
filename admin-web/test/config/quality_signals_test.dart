import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/config/quality_signals.dart';
import 'package:restaurant_guide_admin_web/models/quality_health_models.dart';

/// Словарь сигналов держит три вещи сразу: состав, порядок и привязку каждой
/// карточки к своему полю ответа. Разъехаться может любая из трёх, и последняя
/// разъезжается тише всех — перепутанные местами `countOf` дают одиннадцать
/// правдоподобных карточек с чужими числами.
///
/// Поэтому счётчики в фикстуре РАЗНЫЕ. На одинаковых числах перепутанная
/// привязка не отличима от верной, и тест соглашался бы с любым кодом.
QualityHealthData _data({
  int unreachable = 0,
  int categoryOffCanon = 0,
  int cuisineOffCanon = 0,
  int emptyMenus = 0,
  int ocrFailed = 0,
  int ocrStuck = 0,
  int outOfBounds = 0,
  int hoursMalformed = 0,
  int hoursAllClosed = 0,
  int nonObjectAttributes = 0,
  int hangingFlags = 0,
  int agedOver7d = 0,
  int agedOver30d = 0,
}) =>
    QualityHealthData(
      scope: 'active',
      generatedAt: '2026-08-27T09:41:00.000Z',
      unreachableCount: unreachable,
      categoryOffCanonCount: categoryOffCanon,
      cuisineOffCanonCount: cuisineOffCanon,
      emptyMenusCount: emptyMenus,
      ocrFailedCount: ocrFailed,
      ocrStuckCount: ocrStuck,
      outOfBoundsCount: outOfBounds,
      hoursMalformedCount: hoursMalformed,
      hoursAllClosedCount: hoursAllClosed,
      attributeKeys: const <AttributeKeyCount>[],
      nonObjectAttributesCount: nonObjectAttributes,
      hangingFlagsCount: hangingFlags,
      hangingAgedOver7d: agedOver7d,
      hangingAgedOver30d: agedOver30d,
      priceDistributionStatus: 'deferred',
    );

void main() {
  group('состав и привязка', () {
    test('одиннадцать сигналов, у каждого своё поле ответа', () {
      // Каждому полю — своё число. Если два сигнала смотрят в одно поле или
      // меняются местами, список результатов перестанет совпадать.
      final data = _data(
        unreachable: 1,
        hangingFlags: 2,
        emptyMenus: 3,
        hoursMalformed: 4,
        hoursAllClosed: 5,
        ocrFailed: 6,
        ocrStuck: 7,
        categoryOffCanon: 8,
        cuisineOffCanon: 9,
        outOfBounds: 10,
        nonObjectAttributes: 11,
      );

      expect(kQualitySignals, hasLength(11));
      expect(
        kQualitySignals.map((s) => s.countOf(data)).toList(),
        <int>[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      );
    });

    test('идентификаторы уникальны — по ним адресуются тесты и подписи', () {
      final ids = kQualitySignals.map((s) => s.id).toSet();
      expect(ids, hasLength(kQualitySignals.length));
    });

    test('канонический порядок — тот, что нарисован в кадре 04', () {
      // Убрать из порядка четыре проверки, стоящие в кадре на нуле, — и должна
      // остаться ровно последовательность красных карточек макета.
      final withoutMockupZeros = kQualitySignals
          .map((s) => s.id)
          .where((id) => !<String>{
                'category_off_canon',
                'ocr_stuck',
                'hours_all_closed',
                'non_object_attributes',
              }.contains(id))
          .toList();

      expect(withoutMockupZeros, <String>[
        'unreachable',
        'hanging_flags',
        'empty_menus',
        'hours_malformed',
        'ocr_failed',
        'cuisine_off_canon',
        'out_of_bounds',
      ]);
    });
  });

  group('красные, чистые, порядок отрисовки', () {
    test('красный — это счётчик больше нуля, порог именно нулевой', () {
      final data = _data(unreachable: 1, hangingFlags: 0);
      expect(redSignals(data).map((s) => s.id), <String>['unreachable']);
      expect(cleanSignals(data).map((s) => s.id), isNot(contains('unreachable')));
      expect(cleanSignals(data), hasLength(10));
    });

    test('проблемные первыми, внутри групп — канон', () {
      // Красные разбросаны по канону: 1-я, 6-я и 11-я позиции. После
      // перестановки они обязаны стоять первыми И в том же взаимном порядке.
      final data = _data(unreachable: 3, ocrFailed: 2, nonObjectAttributes: 1);
      final rendered = signalsProblemsFirst(data).map((s) => s.id).toList();

      expect(rendered.take(3), <String>[
        'unreachable',
        'ocr_failed',
        'non_object_attributes',
      ]);
      // Перестановка устойчивая: хвост сохраняет канонический порядок.
      expect(rendered.skip(3).toList(), <String>[
        'hanging_flags',
        'empty_menus',
        'hours_malformed',
        'hours_all_closed',
        'ocr_stuck',
        'category_off_canon',
        'cuisine_off_canon',
        'out_of_bounds',
      ]);
      expect(rendered, hasLength(11));
    });

    test('первая красная — по канону, а не по величине', () {
      // Дефект, который этот тест сторожит: подпись строки 3 на дашборде взяла
      // бы самый крупный счётчик. В кадре 02 написано «3 недостижимы в
      // sitemap» при двенадцати флагах рядом — значит правило другое.
      final data = _data(unreachable: 3, hangingFlags: 12);
      expect(redSignals(data).first.id, 'unreachable');
    });
  });

  group('подпись для панели «Требует внимания»', () {
    test('существительное склоняется по числу', () {
      final signal = kQualitySignals.firstWhere((s) => s.id == 'unreachable');
      expect(signal.note(1), '1 заведение без страницы на сайте');
      expect(signal.note(3), '3 заведения без страницы на сайте');
      expect(signal.note(12), '12 заведений без страницы на сайте');
    });

    test('разряды разделяются, как во всей админке', () {
      final signal = kQualitySignals.firstWhere((s) => s.id == 'hanging_flags');
      // Разделитель — НЕРАЗРЫВНЫЙ пробел: так его ставит русская локаль
      // `formatCount`, и так число не переносится по разряду. Обычный пробел
      // в ожидании дал бы падение, неотличимое глазом от совпадения.
      expect(signal.note(1248), '1 248 флагов без реакции');
    });

    test('у каждого сигнала подпись читается при любом числе', () {
      // Хвост подписи предложный и от числа не зависит — проверяем, что ни
      // один сигнал не завёл согласуемое слово в обход этого правила.
      for (final signal in kQualitySignals) {
        for (final count in <int>[1, 2, 5, 11, 21]) {
          final note = signal.note(count);
          expect(note, startsWith('$count '), reason: signal.id);
          expect(note, endsWith(signal.noteTail), reason: signal.id);
        }
      }
    });

    test('подпись каждого сигнала — своими словами, при 1, 2 и 5', () {
      // Тест выше сверяет подпись с хвостом из того же словаря — чужой хвост
      // у сигнала он принял бы. Здесь — литералы: две проверки, описанные
      // одними словами, на главной были бы неотличимы.
      final expected = <String, List<String>>{
        'unreachable': <String>[
          '1 заведение без страницы на сайте',
          '2 заведения без страницы на сайте',
          '5 заведений без страницы на сайте',
        ],
        'hanging_flags': <String>[
          '1 флаг без реакции',
          '2 флага без реакции',
          '5 флагов без реакции',
        ],
        'empty_menus': <String>[
          '1 заведение с пустым меню',
          '2 заведения с пустым меню',
          '5 заведений с пустым меню',
        ],
        'hours_malformed': <String>[
          '1 заведение с нечитаемым временем работы',
          '2 заведения с нечитаемым временем работы',
          '5 заведений с нечитаемым временем работы',
        ],
        'hours_all_closed': <String>[
          '1 заведение без единого рабочего дня',
          '2 заведения без единого рабочего дня',
          '5 заведений без единого рабочего дня',
        ],
        'ocr_failed': <String>[
          '1 задача распознавания меню с ошибкой',
          '2 задачи распознавания меню с ошибкой',
          '5 задач распознавания меню с ошибкой',
        ],
        'ocr_stuck': <String>[
          '1 задача распознавания меню в ожидании повтора',
          '2 задачи распознавания меню в ожидании повтора',
          '5 задач распознавания меню в ожидании повтора',
        ],
        'category_off_canon': <String>[
          '1 заведение с категорией не из справочника',
          '2 заведения с категорией не из справочника',
          '5 заведений с категорией не из справочника',
        ],
        'cuisine_off_canon': <String>[
          '1 заведение с кухней не из справочника',
          '2 заведения с кухней не из справочника',
          '5 заведений с кухней не из справочника',
        ],
        'out_of_bounds': <String>[
          '1 заведение с координатами вне границ',
          '2 заведения с координатами вне границ',
          '5 заведений с координатами вне границ',
        ],
        'non_object_attributes': <String>[
          '1 заведение с испорченным списком удобств',
          '2 заведения с испорченным списком удобств',
          '5 заведений с испорченным списком удобств',
        ],
      };
      expect(kQualitySignals.map((s) => s.id).toSet(), expected.keys.toSet());
      for (final signal in kQualitySignals) {
        expect(<String>[signal.note(1), signal.note(2), signal.note(5)],
            expected[signal.id], reason: signal.id);
      }
    });
  });

  group('область', () {
    test('шире активных заведений — ровно у трёх сигналов', () {
      final wider = kQualitySignals
          .where((s) => s.scopeNote != null)
          .map((s) => s.id)
          .toList();
      // Флаги — по решению этапа 7; обе задачи распознавания — потому что
      // сужение спрятало бы карточку, ждущую модерации без меню.
      expect(wider, <String>['hanging_flags', 'ocr_failed', 'ocr_stuck']);
    });
  });

  group('разбор ответа сервера', () {
    test('каждое число снимка — из своего ключа ответа', () {
      // Тесты экранов строят снимок конструктором, и ключи ответа не читал
      // никто: ключ под другим именем дал бы ноль — «0 флагов без реакции» на
      // главной и в «Здоровье данных», тревога молчит. Форма — как её
      // собирает бэкенд: `qualityHealthService.js` (блоки) и
      // `qualityHealthModel.js` (имена полей). Числа РАЗНЫЕ — перестановка
      // ключей не прошла бы.
      final data = QualityHealthData.fromJson(<String, dynamic>{
        'scope': 'active',
        'generated_at': '2026-10-25T09:41:00.000Z',
        'canon_reachability': <String, dynamic>{
          'unreachable_count': 1,
          'unreachable_samples': <dynamic>[],
          'category_offcanon_count': 2,
          'cuisine_offcanon_count': 3,
        },
        'menu_completeness': <String, dynamic>{
          'empty_menus_count': 4,
          'empty_menus_samples': <dynamic>[],
          'ocr_failed_count': 5,
          'ocr_stuck_count': 6,
        },
        'geo_bounds': <String, dynamic>{'count': 7, 'samples': <dynamic>[]},
        'working_hours': <String, dynamic>{
          'malformed_count': 8,
          'all_closed_count': 9,
          'samples': <dynamic>[],
        },
        'attribute_census': <String, dynamic>{
          'keys': <dynamic>[
            <String, dynamic>{'key': 'wifi', 'count': 10},
          ],
          'non_object_count': 11,
        },
        'hanging_flags': <String, dynamic>{
          'hanging_count': 12,
          'aged_over_7d': 13,
          'aged_over_30d': 14,
        },
        'price_distribution': <String, dynamic>{'status': 'deferred'},
      });

      // `scope` и `price_distribution.status` не проверяются: сервер шлёт
      // ровно умолчания разбора ('active', 'deferred'), и ключ под чужим
      // именем дал бы то же самое — проверка ничего бы не сторожила.
      expect(data.generatedAt, '2026-10-25T09:41:00.000Z');
      expect(data.unreachableCount, 1);
      expect(data.categoryOffCanonCount, 2);
      expect(data.cuisineOffCanonCount, 3);
      expect(data.emptyMenusCount, 4);
      expect(data.ocrFailedCount, 5);
      expect(data.ocrStuckCount, 6);
      expect(data.outOfBoundsCount, 7);
      expect(data.hoursMalformedCount, 8);
      expect(data.hoursAllClosedCount, 9);
      expect(data.attributeKeys.single.key, 'wifi');
      expect(data.attributeKeys.single.count, 10);
      expect(data.nonObjectAttributesCount, 11);
      expect(data.hangingFlagsCount, 12);
      expect(data.hangingAgedOver7d, 13);
      expect(data.hangingAgedOver30d, 14);
    });
  });

  group('устойчивость разбора', () {
    test('мусор в одном примере не роняет весь снимок', () {
      // Приведение `as String?` бросало на числе, исключение всплывало до
      // провайдера и подменяло ВЕСЬ экран карточкой «Снимок не загрузился» —
      // одиннадцать проверок исчезали из-за одного поля в одном примере.
      final data = QualityHealthData.fromJson(<String, dynamic>{
        'canon_reachability': <String, dynamic>{
          'unreachable_count': 2,
          'unreachable_samples': <dynamic>[
            <String, dynamic>{'id': 4, 'name': null, 'city': <int>[1]},
            <String, dynamic>{'id': 'ok', 'name': 'Нормальное', 'city': 'Минск'},
          ],
        },
        'attribute_census': <String, dynamic>{
          'keys': <dynamic>[
            null,
            'не объект',
            <String, dynamic>{'key': 'wifi', 'count': 7},
          ],
        },
      });

      expect(data.unreachableCount, 2);
      expect(data.unreachableSamples.map((s) => s.name), <String>['—', 'Нормальное']);
      expect(data.unreachableSamples.first.city, isNull);
      // Мусор из переписи отсеян, живой ключ доехал.
      expect(data.attributeKeys.map((k) => k.key), <String>['wifi']);
    });
  });

  group('примеры заведений', () {
    test('доходят ровно до тех пяти сигналов, для которых их собирает бэкенд',
        () {
      // Разбирается ответ целиком, а не подсовываются готовые списки: так тест
      // сторожит и привязку сигнала к своему полю. Если `samplesOf` у двух
      // сигналов перепутать, имена окажутся под чужими заголовками — и ниже
      // это видно поимённо, а не по одной длине.
      final data = QualityHealthData.fromJson(<String, dynamic>{
        'canon_reachability': <String, dynamic>{
          'unreachable_count': 1,
          'unreachable_samples': <dynamic>[
            <String, dynamic>{'id': '1', 'name': 'Недостижимое', 'city': 'Минск'},
          ],
        },
        'menu_completeness': <String, dynamic>{
          'empty_menus_count': 1,
          'empty_menus_samples': <dynamic>[
            <String, dynamic>{'id': '2', 'name': 'Пустое меню', 'city': 'Брест'},
          ],
        },
        'geo_bounds': <String, dynamic>{
          'count': 1,
          'samples': <dynamic>[
            <String, dynamic>{
              'id': '3',
              'name': 'Вне границ',
              'city': 'Гродно',
              'reason': 'outside_belarus',
            },
          ],
        },
        'working_hours': <String, dynamic>{
          'malformed_count': 1,
          'all_closed_count': 1,
          'samples': <dynamic>[
            <String, dynamic>{
              'id': '4',
              'name': 'Битые часы',
              'city': 'Витебск',
              'malformed': true,
              'all_closed': false,
            },
            <String, dynamic>{
              'id': '5',
              'name': 'Закрыто всегда',
              'city': 'Гомель',
              'malformed': false,
              'all_closed': true,
            },
          ],
        },
      });

      final named = <String, List<String>>{
        for (final s in kQualitySignals)
          if ((s.samplesOf?.call(data) ?? const <QualitySample>[]).isNotEmpty)
            s.id: s.samplesOf!(data).map((e) => e.name).toList(),
      };

      expect(named, <String, List<String>>{
        'unreachable': <String>['Недостижимое'],
        'empty_menus': <String>['Пустое меню'],
        'hours_malformed': <String>['Битые часы'],
        'hours_all_closed': <String>['Закрыто всегда'],
        'out_of_bounds': <String>['Вне границ'],
      });
    });

    test('диагноз строится по правилу своего сигнала', () {
      final data = QualityHealthData.fromJson(<String, dynamic>{
        'canon_reachability': <String, dynamic>{
          'unreachable_count': 3,
          'unreachable_samples': <dynamic>[
            <String, dynamic>{
              'id': '1',
              'name': 'Без города',
              'city_slug': null,
              'category_slug': 'restoran',
            },
            <String, dynamic>{
              'id': '2',
              'name': 'Без категории',
              'city_slug': 'minsk',
              'category_slug': null,
            },
            <String, dynamic>{
              'id': '3',
              'name': 'Без обоих',
              'city_slug': null,
              'category_slug': null,
            },
          ],
        },
      });

      final signal = kQualitySignals.firstWhere((s) => s.id == 'unreachable');
      // Ради этого раскрытие и делалось: видно, ЧТО чинить в каждой карточке.
      expect(
        signal.samplesOf!(data).map((s) => s.detail).toList(),
        <String>[
          'город не в каноне',
          'категория не в каноне',
          'ни город, ни категория не в каноне',
        ],
      );
    });

    test('диагноз координат и часов — у каждой поломки свой', () {
      // Имя теста выше обещает правило «своего сигнала» — у четырёх сигналов
      // с диагнозом. Здесь остальные три. Причины геозоны — значения поля
      // `reason` бэкенда (`qualityHealthModel.js`, getOutOfBoundsEstablishments).
      final data = QualityHealthData.fromJson(<String, dynamic>{
        'geo_bounds': <String, dynamic>{
          'count': 2,
          'samples': <dynamic>[
            <String, dynamic>{
              'id': '1',
              'name': 'За границей',
              'city': 'Брест',
              'reason': 'outside_belarus',
            },
            <String, dynamic>{
              'id': '2',
              'name': 'В чужом городе',
              'city': 'Гродно',
              'reason': 'city_mismatch',
            },
          ],
        },
        'working_hours': <String, dynamic>{
          'malformed_count': 1,
          'all_closed_count': 1,
          'samples': <dynamic>[
            <String, dynamic>{'id': '3', 'name': 'Битые', 'malformed': true},
            <String, dynamic>{'id': '4', 'name': 'Закрытые', 'all_closed': true},
          ],
        },
      });

      List<String?> details(String id) => kQualitySignals
          .firstWhere((s) => s.id == id)
          .samplesOf!(data)
          .map((s) => s.detail)
          .toList();

      expect(details('out_of_bounds'),
          <String>['точка вне Беларуси', 'точка не в своём городе']);
      expect(details('hours_malformed'), <String>['часы работы не читаются']);
      expect(details('hours_all_closed'), <String>['закрыто во все дни']);
    });

    test('пустой снимок не выдумывает примеров ни одному сигналу', () {
      final data = _data();
      for (final signal in kQualitySignals) {
        expect(signal.samplesOf?.call(data) ?? const <QualitySample>[],
            isEmpty, reason: signal.id);
      }
    });
  });
}
