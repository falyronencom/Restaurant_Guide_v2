import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_catalog_list.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/status_dot.dart';

// Каталог кадров 11–13: колонка 420, карточка с миниатюрой 80 и футер
// пагинации. Проверяется то, что ломается молча — геометрия и раскладка
// номеров страниц, — а не факт отрисовки.

void main() {
  Future<void> pumpCatalog(
    WidgetTester tester, {
    int itemCount = 3,
    int page = 1,
    int totalPages = 1,
    int totalCount = 3,
    List<CatalogSortOption>? sortOptions,
    ValueChanged<String>? onSortChanged,
    int selectedIndex = -1,
    bool isLoading = false,
  }) async {
    tester.view.physicalSize = const Size(1440, 820);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.lightTheme,
        home: Scaffold(
          body: Row(
            children: [
              ModerationCatalogList(
                sectionTitle: 'Каталог',
                sortCaption: 'сначала новые',
                sortOptions: sortOptions,
                currentSort: 'newest',
                onSortChanged: onSortChanged,
                itemCount: itemCount,
                itemBuilder: (context, index) => ModerationCatalogCard(
                  name: 'Заведение $index',
                  date: DateTime(2026, 7, 12),
                  subtitle: 'ресторан · Минск',
                  categories: const <String>['Ресторан'],
                  isSelected: index == selectedIndex,
                  onTap: () {},
                  footer: const StatusDot.labelled('draft'),
                ),
                isLoading: isLoading,
                onRetry: () {},
                emptyTitle: 'Пусто',
                emptyMessage: 'Нечего показать',
                page: page,
                totalPages: totalPages,
                totalCount: totalCount,
                onPageChanged: (_) {},
              ),
              const Expanded(child: SizedBox()),
            ],
          ),
        ),
      ),
    );
    await tester.pump();
  }

  group('Геометрия каталога', () {
    testWidgets('колонка 420', (tester) async {
      await pumpCatalog(tester);
      expect(
        tester.getSize(find.byType(ModerationCatalogList)).width,
        ModerationCatalogList.width,
      );
      expect(ModerationCatalogList.width, 420);
    });

    testWidgets('высоту карточки задаёт миниатюра, а не содержимое',
        (tester) async {
      await pumpCatalog(tester, itemCount: 1);

      // 80 миниатюра + 12 паддинга сверху и снизу + 1.5 рамки с каждой
      // стороны. Фотография внутри — в коробке фиксированного размера,
      // поэтому её пропорции на высоту строки не влияют: в кадре 05 ровно
      // это и было дефектом.
      expect(
        tester.getSize(find.byType(ModerationCatalogCard).first).height,
        ModerationCatalogCard.height,
      );
      expect(ModerationCatalogCard.height, 107);
    });

    testWidgets('выбор карточки не сдвигает её геометрию', (tester) async {
      await pumpCatalog(tester, itemCount: 1);
      final unselected = tester.getRect(find.text('Заведение 0'));

      await pumpCatalog(tester, itemCount: 1, selectedIndex: 0);
      expect(tester.getRect(find.text('Заведение 0')), unselected);
    });

    testWidgets('дата в карточке — моноширинная', (tester) async {
      await pumpCatalog(tester, itemCount: 1);

      final date = tester.widget<Text>(find.text('12.07.2026'));
      expect(date.style?.fontFamily, AppTheme.fontMonoFamily);
    });
  });

  group('Футер пагинации', () {
    testWidgets('называет показанный диапазон', (tester) async {
      await pumpCatalog(
        tester,
        itemCount: 20,
        page: 1,
        totalPages: 19,
        totalCount: 365,
      );

      expect(find.text('Показано '), findsNothing); // текст собран в один span
      expect(
        find.textContaining('Показано'),
        findsOneWidget,
      );
      expect(find.textContaining('1–20'), findsOneWidget);
      expect(find.textContaining('365'), findsOneWidget);
    });

    testWidgets('на второй странице диапазон сдвигается', (tester) async {
      await pumpCatalog(
        tester,
        itemCount: 20,
        page: 2,
        totalPages: 19,
        totalCount: 365,
      );
      expect(find.textContaining('21–40'), findsOneWidget);
    });

    testWidgets('последняя неполная страница не завышает верх диапазона',
        (tester) async {
      await pumpCatalog(
        tester,
        itemCount: 5,
        page: 19,
        totalPages: 19,
        totalCount: 365,
      );
      expect(find.textContaining('361–365'), findsOneWidget);
    });

    testWidgets('футер виден и при единственной странице', (tester) async {
      await pumpCatalog(tester, itemCount: 18, totalCount: 18);
      // «Показано 1–18 из 18» отвечает на вопрос «это всё?».
      expect(find.textContaining('1–18'), findsOneWidget);
      // А вот полосы номеров при одной странице нет: три неактивных
      // контрола ничего не сообщают.
      expect(find.byIcon(Icons.chevron_right), findsNothing);
    });

    testWidgets('подпись диапазона не переносится', (tester) async {
      // В один ряд с полосой номеров подпись не влезала и вставала в две-три
      // строки. Мерим высоту: одна строка 12-го кегля — меньше 20.
      await pumpCatalog(
        tester,
        itemCount: 20,
        page: 10,
        totalPages: 19,
        totalCount: 365,
      );

      final range = find.textContaining('181–200');
      expect(range, findsOneWidget);
      expect(tester.getSize(range).height, lessThan(20));
    });

    testWidgets('опустевшая страница не выдаётся за пустой раздел',
        (tester) async {
      // Действие модератора убрало последнюю запись второй страницы.
      await pumpCatalog(
        tester,
        itemCount: 0,
        page: 2,
        totalPages: 2,
        totalCount: 20,
      );

      // Раздел не пуст — и текст об этом говорит прямо.
      expect(find.text('Пусто'), findsNothing);
      expect(find.text('Страница опустела'), findsOneWidget);
      // Перевёрнутого диапазона «21–20» на экране быть не может.
      expect(find.textContaining('Показано'), findsNothing);
    });

    testWidgets('перелистывание не подменяет карточки скелетоном',
        (tester) async {
      await pumpCatalog(
        tester,
        itemCount: 20,
        page: 2,
        totalPages: 19,
        totalCount: 365,
        isLoading: true,
      );

      // Прежние карточки и полоса номеров остаются на месте: иначе полоса
      // исчезает прямо под курсором в момент нажатия.
      expect(find.byType(ModerationCatalogCard), findsWidgets);
      expect(find.textContaining('21–40'), findsOneWidget);
    });

    testWidgets('первая загрузка показывает скелетон', (tester) async {
      await pumpCatalog(
        tester,
        itemCount: 0,
        totalCount: 0,
        isLoading: true,
      );

      expect(find.byType(ModerationCatalogCard), findsNothing);
      expect(find.text('Пусто'), findsNothing);
    });
  });

  group('Раскладка номеров страниц', () {
    test('до пяти страниц показываются все', () {
      expect(pageEntries(1, 1), <int?>[1]);
      expect(pageEntries(2, 5), <int?>[1, 2, 3, 4, 5]);
    });

    test('в начале длинного списка многоточие только справа', () {
      expect(pageEntries(1, 19), <int?>[1, 2, null, 19]);
    });

    test('в середине многоточия с обеих сторон', () {
      expect(pageEntries(10, 19), <int?>[1, null, 9, 10, 11, null, 19]);
    });

    test('в конце многоточие только слева', () {
      expect(pageEntries(19, 19), <int?>[1, null, 18, 19]);
    });

    test('многоточие никогда не заменяет ровно одну страницу', () {
      // Слот у «…» тот же, что у номера, поэтому спрятать за ним одну
      // страницу — потерять сведения, ничего не выиграв.
      for (var total = 6; total <= 40; total++) {
        for (var page = 1; page <= total; page++) {
          final entries = pageEntries(page, total);
          for (var i = 1; i < entries.length - 1; i++) {
            if (entries[i] != null) continue;
            final before = entries[i - 1]!;
            final after = entries[i + 1]!;
            expect(
              after - before,
              greaterThan(2),
              reason: 'страница $page из $total: «…» между $before и $after '
                  'закрывает одну страницу',
            );
          }
        }
      }
    });

    test('полоса номеров остаётся узкой', () {
      // Ширина футера ограничена колонкой 420. Больше семи слотов туда не
      // помещается, поэтому окно вокруг текущей страницы — по одному соседу.
      for (var total = 6; total <= 200; total++) {
        for (var page = 1; page <= total; page++) {
          expect(
            pageEntries(page, total).length,
            lessThanOrEqualTo(7),
            reason: 'страница $page из $total',
          );
        }
      }
    });

    test('первая и последняя страницы есть всегда', () {
      for (var page = 1; page <= 19; page++) {
        final entries = pageEntries(page, 19);
        expect(entries.first, 1, reason: 'страница $page');
        expect(entries.last, 19, reason: 'страница $page');
        expect(entries, contains(page), reason: 'страница $page');
      }
    });
  });

  group('Порядок списка', () {
    testWidgets('без вариантов порядка меню не открывается', (tester) async {
      await pumpCatalog(tester);

      // Подпись есть, но нажимать не на что: обещать выбор, которого нет на
      // бэкенде, нельзя.
      expect(find.text('сначала новые'), findsOneWidget);
      expect(find.byType(PopupMenuButton<String>), findsNothing);
    });

    testWidgets('с вариантами за той же подписью стоит меню', (tester) async {
      String? picked;
      await pumpCatalog(
        tester,
        sortOptions: const <CatalogSortOption>[
          CatalogSortOption(value: 'newest', label: 'Сначала новые'),
          CatalogSortOption(value: 'rating', label: 'По рейтингу'),
        ],
        onSortChanged: (value) => picked = value,
      );

      await tester.tap(find.byType(PopupMenuButton<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('По рейтингу'));
      await tester.pumpAndSettle();

      expect(picked, 'rating');
    });
  });

  group('Статус человеческим языком', () {
    test('машинные коды переведены', () {
      expect(StatusDot.labelFor('rejected'), 'отказано');
      expect(StatusDot.labelFor('draft'), 'черновик');
      expect(StatusDot.labelFor('suspended'), 'приостановлено');
      expect(StatusDot.labelFor('active'), 'опубликовано');
    });

    test('карта покрывает весь набор статусов заведения', () {
      // Набор повторяет CHECK-ограничение `establishments_status_check`
      // (migrations/production_schema.sql). Появится новый статус на
      // бэкенде — этот тест заставит завести и перевод, вместо того чтобы
      // показать модератору сырой код.
      expect(
        kEstablishmentStatuses.keys.toSet(),
        <String>{
          'draft',
          'pending',
          'active',
          'rejected',
          'suspended',
          'archived',
        },
      );
    });

    test('незнакомый код виден как есть, а не прячется', () {
      // Молчаливая подмена на «неизвестно» скрыла бы расхождение с
      // бэкендом ровно там, где его нужно заметить.
      expect(StatusDot.labelFor('quarantined'), 'quarantined');
    });
  });
}
