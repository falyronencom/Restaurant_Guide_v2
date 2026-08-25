import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/audit_log_entry.dart';
import 'package:restaurant_guide_admin_web/models/user.dart';
import 'package:restaurant_guide_admin_web/providers/audit_log_provider.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/screens/audit_log/audit_log_screen.dart';
import 'package:restaurant_guide_admin_web/services/audit_log_service.dart';
import 'package:restaurant_guide_admin_web/services/auth_service.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_pagination.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_empty_state.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_error_card.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_error_toast.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_skeleton.dart';

// «Журнал действий» — кадр 06, образец таблицы канона. До этапа 5 у экрана не
// было ни одного теста.
//
// Проверяется не оформление, а обещания, которые оформление даёт: машинных
// кодов на экране нет, тип данных виден по шрифту, точка действия говорит о
// направлении ограничения, а раскрытая строка показывает и контекст, и само
// изменение.

class _FakeAuditLogService implements AuditLogService {
  Completer<AuditLogListResponse> response =
      Completer<AuditLogListResponse>();

  int calls = 0;
  String? lastAction;
  String? lastEntityType;

  @override
  Future<AuditLogListResponse> getAuditLog({
    int page = 1,
    int perPage = 20,
    String? action,
    String? entityType,
    DateTime? from,
    DateTime? to,
  }) {
    calls++;
    lastAction = action;
    lastEntityType = entityType;
    return response.future;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// Сеть в этих тестах не нужна: `AuthProvider` дёргает сервис в конструкторе.
class _NoopAuthService implements AuthService {
  @override
  Future<bool> isAuthenticated() async => false;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// Текущий администратор задаётся тестом напрямую — авторизацию проходить
/// незачем, экрану нужен только e-mail для сравнения «это не я ли».
class _StubAuthProvider extends AuthProvider {
  @override
  final User? currentUser;

  _StubAuthProvider(this.currentUser) : super(authService: _NoopAuthService());
}

AuditLogEntry _entry({
  String id = 'e1',
  String action = 'moderate_approve',
  String summary = 'Одобрено заведение',
  String entityType = 'establishment',
  String? entityId = '1a2b3c4d-0000-4000-8000-000000000000',
  String? adminName = 'Всеволод',
  String? adminEmail = 'vsevolod@nirivio.by',
  DateTime? createdAt,
  Map<String, dynamic>? entityContext,
  Map<String, dynamic>? oldData,
  Map<String, dynamic>? newData,
}) =>
    AuditLogEntry(
      id: id,
      action: action,
      summary: summary,
      entityType: entityType,
      entityId: entityId,
      adminName: adminName,
      adminEmail: adminEmail,
      createdAt: createdAt ?? DateTime.utc(2026, 7, 14, 6, 41),
      entityContext: entityContext,
      oldData: oldData,
      newData: newData,
    );

void main() {
  /// Поднимает экран на подставном сервисе.
  ///
  /// Сервис создаётся здесь, внутри вызова из теста, а не в `setUp`:
  /// `Completer` привязывает future к зоне, в которой создан, и созданный вне
  /// `testWidgets` он доставлял бы результат мимо `tester.pump()`.
  ///
  /// Окно 1440x820 — размер кадра. В дефолтных 800x600 колонки таблицы
  /// (168 + 200 + 36 фиксированных плюс две тянущиеся) вставали бы иначе.
  Future<_FakeAuditLogService> pumpScreen(
    WidgetTester tester, {
    String? currentAdminEmail = 'vsevolod@nirivio.by',
  }) async {
    final fake = _FakeAuditLogService();

    tester.view.physicalSize = const Size(1440, 820);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider(
            create: (_) => AuditLogProvider(service: fake),
          ),
          ChangeNotifierProvider<AuthProvider>(
            create: (_) => _StubAuthProvider(
              currentAdminEmail == null
                  ? null
                  : User(id: 'admin', email: currentAdminEmail, role: 'admin'),
            ),
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.lightTheme,
          home: const Scaffold(body: AuditLogScreen()),
        ),
      ),
    );
    // Загрузка стартует из postFrameCallback — один кадр, чтобы она ушла.
    await tester.pump();

    return fake;
  }

  /// Доводит экран до состояния, в которое его привёл завершённый запрос.
  /// Кадра два: первый разгребает микрозадачи, второй перерисовывает.
  Future<void> settle(
    WidgetTester tester,
    _FakeAuditLogService fake, {
    required List<AuditLogEntry> entries,
    int? total,
    int pages = 1,
    int page = 1,
  }) async {
    fake.response.complete(
      AuditLogListResponse(
        entries: entries,
        total: total ?? entries.length,
        page: page,
        pages: pages,
      ),
    );
    fake.response = Completer<AuditLogListResponse>();
    await tester.pump();
    await tester.pump();
  }

  final dotFinder = find.descendant(
    of: find.byType(AuditLogScreen),
    matching: find.byWidgetPredicate(
      (w) =>
          w is Container &&
          w.decoration is BoxDecoration &&
          (w.decoration! as BoxDecoration).shape == BoxShape.circle &&
          w.constraints?.maxWidth == 7,
    ),
  );

  Color? dotColor(WidgetTester tester) {
    final dot = tester.widget<Container>(dotFinder);
    return (dot.decoration! as BoxDecoration).color;
  }

  group('Состояния', () {
    testWidgets('первая загрузка — скелетон, а не крутилка', (tester) async {
      await pumpScreen(tester);

      expect(find.byType(SkeletonBlock), findsWidgets);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      // Шапка таблицы в скелетоне на месте: грузится тело, а не разметка.
      expect(find.text('ДАТА И ВРЕМЯ'), findsOneWidget);
    });

    testWidgets('ошибка загрузки — карточка канона, а не красный текст',
        (tester) async {
      final fake = await pumpScreen(tester);
      fake.response.completeError(Exception('503'));
      await tester.pump();
      await tester.pump();

      expect(find.byType(AdminErrorCard), findsOneWidget);
      expect(find.text('Журнал не загрузился'), findsOneWidget);
    });

    testWidgets('неудача перелистывания не пропадает молча', (tester) async {
      final fake = await pumpScreen(tester);
      await settle(
        tester,
        fake,
        entries: <AuditLogEntry>[_entry()],
        total: 40,
        pages: 2,
      );

      tester
          .element(find.byType(AuditLogScreen))
          .read<AuditLogProvider>()
          .loadEntries(page: 2);
      fake.response.completeError(Exception('503'));
      fake.response = Completer<AuditLogListResponse>();
      await tester.pump();
      await tester.pump();
      await tester.pump();

      // Карточки нет — она заняла бы всю область и снесла бы уже показанные
      // строки; строки честно остались от прошлой страницы.
      expect(find.byType(AdminErrorCard), findsNothing);
      expect(find.text('Одобрено заведение'), findsOneWidget);
      // Подпись шапки на месте: без неё заголовок центрируется и прыгает по
      // вертикали, а немотивированный сдвиг вёрстки читается как поломка
      // убедительнее самой ошибки.
      expect(find.textContaining('за 30 дней'), findsOneWidget);
      // О неудаче сказано тостом — он для того и заведён, чтобы не сбрасывать
      // работу.
      expect(find.byType(AdminErrorToast), findsOneWidget);
      expect(find.text('Страница не загрузилась'), findsOneWidget);
    });

    testWidgets('пустой журнал без фильтров — раздел, а не «нет данных»',
        (tester) async {
      final fake = await pumpScreen(tester);
      await settle(tester, fake, entries: <AuditLogEntry>[]);

      expect(find.byType(AdminEmptyState), findsOneWidget);
      expect(find.text('Журнал пуст'), findsOneWidget);
      // Кнопки сброса нет: сбрасывать нечего.
      expect(find.text('Сбросить фильтры'), findsNothing);
    });

    testWidgets('пусто под фильтром — режим отбора со снятием по строке',
        (tester) async {
      final fake = await pumpScreen(tester);
      await settle(tester, fake, entries: <AuditLogEntry>[_entry()]);

      tester
          .element(find.byType(AuditLogScreen))
          .read<AuditLogProvider>()
          .setActionFilter('review_hide');
      await settle(tester, fake, entries: <AuditLogEntry>[]);

      expect(find.text('Под фильтр ничего не подошло'), findsOneWidget);
      // Строка называет фильтр по-русски, а не кодом.
      expect(find.text('Тип действия: Скрытие отзыва'), findsOneWidget);
      expect(find.text('Сбросить фильтры'), findsOneWidget);
    });
  });

  group('Строка таблицы', () {
    testWidgets('дата словом, время моноширинным', (tester) async {
      final fake = await pumpScreen(tester);
      await settle(tester, fake, entries: <AuditLogEntry>[
        _entry(createdAt: DateTime.utc(2026, 7, 14, 6, 41)),
      ]);

      // Время местное: UTC+3 превращает 06:41Z в 09:41.
      final localTime = DateTime.utc(2026, 7, 14, 6, 41).toLocal();
      final expected =
          '${localTime.hour.toString().padLeft(2, '0')}:${localTime.minute.toString().padLeft(2, '0')}';

      expect(find.text(expected), findsOneWidget);
      final time = tester.widget<Text>(find.text(expected));
      expect(
        time.style?.fontFamily,
        contains('JetBrainsMono'),
        reason: 'табличная величина держится на моноширинном',
      );
    });

    testWidgets('в колонке «Объект» — имя заведения, а не машинный тип',
        (tester) async {
      final fake = await pumpScreen(tester);
      await settle(tester, fake, entries: <AuditLogEntry>[
        _entry(
          entityContext: <String, dynamic>{'name': 'Кухмістр', 'city': 'Минск'},
        ),
      ]);

      expect(find.text('Кухмістр'), findsOneWidget);
      // Ни машинного типа, ни полного UUID на экране.
      expect(find.text('establishment'), findsNothing);
      expect(
        find.text('1a2b3c4d-0000-4000-8000-000000000000'),
        findsNothing,
      );
      // Идентификатор остаётся, но коротким и моноширинным.
      final id = tester.widget<Text>(find.text('1a2b3c4d'));
      expect(id.style?.fontFamily, contains('JetBrainsMono'));
    });

    testWidgets('пробелы по краям имени не доезжают до вёрстки',
        (tester) async {
      final fake = await pumpScreen(tester);
      await settle(tester, fake, entries: <AuditLogEntry>[
        _entry(
          entityContext: <String, dynamic>{
            'name': '  Кухмістр ',
            'city': ' Минск ',
          },
        ),
      ]);

      // Проверялось обрезанное значение, а в заголовок клалось исходное —
      // ведущий пробел сдвигал бы колонку.
      expect(find.text('Кухмістр'), findsOneWidget);

      await tester.tap(find.text('Одобрено заведение'));
      await tester.pump();
      expect(find.text('Кухмістр, Минск'), findsOneWidget);
    });

    testWidgets('у записи об отзыве заголовок — автор, а не заведение',
        (tester) async {
      final fake = await pumpScreen(tester);
      await settle(tester, fake, entries: <AuditLogEntry>[
        _entry(
          action: 'review_hide',
          summary: 'Скрыт отзыв',
          entityType: 'review',
          entityContext: <String, dynamic>{
            'reviewer_name': 'Ирина К.',
            'establishment_name': 'Golden Coffee',
          },
        ),
      ]);

      // Идентификатор рядом с заголовком — это идентификатор ОТЗЫВА, и имя
      // заведения над ним подталкивало бы скопировать одно, думая про другое.
      expect(find.text('Ирина К.'), findsOneWidget);
      expect(find.text('Golden Coffee'), findsNothing);
    });

    testWidgets('без контекста заголовок — тип по-русски', (tester) async {
      final fake = await pumpScreen(tester);
      await settle(tester, fake, entries: <AuditLogEntry>[
        _entry(
          action: 'hide_menu_item',
          summary: 'Скрыта позиция меню',
          entityType: 'menu_item',
        ),
      ]);

      expect(find.text('Позиция меню'), findsOneWidget);
      expect(find.text('menu_item'), findsNothing);
    });

    testWidgets('точка действия кодирует направление ограничения',
        (tester) async {
      final fake = await pumpScreen(tester);

      /// Перезагружает журнал одной записью с заданным действием.
      ///
      /// Именно перезагружает: `settle` завершает тот `Completer`, который
      /// провайдер сейчас ждёт, и без нового `loadEntries` второй вызов
      /// достался бы никому — на экране осталась бы прежняя строка.
      Future<void> showAction(String action, String summary) async {
        tester
            .element(find.byType(AuditLogScreen))
            .read<AuditLogProvider>()
            .loadEntries();
        await settle(
          tester,
          fake,
          entries: <AuditLogEntry>[_entry(action: action, summary: summary)],
        );
      }

      await showAction('moderate_approve', 'Одобрено заведение');
      expect(dotColor(tester), AppTheme.statusGreen);

      await showAction('review_hide', 'Скрыт отзыв');
      expect(dotColor(tester), AppTheme.errorRed);

      // Правка данных ничего не открыла и не закрыла.
      await showAction('admin_update_coordinates', 'Координаты обновлены');
      expect(dotColor(tester), AppTheme.textSecondary);
    });

    testWidgets('свои действия помечены брендовым кружком, чужие — серым',
        (tester) async {
      final fake = await pumpScreen(tester);
      await settle(tester, fake, entries: <AuditLogEntry>[
        _entry(adminName: 'Всеволод', adminEmail: 'VSEVOLOD@nirivio.by'),
        _entry(id: 'e2', adminName: 'Мария', adminEmail: 'maria@nirivio.by'),
      ]);

      Color? avatarColor(String initial) {
        final container = tester.widget<Container>(
          find.ancestor(
            of: find.text(initial),
            matching: find.byType(Container),
          ).first,
        );
        return (container.decoration! as BoxDecoration).color;
      }

      // Регистр в e-mail не должен превращать своё действие в чужое.
      expect(avatarColor('В'), AppTheme.primaryOrangeDark);
      expect(avatarColor('М'), AppTheme.gray500);
    });
  });

  group('Раскрытая строка', () {
    testWidgets('показывает контекст и изменение', (tester) async {
      final fake = await pumpScreen(tester);
      await settle(tester, fake, entries: <AuditLogEntry>[
        _entry(
          action: 'review_hide',
          summary: 'Скрыт отзыв',
          entityType: 'review',
          entityContext: <String, dynamic>{
            'reviewer_name': 'Ирина К.',
            'rating': 2,
            'establishment_name': 'Golden Coffee',
            'establishment_city': 'Гродно',
            'text_snippet': 'Кофе холодный',
          },
          oldData: <String, dynamic>{'is_visible': true},
          newData: <String, dynamic>{'is_visible': false},
        ),
      ]);

      expect(find.text('КОНТЕКСТ ЗАПИСИ'), findsNothing);

      await tester.tap(find.text('Скрыт отзыв'));
      await tester.pump();

      expect(find.text('КОНТЕКСТ ЗАПИСИ'), findsOneWidget);
      expect(find.text('ИЗМЕНЕНИЕ'), findsOneWidget);
      expect(find.text('Ирина К.'), findsWidgets);
      expect(find.text('2 / 5'), findsOneWidget);
      expect(find.text('Golden Coffee, Гродно'), findsOneWidget);
      expect(find.text('до'), findsOneWidget);
      expect(find.text('после'), findsOneWidget);
    });

    testWidgets('«после» берёт цвет действия, «до» остаётся нейтральным',
        (tester) async {
      final fake = await pumpScreen(tester);
      await settle(tester, fake, entries: <AuditLogEntry>[
        _entry(
          action: 'moderate_approve',
          summary: 'Одобрено заведение',
          oldData: <String, dynamic>{'status': 'pending'},
          newData: <String, dynamic>{'status': 'active'},
        ),
      ]);

      await tester.tap(find.text('Одобрено заведение'));
      await tester.pump();

      Color edgeColor(String label) {
        final box = tester.widget<Container>(
          find
              .ancestor(
                of: find.text(label),
                matching: find.byType(Container),
              )
              .first,
        );
        return ((box.decoration! as BoxDecoration).border! as Border)
            .left
            .color;
      }

      // Постоянный красный, как в единственном примере кадра, у одобрения
      // читался бы как ошибка.
      expect(edgeColor('после'), AppTheme.statusGreen);
      // Прошлое состояние — уже история, красить её в цвет действия значило бы
      // обвинять сами данные.
      expect(edgeColor('до'), AppTheme.textGrey);
    });

    testWidgets('запись без контекста и без данных не рисует пустых колонок',
        (tester) async {
      final fake = await pumpScreen(tester);
      await settle(tester, fake, entries: <AuditLogEntry>[
        _entry(
          action: 'upgrade_user_to_partner',
          summary: 'Пользователь повышен до партнёра',
          entityType: 'user',
        ),
      ]);

      await tester.tap(find.text('Пользователь повышен до партнёра'));
      await tester.pump();

      expect(find.text('КОНТЕКСТ ЗАПИСИ'), findsNothing);
      expect(find.text('ИЗМЕНЕНИЕ'), findsNothing);
      expect(find.text('Подробностей у этой записи нет'), findsOneWidget);
    });
  });

  group('Геометрия таблицы', () {
    // Мерим числами, а не глазами: пиксельные дефекты таблицы на скриншоте
    // видно, а в коде нет.
    testWidgets('колонки строки совпадают с колонками шапки', (tester) async {
      final fake = await pumpScreen(tester);
      await settle(tester, fake, entries: <AuditLogEntry>[
        _entry(
          entityContext: <String, dynamic>{'name': 'Кухмістр', 'city': 'Минск'},
        ),
      ]);

      double left(Finder finder) => tester.getRect(finder).left;

      // Совпадение ловит не смену ширины (шапка и строка ходят от одной
      // константы и уедут вместе), а строку, собранную в обход общей
      // раскладки, — то есть ровно тот способ, каким таблицы и разъезжаются.
      // `textContaining`, а не `text`: с 2027 года ячейка нарисует «14 июля 2026»
      // — год добавляется, когда он не текущий, — и тест упал бы по «виджета
      // нет», то есть по причине, к его предмету отношения не имеющей.
      expect(left(find.textContaining('14 июля')), left(find.text('ДАТА И ВРЕМЯ')));
      expect(left(dotFinder), left(find.text('ДЕЙСТВИЕ')));
      expect(left(find.text('Кухмістр')), left(find.text('ОБЪЕКТ')));
      // У колонки администратора первым идёт кружок аватара.
      expect(
        left(find.ancestor(of: find.text('В'), matching: find.byType(Container)).first),
        left(find.text('АДМИНИСТРАТОР')),
      );
    });

    testWidgets('ширины закреплены по кадру 06', (tester) async {
      final fake = await pumpScreen(tester);
      await settle(tester, fake, entries: <AuditLogEntry>[_entry()]);

      double left(Finder finder) => tester.getRect(finder).left;
      final dateLeft = left(find.textContaining('14 июля'));

      // Отступ тела 24 плюс отступ ячейки 14.
      expect(dateLeft, 38);
      // Колонка даты — 168 из `168px 467px 260px 200px 36px` кадра.
      expect(left(dotFinder) - dateLeft, 168);
      // Колонка шеврона — 36, прижата к правому краю тела.
      expect(
        tester.getRect(find.byIcon(Icons.expand_more).last).center.dx,
        1440 - 24 - 36 / 2,
      );
    });

    testWidgets('высоты шапки и строки — 40 и 52', (tester) async {
      final fake = await pumpScreen(tester);
      await settle(tester, fake, entries: <AuditLogEntry>[_entry()]);

      double boxHeight(String text) => tester
          .getSize(
            find
                .ancestor(of: find.text(text), matching: find.byType(Container))
                .last,
          )
          .height;

      expect(boxHeight('ДАТА И ВРЕМЯ'), 40);
      expect(boxHeight('Одобрено заведение'), 52);
    });

    testWidgets('у раскрытой строки нижней границы нет', (tester) async {
      final fake = await pumpScreen(tester);
      await settle(tester, fake, entries: <AuditLogEntry>[
        _entry(newData: <String, dynamic>{'status': 'active'}),
      ]);

      Border? rowBorder() {
        final row = tester.widget<Container>(
          find
              .ancestor(
                of: find.text('Одобрено заведение'),
                matching: find.byType(Container),
              )
              .last,
        );
        return (row.decoration! as BoxDecoration).border as Border?;
      }

      expect(rowBorder()?.bottom.color, AppTheme.borderLight);

      await tester.tap(find.text('Одобрено заведение'));
      await tester.pump();

      // Под раскрытой строкой сразу панель, и линия отрезала бы её от
      // собственной строки.
      expect(rowBorder(), isNull);
    });
  });

  group('Шапка и футер', () {
    testWidgets('подпись считает записи и называет период', (tester) async {
      final fake = await pumpScreen(tester);
      await settle(
        tester,
        fake,
        entries: <AuditLogEntry>[_entry(createdAt: DateTime.now())],
        total: 348,
        pages: 18,
      );

      expect(
        find.textContaining('348 записей за 30 дней'),
        findsOneWidget,
      );
      expect(find.textContaining('последняя только что'), findsOneWidget);
    });

    testWidgets('футер виден и на единственной странице', (tester) async {
      final fake = await pumpScreen(tester);
      await settle(tester, fake, entries: <AuditLogEntry>[_entry()], total: 1);

      expect(find.byType(AdminPagination), findsOneWidget);
      expect(find.textContaining('Показано'), findsOneWidget);
      expect(find.textContaining('из 1'), findsOneWidget);
    });
  });

  group('Фильтры', () {
    testWidgets('«Объект» уходит в запрос — эндпоинт принимал его всегда',
        (tester) async {
      final fake = await pumpScreen(tester);
      await settle(tester, fake, entries: <AuditLogEntry>[_entry()]);

      await tester.tap(find.text('Объект'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Отзыв').last);
      await tester.pump();

      expect(fake.lastEntityType, 'review');
    });

    testWidgets('пункт «Все» действительно снимает фильтр', (tester) async {
      final fake = await pumpScreen(tester);
      await settle(tester, fake, entries: <AuditLogEntry>[_entry()]);

      tester
          .element(find.byType(AuditLogScreen))
          .read<AuditLogProvider>()
          .setActionFilter('suspend');
      await settle(tester, fake, entries: <AuditLogEntry>[_entry()]);
      expect(fake.lastAction, 'suspend');

      await tester.tap(find.text('Тип действия'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Все').last);
      await tester.pump();

      // `PopupMenuButton` не приносит `null` в `onSelected`, а «Все» — это
      // ровно `null`: без обёртки пункт молча ничего бы не делал.
      expect(fake.lastAction, isNull);
    });
  });
}
