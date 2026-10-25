import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/router.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/flagged_menu_item.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/models/user.dart';
import 'package:restaurant_guide_admin_web/providers/approved_provider.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/providers/badges_provider.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';
import 'package:restaurant_guide_admin_web/screens/moderation/approved_screen.dart';
import 'package:restaurant_guide_admin_web/screens/moderation/pending_moderation_screen.dart';
import 'package:restaurant_guide_admin_web/screens/moderation/rejected_screen.dart';
import 'package:restaurant_guide_admin_web/providers/rejected_provider.dart';
import 'package:restaurant_guide_admin_web/services/moderation_service.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_pagination.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_sidebar.dart';
import 'package:restaurant_guide_admin_web/widgets/media/media_viewer.dart';
import 'package:restaurant_guide_admin_web/widgets/media/network_thumbnail.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_detail_panel.dart';

import '../helpers/stub_auth.dart';

// Экраны модерации заведений: обещания экрана сбываются (П5 прохода по
// панели модератора, 20.10). Каждый тест держит один пункт директивы; номер
// пункта находки — в названии группы.

const String _shown = 'a41f9c02-1234-5678-9abc-def012345678';

EstablishmentListItem _listItem(int i) => EstablishmentListItem(
      id: 'est-$i',
      name: 'Заведение $i',
      city: 'Минск',
      categories: const <String>['Ресторан'],
      updatedAt: DateTime.now().subtract(Duration(days: 30 - i % 30)),
    );

EstablishmentDetail _detail({
  String id = _shown,
  String status = 'pending',
  String? unp = '191482073',
  String? registrationDocUrl = 'https://res.cloudinary.com/t/raw/upload/reg.pdf',
  List<String> categories = const <String>['Ресторан'],
  List<String> cuisines = const <String>['Народная'],
  Map<String, dynamic>? attributes,
  String? priceRange = r'$$',
  Map<String, dynamic>? moderationNotes,
}) =>
    EstablishmentDetail(
      id: id,
      partnerId: 'p-1',
      name: 'Кухмістр',
      status: status,
      city: 'Минск',
      address: 'ул. Ленина, 5',
      latitude: 53.9,
      longitude: 27.55,
      phone: '+375 29 611-24-80',
      email: 'kuhmistr@example.by',
      description: 'Кухня по старым рецептам.',
      categories: categories,
      cuisines: cuisines,
      priceRange: priceRange,
      workingHours: const <String, dynamic>{'monday': '10:00-22:00'},
      attributes: attributes,
      legalName: 'ООО «Кухмістр Плюс»',
      unp: unp,
      registrationDocUrl: registrationDocUrl,
      contactPerson: 'Иван Контактов',
      contactEmail: 'ivan@example.by',
      interiorPhotos: const <MediaItem>[MediaItem(url: '')],
      menuMedia: const <MediaItem>[MediaItem(url: '', fileType: 'pdf')],
      moderationNotes: moderationNotes,
    );

/// Сервис по образцу сервера: очередь страницами, карточки по id.
class _FakeService implements ModerationService {
  _FakeService({int pendingTotal = 0, EstablishmentDetail Function(String id)? detail})
      : _queue = <int>[for (var i = 1; i <= pendingTotal; i++) i],
        detail = detail ?? ((id) => _detail(id: id));

  /// Номера заявок в очереди: решённая уходит, остальные сдвигаются.
  final List<int> _queue;
  int get pendingTotal => _queue.length;
  final EstablishmentDetail Function(String id) detail;
  final List<int> pagesAsked = <int>[];
  final List<String> decisions = <String>[];
  final List<String> searches = <String>[];

  /// Поиск людей: ответ держит тест.
  final Map<String, Completer<List<UserSearchResult>>> userSearches =
      <String, Completer<List<UserSearchResult>>>{};

  List<EstablishmentListItem> _page(int page) {
    final from = (page - 1) * 20;
    final to = (from + 20).clamp(0, pendingTotal);
    return <EstablishmentListItem>[
      for (var i = from; i < to; i++) _listItem(_queue[i]),
    ];
  }

  @override
  Future<PendingListResponse> getPendingEstablishments({
    int page = 1,
    int perPage = 20,
  }) async {
    pagesAsked.add(page);
    return PendingListResponse(
      establishments: _page(page),
      total: pendingTotal,
      page: page,
      pages: pendingTotal == 0 ? 1 : (pendingTotal + 19) ~/ 20,
    );
  }

  @override
  Future<EstablishmentDetail> getEstablishmentDetails(String id) async =>
      detail(id);

  @override
  Future<void> moderateEstablishment({
    required String id,
    required String action,
    Map<String, String> moderationNotes = const {},
  }) async {
    decisions.add('$id $action');
    _queue.remove(int.parse(id.split('-').last));
  }

  @override
  Future<ActiveListResponse> getActiveEstablishments({
    int page = 1,
    int perPage = 20,
    String? sort,
    String? city,
    String? search,
  }) async =>
      const ActiveListResponse(
        establishments: <ActiveEstablishmentItem>[],
        total: 0,
        page: 1,
        pages: 1,
      );

  @override
  Future<SearchListResponse> searchEstablishments({
    required String search,
    String? status,
    String? city,
    int page = 1,
    int perPage = 20,
  }) async {
    searches.add(search);
    return const SearchListResponse(
      establishments: <SearchResultItem>[],
      total: 0,
      page: 1,
      pages: 1,
    );
  }

  @override
  Future<RejectedListResponse> getRejectedEstablishments({
    int page = 1,
    int perPage = 20,
  }) async =>
      const RejectedListResponse(
        rejections: <RejectedEstablishmentItem>[],
        total: 0,
        page: 1,
        pages: 1,
      );

  @override
  Future<List<UserSearchResult>> searchUsers(String query) =>
      (userSearches[query] ??= Completer<List<UserSearchResult>>()).future;

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(
        'фейк не обслуживает ${invocation.memberName}',
      );
}

class _StubBadges extends BadgesProvider {
  @override
  Future<void> load() async {}
}

Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 300));
}

Future<ModerationProvider> _pumpPending(
  WidgetTester tester,
  _FakeService service, {
  Size size = const Size(1440, 900),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  final provider = ModerationProvider(service: service);
  addTearDown(provider.dispose);
  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<ModerationProvider>.value(value: provider),
        ChangeNotifierProvider<BadgesProvider>(create: (_) => _StubBadges()),
        ChangeNotifierProvider<AuthProvider>(
          create: (_) => StubAuthProvider.admin(),
        ),
      ],
      child: MaterialApp(
        theme: AppTheme.lightTheme,
        home: const Scaffold(body: PendingModerationScreen()),
      ),
    ),
  );
  await _settle(tester);
  return provider;
}

void main() {
  group('A1-04 — очередь листается', () {
    testWidgets('заявки после 20-й достижимы: футер и вторая страница',
        (tester) async {
      final service = _FakeService(pendingTotal: 25);
      final provider = await _pumpPending(tester, service);

      expect(find.textContaining('25 заявок в очереди'), findsOneWidget);
      expect(find.byType(AdminPagination), findsOneWidget);
      expect(find.textContaining('1–20'), findsOneWidget);
      expect(find.text('Заведение 21'), findsNothing);

      await provider.goToPage(2);
      await _settle(tester);

      expect(service.pagesAsked, <int>[1, 2]);
      expect(find.text('Заведение 21'), findsOneWidget);
      // Старейшая — на первой странице; на второй подпись о ней молчит.
      expect(find.textContaining('старейшая'), findsNothing);
    });

    testWidgets('после решения страница добирается, а не пустеет',
        (tester) async {
      final service = _FakeService(pendingTotal: 21);
      final provider = await _pumpPending(tester, service);

      await provider.selectEstablishment('est-1');
      await _settle(tester);
      expect(await provider.approveEstablishment(), isTrue);
      await _settle(tester);

      expect(service.pagesAsked, <int>[1, 1]);
      // Список ленивый: 21-я строка ниже края колонки — проверяем данные.
      expect(provider.establishments, hasLength(20));
      expect(provider.establishments.map((e) => e.id), contains('est-21'));
      expect(provider.establishments.map((e) => e.id), isNot(contains('est-1')));
    });
  });

  group('A1-13, A1-12 — отметки не стираются молча', () {
    test('переход на другую заявку и обратно возвращает её отметки', () async {
      final provider = ModerationProvider(service: _FakeService(pendingTotal: 3));
      addTearDown(provider.dispose);
      await provider.loadPendingEstablishments();

      await provider.selectEstablishment('est-1');
      provider.approveField('unp');
      provider.rejectField('name', comment: 'опечатка в названии');
      await provider.selectEstablishment('est-2');
      expect(provider.checkedFieldCount, 0, reason: 'у второй заявки своё');
      provider.approveField('menu');

      await provider.selectEstablishment('est-1');
      expect(provider.getFieldState('unp').status, FieldReviewStatus.approved);
      expect(provider.getFieldState('name').comment, 'опечатка в названии');
      expect(provider.hasUnsavedVerdicts, isTrue);

      await provider.selectEstablishment('est-2');
      expect(provider.getFieldState('menu').status, FieldReviewStatus.approved);
    });

    test('✓ после заметки её не стирает', () async {
      final provider = ModerationProvider(service: _FakeService(pendingTotal: 1));
      addTearDown(provider.dispose);
      await provider.loadPendingEstablishments();
      await provider.selectEstablishment('est-1');

      provider.commentField('unp', 'сверить с реестром');
      provider.approveField('unp');
      expect(provider.getFieldState('unp').comment, 'сверить с реестром');
      provider.resetField('unp');
      expect(provider.getFieldState('unp').comment, 'сверить с реестром');
    });

    test('решение по заявке её отложенные отметки забывает', () async {
      final provider = ModerationProvider(service: _FakeService(pendingTotal: 2));
      addTearDown(provider.dispose);
      await provider.loadPendingEstablishments();
      await provider.selectEstablishment('est-1');
      provider.approveField('unp');
      await provider.selectEstablishment('est-2');
      await provider.selectEstablishment('est-1');
      expect(await provider.approveEstablishment(), isTrue);
      expect(provider.hasUnsavedVerdicts, isFalse);
    });
  });

  group('Ч10, A1-18, A1-11 — диалоги решения', () {
    testWidgets(
        '«Одобрить» при непроверенных и пустых обязательных — подтверждение '
        'с перечнем', (tester) async {
      final service = _FakeService(
        pendingTotal: 1,
        detail: (id) => _detail(id: id, unp: null, registrationDocUrl: null),
      );
      final provider = await _pumpPending(tester, service);
      await provider.selectEstablishment('est-1');
      await _settle(tester);

      await tester.tap(find.byKey(const ValueKey<String>('approve-application')));
      await tester.pumpAndSettle();

      expect(
        find.text('Проверено 0 из 14, пусты УНП и Регистрация — одобрить '
            'всё равно?'),
        findsOneWidget,
      );
      expect(find.text('«Кухмістр»'), findsOneWidget);
      await tester.tap(find.widgetWithText(FilledButton, 'Одобрить всё равно'));
      await tester.pumpAndSettle();
      expect(service.decisions, <String>['est-1 approve']);
    });

    test('предупреждение: одно пустое поле и всё проверено', () {
      expect(
        approveWarningForTest(checked: 14, total: 14, missing: <String>['УНП']),
        'Пусто поле «УНП» — одобрить всё равно?',
      );
    });

    testWidgets('«Отклонить» без причин по полям — предупреждение',
        (tester) async {
      final service = _FakeService(pendingTotal: 1);
      final provider = await _pumpPending(tester, service);
      await provider.selectEstablishment('est-1');
      await _settle(tester);

      await tester.tap(find.byKey(const ValueKey<String>('reject-application')));
      await tester.pumpAndSettle();

      expect(find.text('Отклонить заявку?'), findsOneWidget);
      expect(find.byKey(const ValueKey<String>('reject-no-reasons')),
          findsOneWidget);
      expect(find.textContaining('вернётся в черновик'), findsNothing);
      expect(find.widgetWithText(FilledButton, 'Отклонить без причин'),
          findsOneWidget);
    });
  });

  group('A1-10, Ч12, A1-19 — поля карточки словами', () {
    testWidgets('модерация: удобства, чек, категории и кухни', (tester) async {
      final service = _FakeService(
        pendingTotal: 1,
        detail: (id) => _detail(
          id: id,
          categories: const <String>['Бар'],
          cuisines: const <String>[],
          attributes: const <String, dynamic>{
            'wifi': true,
            'live_music': true,
            'terrace': false,
            'hookah_corner': true,
          },
        ),
      );
      // Высокое окно: «Информационные поля» стоят в конце ленивого списка.
      final provider =
          await _pumpPending(tester, service, size: const Size(1440, 2400));
      await provider.selectEstablishment('est-1');
      await _settle(tester);
      await tester.tap(find.textContaining('О заведении'));
      await tester.pumpAndSettle();

      expect(find.text('Wi-Fi'), findsOneWidget);
      expect(find.text('Живая музыка'), findsOneWidget);
      expect(find.text('Нет: Терраса'), findsOneWidget);
      // Ключ вне канона — как есть: расхождение видно.
      expect(find.text('hookah_corner'), findsOneWidget);
      expect(find.text('wifi'), findsNothing);
      expect(find.text(r'до 50 руб · $$'), findsOneWidget);
      expect(find.text('Бар'), findsOneWidget);
      expect(find.text('Кухню выбирать не нужно'), findsOneWidget);
    });

    testWidgets('чтение: чек суммой, у бара кухня «не требуется»',
        (tester) async {
      tester.view.physicalSize = const Size(1440, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home: Scaffold(
          body: ModerationDetailPanel(
            mode: DetailPanelMode.readonly,
            detail: _detail(
              status: 'active',
              categories: const <String>['Бар'],
              cuisines: const <String>[],
              moderationNotes: const <String, dynamic>{
                'unp': 'сверено с реестром по телефону',
                'suspend_reason': 'служебная отметка',
              },
            ),
            selectedId: _shown,
            isLoadingDetail: false,
            partnerLabel: 'Ольга Партнёрова · olga@example.by',
          ),
        ),
      ));
      await tester.pump();

      expect(find.text(r'до 50 руб · $$'), findsOneWidget);
      expect(find.text('не требуется'), findsOneWidget);
      // A1-02: кому передано — словами.
      expect(find.text('Ольга Партнёрова · olga@example.by'), findsOneWidget);
      // A1-12: заметка прошлой проверки видна, служебная отметка — нет.
      expect(find.byKey(const ValueKey<String>('moderation-notes')),
          findsOneWidget);
      expect(find.textContaining('сверено с реестром'), findsOneWidget);
      expect(find.textContaining('служебная отметка'), findsNothing);
      // F-31: текст панели выделяется.
      expect(find.byType(SelectionArea), findsOneWidget);

      // Ч18: «На карте» — кнопка, без второго повтора координат.
      await tester.tap(find.text('Адрес'));
      await tester.pumpAndSettle();
      expect(find.text('53.900000, 27.550000'), findsOneWidget);
      expect(find.text('Открыть в Яндекс Картах'), findsOneWidget);
    });

    testWidgets('Ч22: пустой список — справа не «Выберите заведение»',
        (tester) async {
      Future<void> pump({required bool listIsEmpty}) => tester.pumpWidget(
            MaterialApp(
              theme: AppTheme.lightTheme,
              home: Scaffold(
                body: ModerationDetailPanel(
                  mode: DetailPanelMode.readonly,
                  isLoadingDetail: false,
                  listIsEmpty: listIsEmpty,
                ),
              ),
            ),
          );
      await pump(listIsEmpty: true);
      expect(find.text('Выберите заведение для просмотра'), findsNothing);
      await pump(listIsEmpty: false);
      expect(find.text('Выберите заведение для просмотра'), findsOneWidget);
    });
  });

  testWidgets('Ч23: пустые «Отклонённые» — правда о текущем состоянии',
      (tester) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    final provider = RejectedProvider(service: _FakeService());
    addTearDown(provider.dispose);
    await tester.pumpWidget(MultiProvider(
      providers: [
        ChangeNotifierProvider<RejectedProvider>.value(value: provider),
        ChangeNotifierProvider<BadgesProvider>(create: (_) => _StubBadges()),
      ],
      child: MaterialApp(
        theme: AppTheme.lightTheme,
        home: const Scaffold(body: RejectedScreen()),
      ),
    ));
    await _settle(tester);

    // Подпись шапки и заголовок пустой колонки — оба о текущем состоянии.
    expect(find.text('Сейчас отклонённых нет'), findsNWidgets(2));
    expect(find.text('Отказов не было'), findsNothing);
    expect(find.textContaining('ещё не отклонялась'), findsNothing);
    expect(find.textContaining('Прошлые отказы — в журнале действий'),
        findsOneWidget);
    // Ч22: справа не приглашение выбрать из пустого списка.
    expect(find.text('Выберите заведение для просмотра'), findsNothing);
  });

  group('A1-17 — назначение партнёра', () {
    Future<_FakeService> pumpActions(
      WidgetTester tester, {
      void Function(String, String)? onClaim,
    }) async {
      final service = _FakeService();
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home: Scaffold(
          body: Center(
            child: ModerationEntityActions(
              establishmentName: 'Кухмістр',
              userSearch: service.searchUsers,
              onClaim: onClaim ?? (_, __) {},
            ),
          ),
        ),
      ));
      await tester.tap(find.text('Назначить партнёра'));
      await tester.pumpAndSettle();
      return service;
    }

    const ivan = UserSearchResult(
      id: 'u-1',
      email: 'ivan@example.by',
      name: 'Иван',
      role: 'partner',
    );
    const ivanov = UserSearchResult(
      id: 'u-2',
      email: 'ivanov@example.by',
      name: 'Иванов',
      role: 'user',
    );

    testWidgets('поздний ответ на короткий запрос не перекрывает свежий; роли '
        'словами', (tester) async {
      final service = await pumpActions(tester);

      await tester.enterText(find.byType(TextField), 'ив');
      await tester.pump();
      await tester.enterText(find.byType(TextField), 'иванов');
      await tester.pump();

      service.userSearches['иванов']!.complete(<UserSearchResult>[ivanov]);
      await tester.pump();
      service.userSearches['ив']!.complete(<UserSearchResult>[ivan, ivanov]);
      await tester.pump();

      expect(find.text('Иван'), findsNothing);
      expect(find.text('ivanov@example.by · пользователь'), findsOneWidget);
      expect(find.textContaining(' · user'), findsNothing);
    });

    testWidgets('сбой поиска — причиной и с «Повторить»', (tester) async {
      final service = await pumpActions(tester);
      await tester.enterText(find.byType(TextField), 'ив');
      await tester.pump();
      service.userSearches['ив']!.completeError(DioException(
        requestOptions: RequestOptions(path: '/api/v1/admin/users/search'),
        type: DioExceptionType.connectionError,
      ));
      await tester.pump();

      expect(find.text('Поиск не удался'), findsOneWidget);
      expect(find.textContaining('Нет связи с сервером'), findsOneWidget);
      expect(find.text('Повторить'), findsOneWidget);
      expect(find.text('Ошибка поиска'), findsNothing);
    });

    testWidgets('выбор отдаёт экрану, кому передано', (tester) async {
      String? label;
      final service = await pumpActions(
        tester,
        onClaim: (_, l) => label = l,
      );
      await tester.enterText(find.byType(TextField), 'иван');
      await tester.pump();
      service.userSearches['иван']!.complete(<UserSearchResult>[ivan]);
      await tester.pump();
      await tester.tap(find.text('Иван'));
      await tester.pump();
      await tester.tap(find.widgetWithText(FilledButton, 'Назначить'));
      await tester.pumpAndSettle();

      expect(label, 'Иван · ivan@example.by');
    });
  });

  group('Ч19 — поиск по карточкам', () {
    testWidgets('ищет по мере ввода, заголовок говорит, где ищем',
        (tester) async {
      tester.view.physicalSize = const Size(1440, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      final service = _FakeService();
      final provider = ApprovedProvider(service: service);
      addTearDown(provider.dispose);
      await tester.pumpWidget(MultiProvider(
        providers: [
          ChangeNotifierProvider<ApprovedProvider>.value(value: provider),
          ChangeNotifierProvider<BadgesProvider>(create: (_) => _StubBadges()),
          ChangeNotifierProvider<AuthProvider>(
            create: (_) => StubAuthProvider.admin(),
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.lightTheme,
          home: const Scaffold(body: ApprovedScreen()),
        ),
      ));
      await _settle(tester);
      expect(find.text('Одобренные'), findsOneWidget);

      await tester.enterText(find.byType(TextField), 'к');
      await tester.pump(const Duration(milliseconds: 600));
      expect(service.searches, isEmpty, reason: 'одна буква — не поиск');

      await tester.enterText(find.byType(TextField), 'кофе');
      await tester.pump(const Duration(milliseconds: 200));
      expect(service.searches, isEmpty, reason: 'пауза ещё не вышла');
      await tester.pump(const Duration(milliseconds: 400));
      await _settle(tester);

      expect(service.searches, <String>['кофе']);
      expect(find.text('Поиск по всем статусам'), findsOneWidget);
      expect(find.text('По «кофе» совпадений нет'), findsOneWidget);
    });
  });

  group('A3-10 — выход не теряет отметки молча', () {
    Future<_CountingAuth> pumpLogout(
      WidgetTester tester,
      ModerationProvider moderation,
    ) async {
      final auth = _CountingAuth();
      addTearDown(auth.dispose);
      await tester.pumpWidget(MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthProvider>.value(value: auth),
          ChangeNotifierProvider<ModerationProvider>.value(value: moderation),
        ],
        child: MaterialApp(
          home: Builder(
            builder: (context) => TextButton(
              onPressed: () => confirmLogout(context),
              child: const Text('выйти'),
            ),
          ),
        ),
      ));
      await tester.tap(find.text('выйти'));
      await tester.pumpAndSettle();
      return auth;
    }

    testWidgets('с отметками — вопрос, «Остаться» не выходит', (tester) async {
      final moderation = ModerationProvider(service: _FakeService(pendingTotal: 1));
      addTearDown(moderation.dispose);
      await moderation.loadPendingEstablishments();
      await moderation.selectEstablishment('est-1');
      moderation.approveField('unp');

      final auth = await pumpLogout(tester, moderation);
      expect(find.text('Выйти из панели?'), findsOneWidget);
      await tester.tap(find.text('Остаться'));
      await tester.pumpAndSettle();
      expect(auth.logouts, 0);
    });

    testWidgets('без отметок — выход сразу', (tester) async {
      final moderation = ModerationProvider(service: _FakeService());
      addTearDown(moderation.dispose);
      final auth = await pumpLogout(tester, moderation);
      expect(find.text('Выйти из панели?'), findsNothing);
      expect(auth.logouts, 1);
    });
  });

  group('Новые поля сервера (слово Trunk 21.10: да на все четыре)', () {
    testWidgets('Ч19, К-6: адрес «?q=» открывает поиск и ставит текст в поле',
        (tester) async {
      tester.view.physicalSize = const Size(1440, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      final service = _FakeService();
      final provider = ApprovedProvider(service: service);
      addTearDown(provider.dispose);
      await tester.pumpWidget(MultiProvider(
        providers: [
          ChangeNotifierProvider<ApprovedProvider>.value(value: provider),
          ChangeNotifierProvider<BadgesProvider>(create: (_) => _StubBadges()),
          ChangeNotifierProvider<AuthProvider>(
            create: (_) => StubAuthProvider.admin(),
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.lightTheme,
          home: Scaffold(
            body: approvedScreenFor(
              Uri.parse('/moderation/approved?q=%D0%97%D0%B5%D1%80%D0%BD%D0%BE'),
            ),
          ),
        ),
      ));
      await _settle(tester);

      expect(service.searches, <String>['Зерно']);
      expect(tester.widget<TextField>(find.byType(TextField)).controller!.text,
          'Зерно');
      expect(find.text('Поиск по всем статусам'), findsOneWidget);
    });

    test('A1-02: владелец из ответа; у просмотрщика имя и почта скрыты', () {
      EstablishmentDetail parse(Map<String, dynamic> partner) =>
          EstablishmentDetail.fromJson(<String, dynamic>{
            'id': _shown,
            'name': 'Кухмістр',
            'partner': partner,
          });
      expect(
        parse(<String, dynamic>{'id': 'u', 'name': 'Ольга', 'email': 'o@example.by'})
            .partnerLabel,
        'Ольга · o@example.by',
      );
      expect(parse(<String, dynamic>{'id': 'u', 'name': null, 'email': null})
          .partnerLabel, isNull);
    });

    testWidgets('A1-02: ячейка «Партнёр» — из детали сервера', (tester) async {
      tester.view.physicalSize = const Size(1440, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      final detail = EstablishmentDetail.fromJson(<String, dynamic>{
        'id': _shown,
        'name': 'Кухмістр',
        'status': 'active',
        'partner': <String, dynamic>{'id': 'u', 'name': 'Ольга', 'email': 'o@example.by'},
      });
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home: Scaffold(
          body: ModerationDetailPanel(
            mode: DetailPanelMode.readonly,
            detail: detail,
            selectedId: _shown,
            isLoadingDetail: false,
          ),
        ),
      ));
      await tester.pump();
      expect(find.text('Партнёр'), findsOneWidget);
      expect(find.text('Ольга · o@example.by'), findsOneWidget);
    });

    testWidgets('A1-22: PDF листается, «стр. 2 из 3»; без числа — «стр. 1»',
        (tester) async {
      tester.view.physicalSize = const Size(1440, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      final pdf = MediaItem.fromJson(<String, dynamic>{
        'id': 'm-1',
        'url': 'https://res.cloudinary.com/t/image/upload/v1/menu/a.pdf',
        'preview_url': 'https://res.cloudinary.com/t/image/upload/c_limit/v1/menu/a.jpg',
        'file_type': 'pdf',
        'page_count': 3,
      });
      expect(pdf.pdfPageUrl(2),
          'https://res.cloudinary.com/t/image/upload/pg_2/v1/menu/a.jpg');
      expect(pdfPageLabel(3, null), 'стр. 3');

      await tester.pumpWidget(MaterialApp(
        home: MediaViewer(items: <MediaItem>[pdf], title: 'Меню'),
      ));
      await tester.pump();
      expect(find.text('PDF · стр. 1 из 3'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey<String>('pdf-next-page')));
      await tester.pump();
      expect(find.text('PDF · стр. 2 из 3'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey<String>('pdf-next-page')));
      await tester.pump();
      expect(find.text('PDF · стр. 3 из 3'), findsOneWidget);
      expect(
        tester.widget<IconButton>(
            find.byKey(const ValueKey<String>('pdf-next-page'))).onPressed,
        isNull,
        reason: 'дальше последней страницы листать некуда',
      );
      // Подсказка обещает Esc — клавиша привязана.
      expect(find.textContaining('Esc — закрыть'), findsOneWidget);
    });

    testWidgets('A1-22: Esc закрывает просмотр', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Builder(
          builder: (context) => TextButton(
            onPressed: () => showMediaViewer(
              context,
              items: const <MediaItem>[MediaItem(url: 'https://t/a.jpg')],
              title: 'Фото',
            ),
            child: const Text('открыть'),
          ),
        ),
      ));
      await tester.tap(find.text('открыть'));
      await tester.pumpAndSettle();
      expect(find.byType(MediaViewer), findsOneWidget);
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(find.byType(MediaViewer), findsNothing);
    });

    test('A1-08: позиция знает свой файл меню', () {
      final item = FlaggedMenuItem.fromJson(<String, dynamic>{
        'id': 'i-1',
        'establishment_id': 'e-1',
        'media_id': 'm-1',
        'item_name': 'Стейк',
        'created_at': '2026-10-20T10:00:00Z',
        'media_url': 'https://res.cloudinary.com/t/image/upload/v1/menu/a.pdf',
        'media_file_type': 'pdf',
        'media_preview_url': 'https://res.cloudinary.com/t/p.jpg',
      });
      expect(item.menuFile?.isPdf, isTrue);
      expect(item.menuFile?.id, 'm-1');
      final bare = FlaggedMenuItem.fromJson(<String, dynamic>{
        'id': 'i-2',
        'establishment_id': 'e-1',
        'media_id': 'm-2',
        'item_name': 'Салат',
        'created_at': '2026-10-20T10:00:00Z',
      });
      expect(bare.menuFile, isNull, reason: 'старый ответ — без кнопки');
    });
  });

  testWidgets('Ч21: до загрузки снимка — заглушка, а не пустой квадрат',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: SizedBox(
        width: 80,
        height: 80,
        child: NetworkThumbnail(
          url: 'https://res.cloudinary.com/t/image/upload/photo.jpg',
          fallback: Text('битая'),
        ),
      ),
    ));
    expect(find.byKey(NetworkThumbnail.placeholderKey), findsOneWidget);
  });
}

/// Доступ к формулировке предупреждения без поднятия диалога.
String approveWarningForTest({
  required int checked,
  required int total,
  required List<String> missing,
}) =>
    moderationApproveWarning(checked: checked, total: total, missing: missing);

class _CountingAuth extends StubAuthProvider {
  _CountingAuth()
      : super(const User(
          id: 'admin-1',
          email: 'admin@nirivio.by',
          name: 'Сергей Админов',
          role: 'admin',
        ));

  int logouts = 0;

  @override
  Future<void> logout() async => logouts++;
}
