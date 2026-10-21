import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/admin_review_item.dart';
import 'package:restaurant_guide_admin_web/models/admin_user.dart';
import 'package:restaurant_guide_admin_web/providers/admin_reviews_provider.dart';
import 'package:restaurant_guide_admin_web/providers/admin_users_provider.dart';
import 'package:restaurant_guide_admin_web/providers/auth_provider.dart';
import 'package:restaurant_guide_admin_web/screens/notifications/notifications_screen.dart';
import 'package:restaurant_guide_admin_web/screens/reviews/reviews_management_screen.dart';
import 'package:restaurant_guide_admin_web/screens/users/users_screen.dart';
import 'package:restaurant_guide_admin_web/services/admin_review_service.dart';
import 'package:restaurant_guide_admin_web/services/admin_user_service.dart';

import '../helpers/stub_auth.dart';
import '../helpers/wire_stand.dart';

// «Отзывы», «Пользователи», «Уведомления» — проход по панели модератора,
// 20.10, пакет П7.
//
// Отзывы одного человека находятся и скрываются разом с одной причиной
// (A2-09 — тестовые отзывы стороннего тестировщика); ссылка из аналитики
// приходит с отбором «1–2» (осмотр п. 31); диалоги говорят, что автор не
// напишет о месте снова (A2-10); у скрытого — почему, у автора — «заблокирован»,
// «Показать» — с вопросом (A2-11); причина — с пределом сервера (A2-12);
// длинный текст — «Показать полностью» (п. 33); опустевшая страница — назад
// (A2-08); поиск виден после возврата (A2-18). Люди: удалённая учётка — без
// бесполезных кнопок (A2-05), история блокировок (A2-15), заведения партнёра
// и подписанные фильтры с ролью (п. 35), карточка уходит со сменой фильтра
// (п. 34), итог со счётом сервера (A2-06), «Сбросить имя» не молчит (A2-17).
// Вёрстка — на окнах 1024 и 1150 (решение Координатора А; осмотр п. 32).
//
// Ответы идут по проводу: подставной транспорт, настоящие сервис,
// перехватчики, провайдер и экран.

const String _authorId = '0d9a6c1e-4b7f-4a52-9e3d-1f2a3b4c5d6e';

Map<String, dynamic> _review(
  String id, {
  String authorId = _authorId,
  String authorName = 'Тест Тестировщик',
  bool visible = true,
  bool deleted = false,
  int rating = 1,
  String content = 'Проверка формы отзыва',
  bool? authorActive = true,
  String? hiddenBy,
  String? hiddenReason,
  String establishment = 'Кухмістр',
}) =>
    <String, dynamic>{
      'id': id,
      'rating': rating,
      'content': content,
      'is_deleted': deleted,
      'is_visible': visible,
      'is_edited': false,
      'created_at': '2026-10-09T12:30:00.000Z',
      'has_partner_response': false,
      'author_id': authorId,
      'author_name': authorName,
      'author_email': 'tester@example.com',
      'establishment_name': establishment,
      'establishment_city': 'Минск',
      'establishment_id': 'e-1',
      'establishment_average_rating': 4.1,
      'establishment_review_count': 20,
      'author_review_count': 3,
      'author_average_rating': 1.3,
      'author_is_active': authorActive,
      'hidden_by': hiddenBy,
      'hidden_reason': hiddenReason,
      'viewer_redacted': false,
    };

/// Сервер отзывов и людей: отвечает списками, карточкой и действиями.
class _Server {
  List<Map<String, dynamic>> reviews = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> users = <Map<String, dynamic>>[];
  Map<String, Map<String, dynamic>> cards = <String, Map<String, dynamic>>{};

  /// Ответ на страницу списка вместо обычного (страница → ответ).
  Map<String, dynamic>? Function(String path, Map<String, dynamic> query)?
      page;

  /// Ответ на разблокировку.
  Map<String, dynamic> unblockAnswer = <String, dynamic>{'changed': true};

  final List<RequestOptions> requests = <RequestOptions>[];

  late final StubAdapter adapter = StubAdapter(_respond, maxRequests: 60);

  Iterable<RequestOptions> to(String method, String suffix) => requests
      .where((r) => r.method == method && r.uri.path.endsWith(suffix));

  ResponseBody _respond(RequestOptions options) {
    requests.add(options);
    final path = options.uri.path;
    final query = options.queryParameters;
    final special = page?.call(path, query);
    if (special != null) return jsonBody(special);

    if (options.method == 'GET' && path == '/api/v1/admin/reviews') {
      return jsonBody(<String, dynamic>{
        'success': true,
        'data': reviews,
        'meta': <String, dynamic>{
          'total': reviews.length,
          'hidden': reviews.where((r) => r['is_visible'] == false).length,
          'average_rating': null,
          'page': 1,
          'pages': 1,
        },
      });
    }
    if (path == '/api/v1/admin/reviews/hide-batch') {
      final ids = (options.data as Map)['review_ids'] as List;
      var hidden = 0;
      for (final review in reviews) {
        if (ids.contains(review['id']) && review['is_visible'] == true) {
          review['is_visible'] = false;
          review['hidden_by'] = 'moderator';
          review['hidden_reason'] = (options.data as Map)['reason'];
          hidden++;
        }
      }
      return jsonBody(<String, dynamic>{
        'success': true,
        'data': <String, dynamic>{
          'requested': ids.length,
          'hidden': hidden,
          'skipped': ids.length - hidden,
          'changed': hidden > 0,
        },
      });
    }
    if (path.startsWith('/api/v1/admin/reviews/')) {
      return jsonBody(<String, dynamic>{'success': true, 'data': {}});
    }
    if (options.method == 'GET' && path == '/api/v1/admin/users') {
      return jsonBody(<String, dynamic>{
        'success': true,
        'data': users,
        'meta': <String, dynamic>{'total': users.length, 'page': 1, 'pages': 1},
      });
    }
    if (path.endsWith('/unblock')) {
      return jsonBody(<String, dynamic>{'success': true, 'data': unblockAnswer});
    }
    if (options.method == 'GET' && path.startsWith('/api/v1/admin/users/')) {
      final id = path.split('/').last;
      return jsonBody(<String, dynamic>{'success': true, 'data': cards[id]});
    }
    throw StateError('стенд не знает запроса ${options.method} $path');
  }
}

Map<String, dynamic> _person({
  String id = _authorId,
  String? name = 'Тест Тестировщик',
  String? email = 'tester@example.com',
  String role = 'user',
  bool active = true,
  bool deleted = false,
  int reviews = 3,
  List<Map<String, dynamic>>? history,
  List<Map<String, dynamic>>? establishments,
  int establishmentCount = 0,
}) =>
    <String, dynamic>{
      'id': id,
      'name': name,
      'email': email,
      'phone': null,
      'role': role,
      'is_active': active,
      'is_deleted': deleted,
      'is_service_account': false,
      'created_at': '2026-09-01T10:00:00.000Z',
      'review_count': reviews,
      'hidden_review_count': 0,
      'establishment_count': establishmentCount,
      'live_establishment_count': 0,
      'block_history': history,
      'establishments': establishments,
      'viewer_redacted': false,
    };

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

/// Окно [width]: меню слева 260 и экран — как в каркасе панели.
void _window(WidgetTester tester, double width, {double height = 900}) {
  tester.view.physicalSize = Size(width, height);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}

Widget _frame(Widget screen) => Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        const SizedBox(width: 260),
        Expanded(child: screen),
      ],
    );

AdminReviewService _reviewService(_Server server) =>
    AdminReviewService.withClient(stubClient(server.adapter));

AdminUserService _userService(_Server server) =>
    AdminUserService.withClient(stubClient(server.adapter));

void main() {
  setUp(() => installSecureStorageStand(initial: {'access_token': 'a-1'}));

  Future<AdminReviewsProvider> pumpReviews(
    WidgetTester tester,
    _Server server, {
    double width = 1440,
    String? author,
    String? rating,
    bool viewer = false,
    AdminReviewsProvider? provider,
  }) async {
    _window(tester, width);
    final reviews = provider ?? AdminReviewsProvider(service: _reviewService(server));
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AdminReviewsProvider>.value(value: reviews),
          ChangeNotifierProvider<AuthProvider>(
            create: (_) =>
                viewer ? StubAuthProvider.viewer() : StubAuthProvider.admin(),
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.lightTheme,
          home: Scaffold(
            body: _frame(ReviewsManagementScreen(
              initialAuthorId: author,
              initialRating: rating,
            )),
          ),
        ),
      ),
    );
    await _settle(tester);
    return reviews;
  }

  Future<void> tapAndSettle(WidgetTester tester, Finder finder) async {
    await tester.ensureVisible(finder);
    await tester.tap(finder);
    await _settle(tester);
  }

  // ==========================================================================
  // Отзывы одного человека — найти и скрыть разом (A2-09)
  // ==========================================================================

  group('Отзывы автора и «Скрыть выбранные»', () {
    testWidgets(
        'адрес ?author= отбирает отзывы человека; отмеченные видимые '
        'скрываются одним запросом с одной причиной', (tester) async {
      final server = _Server()
        ..reviews = <Map<String, dynamic>>[
          _review('r1'),
          _review('r2', establishment: 'Васильки'),
          _review('r3', visible: false, hiddenBy: 'moderator'),
        ];
      final provider = await pumpReviews(tester, server, author: _authorId);
      addTearDown(provider.dispose);

      expect(server.to('GET', '/admin/reviews').last.queryParameters['user_id'],
          _authorId);
      expect(find.text('Отзывы автора: Тест Тестировщик'), findsOneWidget);
      // Отметки — у видимых, не у скрытого.
      expect(find.byKey(const ValueKey<String>('review-check-r1')), findsOneWidget);
      expect(find.byKey(const ValueKey<String>('review-check-r3')), findsNothing);
      final hide = find.byKey(const ValueKey<String>('reviews-hide-checked'));
      expect(tester.widget<FilledButton>(hide).onPressed, isNull);

      await tapAndSettle(
          tester, find.byKey(const ValueKey<String>('reviews-check-all')));
      expect(find.text('Скрыть выбранные (2)'), findsOneWidget);

      await tapAndSettle(tester, hide);
      expect(find.text('Скрыть 2 отзыва?'), findsOneWidget);
      expect(find.textContaining(kNoNewReviewNote), findsOneWidget);
      final confirm = find.byKey(const ValueKey<String>('review-reason-confirm'));
      expect(tester.widget<FilledButton>(confirm).onPressed, isNull,
          reason: 'без причины пачку не скрыть');
      await tester.enterText(find.byKey(const ValueKey<String>('review-reason')),
          ' Тестовые отзывы стороннего тестировщика ');
      await tester.pump();
      await tapAndSettle(tester, confirm);

      final batch = server.to('POST', '/reviews/hide-batch').single;
      expect(batch.data, <String, dynamic>{
        'review_ids': <String>['r1', 'r2'],
        'reason': 'Тестовые отзывы стороннего тестировщика',
      });
      expect(find.text('Скрыто 2 отзыва'), findsOneWidget);
      expect(find.byKey(const ValueKey<String>('review-check-r1')), findsNothing,
          reason: 'перечитанный список: скрытые больше не отмечаются');
      expect(provider.checkedIds, isEmpty);
    });

    testWidgets('из панели отзыва — «Все отзывы автора»; крестик снимает отбор',
        (tester) async {
      final server = _Server()..reviews = <Map<String, dynamic>>[_review('r1')];
      final provider = await pumpReviews(tester, server);
      addTearDown(provider.dispose);
      await tapAndSettle(tester, find.text('Проверка формы отзыва').first);

      await tapAndSettle(
          tester, find.byKey(const ValueKey<String>('review-author-reviews')));
      expect(provider.authorId, _authorId);
      expect(server.to('GET', '/admin/reviews').last.queryParameters['user_id'],
          _authorId);

      await tapAndSettle(
          tester, find.byKey(const ValueKey<String>('reviews-author-clear')));
      expect(provider.authorId, isNull);
      expect(
          server.to('GET', '/admin/reviews').last.queryParameters
              .containsKey('user_id'),
          isFalse);
    });

    testWidgets('просмотрщику отметок и «Скрыть выбранные» нет', (tester) async {
      final server = _Server()..reviews = <Map<String, dynamic>>[_review('r1')];
      final provider =
          await pumpReviews(tester, server, author: _authorId, viewer: true);
      addTearDown(provider.dispose);
      expect(find.byKey(const ValueKey<String>('review-check-r1')), findsNothing);
      expect(find.byKey(const ValueKey<String>('reviews-hide-checked')),
          findsNothing);
    });

    test('итог пачки — числом сервера, пропущенные названы', () {
      expect(
          batchResultText(const AdminReviewBatchResult(
              requested: 3, hidden: 2, skipped: 1)),
          'Скрыто 2 отзыва. 1 уже был скрыт или удалён — его не трогали');
      expect(
          batchResultText(const AdminReviewBatchResult(
              requested: 2, hidden: 0, skipped: 2)),
          'Ничего не скрыто. 2 уже были скрыты или удалены — их не трогали');
    });
  });

  // ==========================================================================
  // Оценка из аналитики (п. 31)
  // ==========================================================================

  group('Фильтр по оценке', () {
    testWidgets('?rating=1-2 — диапазон на сервер и подпись фильтра',
        (tester) async {
      final server = _Server()..reviews = <Map<String, dynamic>>[_review('r1')];
      final provider = await pumpReviews(tester, server, rating: '1-2');
      addTearDown(provider.dispose);

      final query = server.to('GET', '/admin/reviews').last.queryParameters;
      expect(query['rating_min'], 1);
      expect(query['rating_max'], 2);
      expect(query.containsKey('rating'), isFalse);
      expect(find.text('Низкие: 1–2 звезды'), findsOneWidget);
    });

    test('разбор оценки из адреса', () {
      expect(parseRatingParam('1-2'), (1, 2));
      expect(parseRatingParam('3'), (3, 3));
      expect(parseRatingParam('2-1'), isNull);
      expect(parseRatingParam('0'), isNull);
      expect(parseRatingParam('abc'), isNull);
      expect(parseRatingParam(null), isNull);
    });

    test('ссылка из аналитики несёт отбор «1–2»', () {
      final source = File('lib/screens/analytics/reviews_analytics_tab.dart')
          .readAsStringSync();
      expect(source, contains("context.go('/settings/reviews?rating=1-2')"));
    });
  });

  // ==========================================================================
  // Диалоги и состояние отзыва (A2-10, A2-11, A2-12)
  // ==========================================================================

  group('Скрыть, показать, удалить', () {
    testWidgets('скрытие — с обязательной причиной, о повторном отзыве сказано',
        (tester) async {
      final server = _Server()..reviews = <Map<String, dynamic>>[_review('r1')];
      final provider = await pumpReviews(tester, server);
      addTearDown(provider.dispose);
      await tapAndSettle(tester, find.text('Проверка формы отзыва').first);

      await tapAndSettle(
          tester, find.byKey(const ValueKey<String>('review-visibility')));
      expect(find.textContaining(kNoNewReviewNote), findsOneWidget);
      final field = tester.widget<TextField>(
          find.byKey(const ValueKey<String>('review-reason')));
      expect(field.maxLength, 500);
      expect(
          tester
              .widget<FilledButton>(
                  find.byKey(const ValueKey<String>('review-reason-confirm')))
              .onPressed,
          isNull,
          reason: 'без причины не скрыть (A2-12)');
      await tester.enterText(
          find.byKey(const ValueKey<String>('review-reason')), 'Реклама');
      await tester.pump();
      await tapAndSettle(
          tester, find.byKey(const ValueKey<String>('review-reason-confirm')));

      expect(server.to('POST', '/reviews/r1/visibility').single.data,
          <String, dynamic>{'is_visible': false, 'reason': 'Реклама'});
    });

    testWidgets('удаление — о повторном отзыве и предел причины',
        (tester) async {
      final server = _Server()..reviews = <Map<String, dynamic>>[_review('r1')];
      final provider = await pumpReviews(tester, server);
      addTearDown(provider.dispose);
      await tapAndSettle(tester, find.text('Проверка формы отзыва').first);

      await tapAndSettle(
          tester, find.byKey(const ValueKey<String>('review-delete')));
      expect(find.text('Удалить отзыв?'), findsOneWidget);
      expect(find.textContaining(kNoNewReviewNote), findsOneWidget);
      expect(
          tester
              .widget<TextField>(
                  find.byKey(const ValueKey<String>('review-reason')))
              .maxLength,
          500);
      // Причина удаления по-прежнему необязательна.
      expect(
          tester
              .widget<FilledButton>(
                  find.byKey(const ValueKey<String>('review-reason-confirm')))
              .onPressed,
          isNotNull);
    });

    testWidgets('скрытый модератором — его причина; блокировкой — так и сказано',
        (tester) async {
      final server = _Server()
        ..reviews = <Map<String, dynamic>>[
          _review('r1',
              visible: false, hiddenBy: 'moderator', hiddenReason: 'Оскорбления'),
          _review('r2',
              visible: false,
              hiddenBy: 'block',
              hiddenReason: 'Накрутка',
              authorActive: false,
              content: 'Второй отзыв'),
          _review('r3', visible: false, content: 'Третий отзыв'),
        ];
      final provider = await pumpReviews(tester, server);
      addTearDown(provider.dispose);

      await tapAndSettle(tester, find.text('Проверка формы отзыва').first);
      expect(find.text('Скрыт модератором'), findsOneWidget);
      expect(find.text('Причина: Оскорбления'), findsOneWidget);

      await tapAndSettle(tester, find.text('Второй отзыв').first);
      expect(find.text('Скрыт блокировкой автора'), findsOneWidget);
      expect(find.text('Причина: Накрутка'), findsOneWidget);
      // Метка — и в карточке списка, и в панели.
      expect(find.text('автор заблокирован'), findsNWidgets(2));

      await tapAndSettle(tester, find.text('Третий отзыв').first);
      expect(find.text('Скрыт — записи о том, кто и почему, в журнале нет'),
          findsOneWidget);
    });

    testWidgets('«Показать» отзыв заблокированного автора — с вопросом',
        (tester) async {
      final server = _Server()
        ..reviews = <Map<String, dynamic>>[
          _review('r1', visible: false, hiddenBy: 'block', authorActive: false),
        ];
      final provider = await pumpReviews(tester, server);
      addTearDown(provider.dispose);
      await tapAndSettle(tester, find.text('Проверка формы отзыва').first);

      await tapAndSettle(
          tester, find.byKey(const ValueKey<String>('review-visibility')));
      expect(find.byKey(const ValueKey<String>('review-show-blocked-dialog')),
          findsOneWidget);
      await tapAndSettle(tester, find.text('Отмена'));
      expect(server.to('POST', '/visibility'), isEmpty);

      await tapAndSettle(
          tester, find.byKey(const ValueKey<String>('review-visibility')));
      await tapAndSettle(tester, find.text('Показать'));
      expect(server.to('POST', '/reviews/r1/visibility').single.data,
          <String, dynamic>{'is_visible': true});
    });

    testWidgets('«Показать» у незаблокированного — без вопроса', (tester) async {
      final server = _Server()
        ..reviews = <Map<String, dynamic>>[
          _review('r1', visible: false, hiddenBy: 'moderator'),
        ];
      final provider = await pumpReviews(tester, server);
      addTearDown(provider.dispose);
      await tapAndSettle(tester, find.text('Проверка формы отзыва').first);
      await tapAndSettle(
          tester, find.byKey(const ValueKey<String>('review-visibility')));
      expect(find.byKey(const ValueKey<String>('review-show-blocked-dialog')),
          findsNothing);
      expect(server.to('POST', '/reviews/r1/visibility'), hasLength(1));
    });
  });

  // ==========================================================================
  // Длинный текст (п. 33), пустая страница (A2-08), поиск после возврата (A2-18)
  // ==========================================================================

  group('Текст, страницы, поиск', () {
    testWidgets('длинный отзыв свёрнут с «…» и раскрывается', (tester) async {
      final long = List<String>.filled(120, 'Очень длинный отзыв о заведении.')
          .join(' ');
      final server = _Server()
        ..reviews = <Map<String, dynamic>>[_review('r1', content: long)];
      final provider = await pumpReviews(tester, server);
      addTearDown(provider.dispose);
      await tapAndSettle(tester, find.text(long).first);

      final quote = find.byKey(const ValueKey<String>('review-quote-text'));
      expect(tester.widget<Text>(quote).maxLines, 8);
      expect(tester.widget<Text>(quote).overflow, TextOverflow.ellipsis);
      await tapAndSettle(tester, find.text('Показать полностью'));
      expect(tester.widget<Text>(quote).maxLines, isNull);
      expect(find.text('Свернуть'), findsOneWidget);
    });

    testWidgets('короткий — без кнопки', (tester) async {
      final server = _Server()..reviews = <Map<String, dynamic>>[_review('r1')];
      final provider = await pumpReviews(tester, server);
      addTearDown(provider.dispose);
      await tapAndSettle(tester, find.text('Проверка формы отзыва').first);
      expect(find.byKey(const ValueKey<String>('review-quote-toggle')),
          findsNothing);
    });

    test('опустевшая последняя страница — предыдущая, а не «ничего не подошло»',
        () async {
      final server = _Server()..reviews = <Map<String, dynamic>>[_review('r1')];
      server.page = (path, query) => path == '/api/v1/admin/reviews' &&
              query['page'] == 2
          ? <String, dynamic>{
              'success': true,
              'data': <dynamic>[],
              'meta': <String, dynamic>{'total': 20, 'page': 2, 'pages': 1},
            }
          : null;
      final provider = AdminReviewsProvider(service: _reviewService(server));
      addTearDown(provider.dispose);

      await provider.loadReviews(page: 2);

      final pages = server
          .to('GET', '/admin/reviews')
          .map((r) => r.queryParameters['page'])
          .toList();
      expect(pages, <Object?>[2, 1]);
      expect(provider.reviews, hasLength(1));
      expect(provider.currentPage, 1);
    });

    testWidgets('поиск, оставшийся в провайдере, виден в поле после возврата',
        (tester) async {
      final server = _Server()..reviews = <Map<String, dynamic>>[_review('r1')];
      final provider = AdminReviewsProvider(service: _reviewService(server));
      addTearDown(provider.dispose);
      provider.search('драники');
      await pumpReviews(tester, server, provider: provider);
      expect(
          tester.widget<TextField>(find.byType(TextField).first).controller!.text,
          'драники');
    });
  });

  // ==========================================================================
  // Вёрстка «Отзывов» на 1024 и 1150 (F-02, A2-03, п. 32)
  // ==========================================================================

  group('Вёрстка «Отзывов»', () {
    for (final width in <double>[1024, 1150]) {
      testWidgets('окно $width: подвал, факты и строка даты не режутся',
          (tester) async {
        final server = _Server()
          ..reviews = <Map<String, dynamic>>[
            _review('r1', content: 'Драники были холодными, а суп пересолен'),
          ];
        final provider = await pumpReviews(tester, server, width: width);
        addTearDown(provider.dispose);
        await tapAndSettle(
            tester, find.text('Драники были холодными, а суп пересолен').first);
        // Переполнение раскладки уронило бы тест само (FlutterError).

        final hint = find.byKey(const ValueKey<String>('review-delete-hint'));
        final hintSize = tester.getSize(hint);
        expect(hintSize.width, greaterThan(250),
            reason: 'подсказка — строкой, а не столбиком в остатке ряда');
        expect(hintSize.height, lessThan(45), reason: 'не больше двух строк');

        final delete = tester.getRect(
            find.byKey(const ValueKey<String>('review-delete')));
        expect(delete.right, lessThanOrEqualTo(width - 24));

        final created = DateTime.parse('2026-10-09T12:30:00.000Z');
        final date = 'отзыв от ${formatDayMonthLocal(created)}, '
            '${formatTimeLocal(created)}';
        for (final text in <String>[date, 'виден в приложении']) {
          final paragraph =
              tester.renderObject<RenderParagraph>(find.text(text));
          expect(
            paragraph.size.width,
            greaterThanOrEqualTo(
                paragraph.getMaxIntrinsicWidth(double.infinity) - 0.5),
            reason: '«$text» показан целиком',
          );
        }

        if (width == 1024) {
          expect(find.byKey(const ValueKey<String>('review-facts-column')),
              findsOneWidget,
              reason: 'три факта в ряд на ≈ 330 шли по буквам');
        }
      });
    }
  });

  // ==========================================================================
  // «Пользователи»
  // ==========================================================================

  Future<AdminUsersProvider> pumpUsers(
    WidgetTester tester,
    _Server server, {
    double width = 1440,
    String? open,
  }) async {
    _window(tester, width);
    final provider = AdminUsersProvider(service: _userService(server));
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AdminUsersProvider>.value(value: provider),
          ChangeNotifierProvider<AuthProvider>(
              create: (_) => StubAuthProvider.admin()),
        ],
        child: MaterialApp(
          theme: AppTheme.lightTheme,
          home: Scaffold(body: _frame(UsersScreen(initialUserId: open))),
        ),
      ),
    );
    await _settle(tester);
    return provider;
  }

  group('«Пользователи»', () {
    testWidgets('удалённая учётка — «удалена», без кнопок, которые откажут',
        (tester) async {
      final gone = _person(
          name: 'Гость', email: null, active: false, deleted: true, reviews: 0);
      final server = _Server()
        ..users = <Map<String, dynamic>>[gone]
        ..cards = <String, Map<String, dynamic>>{_authorId: gone};
      final provider = await pumpUsers(tester, server, open: _authorId);
      addTearDown(provider.dispose);

      expect(find.text('учётка удалена'), findsNWidgets(2)); // строка и шапка
      expect(find.text('заблокирован'), findsNothing);
      expect(find.text('Учётка удалена'), findsOneWidget);
      expect(find.text('стёрты при удалении учётки'), findsOneWidget);
      expect(find.byKey(const ValueKey<String>('user-deleted-note')),
          findsOneWidget);
      for (final key in <String>['user-block', 'user-unblock', 'user-reset-name']) {
        expect(find.byKey(ValueKey<String>(key)), findsNothing, reason: key);
      }
    });

    testWidgets('история: причина блокировки видна и после разблокировки',
        (tester) async {
      final card = _person(history: <Map<String, dynamic>>[
        <String, dynamic>{
          'action': 'user_unblock',
          'reason': 'Разобрались',
          'created_at': '2026-10-19T09:00:00.000Z',
          'admin_name': 'Модератор Один',
          'by_operator': false,
          'restored_reviews': 2,
        },
        <String, dynamic>{
          'action': 'user_block',
          'reason': 'Накрутка отзывов',
          'created_at': '2026-10-18T09:00:00.000Z',
          'admin_name': null,
          'by_operator': true,
          'hidden_reviews': 0,
        },
      ]);
      final server = _Server()
        ..users = <Map<String, dynamic>>[card]
        ..cards = <String, Map<String, dynamic>>{_authorId: card};
      final provider = await pumpUsers(tester, server, open: _authorId);
      addTearDown(provider.dispose);

      expect(find.byKey(const ValueKey<String>('user-block-history')),
          findsOneWidget);
      expect(find.text('Причина: Разобрались'), findsOneWidget);
      expect(find.text('Причина: Накрутка отзывов'), findsOneWidget);
      expect(find.textContaining('оператор скриптом'), findsOneWidget);
      expect(find.text('возвращено отзывов: 2'), findsOneWidget);
    });

    testWidgets('у партнёра видны его заведения со статусом', (tester) async {
      final card = _person(
        role: 'partner',
        establishmentCount: 2,
        establishments: <Map<String, dynamic>>[
          <String, dynamic>{
            'id': 'e-1', 'name': 'Кухмістр', 'city': 'Минск', 'status': 'pending'
          },
          <String, dynamic>{
            'id': 'e-2', 'name': 'Васильки', 'city': 'Гродно', 'status': 'draft'
          },
        ],
      );
      final server = _Server()
        ..users = <Map<String, dynamic>>[card]
        ..cards = <String, Map<String, dynamic>>{_authorId: card};
      final provider = await pumpUsers(tester, server, open: _authorId);
      addTearDown(provider.dispose);

      expect(
          find.text('Кухмістр · Минск · на модерации\nВасильки · Гродно · черновик'),
          findsOneWidget);
    });

    testWidgets(
        'фильтры подписаны; «Удалённые» и роль уходят на сервер; смена '
        'фильтра закрывает карточку', (tester) async {
      final card = _person();
      final server = _Server()
        ..users = <Map<String, dynamic>>[card]
        ..cards = <String, Map<String, dynamic>>{_authorId: card};
      final provider = await pumpUsers(tester, server);
      addTearDown(provider.dispose);
      expect(find.text('Состояние'), findsOneWidget);
      expect(find.text('Роль'), findsOneWidget);

      await tapAndSettle(tester, find.text('Тест Тестировщик').first);
      expect(provider.selectedUser, isNotNull);

      await tapAndSettle(
          tester, find.byKey(const ValueKey<String>('users-status-filter')));
      await tapAndSettle(tester, find.text('Удалённые').last);
      expect(server.to('GET', '/admin/users').last.queryParameters['status'],
          'deleted');
      expect(provider.selectedUser, isNull,
          reason: 'карточка человека вне нового отбора не остаётся (п. 34)');
      expect(find.text('Выберите человека слева'), findsOneWidget);

      await tapAndSettle(
          tester, find.byKey(const ValueKey<String>('users-role-filter')));
      await tapAndSettle(tester, find.text('Партнёры').last);
      expect(server.to('GET', '/admin/users').last.queryParameters['role'],
          'partner');
    });

    testWidgets('«Сбросить имя» не молчит, когда сбрасывать нечего',
        (tester) async {
      final card = _person(name: 'Пользователь');
      final server = _Server()
        ..users = <Map<String, dynamic>>[card]
        ..cards = <String, Map<String, dynamic>>{_authorId: card};
      final provider = await pumpUsers(tester, server, open: _authorId);
      addTearDown(provider.dispose);
      expect(find.byKey(const ValueKey<String>('user-name-already-reset')),
          findsOneWidget);
    });

    testWidgets('разблокировка: итог — «возвращено N из M», а не обещание',
        (tester) async {
      final card = _person(active: false, history: <Map<String, dynamic>>[
        <String, dynamic>{
          'action': 'user_block',
          'reason': 'Спам',
          'created_at': '2026-10-18T09:00:00.000Z',
          'by_operator': false,
          'hidden_reviews': 3,
        },
      ]);
      final server = _Server()
        ..users = <Map<String, dynamic>>[card]
        ..cards = <String, Map<String, dynamic>>{_authorId: card}
        ..unblockAnswer = <String, dynamic>{
          'changed': true,
          'restored_reviews': 1,
          'block_hidden_reviews': 3,
          'block_by_operator': false,
          'block_found': true,
        };
      final provider = await pumpUsers(tester, server, open: _authorId);
      addTearDown(provider.dispose);

      await tapAndSettle(
          tester, find.byKey(const ValueKey<String>('user-unblock')));
      await tester.enterText(
          find.byKey(const ValueKey<String>('user-reason')), 'Извинился');
      await tester.pump();
      await tapAndSettle(
          tester, find.byKey(const ValueKey<String>('user-reason-confirm')));

      expect(
          find.text('Пользователь разблокирован, возвращено отзывов: 1 из 3, '
              'скрытых блокировкой. Остальные с тех пор скрыли или показали '
              'вручную, или они удалены'),
          findsOneWidget);
    });

    test('итог разблокировки без списка — так и сказано', () {
      expect(
        unblockResultText(
          const AdminUserUnblockResult(changed: true, blockByOperator: true),
          restoreReviews: true,
        ),
        contains('Блокировку ставил оператор скриптом'),
      );
      expect(
        unblockResultText(
          const AdminUserUnblockResult(changed: true, blockFound: false),
          restoreReviews: true,
        ),
        contains('Записи о блокировке в журнале нет'),
      );
      expect(
        blockResultText(const AdminUserBlockResult(changed: true, hiddenReviews: 0)),
        contains('скрывать было нечего'),
      );
    });

    testWidgets('«Отзывы автора» ведёт на «Отзывы» с отбором по человеку',
        (tester) async {
      final card = _person();
      final server = _Server()
        ..users = <Map<String, dynamic>>[card]
        ..cards = <String, Map<String, dynamic>>{_authorId: card};
      _window(tester, 1440);
      final provider = AdminUsersProvider(service: _userService(server));
      addTearDown(provider.dispose);
      final router = GoRouter(
        initialLocation: '/settings/users?user=$_authorId',
        routes: <RouteBase>[
          GoRoute(
            path: '/settings/users',
            builder: (_, state) => Scaffold(
              body: UsersScreen(initialUserId: state.uri.queryParameters['user']),
            ),
          ),
          GoRoute(
            path: '/settings/reviews',
            builder: (_, state) => Text('reviews ${state.uri.query}'),
          ),
        ],
      );
      addTearDown(router.dispose);
      await tester.pumpWidget(MultiProvider(
        providers: [
          ChangeNotifierProvider<AdminUsersProvider>.value(value: provider),
          ChangeNotifierProvider<AuthProvider>(
              create: (_) => StubAuthProvider.admin()),
        ],
        child: MaterialApp.router(
            theme: AppTheme.lightTheme, routerConfig: router),
      ));
      await _settle(tester);

      await tapAndSettle(
          tester, find.byKey(const ValueKey<String>('user-author-reviews')));
      expect(find.text('reviews author=$_authorId'), findsOneWidget);
    });

    for (final width in <double>[1024, 1150]) {
      testWidgets('окно $width: шапка и карточка без переполнения',
          (tester) async {
        final card = _person(
          role: 'partner',
          establishmentCount: 1,
          establishments: <Map<String, dynamic>>[
            <String, dynamic>{
              'id': 'e-1', 'name': 'Кухмістр', 'city': 'Минск', 'status': 'active'
            },
          ],
          history: <Map<String, dynamic>>[
            <String, dynamic>{
              'action': 'user_block',
              'reason': 'Спам',
              'created_at': '2026-10-18T09:00:00.000Z',
              'hidden_reviews': 3,
            },
          ],
        );
        final server = _Server()
          ..users = <Map<String, dynamic>>[card]
          ..cards = <String, Map<String, dynamic>>{_authorId: card};
        final provider = await pumpUsers(tester, server, width: width, open: _authorId);
        addTearDown(provider.dispose);
        // Переполнение шапки или карточки уронило бы тест само.
        final title = tester.renderObject<RenderParagraph>(find.text('Пользователи'));
        expect(title.didExceedMaxLines, isFalse,
            reason: 'заголовок экрана не обрезан');
        expect(
            tester.getRect(find.byKey(const ValueKey<String>('users-role-filter')))
                .right,
            lessThanOrEqualTo(width));
      });
    }
  });

  // ==========================================================================
  // «Уведомления» (A2-16)
  // ==========================================================================

  testWidgets('«Уведомления» не обещают жалоб, «в разработке» — один раз',
      (tester) async {
    _window(tester, 1440);
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.lightTheme,
      home: const Scaffold(body: NotificationsScreen()),
    ));
    expect(find.textContaining('жалоб'), findsNothing);
    expect(find.textContaining('в разработке'), findsOneWidget);
  });
}
