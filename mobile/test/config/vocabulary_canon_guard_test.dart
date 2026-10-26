import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/config/establishment_attributes.dart';
import 'package:restaurant_guide_mobile/models/filter_options.dart';
import 'package:restaurant_guide_mobile/models/notification_model.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';

/// Сторож трёх словарей мобильного фильтра против канона бэкенда.
///
/// Зачем: ключи фильтра уходят на бэкенд как есть (`features` → провайдер →
/// `establishments_service`), а `searchService` строит по каждому условие
/// «значение ключа в `attributes` — JSON true» БЕЗ белого списка. Ключ, которого нет
/// ни на одной карточке, даёт NULL, строка не проходит, а условия соединяются
/// через AND — то есть один мёртвый ключ обнуляет и все остальные выбранные
/// фильтры. Отказ молчаливый: приложение не падает, а честно отвечает, что
/// ничего не найдено.
///
/// Эталон ниже — зеркало `backend/src/constants/establishmentVocab.js`.
/// Общего источника у Dart и JS нет, поэтому список продублирован здесь
/// намеренно: сторож существует ровно затем, чтобы дубль не разошёлся молча.
/// При изменении канона на бэкенде этот тест обязан покраснеть первым.
void main() {
  // backend/src/constants/establishmentVocab.js → VALID_CATEGORIES (15)
  const canonCategories = <String>{
    'Ресторан', 'Кофейня', 'Кафе', 'Фаст-фуд', 'Бар', 'Кондитерская',
    'Пиццерия', 'Пекарня', 'Паб', 'Столовая', 'Кальянная', 'Боулинг',
    'Караоке', 'Бильярд', 'Клуб',
  };

  // backend/src/constants/establishmentVocab.js → VALID_CUISINES (12)
  const canonCuisines = <String>{
    'Народная', 'Авторская', 'Азиатская', 'Американская', 'Вегетарианская',
    'Японская', 'Грузинская', 'Итальянская', 'Смешанная', 'Европейская',
    'Китайская', 'Восточная',
  };

  // backend/src/constants/establishmentVocab.js → ATTRIBUTE_CANON (10),
  // ратифицирован SDL CAT-C-3.15.
  const canonAttributes = <String>{
    'delivery', 'wifi', 'terrace', 'parking', 'live_music', 'kids_zone',
    'banquet', 'pets_allowed', 'smoking', 'accessible_environment',
  };

  /// Канонический ключ, который приложение намеренно НЕ предлагает в фильтре:
  /// его нечем нарисовать. Карточка заведения знает девять атрибутов, и на
  /// каждый есть иконка в `assets/icons/`; на доступную среду иконки нет, а
  /// `ATTRIBUTE_LABELS` в web её тоже не несёт. Предложить фильтр, результат
  /// которого гость не сможет подтвердить глазами, — хуже, чем не предложить.
  /// Разрыв закреплён здесь, чтобы он не разошёлся молча: появится иконка —
  /// этот тест покраснеет и потребует внести ключ в фильтр.
  const deliberatelyNotOffered = <String>{'accessible_environment'};

  group('Словари фильтра против канона бэкенда', () {
    test('категории совпадают с каноном ровно', () {
      expect(FilterConstants.categories.toSet(), canonCategories);
      expect(FilterConstants.categories.length, canonCategories.length,
          reason: 'дубль в списке категорий');
    });

    test('кухни совпадают с каноном ровно', () {
      expect(FilterConstants.cuisines.toSet(), canonCuisines);
      expect(FilterConstants.cuisines.length, canonCuisines.length,
          reason: 'дубль в списке кухонь');
    });

    test('ни один ключ удобств не выходит за канон', () {
      final offered = FilterConstants.amenities.keys.toSet();
      final dead = offered.difference(canonAttributes);
      expect(
        dead,
        isEmpty,
        reason: 'ключи вне канона бэкенда гарантированно дают пустую выдачу и '
            'обнуляют все остальные выбранные фильтры: $dead',
      );
    });

    test('предложены все канонические ключи, кроме намеренно отложенных', () {
      final offered = FilterConstants.amenities.keys.toSet();
      expect(canonAttributes.difference(offered), deliberatelyNotOffered);
    });

    test('у каждого предложенного удобства есть непустая подпись', () {
      for (final entry in FilterConstants.amenities.entries) {
        expect(entry.value.trim(), isNotEmpty,
            reason: 'пустая подпись у ключа ${entry.key}');
      }
    });
  });

  // ==========================================================================
  // Четвёртое пространство ключей — типы уведомлений.
  // Найдено 07.09.2026 при разборе контракта провода: `NotificationType`
  // знал шестнадцать типов из семнадцати, а `fromString` на неизвестном
  // значении молча отдаёт `newReview`. «Позиция меню скрыта модератором»
  // приезжала со звездой отзыва, жёлтым цветом и в чужую вкладку фильтра.
  // ==========================================================================

  // backend/src/services/notificationService.js → TITLES (17)
  const canonNotificationTypes = <String>[
    'establishment_approved',
    'establishment_rejected',
    'establishment_suspended',
    'establishment_unsuspended',
    'establishment_claimed',
    'new_review',
    'partner_response',
    'review_hidden',
    'review_deleted',
    'booking_received',
    'booking_confirmed',
    'booking_declined',
    'booking_expired',
    'booking_cancelled',
    'promotion_new',
    'menu_parsed',
    'menu_item_hidden_by_admin',
  ];

  group('Типы уведомлений против канона бэкенда', () {
    test('каждый тип бэкенда разбирается в СВОЙ тип приложения', () {
      // `NotificationType.fromString` не умеет сказать «не знаю»: неизвестное
      // значение становится `newReview`. Поэтому нераспознанный тип виден
      // только по столкновению — два разных кода бэкенда дали один тип
      // приложения, значит один из них на самом деле не разобран.
      final seen = <NotificationType, String>{};
      final collisions = <String>[];

      for (final code in canonNotificationTypes) {
        final parsed = NotificationType.fromString(code);
        if (seen.containsKey(parsed)) {
          collisions.add('$code → ${parsed.name}, уже занят «${seen[parsed]}»');
        } else {
          seen[parsed] = code;
        }
      }

      expect(
        collisions,
        isEmpty,
        reason: 'тип с бэкенда подменён чужим: $collisions. Уведомление '
            'получит чужую иконку, чужой цвет и чужую вкладку, оставаясь '
            'на вид исправным',
      );
    });

    test('каждый код бэкенда разбирается в свой тип — по имени, не только '
        'без столкновений', () {
      // Тест выше ловит только столкновения: два кода, перепутанные местами
      // («одобрено» ↔ «отклонено»), столкновения не дают. Здесь — пара за
      // парой: код бэкенда литералом и тип приложения, который он означает.
      const expected = <String, NotificationType>{
        'establishment_approved': NotificationType.establishmentApproved,
        'establishment_rejected': NotificationType.establishmentRejected,
        'establishment_suspended': NotificationType.establishmentSuspended,
        'establishment_unsuspended': NotificationType.establishmentUnsuspended,
        'establishment_claimed': NotificationType.establishmentClaimed,
        'new_review': NotificationType.newReview,
        'partner_response': NotificationType.partnerResponse,
        'review_hidden': NotificationType.reviewHidden,
        'review_deleted': NotificationType.reviewDeleted,
        'booking_received': NotificationType.bookingReceived,
        'booking_confirmed': NotificationType.bookingConfirmed,
        'booking_declined': NotificationType.bookingDeclined,
        'booking_expired': NotificationType.bookingExpired,
        'booking_cancelled': NotificationType.bookingCancelled,
        'promotion_new': NotificationType.promotionNew,
        'menu_parsed': NotificationType.menuParsed,
        'menu_item_hidden_by_admin': NotificationType.menuItemHiddenByAdmin,
      };
      expect(expected.keys.toSet(), canonNotificationTypes.toSet(),
          reason: 'таблица пар обязана покрывать весь канон');
      for (final MapEntry(key: code, value: type) in expected.entries) {
        expect(NotificationType.fromString(code), type, reason: code);
      }
    });

    test('в приложении нет типов сверх канона бэкенда', () {
      // Обратное направление: тип, которого бэкенд не шлёт, — мёртвая ветка
      // в трёх switch подряд, и она переживёт удаление типа на бэкенде.
      expect(NotificationType.values, hasLength(canonNotificationTypes.length));
    });
  });

  // ==========================================================================
  // Пятое пространство ключей — города.
  // Поиск фильтрует строгим равенством (`e.city = $1` в searchService), а
  // бэкенд принимает ОБА написания Могилёва. Город, записанный не тем
  // написанием, для мобильного фильтра не существует, и отказ молчаливый:
  // приложение честно отвечает, что заведений в городе нет.
  // ==========================================================================

  // backend/src/services/establishmentService.js → VALID_CITIES (8)
  const canonCities = <String>{
    'Минск', 'Гродно', 'Брест', 'Гомель', 'Витебск',
    'Могилев', 'Могилёв', 'Бобруйск',
  };

  group('Города против канона бэкенда', () {
    test('каждый город приложения принимается бэкендом', () {
      final offered =
          BelarusCities.citiesWithRegions.map((c) => c['city']!).toSet();
      expect(
        offered.difference(canonCities),
        isEmpty,
        reason: 'город вне канона бэкенда даст пустую выдачу при строгом '
            'сравнении e.city = \$1',
      );
    });

    test('город по умолчанию входит в список выбора', () {
      final offered =
          BelarusCities.citiesWithRegions.map((c) => c['city']!).toSet();
      expect(offered, contains(BelarusCities.defaultCity));
    });

    test('ГРАНИЦА: из двух написаний Могилёва приложение шлёт одно', () {
      // Бэкенд принимает и «Могилев», и «Могилёв»; канонизация URL в web
      // (`urlSlugs.js`) обратным отображением отдаёт «Могилев» — через «е».
      // Мобильный фильтр шлёт «Могилёв» через «ё», а поиск сравнивает строки
      // точно. Карточка, записанная через «е», в мобильной выдаче не
      // появится, и выглядеть это будет как «в городе пока ничего нет».
      //
      // Разрыв закреплён здесь намеренно: закрыть его должен бэкенд
      // (нормализация ё→е при записи и при сравнении), приложение своими
      // силами этого сделать не может. Тест обязан покраснеть, если список
      // городов правят, не разобравшись с этой парой.
      final offered =
          BelarusCities.citiesWithRegions.map((c) => c['city']!).toSet();

      expect(offered.contains('Могилёв'), isTrue);
      expect(
        offered.contains('Могилев'),
        isFalse,
        reason: 'если появилось второе написание — значит пару начали чинить '
            'на клиенте; проверьте, что бэкенд и данные согласованы',
      );
    });
  });

  // ==========================================================================
  // Копии канона выше — против самого исходника бэкенда.
  // Шапка обещает, что при правке канона на бэкенде этот файл покраснеет
  // первым, но копии сверяли приложение с собой: исходник бэкенда не читался.
  // CI вынимает репозиторий целиком, `../backend` рядом есть всегда (так же
  // читает канон `admin-web/test/config/establishment_vocabulary_test.dart`).
  // ==========================================================================

  group('Копии канона — против исходника бэкенда', () {
    final vocab =
        File('../backend/src/constants/establishmentVocab.js').readAsStringSync();
    final service = File('../backend/src/services/establishmentService.js')
        .readAsStringSync();

    test('категории, кухни и удобства — те же, что в establishmentVocab.js', () {
      expect(_jsArray(vocab, 'VALID_CATEGORIES').toSet(), canonCategories);
      expect(_jsArray(vocab, 'VALID_CUISINES').toSet(), canonCuisines);
      expect(_jsArray(vocab, 'ATTRIBUTE_CANON').toSet(), canonAttributes);
    });

    test('типы уведомлений — те же, что TITLES в notificationService.js', () {
      final source = File('../backend/src/services/notificationService.js')
          .readAsStringSync();
      final start = source.indexOf('const TITLES = {');
      expect(start, isNonNegative, reason: 'в исходнике нет TITLES');
      final body = source.substring(start, source.indexOf('};', start));
      final codes = RegExp(r'^\s*(\w+):', multiLine: true)
          .allMatches(body)
          .map((m) => m.group(1)!)
          .toSet();
      expect(codes, isNotEmpty, reason: 'TITLES разобрался пустым');
      expect(codes, canonNotificationTypes.toSet());
    });

    test('города — те же, что VALID_CITIES в establishmentService.js', () {
      expect(_jsArray(service, 'VALID_CITIES').toSet(), canonCities);
    });
  });

  // ==========================================================================
  // Словари вне фильтра: карточка гостя (читатель ключей удобств) и мастер
  // партнёра (писатель категорий, кухонь и города). Ключ или название не из
  // канона здесь отказывает молча: гость не видит удобство, которое заявлено,
  // сервер отклоняет карточку партнёра. Ключи удобств мастера
  // (`AttributeOptions`) сюда намеренно не входят: три из них не из канона
  // (`banquets`, `kids`, `pets`) — известный дефект, отложен (SDL
  // CAT-C-3.15.3); честная сверка красная и закрепляется вместе с правкой
  // продукта.
  // ==========================================================================

  group('Словари карточки гостя и мастера партнёра против канона', () {
    test('карточка гостя знает все удобства канона, кроме намеренно '
        'отложенных, и ни одного сверх', () {
      final keys = EstablishmentAttributes.canon.map((a) => a['key']!).toSet();
      expect(keys, canonAttributes.difference(deliberatelyNotOffered));
      expect(EstablishmentAttributes.canon, hasLength(keys.length),
          reason: 'дубль в словаре карточки');
    });

    test('каждый город мастера партнёра принимается бэкендом', () {
      expect(CityOptions.cities.toSet().difference(canonCities), isEmpty,
          reason: 'сервер отклонит карточку с этим городом (INVALID_CITY)');
    });

    test('каждая категория и кухня мастера уходит на сервер названием из '
        'канона — все 15 и все 12', () {
      final sentCategories = <String>{
        for (final item in CategoryOptions.items)
          ...(PartnerRegistration(categories: [item.id]).toJson()['categories']
              as List)
              .cast<String>(),
      };
      final sentCuisines = <String>{
        for (final item in CuisineOptions.items)
          ...(PartnerRegistration(cuisineTypes: [item.id]).toJson()['cuisines']
              as List)
              .cast<String>(),
      };

      expect(sentCategories, canonCategories);
      expect(sentCuisines, canonCuisines);
    });
  });
}

/// Строковые элементы массива `const NAME = …[ … ]` из исходника JS
/// бэкенда — тот же разбор, что в
/// `admin-web/test/config/establishment_vocabulary_test.dart`.
List<String> _jsArray(String source, String name) {
  final start = source.indexOf('const $name');
  expect(start, isNonNegative, reason: 'в исходнике нет $name');
  final open = source.indexOf('[', start);
  final close = source.indexOf(']', open);
  final items = RegExp(r"'([^']*)'")
      .allMatches(source.substring(open, close))
      .map((m) => m.group(1)!)
      .toList();
  // Якорь: пустой разбор выглядел бы как «расхождений нет».
  expect(items, isNotEmpty, reason: '$name разобрался пустым');
  return items;
}
