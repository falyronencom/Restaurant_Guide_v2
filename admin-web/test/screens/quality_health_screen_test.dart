import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/quality_signals.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/quality_health_models.dart';
import 'package:restaurant_guide_admin_web/providers/quality_health_provider.dart';
import 'package:restaurant_guide_admin_web/screens/quality/quality_health_screen.dart';
import 'package:restaurant_guide_admin_web/services/quality_health_service.dart';
import 'package:restaurant_guide_admin_web/widgets/quality/health_summary_bar.dart';
import 'package:restaurant_guide_admin_web/widgets/quality/quality_signal_card.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_error_card.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_error_toast.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_skeleton.dart';

/// Подставной сервис на `Completer` — загрузку нужно уметь остановить на
/// середине, иначе скелетон не поймать.
///
/// `Completer` создаётся из вызова внутри теста, а не в `setUp`: он привязывает
/// future к зоне создания, и созданный вне `FakeAsync`-зоны `testWidgets` не
/// доставит результат через `tester.pump()`.
class _FakeHealthService implements QualityHealthService {
  Completer<QualityHealthData> next = Completer<QualityHealthData>();

  int calls = 0;
  final List<bool> forced = <bool>[];

  @override
  Future<QualityHealthData> getHealth({bool force = false}) {
    calls++;
    forced.add(force);
    return next.future;
  }
}

QualityHealthData _data({
  int unreachable = 0,
  int hangingFlags = 0,
  int emptyMenus = 0,
  int ocrFailed = 0,
  int agedOver7d = 0,
  int agedOver30d = 0,
  String? generatedAt = '2026-07-14T06:41:00.000Z',
  List<AttributeKeyCount> keys = const <AttributeKeyCount>[],
  List<QualitySample> unreachableSamples = const <QualitySample>[],
  List<QualitySample> emptyMenusSamples = const <QualitySample>[],
}) =>
    QualityHealthData(
      scope: 'active',
      generatedAt: generatedAt,
      unreachableCount: unreachable,
      unreachableSamples: unreachableSamples,
      categoryOffCanonCount: 0,
      cuisineOffCanonCount: 0,
      emptyMenusCount: emptyMenus,
      emptyMenusSamples: emptyMenusSamples,
      ocrFailedCount: ocrFailed,
      ocrStuckCount: 0,
      outOfBoundsCount: 0,
      hoursMalformedCount: 0,
      hoursAllClosedCount: 0,
      attributeKeys: keys,
      nonObjectAttributesCount: 0,
      hangingFlagsCount: hangingFlags,
      hangingAgedOver7d: agedOver7d,
      hangingAgedOver30d: agedOver30d,
      priceDistributionStatus: 'deferred',
    );

void main() {
  /// Окно 1440x820 — кадр 04 нарисован в этой ширине, три колонки сетки
  /// появляются только выше 1100 по телу.
  Future<_FakeHealthService> pumpScreen(WidgetTester tester) async {
    final fake = _FakeHealthService();

    tester.view.physicalSize = const Size(1440, 820);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      ChangeNotifierProvider<QualityHealthProvider>(
        create: (_) => QualityHealthProvider(service: fake),
        child: MaterialApp(
          theme: AppTheme.lightTheme,
          home: const Scaffold(body: QualityHealthScreen()),
        ),
      ),
    );
    await tester.pump(); // postFrameCallback отпускает загрузку
    return fake;
  }

  testWidgets('первичная загрузка — скелетон, а не крутилка', (tester) async {
    final fake = await pumpScreen(tester);

    expect(fake.calls, 1);
    // Не force: если снимок уже взят дашбордом, повторять тяжёлый запрос
    // незачем.
    expect(fake.forced, <bool>[false]);
    expect(find.byType(SkeletonBlock), findsWidgets);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.byType(QualitySignalCard), findsNothing);
    // Шапка в скелетон не входит.
    expect(find.text('Здоровье данных'), findsOneWidget);
  });

  testWidgets('шапка называет момент съёмки, а не момент запроса',
      (tester) async {
    final fake = await pumpScreen(tester);
    fake.next.complete(_data(unreachable: 3));
    await tester.pump();

    // 06:41 UTC → 09:41 на UTC+3; тест не зависит от пояса машины, потому что
    // ожидание строится тем же переводом в местное время.
    final expected = DateTime.parse('2026-07-14T06:41:00.000Z').toLocal();
    final hh = expected.hour.toString().padLeft(2, '0');
    final mm = expected.minute.toString().padLeft(2, '0');

    expect(
      find.textContaining('снимок ').first,
      findsOneWidget,
    );
    expect(find.textContaining('$hh:$mm'), findsOneWidget);
  });

  testWidgets('снимка без метки времени — шапка молчит, а не выдумывает',
      (tester) async {
    final fake = await pumpScreen(tester);
    fake.next.complete(_data(unreachable: 1, generatedAt: null));
    await tester.pump();

    expect(find.textContaining('снимок'), findsNothing);
    expect(find.textContaining('только чтение'), findsOneWidget);
  });

  testWidgets('проблемные карточки идут первыми', (tester) async {
    final fake = await pumpScreen(tester);
    // Красные разбросаны по канону: 1-я и 5-я позиции.
    fake.next.complete(_data(unreachable: 3, ocrFailed: 2));
    await tester.pump();

    final cards = tester
        .widgetList<QualitySignalCard>(find.byType(QualitySignalCard))
        .toList();
    expect(cards, hasLength(kQualitySignals.length));
    expect(
      cards.take(2).map((c) => c.signal.id),
      <String>['unreachable', 'ocr_failed'],
    );
    expect(cards.skip(2).every((c) => c.count == 0), isTrue);
  });

  testWidgets('чистая карточка не несёт подписи, красная несёт',
      (tester) async {
    final fake = await pumpScreen(tester);
    fake.next.complete(_data(unreachable: 3));
    await tester.pump();

    final unreachable =
        kQualitySignals.firstWhere((s) => s.id == 'unreachable');
    final clean = kQualitySignals.firstWhere((s) => s.id == 'out_of_bounds');

    expect(find.textContaining(unreachable.subtitle), findsOneWidget);
    expect(find.textContaining(clean.subtitle), findsNothing);
    // Заголовок чистой на месте — снята именно подпись, а не карточка.
    expect(find.text(clean.title), findsOneWidget);
  });

  testWidgets('карточка флагов несёт обе возрастные корзины', (tester) async {
    final fake = await pumpScreen(tester);
    fake.next.complete(
      _data(hangingFlags: 12, agedOver7d: 4, agedOver30d: 1),
    );
    await tester.pump();

    expect(find.text('4 старше 7 дней, 1 старше 30'), findsOneWidget);
  });

  testWidgets('пустая тридцатидневная корзина молчит, а не печатает ноль',
      (tester) async {
    final fake = await pumpScreen(tester);
    fake.next.complete(_data(hangingFlags: 12, agedOver7d: 4));
    await tester.pump();

    expect(find.text('4 старше 7 дней'), findsOneWidget);
    expect(find.textContaining('старше 30'), findsNothing);
  });

  testWidgets('сводка считает красные и перечисляет чистые', (tester) async {
    final fake = await pumpScreen(tester);
    fake.next.complete(_data(unreachable: 3, hangingFlags: 12));
    await tester.pump();

    expect(find.text('сигнала требуют внимания'), findsOneWidget);
    expect(find.text('2'), findsWidgets);
    expect(find.text('проверок чисты'), findsOneWidget);
    expect(find.text('9'), findsWidgets);
  });

  testWidgets('всё чисто — один зелёный блок, без красного нуля',
      (tester) async {
    final fake = await pumpScreen(tester);
    fake.next.complete(_data());
    await tester.pump();

    // «0 сигналов требуют внимания» сообщало бы ровно обратное тому, чем
    // является: красный ноль читается как тревога.
    expect(find.textContaining('требуют внимания'), findsNothing);
    expect(find.text('Ни один сигнал не требует внимания'), findsOneWidget);
    expect(find.text('11'), findsWidgets);
  });

  testWidgets('перепись рисует ключи как есть, латиницей', (tester) async {
    final fake = await pumpScreen(tester);
    fake.next.complete(_data(keys: const <AttributeKeyCount>[
      AttributeKeyCount(key: 'wifi', count: 287),
      AttributeKeyCount(key: 'parking', count: 194),
    ]));
    await tester.pump();

    expect(find.text('wifi'), findsOneWidget);
    expect(find.text('287'), findsOneWidget);
    expect(find.text('parking'), findsOneWidget);
  });

  testWidgets('«Обновить» перечитывает в обход снимка сервера',
      (tester) async {
    final fake = await pumpScreen(tester);
    fake.next.complete(_data(unreachable: 3));
    await tester.pump();

    fake.next = Completer<QualityHealthData>();
    await tester.tap(find.text('Обновить'));
    await tester.pump();

    expect(fake.calls, 2);
    // Без force сервер вернул бы тот же снимок, и нажатие не оставило бы на
    // экране никакого следа — кнопка читалась бы как сломанная.
    expect(fake.forced.last, isTrue);
  });

  group('раскрытие заведений под сигналом', () {
    QualityHealthData withSamples({
      int unreachable = 3,
      List<QualitySample>? samples,
    }) =>
        _data(
          unreachable: unreachable,
          unreachableSamples: samples ??
              const <QualitySample>[
                QualitySample(
                  id: 'a',
                  name: 'Кухмістр',
                  city: 'Минск',
                  detail: 'категория не в каноне',
                ),
                QualitySample(
                  id: 'b',
                  name: 'Golden Coffee',
                  city: 'Гродно',
                  detail: 'город не в каноне',
                ),
              ],
        );

    testWidgets('список свёрнут, пока его не раскроют', (tester) async {
      final fake = await pumpScreen(tester);
      fake.next.complete(withSamples());
      await tester.pump();

      // Кадр 04 задуман плотной сеткой; всегда развёрнутые списки растянули бы
      // его вертикально там, где он должен читаться одним взглядом.
      expect(find.text('Показать заведения'), findsOneWidget);
      expect(find.textContaining('Кухмістр'), findsNothing);

      await tester.tap(find.text('Показать заведения'));
      await tester.pump();

      // Имя и город — раздельные Text: одной строкой при длинном имени
      // обрезался бы город, а он и делает строку адресом для поиска.
      expect(find.text('Кухмістр'), findsOneWidget);
      expect(find.text(' · Минск'), findsOneWidget);
      expect(find.text('Golden Coffee'), findsOneWidget);
      expect(find.text(' · Гродно'), findsOneWidget);
      // Диагноз, а не только имя: видно, какой из двух слагов пустой.
      expect(find.text('категория не в каноне'), findsOneWidget);
      expect(find.text('город не в каноне'), findsOneWidget);
    });

    testWidgets('обрезка на 25 называется вслух, а не молчит', (tester) async {
      final fake = await pumpScreen(tester);
      fake.next.complete(withSamples(
        unreachable: 40,
        samples: List<QualitySample>.generate(
          25,
          (i) => QualitySample(
            id: '$i',
            name: 'Заведение $i',
            city: 'Минск',
            detail: null,
          ),
        ),
      ));
      await tester.pump();
      await tester.tap(find.text('Показать заведения'));
      await tester.pump();

      // Иначе длина списка сама по себе читалась бы как «вот они все».
      expect(find.text('Показаны 25 из 40'), findsOneWidget);
    });

    testWidgets('когда показаны все — приписки нет', (tester) async {
      final fake = await pumpScreen(tester);
      // Счётчик равен длине списка: обрезка не сработала, и говорить не о чем.
      fake.next.complete(withSamples(unreachable: 2));
      await tester.pump();
      await tester.tap(find.text('Показать заведения'));
      await tester.pump();

      expect(find.textContaining('Показаны'), findsNothing);
    });

    testWidgets('пустой срез объясняется, а «нет примеров вовсе» — молчит',
        (tester) async {
      // Лимит в 25 строк у часов ОБЩИЙ на два сигнала: если все двадцать пять
      // заняты битым форматом, у «всё закрыто» примеров не останется, хотя
      // счётчик ненулевой. Молчащая карточка выглядела бы так, будто показывать
      // нечего. А у шести сигналов примеров не бывает по устройству — там та же
      // строка была бы шумом на каждой карточке.
      final fake = await pumpScreen(tester);
      fake.next.complete(QualityHealthData.fromJson(<String, dynamic>{
        'working_hours': <String, dynamic>{
          'malformed_count': 1,
          'all_closed_count': 6,
          'samples': <dynamic>[
            <String, dynamic>{
              'id': '1',
              'name': 'Битые часы',
              'city': 'Минск',
              'malformed': true,
              'all_closed': false,
            },
          ],
        },
        'menu_completeness': <String, dynamic>{'ocr_failed_count': 2},
      }));
      await tester.pump();

      // «Всё закрыто»: счётчик 6, примеров ноль — говорим.
      expect(find.text('Примеров в этом срезе нет'), findsOneWidget);
      // «Ошибки распознавания»: счётчик 2, примеров не бывает — молчим.
      final ocr = kQualitySignals.firstWhere((s) => s.id == 'ocr_failed');
      expect(ocr.samplesOf, isNull);
    });

    testWidgets('раскрытый список не растягивает карточку на весь экран',
        (tester) async {
      // Двадцать пять строк тянули карточку до 1485 пикселей рядом с соседями
      // по 56 и роняли всё нижележащее на полтора экрана. Строки остаются
      // доступны — у списка свой скролл.
      final fake = await pumpScreen(tester);
      fake.next.complete(_data(
        unreachable: 25,
        unreachableSamples: List<QualitySample>.generate(
          25,
          (i) => QualitySample(
            id: '$i',
            name: 'Очень длинное название заведения номер $i',
            city: 'Минск',
            detail: 'категория не в каноне',
          ),
        ),
      ));
      await tester.pump();

      final collapsed = tester.getSize(find.byType(QualitySignalCard).first);
      await tester.tap(find.text('Показать заведения'));
      await tester.pump();
      final expanded = tester.getSize(find.byType(QualitySignalCard).first);

      expect(expanded.height, greaterThan(collapsed.height));
      expect(
        expanded.height,
        lessThan(500),
        reason: 'раскрытая карточка снова растёт по содержимому',
      );
    });

    testWidgets('у сигнала без примеров кнопки раскрытия нет', (tester) async {
      final fake = await pumpScreen(tester);
      // Ошибки распознавания считают задачи, а не заведения: примеров бэкенд
      // для них не собирает вовсе.
      fake.next.complete(_data(ocrFailed: 2));
      await tester.pump();

      expect(find.text('Показать заведения'), findsNothing);
    });

    testWidgets('раскрытое не переезжает на чужую карточку при пересортировке',
        (tester) async {
      final fake = await pumpScreen(tester);
      fake.next.complete(withSamples());
      await tester.pump();
      await tester.tap(find.text('Показать заведения'));
      await tester.pump();
      expect(find.text('Кухмістр'), findsOneWidget);

      // «Недостижимы» обнулились — карточка уезжает в хвост, на её место в
      // сетке встаёт другая. Без ключа по сигналу состояние переиспользовалось
      // бы по ПОЗИЦИИ, и раскрытым оказался бы чужой сигнал.
      fake.next = Completer<QualityHealthData>();
      await tester.tap(find.text('Обновить'));
      await tester.pump();
      fake.next.complete(
        _data(
          emptyMenus: 5,
          emptyMenusSamples: const <QualitySample>[
            QualitySample(
              id: 'c',
              name: 'Лидо',
              city: 'Витебск',
              detail: null,
            ),
          ],
        ),
      );
      await tester.pump();

      expect(find.text('Кухмістр'), findsNothing);
      expect(find.text('Лидо'), findsNothing);
      expect(find.text('Показать заведения'), findsOneWidget);
    });

    testWidgets('раскрытое переживает смену места карточки в сетке',
        (tester) async {
      // Ключ защищает от ДВУХ разных бед, и вторую прежний набор не сторожил.
      // Первая — миграция состояния на чужой сигнал (её ловит соседний тест).
      // Вторая — уничтожение состояния: если ключ стоит не на прямом ребёнке
      // `Wrap`, безключевые обёртки матчатся позиционно, и карточка, сменившая
      // слот, приходит закрытой. Модератор раскрывает список, читает его, жмёт
      // «Обновить» — и список схлопывается, стоит появиться любому более
      // раннему по канону красному сигналу.
      final fake = await pumpScreen(tester);
      fake.next.complete(_data(
        emptyMenus: 5,
        emptyMenusSamples: const <QualitySample>[
          QualitySample(id: 'c', name: 'Лидо', city: 'Витебск', detail: null),
        ],
      ));
      await tester.pump();
      await tester.tap(find.text('Показать заведения'));
      await tester.pump();
      expect(find.text('Лидо'), findsOneWidget);

      // «Недостижимы» стоят выше «Пустых меню» по канону — карточка меню
      // съезжает из слота 0 в слот 1.
      fake.next = Completer<QualityHealthData>();
      await tester.tap(find.text('Обновить'));
      await tester.pump();
      fake.next.complete(_data(
        unreachable: 3,
        emptyMenus: 5,
        emptyMenusSamples: const <QualitySample>[
          QualitySample(id: 'c', name: 'Лидо', city: 'Витебск', detail: null),
        ],
      ));
      await tester.pump();

      expect(find.text('Лидо'), findsOneWidget);
      expect(find.text('Скрыть'), findsOneWidget);
    });

    testWidgets('часы разведены по двум карточкам, а не показаны обе одинаково',
        (tester) async {
      final fake = await pumpScreen(tester);
      // Бэкенд отдаёт ОДИН список на два сигнала, с флагами malformed и
      // all_closed; одна карточка бывает в обоих. Разбор делает модель.
      fake.next.complete(QualityHealthData.fromJson(<String, dynamic>{
        'scope': 'active',
        'generated_at': '2026-07-14T06:41:00.000Z',
        'working_hours': <String, dynamic>{
          'malformed_count': 2,
          'all_closed_count': 1,
          'samples': <dynamic>[
            <String, dynamic>{
              'id': '1',
              'name': 'Битые часы',
              'city': 'Минск',
              'malformed': true,
              'all_closed': false,
            },
            <String, dynamic>{
              'id': '2',
              'name': 'И то и другое',
              'city': 'Брест',
              'malformed': true,
              'all_closed': true,
            },
          ],
        },
      }));
      await tester.pump();

      final toggles = find.text('Показать заведения');
      expect(toggles, findsNWidgets(2));

      await tester.tap(toggles.first); // «Часы: битый формат» стоит выше
      await tester.pump();
      expect(find.text('Битые часы'), findsOneWidget);
      expect(find.text('И то и другое'), findsOneWidget);

      await tester.tap(find.text('Показать заведения'));
      await tester.pump();
      // «Всё закрыто» показывает только свою половину.
      expect(find.text('Битые часы'), findsOneWidget);
      expect(find.text('И то и другое'), findsNWidgets(2));
      expect(find.text('закрыто во все дни'), findsOneWidget);
    });
  });

  group('раскладка — замерами, а не на глаз', () {
    testWidgets('скелетон обещает ту же геометрию, что придёт', (tester) async {
      final fake = await pumpScreen(tester);

      // Пока данных нет — меряем скелетон.
      final skeletonTop =
          tester.getTopLeft(find.byType(QualitySignalCardSkeleton).first).dy;
      // Состав заглушки, а не её высота. Прежняя проверка мерила
      // `SingleChildScrollView` — то есть ВЬЮПОРТ, одинаковый в обоих
      // состояниях (1328), и `greaterThan(0)` было истинно всегда: мутация
      // «убрать заглушку переписи», буквально тот дефект, который чинили,
      // оставляла все тесты файла зелёными.
      final skeletonBlocks = tester
          .widgetList<Container>(find.descendant(
            of: find.byType(SingleChildScrollView),
            matching: find.byType(Container),
          ))
          .length;

      fake.next.complete(_data(unreachable: 3, keys: const <AttributeKeyCount>[
        AttributeKeyCount(key: 'wifi', count: 287),
      ]));
      await tester.pump();

      final realTop = tester.getTopLeft(find.byType(QualitySignalCard).first).dy;
      expect(
        realTop,
        skeletonTop,
        reason: 'заглушка сводки разошлась по высоте с настоящей — '
            'содержимое ниже прыгнет в момент прихода данных',
      );
      // Это же утверждение и держит константу `_summaryBarHeight` против
      // реальности: положение первой карточки выводится из неё в скелетоне и из
      // фактической высоты сводки — с данными. Высота сводки сегодня держится на
      // трёхстрочной сноске про цены; когда распределение цен подключат и сноска
      // исчезнет, настоящая сводка станет ниже, и тест упадёт, потребовав
      // пересчёта, а не промолчит.
      // Сводка, одиннадцать карточек, панель переписи — если любой из трёх
      // блоков выпадет, число контейнеров изменится.
      expect(skeletonBlocks, greaterThan(11));
    });

    testWidgets('на окне 1024 сетка держит две колонки, а не одну',
        (tester) async {
      // 764, а не 1024. В стенде нет рейла админки, поэтому экрану достаётся всё
      // окно целиком — то есть ширина окна ЗДЕСЬ равна ширине ТЕЛА на живом
      // экране. Поставить сюда 1024 значит мерить не ту величину: настоящее тело
      // при окне 1024 — это 1024 − 260. Ровно на этом я уже попадался на этапе 6,
      // и здесь это поймала мутация: со старыми порогами тест оставался зелёным.
      const railWidth = 260.0;
      tester.view.physicalSize = const Size(1024 - railWidth, 820);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      final fake = _FakeHealthService();
      await tester.pumpWidget(
        ChangeNotifierProvider<QualityHealthProvider>(
          create: (_) => QualityHealthProvider(service: fake),
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const Scaffold(body: QualityHealthScreen()),
          ),
        ),
      );
      await tester.pump();
      fake.next.complete(_data(unreachable: 3));
      await tester.pump();

      // Тело 764, внутренние отступы 24+24 → сетке достаётся 716. Прежний порог
      // требовал > 720 и промахивался на четыре пикселя: одиннадцать карточек по
      // 692 в один столбец, с иконкой и числом у левого края.
      final cards = find.byType(QualitySignalCard);
      final first = tester.getRect(cards.at(0));
      final second = tester.getRect(cards.at(1));
      expect(
        second.top,
        first.top,
        reason: 'вторая карточка обязана стоять в том же ряду',
      );
      expect(first.width, closeTo(351, 1));
    });

    testWidgets('сноска про цены прижата к правому краю и в чистом состоянии',
        (tester) async {
      final fake = await pumpScreen(tester);
      // Именно чистое состояние: левая группа там короче всего, и прежняя
      // раскладка отпускала сноску от края на 174 пикселя.
      fake.next.complete(_data());
      await tester.pump();

      final bar = tester.getRect(find.byType(HealthSummaryBar));
      final note = tester.getRect(
        find.text('Распределение цен подключается на импорте 500 заведений'),
      );
      expect(
        bar.right - note.right,
        closeTo(22, 1), // горизонтальный отступ панели
        reason: 'сноска уехала от правого края панели',
      );
    });

    testWidgets('длинный ключ переписи не рвёт панель', (tester) async {
      final fake = await pumpScreen(tester);
      fake.next.complete(_data(keys: <AttributeKeyCount>[
        AttributeKeyCount(key: 'a' * 400, count: 3),
      ]));
      await tester.pump();

      // Длину ключа не ограничивает ни SQL переписи, ни путь записи атрибутов —
      // а панель существует ровно затем, чтобы показывать неканонические ключи.
      expect(tester.takeException(), isNull);
    });

    testWidgets('корзины возраста печатаются с разделителем разрядов',
        (tester) async {
      final fake = await pumpScreen(tester);
      fake.next.complete(
        _data(hangingFlags: 12480, agedOver7d: 3120, agedOver30d: 1005),
      );
      await tester.pump();

      // Иначе на одной карточке «12 480» сверху и «3120» снизу — два формата
      // числа в одном блоке.
      expect(find.text('3 120 старше 7 дней, 1 005 старше 30'), findsOneWidget);
    });
  });

  testWidgets('ошибка при пустом экране — карточка, а не тост', (tester) async {
    final fake = await pumpScreen(tester);
    fake.next.completeError(Exception('403'));
    await tester.pump();
    await tester.pump();

    expect(find.byType(AdminErrorCard), findsOneWidget);
    expect(find.byType(AdminErrorToast), findsNothing);
  });

  testWidgets('сбой обновления при живых данных — тост, данные остаются',
      (tester) async {
    final fake = await pumpScreen(tester);
    fake.next.complete(_data(unreachable: 3));
    await tester.pump();

    fake.next = Completer<QualityHealthData>();
    await tester.tap(find.text('Обновить'));
    await tester.pump();
    fake.next.completeError(Exception('Connection timeout'));
    await tester.pump();
    await tester.pump();

    expect(find.byType(AdminErrorToast), findsOneWidget);
    // Подмена живого снимка карточкой ошибки была бы потерей того, что уже
    // прочитано; на экране остаётся прежний снимок.
    expect(find.byType(AdminErrorCard), findsNothing);
    expect(find.byType(QualitySignalCard), findsWidgets);
  });
}
