import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/moderation_vocabulary.dart';

// Карты машинных кодов дрейфуют от бэкенда МОЛЧА: новый код просто
// просачивается на экран как есть, ничего не ломая. В журнале действий такой
// дрейф уже случился — четыре действия писались в базу и не были переведены,
// и модератор читал «dismiss_sanity_flag (menu_item)».
//
// Поэтому каждая карта здесь закрыта проверкой на полноту, а наборы кодов
// продублированы явно: если бэкенд заведёт новый код, обновить придётся оба
// места, и забыть перевод молча уже не выйдет.

void main() {
  group('Типы сущностей журнала', () {
    test('карта покрывает весь набор entity_type', () {
      // Набор — из `backend/src/models/auditLogModel.js`, ветки CASE и
      // JOIN'ы по entity_type.
      expect(
        kAuditEntityTypes.keys.toSet(),
        <String>{'establishment', 'menu_item', 'review', 'user'},
      );
    });

    test('переводит, а незнакомое отдаёт как есть', () {
      expect(auditEntityLabel('menu_item'), 'Позиция меню');
      expect(auditEntityLabel('establishment'), 'Заведение');
      // Молчаливая подмена на «объект» скрыла бы расхождение с бэкендом.
      expect(auditEntityLabel('payment'), 'payment');
    });
  });

  group('Действия журнала', () {
    test('фильтр покрывает все действия, которые пишутся в журнал', () {
      // Набор совпадает со списком в admin-audit-log-summaries.test.js —
      // там он сверяется с живым API. Здесь проверяется другое: что фильтр
      // не отстаёт от таблицы. До этой правки в нём было восемь из
      // четырнадцати, и отфильтровать по прочитанному действию было нельзя.
      expect(
        kAuditActions.keys.toSet(),
        <String>{
          'moderate_approve',
          'moderate_reject',
          'suspend',
          'unsuspend',
          'claim_establishment',
          'admin_update_coordinates',
          'admin_update_slug',
          'review_hide',
          'review_show',
          'review_delete',
          'hide_menu_item',
          'unhide_menu_item',
          'dismiss_sanity_flag',
          'upgrade_user_to_partner',
        },
      );
    });
  });

  group('Флаги проверки позиций меню', () {
    test('карта покрывает все правила sanityChecker', () {
      // Набор — из `backend/src/services/ocr/sanityChecker.js`, фаза 1.
      expect(
        kSanityFlagReasons.keys.toSet(),
        <String>{
          'price_below_threshold',
          'price_above_threshold',
          'low_confidence',
          'price_delta_anomaly',
        },
      );
    });

    test('подпись правила по-русски', () {
      expect(sanityFlagLabel('price_above_threshold'), 'Цена выше порога');
      expect(sanityFlagLabel('low_confidence'),
          'Низкая уверенность распознавания');
      expect(sanityFlagLabel('unknown_rule'), 'unknown_rule');
    });
  });

  group('Фраза по флагу', () {
    test('цена выше порога называет обе величины', () {
      expect(
        describeSanityFlag(<String, dynamic>{
          'reason': 'price_above_threshold',
          'details': <String, dynamic>{'price': 1200, 'threshold': 1000},
        }),
        // Разделитель разрядов собираем тем же форматтером: в русской
        // локали это НЕРАЗРЫВНЫЙ пробел, и написать его в тесте обычным — значит
        // получить расхождение, невидимое глазом в отчёте о падении.
        'Цена ${formatCount(1200)} BYN при пороге ${formatCount(1000)} BYN',
      );
    });

    test('дробная цена не теряет копейки', () {
      expect(
        describeSanityFlag(<String, dynamic>{
          'reason': 'price_below_threshold',
          'details': <String, dynamic>{'price': 0.3, 'threshold': 0.5},
        }),
        'Цена 0,30 BYN при пороге 0,50 BYN',
      );
    });

    test('разряды группируются и у дробной суммы', () {
      // Иначе в одной фразе два разных формата числа: «1234,50» и «1 000».
      final phrase = describeSanityFlag(<String, dynamic>{
        'reason': 'price_above_threshold',
        'details': <String, dynamic>{'price': 1234.5, 'threshold': 1000},
      })!;
      expect(phrase, contains(formatCount(1000)));
      expect(phrase, isNot(contains('1234')));
    });

    test('уверенность — в процентах, а не долей', () {
      // 0.62 на экране модератора ничего не значит; 62% значит.
      expect(
        describeSanityFlag(<String, dynamic>{
          'reason': 'low_confidence',
          'details': <String, dynamic>{'confidence': 0.62, 'threshold': 0.7},
        }),
        'Уверенность распознавания 62% при пороге 70%',
      );
    });

    test('скачок цены называет направление и кратность', () {
      expect(
        describeSanityFlag(<String, dynamic>{
          'reason': 'price_delta_anomaly',
          'details': <String, dynamic>{
            'previousPrice': 10,
            'currentPrice': 40,
            'ratio': 4,
            'threshold': 3,
          },
        }),
        'Цена выросла с 10 до 40 BYN — в 4 раза',
      );
    });

    test('кратность склоняется по-русски', () {
      String phrase(num ratio) => describeSanityFlag(<String, dynamic>{
            'reason': 'price_delta_anomaly',
            'details': <String, dynamic>{
              'previousPrice': 10,
              'currentPrice': 10 * ratio,
              'ratio': ratio,
            },
          })!;

      // «в 5 раза» — то, что получается при склеивании без склонения.
      expect(phrase(5), endsWith('в 5 раз'));
      expect(phrase(4), endsWith('в 4 раза'));
      expect(phrase(21), endsWith('в 21 раз'));
      // Дробная кратность всегда «раза»: склоняется знаменатель.
      expect(phrase(3.5), endsWith('в 3,5 раза'));
    });

    test('падение цены названо падением', () {
      expect(
        describeSanityFlag(<String, dynamic>{
          'reason': 'price_delta_anomaly',
          'details': <String, dynamic>{
            'previousPrice': 40,
            'currentPrice': 10,
            'ratio': 4,
          },
        }),
        'Цена упала с 40 до 10 BYN — в 4 раза',
      );
    });

    test('числа из строк тоже разбираются', () {
      // pg отдаёт NUMERIC строкой на непроецируемых путях — фраза не должна
      // от этого разваливаться.
      expect(
        describeSanityFlag(<String, dynamic>{
          'reason': 'price_above_threshold',
          'details': <String, dynamic>{'price': '1200', 'threshold': '1000'},
        }),
        'Цена ${formatCount(1200)} BYN при пороге ${formatCount(1000)} BYN',
      );
    });

    test('незнакомое правило и неполные подробности дают null', () {
      // null — сигнал вызывающему показать исходную запись. Пустая строка
      // была бы хуже: новый вид флага стал бы невидимым.
      expect(
        describeSanityFlag(<String, dynamic>{'reason': 'quarantine'}),
        isNull,
      );
      expect(
        describeSanityFlag(<String, dynamic>{
          'reason': 'price_above_threshold',
          'details': <String, dynamic>{'price': 1200},
        }),
        isNull,
      );
      expect(describeSanityFlag(null), isNull);
      expect(describeSanityFlag(<String, dynamic>{}), isNull);
    });
  });
}
