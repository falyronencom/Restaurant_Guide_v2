import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/utils/open_status.dart';

import '../support/wire_fixtures.dart';

/// Контракт провода для карточки заведения.
///
/// Серверную сторону этого контракта держат 238 тестов бэкенда: они проверяют,
/// что проекция отдаёт нужные поля. Клиентскую сторону не проверял никто —
/// а именно она ломается молча и без пересборки. Приложение на устройстве
/// пользователя до запуска не обновляется; изменение проекции доезжает до
/// него в тот же день, и единственный способ узнать об этом заранее —
/// сломать здесь.
void main() {
  group('Строка проекции разбирается целиком', () {
    test('все поля списка доходят до модели', () {
      final e = Establishment.fromJson(establishmentRow());

      expect(e.id, '11111111-1111-4111-8111-111111111111');
      expect(e.name, 'Васильки');
      expect(e.city, 'Минск');
      expect(e.address, 'пр. Независимости, 43');
      expect(e.status, 'active');
      expect(e.latitude, 53.9023);
      expect(e.longitude, 27.5619);
      expect(e.priceRange, r'$$');
      expect(e.rating, 4.5);
      expect(e.bookingEnabled, isTrue);
      expect(e.hasPromotion, isFalse);
      expect(e.createdAt, DateTime.utc(2026, 4, 1, 9));
      expect(e.updatedAt, DateTime.utc(2026, 6, 1, 9));
    });
  });

  group('Обязательные поля провода', () {
    // Шесть полей, без которых `fromJson` не работает. Проверяем НЕ то, что
    // разбор бросает исключение — бросок это сегодняшняя реализация, и
    // терпимость к пропаже была бы улучшением. Проверяем, что разбор не
    // выдаёт карточку с ПОДСТАВНЫМ значением: молчаливая подмена ровно того
    // рода, что 07.09 дорисовывала заведению Wi-Fi, которого у него нет.
    const loadBearing = <String>[
      'name',
      'address',
      'city',
      'status',
      'created_at',
      'updated_at',
    ];

    for (final key in loadBearing) {
      test('без «$key» карточка не собирается из подставных значений', () {
        Establishment? parsed;
        try {
          parsed = Establishment.fromJson(without(establishmentRow(), key));
        } catch (_) {
          parsed = null;
        }
        expect(
          parsed,
          isNull,
          reason: 'поле «$key» пропало из проекции, а карточка всё равно '
              'собралась — значит вместо него подставлено выдуманное значение, '
              'и гость увидит его как факт',
        );
      });
    }

    test('переименование поля ловится так же, как пропажа', () {
      // Отличие от пропажи: значение в ответе ОСТАЛОСЬ, просто под другим
      // именем. Код, который смотрит «есть ли вообще данные», это пропустит.
      Establishment? parsed;
      try {
        parsed = Establishment.fromJson(
          renamed(establishmentRow(), 'name', 'title'),
        );
      } catch (_) {
        parsed = null;
      }
      expect(parsed, isNull);
    });
  });

  group('Терпимость к необязательным полям', () {
    test('карточка без описания, телефона, сайта и координат разбирается', () {
      var row = establishmentRow();
      for (final key in ['description', 'phone', 'website', 'latitude',
        'longitude', 'price_range', 'attributes', 'working_hours']) {
        row = without(row, key);
      }

      final e = Establishment.fromJson(row);

      expect(e.name, 'Васильки');
      expect(e.description, isNull);
      expect(e.phone, isNull);
      expect(e.website, isNull);
      expect(e.latitude, isNull);
      expect(e.longitude, isNull);
      expect(e.priceRange, isNull);
      expect(e.attributes, isNull);
      expect(e.workingHours, isNull);
    });
  });

  group('Числа с провода', () {
    test('рейтинг приходит числом', () {
      final e = Establishment.fromJson(establishmentRow());
      expect(e.rating, 4.5);
    });

    test('рейтинг приходит строкой NUMERIC и всё равно разбирается', () {
      // NUMERIC вне явного каста node-pg отдаёт строкой. Проекция сейчас
      // кастует сама, но `average_rating` приходит и из ответов, которые
      // через проекцию не идут. Разбор обязан пережить обе формы.
      final row = establishmentRow();
      row['average_rating'] = '4.30';

      final e = Establishment.fromJson(row);
      expect(e.rating, 4.3);
    });

    test('рейтинга нет — null, а не ноль', () {
      // Ноль и «оценок пока нет» — разные вещи: ноль рисуется как худшая
      // возможная оценка.
      final row = without(establishmentRow(), 'average_rating');
      expect(Establishment.fromJson(row).rating, isNull);
    });

    test('расстояние приходит строкой и разбирается', () {
      final row = establishmentRow();
      row['distance'] = '1.75';
      expect(Establishment.fromJson(row).distance, 1.75);
    });

    test('нечисловое расстояние даёт null, а не исключение', () {
      final row = establishmentRow();
      row['distance'] = 'далеко';
      expect(Establishment.fromJson(row).distance, isNull);
    });

    test('promotion_count отсутствует — ноль', () {
      final row = without(establishmentRow(), 'promotion_count');
      expect(Establishment.fromJson(row).promotionCount, 0);
    });
  });

  group('Флаги', () {
    test('booking_enabled и has_promotion читаются как есть', () {
      final row = establishmentRow();
      row['booking_enabled'] = true;
      row['has_promotion'] = true;

      final e = Establishment.fromJson(row);
      expect(e.bookingEnabled, isTrue);
      expect(e.hasPromotion, isTrue);
    });

    test('отсутствующий флаг выключен, а не включён', () {
      // Направление важно: включённый по умолчанию `booking_enabled` показал
      // бы гостю кнопку брони у заведения, которое брони не принимает.
      var row = without(establishmentRow(), 'booking_enabled');
      row = without(row, 'has_promotion');

      final e = Establishment.fromJson(row);
      expect(e.bookingEnabled, isFalse);
      expect(e.hasPromotion, isFalse);
    });
  });

  group('Картинка карточки', () {
    test('в списке приходит только primary_image_url — картинка есть', () {
      // Проекция списка НЕ несёт `thumbnail_url`; если убрать запасной
      // вариант, карточки останутся без единой картинки, и это будет
      // выглядеть как «фото ещё не загрузили», а не как поломка.
      final row = without(establishmentRow(), 'thumbnail_url');
      expect(
        Establishment.fromJson(row).thumbnailUrl,
        'https://cdn.example/vasilki',
      );
    });

    test('явный thumbnail_url важнее primary_image_url', () {
      final row = establishmentRow();
      row['thumbnail_url'] = 'https://cdn.example/thumb-explicit';
      expect(
        Establishment.fromJson(row).thumbnailUrl,
        'https://cdn.example/thumb-explicit',
      );
    });
  });

  group('Категории и кухни', () {
    test('кириллица канона проходит без изменений', () {
      final e = Establishment.fromJson(establishmentRow(
        categories: ['Кальянная', 'Бар'],
        cuisines: ['Грузинская'],
      ));

      expect(e.categories, ['Кальянная', 'Бар']);
      expect(e.cuisines, ['Грузинская']);
    });

    test('первая категория и первая кухня становятся основными', () {
      final e = Establishment.fromJson(establishmentRow(
        categories: ['Бар', 'Кальянная'],
        cuisines: ['Японская', 'Азиатская'],
      ));

      expect(e.category, 'Бар');
      expect(e.cuisine, 'Японская');
    });

    test('латиница из легаси-данных нормализуется в кириллицу', () {
      // Две пары различаются только этим отображением: `cafe` — кофейня, а
      // `cafe_dining` — кафе. Перепутать их местами значит показать гостю
      // не тот тип заведения.
      final e = Establishment.fromJson(establishmentRow(
        categories: ['cafe', 'cafe_dining', 'hookah_bar'],
        cuisines: ['belarusian', 'fusion'],
      ));

      expect(e.categories, ['Кофейня', 'Кафе', 'Кальянная']);
      expect(e.cuisines, ['Народная', 'Авторская']);
    });

    test('неизвестное значение остаётся как пришло, а не теряется', () {
      final e = Establishment.fromJson(establishmentRow(
        categories: ['Веранда'],
      ));
      expect(e.categories, ['Веранда']);
    });
  });

  group('Медиа заведения', () {
    test('file_type отсутствует — считаем картинкой', () {
      final m = EstablishmentMedia.fromJson(mediaRow());
      expect(m.fileType, 'image');
      expect(m.isPdf, isFalse);
    });

    test('pdf распознаётся как pdf', () {
      final m = EstablishmentMedia.fromJson(
        mediaRow(type: 'menu', fileType: 'pdf'),
      );
      expect(m.isPdf, isTrue);
      expect(m.type, 'menu');
    });

    test('is_primary доходит до модели — по нему галерея ставит обложку первой',
        () {
      expect(EstablishmentMedia.fromJson(mediaRow(isPrimary: true)).isPrimary,
          isTrue);
      expect(EstablishmentMedia.fromJson(mediaRow()).isPrimary, isFalse);
      // Строка без флага (старый ответ) — не обложка, а не падение разбора.
      expect(
        EstablishmentMedia.fromJson(without(mediaRow(), 'is_primary'))
            .isPrimary,
        isFalse,
      );
    });

    test('медиа заведения разбирается вместе с карточкой', () {
      final e = Establishment.fromJson(establishmentRow(
        media: [mediaRow(position: 0), mediaRow(id: 'x', position: 1)],
      ));

      expect(e.media, hasLength(2));
      expect(e.media!.first.position, 0);
      expect(e.media!.last.id, 'x');
    });
  });

  group('Разбор часов работы', () {
    test('строка «10:00-22:00» раскладывается на открытие и закрытие', () {
      expect(
        Establishment.parseDayHours('10:00-22:00'),
        {'open': '10:00', 'close': '22:00', 'is_open': true},
      );
    });

    test('пробелы вокруг тире не мешают', () {
      expect(
        Establishment.parseDayHours(' 10:00 - 22:00 '),
        {'open': '10:00', 'close': '22:00', 'is_open': true},
      );
    });

    test('объектная форма читается', () {
      expect(
        Establishment.parseDayHours({'open': '09:00', 'close': '18:00'}),
        {'open': '09:00', 'close': '18:00', 'is_open': true},
      );
    });

    test('выходной день объявлен явно', () {
      expect(
        Establishment.parseDayHours({'is_open': false}),
        {'is_open': false},
      );
    });

    test('дня нет в расписании — null', () {
      expect(Establishment.parseDayHours(null), isNull);
    });
  });

  group('Открыто или закрыто в конкретный момент', () {
    // Понедельник, 2026-09-07. День недели берётся из момента, поэтому все
    // ожидания ниже не зависят от часов машины, на которой идёт прогон.
    Map<String, dynamic> hours(String monday) => {'monday': monday};

    test('до открытия закрыто', () {
      final e = Establishment.fromJson(
        establishmentRow(workingHours: hours('10:00-22:00')),
      );
      expect(e.isOpenAt(DateTime(2026, 9, 7, 9, 59)), isFalse);
    });

    test('в минуту открытия уже открыто', () {
      final e = Establishment.fromJson(
        establishmentRow(workingHours: hours('10:00-22:00')),
      );
      expect(e.isOpenAt(DateTime(2026, 9, 7, 10, 0)), isTrue);
    });

    test('в минуту закрытия уже закрыто', () {
      // Граница исключающая: в 22:00 заведение закрыто, а не «ещё открыто».
      final e = Establishment.fromJson(
        establishmentRow(workingHours: hours('10:00-22:00')),
      );
      expect(e.isOpenAt(DateTime(2026, 9, 7, 21, 59)), isTrue);
      expect(e.isOpenAt(DateTime(2026, 9, 7, 22, 0)), isFalse);
    });

    test('окно через полночь: вечер открыт, ночь открыта, утро закрыто', () {
      // Бар 18:00–02:00 всю неделю. Ветка, ради которой всё выносилось: время
      // закрытия меньше времени открытия, и обычное сравнение даёт «закрыто
      // всегда». Ночь понедельника — хвост воскресной смены, поэтому расписание
      // на все дни: на один день её не проверить.
      final e = Establishment.fromJson(
        establishmentRow(workingHours: _everyDay('18:00-02:00')),
      );

      expect(e.isOpenAt(DateTime(2026, 9, 7, 23, 30)), isTrue,
          reason: 'вечер того же дня');
      expect(e.isOpenAt(DateTime(2026, 9, 7, 0, 30)), isTrue,
          reason: 'ночь до закрытия');
      expect(e.isOpenAt(DateTime(2026, 9, 7, 3, 0)), isFalse,
          reason: 'после закрытия');
      expect(e.isOpenAt(DateTime(2026, 9, 7, 17, 59)), isFalse,
          reason: 'до открытия');
      // Границы у ночного окна — своя ветка кода, и её надо трогать отдельно:
      // мутация «сделать открытие исключающим» пережила проверку границ
      // дневного окна, потому что дневное окно считается другим выражением.
      expect(e.isOpenAt(DateTime(2026, 9, 7, 18, 0)), isTrue,
          reason: 'ровно в минуту открытия ночного окна');
      expect(e.isOpenAt(DateTime(2026, 9, 7, 1, 59)), isTrue,
          reason: 'последняя минута перед закрытием ночного окна');
      expect(e.isOpenAt(DateTime(2026, 9, 7, 2, 0)), isFalse,
          reason: 'минута закрытия ночного окна — уже закрыто');
    });

    test('в выходной день закрыто в любой час', () {
      final e = Establishment.fromJson(
        establishmentRow(workingHours: {'monday': {'is_open': false}}),
      );
      expect(e.isOpenAt(DateTime(2026, 9, 7, 13, 0)), isFalse);
    });

    test('день недели берётся из момента, а не из расписания соседнего дня',
        () {
      // Вторник открыт, понедельник выходной. Если код возьмёт не тот день,
      // подпись «Открыто» появится в выходной.
      final e = Establishment.fromJson(establishmentRow(workingHours: {
        'monday': {'is_open': false},
        'tuesday': '10:00-22:00',
      }));

      expect(e.isOpenAt(DateTime(2026, 9, 7, 13, 0)), isFalse,
          reason: 'понедельник');
      expect(e.isOpenAt(DateTime(2026, 9, 8, 13, 0)), isTrue,
          reason: 'вторник');
    });

    test('день недели берётся из момента — все семь дней, выходные не '
        'перепутаны', () {
      // Тест выше смотрит понедельник и вторник. 7–13.09.2026 — с
      // понедельника по воскресенье; слова дней — ключи `working_hours`
      // сервера (`backend/src/utils/workingHoursSanity.js`). Закрыт ровно
      // один день — по очереди каждый.
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
        final hours = <String, dynamic>{
          for (final k in keys) k: '10:00-22:00',
          keys[closed]: {'is_open': false},
        };
        final e = Establishment.fromJson(establishmentRow(workingHours: hours));
        for (var day = 0; day < keys.length; day++) {
          expect(
            e.isOpenAt(DateTime(2026, 9, 7 + day, 13, 0)),
            day != closed,
            reason: 'закрыт только ${keys[closed]}; '
                '${7 + day}.09.2026 — ${keys[day]}',
          );
        }
      }
    });

    test('расписания нет вовсе — неизвестно; снятое с показа — закрыто', () {
      final active = Establishment.fromJson(
        without(establishmentRow(), 'working_hours'),
      );
      expect(active.openStatusAt(DateTime(2026, 9, 7, 3, 0)).state,
          OpenState.unknown);
      expect(active.isOpenAt(DateTime(2026, 9, 7, 3, 0)), isFalse,
          reason: 'неизвестные часы — не «открыто»: прогулка и метка серые');

      final suspended = Establishment.fromJson(
        without(establishmentRow(status: 'suspended'), 'working_hours'),
      );
      expect(suspended.openStatusAt(DateTime(2026, 9, 7, 13, 0)).state,
          OpenState.closed);
    });

    test('время закрытия показывается только в рабочий день', () {
      final e = Establishment.fromJson(establishmentRow(workingHours: {
        'monday': '10:00-22:00',
        'tuesday': {'is_open': false},
      }));

      expect(e.openStatusAt(DateTime(2026, 9, 7, 13, 0)).closesAt, '22:00');
      expect(e.openStatusAt(DateTime(2026, 9, 8, 13, 0)).closesAt, isNull);
    });

    test('разбор роняет время закрытия у выходного дня', () {
      expect(Establishment.parseDayHours({'is_open': false, 'close': '22:00'}),
          {'is_open': false});
    });
  });

  // Пн 07.09.2026 … Вс 13.09.2026. Числа — литералы: день недели берётся из
  // момента, поэтому ожидания не зависят от часов машины.
  group('Соседние дни: ночь принадлежит вчерашней смене', () {
    DateTime at(int daysFromMonday, int hour, [int minute = 0]) =>
        DateTime(2026, 9, 7 + daysFromMonday, hour, minute);

    Establishment week(Map<String, dynamic> hours) =>
        Establishment.fromJson(establishmentRow(workingHours: hours));

    test('пятница 01:00: четверг закрылся в 23:00, а пятница откроется в 12:00',
        () {
      // Находка № 2 проверки 06.11.2026: писало «Открыто · до 02:00».
      final e = week({
        'thursday': '12:00-23:00',
        'friday': '12:00-02:00',
      });

      final status = e.openStatusAt(at(4, 1));
      expect(status.state, OpenState.closed);
      expect(status.closesAt, isNull);
    });

    test('воскресенье 01:00: субботняя смена до 02:00 ещё идёт', () {
      // Обратный случай той же находки: писало «Закрыто».
      final e = week({
        'saturday': '12:00-02:00',
        'sunday': '12:00-23:00',
      });

      final status = e.openStatusAt(at(6, 1));
      expect(status.state, OpenState.open);
      expect(status.closesAt, '02:00', reason: 'закрытие вчерашней смены');
    });

    test('переход воскресенье → понедельник', () {
      final e = week({
        'sunday': '18:00-03:00',
        'monday': {'is_open': false},
      });

      final night = e.openStatusAt(at(0, 2, 59));
      expect(night.state, OpenState.open, reason: 'понедельник, 02:59');
      expect(night.closesAt, '03:00');
      expect(e.openStatusAt(at(0, 3)).state, OpenState.closed,
          reason: 'понедельник, 03:00 — смена кончилась, день выходной');
    });

    test('сегодня выходной, но вчерашняя смена не кончилась', () {
      final e = week({
        'friday': '18:00-02:00',
        'saturday': {'is_open': false},
      });

      expect(e.openStatusAt(at(5, 1)).closesAt, '02:00');
      expect(e.openStatusAt(at(5, 2)).state, OpenState.closed);
      expect(e.openStatusAt(at(5, 13)).state, OpenState.closed);
    });

    test('вчера выходной: ночной хвост сегодняшней записи не считается', () {
      final e = week({
        'sunday': {'is_open': false},
        'monday': '18:00-02:00',
      });

      expect(e.openStatusAt(at(0, 1)).state, OpenState.closed);
      expect(e.openStatusAt(at(0, 19)).closesAt, '02:00');
    });

    test('вчера данных нет: решает сегодняшняя запись', () {
      final e = week({'monday': '18:00-02:00'});

      expect(e.openStatusAt(at(0, 1)).state, OpenState.closed);
      expect(e.openStatusAt(at(0, 18)).state, OpenState.open);
    });

    test('вчера запись битая: не падает, решает сегодняшняя запись', () {
      final e = week({
        'sunday': {'is_open': true, 'open': '', 'close': ''},
        'monday': '10:00-22:00',
      });

      expect(e.openStatusAt(at(0, 1)).state, OpenState.closed);
      expect(e.openStatusAt(at(0, 12)).closesAt, '22:00');
    });

    test('сегодня данных нет: пока идёт вчерашняя смена — открыто, потом '
        'неизвестно', () {
      final e = week({'monday': '18:00-02:00'});

      expect(e.openStatusAt(at(1, 1)).closesAt, '02:00',
          reason: 'вторник, 01:00');
      expect(e.openStatusAt(at(1, 2)).state, OpenState.unknown,
          reason: 'вторник, 02:00');
    });

    test('обычная дневная смена вчера не продолжается ночью', () {
      final e = week({
        'monday': '10:00-22:00',
        'tuesday': '10:00-22:00',
      });

      expect(e.openStatusAt(at(1, 1)).state, OpenState.closed);
    });

    test('00:00–00:00 — ровно этот день, без хвоста в следующий', () {
      final e = week({
        'monday': '00:00-00:00',
        'tuesday': {'is_open': false},
      });

      for (final hour in [0, 1, 12, 23]) {
        expect(e.openStatusAt(at(0, hour)).state, OpenState.open,
            reason: 'понедельник, $hour:00');
      }
      expect(e.openStatusAt(at(1, 0)).state, OpenState.closed,
          reason: 'вторник, 00:00');
    });

    test('00:00–00:00 всю неделю — открыто в любой час', () {
      final e = week(_everyDay('00:00-00:00'));

      for (var day = 0; day < 7; day++) {
        for (var hour = 0; hour < 24; hour++) {
          expect(e.openStatusAt(at(day, hour)).state, OpenState.open,
              reason: 'день $day, $hour:00');
        }
      }
    });

    test('12:00–12:00 — сутки от часа открытия', () {
      final e = week({
        'sunday': {'is_open': false},
        'monday': '12:00-12:00',
        'tuesday': {'is_open': false},
      });

      expect(e.openStatusAt(at(0, 11, 59)).state, OpenState.closed,
          reason: 'понедельник до открытия');
      expect(e.openStatusAt(at(0, 12)).state, OpenState.open);
      expect(e.openStatusAt(at(1, 11, 59)).state, OpenState.open,
          reason: 'вторник до 12:00 — хвост понедельника');
      expect(e.openStatusAt(at(1, 12)).state, OpenState.closed);
    });
  });

  group('Часы, которые нельзя прочитать: неизвестно, а не падение', () {
    // Находка № 1 проверки 06.11.2026: `int.parse('')` при отрисовке одной
    // карточки занимал весь список блоком ошибки и оставлял карту без меток.
    final broken = <String, Object?>{
      'пустые строки (так присылал кабинет сайта)': {
        'is_open': true,
        'open': '',
        'close': '',
      },
      'одно время пустое': {'is_open': true, 'open': '10:00', 'close': ''},
      'нет ни одного времени': {'is_open': true},
      'время не существует': {'open': '25:99', 'close': '22:00'},
      'минуты не существуют': {'open': '10:60', 'close': '22:00'},
      'секунды не существуют': {'open': '10:00:99', 'close': '22:00'},
      'буквы': {'open': 'abc', 'close': 'def'},
      'хвост после времени': {'open': '10:00abc', 'close': '22:00'},
      'время не строка': {'open': 10, 'close': 22},
      'время null': {'open': null, 'close': null},
      'is_open не логическое': {'is_open': 'нет', 'open': '', 'close': ''},
      'строка без тире': 'abc',
      'пустая строка': '',
      'строка с мусором': '25:99-abc',
      'лишнее тире': '10:00-22:00-23:00',
      'число': 42,
      'список': <Object?>[1, 2],
      'null': null,
    };

    broken.forEach((name, entry) {
      test('$name — неизвестно в любой час', () {
        final e = Establishment.fromJson(establishmentRow(
          workingHours: {'monday': entry},
        ));

        for (var hour = 0; hour < 24; hour++) {
          final status = e.openStatusAt(DateTime(2026, 9, 7, hour));
          expect(status.state, OpenState.unknown, reason: '$hour:00');
          expect(status.closesAt, isNull);
        }
      });
    });

    test('день, которого нет в часах, — неизвестно', () {
      final e = Establishment.fromJson(establishmentRow(workingHours: {
        'tuesday': '10:00-22:00',
      }));
      expect(e.openStatusAt(DateTime(2026, 9, 7, 13)).state, OpenState.unknown);
    });

    test('пустой объект часов — неизвестно', () {
      final e = Establishment.fromJson(establishmentRow(workingHours: {}));
      expect(e.openStatusAt(DateTime(2026, 9, 7, 13)).state, OpenState.unknown);
    });

    test('часы не объектом: карточка разбирается, статус неизвестен', () {
      for (final value in <Object>['10:00-22:00', 42, <Object>[]]) {
        final row = establishmentRow();
        row['working_hours'] = value;

        final e = Establishment.fromJson(row);

        expect(e.workingHours, isNull);
        expect(e.openStatusAt(DateTime(2026, 9, 7, 13)).state, OpenState.unknown);
      }
    });

    test('подписи статуса — дословно', () {
      expect(const OpenStatus.open('22:00').label, 'Открыто');
      expect(const OpenStatus.closed().label, 'Закрыто');
      expect(const OpenStatus.unknown().label, 'Часы не указаны');
    });

    test('время приводится к ЧЧ:ММ: «9:00» и секунды читаются', () {
      expect(
        Establishment.parseDayHours({'open': '9:00', 'close': '22:00:00'}),
        {'open': '09:00', 'close': '22:00', 'is_open': true},
      );
      final e = Establishment.fromJson(establishmentRow(workingHours: {
        'monday': {'open': '9:00', 'close': '22:00:00'},
      }));
      expect(e.openStatusAt(DateTime(2026, 9, 7, 9)).closesAt, '22:00');
    });

    test('рабочий день без времени остаётся рабочим: разбор не делает его '
        'выходным', () {
      expect(
        Establishment.parseDayHours({'is_open': true, 'open': '', 'close': ''}),
        {'open': null, 'close': null, 'is_open': true},
      );
      expect(
        Establishment.parseDayHours({'open': '10:00', 'close': 'abc'}),
        {'open': '10:00', 'close': null, 'is_open': true},
      );
    });

    test('строка, в которой нет времени, — записи нет', () {
      expect(Establishment.parseDayHours('25:99-abc'), isNull);
      expect(Establishment.parseDayHours('abc'), isNull);
      expect(Establishment.parseDayHours(42), isNull);
    });
  });
}

/// Одни и те же часы на все семь дней.
Map<String, dynamic> _everyDay(Object hours) => {
      for (final day in const [
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
